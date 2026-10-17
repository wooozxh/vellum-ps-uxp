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
/* 目录导航（面包屑 + 子目录行）—— 与模板库共用一套，别在工具里各写一遍 */
const dirlib = require("../lib/dirlib.js");

/** 界面偏好的落盘文件（记忆"上次看的是哪个库"）。不是镜像内容，写在 PluginData 根。 */
const PREF_FILE = "library-pref.json";

/**
 * 置入落点**固定居中**（v0.9.7，用户 2026-10-17 拍板）。
 *
 * 落点九宫格已从界面移除（同事反馈没人用），但**置入仍然需要定位** ⇒
 * `ps.anchorOffset()` 与 `anchorInfo()` 全部保留，只是锚点不再由用户选。
 * ⚠️ 别因为"界面上没有落点"就把 `anchorOffset` 一起删了 —— 它是置入定位的核心。
 * ⚠️ 自检 S24 / S25 也照旧保留：它们验的是 `placeEvent` 的真实落点规则
 *    （默认落点 = 选区中心 / 无选区则画布中心），与有没有这个 UI 无关。
 */
const FIXED_ANCHOR = "mc"; // mc = 居中

/* ------------------------------------------------------------------ 状态 */

let ctx = null;
let binder = null;
let root = null;
let refs = null;
let S = null;
let loadToken = 0; // 缩略图异步加载的令牌：重渲染/卸载后旧任务作废

/**
 * 自绘下拉的展开态。
 * ⚠️ 存的是**wrap 的 id 字符串**、且**同时只允许一个打开** ——
 *    存布尔的话，页面上有两个下拉（项目 / 子类）时两者会各自为政，
 *    "点开 A 再点开 B"会让 A 的浮层留在原地。
 */
let openSel = null;

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

/** node 是否在 el 之内（走 parentNode，不用 `contains` —— UXP 上更稳）。 */
function insideNode(node, el) {
  let n = node;
  while (n) {
    if (n === el) return true;
    n = n.parentNode;
  }
  return false;
}

/**
 * 当前落点锚点能不能算出目标位置（v0.3.0）。
 * 依赖三个数：画布宽高（`docInfo()`）+ 素材宽高（镜像契约 §5.4 必填）。
 * 缺任何一个就**如实说缺什么**，而不是退回静默居中 —— 否则用户会以为落点生效了。
 */
  // ⚠️ 有选区时 `placeEvent` 的默认落点是**选区中心**（不是画布中心）——
  // 所以基准必须由 `placeBaseCenter()` 给，绝不能自己假设画布中心。
function anchorInfo(a) {
  const info = ps.docInfo() || {};
  const dW = info.docW;
  const dH = info.docH;
  if (!(dW > 0) || !(dH > 0) || !(a && a.width > 0) || !(a && a.height > 0)) {
    const why = !ps.hasDocument()
      ? "没有打开的文档"
      : "缺尺寸（画布 " + (dW || "?") + "×" + (dH || "?") +
        " / 素材 " + ((a && a.width) || "?") + "×" + ((a && a.height) || "?") + "）";
    // 🔴 v0.3.5：**画布尺寸有、只是素材缺尺寸**（契约 §5.4：`width`/`height` 可能为 null，
    // 比如 PSD / PDF 探不到）—— 这种情况**不放弃**：交给 placeFile 用
    // "**置入后的实际尺寸**"只做**定位**（尺寸保持 PS 给的样子）。
    // 以前这里直接返回"算不出来"，调用方于是什么都不传 ⇒ 退回画布居中，
    // 用户选的九宫格被**静默忽略**（这才是真问题，而不是"缺尺寸"本身）。
    return {
      ok: false,
      note: why + (dW > 0 && dH > 0 ? "→ 按置入后的实际尺寸只定位（不改尺寸）" : "→ 只能居中"),
      docW: dW,
      docH: dH,
      needAnchorPlace: dW > 0 && dH > 0,
    };
  }
  const base = ps.placeBaseCenter();
  const r = ps.anchorOffset(S.anchor, dW, dH, a.width, a.height, base.ok ? base : null);
  if (!r.ok) return { ok: false, note: r.error + "→ 只能居中" };
  return {
    ok: true,
    off: r,
    docW: dW,
    docH: dH,
    base: base,
    note:
      ps.anchorLabel(S.anchor) + " · 画布 " + dW + "×" + dH +
      // ⚠️ 这是 S24/S25 真机测出来的事实，必须让用户看见：
      //    有选区时置入的默认落点是**选区中心**，而且**这次置入会把选区吃掉**
      //    （实测「置入后选区=无」）—— 所以"框哪儿放哪儿"是**每次插入前框一次**。
      (base.ok && base.from === "selection"
        ? " · 基准=选区中心（本次置入后选区会被取消，下次要重新框）"
        : "") +
      " → 左上角 " + r.x + "," + r.y,
    rect: {
      left: r.x,
      top: r.y,
      right: r.x + Number(a.width),
      bottom: r.y + Number(a.height),
    },
  };
}

/**
 * 记住"上次看哪个库"。
 *
 * ⚠️ v0.9.7 起**不再写 `anchor`** —— 落点功能已移除。老 pref 文件里那个字段
 * 读的时候直接忽略（留着无害，不清它，免得为了一个无用字段去改用户文件）。
 */
async function savePref() {
  try {
    await store.writeJson(PREF_FILE, { tab: S && S.tabId });
  } catch {
    /* 记不住就记不住，不影响使用 */
  }
}

/* --------------------------------------------------------------- 构建 */

