/*
 * lib/review.js —— 导出审核版 · 参数条（M5 第 4 步，v0.9.0；方案 docs/50 + docs/51）
 * ===========================================================================
 * 是什么：把「参数条画什么样、写什么字、用哪套配色」算出来。**纯函数 —— 不碰 Photoshop。**
 *   真正改稿/导出的动作在 `lib/ps.js` 的 `exportReview()` 里。
 *
 * 【三条纪律】
 *   ① **字段只有一个来源**：文字内容全部来自 `lib/inspect.js` 的 `docInspect()`
 *      （未转曲数、缺字体数**直接调它导出的纯函数**）—— 否则迟早出现
 *      "状态条说 3 个、参数条说 2 个"（docs/49 §3.0）。
 *   ② **mm 与 pt 不许混**：条高是按**像素**定的（图宽 × 8%），而 PS 的字号是**点**。
 *      ⇒ 必须按文档 ppi 换算（`pxToPt`）。不换算的话 300dpi 稿上字会大到离谱
 *        （20pt 在 300dpi 是 83px 高）。
 *   ③ **判不出来就说判不出来**：出血三态里 `unknown` 一律写「无法判断」，**不猜**；
 *      主题取不到像素时退回"浅条"并**标明 `from:"fallback"`**，不假装判过。
 *
 * 【v0.9.0 改版（docs/51，用户 2026-10-17 拍板）】
 *   · **主题**：按图片**底部横带**的平均亮度切"浅底深字 / 深底浅字"，免得条与图分不清。
 *   · **分隔符**：所有参数一律用 ` ｜ `（原先是 ` · `）。
 *   · **「依据…」摘出来**做成独立一层，摆在**最后一行右端**，前面加 logo。
 *   · **左右留白**加大：条高 × 0.16（原 0.125）。
 */

const inspect = require("./inspect.js");

/* ===========================================================================
 * 一、比例与常量（要调就调这里，别散在代码里）
 * ------------------------------------------------------------------------- */

const STRIP = {
  /** 条高 = 图宽 × 8%（用户 2026-10-16 选定） */
  heightRatio: 0.08,
  /** 条高下限：窄稿（图宽 < 900px）不至于把字挤成一团 */
  minHeightPx: 72,
  /** 字号 = 条高 × 0.156，再按 ppi 换算成点 */
  fontRatio: 0.156,
  /** 行高 = 字号 × 1.7（≈ 条高 × 0.266） */
  lineRatio: 1.7,
  /** 左右留白 = 条高 × 0.16（v0.9.0 由 0.125 加大，用户拍板） */
  padXRatio: 0.16,
  /** 上下留白 = 条高 × 0.10 */
  padYRatio: 0.10,
  /** 字号下限（px）：再小就不可读，宁可让文字换行 */
  minFontPx: 8,
  /** 角标文案 */
  tag: "审核用 · 非成品",
  /** ★ v0.9.3：角标字号 = 正文字号 × 它（用户 2026-10-17：
      「审核用·非成品」要稍大一些 —— 怕真被当成成品）。
      ⚠️ 只影响角标自己（字号 + 占宽），**不改正文字号**。 */
  tagFontRatio: 1.3,
  /** ★ 所有参数一律用这个分隔（v0.9.0） */
  sep: " ｜ ",
  /** 主题取样带高度 = max(条高, 图高 × 0.08) */
  sampleRatio: 0.08,
  /** 相对亮度的分界：< 它算"深底图片" ⇒ 用浅条 */
  lumaThreshold: 0.5
};

/** 品牌 logo 的宽高比（icons/logo-mark.png = 256×164） */
const LOGO_ASPECT = 256 / 164;

/** 审核版缩放：长边超过它才等比缩小（v0.9.0 / docs/51 §四） */
const SCALE_LIMIT_LONG_EDGE = 4000;

/* ---- 两套配色 --------------------------------------------------------- */
/* 「图片底部深 ⇒ 条用浅色」「图片底部浅 ⇒ 条用深色」—— 目的是让条与图片分得开。 */

