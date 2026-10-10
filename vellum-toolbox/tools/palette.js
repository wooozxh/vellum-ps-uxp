/*
 * tools/palette.js —— 调色板（M1）
 * ===========================================================================
 * 功能：
 *   品牌色区 —— 6 个固定色块（**当前是占位色**，等品牌 HEX 定了替换 DEFAULT_BRAND）
 *   我的颜色 —— 用户自己存的常用色，落在 PluginData/palette.json
 *   取用     —— 左键 = 前景色；Shift+左键 = 背景色；
 *               **Alt+左键 = 用该色填充当前图层 / 选区**（v0.2.2 新增，不改前景/背景色）；
 *               右键 / ✕ = 删除（仅「我的颜色」）
 *
 * 视觉（本版重做）：design-demos/B-native-pro.html 方向 B
 *   fgbg 卡片（当前前景/背景色叠块 + HEX 读数）+ 品牌色 3 列 + 我的颜色 4 列
 *   + hover 浮层提示 + 操作提示条。落地评审见 docs/14。
 *
 *   ⚠️ 与设计稿**刻意不同**的一处（按用户「以本会话需求为准」）：
 *      设计稿交互是「左键设前景 / 右键弹菜单（设背景·删除）/ X 键删除」；
 *      本项目沿用既定交互「左键前景 / Shift+左键背景 / Alt+左键填充 / 右键或 ✕ 删除」。
 *      理由是这套已经过自检覆盖（S3/S4/S6），且 shift / alt 语义在 PS 里更顺
 *      （PS 自己就是 Alt+Backspace = 用前景色填充）。
 *
 * 设计要点
 *   1. 每次设色都**回读自证**（读回值写进 boot.log），不是"点了就说成功"。
 *      判据照抄 lib/ps.js：回读命中 **且** 与设置前不同 —— 后者防的是
 *      "测试色恰好等于原值 → 看着成功其实没设"的假阳性。
 *   2. 颜色是**应用级**的，不依赖文档：没打开任何文档时调色板照常可用（docs/10 §四）。
 *      但**填充不是** —— 填充必须有文档 + 活动图层，没有就给出可读的拒绝理由。
 *   3. unmount 必须解绑 + 卸载时重新渲染，避免监听器叠加（docs/10 §四）。
 *   4. 色块颜色**直接写 background-color**，不用 CSS 变量 --c ——
 *      CSS 自定义属性在最低支持版本（PS 2024 / UXP 7）上的行为见 docs/13，
 *      这里不押注，求稳。
 *
 * ===========================================================================
 * v0.2.2 —— 悬停浮层重做（用户报「鼠标在色块上移动时色值标签疯狂刷新闪烁」）
 * ===========================================================================
 * 旧版写法：**每个色块各自 mouseover 显示 + 各自 mouseout 隐藏**。
 * 两处致命伤：
 *   ① mouseover/mouseout 在指针于「色块 ↔ 它的子元素（描边环 .sw-ring /
 *      删除叉 .sw-del）」之间移动时会**成对触发** → show/hide 高频交替 → 标签闪烁。
 *   ② 浮层默认放在色块正上方，第一行色块的浮层被 clamp 到 top:0，
 *      **正好压在色块自身上**；一旦浮层抢到指针（`pointer-events:none` 在 UXP 里
 *      是否生效我们没有验证），就形成
 *      「浮层压住色块 → 色块失焦 → 浮层消失 → 色块复得焦点 → 浮层又出现」
 *      的**振荡回路** —— 这才是"疯狂"的来源。
 *
 * 新版四条纪律（缺一条都可能复发，改动前先读这段）：
 *   ① **单一活动源**：只有 `mouseover` 能改变「当前悬停色块」；
 *      **色块自己的 mouseout 不隐藏任何东西**。隐藏只由两条路触发：
 *        · 面板根节点上的 mouseover，且 target **不在**当前活动色块内部
 *          （= 指针移到了非色块区域）→ 延时确认后隐藏；
 *        · 根节点 mouseout 且 relatedTarget 为空（≈ 指针离开整个面板）。
 *      这样"子元素造成的成对事件"天然无害 —— 它们只会命中"在活动色块内部"这一条。
 *   ② **幂等**：活动色块没变就一个字节都不写（不改 class、不改文本）→
 *      再密的重复事件也不产生任何重绘。
 *   ③ **浮层永不覆盖色块**：纵向一律落在**网格之外**（色块在网格上半 → 浮层在上方；
 *      下半 → 在下方），横向居中并夹在容器内。即便浮层真抢到指针，
 *      它下面也永远是网格之外的空白，振荡回路在物理上不成立。
 *   ④ **让帧后量**：UXP 的布局是异步的（见 lib/cssprobe.js 头部），
 *      浮层从 display:none 变可见的同一同步块里量不到尺寸，
 *      所以先用**估算尺寸**立刻摆到位（避免闪现到左上角），再 await settle()
 *      用实测尺寸精确校正。
 *
 * 回归守护：`selfcheck S15`（浮层矩形**不得与任何色块矩形相交** + sync/settled 双读数）。
 *
 * ===========================================================================
 * v0.2.3 —— 填充按图层类型分派（用户报「填充不能用」）
 * ===========================================================================
 * 用户截图：PS 弹 `vellum_toolbox: 命令"填充"当前不可用。`
 * 真机日志（图层「矩形 1」）：
 *   attempts=[fillColor=已执行/像素无变化 fgFallback=已执行/像素无变化]
 *   → 命令没抛错，像素一个没变，PS 自己弹了个框。
 *
 * 归因：**形状图层是内容图层**（UXP `kind === "solidColor"`），
 * PS 的「填充」命令对内容图层本来就不可用 → 既不改像素又弹框。
 *
 * 本版改动：
 *   · 分派下沉到 `lib/ps.js fillLayer()`（判 kind → 像素族走 fill、内容族走改内容色）
 *   · 内容族**绝不**退到 fill（那正是弹框的来源）
 *   · 失败原因**露在面板状态行上** —— v0.2.2 只写日志，用户只看到 PS 的框，等于没反馈
 *
 * 回归守护：`selfcheck S16`（像素族，临时文档像素回读）+ `S17`（内容族，临时文档里
 * 建一个纯色填充图层再改色，验像素回读）。
 */