function build() {
  const wrap = dom.el("div", { class: "s-lib" });
  refs = { cards: [], projslot: null };

  /* ① 库切换 + 项目筛选（仅任务库）+ 刷新 */
  const top = dom.el("div", { class: "lib-top" });
  refs.tabs = dom.el("div", { class: "lib-tabs", id: "vt-lib-tabs" });
  top.appendChild(refs.tabs);

  // 项目下拉的**位置**先占好，内容由 renderProjSel() 决定填不填 ——
  // 通用库没有"项目"这一层，那里就空着（刷新按钮自然左移），不做假占位。
  refs.projslot = dom.el("div", { class: "lib-proj", id: "vt-lib-projslot" });
  top.appendChild(refs.projslot);

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

  /* 镜像"只有几个库"的如实提示（默认隐藏）——
     为什么要有这一行：库列表**完全由镜像的 `scopes[]` 决定**，
     某个库"不见了"通常是软件侧那一版镜像里没写出对应 scope，而不是插件丢了入口。
     用户 2026-07-11 报过「通用素材库入口丢失」，真因就是新镜像只声明了 task。 */
  refs.metaNote = dom.el("div", { class: "lib-metanote", id: "vt-lib-metanote" }, [""]);
  refs.metaNote.style.display = "none";
  wrap.appendChild(refs.metaNote);

  /* ② 分组筛选 */
  refs.bar = dom.el("div", { class: "lib-bar", id: "vt-lib-bar" });
  wrap.appendChild(refs.bar);

  /* ③ 网格 / 状态块（**中间唯一的滚动区**） */
  refs.body = dom.el("div", { class: "lib-body", id: "vt-lib-body" });
  wrap.appendChild(refs.body);

  /* ④ 选中详情 + 置入（**固定在面板底部**）
     ────────────────────────────────────────────────────────────────
     v0.9.8（用户 2026-10-17 拍板的三段式）：**目录选择器固定在上、插入面板固定在下、
     中间只有网格滚动**。用的时候把面板垂直拉到最高即可。
     ⚠️ 历史：v0.3.2 曾挪到**顶部**，理由是"选完素材还要滚到最底下按置入很难受"。
        现在改回底部是**成立的** —— 关键在于 `flex: 0 0 auto` 让它**固定在容器底部、
        不随网格滚动**，痛点消失。**别把它再挪回滚动区里**，那样痛点会回来。
     ⚠️ 未选中时只有一行提示，现在读起来像"状态栏"，正好。 */
  refs.foot = dom.el("div", { class: "lib-foot", id: "vt-lib-foot" });
  wrap.appendChild(refs.foot);

  binder.on(refresh, "click", () => manualRefresh());

  // 下拉（项目 / 二层子类）关闭：由**容器根节点正着判**"这次点击还在不在那个组件内"。
  // ⚠️ 不要绑被覆盖元素的 mouseout —— 子元素会成对触发，且一旦算错就是"关了又开"的振荡回路
  //    （调色板悬停闪烁就是这么来的）。这里是**点击驱动**，本来也不依赖 hover。
  binder.on(wrap, "click", (ev) => {
    if (!openSel) return;
    const w = dom.$(openSel);
    if (w && insideNode(ev && ev.target, w)) return; // 点在自己身上 → 交给各自的处理器
    closeSelect();
  });

  return wrap;
}

/* ------------------------------------------------------ 自绘下拉（共用） */

/** 在 wrap 里找触发条（class 的首段正好是 `fsel`，浮层是 `fsel-pop`）。 */
function selTriggerOf(wrapEl) {
  if (!wrapEl || !wrapEl.children) return null;
  for (let i = 0; i < wrapEl.children.length; i++) {
    const c = wrapEl.children[i];
    const cls = String((c.getAttribute && c.getAttribute("class")) || "");
    if (cls.split(" ")[0] === "fsel") return c;
  }
  return null;
}

/** 打开某个下拉（先把别的关掉 —— 同时只允许一个展开）。 */
function openSelect(wrapId) {
  closeSelect();
  const w = dom.$(wrapId);
  if (!w) return;
  openSel = wrapId;
  if (w.classList) w.classList.add("is-open");
  const t = selTriggerOf(w);
  if (t && t.setAttribute) t.setAttribute("aria-expanded", "true");
}

/** 关掉当前展开的下拉。**幂等**：没有展开时什么都不做。 */
function closeSelect() {
  if (!openSel) return;
  const id = openSel;
  openSel = null;
  const w = dom.$(id);
  if (!w) return;
  if (w.classList) w.classList.remove("is-open");
  const t = selTriggerOf(w);
  if (t && t.setAttribute) t.setAttribute("aria-expanded", "false");
}

/**
 * 自绘下拉（触发条 + 浮层列表）—— 「二层子类」与「项目」共用一份实现。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 为什么自绘（2026-10-11 真机 S23 实测，结论在 docs/25）：
 *   · 原生 `<select>` **外观改不动**（与"样式沿用现有风格"直接冲突），
 *     且设选中态只能走 `option.selected`（`setAttribute("value")` 后 `.value` 读回 "undefined"）；
 *   · Spectrum `sp-picker` **真机实测未注册**（与伪造标签名的三项读数逐项相同）。
 *
 * 三条纪律（沿用调色板那次，改之前先读）：
 *   ① **浮层不覆盖触发条** —— 纵向落在触发条下方 + 6px 间隙（见 index.html `.fsel-pop`）；
 *   ② 关层**由容器根节点正着判**"点击还在不在这个组件内"，**不绑被覆盖元素的 mouseout**
 *      （那会造成成对触发 → 算错 → "关了又开"的振荡回路）；
 *   ③ 展开态**幂等**：只切 class，不重建 DOM。
 * 外加：浮层**必须落在滚动容器 `.scroll` 之内**（`overflow-y/x` 会裁掉越界部分）——
 *   自检 S20c 里是硬判据；所以 `.fsel-pop` 是**右对齐**展开的（`right:0`），
 *   因为这两个下拉都贴行尾，往右展开会被裁掉。
 *
 * @param {object} cfg
 *   wrapId / trigId / popId  元素 id（自检按 id 找，别随意改）
 *   optAttr                 选项标识属性名（`data-opt` / `data-proj`），
 *                           ⚠️ 不要用 `data-key` —— 那是筛选 chip 的，混了自检就找不准
 *   items                   [{ key, label, n }]
 *   cur                     当前 key
 *   placeholder             未选中时的占位文案
 *   title / allTitle        触发条 title / 「全部」项的 title
 *   onPick(key)             选中回调（本组件先关层再回调）
 * @returns {object} wrap 元素
 */
