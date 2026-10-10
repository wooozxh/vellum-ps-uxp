/*
 * tools/library.js —— 素材库（M2）
 * ===========================================================================
 * 数据来源：**镜像**（VellumDesk 写进插件 PluginData 的「清单 + 缩略图」）。
 * 唯一权威源：`D:\vellum-link\LINK-CONTRACT.md` v`vellum-link/1`。
 * 本工具**只读镜像**（契约 §八 写者唯一性）；唯一往外写的是 handoff 的取图请求
 * （`lib/handoff.js`，写 `library/handoff/req.json`）。
 *
 * 界面（对齐 docs/10 §10.7 与 docs/11 §五）：
 *   ① 顶层「库」切换 chips —— **由 `manifest.scopes[]` 动态生成**，不是写死的两个 tab
 *      （软件侧将来加第三个库，插件零改动就能显示）
 *   ② 筛选区最多三行：
 *        第一行 顶层分组（任务库的项目名 / 通用库的父组）
 *        第二行 **子组**（契约 §5.3 加法 ③ `groups[].parentId`；只有当前父组真有子组才出现）
 *        第三行 **来源**（契约 §5.4 加法 ② `asset.source`；只有当前分组内真有 ≥2 种才出现）
 *      **不构成筛选的一行一律不画** —— 只有一种取值的那种"筛选"是噪音
 *   ③ 缩略图网格（3 列）+ 每格右上角扩展名、丢失标记、来源角标（两种来源混排时才有）
 *   ④ 选中详情（面包屑 / 尺寸 / 角色 / 来源 / 标签 / 原图路径）+「置入到画布」
 *   ⑤ 每 ~3 秒对一次 `manifest.json` 的 revision（契约 §一），变了自动刷新
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ 软件侧 2026-10-10 按契约 §十 提的三处加法，插件侧的处置
 * ════════════════════════════════════════════════════════════════════════
 *   ① 缩略图命名加**命名空间**（任务 `t<id>` / 通用 `b<id>`）→ **界面零改动**：
 *      `asset.thumb` 对插件一直是"不透明路径"，本文件按字符串取图、从不解析文件名。
 *   ② `asset.source` → **用到了**（就是上面第三行「来源」+ 详情行 + 卡片角标）。
 *   ③ `groups[].parentId` → **用到了**：不做两级，筛选行会把"父组"和"子组"平铺成同级 chip
 *      （父组点了没有素材、子组却和它并列），那是**错的 UI**，不只是缺个功能。
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ UXP 硬约束（本文件每一处都踩过，改 UI 前先读 index.html 头部三条纪律）
 * ════════════════════════════════════════════════════════════════════════
 *   · **不用 Grid、不用 gap** → 网格是 flex-wrap + 百分比宽度，间距一律 margin
 *   · **不用 <button>**（不吃 flex 且强制居中）→ 一律 `div[role="button"]`
 *   · **图标必须逐元素写死绘制属性**（UXP 的 SVG 不做继承）→ 走 lib/icons.js
 *   · **缩略图所在容器必须可见** —— `display:none` 里 UXP 根本不加载图片，
 *     表现得像"超时"而不是报错（契约 §9.1 第 2 条，害过我们一次）
 *   · **缩略图必须 png/jpg** —— `<img>` 不解码 webp（自检 S19 实测）。镜像里读到
 *     `.webp` 时 `lib/mirror.js` 会直接给可读错误，本文件把它画成"格式不支持"的占位格，
 *     **绝不留空**（契约 §5.5：缺失也要画占位）。
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ 「置入」只有一条路：契约 §六 的原图握手 → Entry → 会话令牌 → placeEvent
 * ════════════════════════════════════════════════════════════════════════
 * 我原本设计了两条策略，其中 ① 是"把 `asset.absPath` 直接交给 PS 的 placeEvent，
 * 省掉整条搬运"。**2026-10-10 真机 S21 把这条打掉了**：
 *
 *     把裸路径放进 `_path` → `Error: invalid file token used`
 *
 * Photoshop 的 AM 层要的**不是路径，而是 UXP 授权过的文件令牌**；令牌只能由
 * **Entry 对象**换出来（`createSessionToken`），而能拿到 Entry 的只有
 * ① 插件自己的 PluginData ② 用户经文件选择器授权 —— 用户的 `absPath` 两者都不是。
 *
 * ⇒ 直连置入**在架构上不成立**，不是偏好问题。契约 §六 的 handoff 之所以必需，
 *   理由比它自己写的更硬：它恰好把原图送进了**我们能拿到 Entry** 的目录。
 *   所以本文件现在只有一条路，且中途每一步失败都在面板上说清原因。
 */

