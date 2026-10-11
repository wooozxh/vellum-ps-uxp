/*
 * lib/table.js —— 表格**布局计算**（v0.4.0，M3 表格生成）
 * ===========================================================================
 * 全是**纯函数**：给规格 → 出计划（每个格子/每条线/每块背景的目标矩形）。
 * 一条 PS 命令都不发 —— 所以这一层能在 Node 里穷举自检，不必上真机。
 *
 * 这是本项目的纪律：**先算清楚，再发命令**。
 * 手拼描述符"不报错也不生效"已经吃过两次亏（S17 / 整份 textKey 回灌），
 * 而"算错了"是纯逻辑问题，不该放到真机上去查。
 *
 * 几何约定（和 v0.3.8 验证过的 `ps.makeRectShapeLayer` 完全对齐）：
 *   · 区域（选区）给的是 **left / top / 宽**；表格的高度由 表头高 + 行数 × 行高 算出来
 *   · 超过区域高度 ⇒ **不偷偷压缩**，如实出一条警告（用户能看见）
 *   · 线是**细矩形**（矢量形状层），坐标取整 ⇒ 不会出现半像素毛边
 * ===========================================================================
 */

/** 默认样式（面板上的初始值） */
const DEFAULTS = {
  headerRow: true,
  headerH: 30,
  rowH: 28,
  pad: { t: 4, r: 8, b: 4, l: 8 },
  colwMode: "even",          // even | content
  colWidth: {},              // 手改过的列宽 {列序号(0起): px}
  colAlign: {},              // 每列对齐 {列序号: left|center|right}
  border: "all",             // all | h | v | none
  radius: 0,
  strokeW: 1,
  strokeColor: { r: 196, g: 196, b: 196 },
  lineColor: { r: 74, g: 74, b: 74 },
  headerBgMode: "solid",     // none | solid
  headerBg: { r: 69, g: 69, b: 69 },
  rowBgMode: "none",
  rowBg: { r: 58, g: 58, b: 58 },
  zebra: false,
  zebraBg: { r: 52, g: 52, b: 52 },
  fontPt: 12,
  fontColor: { r: 162, g: 162, b: 162 },
  headerFontPt: 12,
  headerFontColor: { r: 230, g: 230, b: 230 },
  align: "center",
  fontName: null,
  maxCells: 400,             // 单次上限（按经验值定，见 docs/40）
};

const MIN_COL_W = 36;

/** 显示宽度：CJK/全角按 2，其余按 1（只用来做"按内容分列宽"的权重） */
function dispWidth(s) {
  const t = String(s === undefined || s === null ? "" : s);
  let w = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    w += c < 0x1100 ? 1
      : (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1;
  }
  return w;
}

/**
 * 把二维数组整理成矩形：表头一行 + 数据若干行。
 * 参差不齐的行**不静默丢弃**，补空并如实报出来。
 * @returns {{header:string[], body:string[][], cols:number, ragged:number}}
 */
function normalizeRows(rows, headerRow) {
  const src = (rows || []).filter((r) => Array.isArray(r));
  if (!src.length) return { header: [], body: [], cols: 0, ragged: 0 };
  let cols = 0;
  for (const r of src) cols = Math.max(cols, r.length);
  const useHeader = headerRow !== false;
  const header = useHeader ? src[0].slice() : new Array(cols).fill("");
  const body = (useHeader ? src.slice(1) : src).map((r) => {
    const out = r.slice(0, cols);
    while (out.length < cols) out.push("");
    return out;
  });
  let ragged = 0;
  for (const r of src) if (r.length !== cols) ragged++;
  return { header: header, body: body, cols: cols, ragged: ragged };
}

/**
 * 列宽：等分 / 按内容权重；手改过的列宽优先。
 * @returns {number[]} 整数像素，和 = totalW（除非手改值本身加起来就超过）
 */
