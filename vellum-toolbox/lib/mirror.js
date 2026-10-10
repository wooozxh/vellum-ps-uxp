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
 *
 * ── v0.2.8：软件侧按契约 §十 提的三处加法（2026-10-10，不升契约版本）
 *   ① 缩略图命名加**命名空间**（任务 `t<id>` / 通用 `b<id>`）—— 对插件**透明**
 *      （`asset.thumb` 本就是"镜像内相对路径"，本文件按字符串取图、**从不解析文件名**）。
 *      ⚠️ 但它暴露了**本文件自己的一个真实缺陷**：缩略图缓存键原来用 `asset.id`，
 *         而两库 id **各自从 1 起** ⇒ 跨库同名会串图（见 §缩略图处的长注释）。
 *      ⇒ 已改为按 **`asset.thumb`**（自带命名空间）做键。
 *   ② §5.4 可选 `asset.source`（`company` | `user`）—— 用于**跨分组筛「我的」**，本文件透传。
 *   ③ §5.3 可选 `groups[].parentId` —— 通用库**两级分组**，本文件在展平时解析成
 *      `group`（顶层名）/ `sub`（子组名），并给出 `groupTree()` 供 UI 与自检复用。
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

/** 契约 §5.3：分组按 `sortOrder` 排（缺失时按 id）—— chips 的顺序要稳定。 */
function sortByOrder(arr) {
  return (arr || []).slice().sort((a, b) => {
    const num = (x) => (x === undefined || x === null || x === "" ? null : Number(x));
    const ao = num(a && a.sortOrder);
    const bo = num(b && b.sortOrder);
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    return Number((a && a.id) || 0) - Number((b && b.id) || 0);
  });
}

/** 任务库：projects → packs → versions → assets。 */
function flattenTask(d) {
  const out = [];
  for (const p of sortByOrder(d.projects)) {
    for (const k of p.packs || []) {
      const verById = {};
      for (const v of k.versions || []) verById[v.id] = v;
      for (const a of k.assets || []) {
        const v = verById[a.versionId];
        out.push({
          asset: a,
          scope: "task",
          group: p.name || "",
          sub: "", // 任务库只有一层（父组 = 项目）；两级分组是通用库的（契约 §5.3）
          groupPath: [p.name].filter(Boolean),
          crumb: [p.name, k.name, v ? v.folderName || "" : ""].filter(Boolean),
          versionLabel: v ? v.folderName || "" : "",
          isCurrent: v ? !!v.isCurrent : true,
        });
      }
    }
  }
  return out;
}

/**
 * 通用库：groups（可两层）→ assets。
 *
 * 契约 §5.3（软件侧 2026-10-10 加法 ③）：分组支持**两层**，子组用 `parentId` 指父组；
 * **顶层组省略或 `null`**。本函数的容错规则都是"宁可当顶层，也**绝不丢素材**"：
 *   · `parentId` 缺失 / `null` / 空串 → 顶层；
 *   · `parentId` 指向一个**不存在的分组**（父组被删 / id 写错）→ 当顶层；
 *   · 三层以上 / 成环 → 由结尾的兜底循环按顶层吐出。
 * 另外按 `sortOrder` 排序，并保证**父组在前、它的子组紧随其后**（否则网格里的顺序会是乱的）。
 */
function flattenBrand(d) {
  const groups = sortByOrder(d.groups);
  const byId = {};
  for (const g of groups) byId[String(g.id)] = g;

  /** 归一化后的父组 id；认不到就返回 null（= 当顶层）。 */
  const pidOf = (g) => {
    const raw = g.parentId;
    if (raw === undefined || raw === null || raw === "") return null;
    const s = String(raw);
    return byId[s] ? s : null;
  };

  const tops = groups.filter((g) => pidOf(g) === null);
  const kidsOf = {};
  for (const g of groups) {
    const p = pidOf(g);
    if (p) (kidsOf[p] = kidsOf[p] || []).push(g);
  }

  const out = [];
  const pushed = {};
  const push = (g, topName, subName) => {
    pushed[String(g.id)] = true;
    for (const a of g.assets || []) {
      out.push({
        asset: a,
        scope: "brand",
        group: topName || "",
        sub: subName || "",
        groupPath: [topName, subName].filter(Boolean),
        crumb: [topName, subName].filter(Boolean),
        versionLabel: "",
        isCurrent: true,
      });
    }
  };

  for (const t of tops) {
    const tn = t.name || "";
    push(t, tn, "");
    for (const k of kidsOf[String(t.id)] || []) push(k, tn, k.name || "");
  }
  // 兜底：没能归位的分组（三层以上 / 环）一律当顶层吐出 —— 丢素材比顺序难看严重得多
  for (const g of groups) if (!pushed[String(g.id)]) push(g, g.name || "", "");

  return out;
}