const dom = require("../lib/dom.js");
const log = require("../lib/log.js");
const icons = require("../lib/icons.js");
const store = require("../lib/store.js");
const ps = require("../lib/ps.js");
const data = require("../lib/data.js");
const mirror = require("../lib/mirror.js");
const handoff = require("../lib/handoff.js");

/** 界面偏好的落盘文件（记忆"上次看的是哪个库"）。不是镜像内容，写在 PluginData 根。 */
const PREF_FILE = "library-pref.json";

/* ------------------------------------------------------------------ 状态 */

let ctx = null;
let binder = null;
let root = null;
let refs = null;
let S = null;
let loadToken = 0; // 缩略图异步加载的令牌：重渲染/卸载后旧任务作废

function status(text) {
  if (ctx && ctx.setStatus) ctx.setStatus(text);
}

function scopeById(id) {
  if (!S || !S.scopes) return null;
  for (const s of S.scopes) if (s.id === id) return s;
  return null;
}

/* ------------------------------------------------------------- 小工具 */

function fmtSize(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return "";
  if (v < 1024) return v + " B";
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
  return (v / 1024 / 1024).toFixed(1) + " MB";
}

function fmtDims(a) {
  if (!a || !a.width || !a.height) return "";
  return a.width + "×" + a.height;
}

/** 日期只保留到分钟，UI 上不需要秒。 */
function fmtTime(s) {
  const t = String(s || "");
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(t);
  return m ? m[1] + " " + m[2] : t || "-";
}

/* --------------------------------------------------------------- 构建 */

function build() {
  const wrap = dom.el("div", { class: "s-lib" });
  refs = { cards: [] };

  /* ① 库切换 + 刷新 */
  const top = dom.el("div", { class: "lib-top" });
  refs.tabs = dom.el("div", { class: "lib-tabs", id: "vt-lib-tabs" });
  top.appendChild(refs.tabs);

  const refresh = dom.el("div", {
    class: "mini lib-refresh",
    id: "vt-lib-refresh",
    role: "button",
    tabindex: "0",
    title: "重新读一次镜像（平时每 3 秒会自动对一次）",
  });
  refresh.appendChild(icons.holder("settings", "i"));
  refresh.appendChild(dom.el("span", {}, ["刷新"]));
  top.appendChild(refresh);
  wrap.appendChild(top);

  /* 镜像元信息（排障用：契约版本 / 生成时间 / 工作区） */
  refs.meta = dom.el("div", { class: "lib-meta mono" }, ["正在读取镜像 …"]);
  wrap.appendChild(refs.meta);

  /* ② 分组筛选 */
  refs.bar = dom.el("div", { class: "lib-bar", id: "vt-lib-bar" });
  wrap.appendChild(refs.bar);

  /* ③ 网格 / 状态块 */
  refs.body = dom.el("div", { class: "lib-body", id: "vt-lib-body" });
  wrap.appendChild(refs.body);

  /* ④ 选中详情 */
  refs.foot = dom.el("div", { class: "lib-foot", id: "vt-lib-foot" });
  wrap.appendChild(refs.foot);

  binder.on(refresh, "click", () => manualRefresh());

  return wrap;
}

/* --------------------------------------------------------- 库切换 chips */

function renderTabs() {
  dom.clear(refs.tabs);
  for (const sc of S.scopes || []) {
    const on = sc.id === S.tabId;
    const chip = dom.el("div", {
      class: "ltab" + (on ? " is-on" : ""),
      id: "vt-lib-tab-" + sc.id,
      role: "button",
      tabindex: "0",
      "data-scope": sc.id,
      title: "切到「" + (sc.label || sc.id) + "」",
    });
    chip.appendChild(dom.el("span", { class: "lt-name" }, [sc.label || sc.id]));
    if (sc.count !== undefined && sc.count !== null) {
      chip.appendChild(dom.el("span", { class: "lt-n mono" }, [String(sc.count)]));
    }
    binder.on(chip, "click", () => switchScope(sc.id));
    refs.tabs.appendChild(chip);
  }
}

function renderMeta() {
  if (!S.manifest) {
    refs.meta.textContent = "镜像不可用";
    return;
  }
  const parts = [
    "契约 " + String(S.manifest.contract || "?"),
    "生成 " + fmtTime(S.manifest.generatedAt),
  ];
  if (S.manifest.psMajor) parts.push("PS " + S.manifest.psMajor);
  if (S.manifest.workspaceRoot) parts.push(S.manifest.workspaceRoot);
  refs.meta.textContent = parts.join("　·　");
}

/* ------------------------------------------------------------- 筛选 chips */

