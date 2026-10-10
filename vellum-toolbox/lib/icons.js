/*
 * lib/icons.js —— 内联 SVG 图标（方向 B 视觉方案）
 * ===========================================================================
 * 来源：设计稿 design-demos/B-native-pro.html 的图标系统（16×16 线条图标，
 *       1.35px 描边、圆头圆角、currentColor 取色）。
 *
 * ⚠️⚠️ 真机踩坑（v0.2.1 修复，务必保留）：
 *   UXP 的 SVG 渲染器 **不把父 <svg> 上的 fill / stroke 继承给子元素**。
 *   子元素于是退回 SVG 初值 `fill: black; stroke: none` —— 结果：
 *     · 闭合路径（rect / box 形 logo）→ 渲染成**实心黑块**
 *     · 线条路径在深色面板上 → 黑线压黑底 → **看起来"没有图标"**
 *   （真机证据：hero 的 logo 变成一个黑色圆角方块，返回箭头 / 色块 ✕ 全部消失。）
 *
 *   所以：**每一个子元素都必须显式写全绘制属性**，不能只写在根节点上。
 *   下面的 applyPaint() 就是干这个的，任何新增图标都自动适用。
 *
 * 另一条纪律：容器一律 `display:flex`，**不用 `display:inline-flex`**
 *   —— 真机上 inline-flex 的行为不可靠（见 index.html 顶部注释）。
 *
 * 用法：icons.holder("back", "i")  →  <i class="i"><svg …/></i>
 *
 * 图标规格 DSL：
 *   { vb: "0 0 16 16", fill: "currentColor"（省略=线条描边）, sw: 1.35,
 *     els: [ ["path", { d: "…" }], ["circle", { cx, cy, r }] ] }
 *   —— els 里的 attrs 会**覆盖**自动补的绘制属性（想单独填充某个子元素就写 fill）。
 */

const NS = "http://www.w3.org/2000/svg";

const SPECS = {
  /* ---- 导航 / 外壳 ---- */
  back: { els: [["path", { d: "M10 3.5 5.5 8 10 12.5" }]] },
  chev: { els: [["path", { d: "M6.2 3.8 10.4 8l-4.2 4.2" }]] },
  chevd: { els: [["path", { d: "M3.8 6.2 8 10.4l4.2-4.2" }]] },
  more: {
    fill: "currentColor",
    els: [
      ["circle", { cx: 3.4, cy: 8, r: 1.15 }],
      ["circle", { cx: 8, cy: 8, r: 1.15 }],
      ["circle", { cx: 12.6, cy: 8, r: 1.15 }],
    ],
  },
  settings: {
    els: [
      ["circle", { cx: 8, cy: 8, r: 2.2 }],
      ["path", { d: "M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1 3.7 12.3" }],
    ],
  },

  /* ---- 工具图标（首页列表用） ---- */
  palette: {
    els: [
      ["path", { d: "M8 2.2a5.8 5.8 0 0 0 0 11.6h1.05a1.5 1.5 0 0 0 1.05-2.56c-.3-.29-.5-.6-.5-1.02 0-.83.67-1.5 1.5-1.5h1.05A1.78 1.78 0 0 0 14 6.94C13.5 4.24 11.02 2.2 8 2.2Z" }],
      ["circle", { cx: 5.7, cy: 6.5, r: 0.85 }],
      ["circle", { cx: 8.4, cy: 5.2, r: 0.85 }],
      ["circle", { cx: 10.9, cy: 6.9, r: 0.85 }],
    ],
  },
  assets: {
    els: [
      ["rect", { x: 2.2, y: 3, width: 11.6, height: 10, rx: 1.6 }],
      ["circle", { cx: 5.8, cy: 6.5, r: 1.15 }],
      ["path", { d: "M2.8 11.4 5.9 8.4l2.4 2.3 2.4-2.2 2.1 2" }],
    ],
  },
  table: {
    els: [
      ["rect", { x: 2.2, y: 3, width: 11.6, height: 10, rx: 1.4 }],
      ["path", { d: "M2.2 6.6h11.6M2.2 9.8h11.6M6.6 3v10" }],
    ],
  },
  /* AI-MCP：两个节点 + 一条连线，表示「把面板能力接给 AI 客户端」 */
  mcp: {
    els: [
      ["circle", { cx: 4.4, cy: 11.6, r: 2.2 }],
      ["circle", { cx: 11.6, cy: 4.4, r: 2.2 }],
      ["path", { d: "M6 10 10 6" }],
    ],
  },
  grid: {
    els: [["path", { d: "M2.6 2.6h4.2v4.2H2.6zM9.2 2.6h4.2v4.2H9.2zM2.6 9.2h4.2v4.2H2.6zM9.2 9.2h4.2v4.2H9.2z" }]],
  },

  /* ---- 调色板 / 动作 ---- */
  plus: { els: [["path", { d: "M8 3.2v9.6M3.2 8h9.6" }]] },
  trash: { els: [["path", { d: "M2.8 4.6h10.4M6.2 4.6V3.2h3.6v1.4M4.6 4.6l.7 8.2h5.4l.7-8.2" }]] },
  copy: {
    els: [
      ["rect", { x: 2.4, y: 2.4, width: 8, height: 8, rx: 1.4 }],
      ["path", { d: "M5.6 13.6h6.4a1.4 1.4 0 0 0 1.4-1.4V5.8" }],
    ],
  },
  check: { sw: 1.6, els: [["path", { d: "M3.4 8.4 6.6 11.6 12.6 4.8" }]] },
  /* 删除叉：加到 1.9 描边，让它在 10px 的小方块上也看得清 */
  del: { sw: 1.9, els: [["path", { d: "M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" }]] },
  alert: {
    els: [
      ["path", { d: "M8 2.6 13.9 13H2.1z" }],
      ["path", { d: "M8 6.6v3" }],
      ["circle", { cx: 8, cy: 11.2, r: 0.7, fill: "currentColor", stroke: "none" }],
    ],
  },
  search: {
    els: [
      ["circle", { cx: 7.2, cy: 7.2, r: 4.3 }],
      ["path", { d: "M10.4 10.4 13.4 13.4" }],
    ],
  },

  /* ---- 应用标志（保留作兜底；首页 hero 已改用 icons/logo-mark.png 位图） ----
   * 设计稿这里用的是一张 PNG（base64 内嵌）。 */
  logo: {
    vb: "0 0 52 52",
    sw: 2,
    els: [
      ["rect", { x: 1.5, y: 1.5, width: 49, height: 49, rx: 13 }],
      ["path", { d: "M17 18.5 26 34.5 35 18.5" }],
    ],
  },
};

