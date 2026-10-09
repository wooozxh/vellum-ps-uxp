#!/usr/bin/env python3
"""
push_via_api.py —— 当 `git push` 不通时的推送兜底通道
===========================================================================
背景
    本机 `github.com:443` 会被**间歇性 SNI 拦截**。实测同一时刻：
        api.github.com        200
        codeload.github.com   301
        github.com            连不上（走代理则 CONNECT tunnel failed 502）
    此时 `git push` 无论摘不摘代理变量都推不上去 —— 但**远端并不坏**，
    坏的只是 github.com 这一个入口。

解法
    改走 GitHub 的 **Git Data API**（api.github.com 通常仍可达）。
    Git 对象是内容寻址的：只要内容一致，远端算出的 tree / commit 的 sha
    就与本地**完全相同**，所以推完以后本地跟踪引用可直接对齐，连 fetch 都不需要。

用法
    python tools/push_via_api.py                # 推当前分支
    python tools/push_via_api.py --dry-run      # 只列出将推送的提交
    python tools/push_via_api.py --branch main

前提
    · 目标仓库**必须已非空**。GitHub 的 trees API 在完全空的仓库上返回 409；
      空仓库要先造一个提交（网页建 README，或用 Contents API 写一个文件）。
    · 凭据从 `git credential fill` 取（GCM）。实测偶尔返回空，本脚本自动重试。

为什么是 Python 而不是 .mjs
    tools/ 下其它脚本都是 Node。但这个脚本只在「网络/工具链已经不正常」时才被用到，
    而本机 Node 在受限环境里 spawn 外部 exe 会 EBUSY（实测 git/node/where 全中招），
    Python 的 subprocess 反而稳 —— 对兜底工具来说「验证过」比「风格统一」重要。

局限
    每个提交都会重传整棵树（简单可靠，适合本量级的仓库）。
    若 `git push` 可用，优先用 `git push` —— 这是兜底，不是替代。
"""

import argparse
import base64
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OWNER = "wooozxh"
REPO = "vellum-ps-uxp"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"

# 摘掉代理变量：GCM 在有代理时会挂起，且代理通道对 github 本来就是坏的
ENV = {k: v for k, v in os.environ.items()
       if k.lower() not in ("http_proxy", "https_proxy")}
ENV["PYTHONUTF8"] = "1"

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def git(*args, binary=False):
    r = subprocess.run(["git", "-c", "core.quotePath=false", *args],
                       cwd=ROOT, capture_output=True, env=ENV)
    if r.returncode != 0:
        raise SystemExit("git 失败: " + r.stderr.decode("utf-8", "replace").strip())
    return r.stdout if binary else r.stdout.decode("utf-8")