/** 只按「分组 / 子组」筛（**不含**来源）—— 来源行要基于它算，否则一选中来源那一行就自己消失了。 */
function itemsInGroup() {
  let out = S.items;
  if (S.group) out = out.filter((it) => (it.group || "未分组") === S.group);
  if (S.sub) out = out.filter((it) => (it.sub || "") === S.sub);
  return out;
}

/** 三个筛选条件全上。 */
function visibleItems() {
  const out = itemsInGroup();
  if (!S.source) return out;
  return out.filter((it) => String((it.asset && it.asset.source) || "") === S.source);
}

/** 当前筛选的一句话描述（状态行用）。 */
function filterLabel() {
  const bits = [];
  if (S.group) bits.push(S.group);
  if (S.sub) bits.push(S.sub);
  if (S.source) bits.push(mirror.sourceLabel(S.source));
  return bits.length ? bits.join(" › ") : "全部";
}

/** 日志用的分组签名：`公司素材(3)|我的收藏(1)`。 */
function groupsSig() {
  return mirror
    .groupTree(S.items)
    .map((t) => t.name + "(" + t.count + (t.children.length ? "+" + t.children.length + "子" : "") + ")")
    .join("|");
}

/** 画一行筛选 chips。`label` 为空则不画前缀；`cls` 为 `mid`（缩进，子组）/ `src`（来源）。 */
function makeFrow(label, chips, cls, onPick) {
  const row = dom.el("div", { class: "frow" + (cls ? " " + cls : "") });
  if (label) row.appendChild(dom.el("span", { class: "frow-lb" }, [label]));
  for (const c of chips) {
    const chip = dom.el("div", {
      class: "fchip" + (cls === "mid" ? " sub" : "") + (c.on ? " is-on" : ""),
      role: "button",
      tabindex: "0",
      "data-key": c.key,
      title: c.key ? "只看「" + c.label + "」" : "看全部",
    });
    chip.appendChild(dom.el("span", {}, [c.label]));
    chip.appendChild(dom.el("span", { class: "fc-n mono" }, [String(c.n)]));
    binder.on(chip, "click", () => onPick(c.key));
    row.appendChild(chip);
  }
  return row;
}

/** 改完筛选条件后的统一收尾（重画 chips + 网格 + 状态行）。 */
function refreshAfterFilter() {
  renderFilters();
  renderGrid(); // 内部会 ++loadToken；缩略图走 mirror 的缓存，不会重新读盘
  status("筛选：" + filterLabel() + "（" + visibleItems().length + " 张）");
}

/**
 * 重画整个筛选区（最多三行）。
 * ⚠️ **不构成筛选的行一律不画** —— 只有一种取值的"筛选"是噪音，这一点沿用旧版的判断。
 */
function renderFilters() {
  dom.clear(refs.bar);

  const tree = mirror.groupTree(S.items);
  const srcs = mirror.sourceSummary(itemsInGroup());
  // 只选了一个顶层组时，子组行也该出来（哪怕全库只有这一个顶层组）
  const activeTop = S.group || (tree.length === 1 ? tree[0].name : "");
  let activeNode = null;
  for (const t of tree) if (t.name === activeTop) activeNode = t;
  const kids = activeNode ? activeNode.children : [];

  if (tree.length <= 1 && !kids.length && srcs.length <= 1) {
    refs.bar.appendChild(
      dom.el("span", { class: "lib-count mono" }, ["共 " + S.items.length + " 张"])
    );
    return;
  }

  /* ① 顶层分组 */
  if (tree.length > 1) {
    const chips = [{ key: "", label: "全部", n: S.items.length, on: !S.group }];
    for (const t of tree) chips.push({ key: t.name, label: t.name, n: t.count, on: S.group === t.name });
    refs.bar.appendChild(
      makeFrow("", chips, "", (k) => {
        S.group = k;
        S.sub = ""; // 换父组 → 子组筛选必须复位（不同父组下可能有同名子组）
        S.source = "";
        refreshAfterFilter();
      })
    );
  }

  /* ② 子组（契约 §5.3 加法 ③ 的两层分组） */
  if (kids.length) {
    const chips = [{ key: "", label: "全部", n: activeNode ? activeNode.count : 0, on: !S.sub }];
    for (const k of kids) chips.push({ key: k.name, label: k.name, n: k.count, on: S.sub === k.name });
    refs.bar.appendChild(
      makeFrow("", chips, "mid", (k) => {
        S.sub = k;
        refreshAfterFilter();
      })
    );
  }

  /* ③ 来源（契约 §5.4 加法 ② 的可选 asset.source） */
  if (srcs.length > 1) {
    const chips = [{ key: "", label: "全部", n: itemsInGroup().length, on: !S.source }];
    for (const s of srcs) chips.push({ key: s.value, label: s.label, n: s.count, on: S.source === s.value });
    refs.bar.appendChild(
      makeFrow("来源", chips, "src", (k) => {
        S.source = k;
        refreshAfterFilter();
      })
    );
  }
}

