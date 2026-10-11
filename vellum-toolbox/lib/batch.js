/* lib/batch.js —— M3b「按行批量出稿」的**纯函数**层（不碰 PS，可离线穷举）
 *
 * 为什么单独一层：出稿这件事里"哪一份、哪个图层、写什么值、摆到哪儿"全是纯计算，
 * 跟 PS 一点关系都没有。把它抽出来以后，**离线就能把排布/绑定/闸门/预估全验一遍**
 * （真机那边只负责"发命令 + 读回"，越薄越好）。
 *
 * 真机实测常数（S47，见 docs/45 §一）：
 *   · AM duplicate（按 _id，可合批） 17–19ms/份
 *   · DOM `textItem.contents = 值`   ≈56–68ms/次   ← **大头**
 *   · DOM `translate()`              未量准（S48 量），预估按 40ms/份
 * 预估耗时**要显示给用户**：20 份 × 4 列 ≈ 5s，不让用户对着一个没有反馈的界面等。
 */

/** 写一次文字的成本（ms）——DOM `textItem.contents`，S47 实测 56–68 */
const WRITE_MS = 60;
/** 复制一份的成本（ms）——AM duplicate 合批，S47 实测 17–19 */
const DUP_MS = 19;
/** 移动一份的成本（ms）——DOM translate，S48 量准前先按 40 */
const MOVE_MS = 40;

/** 网格默认列数（每行摆几个） */
const DEFAULT_COLS = 5;
/** 一次出稿的**写文字次数**上限（400 × 60ms ≈ 24s）：超过就"先问再出"，不静默截断 */
const DEFAULT_MAX_WRITES = 400;
/** 副本之间的最小间距（px） */
const GAP_MIN = 16;

/**
 * 第 i 份副本相对**模板原位**的位移（网格：模板占 0 号位，副本从 1 号位往下填）。
 * @param {number} i 1 起的份序号
 * @param {number} cols 每行几个
 * @param {number} w 模板宽 / h 模板高（用来算步距）
 * @param {number} [gap] 间距（不给就按尺寸推一个，最小 GAP_MIN）
 */
function gridOffset(i, cols, w, h, gap) {
  const c = Math.max(1, Math.round(cols) || DEFAULT_COLS);
  const idx = Math.max(1, Math.round(i) || 1) - 1;      // 0 起的格号
  const col = idx % c;
  const row = Math.floor(idx / c);
  const g = isFinite(gap) && gap > 0
    ? gap
    : Math.max(GAP_MIN, Math.round(Math.min(Math.abs(w) || 100, Math.abs(h) || 100) * 0.08));
  const stepX = (Math.abs(w) || 100) + g;
  const stepY = (Math.abs(h) || 100) + g;
  return {
    dx: Math.round((col + 1) * stepX),
    dy: Math.round((row + 1) * stepY),
    col: col, row: row, cols: c, gap: g, stepX: Math.round(stepX), stepY: Math.round(stepY),
  };
}

/** 副本名：`稿件 3 · 开学季特训营`（取**第一个已绑定且有值**的列；没有就只留序号）。 */
function copyName(i, row, header, bindings) {
  const base = "稿件 " + i;
  let pick = "";
  for (let c = 0; c < (row || []).length; c++) {
    /* ⚠️ 用"键在不在"判断，不能用真假值 —— 绑定的值是**序号**，`0` 是合法的第一个文字层 */
    if (!bindings || !(c in bindings)) continue;
    const v = String(row[c] === undefined || row[c] === null ? "" : row[c]).trim();
    if (v) { pick = v; break; }
  }
  if (!pick) return base;
  pick = pick.replace(/[\r\n\t]+/g, " ").trim();
  return base + " · " + (pick.length > 20 ? pick.slice(0, 20) + "…" : pick);
}

/** 只留个短名给读数用（去掉换行、截断） */
function brief(s, n) {
  const t = String(s === undefined || s === null ? "" : s).replace(/[\r\n\t]+/g, " ");
  const k = n === undefined ? 24 : n;
  return t.length > k ? t.slice(0, k) + "…" : t;
}

/**
 * 出稿计划。
 * @param {object} req
 *   `rows`      数据行（二维数组，不含表头）
 *   `header`    表头（用来在读数里指认列名）
 *   `bindings`  {列序号(0起): 图层名}
 *   `tpl`       {name, textLayers:[{name, contents}]} —— 模板组信息（名字是绑定的键）
 *   `tplRect`   {left,top,right,bottom} 模板组的 bounds（算网格用）
 *   `cols`      网格每行几个（默认 5）
 *   `maxWrites` 写文字次数闸门（默认 400）
 *   `rowsLimit` 出稿份数闸门（默认 200 —— 再多先问）
 * @returns {object} 计划读本（ok / n / writes / copies / warnings / estimatedMs / tooMany…）
 */
