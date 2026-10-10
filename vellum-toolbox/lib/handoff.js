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
 * 取回原图：**Entry + 字节 + 绝对路径**（只读，不搬不删）。
 * 为什么要 Entry 而不只是路径：UXP 把文件交给 `batchPlay` 时，
 * 需要的是从 **Entry 换出来的会话令牌**，字符串路径会被拒
 * （真机实测 `invalid file token used`，见 lib/ps.js placeFile）。
 */
async function fetchIncoming(res) {
  const name = incomingName(res);
  const entry = await data.entryIn(dirParts(), name);
  const bin = await data.readBinaryIn(dirParts(), name);
  const ok = !!entry && !!bin.ok;
  return {
    ok: ok,
    name: name,
    entry: entry || null,
    path: entry ? entry.nativePath || null : null,
    byteLength: bin.ok ? bin.byteLength : 0,
    error: bin.ok
      ? (entry ? null : "文件在，但拿不到 Entry（置入必须用 Entry 换会话令牌）")
      : bin.error,
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