function makeSelect(cfg) {
  const open = openSel === cfg.wrapId;
  const wrap = dom.el("div", {
    class: "fsel-wrap push" + (open ? " is-open" : ""),
    id: cfg.wrapId,
  });

  let curLabel = cfg.placeholder;
  let curN = null;
  for (const it of cfg.items) {
    if (it.key === cfg.cur) {
      curLabel = it.label;
      curN = it.n;
    }
  }

  const trig = dom.el("div", {
    class: "fsel" + (cfg.cur ? " is-on" : ""),
    id: cfg.trigId,
    role: "button",
    tabindex: "0",
    "data-role": "seltrigger",
    "aria-expanded": open ? "true" : "false",
    title: cfg.title || "",
  });
  trig.appendChild(dom.el("span", { class: "fs-t" }, [curLabel]));
  if (curN !== undefined && curN !== null) {
    trig.appendChild(dom.el("span", { class: "fs-n mono" }, [String(curN)]));
  }
  trig.appendChild(dom.el("span", { class: "fs-cv" }, ["▾"]));
  wrap.appendChild(trig);

  const pop = dom.el("div", { class: "fsel-pop", id: cfg.popId });
  for (const o of cfg.items) {
    const it = dom.el("div", {
      class: "fopt" + (o.key === cfg.cur ? " is-on" : ""),
      role: "button",
      tabindex: "0",
      [cfg.optAttr]: o.key,
      "data-role": "selopt",
      title: o.key ? "只看「" + o.label + "」" : cfg.allTitle || "全部",
    });
    it.appendChild(dom.el("span", { class: "fo-t" }, [o.label]));
    if (o.n !== undefined && o.n !== null) {
      it.appendChild(dom.el("span", { class: "fo-n mono" }, [String(o.n)]));
    }
    binder.on(it, "click", () => {
      closeSelect();
      cfg.onPick(o.key);
    });
    pop.appendChild(it);
  }
  wrap.appendChild(pop);

  binder.on(trig, "click", () => {
    if (openSel === cfg.wrapId) closeSelect();
    else openSelect(cfg.wrapId);
  });

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
    if (refs.metaNote) refs.metaNote.style.display = "none";
    return;
  }
  const parts = [
    "契约 " + String(S.manifest.contract || "?"),
    "生成 " + fmtTime(S.manifest.generatedAt),
  ];
  if (S.manifest.psMajor) parts.push("PS " + S.manifest.psMajor);
  if (S.manifest.workspaceRoot) parts.push(S.manifest.workspaceRoot);
  refs.meta.textContent = parts.join("　·　");

  // 只有 1 个库时把话说明白（见 build() 里 refs.metaNote 的说明）。
  if (refs.metaNote) {
    const scopes = S.scopes || [];
    if (scopes.length < 2) {
      refs.metaNote.textContent =
        "镜像里目前只有 " + scopes.length + " 个库" +
        (scopes.length ? "（" + scopes.map((s) => s.label || s.id).join(" / ") + "）" : "") +
        " —— 其余库要由 VellumDesk 写进 manifest.scopes 才会出现";
      refs.metaNote.style.display = "block";
    } else {
      refs.metaNote.style.display = "none";
    }
  }
}

/* ------------------------------------------------------------- 筛选 chips */

/**
 * 改当前目录（**唯一的入口** —— 别处一律不许直接写 `S.group` / `S.sub`）。
 *
 * `S.group` / `S.sub` 仍然保留，但它们是 **`S.path` 的派生值**（`path[0]` / `path[1]`）：
 *   · 保留是因为任务库的项目下拉、日志、状态行都还在读它们；
 *   · **派生**是因为真相只能有一份 —— 两份各自被改就一定会分叉（这次改多层目录的初衷）。
 */
function setPath(arr) {
  S.path = (arr || []).filter(Boolean);
  S.group = S.path[0] || "";
  S.sub = S.path[1] || "";
  S.dirsAll = false; // 换目录 → 子目录折叠状态复位
}

/** 只按「当前目录（前缀匹配）」筛（**不含**来源）—— 来源行要基于它算。 */
function itemsInGroup() {
  if (!S.path.length) return S.items;
  return S.items.filter((it) => {
    const p = dirlib.pathOf(it);
    for (let i = 0; i < S.path.length; i++) if (p[i] !== S.path[i]) return false;
    return true;
  });
}

/** 三个筛选条件全上。 */
function visibleItems() {
  const out = itemsInGroup();
  if (!S.source) return out;
  return out.filter((it) => String((it.asset && it.asset.source) || "") === S.source);
}