const THEME_LIGHT = {
  id: "light",
  why: "图片底部偏深",
  bg: { r: 255, g: 255, b: 255 },
  bgHex: "#FFFFFF",
  fg: { r: 34, g: 34, b: 34 },
  fgHex: "#222222",
  tag: { r: 198, g: 32, b: 42 },
  tagHex: "#C6202A"
};

const THEME_DARK = {
  id: "dark",
  why: "图片底部偏浅",
  bg: { r: 17, g: 17, b: 17 },
  bgHex: "#111111",
  fg: { r: 242, g: 242, b: 242 },
  fgHex: "#F2F2F2",
  /* 红在黑底上对比不够 ⇒ 换亮一档 */
  tag: { r: 255, g: 107, b: 97 },
  tagHex: "#FF6B61"
};

/* ===========================================================================
 * 二、纯函数区
 * ------------------------------------------------------------------------- */

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && "_value" in v) v = v._value;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** 像素 → 点。ppi 无效时按 72 算（那正是 UXP 的屏幕默认）。 */
function pxToPt(px, ppi) {
  const p = num(px);
  if (p === null) return null;
  const d = num(ppi);
  const dpi = d && d > 0 ? d : 72;
  return (p * 72) / dpi;
}

/** 相对亮度（0..1）。用感知权重 0.299/0.587/0.114，不做 sRGB 线性化 —— 够用且好解释。 */
function luma01(rgb) {
  if (!rgb) return null;
  const r = num(rgb.r), g = num(rgb.g), b = num(rgb.b);
  if (r === null || g === null || b === null) return null;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * 由"取样结果"决定主题。**纯函数。**
 * @param {{ok:boolean, rgb?:object, error?:string}} sample `sampleRectAvgColor()` 的结果
 * @returns {{theme:object, luma:number|null, from:"sampled"|"fallback", note:string}}
 *   ⚠️ 取不到像素 ⇒ **退回浅条**（= v0.8.0 的行为）并把原因写进 `note`，**不静默猜**。
 */
function pickTheme(sample) {
  const s = sample || {};
  const y = s.ok ? luma01(s.rgb) : null;
  if (y === null) {
    return {
      theme: THEME_LIGHT,
      luma: null,
      from: "fallback",
      note: "取不到图片底部像素（" + (s.error || "未知原因") + "）⇒ 退回浅条"
    };
  }
  const theme = y < STRIP.lumaThreshold ? THEME_LIGHT : THEME_DARK;
  return {
    theme: theme,
    luma: y,
    from: "sampled",
    note: "底部平均亮度 " + y.toFixed(3) + " ⇒ " + theme.why + "，条用" +
      (theme.id === "light" ? "浅底深字" : "深底浅字")
  };
}

/** 取样带的矩形：图片区**最下面一条全宽横带**。 */
function sampleBandRect(imgW, imgH, stripH) {
  const w = num(imgW) || 0;
  const h = num(imgH) || 0;
  const bandH = Math.max(num(stripH) || 0, Math.round(h * STRIP.sampleRatio), 1);
  const top = Math.max(0, h - bandH);
  return { left: 0, top: top, right: w, bottom: h };
}

/**
 * 估算字符串宽度（单位：em = 字号倍数）。中日韩/全角算 1，其余 0.55。
 * ⚠️ 是**估算**，用来排版与防撑破；不准的地方靠"建层后读回 bounds 再平移"补正。
 */
function estWidthEm(s) {
  const str = String(s === null || s === undefined ? "" : s);
  let em = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0x303e) ||
      (c >= 0x3041 && c <= 0x33ff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0xa000 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    em += wide ? 1 : 0.55;
  }
  return em;
}

/**
 * 算参数条的几何与字号。**纯函数。**
 *
 * @param {number} imgW / @param {number} imgH / @param {number} ppi
 * @param {string[]} [lines]      正文各行（防撑破 + 算需要几行）
 * @param {string}  [tagText]     右上角标文字
 * @param {string}  [basisText]   右下「依据…」块文字（前面会配 logo）
 * @returns 几何 + 三个盒子 + 两个右端块的盒子
 *
 * ★ 三条**真机实测暴露**出来的硬要求（不是设计臆想）：
 *   ① 正文盒子必须给右端块留宽，否则长文件名那行会被压住；
 *   ② 不要用「段落右对齐」摆右端块 —— 整宽的右对齐盒子会被 PS 排到画布外；
 *   ③ 条高是**基准不是上限**：8% 放不下时按实际行数加高（`grown`）。
 */
