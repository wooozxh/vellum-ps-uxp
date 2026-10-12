/*
 * lib/history.js —— 批量操作的「整批撤销」（v0.6.0 新增，docs/49 §五 第 3 步）
 * ===========================================================================
 * 解决什么：PS 的历史记录是**按步**记的。一次「批量出稿」会往历史里塞几十上百步
 *   （复制 N 份 + 写 N×M 处文字 + 网格位移），用户想退回去得手动滚半天，还容易滚过头。
 *   ⇒ 真实后果不是"麻烦"，而是**同事不敢跑批量**。这才是痛点，比"时光机"实在。
 *
 * 做法：批量开始前记一个「标记」，不满意时**一步回到批量之前**。
 *   依据：`document.activeHistoryState` 是**可读可写**的 —— template-probe C4 实测
 *   （图层 1 → 2 → **1**，见 docs/49 §二）。batchPlay 侧的等价写法是
 *   `{_obj:"select", _target:[{_ref:"historyState", _offset:-N}]}`。
 *
 * 【本模块的三条纪律】
 *   ① **主路持对象、备路算步数，且两条路不混为一谈。**
 *      主路：mark 时拿下 `activeHistoryState` 对象引用，revert 时**直接赋回去**。
 *            它与"中间隔了多少步"无关 —— 用户撤回前又手动做了几步也不影响它。
 *      备路：`_offset` 是**相对位移**（相对当前状态往回数），只在"立刻撤回、中间无别的操作"
 *            时才可靠。⇒ 只在主路失败时兜底，并且**必须在读数里说明"位置可能不精确"**，
 *            绝不假装它和主路一样准。
 *   ② **退回必须自证。** revert 不是"调完就算成功"，要读回图层数并与 mark 时比。
 *      本项目铁律：**没报错 ≠ 生效**（S48 那条 `translate()` 不抛错、bounds 却一动不动）。
 *   ③ **标记绑文档。** 必须记 docId；换了文档**绝不**把标记套到另一张稿上。
 *
 * 【已验证 / 未验证 —— 不许混着当结论】
 *   ✅ 已实测：`activeHistoryState` **可写**（template-probe C4，**同一个模态内**）。
 *   ❓ 本步要验：**对象引用能不能跨模态边界持有**（模态 A 里取、模态 B 里用）。
 *      ⚠️ 这是整个功能的地基 —— 若只有"同模态内可写"，那"批量前记、批量后退"就无从谈起。
 *   ❓ 未验：历史容量上限把标记的状态挤出历史栈之后，赋值会**抛错**还是**静默不动**。
 *      ⇒ 所以 revert 一律**读回验证**，不靠"有没有抛错"判成败。
 *   ❓ 未验：`_offset` 备路的方向与可靠性（本步只记录它可不可用，不把它当主路）。
 *   ⬜ 本步**不做**「重层（文件级快照）」：那要写磁盘、要定清理策略与目录约定，是另一坨工作量；
 *      它的真实需求来自"导出审核版"这类高风险操作（第 4 步）。**这里不超范围声称。**
 */

const photoshop = require("photoshop");
const { app, core, action } = photoshop;
const batchPlay = action.batchPlay;

function msg(e) {
  return e && e.message ? e.message : String(e);
}

/** 只读取值；抛异常或 undefined 就返回兜底。 */
function safe(fn, dflt) {
  try {
    const v = fn();
    return v === undefined ? dflt : v;
  } catch (e) {
    return dflt;
  }
}

/** 所有会改状态的操作都要包在模态作用域里。 */
function runModal(fn, name) {
  return core.executeAsModal(fn, { commandName: name || "Vellum 工具箱" });
}

/* ===========================================================================
 * 一、单槽标记
 * ===========================================================================
 * 为什么是**单槽**而不是栈：用户的心智是"刚才那次批量我不满意，退回去"，
 *   "退回上上一次批量"几乎不存在。单槽也让 UI 只有一个撤销入口，不会逼用户选。
 *   （真要做多级，等真的出现需求再说 —— 现在做成栈只是凭空多一份要维护的状态。）
 * ------------------------------------------------------------------------- */

