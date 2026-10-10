/*
 * lib/mirror.js —— 镜像读取层（M2 素材库）
 * ===========================================================================
 * 契约唯一权威源：`D:\vellum-link\LINK-CONTRACT.md`（版本 `vellum-link/1`）。
 * **本文件只读镜像，绝不写镜像内容** —— 契约 §八「写者唯一性」：
 *   manifest.json / task.json / brand.json / thumb/** 的写者**只有软件侧**；
 *   插件唯一可写的是 `handoff/req.json`。
 *
 * 契约要点（实现时的硬约束，都踩过）：
 *   1. 先校验 `manifest.contract === "vellum-link/1"`；**不认识就降级提示，不崩、不猜**。
 *   2. 轮询**只 stat/读 `manifest.json`**，比对 `scopes[].revision`，变了才重读对应 `file`。
 *   3. 缩略图**必须 png/jpg** —— **UXP 的 `<img>` 不解码 webp**（自检 S19 实测）。
 *      读到 `.webp` 直接给可读错误，别让 UI 出现一堆空白格。
 *   4. 缩略图渲染走 `ArrayBuffer → Blob → URL.createObjectURL`；
 *      ⚠️ 承载它的 DOM **必须可见**（`display:none` 里 UXP 不加载图片，表现为"超时"）。
 *   5. 加法兼容：软件侧新增字段时插件**必须忽略不认识的字段**，不大惊小怪。
 */

const data = require("./data.js");

/** 契约常量（契约 §四）—— 两侧都该定义成常量，不要散落字符串。 */
const CONTRACT = "vellum-link/1";
const MIRROR_DIR = ["library"]; // MIRROR_DIR
const MANIFEST_FILE = "manifest.json";
const THUMB_DIR = "thumb";
const POLL_MS = 3000; // 契约 §一：每 ~3 秒对一次清单

/* ---------- 读 ---------- */

/**
 * 读总索引 `manifest.json`。
 * @returns {Promise<{ok:boolean, manifest?:object, scopes?:array, error?:string,
 *                    empty?:boolean, unsupported?:boolean}>}
 */
async function readManifest() {
  const text = await data.readTextIn(MIRROR_DIR, MANIFEST_FILE, "");
  if (!text || !text.trim()) {
    return { ok: false, empty: true, error: "镜像不存在或为空（VellumDesk 还没生成过？）" };
  }
  let m = null;
  try {
    m = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "manifest.json 解析失败：" + ((e && e.message) || e) };
  }
  if (!m || typeof m !== "object") return { ok: false, error: "manifest.json 不是对象" };
  if (m.contract !== CONTRACT) {
    return {
      ok: false,
      unsupported: true,
      got: m.contract || null,
      error: "镜像版本不受支持（期望 " + CONTRACT + "，实际 " + (m.contract || "缺失") + "）—— 请更新插件",
    };
  }
  return {
    ok: true,
    manifest: m,
    scopes: Array.isArray(m.scopes) ? m.scopes : [],
    workspaceRoot: m.workspaceRoot || "",
    psMajor: m.psMajor || null,
    generatedAt: m.generatedAt || "",
  };
}

/** 读某个 scope 的明细（`task.json` / `brand.json` …）。 */
async function readScope(scope) {
  const file = scope && scope.file;
  if (!file) return { ok: false, error: "scope 缺少 file 字段" };
  const text = await data.readTextIn(MIRROR_DIR, file, "");
  if (!text || !text.trim()) return { ok: false, file, error: file + " 为空" };
  let d = null;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { ok: false, file, error: file + " 解析失败：" + ((e && e.message) || e) };
  }
  if (!d || d.contract !== CONTRACT) {
    return { ok: false, file, error: file + " 的 contract 与总索引不一致" };
  }
  return { ok: true, file, data: d, revision: d.revision };
}

/* ---------- 展平（树 → 素材列表 + 面包屑） ---------- */

/** 任务库：projects → packs → versions → assets。 */
function flattenTask(d) {
  const out = [];
  for (const p of d.projects || []) {
    for (const k of p.packs || []) {
      const verById = {};
      for (const v of k.versions || []) verById[v.id] = v;
      for (const a of k.assets || []) {
        const v = verById[a.versionId];
        out.push({
          asset: a,
          scope: "task",
          group: p.name || "",
          crumb: [p.name, k.name, v ? v.folderName || "" : ""].filter(Boolean),
          versionLabel: v ? v.folderName || "" : "",
          isCurrent: v ? !!v.isCurrent : true,
        });
      }
    }
  }
  return out;
}

/** 通用库：groups → assets。 */
function flattenBrand(d) {
  const out = [];
  for (const g of d.groups || []) {
    for (const a of g.assets || []) {
      out.push({
        asset: a,
        scope: "brand",
        group: g.name || "",
        crumb: [g.name].filter(Boolean),
        versionLabel: "",
        isCurrent: true,
      });
    }
  }
  return out;
}