function columnWidths(header, body, totalW, mode, fixed) {
  const cols = header.length;
  if (!cols) return [];
  const fx = fixed || {};
  const fixedIdx = Object.keys(fx).filter((k) => fx[k] > 0);
  let fixedSum = 0;
  for (const k of fixedIdx) fixedSum += Math.round(fx[k]);
  const restW = Math.max(0, totalW - fixedSum);
  const freeIdx = [];
  for (let c = 0; c < cols; c++) if (!(c in fx && fx[c] > 0)) freeIdx.push(c);

  const raw = new Array(cols).fill(0);
  if (mode === "content" && freeIdx.length) {
    let sum = 0;
    for (const c of freeIdx) {
      let w = dispWidth(header[c]);
      for (const r of body) w = Math.max(w, dispWidth(r[c]));
      w = Math.max(MIN_COL_W, w * 7 + 12); // 7px/半角字符 + 两侧内边距
      raw[c] = w;
      sum += w;
    }
    let acc = 0;
    for (let i = 0; i < freeIdx.length; i++) {
      const c = freeIdx[i];
      const v = i === freeIdx.length - 1 ? restW - acc : Math.floor((raw[c] / sum) * restW);
      raw[c] = Math.max(MIN_COL_W, v);
      acc += raw[c];
    }
  } else {
    const each = freeIdx.length ? Math.floor(restW / freeIdx.length) : 0;
    for (const c of freeIdx) raw[c] = Math.max(MIN_COL_W, each);
  }
  for (const k of fixedIdx) raw[Number(k)] = Math.round(fx[k]);

  // 补齐到正好等于 totalW（余数给最后一列，避免留缝）
  let cur = raw.reduce((a, b) => a + b, 0);
  if (cur !== totalW && cols) {
    let last = -1;
    for (let c = cols - 1; c >= 0; c--) if (!(c in fx && fx[c] > 0)) { last = c; break; }
    if (last < 0) last = cols - 1;
    raw[last] = Math.max(MIN_COL_W, raw[last] + (totalW - cur));
  }
  return raw.map((v) => Math.round(v));
}

/**
 * 算出整张表的计划（**纯函数**）。
 * @param {{header:string[], body:string[][], region:{left,top,right,bottom}, style:object}} req
 * @returns {object} plan —— 含 cells / lines / bg / outer / warnings / layers
 */
