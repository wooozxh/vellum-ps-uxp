# -*- coding: utf-8 -*-
"""插件手册 · 一致性体检（tools/manual/check.py）

对齐软件侧 tools/manual/check.cjs 的思路：用机器兜住"能自动判对错"的那些事，
免得软件/插件更新后手册悄悄对不上，而眼睛看不出来。

体检六项：
  ① 版本号   —— 手册封面标明的插件版本 vs vellum-toolbox/manifest.json 的 version
  ② 目录对账 —— 目录里每条链接都点得动；正文每个小节都进得了目录
  ③ 图片     —— 正文引用的图都在磁盘上；哪些图白拍了
  ④ 标签配对 —— HTML 结构没被手改坏
  ⑤ 类名白名单 —— 正文用的 class 都在 manual.css 里定义过（防打错类名 → 静默丢样式）
  ⑥ 产物新鲜度 —— 单文件版 / PDF 是不是比 index.html 旧（旧了就是忘了重新生成）

用法：python tools/manual/check.py     退出码 0 = 没问题，1 = 有必须处理的项。
**只读**。它不改手册、不改代码，只报告。
"""
import json
import os
import re
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MAN = os.path.join(ROOT, "docs", "manual")
INDEX = os.path.join(MAN, "index.html")
CSS = os.path.join(MAN, "manual.css")
IMGDIR = os.path.join(MAN, "images")
SINGLE = os.path.join(MAN, "Vellum工具箱-插件使用手册（单文件）.html")
PDF = os.path.join(MAN, "Vellum工具箱-插件使用手册.pdf")
MANIFEST = os.path.join(ROOT, "vellum-toolbox", "manifest.json")

problems, warns = [], []


def head(n, t):
    print("\n" + n + " " + t + "\n" + "-" * 58)


def ok(m):
    print("  [OK]  " + m)


def bad(m):
    problems.append(m)
    print("  [!!]  " + m)


def warn(m):
    warns.append(m)
    print("  [~~]  " + m)


def info(m):
    print("  [--]  " + m)


if not os.path.exists(INDEX):
    print("找不到手册：" + INDEX)
    sys.exit(1)

html = open(INDEX, "r", encoding="utf-8").read()
css = open(CSS, "r", encoding="utf-8").read()
# 🔴 目录/类名这些分析必须**先摘掉 <script>** —— 否则脚本里的模板字符串
#    （`'<a href="#' + x.id + '">'`）会被当成真的目录项和类名（第一版就中了这个招）
html_wo_js = re.sub(r"<script[\s\S]*?</script>", "", html)

# ---------------------------------------------------------------- ① 版本号
head("①", "版本号一致")
manifest = json.load(open(MANIFEST, "r", encoding="utf-8"))
ver = str(manifest.get("version", ""))
tag = re.search(r'class="tag">([^<]+)<', html)
kv = re.findall(r"<div><b>([^<]+)</b>插件版本</div>", html)
if not tag or not kv:
    bad("封面找不到 PLUGIN MANUAL 标签或「插件版本」kv 项")
else:
    t_ver = tag.group(1).split("·")[-1].strip().lstrip("v")
    k_ver = kv[0].strip()
    if t_ver == ver == k_ver:
        ok("封面标签 %s ＝ kv %s ＝ manifest.json %s" % (t_ver, k_ver, ver))
    else:
        bad("版本对不上：封面标签=%s　kv=%s　manifest=%s" % (t_ver, k_ver, ver))

# ---------------------------------------------------------------- ② 目录对账
head("②", "目录对账")
sec_ids = re.findall(r'<section[^>]*\sid="([^"]+)"', html_wo_js)
ch_ids = re.findall(r'<div class="chapterhead"[^>]*\sid="([^"]+)"', html_wo_js)
nav_ids = set(re.findall(r'<nav class="topnav">([\s\S]*?)</nav>', html_wo_js) and
              re.findall(r'href="#([^"]+)"', re.search(r'<nav class="topnav">([\s\S]*?)</nav>', html_wo_js).group(1)))