/** 按 scope id 展平。 */
function flatten(scopeId, d) {
  if (scopeId === "brand") return flattenBrand(d);
  return flattenTask(d);
}

/* ---------- 缩略图 ---------- */

let cachedRev = null;
const thumbCache = new Map(); // assetId → objectURL

/** 换 revision 时把上一轮的 objectURL 全部释放（防泄漏）。 */
function clearThumbs() {
  if (typeof URL !== "undefined" && URL.revokeObjectURL) {
    for (const u of thumbCache.values()) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* 忽略 */
      }
    }
  }
  thumbCache.clear();
  cachedRev = null;
}

function extOf(file) {
  const s = String(file || "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i + 1).toLowerCase() : "";
}

/**
 * 取缩略图的可显示 URL（objectURL）。
 * ⚠️ 调用方必须把 `<img>` 放进**可见**容器，否则 UXP 不加载（表现为超时）。
 * @param {object} asset 契约 §5.4 的 asset
 * @param {number} [revision] 该 scope 的 revision（变了就清缓存）
 */
async function thumbUrl(asset, revision) {
  if (!asset || !asset.thumb) {
    return { ok: false, noThumb: true, error: "该素材没有缩略图" };
  }
  if (revision !== undefined && revision !== cachedRev) {
    clearThumbs();
    cachedRev = revision;
  }
  const key = String(asset.id);
  if (thumbCache.has(key)) return { ok: true, url: thumbCache.get(key), cached: true };

  const parts = String(asset.thumb).split("/").filter(Boolean); // "thumb/401.png"
  if (parts.length < 2) return { ok: false, error: "thumb 路径不合法：" + asset.thumb };
  const dir = MIRROR_DIR.concat(parts.slice(0, -1));
  const file = parts[parts.length - 1];

  const ext = extOf(file);
  if (ext === "webp") {
    return {
      ok: false,
      webp: true,
      error: "缩略图是 webp，UXP 不解码 —— 请让软件侧按契约 §5.5 转成 png/jpg",
    };
  }
  if (typeof Blob !== "function" || typeof URL === "undefined" || !URL.createObjectURL) {
    return { ok: false, error: "Blob / URL.createObjectURL 不可用" };
  }

  const bin = await data.readBinaryIn(dir, file);
  if (!bin.ok) return { ok: false, error: bin.error };

  const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
  const url = URL.createObjectURL(new Blob([bin.buffer], { type: mime }));
  thumbCache.set(key, url);
  return { ok: true, url, cached: false, bytes: bin.byteLength };
}

/* ---------- 插入分派（docs/10 §10.7） ---------- */

/**
 * 这个素材点「插入」时会怎么处理。
 * @returns {{supported:boolean, how:string, note:string}}
 */
function insertPlan(asset) {
  const kind = String((asset && asset.kind) || "").toLowerCase();
  const ext = extOf(asset && asset.name) || String((asset && asset.ext) || "").toLowerCase();
  if (kind === "video") {
    return { supported: false, how: "none", note: "PS 置入不了视频 —— 首版不支持直接插入" };
  }
  if (kind === "psd" || ext === "psd" || ext === "psb") {
    return { supported: true, how: "smartObject", note: "置入为智能对象（可双击回改）" };
  }
  if (kind === "image" || ["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp"].indexOf(ext) >= 0) {
    return { supported: true, how: "layer", note: "置入为新图层" };
  }
  if (kind === "pdf" || ext === "pdf") {
    return { supported: false, how: "none", note: "PDF 能否置入尚未实测 —— 首版提示不支持" };
  }
  return { supported: false, how: "none", note: "未知类型，首版不支持" };
}

/* ---------- 轮询 ---------- */

/**
 * 每 POLL_MS 读一次 manifest，比对 scopes 的 revision 签名，变了就回调。
 * @param {(manifest:object, isFirst:boolean)=>void} onChange
 * @returns {{stop:()=>void}}
 */
function watch(onChange) {
  let lastSig = null;
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const m = await readManifest();
      if (m.ok) {
        const revs = {};
        for (const s of m.scopes) revs[s.id] = s.revision;
        const sig = JSON.stringify(revs);
        if (sig !== lastSig) {
          const isFirst = lastSig === null;
          lastSig = sig;
          try {
            onChange(m, isFirst);
          } catch {
            /* 回调异常不该打断轮询 */
          }
        }
      }
    } catch {
      /* 读失败不打断轮询 */
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  }

  tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = {
  CONTRACT,
  MIRROR_DIR,
  MANIFEST_FILE,
  THUMB_DIR,
  POLL_MS,
  readManifest,
  readScope,
  flatten,
  flattenTask,
  flattenBrand,
  thumbUrl,
  clearThumbs,
  insertPlan,
  watch,
};