function planExport(req) {
  const r = req || {};
  const rows = r.rows || [];
  const header = r.header || [];
  const bindings = r.bindings || {};
  const tpl = r.tpl || null;
  const warnings = [];

  if (!tpl || !tpl.name) return { ok: false, error: "还没有模板：先在画布上选中一个图层组" };
  if (!rows.length) return { ok: false, error: "没有数据行（先导入 CSV）" };

  const tplNames = (tpl.textLayers || []).map((x) => String(x.name));
  const boundCols = [];
  /** 只含**有效**绑定的 {列: 图层序号} —— 命名要用它（绑到不存在的层的列，值根本没写进版面，
   *  拿它给副本命名会误导用户）。
   *  🔴 v0.5.0 为什么绑"序号"而不是"图层名"：真机上 `duplicate` 会把副本里的子层改名
   *  （`标题` → `标题 拷贝`），**按名字配对直接失效**（S48 第一轮实测：3 份副本一处都没写上）。
   *  副本的子层顺序与模板一致 ⇒ 按**序号**配对才稳。名字只用来显示给用户。 */
  const validBind = {};
  const bound = (c) => {
    const v = bindings[c];
    return v === undefined || v === null || v === "";    // ⚠️ 0 是合法序号，不能当"没绑"
  };
  for (let c = 0; c < header.length; c++) {
    if (bound(c)) continue;
    const idx = Number(bindings[c]);
    if (!isFinite(idx) || Math.floor(idx) !== idx || idx < 0 || idx >= tplNames.length) {
      /* 绑了一个模板里没有的层 —— 说清楚是哪一列、模板里到底有什么（最常见的配置错误） */
      warnings.push("「" + brief(header[c], 10) + "」绑到了模板里不存在的第 " + bindings[c] +
        " 个文字层（模板现在有 " + tplNames.length + " 个）");
      continue;
    }
    boundCols.push(c);
    validBind[c] = idx;
  }
  if (!boundCols.length) {
    return { ok: false, error: "一列都没绑上（模板组里的文字层：" + (tplNames.length ? tplNames.join(" / ") : "无") + "）" };
  }
  const unbound = [];
  for (let c = 0; c < header.length; c++) if (bound(c)) unbound.push(c);
  if (unbound.length) {
    warnings.push("有 " + unbound.length + " 列没绑定（" +
      unbound.map((c) => brief(header[c], 8)).join(" / ") + "）—— 这些列不会写进版面，不拦你");
  }

  const rowsLimit = isFinite(r.rowsLimit) && r.rowsLimit > 0 ? Math.round(r.rowsLimit) : 200;
  const n = rows.length;
  const writes = [];
  const copies = [];
  for (let i = 1; i <= n; i++) {
    const row = rows[i - 1] || [];
    for (const c of boundCols) {
      const v = row[c] === undefined || row[c] === null ? "" : String(row[c]);
      if (v === "") continue;                    // 空格子**不写**（保留模板原文，比写空更安全）
      const idx = validBind[c];
      writes.push({
        copy: i, col: c, layerIndex: idx, layerName: tplNames[idx],
        value: v, header: brief(header[c], 10),
      });
    }
    copies.push({ index: i, name: copyName(i, row, header, validBind) });
  }

  const emptyCells = n * boundCols.length - writes.length;
  if (emptyCells > 0) {
    warnings.push("有 " + emptyCells + " 个格子是空的 ⇒ **跳过不写**，那些位置保留模板原文（不是写成空）");
  }

  const cols = isFinite(r.cols) && r.cols > 0 ? Math.round(r.cols) : DEFAULT_COLS;
  const rc = r.tplRect || {};
  const w = Math.abs((rc.right || 0) - (rc.left || 0));
  const h = Math.abs((rc.bottom || 0) - (rc.top || 0));
  for (const cp of copies) {
    const g = gridOffset(cp.index, cols, w, h, r.gap);
    cp.dx = g.dx;
    cp.dy = g.dy;
    cp.col = g.col;
    cp.row = g.row;
  }

  const maxWrites = isFinite(r.maxWrites) && r.maxWrites > 0 ? Math.round(r.maxWrites) : DEFAULT_MAX_WRITES;
  const gridRows = Math.ceil(n / cols);
  const estimatedMs = Math.round(writes.length * WRITE_MS + n * DUP_MS + n * MOVE_MS);

  return {
    ok: true,
    n: n, cols: cols, gridRows: gridRows,
    boundCols: boundCols, unbound: unbound,
    writes: writes, copies: copies,
    writeCount: writes.length, perCopy: boundCols.length,
    emptyCells: emptyCells,
    estimatedMs: estimatedMs,
    tooMany: n > rowsLimit || writes.length > maxWrites,
    limits: { rows: rowsLimit, writes: maxWrites },
    tplW: w, tplH: h,
    warnings: warnings,
    style: r.style || {},
  };
}

/** 计划的一句话摘要（面板与日志共用） */
function describe(plan) {
  if (!plan || !plan.ok) return plan && plan.error ? plan.error : "（没有计划）";
  let s = plan.n + " 份 × " + plan.perCopy + " 处文字（共 " + plan.writeCount + " 次写入）";
  s += "　网格 " + plan.cols + " 列 × " + plan.gridRows + " 行";
  s += "　模板 " + Math.round(plan.tplW) + "×" + Math.round(plan.tplH) + "px";
  s += "　预估 ≈" + (plan.estimatedMs >= 1000 ? (Math.round(plan.estimatedMs / 100) / 10) + "s" : plan.estimatedMs + "ms");
  if (plan.emptyCells) s += "　跳过 " + plan.emptyCells + " 个空格";
  if (plan.tooMany) s += "　⚠ 超过闸门（份数 ≤" + plan.limits.rows + "、写入 ≤" + plan.limits.writes + "）";
  return s;
}

module.exports = {
  WRITE_MS, DUP_MS, MOVE_MS, DEFAULT_COLS, DEFAULT_MAX_WRITES, GAP_MIN,
  gridOffset, copyName, brief, planExport, describe,
};