const dom = require("../lib/dom.js");
const ps = require("../lib/ps.js");
const store = require("../lib/store.js");
const log = require("../lib/log.js");
const icons = require("../lib/icons.js");

const PALETTE_FILE = "palette.json";

/**
 * 内置默认品牌色 —— ⚠️ **6 个占位色**，等用户给品牌 HEX 后整段替换即可。
 * 放在代码里（不在 PluginData）：它属于"产品默认值"，不是用户数据。
 * PluginData 里的 palette.json 只存「用户自定义」，默认值永远可回退。
 */
const DEFAULT_BRAND = [
  { id: "brand-1", name: "品牌主色（占位）", hex: "#E60012" },
  { id: "brand-2", name: "墨黑（占位）", hex: "#1A1A1A" },
  { id: "brand-3", name: "香槟金（占位）", hex: "#C8A063" },
  { id: "brand-4", name: "科技蓝（占位）", hex: "#2B5BFF" },
  { id: "brand-5", name: "浅灰（占位）", hex: "#F2F2F2" },
  { id: "brand-6", name: "纯白（占位）", hex: "#FFFFFF" },
];

/* ------------------------------------------------------------------ 状态 */

let ctx = null;
let binder = null;
let root = null;
let refs = null;
let state = null; // { version, brand: Array|null, custom: Array }

function isValidColor(c) {
  return !!(c && typeof c === "object" && typeof c.hex === "string" && ps.hexToRgb(c.hex));
}

function normalize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const brand = Array.isArray(r.brand) ? r.brand.filter(isValidColor) : [];
  const custom = Array.isArray(r.custom) ? r.custom.filter(isValidColor) : [];
  return {
    version: 1,
    // null 表示"用内置默认品牌色"。只有用户显式覆盖过才存数组。
    brand: brand.length ? brand : null,
    custom: custom,
  };
}

/** 读磁盘状态；文件不存在/坏了都回退到默认（不报错）。 */
async function loadState() {
  const raw = await store.readJson(PALETTE_FILE, null);
  return normalize(raw);
}

/** 落盘结构（永远带 version，方便以后做迁移）。 */
function forDisk() {
  return { version: 1, brand: state.brand, custom: state.custom };
}

async function persist() {
  await store.writeJson(PALETTE_FILE, forDisk());
}

function effectiveBrand() {
  return state && state.brand && state.brand.length ? state.brand : DEFAULT_BRAND;
}

/** 品牌主色 HEX —— Command 入口要用（不依赖面板是否打开）。 */
async function primaryBrandHex() {
  const s = state || (await loadState());
  const list = s.brand && s.brand.length ? s.brand : DEFAULT_BRAND;
  return list[0].hex;
}

/* ---------------------------------------------------------------- 渲染 */

/**
 * 取元素相对视口的几何。
 * ⚠️ 真机实测（v0.2.2 探针）：`getBoundingClientRect()` 与 `offsetWidth/offsetLeft/offsetTop`
 *    **两套都能用**（`width:100px` 的块 → `rect.width=100`、`offsetWidth=100`、`offsetLeft=40`）。
 *    v0.2.1 曾据此写死"offset* 恒为 0、绝不能用"—— 那是探针同步取数造成的假象
 *    （UXP 布局异步，见 lib/cssprobe.js 头部）。这里仍统一用 rect：
 *    不是因为它唯一能用，而是**同一份代码只在一种量法上收口**，少一类分叉。
 */