function stripMetrics(imgW, imgH, ppi, lines, tagText, basisText) {
  const w = num(imgW) || 0;
  const h = num(imgH) || 0;
  const d = num(ppi);
  const dpi = d && d > 0 ? d : 72;

  const baseStripH = Math.max(STRIP.minHeightPx, Math.round(w * STRIP.heightRatio));
  const padX = Math.round(baseStripH * STRIP.padXRatio);
  const padY = Math.round(baseStripH * STRIP.padYRatio);
  const fullLeft = padX;
  const fullRight = Math.max(padX + 1, w - padX);
  const fullW = fullRight - fullLeft;

  const tag = String(tagText === undefined || tagText === null ? STRIP.tag : tagText);
  const basis = String(basisText === undefined || basisText === null ? "" : basisText);

  let maxEm = 0;
  for (const l of lines || []) maxEm = Math.max(maxEm, estWidthEm(l));

  /**
   * 给定字号，算出所有横向占位。
   * ⚠️ logo 高度取 1 个行高（用户拍板 ③），宽度按品牌 mark 的 256:164 等比。
   */
  function layoutFor(fontPx) {
    const lineH = Math.round(fontPx * STRIP.lineRatio);
    const logoH = lineH;
    const logoW = logoH * LOGO_ASPECT;
    const gap = fontPx * 0.5;
    const tagFontPx = fontPx * STRIP.tagFontRatio;
    const tagLineH = Math.round(tagFontPx * STRIP.lineRatio);
    const tagW = estWidthEm(tag) * tagFontPx;
    const basisTextW = estWidthEm(basis) * fontPx;
    const basisBlockW = basis ? logoW + gap + basisTextW : 0;
    const reserveW = Math.max(tagW, basisBlockW);
    const mainW = Math.max(1, fullW - reserveW - gap);
    return {
      lineH: lineH, logoH: logoH, logoW: logoW, gap: gap,
      tagFontPx: tagFontPx, tagLineH: tagLineH,
      tagW: tagW, basisTextW: basisTextW, basisBlockW: basisBlockW,
      reserveW: reserveW, mainW: mainW
    };
  }

  /* ---- 两遍定字号：先由条高给，再按"留出右端块之后的可用宽度"收一次 ---- */
  let fontPx = baseStripH * STRIP.fontRatio;
  let shrunk = false;
  if (lines && lines.length && maxEm > 0) {
    const cap = layoutFor(fontPx).mainW / maxEm;
    if (cap < fontPx) { fontPx = cap; shrunk = true; }
  }
  fontPx = Math.max(STRIP.minFontPx, fontPx);
  if (lines && lines.length && maxEm > 0) {
    const cap2 = layoutFor(fontPx).mainW / maxEm;
    if (cap2 < fontPx) { fontPx = Math.max(STRIP.minFontPx, cap2); shrunk = true; }
  }
  const L = layoutFor(fontPx);

  /* ---- 需要几行：**逐行各算各的**（三行各自的换行数要相加） ---- */
  let rows = 0;
  for (const l of lines || []) {
    rows += Math.max(1, Math.ceil((estWidthEm(l) * fontPx) / L.mainW - 1e-6));
  }
  if (!rows) rows = 3;

  /* ---- 放不下就把条加高（8% 是基准，不是上限） ---- */
  let stripH = baseStripH;
  const needH = rows * L.lineH + padY * 2;
  let grown = false;
  if (needH > stripH) { stripH = needH; grown = true; }

  const top = h;
  const bottom = h + stripH;
  const textTop = top + padY;
  const textBottom = Math.max(textTop + 1, bottom - padY);
  const lastRowTop = textTop + (rows - 1) * L.lineH;

  const fontPt = (fontPx * 72) / dpi;
  const tagFontPt = (L.tagFontPx * 72) / dpi;

  return {
    imgW: w, imgH: h, ppi: dpi,
    stripH: stripH, baseStripH: baseStripH, grown: grown,
    fontPx: Math.round(fontPx * 100) / 100,
    fontPt: Math.round(fontPt * 100) / 100,
    /* ★ 角标自己的字号与行高（比正文大 tagFontRatio 倍） */
    tagFontPx: Math.round(L.tagFontPx * 100) / 100,
    tagFontPt: Math.round(tagFontPt * 100) / 100,
    tagLineHPx: L.tagLineH,
    lineHPx: L.lineH, padXPx: padX, padYPx: padY, rows: rows,
    fontShrunk: shrunk,
    strip: { left: 0, top: top, right: w, bottom: bottom },
    /* 正文只占"整宽 − 右端块 − 间隙"，这样长文件名那行也不会被压住（硬要求 ①） */
    text: {
      left: fullLeft, top: textTop,
      right: fullLeft + L.mainW,
      bottom: textBottom
    },
    /* 右上角标：窄盒 + 默认左对齐（硬要求 ②） */
    tag: {
      left: Math.max(fullLeft, fullRight - L.tagW), top: textTop,
      /* ★ v0.9.3：盒高用**角标自己的**行高，否则字号变大后会被盒子截断 */
      right: fullRight, bottom: textTop + L.tagLineH
    },
    /* 右下「依据」块：文字 + 前面的 logo，整块右端贴着留白线 */
    basis: {
      rowTop: lastRowTop,
      text: {
        left: Math.max(fullLeft, fullRight - L.basisTextW),
        top: lastRowTop,
        right: fullRight,
        bottom: lastRowTop + L.lineH
      },
      logo: {
        left: Math.max(fullLeft, fullRight - L.basisBlockW),
        top: lastRowTop + (L.lineH - L.logoH) / 2,
        right: Math.max(fullLeft, fullRight - L.basisTextW - L.gap),
        bottom: lastRowTop + (L.lineH - L.logoH) / 2 + L.logoH
      },
      blockW: L.basisBlockW, logoW: L.logoW, logoH: L.logoH, gap: L.gap
    },
    sep: STRIP.sep
  };
}