/** 当前标记；null = 没有。字段见 `mark()`。 */
let MARK = null;

/** 本进程内已用的序号（给 label 去重，纯诊断用） */
let seq = 0;

/**
 * 数图层总数（含嵌套组内部的）。**只读**。
 * ⚠️ 为什么不用 ps.js 里那个 `countLayersDeep`：本模块要被 ps.js require，
 *    再回头 require ps.js 就成**循环依赖**。这里就 10 行，自己实现更干净。
 */
function countLayersIn(doc) {
  let n = 0;
  const walk = (arr) => {
    for (const l of arr || []) {
      n++;
      if (l.layers && l.layers.length) walk(l.layers);
    }
  };
  try {
    walk(doc.layers);
  } catch (e) {
    /* 读不到就返回已数到的部分 —— 它只当"对照读数"用，不是判据本身 */
  }
  return n;
}

/** 只读：当前活动文档的图层数；没有文档返回 null。 */
function currentLayers() {
  try {
    if (!app.documents || !app.documents.length) return null;
    return countLayersIn(app.activeDocument);
  } catch (e) {
    return null;
  }
}

/** 只读：当前活动文档的历史步数；读不到返回 null（**不猜 0**）。 */
function currentHistoryLen() {
  try {
    if (!app.documents || !app.documents.length) return null;
    const h = app.activeDocument.historyStates;
    const n = h ? h.length : null;
    return typeof n === "number" ? n : null;
  } catch (e) {
    return null;
  }
}

/**
 * 记一个标记 —— 批量操作开始前调用。
 *
 * ⚠️ 语义：**覆盖**旧标记（单槽）。被覆盖的那个会记进返回值的 `superseded` 里，
 *    因为它意味着"上一次批量的退回点没了" —— 这件事要能被看见，不能悄悄发生。
 *
 * @param {string} label 人话标签（会显示在撤销入口上），如「批量出稿 20 份」
 * @returns {Promise<{ok:boolean, mark?:object, superseded?:string|null, error?:string}>}
 */
async function mark(label) {
  if (!app.documents || !app.documents.length) {
    return { ok: false, error: "没有打开的文档" };
  }

  let doc = null;
  try {
    doc = app.activeDocument;
  } catch (e) {
    return { ok: false, error: "读不到活动文档：" + msg(e) };
  }
  if (!doc) return { ok: false, error: "没有活动文档" };

  let state = null;
  let stateId = null;
  let stateName = null;
  let histLen = null;
  let layers = null;
  let err = null;

  try {
    await runModal(async () => {
      const d = app.activeDocument;
      /* ★ 主路的全部本钱：这个对象引用。它能不能跨模态持有 = 本功能能不能成立。 */
      state = d.activeHistoryState || null;
      stateId = safe(function () { return state && state.id; }, null);
      if (stateId === null) stateId = safe(function () { return state && state._id; }, null);
      stateName = safe(function () { return state && state.name; }, null);
      if (stateName === null) stateName = safe(function () { return state && state._name; }, null);
      histLen = safe(function () { const h = d.historyStates; return h ? h.length : null; }, null);
      layers = countLayersIn(d);
    }, "Vellum 工具箱：记撤销标记");
  } catch (e) {
    err = msg(e);
  }

  const prev = MARK;
  seq++;
  MARK = {
    seq: seq,
    label: String(label || "批量操作"),
    docId: safe(function () { return doc.id; }, null),
    docName: safe(function () { return doc.name; }, ""),
    state: state,           // ★ 主路：对象引用
    stateId: stateId,
    stateName: stateName,
    histLen: histLen,       // 备路：算步数用
    layers: layers,         // 对照读数：撤回后应回到这个数
    at: Date.now(),
    markError: err,         // 取标记时若出错，记下来（不吞）
  };

  return { ok: true, mark: MARK, superseded: prev ? prev.label : null };
}