/**
 * 这个 scope 的**形态** —— 用来决定界面怎么排（不是靠 scope id 硬编码）。
 * 契约 §5.2 的 `task.json` 有 `projects`；§5.3 的 `brand.json` 有 `groups`。
 * 认不出来就返回 `"unknown"`，界面按"没有二级结构"处理（宁少不崩）。
 */
function scopeKind(data) {
  const d = data || {};
  if (Array.isArray(d.projects)) return "task";
  if (Array.isArray(d.groups)) return "brand";
  return "unknown";
}

/** 按 scope id 展平。 */
function flatten(scopeId, d) {
  return scopeId === "brand" ? flattenBrand(d) : flattenTask(d);
}

/* ---------- 分组树（给筛选行 / 自检用） ---------- */

/**
 * 由**扁平条目**推两级分组树（契约 §5.3 `groups[].parentId`）。
 *
 * 顺序 = 条目里首次出现的顺序 —— 展平时已按 `sortOrder` 排过，这里**不重排**，
 * 免得两处各有各的排序规则、将来对不上。
 * ⚠️ `count` 是**含子组**的总数：父组的计数要能对上"点父组后网格里的卡片数"。
 *
 * @param {Array} items flatten() 的输出
 * @returns {Array<{name:string, count:number, children:Array<{name:string,count:number}>}>}
 */
function groupTree(items) {
  const order = [];
  const map = {};
  for (const it of items || []) {
    const g = (it && it.group) || "未分组";
    if (!map[g]) {
      map[g] = { name: g, count: 0, children: [], _kids: {} };
      order.push(g);
    }
    const node = map[g];
    node.count++;
    const s = (it && it.sub) || "";
    if (s) {
      if (!node._kids[s]) {
        node._kids[s] = { name: s, count: 0 };
        node.children.push(node._kids[s]);
      }
      node._kids[s].count++;
    }
  }
  return order.map((g) => {
    const n = map[g];
    return {
      name: n.name,
      count: n.count,
      children: n.children.map((c) => ({ name: c.name, count: c.count })),
    };
  });
}

/* ---------- 来源（契约 §5.4 可选 asset.source） ---------- */

const SOURCE_LABELS = { company: "公司", user: "我的" };
const SOURCE_ORDER = ["company", "user"];

/**
 * 当前条目里出现过的来源（契约 §5.4 加法 ②，**可选字段**：老镜像没有就是空数组）。
 * 顺序固定为 company → user → 其它，免得同一份数据两次渲染出不同顺序。
 * ⚠️ 调用方自己要判断"值不值得显示" —— 只有 1 种来源时它不构成筛选，画出来是噪音。
 * @returns {Array<{value:string, label:string, count:number}>}
 */
function sourceSummary(items) {
  const map = {};
  const rest = [];
  for (const it of items || []) {
    const v = it && it.asset ? it.asset.source : null;
    if (!v) continue;
    const key = String(v);
    if (!map[key]) {
      map[key] = { value: key, label: SOURCE_LABELS[key] || key, count: 0 };
      if (SOURCE_ORDER.indexOf(key) < 0) rest.push(key);
    }
    map[key].count++;
  }
  const out = [];
  for (const k of SOURCE_ORDER) if (map[k]) out.push(map[k]);
  for (const k of rest) out.push(map[k]);
  return out;
}

/** 来源的中文标签（详情行用；未收录的值**原样返回**，不猜）。 */
function sourceLabel(v) {
  return v ? SOURCE_LABELS[String(v)] || String(v) : "";
}

/* ---------- 缩略图 ---------- */

let cachedRev = null;
const thumbCache = new Map(); // asset.thumb（镜像内相对路径）→ objectURL

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
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ 缓存键为什么是 `asset.thumb` 而不是 `asset.id`（v0.2.8 修的真实缺陷）
 * ════════════════════════════════════════════════════════════════════════
 * `task.json` 与 `brand.json` 的 `asset.id` **各自从 1 起**（软件侧 2026-10-10
 * 专门为这件事加了缩略图命名空间 `t<id>` / `b<id>`）。原来键用 `asset.id` ⇒
 * 两库的 #1 是**同一个键**。当时只靠"revision 变了就 clearThumbs()"兜着 ——
 * 可**两个库的 revision 完全可能相等**（最典型：首次同步后 task rev=1、brand rev=1），
 * 那时不会清缓存，于是**切库后网格里显示的是上一个库的图**（不报错、只是图不对）。
 *
 * `asset.thumb` 本身就带命名空间（`thumb/t401.png` / `thumb/b1.png`），
 * **它才是唯一标识** —— 用它做键，跨库串图这件事从根上不成立。
 * `clearThumbs()` 仍然保留（换 revision 时释放旧 objectURL，防泄漏）。
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
  const key = String(asset.thumb);
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
  scopeKind,
  groupTree,
  sourceSummary,
  sourceLabel,
  thumbUrl,
  clearThumbs,
  insertPlan,
  watch,
};