/** 色彩模式的显示名。findings 里给的是 `CMYKColorMode` 这种枚举串。 */
const MODE_CN = {
  RGBColorMode: "RGB",
  CMYKColorMode: "CMYK",
  GrayscaleMode: "灰度",
  LabColorMode: "Lab",
  BitmapMode: "位图",
  IndexedColorMode: "索引色",
  DuotoneMode: "双色调",
  MultichannelMode: "多通道"
};

function modeCN(m) {
  if (!m) return "色彩模式读不到";
  return MODE_CN[m] || String(m);
}

/** 位深的显示名。findings 里给的是 `bitDepth8` 这种。 */
function bitsCN(b) {
  if (!b) return null;
  const m = /bitDepth(\d+)/.exec(String(b));
  if (m) return m[1] + " 位";
  return String(b);
}

/** `2026-10-17 00:30` */
function fmtWhen(d) {
  const t = d instanceof Date ? d : new Date(d === undefined || d === null ? Date.now() : d);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    t.getFullYear() + "-" + p(t.getMonth() + 1) + "-" + p(t.getDate()) +
    " " + p(t.getHours()) + ":" + p(t.getMinutes())
  );
}

/** findings 的 `key → value` 索引。 */
function indexFindings(insp) {
  const map = {};
  const fs = (insp && insp.findings) || [];
  for (const f of fs) map[f.key] = f.value;
  return map;
}

/**
 * 出血三态的文案。**`unknown` 一定要写成"无法判断"，不许猜一个数。**
 * @param {{state:string, mm:number|null}} bleed
 */
function bleedText(bleed) {
  const b = bleed || {};
  if (b.state === "none") return "出血 无";
  if (b.state === "has") {
    const mm = num(b.mm);
    return "出血 含 " + (mm === null ? "? mm" : mm + " mm");
  }
  return "出血 无法判断";
}

/**
 * 缩放说明（只在实际缩过时才产生）。挂在**第 3 行（提示行）末尾**。
 * ★ 用户拍板（docs/51 §四）：**缩过就必须在参数条上印出来**，
 *   否则看版的人会以为看到的是 100%。措辞写成「导出 …」，
 *   免得跟第 2 行那个"原稿像素尺寸"混起来。
 */