/**
 * 数据刷新后，把**已经失效的**筛选条件清掉。
 * 例：刚才在「我的收藏」里选着来源「我的」，而这一轮刷新后那张素材没了 ⇒ 条件得复位，
 * 否则网格会空着，而筛选行上看不出为什么。
 */
function pruneFilters() {
  const tree = mirror.groupTree(S.items);
  const names = tree.map((t) => t.name);
  if (S.group && names.indexOf(S.group) < 0) {
    S.group = "";
    S.sub = "";
  }
  if (S.group) {
    let node = null;
    for (const t of tree) if (t.name === S.group) node = t;
    const kids = node ? node.children.map((c) => c.name) : [];
    if (S.sub && kids.indexOf(S.sub) < 0) S.sub = "";
    if (!kids.length) S.sub = "";
  } else {
    S.sub = "";
  }
  if (S.source) {
    const vals = mirror.sourceSummary(itemsInGroup()).map((s) => s.value);
    if (vals.indexOf(S.source) < 0) S.source = "";
  }
}

/* ----------------------------------------------------------------- 网格 */

function renderMessage(title, sub, withRetry) {
  dom.clear(refs.body);
  const box = dom.el("div", { class: "empty" });
  box.appendChild(dom.el("p", { class: "empty-t" }, [title]));
  if (sub) box.appendChild(dom.el("p", { class: "empty-s" }, [sub]));
  if (withRetry) {
    const btn = dom.el("div", {
      class: "mini lib-retry",
      role: "button",
      tabindex: "0",
      id: "vt-lib-retry",
    });
    btn.appendChild(icons.holder("plus", "i"));
    btn.appendChild(dom.el("span", {}, ["重新读取"]));
    binder.on(btn, "click", () => manualRefresh());
    box.appendChild(btn);
  }
  refs.body.appendChild(box);
}

function makeCard(item, showSrc) {
  const a = item.asset;
  const on = S.selected && S.selected.asset && S.selected.asset.id === a.id;
  const card = dom.el("div", {
    class: "card" + (on ? " is-on" : ""),
    id: "vt-lib-card-" + a.id,
    role: "button",
    tabindex: "0",
    "data-id": String(a.id),
    title: a.name + (a.absPath ? "\n" + a.absPath : ""),
  });
  const inner = dom.el("div", { class: "card-in" });
  card.appendChild(inner);

  const th = dom.el("div", { class: "card-th" });
  const ph = dom.el("span", { class: "card-ph" }, ["无预览"]);
  th.appendChild(ph);
  // ⚠️ <img> 先建、后塞 src：缩略图是异步读的，避免一次读几十个文件把面板卡住
  const img = a.thumb ? dom.el("img", { class: "card-img", alt: a.name }) : null;
  if (img) th.appendChild(img);
  th.appendChild(dom.el("span", { class: "card-ext mono" }, [String(a.ext || "?").toUpperCase()]));
  if (a.missing) {
    th.appendChild(dom.el("span", { class: "card-miss" }, ["原文件丢失"]));
  }
  // 来源角标：只在**两种来源混排**时才画（整库同源时每格都挂一个角标 = 纯噪音）
  if (showSrc && a.source) {
    th.appendChild(
      dom.el(
        "span",
        { class: "card-src" + (String(a.source) === "user" ? " is-user" : "") },
        [mirror.sourceLabel(a.source)]
      )
    );
  }
  inner.appendChild(th);

  inner.appendChild(dom.el("span", { class: "card-nm" }, [a.name]));
  const bits = [];
  const d = fmtDims(a);
  if (d) bits.push(d);
  if (a.role) bits.push(a.role);
  inner.appendChild(dom.el("span", { class: "card-mt mono" }, [bits.join(" · ") || "—"]));

  binder.on(card, "click", () => select(item));
  // 双击直接置入（UXP 若不支持 dblclick，这一条自然不触发，不影响单击）
  binder.on(card, "dblclick", () => {
    select(item);
    doInsert();
  });

  return { card: card, img: img, ph: ph, asset: a };
}