function layoutTable(req) {
  const style = Object.assign({}, DEFAULTS, (req && req.style) || {});
  style.pad = Object.assign({}, DEFAULTS.pad, (req && req.style && req.style.pad) || {});
  const header = (req && req.header) || [];
  const body = (req && req.body) || [];
  const cols = header.length;
  const warnings = [];
  const region = (req && req.region) || { left: 0, top: 0, right: 0, bottom: 0 };

  if (!cols || !body.length) {
    return { ok: false, error: cols ? "没有数据行" : "没有列", warnings: warnings };
  }

  // 上限闸门：按**格子数**算（每格一个文字层，这是层数大头）
  const cellCount = cols * (body.length + 1);
  if (cellCount > style.maxCells) {
    return {
      ok: false, error: "单元格太多（" + cellCount + " 个，上限 " + style.maxCells + "）",
      tooMany: true, cellCount: cellCount, warnings: warnings,
    };
  }

  const left = Math.round(region.left);
  const top = Math.round(region.top);
  const totalW = Math.max(MIN_COL_W * cols, Math.round((region.right || 0) - (region.left || 0)));
  const widths = columnWidths(header, body, totalW, style.colwMode, style.colWidth);

  const headerH = Math.max(16, Math.round(style.headerH));
  const rowH = Math.max(16, Math.round(style.rowH));
  const totalH = headerH + body.length * rowH;
  const regionH = Math.round((region.bottom || 0) - (region.top || 0));
  if (regionH > 0 && totalH > regionH + 1) {
    warnings.push("表格高 " + totalH + "px，比选区高 " + regionH + "px 多 —— 没压缩，会往下溢出（可减小行高或行数）");
  }

  // 行的纵向边界（含表头）
  const rowTop = (i) => top + (i === 0 ? 0 : headerH + (i - 1) * rowH);
  const rowBottom = (i) => top + (i === 0 ? headerH : headerH + i * rowH);
  const totalRows = body.length + 1;
  const colLeft = (c) => left + widths.slice(0, c).reduce((a, b) => a + b, 0);

  const cells = [];
  let emptyCells = 0;
  for (let i = 0; i < totalRows; i++) {
    const isHd = i === 0;
    const row = isHd ? header : body[i - 1];
    for (let c = 0; c < cols; c++) {
      const text = String(row[c] === undefined || row[c] === null ? "" : row[c]);
      if (text === "" && !isHd) {
        emptyCells++;   // 空格子**不发命令**（省层数），如实记数
        continue;
      }
      const x0 = colLeft(c);
      const x1 = colLeft(c + 1);
      cells.push({
        row: i, col: c, role: isHd ? "header" : "body", text: text,
        align: style.colAlign[c] || style.align,
        sizePt: isHd ? style.headerFontPt : style.fontPt,
        color: isHd ? style.headerFontColor : style.fontColor,
        box: {
          left: x0 + style.pad.l, top: rowTop(i) + style.pad.t,
          right: x1 - style.pad.r, bottom: rowBottom(i) - style.pad.b,
        },
      });
    }
  }

  // 线：内部横线（行与行之间）+ 内部竖线（列与列之间）。外框单独一层。
  const half = Math.max(0, Math.floor(style.strokeW / 2));
  const lines = [];
  if (style.border === "all" || style.border === "h") {
    for (let i = 1; i < totalRows; i++) {
      const y = rowTop(i);
      lines.push({
        kind: "h", y: y,
        rect: { left: left, top: y - half, right: left + totalW, bottom: y - half + Math.max(1, style.strokeW) },
      });
    }
  }
  if (style.border === "all" || style.border === "v") {
    for (let c = 1; c < cols; c++) {
      const x = colLeft(c);
      lines.push({
        kind: "v", x: x,
        rect: { left: x - half, top: top, right: x - half + Math.max(1, style.strokeW), bottom: top + totalH },
      });
    }
  }

  // 背景块（表头 1 块 + 每行 1 块；隔行变色只给偶数行）
  const bg = [];
  if (style.headerBgMode !== "none") {
    bg.push({
      role: "header", rect: { left: left, top: top, right: left + totalW, bottom: rowBottom(0) },
      color: style.headerBg,
    });
  }
  if (style.rowBgMode !== "none" || style.zebra) {
    for (let i = 1; i < totalRows; i++) {
      const odd = i % 2 === 1;
      if (style.zebra && !odd) continue;
      bg.push({
        role: "row", row: i,
        rect: { left: left, top: rowTop(i), right: left + totalW, bottom: rowBottom(i) },
        color: style.zebra && style.rowBgMode === "none" ? style.zebraBg : style.rowBg,
      });
    }
  }

  const outer = {
    rect: { left: left, top: top, right: left + totalW, bottom: top + totalH },
    radius: Math.max(0, Math.round(style.radius)),
    strokeW: Math.max(0, style.strokeW),
    color: style.strokeColor,
  };

  // 层数：1 组 + 外框 + 线 + 背景 + 文字（空格子不算）
  const layers = 1 + 1 + lines.length + bg.length + cells.length;

  return {
    ok: true,
    cols: cols, bodyRows: body.length, totalRows: totalRows,
    width: totalW, height: totalH, headerH: headerH, rowH: rowH,
    widths: widths, left: left, top: top,
    cells: cells, lines: lines, bg: bg, outer: outer,
    emptyCells: emptyCells,
    layers: layers,
    style: style,
    warnings: warnings,
  };
}

/** 计划的一句话摘要（面板与日志共用，避免两处各写一份） */
function describe(plan) {
  if (!plan || !plan.ok) return plan && plan.error ? plan.error : "（没有计划）";
  let s = plan.cols + " 列 × " + plan.bodyRows + " 行数据　表格 " + plan.width + "×" + plan.height + "px";
  s += "　共 " + plan.layers + " 个图层（外框 1 · 线 " + plan.lines.length +
    " · 背景 " + plan.bg.length + " · 文字 " + plan.cells.length + "）";
  if (plan.emptyCells) s += "　跳过 " + plan.emptyCells + " 个空格子";
  return s;
}

module.exports = {
  DEFAULTS, MIN_COL_W,
  dispWidth, normalizeRows, columnWidths, layoutTable, describe,
};