/** 当前筛选的一句话描述（状态行用）。 */
function filterLabel() {
  const bits = S.path.slice();
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

/**
 * 画一行筛选 chips。`label` 为空则不画前缀。
 *
 * ⚠️ chips 装在 `.fchips`（`flex: 1 1 auto`）里而不是直接挂在行上 ——
 *    这样**行尾还能再挂一个下拉**（通用库的二级子类就是挂在同一行的最右侧），
 *    而 chips 自己会占满左侧剩下的宽度。
 * @returns {object} 行元素（调用方可继续往行尾 append）
 */
function makeFrow(label, chips, cls, onPick) {
  const row = dom.el("div", { class: "frow" + (cls ? " " + cls : "") });
  if (label) row.appendChild(dom.el("span", { class: "frow-lb" }, [label]));
  const box = dom.el("div", { class: "fchips" });
  for (const c of chips) {
    const chip = dom.el("div", {
      class: "fchip" + (c.on ? " is-on" : ""),
      role: "button",
      tabindex: "0",
      "data-key": c.key,
      title: c.key ? "只看「" + c.label + "」" : "看全部",
    });
    chip.appendChild(dom.el("span", {}, [c.label]));
    chip.appendChild(dom.el("span", { class: "fc-n mono" }, [String(c.n)]));
    binder.on(chip, "click", () => onPick(c.key));
    box.appendChild(chip);
  }
  row.appendChild(box);
  return row;
}

/* --------------------------------------------------------- 项目筛选下拉 */

/**
 * 任务库的「项目」筛选 —— 放在**顶部行、刷新按钮左侧**（用户 2026-10-11 指定）。
 *
 * 为什么单拎出来、不再用一排 chip：项目个数会随工作量一直长，一排 chip 很快把面板顶部撑满
 * （这次 UI 调整就是在给它减负）；而通用库的顶层只有「公司素材 / 我的收藏」，
 * 少而稳、点一下就到，所以那边**仍然保留按钮**。
 *
 * ⚠️ 它读写的是 **`S.group`** —— 而 `S.group` 现在是 `S.path[0]` 的派生值，
 *    所以这里**必须走 `setPath([k])`**，不能直接赋值（否则 S.path 与 S.group 会分叉）。
 * ⚠️ 只在**任务库**出现（`S.kind === "task"`）：形态判定在 `mirror.scopeKind()`，
 *    不靠 scope id 硬编码 —— 软件侧将来加库、改名都不影响这里。
 */
function renderProjSel() {
  if (!refs || !refs.projslot) return;
  closeSelect(); // 重建 = 关闭（否则 openSel 会指向已被移除的节点）
  dom.clear(refs.projslot);
  if (!S || S.kind !== "task") return;

  const items = projectOptions();
  // 只有一个项目时它**不构成筛选**（一行下拉只为了说"这里只有一个项目"是纯噪音）。
  // 与「来源」行同一条判断。
  if (items.length <= 1) return;

  refs.projslot.appendChild(
    makeSelect({
      wrapId: "vt-lib-projwrap",
      trigId: "vt-lib-projsel",
      popId: "vt-lib-projpop",
      optAttr: "data-proj",
      items: items,
      cur: S.group || "",
      placeholder: "全部项目",
      allTitle: "所有项目",
      title: "只看某个项目",
      onPick: (k) => {
        setPath(k ? [k] : []); // 换项目 → 任务包筛选复位（不同项目下可能有同名任务包）
        S.source = "";
        refreshAfterFilter();
      },
    })
  );
}

/**
 * 项目下拉的选项。
 * ⚠️ **优先读镜像原始 JSON** 的 `projects[]`（这样"还没有素材的空项目"也能选到），
 *    读不到再退回已展平出来的顶层分组。
 */
function projectOptions() {
  const counts = {};
  for (const it of S.items) {
    const g = it.group || "未分组";
    counts[g] = (counts[g] || 0) + 1;
  }
  const out = [{ key: "", label: "全部项目", n: S.items.length }];
  const raw = S.scopeData && S.scopeData.projects ? S.scopeData.projects : null;
  if (raw && raw.length) {
    for (const p of raw) out.push({ key: p.name, label: p.name, n: counts[p.name] || 0 });
  } else {
    for (const t of mirror.groupTree(S.items)) out.push({ key: t.name, label: t.name, n: t.count });
  }
  return out;
}

/** 改完筛选条件后的统一收尾（重画下拉 + chips + 网格 + 状态行）。 */
function refreshAfterFilter() {
  renderProjSel(); // 项目下拉的触发条文案跟着 S.group 变（它复用同一个筛选条件）
  renderFilters();
  renderGrid(); // 内部会 ++loadToken；缩略图走 mirror 的缓存，不会重新读盘
  status("筛选：" + filterLabel() + "（" + visibleItems().length + " 张）");
}

/**
 * 重画整个筛选区（v0.9.9：**面包屑下钻**，用户 2026-10-17 拍板的"方向 B"）。
 *
 * 结构（从上到下，**都固定在网格上方、不随网格滚动**）：
 *   ① 面包屑 —— **只在下钻后出现**；根层不画（只显示一个「全部」是噪音）
 *   ② 子目录行 —— 根层就是原来那排一级 chips（**长相不变**）；深层是当前节点的 children
 *   ③ 来源行 —— 保持原样（通用库里通常因"与顶层分组重复"而不画）
 *
 * 🔴 三条来自 docs/55 §九 的硬约束（都是高度预算逼出来的，别推翻）：
 *   · **根层与叶子层看到的东西和旧版一致** —— 绝大多数时候用户就停在这两层；
 *   · **子目录超过 4 个折叠**成「还有 N 个」—— 子目录数量由软件侧决定，
 *     10 个 = 320px 会把网格挤没；
 *   · 深层**不再单独画「全部」chip** —— 回上级交给面包屑（两处各一个「全部」，点哪个都心虚）。
 *
 * ⚠️ 判断"当前在哪一层"一律用 `S.path`（真相），**不要用 `S.group`/`S.sub`** ——
 *    那两个是派生值，只留给任务库下拉 / 日志 / 状态行读。
 */
function renderFilters() {
  dom.clear(refs.bar);
  closeSelect(); // 重建筛选区 ⇒ 所有下拉都关掉（否则触发条被换掉、浮层状态还留着）

  const tree = mirror.groupTree(S.items);
  const srcs = mirror.sourceSummary(itemsInGroup());

  const path = (S.path || []).slice();
  /* 路径解析不到（软件侧删了目录）时**不在这里改状态** —— 渲染函数只管画，
     收拾残局是 `pruneFilters()` 的职责（它下一轮就会把无效段截掉）。 */
  const node = path.length ? dirlib.resolve(tree, path) : null;
  const livePath = node ? path : [];
  const atRoot = !livePath.length;
  /* 面包屑右端那句「第 N/M 层」用**整棵树**的最大层数算（不是当前子树）——
     否则进到叶子层时会显示成「第 3/3 层」，而旁边的面包屑明明还有上级，
     两句话自相矛盾。 */
  const depthAll = dirlib.maxDepth(tree) || 1;

  /* ① 面包屑
     ⚠️ 第 0 段是**库名**（不是「全部」）—— 根层本来就等于整个库，
        写「全部」等于给同一件事两个名字（用户对过 mock：`通用库 › 品牌视觉 › Logo`）。 */
  const bc = dirlib.breadcrumb(dom, binder, {
    path: livePath,
    rootLabel: S.tabLabel || "全部",
    levelText: livePath.length
      ? "第 " + livePath.length + "/" + depthAll + " 层"
      : "",
    onPick: (idx) => {
      setPath(livePath.slice(0, idx)); // 下标 0 = 回根（整个库）
      S.source = "";
      refreshAfterFilter();
    },
  });
  if (bc) refs.bar.appendChild(bc);

  /* ② 子目录（**整行**：📁 + 名字 + N 项，以 mock 为准）
     ⚠️ 任务库的根层**不画**：项目筛选已在顶部行（`renderProjSel`），
        这里再列一遍项目就是同一个条件出现两次。
     任务库也没有更深的层级（`flattenTask` 的 `groupPath` 只到项目）⇒ kids 恒空。 */
  const kids = node
    ? (node.children || [])
    : (S.kind === "task" ? [] : tree);

  const dirs = dirlib.dirRow(dom, binder, {
    kids: kids,
    expanded: !!S.dirsAll,
    onPick: (k) => {
      setPath(atRoot ? [k] : livePath.concat([k]));
      S.source = "";
      refreshAfterFilter();
    },
    onExpand: (v) => {
      S.dirsAll = !!v;
      renderFilters(); // 只重画筛选区，网格不动
    },
  });
  if (dirs) refs.bar.appendChild(dirs);

  /* 什么都没有可画时，至少说一句"共几张" —— 否则这块是纯空白，看着像坏了 */
  if (!bc && !dirs && srcs.length <= 1) {
    refs.bar.appendChild(
      dom.el("span", { class: "lib-count mono" }, ["共 " + S.items.length + " 张"])
    );
    return;
  }

  /* ③ 来源（契约 §5.4 加法 ② 的可选 asset.source）
     🔴 v0.3.4：**通用库里这一行不再画** —— 用户 2026-10-11 报
     「一级目录激活『全部』时，下方出现的来源文字和按钮和上面重复了」。
     原因：通用库的顶层分组（公司素材 / 我的收藏）**就是** source（company / user）
     的另一种叫法 —— 一级选「全部」时两行会同时出现，说的其实是同一件事。
     判据用**覆盖关系**而不是硬写 `kind === "brand"`：万一将来顶层分组不再按来源分，
     这一行会**自己回来**，不会静默丢掉一个筛选维度。
     （注意：来源**角标**是另一回事，它由 `showSrc` 单独控制，不受这里影响。） */
  /* 判据**不是**"分组名里含来源标签" —— 那是靠命名的巧合，真机上第一版就这么漏了：
     软件侧的顶层分组叫「**个人收藏**」而不是「我的收藏」，`indexOf("我的")` 直接落空。
     改成问本质：把库**按顶层组切**和**按来源切**，是不是同一个划分？
     （每个顶层组里只有一种来源，且组数 === 来源种类数。）是 ⇒ 这一行纯粹是上面的复述。 */
  const srcRedundant = (() => {
    if (tree.length < 2 || tree.length !== srcs.length) return false;
    for (const t of tree) {
      const inT = (S.items || []).filter((it) => it.group === t.name);
      if (mirror.sourceSummary(inT).length !== 1) return false;
    }
    return true;
  })();
  if (srcs.length > 1 && !srcRedundant) {
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

  /* 目录路径：**截断到仍然存在的最长前缀**，不能整体清空。
     ────────────────────────────────────────────────────────────────
     🔴 这条是**多层目录独有的坑**（旧版只有两层时"清空"和"截断"看不出差别）：
        用户在「公司素材 › 节日 › 春节」里，软件侧下一版把中间那层「节日」删了 ⇒
        如果整体清空，用户会被**无声地弹回顶层**，还以为自己点错了。
        截断到「公司素材」则是"退一步但仍然在原来的大目录里"，打断最小。
     ⚠️ 解析用的是 `dirlib.resolve()` —— 与渲染、筛选**同一套**判据，
        否则会出现"面包屑说在这里、网格却是空的"。 */
  const full = (S.path || []).slice();
  let keep = 0;
  let level = tree;
  for (const name of full) {
    let hit = null;
    for (const n of level) if (n.name === name) hit = n;
    if (!hit) break;
    keep++;
    level = hit.children || [];
  }
  if (keep !== full.length) setPath(full.slice(0, keep));

  // 展开态**不需要在这里清**：它存在 `S.dirsAll` 里，`setPath()` 会复位；
  // 而下拉（项目）的展开态存在模块级的 `openSel` 里，`renderProjSel()` / `renderFilters()`
  // 开头都会 `closeSelect()`。
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

/* ---------- 瀑布流的"缩略图盒子"尺寸（v0.3.4） ---------- */

/** 缩略图的高宽比（h / w）。算不出来返回 0。 */
function thumbRatio(a) {
  const w = Number(a && a.width);
  const h = Number(a && a.height);
  return w > 0 && h > 0 ? h / w : 0;
}

/**
 * 盒子高度封顶/保底。
 * 不封顶：一张 1:5 的长图会把整列拉得极长，另一列只剩一小截；
 * 不保底：5:1 的扁图会变成一条缝，名称和元信息全挤在一起。
 */
const THUMB_MIN_H = 72;
const THUMB_MAX_H = 380;

function clampThumbH(h) {
  return Math.max(THUMB_MIN_H, Math.min(Math.round(h), THUMB_MAX_H));
}

/** 盒子高度（px）；算不出来返回 0（调用方回落 CSS 保底 120px）。 */
function thumbBoxH(a, imgW) {
  const r = thumbRatio(a);
  return r ? clampThumbH(imgW * r) : 0;
}

/**
 * 同上，但**多一条回落**：素材自己没有像素尺寸时（PSD / PDF / 视频 —— 契约 §5.4 允许 null），
 * 改用**缩略图自身的比例**（`naturalWidth/Height`）来算。
 * 没有这一步，那些卡片会永远停在 CSS 保底的 120px，在一屏瀑布流里格格不入
 * （而它们的缩略图恰恰是**有**比例信息的）。
 * ⚠️ 图片没加载完时 `naturalWidth` 为 0 ⇒ 返回 0；`loadThumbs` 读完会再触发一次重算。
 */
function thumbBoxHFor(c, imgW) {
  let r = thumbRatio(c && c.asset);
  if (!r && c && c.img && c.img.naturalWidth > 0 && c.img.naturalHeight > 0) {
    r = c.img.naturalHeight / c.img.naturalWidth;
  }
  return r ? clampThumbH(imgW * r) : 0;
}

/** 卡片信息区（名称 + 元信息两行 + 卡片下内边距）的估算高度 —— 只用于"投放给哪一列"。 */
const CARD_FOOT_H = 56;

function makeCard(item, showSrc, imgW) {
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
  const thH = thumbBoxH(a, imgW);
  if (thH) th.style.height = thH + "px";
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

  // `estH` 只用于"投放给哪一列"的估算；`fixed` = 高度已由 asset 宽高算准，
  // 图片加载后就不必再校正（见 loadThumbs）。
  return { card: card, img: img, ph: ph, th: th, asset: a, estH: (thH || 120) + CARD_FOOT_H, fixed: !!thH };
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

  /* ---- 瀑布流分派（v0.3.4）----
     两列各自纵向堆叠，每张卡片投给"当前累计高度较小"的那一列。
     列宽得先知道才能算缩略图盒子高度 ⇒ 量 `.lib-body`（此刻它已挂在 DOM 上）；
     首次布局尚未完成量到 0 时用面板默认宽度兜底 —— **不会**因为量不到就退回旧布局。 */
  // 盒子实际宽度 = 列宽 − 卡片左右内边距 = (bodyW + 10)/2 − 10 = bodyW/2 − 5
  // （`.lib-grid` 带 `margin: 0 -5px`，所以列比 body 的一半还宽 5px）
  const bodyW = (refs.body && refs.body.offsetWidth) || 0;
  const imgW = Math.max(60, Math.round((bodyW || 412) / 2) - 5);
  const cols = [dom.el("div", { class: "lib-col" }), dom.el("div", { class: "lib-col" })];
  const acc = [0, 0];
  for (const it of list) {
    const k = acc[0] <= acc[1] ? 0 : 1;
    const made = makeCard(it, showSrc, imgW);
    acc[k] += made.estH;
    refs.cards.push(made);
    cols[k].appendChild(made.card);
  }
  grid.appendChild(cols[0]);
  grid.appendChild(cols[1]);
  // 排障用：两列的累计高度（分派均不均衡，一眼看得出来）
  grid.setAttribute("data-cols", Math.round(acc[0]) + "/" + Math.round(acc[1]));
  refs.body.appendChild(grid);
  refs.grid = grid;

  loadThumbs(++loadToken);
  // ⚠️ 上面那个 `imgW` 是**推算**的（此刻布局还没落定，盒子量不出宽度）。
  //    布局一落定就用**每个盒子自己的 offsetWidth** 重算一遍 ——
  //    高度严格等于"盒宽 × 素材比例"，不依赖任何宽度推导（自检 S27 也是这么判的）。
  relayoutThumbs(++layoutToken);
}

/* ---------- 布局落定后，按真实盒宽重算缩略图高度（v0.3.4） ---------- */

let layoutToken = 0;

/**
 * 等真实布局落定，再用**盒子自己的宽度**把高度重算一遍。
 *
 * 为什么不省掉这一步：`.lib-grid`(负外边距) → `.lib-col`(50%) → `.card`(100% + 内边距)
 * 三级下来，宽度推导差 5px，乘上图片比例就是十几像素 —— 正是"推算 vs 实测"的经典翻车点。
 * ⚠️ 用轮询而不是"让固定两帧"：UXP 布局是异步的，让帧是赌注（老纪律）。
 * 令牌作用与 `loadThumbs` 同源：重渲染 / 切库 / 卸载后立刻停手。
 */
async function relayoutThumbs(token) {
  for (let i = 0; i < 20; i++) {
    if (token !== layoutToken || !refs || !refs.cards) return;
    let seen = 0;
    let done = 0;
    let firstW = 0;
    for (const c of refs.cards) {
      if (!c.th) continue;
      const w = c.th.offsetWidth || 0;
      if (!w) continue;
      seen++;
      if (!firstW) firstW = w;
      const h = thumbBoxHFor(c, w);
      if (h) {
        c.th.style.height = h + "px";
        done++;
      }
    }
    if (seen > 0 && done > 0) {
      // 排障用：这次真正量到的盒宽（与第一版"推算"值对比，一眼看得出来）
      if (refs.grid && refs.grid.setAttribute) {
        refs.grid.setAttribute("data-boxw", String(firstW));
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
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
      // asset 没给像素宽高 ⇒ 盒子高度还是 CSS 保底 120px，用缩略图自身的比例补上（只做一次）
      if (!c.fixed && c.th && c.img.naturalWidth > 0 && c.img.naturalHeight > 0) {
        const w = c.th.offsetWidth || 0;
        if (w > 0) {
          c.th.style.height =
            clampThumbH(w * (c.img.naturalHeight / c.img.naturalWidth)) + "px";
          c.fixed = true;
        }
      }
    } else {
      c.ph.textContent = r && r.webp ? "格式不支持" : "预览失败";
      if (r && r.error) {
        // 只记一次，别在轮询里刷屏
        c.card.setAttribute("title", c.asset.name + "\n" + r.error);
      }
    }
  }
  // 图都读完了 ⇒ 那些"素材本身没尺寸、要靠缩略图比例"的卡片这时才拿得到比例，重算一次。
  // （有 asset 尺寸的卡片不受影响：两次算出来是同一个高度，不会跳。）
  if (token === loadToken && refs) relayoutThumbs(++layoutToken);
}

/* --------------------------------------------------------------- 详情 */

function renderFoot() {
  dom.clear(refs.foot);
  const sel = S.selected;
  if (!sel) {
    refs.foot.appendChild(
      dom.el("span", { class: "lf-hint" }, ["在下面选一张素材 —— 右侧会出现「置入」"])
    );
    return;
  }
  const a = sel.asset;
  const plan = mirror.insertPlan(a);
  const canIns = !!(plan.supported && !a.missing);

  /* 不能置入的原因（原文件丢失 / 类型不支持）：进 `title` 与按钮置灰，
     **不占版面** —— 它只在真正要置入时才重要。 */
  const warn = a.missing
    ? "原文件已丢失，无法置入"
    : (!plan.supported ? plan.note : "");

  /* ════════════════════════════════════════════════════════════════════
     v0.9.7（用户 2026-10-17 拍板）：**去掉落点九宫格**
     ----------------------------------------------------------------
     动机：同事反馈落点几乎没人用。省下来的主力是**九宫格那 66px**，
     不是按钮宽度 —— 面板从 150px 压到约 50px，580 高的面板下网格多出 100px。
     形态：左＝素材名 + 一行元信息；右＝「置入」两字（44px）。
     ⚠️ 原来占版面的「位置 / 标签 / 原图路径」**全部进 title**（hover 看）——
        平时不看，排障时要能拿到；删掉它们比删落点更划算。
     ⚠️ 别为了"信息更全"往回加行 —— 这个面板的硬指标就是 ≤50px。
     ════════════════════════════════════════════════════════════════════ */
  const tips = [];
  if (sel.crumb && sel.crumb.length) tips.push("位置：" + sel.crumb.join(" › "));
  if (a.tags && a.tags.length) tips.push("标签：" + a.tags.join(" / "));
  if (a.absPath) tips.push("原图：" + a.absPath);
  if (warn) tips.push("⚠️ " + warn);
  const tipText = tips.join("\n");

  const row = dom.el("div", { class: "lf-main" });
  const left = dom.el("div", { class: "lf-l" });

  left.appendChild(dom.el("span", { class: "lf-n", title: tipText }, [a.name]));

  const bits = [];
  const d = fmtDims(a);
  if (d) bits.push(d);
  const sz = fmtSize(a.size);
  if (sz) bits.push(sz);
  if (a.role) bits.push(a.role);
  if (a.source) bits.push("来源：" + mirror.sourceLabel(a.source));
  left.appendChild(
    dom.el("span", { class: "lf-m mono", title: tipText }, [bits.join(" · ") || "—"])
  );
  row.appendChild(left);

  const btn = dom.el("div", {
    class: "lf-btn" + (canIns ? "" : " is-off"),
    id: "vt-lib-insert",
    role: "button",
    tabindex: "0",
    title: warn || plan.note || "置入到画布（居中）",
  }, ["置入"]);
  binder.on(btn, "click", () => doInsert());
  row.appendChild(btn);

  refs.foot.appendChild(row);
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
    S.kind = "unknown";
    renderMeta();
    renderTabs();
    renderProjSel();
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
    mirror.libraryScopes(S.manifest.scopes || []).map((s) => s.id + ":" + s.revision).join(",") !==
      mirror.libraryScopes(m.scopes).map((s) => s.id + ":" + s.revision).join(",");
  S.manifest = m;
  /* 🔴 `manifest.scopes[]` 里**不是每个库都该出现在素材库页**：
     模板库（`tpl`）有自己的单列入口，混进来只会多一个空 tab 让人以为坏了。
     过滤规则收在 `mirror.libraryScopes()` 里 —— 自检 S20 用的是**同一个函数**算期望值，
     否则"按 scopes 数 tab"会在软件侧一写 tpl 就红。 */
  S.scopes = mirror.libraryScopes(m.scopes);

  /* 契约 §5.7 的建议：被排除掉的 scope 在 boot.log 留**一行痕**。
     为什么值得写这行：将来有人翻日志看到"manifest 里有 tpl、插件却没有这个 tab"，
     第一反应会是"丢库了"（历史上真发生过一次误判）。留痕 = 有据可查。
     ⚠️ 只在 scope 列表**变了**的时候记，否则每次轮询都会刷一行。 */
  const droppedScopes = (m.scopes || [])
    .filter((x) => !S.scopes.some((y) => y.id === x.id))
    .map((x) => x.id);
  if (droppedScopes.length && changedScopeList) {
    await log.appendLog(
      "library 已排除 scope：" + droppedScopes.join(",") +
      "（模板库走「新建稿」页，不进素材库 —— 契约 §5.7）"
    );
  }

  let tabId = S.tabId;
  if (!tabId || !scopeById(tabId)) {
    tabId = pickTab(S.scopes);
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
    S.kind = "unknown";
    closeSelect();
    renderProjSel();
    renderFilters();
    renderMessage("读「" + (sc.label || sc.id) + "」失败", r.error, true);
    status("素材库：" + r.error);
    await log.appendLog("library scope FAILED id=" + sc.id + " file=" + sc.file + " err=" + r.error);
    return;
  }
  try {
    S.scopeData = r.data;
    S.revision = r.revision;
    S.kind = mirror.scopeKind(r.data);
    S.items = mirror.flatten(sc.id, r.data);
    S.tabLabel = sc.label || sc.id;
    // 刷新后把已经失效的筛选条件清掉（切库时会先复位，这里兜住"自动刷新"那条路）
    pruneFilters();

    closeSelect();   // 数据换了 ⇒ 旧的下拉状态一律作废
    renderProjSel(); // 项目下拉（仅任务库）：选项与计数都跟着这一版数据走
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
    " rev=" + r.revision + " items=" + S.items.length + " kind=" + S.kind +
    " groups=" + groupsSig() +
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
    setPath([]); // 换库 ⇒ 目录回到根（path + group/sub + 折叠态一起复位）
    S.source = "";
    S.selected = null;
    closeSelect();
    const sc = scopeById(id);
    S.tabLabel = sc ? sc.label : id;
    renderTabs();
    // 项目下拉属于**上一个库**的形态，先清掉；真正的内容由 loadScope 填
    S.kind = "unknown";
    renderProjSel();
    renderFoot();
    loadToken++; // 作废在途的缩略图加载
    await loadScope("switch");
    await savePref();
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
        // ⚠️ 把"请求的是哪一条"一并说出来 —— 用户报障时这一行就是能直接转给软件侧的原始读数。
        //    v0.3.5 的 `not_found` 就是靠 scope+id 一眼看出"handoff 只认任务库"。
        "　〔请求：scope=" + sel.scope + " · id=" + a.id + "〕" +
        (res.timedOut ? "　—— 确认 VellumDesk 在运行、且已开启插件联动" : "")
      );
      return { ok: false, reason: "handoff-timeout", error: res.error };
    }

    /* ---- ③ 原图到手：拿到 Entry（置入必须靠它换会话令牌） ----
       ⚠️ `fetchIncoming` 内部会**再等一小会儿文件落盘** —— 软件侧很可能"先写 res、后拷文件"。
          🔴 而且这条失败文案必须**说准**：只有文件真的在才能说"已就位"。
          上一版不管三七二十一就说「原图已就位但拿不到句柄」，真机上文件压根没到
          （res.json 报 `ok:true / size=627927`，`handoff/` 里却没有那个文件）——
          **判据正确 ≠ 反馈正确**：一句错位的描述会把排查方向直接带偏。 */
    const inc = await handoff.fetchIncoming(res.data);
    await log.appendLog(
      "library handoff incoming ok=" + inc.ok + " name=" + JSON.stringify(inc.name) +
      " bytes=" + inc.byteLength + " entry=" + !!inc.entry + " waited=" + inc.waited +
      " res=" + JSON.stringify(inc.res) +
      (inc.error ? " err=" + inc.error : "")
    );
    if (!inc.ok) {
      const r = inc.res || {};
      const claimedOk = r.ok === true;
      status(
        "✗ 取不到可置入的文件：handoff/" + inc.name + " 找不到（等了 " + inc.waited + "ms）" +
        "　—— VellumDesk 回复 ok=" + (r.ok === null || r.ok === undefined ? "?" : r.ok) +
        (r.size !== null && r.size !== undefined ? " · size=" + r.size : "") +
        (claimedOk
          ? "，但文件没落盘。请它按「**先拷文件、后写 res.json**」的顺序来（契约 §六）"
          : (r.error ? "　它报的错：" + r.error : "，且没给原因")) +
        (inc.error ? "　〔本机读数：" + inc.error + "〕" : "")
      );
      return { ok: false, reason: "incoming", error: inc.error, waited: inc.waited };
    }

    /* ---- ④ 置入 + 精确落点 ----
       🔴 v0.3.3：改用 `targetRect`（**目标矩形**），不再用 `offset`。
       原因：`offset` 的前提是"素材在画布上就是它的像素宽高"，而 PS 的置入是
       **按物理尺寸（ppi 换算）**放的 —— 真机实测源图 1500 px @300ppi 置入
       72ppi 画布后只剩 360 px（= 1500 × 72/300），尺寸与位置一起错。
       现在改成"置入 → 量实际 → scale → translate → 再量"，与 ppi 完全无关。 */
    const ai = anchorInfo(a);
    const placed = await ps.placeFile(inc.entry, {
      verify: "change",
      targetRect: ai.ok ? ai.rect : null,
      // v0.3.5：缺素材尺寸时，退回"用置入后的实际尺寸只定位"（见 ps.js 的 anchorPlace 分支）
      anchorPlace:
        !ai.ok && ai.needAnchorPlace
          ? { anchor: S.anchor, docW: ai.docW, docH: ai.docH }
          : null,
      expectRect: ai.ok ? ai.rect : null,
    });
    /* ---- ⑤ 按素材名给图层命名（v0.3.6）----
       PS 置入时用的是**被置入文件的名字**，而契约 §六 规定交接文件固定叫
       `incoming.<ext>` ⇒ 每个新图层都叫 `incoming`，图层面板里分不清谁是谁。
       这里改读镜像里的 `asset.name`（去扩展名；重名加 ` (n)`，用户 2026-10-11 拍板）。
       ⚠️ 只在图层**真的多出来**时才改 —— 否则万一置入失败，会把用户**原有的**图层改掉。 */
    let named = null;
    if (placed.ok && placed.changed) {
      named = await ps.renameInsertedLayer(a);
      await log.appendLog(
        "library layer-name base=" + JSON.stringify(named.base) +
        " want=" + JSON.stringify(named.want) +
        " got=" + JSON.stringify(named.got) +
        " ok=" + named.ok + (named.ambiguous ? " ambiguous=true" : "") +
        (named.error ? " err=" + named.error : "")
      );
    }

    await log.appendLog(
      "library insert via=placeEvent ok=" + placed.ok + " changed=" + placed.changed +
      " layers=" + placed.layersBefore + "→" + placed.layersAfter +
      " bytes=" + inc.byteLength + " file=" + JSON.stringify(placed.file || inc.name) +
      " anchor=" + S.anchor +
      (ai.ok ? " off=" + ai.off.offsetX + "," + ai.off.offsetY +
        " expect=" + ai.rect.left + "," + ai.rect.top + "," + ai.rect.right + "," + ai.rect.bottom : " off=-") +
      (placed.fix
        ? " fix=" + (placed.fix.ok ? "ok" : "FAIL") +
          (placed.fix.before ? " raw=" + placed.fix.before.left + "," + placed.fix.before.top + "," +
            placed.fix.before.right + "," + placed.fix.before.bottom : "") +
          " steps=[" + ((placed.fix.steps || []).join(" ") || "无") + "]" +
          (placed.fix.error ? " err=" + placed.fix.error : "")
        : "") +
      (placed.rect ? " landed=" + placed.rect.left + "," + placed.rect.top + "," +
        (placed.rect.left + placed.rect.w) + "," + (placed.rect.top + placed.rect.h) +
        " hit=" + (placed.rect.hit === undefined ? "-" : placed.rect.hit) : "") +
      (placed.token ? " token=" + placed.token : "") +
      (placed.error ? " err=" + placed.error : "")
    );
    if (placed.ok && placed.changed) {
      const fx = placed.fix;
      const rawWH = fx && fx.before
        ? Math.round(fx.before.right - fx.before.left) + "×" + Math.round(fx.before.bottom - fx.before.top)
        : null;
      status(
        // 显示的是**图层名**（= 素材名去扩展名，v0.3.6）；命名失败时回落到素材名
        "✓ 已置入「" + ((named && named.want) || a.name) + "」" +
        "· 落点[" + ps.anchorLabel(S.anchor) + "]" +
        (named && !named.ok
          ? "　⚠️ 图层名没设上（" + (named.error || "未知") + "）"
          : "") +
        (placed.rect
          ? "　" + placed.rect.left + "," + placed.rect.top +
            "（" + placed.rect.w + "×" + placed.rect.h + "）" +
            (placed.rect.hit === true ? " 命中 ✓" : placed.rect.hit === false ? " ⚠️ 与目标矩形差 >1px" : "")
          : "") +
        // PS 的置入是**按 ppi 换算**的 ⇒ 原始落下的尺寸常与素材像素尺寸不同，
        // 这一步校正必须让用户看得见（否则他会以为"尺寸还是不对"）。
        (fx && fx.scaled && rawWH ? "　原置入 " + rawWH + " → 已按素材像素尺寸校正" : "") +
        (fx && !fx.ok ? "　⚠️ 尺寸校正失败：" + (fx.error || "未知") : "") +
        "　图层数 " + placed.layersBefore + " → " + placed.layersAfter +
        "　" + (Date.now() - t0) + "ms"
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
    /* ⚠️ 老 pref 里的 `anchor` 字段**故意忽略**（落点功能 v0.9.7 已移除） */
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
    // 当前库的**形态**（task / brand / unknown）—— 由 mirror.scopeKind() 从镜像结构判定，
    // 决定"顶层分组用按钮还是下拉、有没有项目筛选"。**不靠 scope id 硬编码。**
    kind: "unknown",
    /* 当前目录（**真相**）。`group` / `sub` 是它的派生值（path[0] / path[1]），
       只为兼容任务库下拉、日志、状态行而保留 —— **写的时候一律走 `setPath()`**。 */
    path: [],
    group: "",
    sub: "",
    /* 子目录超过 `dirlib.MAX_VISIBLE` 时是否已展开（点「还有 N 个」置 true）。 */
    dirsAll: false,
    source: "",
    anchor: FIXED_ANCHOR, // 固定居中；落点 UI 已移除（见 FIXED_ANCHOR 注释）
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
