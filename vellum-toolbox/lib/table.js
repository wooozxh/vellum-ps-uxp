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
  colAlign: {},              // 每列对齐 {列序号: left|center|right}（覆盖表头/行各自的默认）
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
  /* 🔴 v0.4.4：字号单位从「pt」改成「**画布 px**」。
     原因：这一层的所有几何（行高 28px、内边距 4px）都是画布像素，而 pt 是**物理单位** ——
     300ppi 的文档里 12pt = 50px，会把 28px 的行撑爆。设计师也是按 px 想事情的。
     交给 PS 时再按 ppi 折回 pt（`pxToPt`），**描述符形状一个字没改**，只换数值。 */
  fontPx: 12,
  fontColor: { r: 162, g: 162, b: 162 },
  headerFontPx: 12,
  headerFontColor: { r: 230, g: 230, b: 230 },
  /* 对齐：水平 + 垂直，表头与数据行**各自独立**（用户 2026-10-11 要求两面都能调）。
     水平三档 left/center/right；垂直三档 top/middle/bottom，默认**水平居中 + 垂直居中**。 */
  headerAlign: "center",
  rowAlign: "center",
  headerVAlign: "middle",
  rowVAlign: "middle",
  fontName: null,
  maxCells: 400,             // 单次上限（按经验值定，见 docs/40）
};

/** 单倍行距的经验系数（含上下余量，避免字被框切到） */
const LEADING = 1.32;