function renderGrid() {
  const list = visibleItems();
  refs.cards = [];

  if (!list.length) {
    renderMessage(
      S.items.length ? "这个筛选下没有素材" : "「" + (S.tabLabel || S.tabId) + "」是空的",
      S.items.length ? "点上方「全部」看回来" : "在 VellumDesk 里加素材后，这里会自动刷新",
      false
    );
    return;
  }

  dom.clear(refs.body);
  const grid = dom.el("div", {
    class: "lib-grid",
    id: "vt-lib-grid",
    // ⚠️ 自检/排障用：标明**这块网格属于哪个库的第几版**。
    //    没有它，"切库后的等待条件"只能写"网格里有卡片"—— 而那会被**上一个库留下的
    //    旧网格**满足（v0.2.7 的 S20b 就这么误报过一次；v0.2.8 的 S20c/S20d 又踩了同一条路）。
    "data-scope": String(S.tabId || ""),
    "data-rev": String(S.revision === null || S.revision === undefined ? "" : S.revision),
  });
  // 角标规则与「来源」筛选行同一套：只有真能起区分作用时才画
  const showSrc = mirror.sourceSummary(itemsInGroup()).length > 1;
  for (const it of list) {
    const made = makeCard(it, showSrc);
    refs.cards.push(made);
    grid.appendChild(made.card);
  }
  refs.body.appendChild(grid);

  loadThumbs(++loadToken);
}

/**
 * 逐张读缩略图。
 * ⚠️ 顺序读、不并发：一次几十个文件同时读会把面板拖住；
 *    令牌作废（重渲染 / 切库 / 卸载）后立刻停手，别去碰已移除的节点。
 */
async function loadThumbs(token) {
  const cards = refs.cards.slice();
  for (const c of cards) {
    if (token !== loadToken || !refs) return;
    if (!c.img) {
      c.ph.textContent = "无预览";
      continue;
    }
    let r = null;
    try {
      r = await mirror.thumbUrl(c.asset, S.revision);
    } catch (e) {
      r = { ok: false, error: String((e && e.message) || e) };
    }
    if (token !== loadToken || !refs) return;
    if (r && r.ok) {
      c.img.src = r.url;
      c.ph.style.display = "none";
    } else {
      c.ph.textContent = r && r.webp ? "格式不支持" : "预览失败";
      if (r && r.error) {
        // 只记一次，别在轮询里刷屏
        c.card.setAttribute("title", c.asset.name + "\n" + r.error);
      }
    }
  }
}

/* --------------------------------------------------------------- 详情 */

function renderFoot() {
  dom.clear(refs.foot);
  const sel = S.selected;
  if (!sel) {
    refs.foot.appendChild(dom.el("span", { class: "lf-hint" }, ["点一张素材看详情，再点「置入到画布」"]));
    return;
  }
  const a = sel.asset;
  const plan = mirror.insertPlan(a);

  refs.foot.appendChild(dom.el("span", { class: "lf-t" }, [a.name]));
  if (sel.crumb && sel.crumb.length) {
    refs.foot.appendChild(dom.el("span", { class: "lf-s" }, ["位置：" + sel.crumb.join(" › ")]));
  }
  const bits = [];
  const d = fmtDims(a);
  if (d) bits.push(d);
  const sz = fmtSize(a.size);
  if (sz) bits.push(sz);
  if (a.role) bits.push(a.role);
  if (a.source) bits.push("来源：" + mirror.sourceLabel(a.source));
  if (a.modifiedAt) bits.push("改于 " + fmtTime(a.modifiedAt));
  refs.foot.appendChild(dom.el("span", { class: "lf-s mono" }, [bits.join(" · ") || "—"]));
  if (a.tags && a.tags.length) {
    refs.foot.appendChild(dom.el("span", { class: "lf-s" }, ["标签：" + a.tags.join(" / ")]));
  }
  if (a.absPath) {
    refs.foot.appendChild(dom.el("span", { class: "lf-s lf-path mono" }, [a.absPath]));
  }

  const act = dom.el("div", { class: "lf-act" });
  const btn = dom.el("div", {
    class: "mini pri" + (plan.supported && !a.missing ? "" : " is-off"),
    id: "vt-lib-insert",
    role: "button",
    tabindex: "0",
    title: plan.supported ? plan.note : plan.note,
  });
  btn.appendChild(icons.holder("plus", "i"));
  btn.appendChild(dom.el("span", {}, ["置入到画布"]));
  binder.on(btn, "click", () => doInsert());
  act.appendChild(btn);
  act.appendChild(
    dom.el("span", { class: "lf-note" }, [
      a.missing ? "原文件已丢失，无法置入" : plan.note,
    ])
  );
  refs.foot.appendChild(act);
}