/**
 * 给**单个节点**补全绘制属性。
 * ⚠️ 这是本文件存在的核心理由：UXP 不做 fill/stroke 继承，必须逐节点写。
 * @param {Element} node
 * @param {"stroke"|"fill"} mode
 * @param {string} sw   描边宽度（stroke 模式）
 */
function applyPaint(node, mode, sw) {
  if (mode === "fill") {
    node.setAttribute("fill", "currentColor");
    node.setAttribute("stroke", "none");
    return;
  }
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", sw);
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
}

/** 列出所有可用图标名（自检 / 调试用）。 */
function names() {
  return Object.keys(SPECS);
}

/**
 * 建一个图标 SVG 元素。
 * @param {string} name  SPECS 里的键
 * @returns {SVGElement|null}  未知名字返回 null（调用方负责兜底）
 */
function svg(name) {
  const spec = SPECS[name];
  if (!spec) return null;

  const mode = spec.fill === "currentColor" ? "fill" : "stroke";
  const sw = String(spec.sw || 1.35);

  const root = document.createElementNS(NS, "svg");
  root.setAttribute("viewBox", spec.vb || "0 0 16 16");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // 根上也写一份（便宜的冗余：万一某些实现只看根节点）
  applyPaint(root, mode, sw);

  for (const entry of spec.els || []) {
    const tag = entry[0];
    const attrs = entry[1] || {};
    const child = document.createElementNS(NS, tag);
    // 先补默认绘制属性，再写规格里的 attrs —— 后者可覆盖前者
    applyPaint(child, mode, sw);
    for (const k of Object.keys(attrs)) child.setAttribute(k, String(attrs[k]));
    root.appendChild(child);
  }
  return root;
}

/**
 * 便捷：建一个带图标的内联容器。
 *   icons.holder("back", "i")  →  <i class="i"><svg …/></i>
 * @param {string} name
 * @param {string} [cls] 容器的 class（默认 "i"）
 */
function holder(name, cls) {
  const wrap = document.createElement("i");
  wrap.setAttribute("class", cls || "i");
  const node = svg(name);
  if (node) wrap.appendChild(node);
  return wrap;
}

module.exports = { svg, holder, names, SPECS, NS, applyPaint };
