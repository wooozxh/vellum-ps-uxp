/*
 * lib/handoff.js —— 「取原图」的文件握手（契约 §六）
 * ===========================================================================
 * 权威源：`D:\vellum-link\LINK-CONTRACT.md` §六 / §八。
 *
 * 场景：用户在插件里点某张素材 →「置入到画布」。
 *
 *   插件                                  软件（VellumDesk）
 *    │ ① 写 handoff/req.json（覆盖）        │
 *    ├────────────────────────────────────►│
 *    │                                     │ ② chokidar 监听 → 按 assetId 反查 absPath
 *    │                                     │    拷原图 → handoff/incoming.<ext>
 *    │                                     │    写 handoff/res.json
 *    │ ③ 轮询 handoff/res.json（~300ms）    │
 *    │◄────────────────────────────────────┤
 *    │ ④ reqId 匹配 & ok=true → 读 incoming → 置入
 *
 * ⚠️ 纪律（契约 §六 / §八，缺一条就出事）：
 *   1. **reqId 每次请求都换新**（含时间戳）—— 否则会和上一次的 res 撞车，
 *      把上一张图当成这一张置入。
 *   2. **只按 reqId 认领结果**，res 里的 reqId 对不上就忽略。
 *   3. **插件不删任何文件**（UXP 删自身文件的能力尚未验证）—— 清理一律归软件侧。
 *   4. 超时 **10 秒** → 提示取图失败，允许重试。
 *   5. 本文件是插件**唯一**写镜像目录的地方，且只写 `handoff/req.json` 这一个文件。
 *
 * ⚠️ 一个尚未验证的前提：`handoff/` 目录本该由**软件侧预建**（契约 §六 的规避方案），
 *    因为"插件能否 createFolder"没验过。这里走 `data.writeTextIn(..., {create:true})`
 *    —— 目录在就直接写，不在就**试着建**，并把 created 如实记进日志。
 *    于是这条路径顺带把契约 §六 那个悬着的问题回答了。
 */

const data = require("./data.js");

const MIRROR_DIR = "library";
const HANDOFF_DIR = "handoff";
const REQ_FILE = "req.json";
const RES_FILE = "res.json";
const CONTRACT = "vellum-link/1";
const DEFAULT_TIMEOUT_MS = 10000; // 契约 §六.4
const POLL_MS = 300; // 契约 §六 拓扑图
/* 2026-10-17 由 5000 调到 12000：真机第一个模板 PSD 是 14MB，
   5 秒里既等文件落盘、又要重读 res 补 file 字段 ⇒ 偏紧。
   调大只是「多等一会儿」，不会把失败变成假成功（判据仍是「文件在且读得出字节」）。 */
const FILE_WAIT_MS = 12000;
const FILE_POLL_MS = 250;

function dirParts() {
  return [MIRROR_DIR, HANDOFF_DIR];
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 契约 §五：时间一律 ISO 8601 **带时区**（`toISOString()` 换后缀会差 8 小时，别用）。 */
function isoLocal(d) {
  const dt = d || new Date();
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return (
    dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate()) +
    "T" + pad2(dt.getHours()) + ":" + pad2(dt.getMinutes()) + ":" + pad2(dt.getSeconds()) +
    sign + pad2(Math.floor(a / 60)) + ":" + pad2(a % 60)
  );
}

/** `r-20261010T135609-a1b2`（契约 §六 的样例形状）。 */
function newReqId(d) {
  const dt = d || new Date();
  const ts =
    dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()) +
    "T" + pad2(dt.getHours()) + pad2(dt.getMinutes()) + pad2(dt.getSeconds());
  const rnd = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return "r-" + ts + "-" + rnd;
}

/**
 * 写一条「取这张原图」的请求（覆盖式）。
 * @param {object} asset 契约 §5.4 的 asset
 * @param {string} scope "task" / "brand"
 * @returns {Promise<{ok:boolean, reqId?:string, path?:string, created?:boolean, error?:string}>}
 */