/** 画布像素 → 物理点（PS 的字号是 pt）。ppi 缺省按 72（此时 1px = 1pt）。 */
function pxToPt(px, ppi) {
  const p = isFinite(ppi) && ppi > 0 ? Number(ppi) : 72;
  return (Number(px) || 12) * 72 / p;
}

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
  /* 文档 ppi：字号是**物理单位**（pt），而这一层全是画布像素 ⇒ 两者靠它换算。
     真机上由 `ps.docInfo().resolution` 传进来；离线/缺省按 72（此时 pt 与 px 1:1）。 */
  const ppi = isFinite(req && req.ppi) && req.ppi > 0 ? Number(req.ppi) : 72;

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
      /* ── 垂直对齐（v0.4.4，用户要求）────────────────────────────────────
         ⚠️ **PS 的框文本没有"框内垂直居中"这个属性** —— 文字永远从框顶往下排。
         ⇒ 三档是靠**自己把框缩到"一行高"、再挪到目标纵坐标**做出来的（纯几何）。
         行高（画布像素）= 字号(px) × 行距系数；字号交给 PS 时要换成**物理单位 pt**。 */
      const fontPx = isHd ? style.headerFontPx : style.fontPx;
      const sizePt = pxToPt(fontPx, ppi);
      const valign = (isHd ? style.headerVAlign : style.rowVAlign) || "top";
      const boxT = rowTop(i) + style.pad.t;
      const boxB = rowBottom(i) - style.pad.b;
      const lineH = Math.min(Math.max(1, boxB - boxT), Math.max(1, fontPx * LEADING));
      let textTop = boxT;
      if (valign === "middle") textTop = boxT + (boxB - boxT - lineH) / 2;
      else if (valign === "bottom") textTop = boxB - lineH;
      cells.push({
        row: i, col: c, role: isHd ? "header" : "body", text: text,
        align: style.colAlign[c] || (isHd ? style.headerAlign : style.rowAlign),
        valign: valign,
        fontPx: fontPx,
        sizePt: sizePt,
        lineH: lineH,
        color: isHd ? style.headerFontColor : style.fontColor,
        box: {
          left: x0 + style.pad.l, top: textTop,
          right: x1 - style.pad.r, bottom: textTop + lineH,
        },
      });
    }
  }

  /* ── 线：**外框 4 条 + 内部横/竖线**，全部是同一种「细矩形」 ─────────────────
     🔴 v0.4.1 为什么把外框拆成 4 条：一条"只描边不填充"的矩形需要
        `fillEnabled:false` + `strokeEnabled:true` 这个**组合**，而真机 S31 验过的是
        `fillEnabled:true` + `strokeEnabled:false`。**没验过的组合一律不发**
        （v0.4.0 卡死宿主的教训，见 lib/ps.js `buildTable` 顶上的返工记录）。
     代价是外框从 1 层变 4 层 —— 换来"只用已验原语"，值。
     颜色分两档：外框用 `strokeColor`、内部线用 `lineColor`（竞品也是这么分的）。 */
  const half = Math.max(0, Math.floor(style.strokeW / 2));
  const wpx = Math.max(1, style.strokeW);
  const frame = { left: left, top: top, right: left + totalW, bottom: top + totalH };
  const lines = [];

  const wantTB = style.border === "all" || style.border === "h";
  const wantLR = style.border === "all" || style.border === "v";
  if (wantTB) {
    lines.push({
      kind: "h", outer: true, edge: "top", color: style.strokeColor,
      rect: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.top + wpx },
    });
    lines.push({
      kind: "h", outer: true, edge: "bottom", color: style.strokeColor,
      rect: { left: frame.left, top: frame.bottom - wpx, right: frame.right, bottom: frame.bottom },
    });
  }
  if (wantLR) {
    lines.push({
      kind: "v", outer: true, edge: "left", color: style.strokeColor,
      rect: { left: frame.left, top: frame.top, right: frame.left + wpx, bottom: frame.bottom },
    });
    lines.push({
      kind: "v", outer: true, edge: "right", color: style.strokeColor,
      rect: { left: frame.right - wpx, top: frame.top, right: frame.right, bottom: frame.bottom },
    });
  }

  // 内部横线（行与行之间）
  if (wantTB) {
    for (let i = 1; i < totalRows; i++) {
      const y = rowTop(i);
      lines.push({
        kind: "h", y: y, color: style.lineColor,
        rect: { left: left, top: y - half, right: left + totalW, bottom: y - half + wpx },
      });
    }
  }
  // 内部竖线（列与列之间）
  if (wantLR) {
    for (let c = 1; c < cols; c++) {
      const x = colLeft(c);
      lines.push({
        kind: "v", x: x, color: style.lineColor,
        rect: { left: x - half, top: top, right: x - half + wpx, bottom: top + totalH },
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

  /* 外框元信息（面板/摘要用）。⚠️ `radius` **目前不生效**（圆角那条描述符还没单发探针），
     给了就如实出警告，不静默降级。 */
  const outer = {
    rect: frame,
    radius: Math.max(0, Math.round(style.radius)),
    strokeW: Math.max(0, style.strokeW),
    color: style.strokeColor,
    bars: lines.filter((l) => l.outer).length,
  };
  if (outer.radius > 0) {
    warnings.push("圆角外框暂不生效（那条描述符还没有单发探针），本次按直角画");
  }

  // 层数：1 组 + 线（外框也算在 lines 里）+ 背景 + 文字（空格子不算）
  const layers = 1 + lines.length + bg.length + cells.length;

  return {
    ok: true,
    cols: cols, bodyRows: body.length, totalRows: totalRows,
    width: totalW, height: totalH, headerH: headerH, rowH: rowH,
    widths: widths, left: left, top: top,
    cells: cells, lines: lines, bg: bg, outer: outer,
    emptyCells: emptyCells,
    layers: layers,
    style: style,
    ppi: ppi,
    warnings: warnings,
  };
}

/** 计划的一句话摘要（面板与日志共用，避免两处各写一份） */
function describe(plan) {
  if (!plan || !plan.ok) return plan && plan.error ? plan.error : "（没有计划）";
  let s = plan.cols + " 列 × " + plan.bodyRows + " 行数据　表格 " + plan.width + "×" + plan.height + "px";
  s += "　共 " + plan.layers + " 个图层（外框 " + plan.outer.bars + " · 内部线 " +
    (plan.lines.length - plan.outer.bars) + " · 背景 " + plan.bg.length +
    " · 文字 " + plan.cells.length + "）";
  if (plan.emptyCells) s += "　跳过 " + plan.emptyCells + " 个空格子";
  /* 文档 ppi 不是 72 时**明说**：字号按画布像素算、交给 PS 时折算成了 pt。
     不写清楚的话，用户看到"字号 12px"而 PS 里显示别的数字会以为是 bug。 */
  if (plan.ppi && plan.ppi !== 72) {
    const c0 = plan.cells[0];
    s += "　（文档 " + plan.ppi + "ppi：字号按画布像素算" +
      (c0 ? "，12px 交给 PS 是 " + (Math.round(c0.sizePt * 100) / 100) + "pt" : "") + "）";
  }
  return s;
}

module.exports = {
  DEFAULTS, MIN_COL_W,
  dispWidth, normalizeRows, columnWidths, layoutTable, describe,
};
