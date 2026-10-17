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
 *   ③ §5.3 可选 `groups[].parentId` —— 通用库分组，本文件在展平时解析成
 *      `group`（顶层名）/ `sub`（第 2 层名）/ **`groupPath`（完整路径数组）**，
 *      并给出 `groupTree()` 供 UI 与自检复用。
 *
 * ── v0.9.6（2026-10-17）：**分组层数 2 → 5**（契约 §5.3 放宽；见 D:/vellum-link/）
 *   背景：用户与软件侧达成共识，**模板库与通用素材库都要做多层目录**。
 *   本次改动**只动数据层**（展平能读任意层），**不动 UI** —— 现有 chips 界面在多层数据下
 *   表现为"第 3 层及更深的素材并入第 2 层显示"（**不丢素材、不错乱，但不能单独筛深一层**）。
 *   ★ **对现有两层数据，输出与改动前逐字段一致** —— 这一点有离线断言钉死（`M5-29`）。
 *   ⚠️ `group` / `sub` 两个字段**保留**，语义不变（`path[0]` / `path[1]`）⇒ 旧 UI 一行不用改。
 */

const data = require("./data.js");

/** 契约常量（契约 §四）—— 两侧都该定义成常量，不要散落字符串。 */
const CONTRACT = "vellum-link/1";
const MIRROR_DIR = ["library"]; // MIRROR_DIR
const MANIFEST_FILE = "manifest.json";
const THUMB_DIR = "thumb";
const POLL_MS = 3000; // 契约 §一：每 ~3 秒对一次清单

/**
 * 分组层数上限（**含顶层**）。
 *
 * 契约 §5.3 原本写「两层封顶」；2026-10-17 两侧共识放宽到 **5**（模板库 + 通用素材库都要做多层目录）。
 * ⚠️ 这个常量是**上限**不是"期望值"：两层数据照样正常工作，行为与放宽前**逐字段一致**。
 * ⚠️ 它同时是**安全网**的一部分：超过它的子树会被当顶层吐出（**素材一条不丢**），
 *    用来兜住成环 / 脏数据 / 别人违规产出深层。**别为了"支持更多层"随手调大** ——
 *    调大要同步改契约 §5.3 与两侧的 DECISIONS。
 */
const MAX_DEPTH = 5;

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

/**
 * 素材库页**该显示哪些库**。
 *
 * 🔴 模板库（`tpl`）**不在这里**：它有自己的单列入口（用户 2026-10-17 拍板
 * 「PSD 模板入口单列、不与素材库同入口」）。软件侧一旦在 `manifest.scopes` 里写出
 * `tpl`，素材库页就会**自动多一个空 tab**（tabs 本就由 scopes 动态生成）——
 * 那不是"功能上线了"，是"多了一个看起来坏掉的 tab"。
 *
 * ⚠️ 过滤规则只在这里写一份：**自检 S20 用同一个函数算期望值**。
 *    否则"按 scopes 数 tab"会在软件侧一写 tpl 就变红 —— 那种红是假警报，会把真问题淹掉。
 * ⚠️ 新增 scope 属契约「加法」，不升版本；但**要不要显示在素材库**是插件侧的决定。
 */
const LIBRARY_EXCLUDED = { tpl: true };