async function request(asset, scope) {
  if (!asset || asset.id === undefined || asset.id === null) {
    return { ok: false, error: "asset 缺少 id，无法请求" };
  }
  const reqId = newReqId();
  const body = {
    contract: CONTRACT,
    reqId: reqId,
    assetId: asset.id,
    scope: scope || "task",
    at: isoLocal(),
  };
  const w = await data.writeTextIn(dirParts(), REQ_FILE, JSON.stringify(body, null, 2) + "\n", {
    create: true,
  });
  if (!w.ok) return { ok: false, reqId: reqId, error: w.error };
  return { ok: true, reqId: reqId, path: w.path || null, created: !!w.created };
}

/** 读 res.json（软件写）。拿不到/解析失败都返回 {ok:false}。 */
async function readRes() {
  const text = await data.readTextIn(dirParts(), RES_FILE, "");
  if (!text || !text.trim()) return { ok: false, empty: true, error: "res.json 还不存在" };
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== "object") return { ok: false, error: "res.json 不是对象" };
    return { ok: true, data: d, reqId: d.reqId, resOk: !!d.ok, file: d.file || null, error: d.error || null };
  } catch (e) {
    return { ok: false, error: "res.json 解析失败：" + ((e && e.message) || e) };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 轮询等「属于本次请求」的结果。
 * ⚠️ 只认 reqId —— 对不上就继续等（那多半是上一次的 res，软件侧还没清）。
 * @returns {Promise<{ok:boolean, data?:object, timedOut?:boolean, lastSeen?:string, error?:string}>}
 */
async function waitForRes(reqId, timeoutMs, intervalMs) {
  const limit = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const step = intervalMs || POLL_MS;
  const t0 = Date.now();
  let lastSeen = "-";
  while (Date.now() - t0 < limit) {
    const r = await readRes();
    if (r.ok) {
      lastSeen = String(r.reqId || "-") + (r.resOk ? "/ok" : "/fail");
      if (r.reqId === reqId) {
        if (r.resOk) return { ok: true, data: r.data };
        return { ok: false, data: r.data, error: r.error || "软件侧返回失败" };
      }
    }
    await sleep(step);
  }
  return { ok: false, timedOut: true, lastSeen: lastSeen, error: "等 " + limit + "ms 没等到匹配的 res（reqId=" + reqId + "）" };
}

/** res.file 形如 "handoff/incoming.png" —— 取文件名（契约 §四：固定名，每次覆盖）。 */
function incomingName(res) {
  const f = res && res.file ? String(res.file) : "";
  const parts = f.split("/").filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return "incoming"; // 兜底：软件侧没给 file 时按契约的固定名前缀找
}

/**
 * 候选文件名（按优先级）。
 *
 * 🔴 **为什么需要"候选"**（2026-10-17 真机抓到）：软件侧**先写 res.json 说"完成"、
 *    后补 `file` 字段并拷文件**。我们可能在中间那一刻就匹配上 reqId，
 *    于是 `res.file` 是空的 ⇒ `incomingName()` 返回不带扩展名的 `incoming`，
 *    而盘上真正叫 `incoming.psd` ⇒ **永远找不到**，读数却是 `bytes=0`，
 *    看起来像"软件侧没拷"，其实是**我们只认一个名字**。
 *    ⇒ 兜底时把常见扩展名都试一遍（顺序固定，先契约里的 `incoming`）。
 */
function incomingCandidates(res) {
  const n = incomingName(res);
  if (n && n !== "incoming") return [n];
  return ["incoming", "incoming.psd", "incoming.jpg", "incoming.png"];
}

/**
 * 取回原图：**Entry + 字节 + 绝对路径**（只读，不搬不删）。
 * 为什么要 Entry 而不只是路径：UXP 把文件交给 `batchPlay` 时，
 * 需要的是从 **Entry 换出来的会话令牌**，字符串路径会被拒
 * （真机实测 `invalid file token used`，见 lib/ps.js placeFile）。
 *
 * 🔴 **为什么这里要"轮询等文件"而不是看一眼就判死**（2026-10-11 真机踩到）：
 *    软件侧很可能「**先写 res.json、后拷文件**」，于是插件看到 res 的那一刻文件还没落盘 ——
 *    真机日志 `handoff incoming ok=false name="incoming.jpg" bytes=0 entry=false
 *    err=文件不存在：incoming.jpg`，而 res.json 里白纸黑字写着 `ok:true, size:627927`。
 *    一眼判死就把"**竞态**"和"**软件根本没拷**"混成了同一个现象。
 *    ⇒ 看到 res 之后再给它一小段时间找文件（默认 5s / 每 250ms 一次）。
 *    契约 §六 已补一条顺序约束：**先落文件、后写 res.json**；这里是不依赖对方守约的容错。
 *
 * @param {object} res   `res.json` 的原始对象
 * @param {object} [opts] `{waitMs, intervalMs}`
 * @returns {Promise<object>} ok / name / entry / path / byteLength / waited / res / error
 */
async function fetchIncoming(res, opts) {
  const o = opts || {};
  const waitMs = typeof o.waitMs === "number" ? o.waitMs : FILE_WAIT_MS;
  const step = o.intervalMs || FILE_POLL_MS;
  let name = incomingName(res);
  let cur = res;
  const t0 = Date.now();

  let entry = null;
  let bin = { ok: false, error: "未尝试" };
  for (;;) {
    /* ① 软件侧可能"先写完成、后补 file" ⇒ 边等边重读 res.json，把 file 补上 */
    if (!cur || !cur.file) {
      const txt = await data.readTextIn(dirParts(), RES_FILE, "");
      if (txt) {
        try {
          const r2 = JSON.parse(txt);
          if (r2 && r2.file) {
            cur = r2;
            name = incomingName(r2);
          }
        } catch {
          /* 正在写、解析不了：下一轮再来 */
        }
      }
    }
    /* ② 按候选名找（file 缺失时 `incoming` / `incoming.psd` / … 都试） */
    const cands = [name].concat(incomingCandidates(cur).filter((x) => x !== name));
    for (const cn of cands) {
      entry = await data.entryIn(dirParts(), cn);
      if (entry) {
        bin = await data.readBinaryIn(dirParts(), cn);
        if (bin.ok) {
          name = cn; // 用**真正存在的那个名字**回报，别继续报猜的那个
          break;
        }
      }
    }
    if (bin.ok) break;
    if (Date.now() - t0 >= waitMs) break;
    await sleep(step);
  }
  const waited = Date.now() - t0;
  const ok = !!entry && !!bin.ok;

  // 失败为什么要带上 res 里的读数：这句话要能**区分**两种完全不同的原因 ——
  //   · res 说 ok:true 但文件不在 ⇒ **软件侧没拷成 / 拷晚了**（对方的问题）
  //   · res 说 ok:false ⇒ 软件侧明确报错，看它的 error（原文带出来）
  const resInfo = cur
    ? {
        file: cur.file === undefined ? null : cur.file,
        ok: !!cur.ok,
        size: cur.size === undefined || cur.size === null ? null : cur.size,
        at: cur.at || null,
        error: cur.error === undefined ? null : cur.error,
      }
    : null;

  let error = null;
  if (!ok) {
    if (!entry) {
      error = "handoff/" + name + " 不存在（等了 " + waited + "ms）";
    } else {
      error = "文件在，但读不出字节（" + (bin.error || "未知") + "）";
    }
  }

  return {
    ok: ok,
    name: name,
    entry: entry || null,
    path: entry ? entry.nativePath || null : null,
    byteLength: bin.ok ? bin.byteLength : 0,
    waited: waited,
    res: resInfo,
    error: error,
  };
}

/** 目录现状（排障/UI 提示用）。只读，不建目录。 */
async function state() {
  const folder = await data.subfolder(dirParts(), false);
  const reqText = await data.readTextIn(dirParts(), REQ_FILE, "");
  const resText = await data.readTextIn(dirParts(), RES_FILE, "");
  return {
    dir: dirParts().join("/"),
    dirExists: !!folder,
    hasReq: !!reqText,
    hasRes: !!resText,
  };
}

module.exports = {
  CONTRACT,
  MIRROR_DIR,
  HANDOFF_DIR,
  REQ_FILE,
  RES_FILE,
  DEFAULT_TIMEOUT_MS,
  POLL_MS,
  FILE_WAIT_MS,
  FILE_POLL_MS,
  dirParts,
  isoLocal,
  newReqId,
  request,
  readRes,
  waitForRes,
  incomingName,
  fetchIncoming,
  state,
};