function select(item) {
  S.selected = item;
  // 重画"哪个格子被选中"：只切 class，不重建整张网格（重建会把滚动位置与已加载的图都丢掉）
  for (const c of refs.cards) {
    const on = c.asset && c.asset.id === item.asset.id;
    if (c.card && c.card.classList) {
      if (on) c.card.classList.add("is-on");
      else c.card.classList.remove("is-on");
    }
  }
  renderFoot();
  const a = item.asset;
  const d = fmtDims(a);
  status(
    "「" + a.name + "」" + (d ? " " + d : "") + (a.role ? " · " + a.role : "") +
    (item.crumb && item.crumb.length ? "　" + item.crumb.join(" › ") : "")
  );
  return item;
}

function setInsertBusy(busy) {
  const b = dom.$("vt-lib-insert");
  if (!b || !b.classList) return;
  if (busy) b.classList.add("is-off");
  else b.classList.remove("is-off");
}

/* --------------------------------------------------------- 刷新 / 轮询 */

async function manualRefresh() {
  status("正在重新读取镜像 …");
  await log.appendLog("library manual refresh tab=" + (S && S.tabId));
  await load(true);
}

async function load(fromUser) {
  const m = await mirror.readManifest();
  if (!m.ok) {
    S.manifest = null;
    S.items = [];
    S.scopes = [];
    renderMeta();
    renderTabs();
    renderFilters();
    const dir = await safeDataPath();
    if (m.empty) {
      renderMessage(
        "还没有素材镜像",
        "这是正常的：镜像由 VellumDesk 生成。" +
          (dir ? "它应写入：" + dir + "\\library\\" : "") +
          " 在 VellumDesk 里同步一次即可；开发期可用 tools/fake-vellumdesk.cjs 造一份假镜像。",
        true
      );
    } else if (m.unsupported) {
      renderMessage("镜像版本不受支持", m.error, true);
    } else {
      renderMessage("读镜像失败", m.error || "未知原因", true);
    }
    refs.foot && renderFoot();
    status("素材库：镜像不可用 —— " + (m.error || "未知原因"));
    await log.appendLog("library load FAILED ok=false unsupported=" + !!m.unsupported + " empty=" + !!m.empty + " err=" + (m.error || "-"));
    return false;
  }

  const changedScopeList = !S.manifest ||
    (S.manifest.scopes || []).map((s) => s.id + ":" + s.revision).join(",") !==
      m.scopes.map((s) => s.id + ":" + s.revision).join(",");
  S.manifest = m;
  S.scopes = m.scopes;

  let tabId = S.tabId;
  if (!tabId || !scopeById(tabId)) {
    tabId = pickTab(m.scopes);
  }
  S.tabId = tabId;
  const sc = scopeById(tabId);
  S.tabLabel = sc ? sc.label : tabId;

  renderMeta();
  renderTabs();
  await loadScope(fromUser ? "manual" : (changedScopeList ? "change" : "boot"));
  return true;
}

/** 默认看哪个库：优先记住的上次选择 → 否则按软件侧给的顺序取第一个。 */
function pickTab(scopes) {
  const want = S.want;
  if (want) {
    for (const s of scopes) if (s.id === want) return s.id;
  }
  return scopes.length ? scopes[0].id : null;
}

async function loadScope(via) {
  const sc = scopeById(S.tabId);
  if (!sc) {
    renderMessage("找不到这个库", "manifest.scopes 里没有 " + S.tabId, true);
    return;
  }
  let r = null;
  try {
    r = await mirror.readScope(sc);
  } catch (e) {
    r = { ok: false, error: "读 " + sc.file + " 抛异常：" + ((e && e.message) || e) };
  }
  if (!r.ok) {
    S.items = [];
    renderFilters();
    renderMessage("读「" + (sc.label || sc.id) + "」失败", r.error, true);
    status("素材库：" + r.error);
    await log.appendLog("library scope FAILED id=" + sc.id + " file=" + sc.file + " err=" + r.error);
    return;
  }
  try {
    S.scopeData = r.data;
    S.revision = r.revision;
    S.items = mirror.flatten(sc.id, r.data);
    S.tabLabel = sc.label || sc.id;
    // 刷新后把已经失效的筛选条件清掉（切库时会先复位，这里兜住"自动刷新"那条路）
    pruneFilters();

    renderFilters();
    renderGrid();
    if (S.selected) {
      // 刷新后原来选中的那条可能没了 → 按 id 重新认领
      const id = S.selected.asset.id;
      let found = null;
      for (const it of S.items) if (it.asset.id === id) found = it;
      S.selected = found;
    }
    renderFoot();
  } catch (e) {
    const m = (e && e.message) || String(e);
    renderMessage("渲染「" + (sc.label || sc.id) + "」出错", m, true);
    status("✗ 素材库渲染出错：" + m);
    await log.appendLog("library render EXCEPTION id=" + sc.id + " " + m);
    return;
  }

  await log.appendLog(
    "library scope id=" + sc.id + " label=" + JSON.stringify(sc.label || "") +
    " rev=" + r.revision + " items=" + S.items.length + " groups=" + groupsSig() +
    " sub=" + (S.sub || "-") + " src=" + (S.source || "-") +
    " via=" + (via || "-")
  );
  status(
    "素材库：「" + S.tabLabel + "」" + S.items.length + " 张" +
    (S.items.length ? "　" + (S.items[0].crumb || []).join(" › ") : "") +
    "　rev " + r.revision
  );
}