function scaleText(scale) {
  const s = scale || {};
  if (!s.applied) return "";
  const pct = num(s.pct);
  const w = num(s.w), h = num(s.h);
  const parts = ["已缩至 " + (pct === null ? "?" : Math.round(pct)) + "%"];
  if (w !== null && h !== null) parts.push("导出 " + Math.round(w) + " × " + Math.round(h) + " px");
  return parts.join(STRIP.sep);
}

/**
 * 算出参数条上要印的内容。**纯函数。**
 *
 * @param {object} insp `docInspect()` 的返回值
 * @param {object} opts `{ bleed, when, scale }`
 * @returns {{ok, error?, lines:string[], basis:string, tag:string,
 *            bleedLine, missing, textCount, estMaxEm}}
 *   `lines` = 正文三行（左对齐部分）；`basis` = 右下「依据…」块（**不含 logo**）
 */
function stripLines(insp, opts) {
  const o = opts || {};
  if (!insp || !insp.ok) {
    return {
      ok: false,
      error: (insp && insp.error) || "没有可写的体检结果",
      lines: [], basis: "", tag: STRIP.tag,
      bleedLine: "", missing: null, textCount: null, estMaxEm: 0
    };
  }

  const g = indexFindings(insp);
  const snap = insp.snapshot || {};
  const info = snap.info || {};
  const spec = insp.spec || {};

  /* ★ 未转曲数 / 缺字体数：**都从同一份来源取**，不在这里另算一遍。 */
  const textCount = num(snap.layers && snap.layers.textCount);
  const mf = inspect.missingFonts(snap);
  const missingCount = mf.known ? mf.missing.length : null;

  const bt = bleedText(o.bleed);
  const S = STRIP.sep;

  /* 第 1 行：文件名 + 导出时间 */
  const L1 = (info.docName || "未命名") + S + "导出 " + fmtWhen(o.when);

  /* 第 2 行：技术参数（空值跳过）—— 只放"这张稿本来是什么" */
  const parts = [];
  parts.push(modeCN(g.mode));
  const b = bitsCN(g.bits);
  if (b) parts.push(b);
  if (g.ppi) parts.push(g.ppi);
  if (g.px) parts.push(g.px);
  if (g.phys && g.phys !== "无法换算") parts.push(g.phys);
  parts.push(bt);
  if (g.profile && g.profile !== "无") parts.push(g.profile);
  const L2 = parts.join(S);

  /* 第 3 行（左）：风险项 +（缩过时）缩放提示。
     ⚠️「依据…」已经**摘出去**做独立右对齐块，不在这一行。 */
  const risks = [];
  if (textCount !== null) risks.push("未转曲文字层 " + textCount + " 个");
  risks.push(missingCount === null ? "缺失字体 无法判断" : "缺失字体 " + missingCount + " 个");
  const scaleNote = scaleText(o.scale);
  if (scaleNote) risks.push(scaleNote);
  const L3 = risks.join(S);

  /* 右下「依据…」块（文字部分，logo 由 ps.js 置入） */
  const basis =
    "依据 " + (spec.specName || "规范") + " v" + spec.specVersion +
    (spec.effectiveFrom ? " · " + spec.effectiveFrom + " 生效" : "");

  const lines = [L1, L2, L3];
  let maxEm = 0;
  for (const l of lines) maxEm = Math.max(maxEm, estWidthEm(l));

  return {
    ok: true,
    lines: lines,
    basis: basis,
    tag: STRIP.tag,
    bleedLine: bt,
    missing: missingCount,
    textCount: textCount,
    estMaxEm: maxEm
  };
}

/** 文件名里不能出现的字符 → `_`。顺便去掉扩展名。 */
function safeBaseName(name) {
  let s = String(name === null || name === undefined ? "" : name);
  s = s.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = "未命名";
  return s;
}

/** `20261017-0030` */
function stamp(d) {
  const t = d instanceof Date ? d : new Date(d === undefined || d === null ? Date.now() : d);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) +
    "-" + p(t.getHours()) + p(t.getMinutes())
  );
}

/**
 * 导出文件名。**纯函数。**
 * @param {string} docName 文档名（可带扩展名）
 * @param {string} kind    `"review"`（审核版）| `"final"`（成品图）
 */