function rectOf(el) {
  if (!el) return null;
  try {
    return el.getBoundingClientRect();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- 悬停状态机
   （设计意图见文件头 v0.2.2 那一段，四条纪律缺一不可）
*/

let hov = null;        // 当前悬停 { kind, el, hex, name }
let hideTimer = null;  // 延时隐藏的定时器（被下一次激活取消）
let tipToken = 0;      // 让帧后再定位的令牌：期间换了目标就丢弃本次校正
/** 各网格浮层的**实测**尺寸缓存 —— 用来消掉"首次浮现闪一下"的抖动。 */
const tipMetrics = { brand: null, custom: null };

function tipOf(kind) {
  return refs ? (kind === "custom" ? refs.customTip : refs.brandTip) : null;
}
function gridOf(kind) {
  return refs ? (kind === "custom" ? refs.customGrid : refs.brandGrid) : null;
}
function wrapOf(kind) {
  return refs ? (kind === "custom" ? refs.customWrap : refs.brandWrap) : null;
}

/** 写「色值标签」那一行 —— 幂等：值没变就不碰 DOM（重绘的源头掐掉）。 */
function setRoHex(text) {
  if (refs && refs.roHex && refs.roHex.textContent !== text) refs.roHex.textContent = text;
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** 节点是否就是 sw 或它的后代（自己走 parentNode，不依赖 contains 的实现差异）。 */
function insideSwatch(node, sw) {
  if (!node || !sw) return false;
  let n = node;
  let guard = 0;
  while (n && guard < 32) {
    if (n === sw) return true;
    n = n.parentNode;
    guard++;
  }
  return false;
}

/**
 * 估算浮层尺寸 —— 仅用于「让帧前的第一笔定位」。
 * 字体是等宽 11px + 左右各 7px 内边距，按 6.8px/字符 估足够准；
 * 实测尺寸会在 settle() 后覆盖它（见 placeTip 的 size 参数）。
 */
function estTipSize(text) {
  const len = String(text || "").length;
  return { width: Math.round(Math.min(240, 14 + len * 6.8)), height: 20, estimated: true };
}

/**
 * 摆位。**纵向一律落在网格之外**（纪律 ③），横向居中并夹在容器内。
 * @param {object} size {width,height} 允许是估算值；传 null 则现量（须已 settle）
 */
function placeTip(wrap, grid, tip, sw, size) {
  const rw = rectOf(wrap);
  const rg = rectOf(grid);
  const rs = rectOf(sw);
  if (!rw || !rg || !rs || !tip) return false;

  const w = size && size.width ? size.width : 0;
  const h = size && size.height ? size.height : 0;
  if (!w || !h) return false;

  let left = rs.left - rw.left + rs.width / 2 - w / 2;
  const maxLeft = rw.width - w - 2;
  if (left > maxLeft) left = maxLeft;
  if (left < 2) left = 2;

  const gridTop = rg.top - rw.top;
  const gridBottom = rg.bottom - rw.top;
  const upperHalf = rs.top + rs.height / 2 < rg.top + rg.height / 2;
  const top = upperHalf ? gridTop - h - 6 : gridBottom + 6;

  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
  return true;
}

/**
 * 激活某个色块（唯一能改变悬停状态的地方）。
 * 纪律 ②：同一个色块重复调用直接返回，**不写 DOM**。
 */
async function activateTip(kind, sw, hex, name) {
  clearHideTimer();
  if (hov && hov.el === sw) return;                 // ② 幂等
  if (hov && hov.el && hov.el.classList) hov.el.classList.remove("is-ho");
  hov = { kind: kind, el: sw, hex: hex, name: name };
  if (sw && sw.classList) sw.classList.add("is-ho");

  const tip = tipOf(kind);
  const wrap = wrapOf(kind);
  const grid = gridOf(kind);
  const text = hex + (name ? " · " + name : "");
  if (!tip) {
    setRoHex(hex + (name ? "  " + name : ""));
    return;
  }
  if (tip.textContent !== text) tip.textContent = text;
  tip.classList.add("is-on");
  setRoHex(hex + (name ? "  " + name : ""));

  // 第一笔：用缓存/估算尺寸立刻摆位 —— 避免"先出现在左上角再跳过去"
  const cached = tipMetrics[kind];
  const first = cached && cached.text === text ? cached : estTipSize(text);
  placeTip(wrap, grid, tip, sw, first);

  // 第二笔：让帧后用**实测**尺寸精确校正（纪律 ④）
  const token = ++tipToken;
  await dom.settle();
  if (token !== tipToken) return;                   // 期间又切了目标 → 丢弃本次
  if (!hov || hov.el !== sw) return;
  const rt = rectOf(tip);
  if (rt && rt.width) {
    tipMetrics[kind] = { text: text, width: rt.width, height: rt.height };
    placeTip(wrap, grid, tip, sw, rt);
  }
}

/** 立刻隐藏（清状态 + 复位标签行）。 */
function hideTipNow() {
  clearHideTimer();
  if (hov && hov.el && hov.el.classList) hov.el.classList.remove("is-ho");
  hov = null;
  tipToken++;                                       // 作废在途的定位校正
  if (refs) {
    if (refs.brandTip) refs.brandTip.classList.remove("is-on");
    if (refs.customTip) refs.customTip.classList.remove("is-on");
  }
  setRoHex("悬停色块查看 HEX");
}

/** 延时隐藏 —— 期间若有新的色块激活会被取消（这就是"不闪"的关键）。 */
function scheduleHide(delay) {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    hideTipNow();
  }, typeof delay === "number" ? delay : 90);
}

/* ------------------------------------------------------------ 面板根节点
   两条兜底的隐藏通道（纪律 ①）。都只"安排"隐藏，不直接写 DOM。 */

function bindRootHover(rootEl) {
  if (!rootEl) return;

  // 指针移到了「非色块区域」→ 隐藏。
  // 这是主通道：不依赖 relatedTarget（UXP 是否提供未验证），正着判"在不在色块里"。
  binder.on(rootEl, "mouseover", (ev) => {
    const t = ev && ev.target;
    if (hov && insideSwatch(t, hov.el)) {
      clearHideTimer();                             // 还在同一个色块（含它的环/叉）→ 什么都不做
      return;
    }
    if (t && t.getAttribute && t.getAttribute("data-kind")) return; // 换到别的色块，交给它自己激活
    scheduleHide(90);
  });

  // 指针离开整个 webview 时，relatedTarget 通常为空 —— 这是个不需要判断"包含"的可靠信号。
  // ⚠️ 万一 UXP 从不提供 relatedTarget，这里会在每次 mouseout 都安排隐藏；
  //    但紧随其后的色块 mouseover 会把它取消，且重复激活是幂等的 → 仍然不会闪。
  binder.on(rootEl, "mouseout", (ev) => {
    if (ev && ev.relatedTarget) return;
    scheduleHide(90);
  });
}

/** 网格级：从"网格本身的空白"移出去也算离开。 */
function bindGridHover(grid) {
  if (!grid) return;
  binder.on(grid, "mouseout", (ev) => {
    if (ev && ev.target && ev.target !== grid) return;
    scheduleHide(90);
  });
}

function makeSwatch(item, kind) {
  const hex = String(item.hex).toUpperCase();
  const name = item.name || hex;
  const id = item.id || "";

  // ⚠️ 刻意**不写 title 属性**（v0.2.2）：我们已经有自绘浮层，
  //    再挂一个宿主原生 tooltip 就是两个标签叠在一起，且原生那条我们控制不了重绘时机
  //    —— 用户报的"色值标签疯狂闪烁"里，它是嫌疑之一。提示文案已由下方 .hints 承担。
  const sw = dom.el("div", {
    class: "sw",
    "data-kind": kind,
    "data-hex": hex,
    "data-id": id,
    "data-name": name,
    style: "background-color:" + hex + ";",
  });

  // hover 描边环（替代设计稿的 box-shadow，见 index.html 注释）
  sw.appendChild(dom.el("span", { class: "sw-ring" }));

  if (kind === "custom") {
    const del = dom.el("span", { class: "sw-del", "data-del": id, title: "删除这个颜色" });
    del.appendChild(icons.holder("del", "i"));
    sw.appendChild(del);
  }

  // 直接绑在元素上（不搞事件委托）：色块数量少，且这样合成点击能精确落在目标上。
  binder.on(sw, "click", (ev) => {
    const t = ev && ev.target;
    if (t && t.getAttribute && t.getAttribute("data-del") != null) {
      return; // 点击落在 ✕ 上，交给下面那个处理器
    }
    onApply(sw, ev);
  });

  /* ⚠️ 只绑 mouseover，**不绑 mouseout** —— 见文件头纪律 ①。
     色块自己的 mouseout 在"指针移到自己的子元素（描边环 / 删除叉）"时也会触发，
     拿它隐藏浮层就会成对触发 → 浮层高频显示/隐藏 → 用户看到的"疯狂闪烁"。
     隐藏改由面板根节点统一判断（bindRootHover）。 */
  binder.on(sw, "mouseover", (ev) => {
    const t = ev && ev.target;
    // 落在删除叉上不算"悬停色块"（叉自己有 hover 反馈），但**也不隐藏** ——
    // 它仍在当前色块内部，根节点那条"在不在活动色块里"的判据会兜住。
    if (t && t.getAttribute && t.getAttribute("data-del") != null) return;
    activateTip(kind, sw, hex, item.name || "");
  });

  if (kind === "custom") {
    binder.on(sw, "contextmenu", (ev) => {
      try {
        ev.preventDefault();
      } catch {
        /* 忽略 */
      }
      onDelete(sw, "contextmenu");
    });
    const delEl = sw.lastChild;
    binder.on(delEl, "click", (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {
        /* 忽略 */
      }
      onDelete(sw, "del-button");
    });
  }

  return sw;
}

function renderBrandGrid() {
  dom.clear(refs.brandGrid);
  for (const item of effectiveBrand()) {
    refs.brandGrid.appendChild(makeSwatch(item, "brand"));
  }
}

function renderCustomGrid() {
  dom.clear(refs.customGrid);
  const list = state.custom || [];
  for (const item of list) {
    refs.customGrid.appendChild(makeSwatch(item, "custom"));
  }
  refs.customEmpty.style.display = list.length ? "none" : "block";
  if (refs.customNote) {
    refs.customNote.textContent = list.length + " 个";
  }
}

/** fgbg 卡片读数 —— 让面板里也有回读凭证，不只是日志里有。 */
async function renderCurrent() {
  const fg = await ps.readColor("foreground");
  const bg = await ps.readColor("background");
  if (refs.fgSq) refs.fgSq.style.backgroundColor = fg.ok ? fg.hex : "transparent";
  if (refs.bgSq) refs.bgSq.style.backgroundColor = bg.ok ? bg.hex : "transparent";
  if (refs.fgHex) refs.fgHex.textContent = fg.ok ? fg.hex : "读取失败";
  if (refs.bgHex) refs.bgHex.textContent = bg.ok ? bg.hex : "读取失败";
  return { fg, bg };
}

function rerender() {
  if (!refs) return; // 面板没挂载时（如 Command 触发）跳过渲染
  // 列表要重建了 → 先把悬停状态清干净：否则 hov 会指向已被移除的旧色块节点。
  hideTipNow();
  renderBrandGrid();
  renderCustomGrid();
}

/* ---------------------------------------------------------------- 构建 */

function sectionHead(title, extra) {
  // ⚠️ 用 <div> 不用 <p>：UXP 对块级元素上的 flex/inline 行为更可预期，
  //    且 <p> 在部分实现里会被 UA 样式加默认外边距。
  const p = dom.el("div", { class: "sec" });
  p.appendChild(dom.el("span", { class: "sec-t" }, [title]));
  if (extra) p.appendChild(extra);
  return p;
}

function hintRow(kbd, text) {
  const p = dom.el("p");
  p.appendChild(dom.el("span", { class: "kbd" }, [kbd]));
  p.appendChild(dom.el("span", {}, [text]));
  return p;
}

function build() {
  const wrap = dom.el("div", { class: "s-palette" });
  refs = {};

  /* ---- 当前前景 / 背景色卡片 ---- */
  const card = dom.el("div", { class: "fgbg-card" });
  const fb = dom.el("div", { class: "fgbg" });
  refs.fgSq = dom.el("span", { class: "sq fg" });
  refs.bgSq = dom.el("span", { class: "sq bg" });
  fb.appendChild(refs.fgSq);
  fb.appendChild(refs.bgSq);
  card.appendChild(fb);

  const ro = dom.el("div", { class: "ro" });
  refs.roHex = dom.el("p", { class: "ro-hex mono" }, ["悬停色块查看 HEX"]);
  ro.appendChild(refs.roHex);
  card.appendChild(ro);

  const pair = dom.el("div", { class: "ro-pair" });
  refs.fgHex = dom.el("b", { class: "mono" }, ["—"]);
  refs.bgHex = dom.el("b", { class: "mono" }, ["—"]);
  const rowFg = dom.el("div", { class: "ro-row" }, [
    dom.el("span", { class: "k" }, ["前景色"]),
    refs.fgHex,
  ]);
  const rowBg = dom.el("div", { class: "ro-row" }, [
    dom.el("span", { class: "k" }, ["背景色"]),
    refs.bgHex,
  ]);
  pair.appendChild(rowFg);
  pair.appendChild(rowBg);
  card.appendChild(pair);
  wrap.appendChild(card);

  /* ---- 品牌色 ---- */
  wrap.appendChild(sectionHead("品牌色", dom.el("i", { class: "sec-note mono" }, ["锁定 · 待定 HEX"])));
  refs.brandGrid = dom.el("div", { class: "sw-grid brand", id: "vt-brand-grid" });
  refs.brandTip = dom.el("div", { class: "tip mono" });
  refs.brandWrap = dom.el("div", { class: "sw-wrap" }, [refs.brandGrid, refs.brandTip]);
  wrap.appendChild(refs.brandWrap);

  /* ---- 我的颜色（标题右侧带「＋ 存当前色」） ---- */
  // ⚠️ 用 <div role="button"> 不用 <button>（真机上 button 不吃 flex / 强制居中）
  const saveBtn = dom.el("div", {
    class: "mini",
    id: "vt-save-current",
    role: "button",
    tabindex: "0",
  });
  saveBtn.appendChild(icons.holder("plus", "i"));
  saveBtn.appendChild(dom.el("span", {}, ["存当前色"]));
  refs.customNote = dom.el("i", { class: "sec-note mono" }, ["0 个"]);
  const acts = dom.el("span", { class: "sec-actions" }, [refs.customNote, saveBtn]);
  wrap.appendChild(sectionHead("我的颜色", acts));

  refs.customGrid = dom.el("div", { class: "sw-grid mine", id: "vt-custom-grid" });
  refs.customTip = dom.el("div", { class: "tip mono" });
  refs.customWrap = dom.el("div", { class: "sw-wrap" }, [refs.customGrid, refs.customTip]);
  wrap.appendChild(refs.customWrap);

  refs.customEmpty = dom.el("div", { class: "empty", id: "vt-custom-empty" });
  refs.customEmpty.appendChild(dom.el("p", { class: "empty-t" }, ["还没有常用色"]));
  refs.customEmpty.appendChild(
    dom.el("p", { class: "empty-s" }, ["在 PS 里选好颜色，点上方「存当前色」"])
  );
  wrap.appendChild(refs.customEmpty);

  /* ---- 操作提示 ---- */
  const hints = dom.el("div", { class: "hints" });
  hints.appendChild(hintRow("左键", "设置为前景色"));
  hints.appendChild(hintRow("Shift+左键", "设置为背景色"));
  hints.appendChild(hintRow("Alt+左键", "填充当前图层 / 选区（不改前景色）"));
  hints.appendChild(hintRow("右键 / ✕", "删除颜色（仅「我的颜色」）"));
  wrap.appendChild(hints);

  binder.on(saveBtn, "click", () => onSaveCurrent("button"));

  // 悬停浮层：根节点统一判断"在不在色块里"（文件头纪律 ①）
  bindRootHover(wrap);
  bindGridHover(refs.brandGrid);
  bindGridHover(refs.customGrid);

  return wrap;
}

/* ---------------------------------------------------------------- 动作 */

/**
 * 设色（工具内所有设色入口的唯一实现）。
 * @param {string} hex  形如 "#RRGGBB"
 * @param {"foreground"|"background"} slot
 * @param {string} name 可读名（写日志）
 * @param {string} via  触发来源（写日志）
 */
async function applyHex(hex, slot, name, via) {
  const s = slot === "background" ? "background" : "foreground";
  const label = s === "foreground" ? "前景色" : "背景色";

  if (ctx) ctx.setStatus("正在设" + label + "为 " + hex + " …");

  const res = await ps.setColorHex(s, hex);

  const line =
    "palette set=" + s +
    " hex=" + hex +
    " name=" + (name || "-") +
    " via=" + (via || "-") +
    " ok=" + res.ok +
    " hit=" + res.hit +
    " changed=" + res.changed +
    " before=" + (res.before ? ps.rgbToHex(res.before) : "-") +
    " readback=" + (res.readbackHex || "-") +
    (res.error ? " err=" + res.error : "");
  await log.appendLog(line);

  if (ctx) {
    if (res.ok) {
      // 本来就是这个色 → 说清楚，别让用户以为没生效
      ctx.setStatus(
        res.changed
          ? "✓ " + label + " → " + hex + "（回读 " + res.readbackHex + "）"
          : "✓ " + label + "本来就是 " + hex + "（回读一致）"
      );
    } else {
      ctx.setStatus("✗ 设" + label + "失败：" + (res.error || "未知原因"));
    }
  }

  if (refs && refs.fgSq) {
    try {
      await renderCurrent();
    } catch {
      /* 读数失败不影响设色结论 */
    }
  }
  return res;
}

/**
 * 用某个颜色**填充当前图层 / 选区**（工具内所有填充入口的唯一实现）。
 *
 * ⚠️ 与设色不同，填充**必须**有打开的文档 + 可填充的活动图层 ——
 *    没有就明确说原因，绝不让用户"点了没反应"。
 * ⚠️ 判据用 verify:"change"（像素要有变化），不是"命令没报错就算成功" ——
 *    因为 `fill` 的 `fillContents=color` 这条枚举值官方文档没写，
 *    最坏情况是**静默忽略**（不报错、也不填）。没有像素判据就会被它骗过去。
 *    v0.2.3 补充：这条判据也正是识破"形状图层上 fill 无效"的关键证据 ——
 *    当时 PS 既没报错也没改像素，只有像素回读能揭穿它。
 * ⚠️ v0.2.3：具体走哪条命令由 `lib/ps.js fillLayer()` 按 `layer.kind` 分派，
 *    本函数只负责"记日志 + 把结果如实告诉用户"。
 */
async function fillHex(hex, name, via) {
  if (ctx) ctx.setStatus("正在用 " + hex + " 填充当前图层 / 选区 …");

  const res = await ps.fillLayer(hex, { verify: "change" });

  await log.appendLog(
    "palette fill hex=" + hex +
    " name=" + (name || "-") +
    " via=" + (via || "-") +
    " ok=" + res.ok +
    " path=" + (res.via || "-") +
    " family=" + (res.family || "-") +
    " kind=" + (res.layerKind || "-") +
    " verify=" + (res.verified || "none") +
    " readback=" + (res.readbackHex || "-") +
    " before=" + (res.beforeHex || "-") +
    " layer=" + (res.layer ? JSON.stringify(res.layer.name) : "-") +
    " doc=" + JSON.stringify(res.docName || "-") +
    " sel=" + res.hasSelection +
    " attempts=[" + (res.attempts || []).join(" ") + "]" +
    (res.fgRestored !== undefined ? " fgRestored=" + res.fgRestored : "") +
    (res.error ? " err=" + res.error : "")
  );

  if (ctx) {
    const who = res.layer && res.layer.name ? "「" + res.layer.name + "」" : "当前图层";
    const px = res.verified === "none" ? "未做像素校验" : "像素回读 " + res.readbackHex;
    if (res.ok) {
      if (res.family === "text") {
        // 文字族改的是 textStyle 的颜色，**不是**往像素上刷 —— 而且文字保持可编辑。
        // ⚠️ 顺带说清选区无效：文字颜色是整层属性，PS 不接受"只改选区内那部分字"。
        ctx.setStatus("✓ 已把 " + who + " 的文字颜色改为 " + hex +
          "（文字仍可编辑" + (res.hasSelection ? "；文字颜色是整层属性，未按选区裁剪" : "") +
          "　" + px + "）");
      } else if (res.family === "content") {
        // 内容图层改的是"这个图形本身的颜色"，不是往像素上刷 —— 说清楚，别让用户以为没干活
        ctx.setStatus("✓ 已把 " + who + " 的颜色改为 " + hex + "（" + px + "）");
      } else {
        const where = res.hasSelection ? "选区" : "整个图层";
        ctx.setStatus("✓ 已用 " + hex + " 填充" + where + "（" + who + "　" + px + "）");
      }
    } else {
      // 失败原因必须露在面板上：v0.2.2 只写进日志，用户只看到 PS 的报错框，等于没反馈
      ctx.setStatus("✗ 填充失败：" + (res.error || "未知原因"));
    }
  }
  return res;
}

async function onApply(sw, ev) {
  const hex = sw.getAttribute("data-hex");
  const name = sw.getAttribute("data-name") || hex;

  // 修饰键优先级：**Alt = 填充 > Shift = 背景色 > 无 = 前景色**
  // Alt 取 PS 自己的传统：Alt+Backspace = 用前景色填充 —— 语义不会有人误解。
  if (ev && ev.altKey) {
    return fillHex(hex, name, "alt+click");
  }
  const shift = !!(ev && ev.shiftKey);
  return applyHex(hex, shift ? "background" : "foreground", name, shift ? "shift+click" : "click");
}

/**
 * 往「我的颜色」里加一条（数据级实现；面板按钮与自检都走它）。
 * @param {string} hex
 * @param {string} name           条目显示名（默认用 hex）
 * @param {string} via            触发来源（写日志）
 * @param {object} [opts]         { allowDuplicate:boolean }
 */
async function addCustom(hex, name, via, opts) {
  if (!state) state = await loadState();
  const o = opts || {};
  const norm = String(hex).toUpperCase();

  if (!o.allowDuplicate) {
    const dup = (state.custom || []).find((c) => String(c.hex).toUpperCase() === norm);
    if (dup) {
      await log.appendLog(
        "palette save hex=" + norm + " skipped=duplicate existingId=" + dup.id +
        " stateCount=" + state.custom.length + " via=" + (via || "-")
      );
      if (ctx) ctx.setStatus("这个颜色已经在「我的颜色」里了：" + norm);
      return { ok: false, duplicate: true, hex: norm, existingId: dup.id };
    }
  }

  const item = {
    id: "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: name || norm,
    hex: norm,
    savedAt: new Date().toISOString(),
  };
  state.custom.push(item);
  await persist();
  rerender();
  await log.appendLog(
    "palette save hex=" + norm + " name=" + item.name + " id=" + item.id +
    " count=" + state.custom.length + " via=" + (via || "-") + " file=" + PALETTE_FILE
  );
  if (ctx) ctx.setStatus("✓ 已存入「我的颜色」：" + norm + "（共 " + state.custom.length + " 个）");
  return { ok: true, hex: norm, id: item.id, item: item };
}

/**
 * 把当前前景色存进「我的颜色」（面板「存当前色」按钮）。
 * ⚠️ 这里打印 stateCount 是**故意的诊断**：上一轮自检出现过"状态与磁盘不一致"的怪象，
 *    计数留在日志里，下次再有分歧一眼可辨。
 */
async function onSaveCurrent(via) {
  const cur = await ps.readColor("foreground");
  if (!cur.ok) {
    await log.appendLog("palette save FAILED 读不到前景色：" + cur.error);
    if (ctx) ctx.setStatus("✗ 存不了：读不到当前前景色（" + cur.error + "）");
    return { ok: false, error: cur.error };
  }
  await log.appendLog(
    "palette save-current hex=" + cur.hex +
    " stateCount=" + ((state && state.custom) || []).length +
    " via=" + (via || "-")
  );
  return addCustom(cur.hex, cur.hex, via);
}

/** 删除一个自定义色（数据级实现；面板点 ✕ / 右键都走它）。 */
async function deleteById(id, via) {
  if (!state) state = await loadState();
  const idx = (state.custom || []).findIndex((c) => c.id === id);
  if (idx < 0) {
    await log.appendLog("palette delete FAILED id=" + id + " 未找到");
    return { ok: false, error: "未找到 id=" + id };
  }
  const removed = state.custom.splice(idx, 1)[0];
  await persist();
  rerender();
  await log.appendLog(
    "palette delete id=" + id + " hex=" + removed.hex + " count=" + state.custom.length + " via=" + (via || "-")
  );
  if (ctx) ctx.setStatus("已删除 " + removed.hex + "（剩 " + state.custom.length + " 个）");
  return { ok: true, hex: removed.hex, id: id };
}

/** 面板上的删除入口 → 数据级实现。 */
function onDelete(sw, via) {
  return deleteById(sw.getAttribute("data-id"), via);
}

/** 取当前内存态（面板已挂载时有效）。 */
function getState() {
  return state;
}

/* ------------------------------------------------------------- 生命周期 */

async function mount(container, context) {
  ctx = context;
  binder = dom.makeBinder();
  state = await loadState();

  root = build();
  dom.clear(container);
  container.appendChild(root);

  // ⚠️ 必须显式渲染两侧色块 —— build() 只建容器，不填内容。
  //    （第一版漏了这一步，结果面板里两个网格都是空的，已由自检 S1 抓出。）
  rerender();

  await log.appendLog(
    "palette mount  brand=" + effectiveBrand().length + "  custom=" + (state.custom || []).length +
    "  file=" + PALETTE_FILE
  );

  try {
    await renderCurrent();
  } catch {
    /* 读数失败不阻断面板 */
  }
}

function unmount() {
  if (binder) binder.offAll();
  clearHideTimer(); // 别让一个在途的隐藏定时器去碰已经置空的 refs
  tipToken++;
  hov = null;
  binder = null;
  root = null;
  refs = null;
  ctx = null;
  // state 留在内存里，切回来时不必重读磁盘；下次 mount 会重新 loadState() 覆盖它。
  state = null;
}

module.exports = {
  id: "palette",
  title: "调色板",
  subtitle: "品牌色与我保存的颜色",
  badge: "M1",
  ready: true,
  mount,
  unmount,

  /* 以下导出供外壳（Command 入口）与自检脚本复用 —— 与面板走同一份实现 */
  DEFAULT_BRAND,
  PALETTE_FILE,
  loadState,
  getState,
  primaryBrandHex,
  applyHex,
  fillHex,
  /** 清掉悬停状态（自检 S15 要先复位，才能量到"刚从 display:none 变可见"的那一帧）。 */
  hideTip: hideTipNow,
  addCustom,
  saveCurrentForeground: onSaveCurrent,
  deleteById,
  deleteCustom: onDelete,
  normalize,
};