async function safeDataPath() {
  try {
    return await data.dataFolderPath();
  } catch {
    return "";
  }
}

async function switchScope(id) {
  // ⚠️ 显式记一笔"收到了切库请求"：真机上排查过一次"点了 tab 什么都没发生"，
  //    当时分不清是**处理器没跑到**、**早退**、还是**中途抛异常**（异步异常在 UXP 里不可见）。
  await log.appendLog("library switch ask id=" + id + " cur=" + (S && S.tabId));
  if (!S) return;
  if (S.tabId === id) return;
  try {
    S.tabId = id;
    S.group = "";
    S.sub = "";
    S.source = "";
    S.selected = null;
    const sc = scopeById(id);
    S.tabLabel = sc ? sc.label : id;
    renderTabs();
    renderFoot();
    loadToken++; // 作废在途的缩略图加载
    await loadScope("switch");
    try {
      await store.writeJson(PREF_FILE, { tab: id });
    } catch {
      /* 记不住就记不住，不影响使用 */
    }
  } catch (e) {
    const m = (e && e.message) || String(e);
    status("✗ 切库失败：" + m);
    await log.appendLog("library switch EXCEPTION id=" + id + " " + m);
  }
}

function startWatch() {
  stopWatch();
  S.watcher = mirror.watch(async (m, isFirst) => {
    if (!refs) return;
    const sig = m.scopes.map((s) => s.id + ":" + s.revision).join(",");
    await log.appendLog("library watch first=" + isFirst + " revs=" + (sig || "-"));
    if (isFirst) return; // 首次已由 mount 时的 load() 处理，别白读一遍
    await load(false);
    status("素材库已更新（VellumDesk 写了新的镜像，rev " + sig + "）");
  });
}

function stopWatch() {
  if (S && S.watcher) {
    try {
      S.watcher.stop();
    } catch {
      /* 忽略 */
    }
    S.watcher = null;
  }
}

/* --------------------------------------------------------------- 置入 */