/** 只读：当前标记的摘要（给 UI 用，**不碰 Photoshop** —— 会被频繁调用）。 */
function peek() {
  if (!MARK) return { has: false };
  return {
    has: true,
    label: MARK.label,
    docName: MARK.docName,
    docId: MARK.docId,
    layers: MARK.layers,
    ageMs: Date.now() - MARK.at,
    hasState: !!MARK.state,
    markError: MARK.markError,
  };
}

/** 放弃标记（用户主动清掉，或撤回成功后）。 */
function clear() {
  const had = MARK ? MARK.label : null;
  MARK = null;
  return { ok: true, cleared: had };
}

/**
 * 退回标记。
 *
 * @param {object} [opts]
 *   `via`  "auto"（默认，主路失败才走备路）| "state"（只走主路）| "offset"（只走备路）
 * @returns {Promise<object>} `{ok, via, before, after, want, error, note}`
 *   `after === want` 才算成功；**只信读回的图层数，不信"没抛错"**。
 */
async function revert(opts) {
  const o = opts || {};
  const via = o.via || "auto";
  const mk = MARK;
  const out = {
    ok: false, via: null, before: null, after: null, want: null,
    histBefore: null, histAfter: null, n: null, error: null, note: null,
  };

  if (!mk) { out.error = "没有可撤回的标记"; return out; }
  if (!app.documents || !app.documents.length) { out.error = "没有打开的文档"; return out; }

  const docIdNow = safe(function () { return app.activeDocument.id; }, null);
  if (String(docIdNow) !== String(mk.docId)) {
    out.error = "当前文档已不是记标记那一张（标记属于「" + mk.docName + "」）—— 不跨文档撤回";
    return out;
  }

  out.want = mk.layers;
  out.before = currentLayers();
  out.histBefore = currentHistoryLen();

  /* ---- 主路：把 mark 时拿到的对象引用直接赋回去 ---- */
  if (via === "auto" || via === "state") {
    if (!mk.state) {
      out.note = "标记里没有历史状态对象（记的时候就没取到）⇒ 只能走备路";
    } else {
      try {
        await runModal(async () => {
          app.activeDocument.activeHistoryState = mk.state;
        }, "Vellum 工具箱：撤回「" + mk.label + "」");
        out.via = "state";
      } catch (e) {
        out.error = "主路（对象赋值）失败：" + msg(e);
      }
    }
  }

  /* ---- 备路：按"相对当前往回数几步"位移 ---- */
  if (!out.via && (via === "auto" || via === "offset")) {
    const cur = currentHistoryLen();
    const base = mk.histLen;
    if (typeof cur !== "number" || typeof base !== "number") {
      if (!out.error) out.error = "读不到历史步数（主路也不可用）⇒ 无法撤回";
    } else {
      const n = cur - base;
      if (n <= 0) {
        if (!out.error) out.error = "历史里没有可回退的步数（当前 " + cur + " 步，标记时 " + base + " 步）";
      } else {
        try {
          await runModal(async () => {
            await batchPlay(
              [
                {
                  _obj: "select",
                  _target: [{ _ref: "historyState", _offset: -n }],
                  _options: { dialogOptions: "dontDisplay" },
                },
              ],
              {}
            );
          }, "Vellum 工具箱：撤回（位移 " + n + " 步）");
          out.via = "offset";
          out.n = n;
          /* 🔴 备路是**相对**的：用户若在批量之后又手动做了几步，这里会退到偏早的位置。
             所以这句话必须跟着读数一起出现在用户眼前，不能被当成"和主路一样准"。 */
          out.note = "走的是相对位移（往回 " + n + " 步）——**位置可能不精确**：" +
            "若撤回前还手动操作过，会退到比预期更早的位置";
        } catch (e) {
          if (!out.error) out.error = "备路（位移 " + n + " 步）失败：" + msg(e);
        }
      }
    }
  }

  out.after = currentLayers();
  out.histAfter = currentHistoryLen();

  /* ★ 成败只看**读回**：图层数回到标记时的数量才算成。
     ⚠️ 这条判据是**必要不充分**（数量相等 ≠ 状态完全相同：可能删一个又加一个）。
        但它能挡住"静默无变化"这个最危险的失败模式 —— 而那个模式恰恰是
        `activeHistoryState` 赋值失败时最可能的表现。 */
  if (out.via) {
    out.ok = out.after !== null && out.want !== null && out.after === out.want;
    if (!out.ok && !out.error) {
      out.error = "调了撤回命令，但图层数没回到标记时的 " + out.want + "（现在 " + out.after + "）" +
        " —— **没报错 ≠ 生效**，所以判为未成功";
    }
  }

  if (out.ok) clear();   // 撤回到位才清标记；没到位的标记留着，用户还能再试
  return out;
}