function exportFileName(docName, kind, when) {
  const tail = kind === "final" ? "成品" : "审核版";
  return safeBaseName(docName) + "-" + tail + "-" + stamp(when) + ".png";
}

/**
 * 审核版缩放计划。**纯函数。**（docs/51 §四 路线 D）
 * 长边 > `SCALE_LIMIT_LONG_EDGE` 才等比缩；否则原样。
 * @returns {{applied:boolean, w:number, h:number, pct:number|null, reason:string}}
 */
function planScale(imgW, imgH, limit) {
  const w = num(imgW), h = num(imgH);
  const lim = num(limit) || SCALE_LIMIT_LONG_EDGE;
  if (w === null || h === null || w <= 0 || h <= 0) {
    return { applied: false, w: w, h: h, pct: null, reason: "读不到尺寸，不缩" };
  }
  const longEdge = Math.max(w, h);
  if (longEdge <= lim) {
    return {
      applied: false, w: w, h: h, pct: 100,
      reason: "长边 " + longEdge + " ≤ " + lim + "，不缩"
    };
  }
  const k = lim / longEdge;
  return {
    applied: true,
    w: Math.max(1, Math.round(w * k)),
    h: Math.max(1, Math.round(h * k)),
    pct: k * 100,
    reason: "长边 " + longEdge + " > " + lim + " ⇒ 等比缩到 " + lim
  };
}

/* ===========================================================================
 * 三、出血三态（面板与自检共用）
 * ------------------------------------------------------------------------- */

/** 出血毫米数的合理上限（超过它一定是输错了，不是"稿子出血 500mm"）。 */
const BLEED_MM_MAX = 100;

/**
 * 三态选择 → 出血对象。**纯函数** —— 面板与自检调的是同一份判定。
 * @returns {{ok:boolean, state:string, mm:number|null, error:string}}
 */
function makeBleed(state, mmText) {
  const st = state === "none" || state === "has" ? state : "unknown";
  if (st !== "has") return { ok: true, state: st, mm: null, error: "" };

  const raw = typeof mmText === "string" ? mmText.trim() : mmText;
  if (raw === null || raw === undefined || raw === "") {
    return { ok: false, state: st, mm: null, error: "选了「有出血」就要填一个毫米数" };
  }
  const mm = Number(raw);
  if (!isFinite(mm) || mm <= 0) {
    return { ok: false, state: st, mm: null, error: "毫米数要是一个大于 0 的数字：" + raw };
  }
  if (mm > BLEED_MM_MAX) {
    return { ok: false, state: st, mm: null, error: "毫米数超过 " + BLEED_MM_MAX + "，八成是打错了：" + mm };
  }
  return { ok: true, state: st, mm: mm, error: "" };
}

/** 出血三态的选项表（界面与自检共用）。 */
const BLEED_CHOICES = [
  { state: "none", label: "无出血" },
  { state: "has", label: "有出血" },
  { state: "unknown", label: "不确定" }
];

/* ===========================================================================
 * 四、导出（**放在文件末尾** —— 上面有 const，提前 export 会踩 TDZ）
 * ------------------------------------------------------------------------- */

module.exports = {
  STRIP: STRIP,
  LOGO_ASPECT: LOGO_ASPECT,
  SCALE_LIMIT_LONG_EDGE: SCALE_LIMIT_LONG_EDGE,
  THEME_LIGHT: THEME_LIGHT,
  THEME_DARK: THEME_DARK,
  BLEED_CHOICES: BLEED_CHOICES,
  BLEED_MM_MAX: BLEED_MM_MAX,
  luma01: luma01,
  pickTheme: pickTheme,
  sampleBandRect: sampleBandRect,
  planScale: planScale,
  scaleText: scaleText,
  makeBleed: makeBleed,
  stripMetrics: stripMetrics,
  stripLines: stripLines,
  bleedText: bleedText,
  exportFileName: exportFileName,
  safeBaseName: safeBaseName,
  pxToPt: pxToPt,
  estWidthEm: estWidthEm,
  modeCN: modeCN,
  bitsCN: bitsCN,
  fmtWhen: fmtWhen,
  stamp: stamp,
  indexFindings: indexFindings
};