async function doInsert() {
  if (S.busy) {
    status("上一张还在处理中 …");
    return null;
  }
  const sel = S.selected;
  if (!sel) {
    status("先点一张素材，再点「置入到画布」");
    return null;
  }
  const a = sel.asset;
  const plan = mirror.insertPlan(a);

  // 能在本地判掉的前置条件，绝不留到宿主去（否则换来一个用户看不懂的 PS 弹框）
  if (a.missing) {
    const msg = "✗ 「" + a.name + "」的原文件已丢失（镜像里 missing=true）—— 先在 VellumDesk 里找到或移除它";
    status(msg);
    await log.appendLog("library insert REJECT assetId=" + a.id + " reason=missing");
    return { ok: false, reason: "missing" };
  }
  if (!plan.supported) {
    status("✗ 「" + a.name + "」" + plan.note);
    await log.appendLog("library insert REJECT assetId=" + a.id + " ext=" + a.ext + " reason=unsupported");
    return { ok: false, reason: "unsupported" };
  }
  if (!ps.hasDocument()) {
    status("✗ 没有打开的文档 —— 置入需要一个目标文档（新建或打开一个再来）");
    await log.appendLog("library insert REJECT assetId=" + a.id + " reason=no-document");
    return { ok: false, reason: "no-document" };
  }

  S.busy = true;
  setInsertBusy(true);
  const t0 = Date.now();
  try {
    /* ---- ① 写请求：请 VellumDesk 把这一张原图拷进 handoff/ ---- */
    status("正在向 VellumDesk 取「" + a.name + "」的原图 …");
    const req = await handoff.request(a, sel.scope);
    await log.appendLog(
      "library handoff req ok=" + req.ok + " reqId=" + (req.reqId || "-") +
      " assetId=" + a.id + " scope=" + sel.scope + " created=" + req.created +
      (req.error ? " err=" + req.error : "")
    );
    if (!req.ok) {
      status("✗ 请求原图失败：" + req.error + "（契约 §六 的 handoff 目录写不进去）");
      return { ok: false, reason: "handoff-request", error: req.error };
    }

    /* ---- ② 等结果：只认 reqId 对得上的那一条 ---- */
    const res = await handoff.waitForRes(req.reqId, handoff.DEFAULT_TIMEOUT_MS);
    if (!res.ok) {
      await log.appendLog(
        "library handoff res FAILED reqId=" + req.reqId + " timedOut=" + !!res.timedOut +
        " lastSeen=" + (res.lastSeen || "-") + " err=" + (res.error || "-")
      );
      status(
        "✗ 取原图失败：" + (res.error || "未知原因") +
        (res.timedOut ? "　—— 确认 VellumDesk 在运行、且已开启插件联动" : "")
      );
      return { ok: false, reason: "handoff-timeout", error: res.error };
    }

    /* ---- ③ 原图到手：拿到 Entry（置入必须靠它换会话令牌） ---- */
    const inc = await handoff.fetchIncoming(res.data);
    await log.appendLog(
      "library handoff incoming ok=" + inc.ok + " name=" + JSON.stringify(inc.name) +
      " bytes=" + inc.byteLength + " entry=" + !!inc.entry +
      (inc.error ? " err=" + inc.error : "")
    );
    if (!inc.ok) {
      status("✗ 原图已就位但拿不到可置入的文件句柄：" + (inc.error || "未知"));
      return { ok: false, reason: "incoming", error: inc.error };
    }

    /* ---- ④ 置入 ---- */
    const placed = await ps.placeFile(inc.entry, { verify: "change" });
    await log.appendLog(
      "library insert via=placeEvent ok=" + placed.ok + " changed=" + placed.changed +
      " layers=" + placed.layersBefore + "→" + placed.layersAfter +
      " bytes=" + inc.byteLength + " file=" + JSON.stringify(placed.file || inc.name) +
      (placed.token ? " token=" + placed.token : "") +
      (placed.error ? " err=" + placed.error : "")
    );
    if (placed.ok && placed.changed) {
      status(
        "✓ 已置入「" + a.name + "」（经 VellumDesk 取图 " + fmtSize(inc.byteLength) +
        "，新图层" + (placed.layer && placed.layer.name ? "「" + placed.layer.name + "」" : "") +
        "　图层数 " + placed.layersBefore + " → " + placed.layersAfter +
        "　" + (Date.now() - t0) + "ms）"
      );
      return placed;
    }
    status("✗ 原图已取到（" + fmtSize(inc.byteLength) + "），但置入失败：" + (placed.error || "图层数没变"));
    return { ok: false, reason: "place", error: placed.error };
  } catch (e) {
    const m = (e && e.message) || String(e);
    status("✗ 置入抛异常：" + m);
    await log.appendLog("library insert EXCEPTION " + m);
    return { ok: false, reason: "exception", error: m };
  } finally {
    S.busy = false;
    setInsertBusy(false);
  }
}

/* ------------------------------------------------------------- 生命周期 */

async function mount(container, context) {
  ctx = context;
  binder = dom.makeBinder();
  loadToken++;

  let want = null;
  try {
    const pref = await store.readJson(PREF_FILE, null);
    want = pref && pref.tab ? String(pref.tab) : null;
  } catch {
    want = null;
  }

  root = build();
  dom.clear(container);
  container.appendChild(root);

  S = {
    manifest: null,
    scopes: [],
    tabId: null,
    tabLabel: "",
    scopeData: null,
    revision: null,
    items: [],
    group: "",
    sub: "",
    source: "",
    selected: null,
    busy: false,
    watcher: null,
    want: want,
  };

  refs.meta.textContent = "正在读取镜像 …";
  renderFoot();

  const ok = await load(false);
  startWatch();

  await log.appendLog(
    "library mount ok=" + ok + " tab=" + (S.tabId || "-") + " items=" + S.items.length +
    " scopes=" + (S.scopes || []).map((s) => s.id + ":" + s.revision).join("|") +
    " thread=" + mirror.CONTRACT
  );
}

function unmount() {
  stopWatch();
  loadToken++; // 作废在途的缩略图加载
  if (binder) binder.offAll();
  binder = null;
  root = null;
  refs = null;
  ctx = null;
  S = null;
  // 缩略图 objectURL 全部释放（防泄漏）；下次进来会重新读
  try {
    mirror.clearThumbs();
  } catch {
    /* 忽略 */
  }
}

module.exports = {
  id: "assets",
  title: "素材库",
  subtitle: "任务库与通用库，一点置入",
  badge: "M2",
  ready: true,
  mount,
  unmount,

  /* 供外壳 / 自检复用（与面板走同一份实现） */
  PREF_FILE,
  /** 只读镜像（自检用）。 */
  peek: () => S,
  /** 置入入口（自检用；与点「置入到画布」同一条路）。 */
  insert: () => doInsert(),
};