def api(method, url, token, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with _OPENER.open(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: " + e.read().decode("utf-8", "replace")[:300])


def get_token():
    """从 GCM 取令牌。实测偶尔返回空，重试若干次。"""
    for i in range(6):
        try:
            r = subprocess.run(["git", "credential", "fill"], cwd=ROOT,
                               input=b"protocol=https\nhost=github.com\n\n",
                               capture_output=True, env=ENV, timeout=60)
            m = re.search(rb"^password=(.+)$", r.stdout, re.M)
            if m and m.group(1).strip():
                return m.group(1).strip().decode()
        except Exception:
            pass
        print(f"  凭据第 {i + 1} 次为空，重试…", file=sys.stderr)
    return None


def iso_date(raw):
    """把 git 的 'Name <email> 1759999999 +0800' 转成 API 要的 ISO 8601。"""
    m = re.match(r"^(.*) <(.*)> (\d+) ([+-])(\d{2})(\d{2})$", raw)
    name, email, ts, sign, hh, mm = m.groups()
    off = datetime.timedelta(hours=int(hh), minutes=int(mm))
    if sign == "-":
        off = -off
    d = datetime.datetime.fromtimestamp(int(ts), datetime.timezone(off))
    return {"name": name, "email": email,
            "date": d.strftime("%Y-%m-%dT%H:%M:%S") + sign + hh + ":" + mm}


def build_tree(commit_sha):
    """平面化的整棵树。

    ★ 内容一律从 **git 对象**读，不能读磁盘 ——
      core.autocrlf=true 时磁盘上是 CRLF、git 里存的是 LF，读磁盘会导致 sha 对不上
      （这个坑实打实踩过：一份 .md 让整棵树 sha 都错位）。
    """
    tree = []
    for line in git("ls-tree", "-r", commit_sha).split("\n"):
        if not line.strip():
            continue
        left, path = line.split("\t")
        mode, type_, sha = left.split()
        if type_ != "blob":
            continue
        raw = git("cat-file", "blob", sha, binary=True)
        try:
            tree.append({"path": path, "mode": mode, "type": "blob",
                         "content": raw.decode("utf-8")})
        except UnicodeDecodeError:
            tree.append({"path": path, "mode": mode, "type": "blob",
                         "content": base64.b64encode(raw).decode(),
                         "encoding": "base64"})
    return tree


def main():
    ap = argparse.ArgumentParser(description="github.com 被拦时的推送兜底通道")
    ap.add_argument("--branch", help="目标分支（默认当前分支）")
    ap.add_argument("--dry-run", action="store_true", help="只列出将推送的提交")
    args = ap.parse_args()

    branch = args.branch or (git("branch", "--show-current").strip() or "main")
    head = git("rev-parse", "HEAD").strip()

    token = get_token()
    if not token:
        raise SystemExit("❌ 取不到 GitHub 凭据（git credential fill 连续 6 次为空）")

    print(f"仓库 : {OWNER}/{REPO}    分支: {branch}    本地 HEAD: {head[:12]}")

    remote_sha = None
    try:
        remote_sha = api("GET", f"{API}/git/ref/heads/{branch}", token)["object"]["sha"]
        print(f"远端 : {remote_sha[:12]}")
    except SystemExit as e:
        if "404" not in str(e):
            raise
        print("远端 : （无此分支 / 空仓库）")

    rng = f"{remote_sha}..{head}" if remote_sha else head
    commits = [c for c in git("rev-list", "--reverse", rng).split("\n") if c.strip()]
    if not commits:
        print("✅ 已是最新，无需推送")
        return
    print(f"待推提交 {len(commits)} 个:")
    for c in commits:
        print(f"   {c[:12]}  {git('log', '-1', '--format=%s', c).strip()}")
    if args.dry_run:
        print("（--dry-run，未写入）")
        return

    parents = [remote_sha] if remote_sha else []
    for c in commits:
        raw = git("cat-file", "commit", c)
        head_part, _, message = raw.partition("\n\n")
        author = iso_date(next(l[7:] for l in head_part.split("\n") if l.startswith("author ")))
        committer = iso_date(next(l[10:] for l in head_part.split("\n") if l.startswith("committer ")))

        tree = api("POST", f"{API}/git/trees", token, {"tree": build_tree(c)})
        cm = api("POST", f"{API}/git/commits", token,
                 {"message": message, "tree": tree["sha"], "parents": parents,
                  "author": author, "committer": committer})
        same = "✅ sha 与本地一致" if cm["sha"] == c else f"❗ sha 不一致（本地 {c[:12]}）"
        print(f"   → {cm['sha'][:12]} {same}")
        parents = [cm["sha"]]

    final = parents[0]
    if remote_sha:
        api("PATCH", f"{API}/git/refs/heads/{branch}", token, {"sha": final, "force": True})
    else:
        api("POST", f"{API}/git/refs", token, {"ref": f"refs/heads/{branch}", "sha": final})
    print(f"✅ {branch} → {final}")

    # sha 既然相同，本地跟踪引用直接对齐即可，不需要 fetch
    git("update-ref", f"refs/remotes/origin/{branch}", final)
    print("本地状态:", git("status", "-sb").split("\n")[0])


if __name__ == "__main__":
    main()