function libraryScopes(scopes) {
  return (scopes || []).filter((s) => s && !LIBRARY_EXCLUDED[String(s.id)]);
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
 * 通用库：groups（**任意层，上限 MAX_DEPTH**）→ assets。
 *
 * 契约 §5.3：分组用 `parentId` 指父组，**顶层组省略或 `null`**。
 * 本函数的容错规则一律是「**宁可降级，也绝不丢素材**」：
 *   · `parentId` 缺失 / `null` / 空串 → 顶层；
 *   · `parentId` 指向一个**不存在的分组**（父组被删 / id 写错）→ 当顶层；
 *   · **成环**（A 父 B、B 父 A）→ 当顶层（`pushed` 集合保证每组建只出一次，且不会无限递归）；
 *   · **超过 `MAX_DEPTH` 层** → 超出的那棵子树**当顶层吐出**（素材一条不丢）。
 *
 * 展平结果里的三个层级字段（**都保留，别删**）：
 *   · `group`  = `path[0]`（顶层名）—— 旧 chips UI 用
 *   · `sub`    = `path[1]`（第 2 层名）—— 旧 chips UI 用
 *   · `groupPath` = **完整路径数组**（任意层）—— 新 UI（面包屑下钻）用
 *   ⇒ 这样**数据层先升级、UI 可以晚一步**，二者不是同一次发版。
 *
 * 顺序：`sortOrder` 排过的序，**父组在前、它的子树紧随其后**（否则网格里顺序是乱的）。
 */
function flattenBrand(d) {
  const groups = sortByOrder(d.groups);
  const byId = {};
  for (const g of groups) byId[String(g.id)] = g;

  /** 归一化后的父组 id；认不到就返回 null（= 当顶层）。 */
  const pidOf = (g) => {
    const raw = g && g.parentId;
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

  const emit = (g, path) => {
    for (const a of g.assets || []) {
      out.push({
        asset: a,
        scope: "brand",
        group: path[0] || "",
        sub: path[1] || "",
        groupPath: path.slice(),
        crumb: path.slice(),
        depth: path.length,
        versionLabel: "",
        isCurrent: true,
      });
    }
  };

  /**
   * 从 `g` 往下走。
   * ⚠️ `pushed` 是**防环 + 防重复**的唯一保障：成环时 A→B→A 会在第二次遇到 A 时直接返回，
   *    不会爆栈、也不会把同一个组吐两遍。
   */
  const walk = (g, ancestors, depth) => {
    const id = String(g.id);
    if (pushed[id]) return;
    pushed[id] = true;
    const path = ancestors.concat([g.name || ""]);
    emit(g, path);
    if (depth >= MAX_DEPTH) return; // 到顶就不往下；它的后代交给兜底循环当顶层吐出
    for (const k of kidsOf[id] || []) walk(k, path, depth + 1);
  };

  for (const t of tops) walk(t, [], 1);

  /* 兜底：没被走到的（成环 / 超深子树）一律当顶层吐出 —— **丢素材比顺序难看严重得多**。
     用循环是因为"当顶层"之后又可能走出一棵新树，里面仍有没走到的（例如 7 层的链）。
     `guard` 只是防呆（正常情况下 1~2 轮就稳定）。 */
  let guard = 0;
  let changed = true;
  while (changed && guard++ <= groups.length + 2) {
    changed = false;
    for (const g of groups) {
      if (!pushed[String(g.id)]) {
        walk(g, [], 1);
        changed = true;
      }
    }
  }
  /* 理论上到不了这里；真到了说明有极端脏数据 ⇒ 直接吐素材，**宁可没有层级也不能丢**。 */
  for (const g of groups) {
    if (!pushed[String(g.id)]) {
      pushed[String(g.id)] = true;
      emit(g, [g.name || ""]);
    }
  }

  return out;
}

/* ---------- 模板库（tpl.json，契约 §5.7 · 2026-10-17 加法） ---------- */

/**
 * 从一个组 id 往上爬到顶，返回**从根到叶的名字数组**。
 *
 * 与 `flattenBrand()` 的差别：那边是"从上往下走树"，这边是"从条目反查上去"——
 * 因为 `tpl.json` 的 `items[]` 是**扁平**的（层级只由 `groupId` 指向），
 * 没有嵌套的 `assets[]` 可走。**两边算出来的 `groupPath` 必须同构**，
 * 否则 `dirlib` 那套面包屑在模板库上会找不到节点。
 *
 * 🔴 三种脏数据都要接住（**宁可降级，也绝不丢模板**）：
 *   · `groupId` 指向不存在的组 → 返回空数组 ⇒ 调用方落到「未分类」；
 *   · **成环**（A 父 B、B 父 A）→ `seen` 拦住，返回已经爬到的那一段，不爆栈；
 *   · 超过 `MAX_DEPTH` 层 → 只往回取前 `MAX_DEPTH` 段（与通用库的深度口径一致）。
 */
function groupPathOf(byId, gid) {
  if (gid === undefined || gid === null || gid === "") return [];
  const names = [];
  const seen = Object.create(null);
  let cur = String(gid);
  while (cur && byId[cur] && !seen[cur] && names.length < MAX_DEPTH) {
    seen[cur] = true;
    names.unshift(byId[cur].name || "");
    const p = byId[cur].parentId;
    cur = (p === undefined || p === null || p === "") ? "" : String(p);
  }
  return names.filter(Boolean);
}

/**
 * 模板库：`groups[]`（多层）+ `items[]`（**扁平**）→ 与另外两个库同构的条目数组。
 *
 * 输出字段刻意与 `flattenBrand()` **逐字段对齐**（`group` / `sub` / `groupPath` / `crumb` /
 * `depth` / `versionLabel` / `isCurrent`）⇒ 素材库那套筛选、`dirlib` 面包屑、
 * `groupTree()` 计数**全都能直接复用**，不用为模板库单写一份。
 *
 * ⚠️ **`kind` 仍是 `psd`**（契约 §5.7 口径 1）：靠 `scope === "tpl"` 区分，不新造枚举值。
 * ⚠️ `items[].width/height` 是**必填**（读不到尺寸的模板软件侧就不收录）——
 *    所以这里不做"尺寸缺失"的兜底，缺了就是上游违约。
 */
function flattenTpl(d) {
  const groups = sortByOrder((d && d.groups) || []);
  const byId = Object.create(null);
  for (const g of groups) byId[String(g.id)] = g;

  const out = [];
  for (const it of sortByOrder((d && d.items) || [])) {
    const path = groupPathOf(byId, it && it.groupId);
    /* 未分组 / 组被删 ⇒ 统一落到「未分类」（一个明确的分组名，比空串好：
       空串会让面包屑第 0 段变成空白，看起来像坏了）。 */
    const p = path.length ? path : ["未分类"];
    out.push({
      asset: it,
      scope: "tpl",
      group: p[0] || "",
      sub: p[1] || "",
      groupPath: p.slice(),
      crumb: p.slice(),
      depth: p.length,
      versionLabel: "",
      isCurrent: true,
    });
  }
  return out;
}

/**
 * 这个 scope 的**形态** —— 用来决定界面怎么排（不是靠 scope id 硬编码）。
 *
 * 三个来源按可信度排：
 *   ① **文件自己写的 `scope` 字段**（`task.json` / `brand.json` / `tpl.json` 都有，契约 §5.1）；
 *   ② 结构特征：`projects[]` ⇒ 任务库；`groups[]` + `items[]` 两张表 ⇒ 模板库；只有 `groups[]` ⇒ 通用库；
 *   ③ 都认不出 ⇒ `"unknown"`，界面按"没有二级结构"处理（**宁少不崩**）。
 *
 * 🔴 **为什么必须优先看 `scope` 字段**（2026-10-17 踩到）：
 *   `tpl.json` 也有 `groups[]` ⇒ 只按结构判会**把模板库认成通用库**，
 *   于是界面按两层 chips 排、`flattenBrand` 拿 `items[]` 当 `assets[]` 全部落空 ⇒ **模板一条都显示不出来**。
 *   加库的时候这类"看起来像"的误判最贵：不报错、只是空的。
 */
const KNOWN_KINDS = { task: true, brand: true, tpl: true };

function scopeKind(data) {
  const d = data || {};
  if (typeof d.scope === "string" && KNOWN_KINDS[d.scope]) return d.scope;
  if (Array.isArray(d.projects)) return "task";
  if (Array.isArray(d.groups) && Array.isArray(d.items)) return "tpl";
  if (Array.isArray(d.groups)) return "brand";
  return "unknown";
}

/**
 * 按 scope id 展平。
 *
 * 🔴 **不能写成 `scopeId === "brand" ? flattenBrand : flattenTask`** ——
 *    那样任何新 scope 都会**掉进 `flattenTask`**（拿 `d.projects` 去遍历 undefined），
 *    表现为"新库一条都没有"。旧版就是二元的，加 `tpl` 时正是踩这个坑的地方。
 *    ⇒ 先按 **id 显式分派**，认不出再用**结构**兜底（将来再加库也不必回来改这里）。
 */
function flatten(scopeId, d) {
  if (scopeId === "tpl") return flattenTpl(d);
  if (scopeId === "brand") return flattenBrand(d);
  if (scopeId === "task") return flattenTask(d);
  const kind = scopeKind(d);
  if (kind === "tpl") return flattenTpl(d);
  if (kind === "brand") return flattenBrand(d);
  return flattenTask(d);
}

/* ---------- 分组树（给筛选行 / 自检用） ---------- */

/**
 * 由**扁平条目**推分组树（任意层；契约 §5.3 `groups[].parentId`）。
 *
 * 顺序 = 条目里首次出现的顺序 —— 展平时已按 `sortOrder` 排过，这里**不重排**，
 * 免得两处各有各的排序规则、将来对不上。
 * ⚠️ `count` 是**含所有后代**的总数：父组的计数要能对上"点父组后网格里的卡片数"。
 * ⚠️ 两层数据下输出与旧版（硬编码两层）**结构完全一致** —— 旧 UI（chips）不会察觉变化。
 *
 * @param {Array} items flatten() 的输出
 * @returns {Array<{name:string, count:number, children:Array}>} children 可再套 children
 */
function groupTree(items) {
  const root = { children: [], _map: Object.create(null) };

  for (const it of items || []) {
    /* 优先用完整路径（任意层）；老数据没有 groupPath 时退化成 [group]，再退化成「未分组」 */
    const p = (it && Array.isArray(it.groupPath) && it.groupPath.length)
      ? it.groupPath
      : [(it && it.group) || "未分组"];

    let node = root;
    for (const name of p) {
      if (!name) continue;
      if (!node._map[name]) {
        node._map[name] = { name: name, count: 0, children: [], _map: Object.create(null) };
        node.children.push(node._map[name]);
      }
      node = node._map[name];
      node.count++; // 每一级祖先都算上这个素材 ⇒ count = 含后代
    }
  }

  /* 把内部索引 `_map` 摘掉再返回（它只是建树用的，不该漏给调用方） */
  const clean = (n) => ({
    name: n.name,
    count: n.count,
    children: (n.children || []).map(clean),
  });
  return root.children.map(clean);
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
  MAX_DEPTH,
  MIRROR_DIR,
  MANIFEST_FILE,
  THUMB_DIR,
  POLL_MS,
  readManifest,
  readScope,
  flatten,
  flattenTask,
  flattenBrand,
  flattenTpl,
  scopeKind,
  libraryScopes,
  groupTree,
  sourceSummary,
  sourceLabel,
  thumbUrl,
  clearThumbs,
  insertPlan,
  watch,
};