body_ids = set(sec_ids) | set(ch_ids)
toc_ids = set(re.findall(r'<a href="#([^"]+)"><b>', html_wo_js))
dead = sorted(toc_ids - body_ids)
# 目录页按惯例只列**小节**；章头由顶栏导航负责（样式样板：'新增小节必须同时加进目录页'）
missing = sorted(i for i in sec_ids if i not in toc_ids)
dead_nav = sorted(nav_ids - body_ids)
if dead:
    bad("目录里有 %d 条点了没反应：%s" % (len(dead), ", ".join(dead)))
else:
    ok("目录 %d 条链接全部命中正文" % len(toc_ids))
if missing:
    bad("这些小节没进目录：%s" % ", ".join(missing))
else:
    ok("正文 %d 个小节全部进了目录" % len(sec_ids))
if dead_nav:
    bad("顶栏导航里有 %d 条点了没反应：%s" % (len(dead_nav), ", ".join(dead_nav)))
else:
    ok("顶栏 %d 条导航全部命中章节" % len(nav_ids))

# ---------------------------------------------------------------- ③ 图片
head("③", "图片")
refs = re.findall(r'src="(images/[^"]+)"', html)
miss = [r for r in sorted(set(refs)) if not os.path.exists(os.path.join(MAN, r.replace("/", os.sep)))]
if miss:
    bad("引用了不存在的图：%s" % ", ".join(miss))
else:
    ok("正文引用 %d 张图，全部在磁盘上" % len(set(refs)))
on_disk = set(os.listdir(IMGDIR)) if os.path.isdir(IMGDIR) else set()
used = {os.path.basename(r) for r in refs}
idle = sorted(on_disk - used)
if idle:
    warn("images/ 里有 %d 张没被引用：%s" % (len(idle), ", ".join(idle)))
else:
    ok("images/ 里的图都在用")

# ---------------------------------------------------------------- ④ 标签配对
head("④", "标签配对")
VOID = {"img", "br", "hr", "meta", "link", "input", "source", "path", "rect",
        "circle", "text", "line", "polygon", "use", "stop"}
stack, broken = [], []
for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>", html_wo_js):
    close, name, attrs, self_close = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
    if name in VOID or self_close:
        continue
    if not close:
        stack.append(name)
    else:
        if not stack:
            broken.append("多余的 </%s>" % name)
        elif stack[-1] != name:
            broken.append("</%s> 对不上（栈顶是 <%s>）" % (name, stack[-1]))
            while stack and stack[-1] != name:
                stack.pop()
            if stack:
                stack.pop()
        else:
            stack.pop()
if broken:
    bad("标签配对有问题：%s" % "；".join(broken[:5]))
elif stack:
    bad("有 %d 个标签没闭合：%s" % (len(stack), ", ".join(stack[:5])))
else:
    ok("标签全部配对闭合")

# ---------------------------------------------------------------- ⑤ 类名白名单
head("⑤", "类名白名单")
css_classes = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))
used_classes = set()
for m in re.finditer(r'class="([^"]+)"', html_wo_js):
    for c in m.group(1).split():
        used_classes.add(c)
unknown = sorted(used_classes - css_classes)
if unknown:
    bad("这些 class 在 manual.css 里没有定义（会静默丢样式）：%s" % ", ".join(unknown))
else:
    ok("正文用到 %d 个 class，全部有定义" % len(used_classes))

# ---------------------------------------------------------------- ⑥ 产物新鲜度
head("⑥", "产物新鲜度")
src_t = os.path.getmtime(INDEX)
for p, label in ((SINGLE, "单文件版"), (PDF, "PDF")):
    if not os.path.exists(p):
        warn("还没生成：%s（%s）" % (label, os.path.basename(p)))
    elif os.path.getmtime(p) < src_t:
        bad("%s 比 index.html 旧 —— 改了手册要重新生成" % label)
    else:
        ok("%s 比 index.html 新" % label)

print("\n" + "=" * 58)
if problems:
    print("结果：%d 项必须处理，%d 项提醒" % (len(problems), len(warns)))
    sys.exit(1)
print("结果：全部通过（%d 项提醒）" % len(warns))
sys.exit(0)