/* ===========================================================================
 * 二、纯函数（离线可测，见 tools/offline-smoke.cjs）
 * ------------------------------------------------------------------------- */

/**
 * 标记可用性判定 —— **纯函数**，不碰 Photoshop。
 * 给 UI 用：决定"要不要显示撤销入口"，以及显示的时候该说什么。
 *
 * @param {object} mk  `peek()` 的结果
 * @param {object} ctx `{ docId, layers, histLen }` 当前实况
 * @returns {{usable:boolean, reason:string, hint:string}}
 */
function assess(mk, ctx) {
  const c = ctx || {};
  if (!mk || !mk.has) {
    return { usable: false, reason: "没有标记", hint: "" };
  }
  if (mk.markError) {
    return { usable: false, reason: "记标记时就出错了：" + mk.markError, hint: "" };
  }
  if (c.docId !== undefined && c.docId !== null && String(c.docId) !== String(mk.docId)) {
    return {
      usable: false,
      reason: "当前文档已不是记标记那一张",
      hint: "标记属于「" + (mk.docName || "另一张稿") + "」—— 不跨文档撤回",
    };
  }
  /* ⚠️ 图层数已经等于标记时的数量：**不是"失效"，而是"可能已经在原位了"**。
     放在这里当**提示**而不是错误 —— 因为数量相等并不等于状态相同（可能删一个又加一个）。 */
  if (
    c.layers !== undefined && c.layers !== null &&
    mk.layers !== null && mk.layers !== undefined &&
    c.layers === mk.layers
  ) {
    return {
      usable: true,
      reason: "",
      hint: "当前图层数与标记时相同（" + c.layers + "）—— 可能已经退回去了，也可能只是碰巧数量相同",
    };
  }
  return { usable: true, reason: "", hint: "" };
}

/** 纯函数：标记的一句话（日志与按钮文案共用）。 */
function describe(mk) {
  if (!mk || !mk.has) return "（没有撤销标记）";
  const secs = Math.round((mk.ageMs || 0) / 1000);
  const age = secs < 60 ? secs + " 秒前" : Math.round(secs / 60) + " 分钟前";
  return mk.label + "（" + age + "，图层 " + (mk.layers === null ? "?" : mk.layers) + " 个）";
}

/** 纯函数：撤回结果的读数（日志用）。 */
function describeRevert(r) {
  if (!r) return "（没有结果）";
  if (!r.ok) return "撤回未成功：" + (r.error || "未知");
  const via = r.via === "state" ? "对象赋值（精确）" : "相对位移 " + r.n + " 步（可能不精确）";
  return "已撤回：图层 " + r.before + " → " + r.after + "（应回到 " + r.want + "）　方式=" + via;
}

module.exports = {
  mark: mark,
  revert: revert,
  peek: peek,
  clear: clear,
  assess: assess,
  describe: describe,
  describeRevert: describeRevert,
  /* 只读工具（自检与诊断用） */
  currentLayers: currentLayers,
  currentHistoryLen: currentHistoryLen,
  countLayersIn: countLayersIn,
};
