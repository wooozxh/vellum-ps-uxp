/*
 * Review Probe —— 「导出审核版 + 参数条」能力探针（M5 第 4 步的地基）
 * ===========================================================================
 * 为什么要有它：docs/49 §3.2 把「导出审核版」的链路写成了
 *
 *   先弹窗问出血 → 用户答完 → 进 executeAsModal：
 *     ① 记 mark → ② resizeCanvas 扩画布 → ③ 铺白底 + 写参数文字层
 *     → ④ 导出 → ⑤ doc.activeHistoryState = mark 一步还原
 *
 * 这条链上有整片地方是**没验证过的**：`resizeCanvas` 在 UXP 里到底有没有、
 * 导出走哪个 API、铺白底会不会踩 S17、中文参数条字体怎么指定、
 * 以及「画布尺寸变化 + 新增图层」能不能像图层增减那样**一步干净回退**。
 * 地基没验就写界面，等于把不确定性藏进代码里。本项目的做法是**先量**。
 *
 * 【本探针的五条纪律】（继承 template-probe，别破坏）
 *   1. **先普查、后动手** —— R1 只问「对象上到底有哪些方法」，不做任何修改。
 *      后面每一项都以前一项的读数为前提，不靠「我记得 API 是这样」。
 *   2. **写法矩阵只在自己的临时文档上试** —— 失败就记原始报错，
 *      绝不因为"试错"而碰到用户已打开的稿子。
 *   3. **允许「无结论」** —— 能力不存在就写 INCONCLUSIVE；既不写成 FAIL，
 *      更不写成"能做到"。本项目纪律：诊断项允许无结论，但不许把无结论写成结论。
 *   4. **不猜 ActionDescriptor** —— batchPlay 描述符只发本项目**已实测过**的那种
 *      （`make layer` / `set textStyle`），没有实测来源的一律不拼。
 *   5. **不改用户的稿、不留残留** —— 自建文档收尾全关，前景/背景色用完还原。
 *
 * 报告落盘：PluginData/report.json，外部用 `node tools/report.mjs` 读。
 * 自动触发：插件目录下存在 autorun.flag 时，加载即跑。
 *
 * UXP 硬约束提醒：
 *   - 引宿主模块必须 require()，不能 import。
 *   - 改文档的操作必须包在 core.executeAsModal() 里。
 *   - UXP 的集合对象（layers / guides）**不保证可迭代** —— 一律用 length + 下标。
 *   - 对 UXP 原生对象**不要**调 Object.prototype.toString.call(x)（见 describeNative）。
 */

const photoshop = require("photoshop");
const uxp = require("uxp");

const { app, core, action } = photoshop;
const { entrypoints, storage } = uxp;
const lfs = storage.localFileSystem;
const batchPlay = action.batchPlay;

const PLUGIN_ID = "com.wooozxh.reviewprobe";
const PLUGIN_VERSION = "1.0.0";
const REPORT_NAME = "report.json";
const FLAG_NAME = "autorun.flag";
/** 存在时**只跑样张**（R17），不跑全套 16 项。 */
const SAMPLES_FLAG = "samples.flag";

/* ==================================================================== 工具 */

function setStatus(text) {
  const el = document.getElementById("log");
  if (el) el.textContent = String(text);
  console.log("[ReviewProbe]", text);
}

/** 修改文档必须走模态作用域。 */
function runModal(fn, commandName) {
  return core.executeAsModal(fn, { commandName: commandName });
}

function nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

function errText(e) {
  if (!e) return String(e);
  if (e.message) return e.message;
  return String(e);
}

/** 把任意值压成一行短文本，用于写进报告。
 *  ⚠️ 不用 String(symbol)，也不对 UXP 原生对象做额外加工。 */
function brief(v, max) {
  const limit = typeof max === "number" ? max : 300;
  let s;
  try {
    if (v === null) s = "null";
    else if (v === undefined) s = "undefined";
    else if (typeof v === "string") s = v;
    else if (typeof v === "symbol") s = "Symbol(不可显示)";
    else if (typeof v === "function") s = "function";
    else s = JSON.stringify(v);
    if (s === undefined) s = "[JSON 化失败] typeof=" + typeof v;
  } catch (e) {
    s = "[无法序列化] " + errText(e);
  }
  return s.length > limit ? s.slice(0, limit) + "…(截断)" : s;
}

/** 安全地描述一个对象（可能是 UXP 原生对象）。
 *
 *  ★ 教训来源（template-probe 第一版 C2/C8 就栽在这里）：
 *    **不要对 UXP 原生对象调用 Object.prototype.toString.call(x)** ——
 *    它内部会读 x[Symbol.toStringTag]，而 UXP 原生绑定访问 Symbol 键时会抛
 *    `Cannot convert a Symbol value to a string`，当时这个异常被误当成"能力失败"。
 *    所以这里只用 typeof 和逐项 try/catch，绝不碰 Symbol。 */
function describeNative(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  const t = typeof v;
  if (t !== "object" && t !== "function") return t + " = " + brief(v, 120);
  const parts = ["typeof=" + t];
  try {
    parts.push("有 constructor=" + (v.constructor ? "是" : "否"));
  } catch (e) {
    parts.push("constructor 读不到");
  }
  try {
    parts.push("length=" + (typeof v.length === "number" ? v.length : "非数字/无"));
  } catch (e) {
    parts.push("length 读不到");
  }
  try {
    const keys = Object.keys(v);
    parts.push("Object.keys()=" + keys.length + " 项" + (keys.length ? "：" + brief(keys, 200) : ""));
  } catch (e) {
    parts.push("Object.keys() 失败：" + errText(e));
  }
  return parts.join(" / ");
}

/** 读一个可能抛异常的值，返回 { ok, value | error }。 */
function safe(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** 显示的读数：成功给值，失败给"读取失败：原因"。 */
function readOf(fn, max) {
  const r = safe(fn);
  return r.ok ? brief(r.value, max) : "读取失败：" + r.error;
}

/** 取成员类型名；读不到给 "读取失败(原因)"。 */
function typeOfMember(obj, name) {
  const r = safe(() => typeof obj[name]);
  return r.ok ? r.value : "读取失败(" + r.error + ")";
}

/* ======================================================== 临时文档管理 */

/** 探针自己建的文档都登记在这里，收尾时统一关闭，绝不碰用户的稿子。 */
const ownDocs = [];

/** 建一个"干净"的临时文档（纯白底、指定像素尺寸与分辨率）。 */
function plainPreset(w, h, ppi, name) {
  return {
    name: name || "RP-temp",
    width: w, height: h, units: "pixelsUnit",
    resolution: ppi || 72, resolutionUnits: "inchesUnit",
    depth: 8, scale: 1,
    mode: "RGB", fill: "white",
    profile: "sRGB IEC61966-2.1",
    artboards: []
  };
}

async function makeDoc(preset, label) {
  let doc = null;
  await runModal(async () => {
    doc = await app.createDocument({ presetJSON: JSON.stringify(preset) });
  }, "Review Probe: 建临时文档 " + label);
  if (doc) ownDocs.push(doc);
  return doc;
}

async function closeOwnDocs() {
  const out = [];
  for (let i = 0; i < ownDocs.length; i++) {
    const d = ownDocs[i];
    let nm = "?";
    try { nm = d.name; } catch (e) { /* 忽略 */ }
    try {
      await runModal(async () => {
        try { app.activeDocument = d; } catch (e) { /* 忽略 */ }
        await d.closeWithoutSaving();
      }, "Review Probe: 关闭临时文档");
      out.push(nm + " 已关闭");
    } catch (e) {
      out.push(nm + " 关闭失败：" + errText(e));
    }
  }
  ownDocs.length = 0;
  return out;
}

/* =========================================================== 只读小工具 */

function docWH(doc) {
  return {
    w: safe(() => doc.width).value,
    h: safe(() => doc.height).value
  };
}

/** 递归数图层总数（含嵌套组内）。 */
function countLayersDeep(doc) {
  let n = 0;
  const walk = (arr) => {
    const r = safe(() => (arr ? arr.length : 0));
    const len = r.ok ? r.value : 0;
    if (typeof len !== "number") return;
    for (let i = 0; i < len; i++) {
      const it = safe(() => arr[i]);
      if (!it.ok || !it.value) continue;
      n++;
      const sub = safe(() => it.value.layers);
      if (sub.ok && sub.value) walk(sub.value);
    }
  };
  const top = safe(() => doc.layers);
  if (top.ok && top.value) walk(top.value);
  return n;
}

/** 顶层图层名清单。 */
function layerNames(doc) {
  const out = [];
  const list = safe(() => doc.layers);
  if (!list.ok || !list.value) return out;
  const n = safe(() => list.value.length);
  const len = n.ok ? n.value : 0;
  if (typeof len !== "number") return out;
  for (let i = 0; i < len && i < 20; i++) {
    const nm = safe(() => list.value[i].name);
    out.push(nm.ok ? nm.value : "?");
  }
  return out;
}

/** 已知可用的建层写法（与 hello-uxp 一致，**非猜测**）。 */
async function addTestLayer(name) {
  await runModal(async () => {
    await batchPlay(
      [
        {
          _obj: "make",
          _target: [{ _ref: "layer" }],
          using: { _obj: "layer", name: name }
        }
      ],
      {}
    );
  }, "Review Probe: 建测试图层 " + name);
}

/* ====================================================== 颜色（已实测写法） */
/*
 * 写法来源：env-check 探针真机实测（2026-10-10），工具箱 lib/ps.js 文件头抄录。
 * ⚠️ 读和写的 target **不一样**，写错会静默失败：
 *   读： [{ _property }, { _ref:"application", _enum:"ordinal", _value:"targetEnum" }]
 *   写： [{ _ref:"color", _property }]
 * ⚠️ 绿色分量键名是 **`grain`** 不是 `green`。
 */

const COLOR_PROP = { foreground: "foregroundColor", background: "backgroundColor" };

function appRef() {
  return { _ref: "application", _enum: "ordinal", _value: "targetEnum" };
}

/** 读一个颜色槽，返回 { ok, rgb|raw|error }。只读。 */
async function readColorSlot(slot) {
  const prop = COLOR_PROP[slot];
  let raw = null;
  try {
    const res = await batchPlay(
      [{ _obj: "get", _target: [{ _property: prop }, appRef()] }],
      {}
    );
    raw = res && res[0] ? res[0][prop] : null;
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
  if (!raw) return { ok: false, error: "读数里没有 " + prop, raw: raw };
  const r = raw.red;
  const g = raw.grain !== undefined && raw.grain !== null ? raw.grain : raw.green;
  const b = raw.blue;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") {
    return { ok: false, error: "颜色分量不是数字", raw: raw };
  }
  return { ok: true, rgb: { r: Math.round(r), g: Math.round(g), b: Math.round(b) }, raw: raw };
}

/** 设一个颜色槽（走已验证写法）。
 *
 *  🔴 2026-10-13 第一轮探针 R4 踩到的坑：`set` **必须包在模态里** ——
 *     直接调会报 `set may modify the state of Photoshop. Such events are only
 *     allowed from inside a modal scope.`
 *     （读 `get` 不受此限，所以最初的写法"读能通、写不能通"，很容易漏掉。）
 *     ⇒ 教训：**凡是 `_obj:"set"` 的 batchPlay，一律进模态**，别靠"读能跑"推断"写也能跑"。 */
async function writeColorSlot(slot, rgb) {
  const prop = COLOR_PROP[slot];
  const to = {
    _obj: "RGBColor",
    red: Math.round(rgb.r), grain: Math.round(rgb.g), blue: Math.round(rgb.b)
  };
  try {
    await runModal(async () => {
      await batchPlay(
        [{ _obj: "set", _target: [{ _ref: "color", _property: prop }], to: to, _options: { dialogOptions: "dontDisplay" } }],
        {}
      );
    }, "Review Probe: 设" + (slot === "background" ? "背景" : "前景") + "色");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/* ================================================================== 检查项 */

/** R1 普查用的候选成员表。**只是"去问一下"，不含任何"应该有"的断言。 */
const DOC_INSTANCE_MEMBERS = [
  // 画布 / 尺寸
  "resizeCanvas", "resizeImage", "crop", "trim", "revealAll",
  // 图层合并 / 文档级
  "flatten", "mergeVisibleLayers", "duplicate", "close", "closeWithoutSaving",
  // 存取 / 导出
  "save", "saveAs", "export",
  // 建层
  "layers", "activeLayers", "layerTree",
  "createLayer", "createGroup", "createTextLayer", "createRectangle", "createEllipse",
  "createSolidColorLayer", "createFillLayer", "createGradientLayer", "createPatternLayer",
  "createPixelLayer", "createClippingMask", "createLayerMask", "createLayerGroup",
  // 选区
  "selectRectangle", "selectEllipse", "selectAll", "deselect", "selection",
  // 历史 / 快照
  "historyStates", "activeHistoryState", "snapshots",
  // 属性
  "id", "name", "title", "path", "saved",
  "mode", "bitsPerChannel", "colorProfileName", "colorProfileType",
  "width", "height", "resolution", "guides", "artboards",
  // 变换
  "transform", "resize", "rotate", "translate", "flip"
];

/** saveAs 下面可能有的格式方法名（只用于"问一下在不在"）。 */
const SAVEAS_SUB = [
  "png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "psd", "psb", "pdf", "saveAsPNG"
];

/** R5 用的中文字体候选（按"能不能在同事机器上指望它"排序）。 */
const FONT_CANDIDATES = [
  "MicrosoftYaHei", "MicrosoftYaHei-Bold", "MicrosoftYaHeiUI",
  "SimHei", "SimSun", "NSimSun", "FangSong", "KaiTi",
  "MicrosoftJhengHei", "MingLiU", "PMingLiU",
  "SourceHanSansCN-Regular", "SourceHanSansSC-Regular", "SourceHanSansSC-Normal",
  "NotoSansCJKsc-Regular", "NotoSansSC-Regular",
  "AdobeSongStd-Light", "AdobeHeitiStd-Regular", "AdobeKaitiStd-Regular",
  "PingFangSC-Regular", "HiraginoSansGB-W3"
];

/** 原型链上抓自有属性名（只读；UXP 原生对象上可能抓不到，所以全包 try/catch）。 */
function protoLevels(obj, maxDepth) {
  const out = [];
  let cur = null;
  const first = safe(() => Object.getPrototypeOf(obj));
  if (!first.ok) return { levels: out, error: first.error };
  cur = first.value;
  let d = 0;
  while (cur && d < (maxDepth || 5)) {
    const ns = safe(() => Object.getOwnPropertyNames(cur));
    out.push({
      level: d,
      count: ns.ok ? ns.value.length : null,
      names: ns.ok ? ns.value.slice(0, 120) : [],
      error: ns.ok ? null : ns.error
    });
    const nxt = safe(() => Object.getPrototypeOf(cur));
    if (!nxt.ok || !nxt.value) break;
    cur = nxt.value;
    d++;
  }
  return { levels: out, error: null };
}

/* ------------------------------------------------------------------- R1 */

const R1 = {
  id: "R1",
  name: "Document / 宿主能力普查（只读，决定后面各项能不能做）",
  note: "★ 本项不做任何修改 —— 只问「对象上到底有什么」，后面每一项的判据都从这里来",
  async run() {
    const lines = [];
    const key = {};   // 关键结论，供后续项复用

    const doc = await makeDoc(plainPreset(200, 150, 72, "RP-R1-census"), "R1");
    if (!doc) throw new Error("createDocument 未返回文档");

    /* ---- ① Document 实例上的候选成员 ---- */
    lines.push("── ① Document 实例上的候选成员（typeof 逐个探） ──");
    const present = [];
    const absent = [];
    for (let i = 0; i < DOC_INSTANCE_MEMBERS.length; i++) {
      const k = DOC_INSTANCE_MEMBERS[i];
      const t = typeOfMember(doc, k);
      if (t === "undefined") absent.push(k);
      else present.push(k + "(" + t + ")");
    }
    lines.push("存在 " + present.length + " / 共探 " + DOC_INSTANCE_MEMBERS.length + " 个：");
    lines.push("  " + (present.length ? present.join("、") : "（一个都没有）"));
    lines.push("不存在：" + (absent.length ? absent.join("、") : "（无）"));

    /* 关键结论：本步最想知道的两个 */
    key.resizeCanvas = typeOfMember(doc, "resizeCanvas");
    key.resizeImage = typeOfMember(doc, "resizeImage");
    key.saveAs = typeOfMember(doc, "saveAs");
    key.createTextLayer = typeOfMember(doc, "createTextLayer");

    /* ---- ② 原型链上的自有属性名 ---- */
    lines.push("");
    lines.push("── ② 原型链（Object.getOwnPropertyNames 逐层） ──");
    const pl = protoLevels(doc, 5);
    if (pl.error) {
      lines.push("  原型链读取失败：" + pl.error);
    } else if (!pl.levels.length) {
      lines.push("  （拿不到原型链 —— UXP 原生对象可能不暴露）");
    } else {
      for (let i = 0; i < pl.levels.length; i++) {
        const L = pl.levels[i];
        lines.push("  level " + L.level + "：count=" + L.count +
          (L.error ? " 读取失败：" + L.error : ""));
        if (L.names && L.names.length) lines.push("    " + L.names.join(", "));
      }
    }

    /* ---- ③ doc.saveAs 下面的格式方法 ---- */
    lines.push("");
    lines.push("── ③ doc.saveAs 的子方法 ──");
    const sa = safe(() => doc.saveAs);
    if (!sa.ok) {
      lines.push("  读取 doc.saveAs 失败：" + sa.error);
    } else if (!sa.value) {
      lines.push("  doc.saveAs 是 " + sa.value + "（不存在）");
    } else {
      lines.push("  " + describeNative(sa.value));
      const found = [];
      for (let i = 0; i < SAVEAS_SUB.length; i++) {
        const k = SAVEAS_SUB[i];
        const t = typeOfMember(sa.value, k);
        if (t !== "undefined") found.push(k + "(" + t + ")");
      }
      lines.push("  子方法：" + (found.length ? found.join("、") : "（一个都没探到）"));
      const sapl = protoLevels(sa.value, 3);
      if (!sapl.error) {
        for (let i = 0; i < sapl.levels.length; i++) {
          const L = sapl.levels[i];
          if (L.names && L.names.length) {
            lines.push("  saveAs 原型 level " + L.level + "：" + L.names.join(", "));
          }
        }
      }
      key.saveAsPng = typeOfMember(sa.value, "png");
    }

    /* ---- ④ 宿主其它命名空间的方法 ---- */
    lines.push("");
    lines.push("── ④ 宿主其它命名空间（只读探） ──");
    const HOST_SETS = [
      { label: "app", obj: app, names: ["createDocument", "open", "activeDocument", "documents", "fonts", "foregroundColor", "backgroundColor", "actionTree", "showAlert", "bringToFront"] },
      { label: "core", obj: core, names: ["executeAsModal", "showAlert", "getActiveDocument", "calculateDialogSize", "redrawDocument", "isModal"] },
      { label: "action", obj: action, names: ["batchPlay", "getDocumentInfo", "fromJSON", "validateJSON"] },
      { label: "uxp.storage.localFileSystem", obj: lfs, names: ["getDataFolder", "getPluginFolder", "getFolder", "getTemporaryFolder", "getFileForSaving", "getEntryWithUrl", "createPersistentToken"] }
    ];
    for (let i = 0; i < HOST_SETS.length; i++) {
      const set = HOST_SETS[i];
      if (!set.obj) { lines.push("  " + set.label + " = " + brief(set.obj)); continue; }
      const got = [];
      const miss = [];
      for (let j = 0; j < set.names.length; j++) {
        const k = set.names[j];
        const t = typeOfMember(set.obj, k);
        if (t === "undefined") miss.push(k); else got.push(k + "(" + t + ")");
      }
      lines.push("  " + set.label + "：" + (got.length ? got.join("、") : "（都没有）"));
      if (miss.length) lines.push("    无：" + miss.join("、"));
    }

    /* ---- ⑤ 顺带把两个后续项要用的读数取出来 ---- */
    lines.push("");
    lines.push("── ⑤ 后续项要用的读数（顺带取，只读） ──");
    lines.push("  本机文档数        = " + readOf(() => app.documents.length));
    lines.push("  临时文档 w × h    = " + readOf(() => Math.round(doc.width)) + " × " + readOf(() => Math.round(doc.height)));
    lines.push("  临时文档图层数    = " + countLayersDeep(doc) + "（应为 1）");
    lines.push("  doc.guides 形态   = " + describeNative(safe(() => doc.guides).value));
    lines.push("  historyStates.len = " + readOf(() => (doc.historyStates ? doc.historyStates.length : null)));

    lines.push("");
    lines.push("⇒ 普查完成（本项只读，未改任何东西）。resizeCanvas=" + key.resizeCanvas +
      "，resizeImage=" + key.resizeImage + "，saveAs=" + key.saveAs +
      "，saveAs.png=" + key.saveAsPng);

    /* 把关键结论挂到全局，供 R2/R3 取用（同一次运行内共享） */
    CENSUS = key;

    return { status: "PASS", detail: lines.join("\n") };
  }
};

/** R1 的结论，R2/R3 复用（避免重复普查）。 */
let CENSUS = null;

/* ------------------------------------------------------------------- R2 */

const R2 = {
  id: "R2",
  name: "resizeCanvas 写法矩阵（扩画布要用的那一发）",
  note: "★ 4 个变体各用一张全新临时文档 —— 失败也不污染下一发",
  async run() {
    const lines = [];
    const have = CENSUS ? CENSUS.resizeCanvas : null;
    lines.push("R1 普查结论：typeof doc.resizeCanvas = " + have);
    lines.push("");

    if (have === "undefined") {
      lines.push("⇒ resizeCanvas 在 Document 实例上**不存在**。");
      lines.push("   本项**无结论**（INCONCLUSIVE）：不能判成「做不到」——");
      lines.push("   它可能挂在别处（如 app 级命令），或者只能走 batchPlay；");
      lines.push("   而 batchPlay 的 resizeCanvas 描述符**必须录制**，本项目纪律禁止靠猜。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const W0 = 400, H0 = 300, H1 = 360;

    /* 变体表：都是"文档化的 DOM 调用形状"的尝试，不是 batchPlay 描述符。
       ⚠️ 哪个形状被接受由真机说了算，这里只负责逐个试 + 记原始报错。 */
    const VARIANTS = [
      {
        id: "V1", desc: "resizeCanvas(w, h)  —— 两个参数",
        call: (d) => d.resizeCanvas(W0, H1)
      },
      {
        id: "V2", desc: 'resizeCanvas(w, h, "topCenter")  —— 三个参数（锚点是字符串）',
        call: (d) => d.resizeCanvas(W0, H1, "topCenter")
      },
      {
        id: "V3", desc: "resizeCanvas({ width, height })  —— 对象参数",
        call: (d) => d.resizeCanvas({ width: W0, height: H1 })
      },
      {
        id: "V4", desc: 'resizeCanvas({ width, height, anchor: "topCenter" })',
        call: (d) => d.resizeCanvas({ width: W0, height: H1, anchor: "topCenter" })
      },
      {
        id: "V5", desc: 'resizeCanvas({ width, height, anchor: { _enum:"anchorPosition", _value:"topCenter" } })',
        call: (d) => d.resizeCanvas({
          width: W0, height: H1,
          anchor: { _enum: "anchorPosition", _value: "topCenter" }
        })
      }
    ];

    const results = [];
    let winner = null;

    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      lines.push("── " + v.id + "：" + v.desc + " ──");
      const doc = await makeDoc(plainPreset(W0, H0, 72, "RP-R2-" + v.id), "R2-" + v.id);
      if (!doc) { lines.push("  建临时文档失败，跳过"); lines.push(""); continue; }

      const before = docWH(doc);
      let err = null;
      try {
        await runModal(async () => {
          await v.call(doc);
        }, "Review Probe: R2 " + v.id + " 试扩画布");
      } catch (e) {
        err = errText(e);
      }
      const after = docWH(doc);
      const ok = !err &&
        Math.round(after.w) === W0 && Math.round(after.h) === H1;

      lines.push("  调用前：" + Math.round(before.w) + " × " + Math.round(before.h));
      lines.push("  调用后：" + Math.round(after.w) + " × " + Math.round(after.h));
      if (err) lines.push("  原始报错：" + err);
      lines.push("  判定：" + (ok ? "✅ 生效（尺寸变成了 " + W0 + " × " + H1 + "）" : "✗ 未生效"));

      results.push({ id: v.id, desc: v.desc, error: err, w: after.w, h: after.h, ok: ok });
      if (ok && !winner) winner = v;
      lines.push("");
    }

    lines.push("── 汇总 ──");
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push("  " + r.id + " " + (r.ok ? "✅ 生效" : "✗ 不生效") +
        "  读数 " + Math.round(r.w) + " × " + Math.round(r.h) +
        (r.error ? "  报错：" + r.error : ""));
    }

    if (!winner) {
      lines.push("");
      lines.push("⇒ 5 个变体**都没能**扩画布。⚠️ 不要据此断言「做不到」——");
      lines.push("   更可能是我试的形状都不对（锚点枚举名/参数个数/是否 async 都可能不同）。");
      lines.push("   下一步应改走 batchPlay 并**录制**描述符（需要人在 UXP DevTools 里录）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    lines.push("");
    lines.push("⇒ 采用写法：" + winner.id + " —— " + winner.desc);
    lines.push("   ⚠️ 仍未确认的是「新空间落在哪一侧」：本项只验了尺寸变化，");
    lines.push("      锚点朝向要靠 R4 导出 PNG 后由外部脚本读像素确认（不靠肉眼）。");
    R2_WINNER = winner;
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/** R2 找到的可用写法，R4/R6 复用。 */
let R2_WINNER = null;

/** 用 R2 找到的写法扩画布（拿不到就先试 V2 形状）。 */
async function doResizeCanvas(doc, w, h) {
  if (R2_WINNER) return await R2_WINNER.call(doc, w, h);
  return await doc.resizeCanvas(w, h, "topCenter");
}

/* ------------------------------------------------------------------- R3 */

const R3 = {
  id: "R3",
  name: "导出机制：saveAs 普查 + 真导一张 PNG",
  note: "★ 导出是「审核版」的出口，导不出来这个功能就不成立",
  async run() {
    const lines = [];
    const have = CENSUS ? CENSUS.saveAs : null;
    const havePng = CENSUS ? CENSUS.saveAsPng : null;
    lines.push("R1 普查结论：typeof doc.saveAs = " + have + "，typeof doc.saveAs.png = " + havePng);
    lines.push("");

    if (have === "undefined" || havePng === "undefined") {
      lines.push("⇒ doc.saveAs / doc.saveAs.png 未探到 ⇒ 本项**无结论**。");
      lines.push("   不排除导出要走别的路（batchPlay 的 export 描述符等），但那条路描述符必须录制，");
      lines.push("   本项目纪律禁止靠猜 ⇒ 不试。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const doc = await makeDoc(plainPreset(400, 300, 72, "RP-R3-export"), "R3");
    if (!doc) throw new Error("createDocument 未返回文档");

    const folder = await lfs.getDataFolder();
    const lines2 = [];
    const ATTEMPTS = [
      { id: "A", desc: "saveAs.png(entry)", call: (d, e) => d.saveAs.png(e) },
      { id: "B", desc: "saveAs.png(entry, {}, true)", call: (d, e) => d.saveAs.png(e, {}, true) },
      { id: "C", desc: "saveAs.png(entry, { compression: 6 })", call: (d, e) => d.saveAs.png(e, { compression: 6 }) }
    ];

    let okAttempt = null;
    let artifact = null;

    for (let i = 0; i < ATTEMPTS.length; i++) {
      const a = ATTEMPTS[i];
      const fname = "review-probe-r3-" + a.id + ".png";
      const f = await folder.createFile(fname, { overwrite: true });
      lines2.push("── " + a.id + "：" + a.desc + " ──");
      let err = null;
      try {
        await runModal(async () => {
          await a.call(doc, f);
        }, "Review Probe: R3 试导出 " + a.id);
      } catch (e) {
        err = errText(e);
      }
      // 落盘证据：文件在不在、多大
      let size = null;
      let sizeErr = null;
      try {
        const st = await f.read({ format: storage.formats.binary });
        size = st && st.byteLength !== undefined ? st.byteLength : (st && st.length);
      } catch (e) {
        sizeErr = errText(e);
      }
      lines2.push("  报错：" + (err || "（无）"));
      lines2.push("  文件：" + fname);
      lines2.push("  字节：" + (size === null ? "读不到（" + sizeErr + "）" : size));
      lines2.push("  判定：" + (!err && size ? "✅ 导出疑似成功" : "✗ 未成功"));
      lines2.push("");

      if (!err && size && !okAttempt) {
        okAttempt = a;
        artifact = { name: fname, path: safe(() => f.nativePath).value || null, bytes: size };
        break;   // 一发成功就收手，不必把三发都试完
      }
    }

    lines.push(lines2.join("\n"));

    if (!okAttempt) {
      lines.push("⇒ 三个形状都没导出来。⚠️ 仍标 INCONCLUSIVE 而非 FAIL ——");
      lines.push("   更可能是我传的参数形状不对（entry 类型 / 选项字段名 / 是否需要 asCopy）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    lines.push("⇒ 采用写法：" + okAttempt.id + " —— " + okAttempt.desc);
    lines.push("   产物：" + artifact.path + "（" + artifact.bytes + " 字节）");
    lines.push("   ⚠️ 这只是「saveAs 能落盘」，导出的图**内容对不对**要外部脚本读像素（见 R4 与外部校验）。");
    ARTIFACTS.push(artifact);
    R3_WINNER = okAttempt;
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/** R3 找到的导出写法，R4 复用。 */
let R3_WINNER = null;

/** 本次运行产出的物证（导出文件），写进报告供外部脚本核对。 */
const ARTIFACTS = [];

/** 用 R3 找到的写法导一张 PNG 到插件数据目录，返回 { path, bytes } 或 null。 */
async function exportPng(doc, fileBaseName) {
  const folder = await lfs.getDataFolder();
  const fname = fileBaseName + ".png";
  const f = await folder.createFile(fname, { overwrite: true });
  if (R3_WINNER) {
    await runModal(async () => {
      await R3_WINNER.call(doc, f);
    }, "Review Probe: 导出 " + fname);
  } else {
    await runModal(async () => {
      await doc.saveAs.png(f);
    }, "Review Probe: 导出（默认形状） " + fname);
  }
  let size = null;
  try {
    const st = await f.read({ format: storage.formats.binary });
    size = st && st.byteLength !== undefined ? st.byteLength : (st && st.length);
  } catch (e) { /* 读不到就留 null，外部脚本会 stat */ }
  const out = { name: fname, path: safe(() => f.nativePath).value || null, bytes: size };
  ARTIFACTS.push(out);
  return out;
}

/* ------------------------------------------------------------------- R4 */

const R4 = {
  id: "R4",
  name: "参数条白底 + 落点（产出物证，像素结论交给外部脚本）",
  note: "★ 本项只负责「把可判定的证据做出来」——白不白、落在哪一侧，由外部读 PNG 像素判，不靠肉眼",
  async run() {
    const lines = [];
    const W0 = 400, H0 = 300, H1 = 360;

    if (!R2_WINNER) {
      lines.push("R2 没找到可用的扩画布写法 ⇒ 本项**无结论**（不自欺地标 PASS）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    if (!R3_WINNER) {
      lines.push("R3 没找到可用的导出写法 ⇒ 本项**无结论**（导不出图就没法留物证）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const doc = await makeDoc(plainPreset(W0, H0, 72, "RP-R4-white"), "R4");
    if (!doc) throw new Error("createDocument 未返回文档");

    /* ── ① 先读背景色（对照读数） ── */
    const bgBefore = await readColorSlot("background");
    lines.push("扩画布前 · 背景色读数：" +
      (bgBefore.ok ? "RGB(" + bgBefore.rgb.r + "," + bgBefore.rgb.g + "," + bgBefore.rgb.b + ")" : "读取失败：" + bgBefore.error));

    /* ── ② 把背景色设成纯白（已实测写法） ── */
    const setRes = await writeColorSlot("background", { r: 255, g: 255, b: 255 });
    lines.push("设背景色=纯白：" + (setRes.ok ? "已执行（无报错）" : "失败：" + setRes.error));

    const bgAfterSet = await readColorSlot("background");
    lines.push("设完 · 回读背景色：" +
      (bgAfterSet.ok ? "RGB(" + bgAfterSet.rgb.r + "," + bgAfterSet.rgb.g + "," + bgAfterSet.rgb.b + ")" : "读取失败：" + bgAfterSet.error));
    lines.push("  ⚠️ 判据要求「回读命中 **且** 与设置前不同」——只比「没报错」会被静默失败骗（env-check 踩过）。");

    /* ── ③ 扩画布 ── */
    const before = docWH(doc);
    let resizeErr = null;
    try {
      await runModal(async () => {
        await doResizeCanvas(doc, W0, H1);
      }, "Review Probe: R4 扩画布");
    } catch (e) {
      resizeErr = errText(e);
    }
    const after = docWH(doc);
    lines.push("");
    lines.push("扩画布：" + Math.round(before.w) + " × " + Math.round(before.h) +
      " → " + Math.round(after.w) + " × " + Math.round(after.h) +
      (resizeErr ? "  报错：" + resizeErr : ""));

    /* ── ④ 导出物证 ── */
    let art = null;
    try {
      art = await exportPng(doc, "review-probe-r4-white");
      lines.push("导出物证：" + (art.path || art.name) + "（" + (art.bytes === null ? "字节读不到" : art.bytes + " 字节") + "）");
    } catch (e) {
      lines.push("导出物证失败：" + errText(e));
    }

    /* ── ⑤ 还原背景色（不留痕） ── */
    if (bgBefore.ok) {
      const back = await writeColorSlot("background", bgBefore.rgb);
      const chk = await readColorSlot("background");
      lines.push("");
      lines.push("还原背景色：" + (back.ok ? "已执行" : "失败：" + back.error) +
        "；回读 " + (chk.ok ? "RGB(" + chk.rgb.r + "," + chk.rgb.g + "," + chk.rgb.b + ")" : "读取失败"));
    } else {
      lines.push("");
      lines.push("⚠️ 事先没读到背景色 ⇒ **无法还原**，背景色现在停在纯白。这一点要如实交代。");
    }

    lines.push("");
    lines.push("── 像素判定（本项做不了，交给外部脚本） ──");
    lines.push("  待判的两件事：");
    lines.push("   ① 参数条区域（y > " + H0 + "）是不是纯白？");
    lines.push("   ② 图片区（y < " + H0 + "）有没有被改动（应保持原样）？");
    lines.push("   ③ 新空间落在哪一侧（锚点朝向）？");
    lines.push("  判法：拿导出的 PNG 交给外部 Python + Pillow 读像素，不靠肉眼。");

    if (!art) {
      lines.push("");
      lines.push("⇒ 物证没产出 ⇒ 本项**无结论**。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    lines.push("");
    lines.push("⇒ 物证已产出（" + art.name + "）。**本项状态只表示「证据做出来了」**，");
    lines.push("   白底成不成立以外部像素读数为准（见 docs/50 §二 与 review-probe/README.md）。");
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------- R5 */

const R5 = {
  id: "R5",
  name: "参数条中文字体：候选普查 + 显式传 fontName 是否真生效",
  note: "★ 探针 C6/S32 已证 textItem.font 在这台机器上读不到 ⇒ 字体只能靠建层时的 textStyleRange",
  async run() {
    const lines = [];

    /* ── ① 本机字体清单（只读） ── */
    const fonts = safe(() => app.fonts);
    if (!fonts.ok || !fonts.value) {
      lines.push("读 app.fonts 失败：" + (fonts.ok ? "值为 " + brief(fonts.value) : fonts.error));
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    const n = safe(() => fonts.value.length);
    const len = n.ok ? n.value : null;
    lines.push("app.fonts.length = " + len + "（UXP 里 app.fonts **就是集合本身**，没有 getFontList）");
    if (typeof len !== "number") {
      lines.push("⇒ 拿不到 length ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    function norm(s) {
      return String(s == null ? "" : s).toLowerCase().replace(/[\s\-_]/g, "");
    }

    const psSet = {}, looseSet = {};
    for (let i = 0; i < len; i++) {
      const it = safe(() => fonts.value[i]);
      if (!it.ok || !it.value) continue;
      const a = safe(() => it.value._postScriptName);
      if (a.ok && typeof a.value === "string") psSet[norm(a.value)] = a.value;
      const b = safe(() => it.value._name);
      if (b.ok && typeof b.value === "string") looseSet[norm(b.value)] = b.value;
      const c = safe(() => it.value._family);
      if (c.ok && typeof c.value === "string") looseSet[norm(c.value)] = c.value;
    }

    lines.push("");
    lines.push("── 中文字体候选（在不在本机） ──");
    const hit = [];
    for (let i = 0; i < FONT_CANDIDATES.length; i++) {
      const cand = FONT_CANDIDATES[i];
      const k = norm(cand);
      const inPs = !!psSet[k];
      const inLoose = !!looseSet[k];
      lines.push("  " + (inPs || inLoose ? "✅" : "— ") + " " + cand +
        (inPs ? "（命中 PostScript 名）" : inLoose ? "（命中 name/family）" : ""));
      if (inPs || inLoose) hit.push(cand);
    }
    lines.push("");
    lines.push("命中 " + hit.length + " 个：" + (hit.length ? hit.join("、") : "（一个都没有）"));

    if (!hit.length) {
      lines.push("");
      lines.push("⇒ 候选表里的中文字体**一个都不在本机**。");
      lines.push("   这不等于「不能写中文」—— 只是说明「必须显式传 fontName」这件事更关键：");
      lines.push("   传一个本机没有的字体名会让 PS 回退到默认字体（可能变方框）。");
      lines.push("   ⇒ 参数条要么用本机一定有的字体，要么把字体随插件带（本轮不评估后者）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    /* ── ② 显式传 fontName 建一个中文文字层，读回是否真生效 ──
       ⚠️ 描述符来源：**Adobe 官方样例** layer-creation-js-sample
          （工具箱 lib/ps.js 的 textLayerBoxDesc 就是照它写的，已实测可用）。
          字体放 textStyleRange[].textStyle.fontName —— 不是在 textItem 上写。 */
    const pick = hit[0];
    lines.push("");
    lines.push("── 建一个中文文字层，显式传 fontName=" + pick + " ──");

    const doc = await makeDoc(plainPreset(400, 200, 72, "RP-R5-font"), "R5");
    if (!doc) throw new Error("createDocument 未返回文档");

    const text = "审核用 非成品 ABC 0123";
    const desc = {
      _obj: "make",
      _target: [{ _ref: "textLayer" }],
      using: {
        _obj: "textLayer",
        textKey: text,
        textShape: [
          {
            _obj: "textShape",
            char: { _enum: "char", _value: "box" },
            bounds: {
              _obj: "rectangle",
              top: { _unit: "pixelsUnit", _value: 20 },
              left: { _unit: "pixelsUnit", _value: 20 },
              bottom: { _unit: "pixelsUnit", _value: 90 },
              right: { _unit: "pixelsUnit", _value: 380 }
            }
          }
        ],
        textStyleRange: [
          {
            _obj: "textStyleRange",
            from: 0, to: text.length,
            textStyle: {
              _obj: "textStyle",
              fontName: pick,
              size: { _unit: "pointsUnit", _value: 14 },
              color: { _obj: "RGBColor", red: 0, grain: 0, blue: 0 }
            }
          }
        ],
        name: "RP-参数条字体"
      },
      _options: { dialogOptions: "dontDisplay" }
    };

    let mkErr = null;
    try {
      await runModal(async () => {
        await batchPlay([desc], {});
      }, "Review Probe: R5 建中文文字层");
    } catch (e) {
      mkErr = errText(e);
    }
    lines.push("建层报错：" + (mkErr || "（无）"));

    const names = layerNames(doc);
    lines.push("建完图层：" + brief(names));

    /* 读回字体：走 DOM 的 textItem.characterStyle.font（探针 C6 实测的路径） */
    const readBack = safe(() => {
      const top = doc.layers;
      for (let i = 0; i < top.length; i++) {
        const L = top[i];
        if (L.kind === "text" && L.textItem && L.textItem.characterStyle) {
          return L.textItem.characterStyle.font;
        }
      }
      return null;
    });
    lines.push("读回 characterStyle.font = " + (readBack.ok ? brief(readBack.value) : "读取失败：" + readBack.error));

    const same = readBack.ok && readBack.value && norm(readBack.value) === norm(pick);
    lines.push("与传入的 fontName 归一化后是否一致：" + (same ? "✅ 一致" : "✗ 不一致"));

    if (mkErr) {
      lines.push("");
      lines.push("⇒ 建层本身就报错 ⇒ 本项**失败**（但不能归因到字体名，需先解决建层）。");
      return { status: "FAIL", detail: lines.join("\n") };
    }
    if (!same) {
      lines.push("");
      lines.push("⇒ 建层成功但字体**没接上**（或回读路径变了）⇒ 本项**无结论**：");
      lines.push("   既可能是 fontName 没生效，也可能是 characterStyle.font 这条读回路径在本机不同。");
      lines.push("   ⇒ 参数条不能假设「传了就一定生效」，要在真机上肉眼/像素复核一次。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    lines.push("");
    lines.push("⇒ 「显式传 fontName → 回读命中」这条链在本机成立。");
    lines.push("   参数条写中文可以走这个写法，但字体必须是**本机在册**的名字。");
    FONT_PICK = pick;
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/** R5 选中的中文字体（供方案引用）。 */
let FONT_PICK = null;

/* ------------------------------------------------------------------- R6 */

const R6 = {
  id: "R6",
  name: "★ 画布尺寸 + 新增图层，能否像图层增减那样「一步干净回退」",
  note: "★ 这是本步最要紧的一条：C4 只验过「图层 1→2→1」，画布尺寸变化**没验过**",
  async run() {
    const lines = [];
    const W0 = 400, H0 = 300, H1 = 360;

    if (!R2_WINNER) {
      lines.push("R2 没找到可用的扩画布写法 ⇒ 本项**无结论**。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const doc = await makeDoc(plainPreset(W0, H0, 72, "RP-R6-revert"), "R6");
    if (!doc) throw new Error("createDocument 未返回文档");

    const snap = () => {
      const wh = docWH(doc);
      return { w: Math.round(wh.w), h: Math.round(wh.h), layers: countLayersDeep(doc) };
    };

    const s0 = snap();
    lines.push("初始：" + s0.w + " × " + s0.h + "，图层 " + s0.layers);

    /* ── 模态 A：记标记（拿下 activeHistoryState 的对象引用） ──
       ⚠️ 关键点与 history.js 的主路一致：**对象引用要跨越模态边界持有** ——
          在模态 A 里取、跑完一整轮改动、再在模态 C 里赋回去。 */
    let mark = null;
    let markErr = null;
    try {
      await runModal(async () => {
        mark = doc.activeHistoryState || null;
      }, "Review Probe: R6 记标记");
    } catch (e) {
      markErr = errText(e);
    }
    lines.push("");
    lines.push("模态 A · 记标记：" + (mark ? "拿到对象引用" : "**没拿到**（null）") +
      (markErr ? "  报错：" + markErr : ""));

    /* ── 模态 B：扩画布 + 建一个图层（两件事都做，才试得出"组合改动"） ── */
    let mutateErr = null;
    try {
      await runModal(async () => {
        await doResizeCanvas(doc, W0, H1);
      }, "Review Probe: R6 扩画布");
      await addTestLayer("RP-R6-新层");
    } catch (e) {
      mutateErr = errText(e);
    }
    const s1 = snap();
    lines.push("模态 B · 改动后：" + s1.w + " × " + s1.h + "，图层 " + s1.layers +
      (mutateErr ? "  报错：" + mutateErr : ""));

    /* 负对照：改动必须**真的发生了**，否则"撤回成功"毫无意义 */
    const reallyChanged = (s1.h !== s0.h) || (s1.layers !== s0.layers);
    lines.push("  负对照（改动是否真的发生）：" + (reallyChanged ? "✅ 发生了" : "✗ 没变化 ⇒ 后面的结论全部无效"));

    /* ── 模态 C：一步赋回对象引用 ── */
    let revertErr = null;
    if (mark) {
      try {
        await runModal(async () => {
          doc.activeHistoryState = mark;
        }, "Review Probe: R6 一步还原");
      } catch (e) {
        revertErr = errText(e);
      }
    }
    const s2 = snap();
    lines.push("模态 C · 一步还原后：" + s2.w + " × " + s2.h + "，图层 " + s2.layers +
      (revertErr ? "  报错：" + revertErr : ""));

    const wBack = s2.w === s0.w;
    const hBack = s2.h === s0.h;
    const lBack = s2.layers === s0.layers;
    const allBack = wBack && hBack && lBack;

    lines.push("");
    lines.push("── 三项分别回没回到原位 ──");
    lines.push("  画布宽：" + s0.w + " → " + s2.w + "　" + (wBack ? "✅ 回来了" : "✗ 没回来"));
    lines.push("  画布高：" + s0.h + " → " + s2.h + "　" + (hBack ? "✅ 回来了" : "✗ 没回来"));
    lines.push("  图层数：" + s0.layers + " → " + s2.layers + "　" + (lBack ? "✅ 回来了" : "✗ 没回来"));

    lines.push("");
    lines.push("⚠️ 判据说明（如实交代）：图层数相等是**必要不充分**的 ——");
    lines.push("   它挡得住「静默无变化」这个最危险的失败模式，但挡不住「删一个又加一个」。");
    lines.push("   要更强只能比对像素或历史步数，本轮不做过度声称。");

    if (!mark) {
      lines.push("");
      lines.push("⇒ 标记本身没拿到 ⇒ 本项**无结论**。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    if (!reallyChanged) {
      lines.push("");
      lines.push("⇒ 改动没真的发生 ⇒ 本项**无结论**（测试本身没成立，不许记成 PASS）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    lines.push("");
    lines.push(allBack
      ? "⇒ ★ 成立：「扩画布 + 新增图层」这类组合改动，可以用**同一个对象引用**一步回到原位。"
      : "⇒ ★ 不成立：至少有一项没回来 ⇒ 「导出审核版」的「扩画布→导出→还原」链路有风险，" +
        "必须换策略（如先复制文档再改副本），不得直接对用户的稿动手。");

    return { status: allBack ? "PASS" : "FAIL", detail: lines.join("\n") };
  }
};

/* ================================================================= 第二轮 */
/*
 * 第一轮（R1–R6）跑完后暴露了四个必须补测的点：
 *   ① R2 只验了"尺寸变了"，**没验新空间落在哪一侧** —— 而默认锚点是"居中"（上下各半），
 *      这对"下方参数条"是**致命**的。必须显式指定锚点，且要证明锚点真的生效。
 *   ② R3 的 A 变体（saveAs.png(entry)）导出后**把文档改了名**（收尾日志里出现
 *      "review-probe-r3-A.png 已关闭"，那不是文件，是**被改名的文档**）。
 *      ⇒ 若审核版直接这么导，用户的稿会被"劫持"成 PNG 的名字。必须验 asCopy。
 *   ③ R5 证明"建层那一发里带 fontName"**不生效**（传 MicrosoftYaHei 回读 AdobeHeiti）。
 *      要试"建完再用 set textStyle 打一次"这条路。
 *   ④ 白底机制已由外部像素读数确认：**resizeCanvas 的新区域用背景色填充**
 *      ⇒ "设背景色为白 + 扩画布"就是白底条。要在模态内走通并留样张。
 */

/** 铺满整层用「指定颜色」填充（描述符来自官方文档原样，**不动用户的前景色**）。 */
function fillWholeLayerDesc(rgb) {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: "color" },
    color: { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
    _options: { dialogOptions: "dontDisplay" }
  };
}

/** 「设文字样式」（工具箱 v0.2.4 已实测的描述符形状，非猜测）。 */
function textStyleSetDesc(style) {
  const to = { _obj: "textStyle" };
  if (style && style.fontName) to.fontName = String(style.fontName);
  if (style && style.sizePt) to.size = { _unit: "pointsUnit", _value: Number(style.sizePt) };
  if (style && style.color) {
    to.color = {
      _obj: "RGBColor",
      red: style.color.r, grain: style.color.g, blue: style.color.b
    };
  }
  return {
    _obj: "set",
    _target: [
      { _ref: "property", _property: "textStyle" },
      { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }
    ],
    to: to,
    _options: { dialogOptions: "dontDisplay" }
  };
}

/** 建「框文本」文字层（描述符来自 Adobe 官方样例 layer-creation-js-sample）。 */
function boxTextDesc(opts) {
  const text = String(opts.text || "");
  const px = (v) => ({ _unit: "pixelsUnit", _value: Number(v) || 0 });
  const style = { _obj: "textStyle" };
  if (opts.fontName) style.fontName = String(opts.fontName);
  /* ⚠️ 官方样例里 fontName 与 fontStyleName 是**成对**出现的；
     只给 fontName 时 PS 是否回退到默认字体，由 R13 用像素比对来判（不靠读回值）。 */
  if (opts.fontStyleName) style.fontStyleName = String(opts.fontStyleName);
  style.size = { _unit: "pointsUnit", _value: Number(opts.sizePt) || 12 };
  const rgb = opts.rgb || { r: 0, g: 0, b: 0 };
  style.color = { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b };
  const b = opts.box || { left: 0, top: 0, right: 200, bottom: 100 };
  /* 段落对齐：字段名 `align` 与枚举族 `alignmentType` 都是**读回 textKey 拿到的**（非猜测），
     见工具箱 v0.3.9 自检 S37「三档都能设且读回」。 */
  const paragraphStyleRange = opts.align && opts.align.value ? [
    {
      _obj: "paragraphStyleRange",
      from: 0, to: text.length,
      paragraphStyle: {
        _obj: "paragraphStyle",
        align: { _enum: opts.align.cls || "alignmentType", _value: String(opts.align.value) }
      }
    }
  ] : null;
  const using = {
    _obj: "textLayer",
    textKey: text,
    textShape: [
      {
        _obj: "textShape",
        char: { _enum: "char", _value: "box" },
        bounds: {
          _obj: "rectangle",
          top: px(b.top), left: px(b.left), bottom: px(b.bottom), right: px(b.right)
        }
      }
    ],
    textStyleRange: [
      { _obj: "textStyleRange", from: 0, to: text.length, textStyle: style }
    ],
    name: opts.name || "RP-文字层"
  };
  if (paragraphStyleRange) using.paragraphStyleRange = paragraphStyleRange;

  return {
    _obj: "make",
    _target: [{ _ref: "textLayer" }],
    using: using,
    _options: { dialogOptions: "dontDisplay" }
  };
}

/** 读活动文字层的字体（走 DOM 的 textItem.characterStyle.font，探针 C6 实测路径）。 */
function readActiveFont(doc) {
  return safe(() => {
    const top = doc.layers;
    for (let i = 0; i < top.length; i++) {
      const L = top[i];
      if (L.kind === "text" && L.textItem && L.textItem.characterStyle) {
        return L.textItem.characterStyle.font;
      }
    }
    return null;
  });
}

/* ------------------------------------------------------------------- R7 */

const R7 = {
  id: "R7",
  name: "★ 锚点矩阵：扩画布后新空间落在哪一侧（用像素判，不靠肉眼）",
  note: "★ 默认锚点是「居中」⇒ 想要的下方参数条**必须**显式传锚点，本项就验这件事",
  async run() {
    const lines = [];
    if (!R2_WINNER) {
      lines.push("R2 没有可用写法 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    if (!R3_WINNER) {
      lines.push("R3 没有可用导出写法 ⇒ 导不出物证，无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const W0 = 400, H0 = 300, H1 = 360;
    /* 内容铺成青色、新区域是背景色（红）—— 两侧颜色不同，像素一读就知道边界在哪。
       ⚠️ 用「指定颜色的 fill」而不是"设前景色再填"，这样**不碰用户的前景色**。 */
    const CONTENT_RGB = { r: 0, g: 170, b: 200 };

    const ANCHORS = [
      { id: "A0", arg: undefined, desc: "不带锚点（对照）" },
      { id: "A1", arg: "topCenter", desc: '锚点 "topCenter"' },
      { id: "A2", arg: "bottomCenter", desc: '锚点 "bottomCenter"' },
      { id: "A3", arg: "top", desc: '锚点 "top"' },
      { id: "A4", arg: "TC", desc: '锚点 "TC"' }
    ];

    const summary = [];

    for (let i = 0; i < ANCHORS.length; i++) {
      const a = ANCHORS[i];
      lines.push("── " + a.id + "：" + a.desc + " ──");
      const doc = await makeDoc(plainPreset(W0, H0, 72, "RP-R7-" + a.id), "R7-" + a.id);
      if (!doc) { lines.push("  建文档失败"); lines.push(""); continue; }

      let err = null;
      try {
        /* ① 内容铺色（进模态） */
        await runModal(async () => {
          await batchPlay([fillWholeLayerDesc(CONTENT_RGB)], {});
        }, "Review Probe: R7 铺底色 " + a.id);

        /* ② 扩画布（带/不带锚点） */
        await runModal(async () => {
          if (a.arg === undefined) await doc.resizeCanvas(W0, H1);
          else await doc.resizeCanvas(W0, H1, a.arg);
        }, "Review Probe: R7 扩画布 " + a.id);
      } catch (e) {
        err = errText(e);
      }

      const after = docWH(doc);
      lines.push("  扩画布报错：" + (err || "（无）"));
      lines.push("  尺寸：" + Math.round(after.w) + " × " + Math.round(after.h));

      let art = null;
      if (!err) {
        try {
          art = await exportPng(doc, "review-probe-r7-" + a.id);
          lines.push("  物证：" + art.name + "（" + (art.bytes === null ? "字节读不到" : art.bytes + " 字节") + "）");
        } catch (e) {
          lines.push("  导出失败：" + errText(e));
        }
      }
      lines.push("  待判：新空间（背景色红）落在顶部 / 底部 / 上下各半？—— 外部读像素。");
      lines.push("");

      summary.push({ id: a.id, desc: a.desc, error: err, ok: !err && !!art, artifact: art ? art.name : null });
    }

    lines.push("── 汇总 ──");
    for (let i = 0; i < summary.length; i++) {
      const s = summary[i];
      lines.push("  " + s.id + " " + (s.ok ? "✔ 已产出物证" : "✗ 未产出") +
        "  " + s.desc + (s.error ? "  报错：" + s.error : ""));
    }

    const anyOk = summary.some((s) => s.ok);
    lines.push("");
    lines.push(anyOk
      ? "⇒ 物证已产出（" + summary.filter((s) => s.ok).length + " 张）。**落点结论由外部像素读数给出**（见 README）。"
      : "⇒ 一张物证都没产出 ⇒ 无结论。");
    return { status: anyOk ? "PASS" : "INCONCLUSIVE", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------- R8 */

const R8 = {
  id: "R8",
  name: "★ 导出会不会「劫持」文档（saveAs 之后文档被改名）",
  note: "★ 第一轮 R3-A 已露出苗头：导出后文档名变成了 PNG 文件名。若是这样，审核版会把用户的稿改名 —— 必须先解决",
  async run() {
    const lines = [];
    const havePng = CENSUS ? CENSUS.saveAsPng : null;
    if (havePng === "undefined") {
      lines.push("saveAs.png 不存在 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const folder = await lfs.getDataFolder();

    const VARIANTS = [
      { id: "B1", desc: "saveAs.png(entry, {}, true)  —— 第 3 参 asCopy", call: (d, e) => d.saveAs.png(e, {}, true) },
      { id: "B2", desc: "saveAs.png(entry)  —— 对照（第一轮 R3-A 用的就是这个）", call: (d, e) => d.saveAs.png(e) }
    ];

    const rows = [];

    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      lines.push("── " + v.id + "：" + v.desc + " ──");
      const doc = await makeDoc(plainPreset(300, 200, 72, "RP-R8-" + v.id), "R8-" + v.id);
      if (!doc) { lines.push("  建文档失败"); lines.push(""); continue; }

      const before = {
        name: safe(() => doc.name).value,
        path: safe(() => doc.path).value,
        saved: safe(() => doc.saved).value
      };
      lines.push("  导出前：name=" + brief(before.name) + "  path=" + brief(before.path) + "  saved=" + brief(before.saved));

      const f = await folder.createFile("review-probe-r8-" + v.id + ".png", { overwrite: true });
      let err = null;
      try {
        await runModal(async () => {
          await v.call(doc, f);
        }, "Review Probe: R8 导出 " + v.id);
      } catch (e) {
        err = errText(e);
      }

      const after = {
        name: safe(() => doc.name).value,
        path: safe(() => doc.path).value,
        saved: safe(() => doc.saved).value
      };
      lines.push("  报错：" + (err || "（无）"));
      lines.push("  导出后：name=" + brief(after.name) + "  path=" + brief(after.path) + "  saved=" + brief(after.saved));

      const renamed = String(after.name) !== String(before.name);
      const pathChanged = String(after.path) !== String(before.path);
      lines.push("  文档被改名：" + (renamed ? "🔴 是（" + brief(before.name) + " → " + brief(after.name) + "）" : "✅ 否"));
      lines.push("  文档路径被改：" + (pathChanged ? "🔴 是" : "✅ 否"));
      lines.push("");

      rows.push({ id: v.id, desc: v.desc, err: err, renamed: renamed, pathChanged: pathChanged });
    }

    lines.push("── 汇总 ──");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      lines.push("  " + r.id + "  改名=" + (r.renamed ? "是" : "否") +
        "  路径变=" + (r.pathChanged ? "是" : "否") + (r.err ? "  报错：" + r.err : ""));
    }

    const asCopyRow = rows.filter((r) => r.id === "B1")[0];
    const plainRow = rows.filter((r) => r.id === "B2")[0];

    lines.push("");
    if (asCopyRow && !asCopyRow.err && !asCopyRow.renamed) {
      lines.push("⇒ ★ 结论：**用 asCopy（第 3 参 true）导出，文档名/路径不变** —— 审核版必须走这条。");
      return { status: "PASS", detail: lines.join("\n") };
    }
    if (plainRow && plainRow.renamed) {
      lines.push("⇒ ★ 确认了风险：**不带 asCopy 导出会改掉文档名**。");
      lines.push("   ⇒ 「导出审核版」绝不能这么导，否则用户交付时文件名已被插件改掉（而且历史回退救不回来）。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("⇒ 没能得出明确结论 ⇒ INCONCLUSIVE（不猜）。");
    return { status: "INCONCLUSIVE", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------- R9 */

const R9 = {
  id: "R9",
  name: "中文字体：建完之后用 set textStyle 再打一次，能否真生效",
  note: "★ R5 已证「建层那一发里带 fontName」不生效；本项试工具箱已验证过的 set 形状",
  async run() {
    const lines = [];
    const FONT = "MicrosoftYaHei";

    const doc = await makeDoc(plainPreset(400, 200, 72, "RP-R9-fontset"), "R9");
    if (!doc) throw new Error("createDocument 未返回文档");

    /* ① 建层时**故意不带** fontName —— 复用 R5 的结论，不重复验它 */
    let mkErr = null;
    try {
      await runModal(async () => {
        await batchPlay([boxTextDesc({
          text: "字体测试 ABC 0123",
          sizePt: 14,
          rgb: { r: 0, g: 0, b: 0 },
          box: { left: 20, top: 30, right: 380, bottom: 100 },
          name: "RP-R9-字体"
        })], {});
      }, "Review Probe: R9 建文字层");
    } catch (e) {
      mkErr = errText(e);
    }
    lines.push("建层（不带 fontName）报错：" + (mkErr || "（无）"));

    const f0 = readActiveFont(doc);
    lines.push("建完回读字体：" + (f0.ok ? brief(f0.value) : "读取失败：" + f0.error) + "　（预期是 PS 的默认中文字体）");

    /* ② 建完之后，用 set textStyle 打一次 fontName */
    let setErr = null;
    try {
      await runModal(async () => {
        await batchPlay([textStyleSetDesc({ fontName: FONT })], {});
      }, "Review Probe: R9 set textStyle");
    } catch (e) {
      setErr = errText(e);
    }
    lines.push("set textStyle{fontName=" + FONT + "} 报错：" + (setErr || "（无）"));

    const f1 = readActiveFont(doc);
    lines.push("set 之后回读字体：" + (f1.ok ? brief(f1.value) : "读取失败：" + f1.error));

    const hit = f1.ok && f1.value && String(f1.value).toLowerCase().replace(/[\s\-_]/g, "") === FONT.toLowerCase();
    lines.push("是否命中传入的字体：" + (hit ? "✅ 命中" : "✗ 未命中"));

    if (mkErr) {
      lines.push("");
      lines.push("⇒ 建层就报错 ⇒ 本项 FAIL（先解决建层）。");
      return { status: "FAIL", detail: lines.join("\n") };
    }

    lines.push("");
    if (hit) {
      lines.push("⇒ ★ 成立：**中文字体走「建完再 set textStyle」这条路能生效**。");
      lines.push("   参数条的写法定为：建框文本层 → 立刻 set textStyle{fontName} → 回读自证。");
      return { status: "PASS", detail: lines.join("\n") };
    }
    lines.push("⇒ set 之后仍没命中 ⇒ INCONCLUSIVE：");
    lines.push("   既可能是 set 这条路也不吃 fontName，也可能是读回路径在本机不反映实际渲染。");
    lines.push("   ⇒ **参数条不能假设字体可控**；退路是「只用本机默认中文字体」或「把字体随插件带」。");
    return { status: "INCONCLUSIVE", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R10 */

const R10 = {
  id: "R10",
  name: "★ 综合样张：把「扩画布 + 白条 + 中文参数文字 + 导出」连成一条链",
  note: "★ 本项的产物就是给你验收用的那张图 —— 图片区 + 白参数条 + 中文参数",
  async run() {
    const lines = [];
    const W0 = 400, H0 = 300, H1 = 360;

    if (!R2_WINNER || !R3_WINNER) {
      lines.push("R2/R3 的前置没成立 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    const doc = await makeDoc(plainPreset(W0, H0, 72, "RP-R10-sample"), "R10");
    if (!doc) throw new Error("createDocument 未返回文档");

    /* ① 图片区铺一个"内容色"，好让白条一眼可辨 */
    const CONTENT = { r: 0, g: 170, b: 200 };
    await runModal(async () => {
      await batchPlay([fillWholeLayerDesc(CONTENT)], {});
    }, "Review Probe: R10 铺图片区底色");

    /* ② 背景色设为纯白 —— 扩出来的新区域就是白的（第一轮像素读数已证这个机制） */
    const bgBefore = await readColorSlot("background");
    const setBg = await writeColorSlot("background", { r: 255, g: 255, b: 255 });
    const bgChk = await readColorSlot("background");
    lines.push("设背景色=纯白：" + (setBg.ok ? "已执行" : "失败：" + setBg.error));
    lines.push("回读背景色：" + (bgChk.ok ? "RGB(" + bgChk.rgb.r + "," + bgChk.rgb.g + "," + bgChk.rgb.b + ")" : "读取失败") +
      "　（设之前是 " + (bgBefore.ok ? "RGB(" + bgBefore.rgb.r + "," + bgBefore.rgb.g + "," + bgBefore.rgb.b + ")" : "读不到") + "）");

    /* ③ 向下扩画布：显式传锚点，期望新空间落在**底部** */
    let rzErr = null;
    try {
      await runModal(async () => {
        await doc.resizeCanvas(W0, H1, "topCenter");
      }, "Review Probe: R10 扩画布");
    } catch (e) {
      rzErr = errText(e);
    }
    const wh = docWH(doc);
    lines.push("扩画布：" + W0 + " × " + H0 + " → " + Math.round(wh.w) + " × " + Math.round(wh.h) +
      (rzErr ? "  报错：" + rzErr : ""));

    /* ④ 在条区域内写中文参数文字（建层 + set textStyle 双保险） */
    const FONT = FONT_PICK || "MicrosoftYaHei";
    const TEXT = "审核用·非成品　CMYK · 300dpi · 210×297mm · 出血 3mm · 未转曲 3";
    let tErr = null;
    try {
      await runModal(async () => {
        await batchPlay([boxTextDesc({
          text: TEXT,
          fontName: FONT,
          sizePt: 8,
          rgb: { r: 0, g: 0, b: 0 },
          box: { left: 12, top: 310, right: 388, bottom: 352 },
          name: "RP-R10-参数条"
        })], {});
      }, "Review Probe: R10 建参数文字层");

      await runModal(async () => {
        await batchPlay([textStyleSetDesc({ fontName: FONT, sizePt: 8, color: { r: 0, g: 0, b: 0 } })], {});
      }, "Review Probe: R10 设参数文字字体");
    } catch (e) {
      tErr = errText(e);
    }
    const fnt = readActiveFont(doc);
    lines.push("参数文字层报错：" + (tErr || "（无）") + "　回读字体：" + (fnt.ok ? brief(fnt.value) : "读取失败"));
    lines.push("图层清单：" + brief(layerNames(doc)));

    /* ⑤ 导出样张 */
    let art = null;
    try {
      art = await exportPng(doc, "review-probe-r10-review-sample");
      lines.push("样张：" + art.path);
    } catch (e) {
      lines.push("导出样张失败：" + errText(e));
    }

    /* ⑥ 还原背景色（不留痕） */
    if (bgBefore.ok) {
      const back = await writeColorSlot("background", bgBefore.rgb);
      const chk = await readColorSlot("background");
      lines.push("还原背景色：" + (back.ok ? "已执行" : "失败：" + back.error) +
        "　回读 " + (chk.ok ? "RGB(" + chk.rgb.r + "," + chk.rgb.g + "," + chk.rgb.b + ")" : "读取失败"));
    } else {
      lines.push("⚠️ 事先没读到背景色 ⇒ 无法还原，背景色现在停在纯白 —— 如实交代。");
    }

    lines.push("");
    lines.push("── 待外部像素判定的三件事 ──");
    lines.push("  ① 新增的 60px 条是不是**纯白**、且在**底部**？");
    lines.push("  ② 图片区（青色）有没有被改动？");
    lines.push("  ③ 条上有没有黑色文字像素（参数文字真的画上去了）？");

    if (!art) {
      lines.push("");
      lines.push("⇒ 样张没产出 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 样张已产出：" + art.name + "。状态 PASS 只表示「链路跑通 + 物证落地」，");
    lines.push("   视觉结论以外部像素读数与你看图为准。");
    SAMPLE = art;
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/** R10 的样张（写进报告，供外部与用户取用）。 */
let SAMPLE = null;

/* ================================================================= 第三轮 */
/*
 * R7 的像素读数把原设计推翻了：
 *   **`resizeCanvas(w, h, anchor)` 的第 3 个参数被静默忽略** —— 传 topCenter /
 *   bottomCenter / top / TC 或什么都不传，新空间**一律上下各半**（30 / 300 / 30）。
 *   ⇒ docs/49 §3.2 里那句「resizeCanvas(宽, 高+条高, 向下锚点)」**不成立**，
 *     而"上下各半"对"下方参数条"是致命缺陷（会在图上方也糊一条白带）。
 *
 * 所以第三轮要回答两件事：
 *   ① 有没有**真枚举**能让锚点生效（photoshop.constants 里可能就藏着 AnchorPosition）；
 *   ② 若没有，就走**替代路线**：不去动用户的稿 —— 新建一张「图片 + 条」尺寸的空稿，
 *      把原稿的图层**跨文档复制**进来（C5 已验过这条路），靠"复制后按原坐标落位"
 *      天然把内容留在上方、把条留在下方。
 */

/* ------------------------------------------------------------------ R11 */

const R11 = {
  id: "R11",
  name: "photoshop.constants 普查 + 用真枚举再试锚点",
  note: "★ DOM 的锚点字符串被忽略 ⇒ 试「宿主常量枚举」这条路是否可行",
  async run() {
    const lines = [];
    const constants = photoshop.constants || null;
    if (!constants) {
      lines.push("photoshop.constants 不存在 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    let keys = [];
    const kr = safe(() => Object.keys(constants));
    if (!kr.ok) {
      lines.push("读 constants 的键失败：" + kr.error);
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    keys = kr.value;
    lines.push("photoshop.constants 的键（" + keys.length + " 个）：");
    lines.push("  " + brief(keys, 1500));

    const ap = safe(() => constants.AnchorPosition);
    lines.push("");
    lines.push("constants.AnchorPosition 形态：" + (ap.ok ? describeNative(ap.value) : "读取失败：" + ap.error));

    let members = [];
    if (ap.ok && ap.value) {
      const mk = safe(() => Object.keys(ap.value));
      if (mk.ok) members = mk.value;
      lines.push("AnchorPosition 成员（" + members.length + "）：" + brief(members, 600));
      /* 也把每个成员的值打出来 —— 值才是要传给 resizeCanvas 的东西 */
      for (let i = 0; i < members.length && i < 12; i++) {
        const v = safe(() => ap.value[members[i]]);
        lines.push("    " + members[i] + " = " + (v.ok ? brief(v.value, 80) : "读取失败"));
      }
    }

    if (!members.length) {
      lines.push("");
      lines.push("⇒ constants 里没有 AnchorPosition（或读不到成员）⇒ 锚点这条路走不通。");
      lines.push("   退路：走 R12 的「新建高稿 + 跨文档复制」，或录 batchPlay 的 resizeCanvas 描述符。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    /* 逐个成员试：建稿 → 铺青 → 带该锚点扩画布 → 导出（落点交给外部像素判） */
    const W0 = 400, H0 = 300, H1 = 360;
    const CONTENT_RGB = { r: 0, g: 170, b: 200 };
    const summary = [];

    for (let i = 0; i < members.length && i < 12; i++) {
      const nm = members[i];
      const val = safe(() => ap.value[nm]);
      if (!val.ok) { summary.push({ nm: nm, ok: false, err: "取不到值" }); continue; }

      const doc = await makeDoc(plainPreset(W0, H0, 72, "RP-R11-" + nm), "R11-" + nm);
      if (!doc) { summary.push({ nm: nm, ok: false, err: "建稿失败" }); continue; }

      let err = null;
      try {
        await runModal(async () => {
          await batchPlay([fillWholeLayerDesc(CONTENT_RGB)], {});
        }, "Review Probe: R11 铺底 " + nm);
        await runModal(async () => {
          await doc.resizeCanvas(W0, H1, val.value);
        }, "Review Probe: R11 锚点 " + nm);
      } catch (e) {
        err = errText(e);
      }

      let art = null;
      if (!err) {
        try { art = await exportPng(doc, "review-probe-r11-" + nm); } catch (e) { err = errText(e); }
      }
      summary.push({ nm: nm, ok: !err && !!art, err: err, artifact: art ? art.name : null });
      lines.push("");
      lines.push("  " + nm + " = " + brief(val.value, 60) + " ⇒ " +
        (err ? "报错：" + err : "已产出物证 " + art.name));
    }

    lines.push("");
    lines.push("── 汇总 ──");
    for (let i = 0; i < summary.length; i++) {
      const s = summary[i];
      lines.push("  " + s.nm + " " + (s.ok ? "✔" : "✗") + (s.err ? "  " + s.err : ""));
    }
    const anyOk = summary.some((s) => s.ok);
    lines.push("");
    lines.push(anyOk
      ? "⇒ 物证已产出。**锚点到底生效没有，由外部像素比对各张图的落点**（若各张布局仍相同 ⇒ 枚举也被忽略）。"
      : "⇒ 一张都没产出 ⇒ 无结论。");
    return { status: anyOk ? "PASS" : "INCONCLUSIVE", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R12 */

const R12 = {
  id: "R12",
  name: "★ 替代路线：新建高稿 + 跨文档复制图层（完全不动用户的稿）",
  note: "★ 若这条成立，「导出审核版」就根本不需要改用户的文档 —— 比「先改再还原」更安全",
  async run() {
    const lines = [];
    const W0 = 400, H0 = 300, H1 = 360;
    const CONTENT_RGB = { r: 0, g: 170, b: 200 };

    /* ① 源稿：模拟"用户的稿" —— 400×300，铺青 */
    const src = await makeDoc(plainPreset(W0, H0, 72, "RP-R12-src"), "R12-src");
    if (!src) throw new Error("源稿未创建");
    try {
      await runModal(async () => {
        await batchPlay([fillWholeLayerDesc(CONTENT_RGB)], {});
      }, "Review Probe: R12 源稿铺底");
    } catch (e) {
      lines.push("源稿铺底失败：" + errText(e));
    }
    lines.push("源稿图层：" + brief(layerNames(src)));

    /* ② 目标稿：图片 + 条 的尺寸（400×360），纯白底 */
    const dst = await makeDoc(plainPreset(W0, H1, 72, "RP-R12-dst"), "R12-dst");
    if (!dst) throw new Error("目标稿未创建");
    lines.push("目标稿图层（复制前）：" + brief(layerNames(dst)));

    /* ③ 跨文档复制（C5 验过的写法：源文档.duplicateLayers([图层...], 目标文档)） */
    const arr = [];
    const cnt = safe(() => src.layers.length);
    const n = cnt.ok ? cnt.value : 0;
    for (let i = 0; i < n; i++) {
      const L = safe(() => src.layers[i]);
      if (L.ok && L.value) arr.push(L.value);
    }
    lines.push("准备复制 " + arr.length + " 个图层");

    let dupErr = null;
    let returned = null;
    try {
      await runModal(async () => {
        returned = await src.duplicateLayers(arr, dst);
      }, "Review Probe: R12 跨文档复制图层");
    } catch (e) {
      dupErr = errText(e);
    }
    lines.push("复制报错：" + (dupErr || "（无）"));
    lines.push("复制返回值：" + brief(returned, 200));
    lines.push("目标稿图层（复制后）：" + brief(layerNames(dst)));

    /* ④ 导出目标稿 —— 落点交给外部像素判 */
    let art = null;
    if (!dupErr) {
      try { art = await exportPng(dst, "review-probe-r12-alt-route"); } catch (e) { lines.push("导出失败：" + errText(e)); }
    }

    lines.push("");
    lines.push("── 待外部像素判定 ──");
    lines.push("  ① 青色内容落在 y 0.." + (H0 - 1) + "（左上对齐）还是被居中？");
    lines.push("  ② 下方有没有一条纯白的 " + (H1 - H0) + "px 条？（若有 ⇒ 这条路成立）");
    lines.push("  ③ 源稿有没有被动过？（源稿仍在文档列表里，且内容不变）");

    if (!art) {
      lines.push("");
      lines.push("⇒ 物证没产出 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 物证已产出：" + art.name + "。落点结论以外部像素读数为准。");
    return { status: dupErr ? "FAIL" : "PASS", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R13 */

const R13 = {
  id: "R13",
  name: "★ 字体到底有没有生效 —— 用像素比对判，不看读回值",
  note: "★ R5/R9 都读回 AdobeHeiti（默认），但那可能是**读回不准**而不是**字体没生效** —— 只有像素能分",
  async run() {
    const lines = [];
    const TEXT = "永和九年岁在癸丑";
    const SIZEPT = 28;

    const FONTS = [
      { id: "F0", label: "不传 fontName（对照）", fontName: null, fontStyleName: null },
      { id: "F1", label: 'fontName="SimSun"（宋体，衬线）', fontName: "SimSun" },
      { id: "F2", label: 'fontName="MicrosoftYaHei"（黑体，无衬线）', fontName: "MicrosoftYaHei" },
      { id: "F3", label: 'fontName="MicrosoftYaHei" + fontStyleName="Regular"', fontName: "MicrosoftYaHei", fontStyleName: "Regular" }
    ];

    const rows = [];

    for (let i = 0; i < FONTS.length; i++) {
      const f = FONTS[i];
      const doc = await makeDoc(plainPreset(400, 160, 72, "RP-R13-" + f.id), "R13-" + f.id);
      if (!doc) { rows.push({ id: f.id, err: "建稿失败" }); continue; }

      let err = null;
      try {
        await runModal(async () => {
          await batchPlay([boxTextDesc({
            text: TEXT,
            fontName: f.fontName,
            fontStyleName: f.fontStyleName,
            sizePt: SIZEPT,
            rgb: { r: 0, g: 0, b: 0 },
            box: { left: 10, top: 20, right: 390, bottom: 140 },
            name: "RP-R13-" + f.id
          })], {});
        }, "Review Probe: R13 建层 " + f.id);
      } catch (e) {
        err = errText(e);
      }

      const back = readActiveFont(doc);
      let art = null;
      if (!err) {
        try { art = await exportPng(doc, "review-probe-r13-" + f.id); } catch (e) { err = errText(e); }
      }

      lines.push("── " + f.id + "：" + f.label + " ──");
      lines.push("  建层报错：" + (err || "（无）"));
      lines.push("  读回 characterStyle.font = " + (back.ok ? brief(back.value) : "读取失败：" + back.error));
      lines.push("  物证：" + (art ? art.name : "（无）"));
      lines.push("");

      rows.push({
        id: f.id, label: f.label, err: err,
        readback: back.ok ? String(back.value) : null,
        artifact: art ? art.name : null
      });
    }

    const withArt = rows.filter((r) => r.artifact);
    lines.push("── 汇总 ──");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      lines.push("  " + r.id + "  读回=" + brief(r.readback) + "  物证=" + (r.artifact || "无") +
        (r.err ? "  报错：" + r.err : ""));
    }

    lines.push("");
    lines.push("── 这一项真正的判据（必须外部做）──");
    lines.push("  逐张比 F1 / F2 / F3 的**文字区域像素哈希**：");
    lines.push("   · 三张互不相同 ⇒ 字体**真的生效了**，只是读回值不准；");
    lines.push("   · 三张（或 F1/F2/F3 与 F0）完全相同 ⇒ 字体**没生效**，全都回退到同一个默认字体。");

    if (!withArt.length) {
      lines.push("");
      lines.push("⇒ 一张物证都没产出 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 物证已产出 " + withArt.length + " 张。**结论由外部像素比对给出**（见 README），本项不自判。");
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R14 */
/*
 * R13 用像素证明了：**「建层时带 fontName」不生效**（4 张图逐像素相同）。
 * R9 也证明了 **`set textStyle{fontName}`（property 形状）不生效**。
 *
 * 还剩最后一条路 —— 工具箱里**已经打通**的那条（自检 S45 用它设对了对齐）：
 *   ① `get` 读回 PS 自己吐出来的 `textKey` 描述符；
 *   ② 在**它上面**改 `textStyleRange[].textStyle.fontName` 一个字段；
 *   ③ 用 `set _target:[{_ref:"textLayer"}]` 把**整份**描述符写回。
 * 这条路的价值在于：字段名/枚举族名**全是 PS 自己给的**，不是我编的
 * （本项目铁律：ActionDescriptor 不许猜，要照抄录制）。
 */

/** 复制自工具箱 lib/ps.js 的 readTextKeyDesc()（已实测可用的 get 形状）。 */
function readTextKeyLocal() {
  return [
    {
      _obj: "get",
      _target: [
        { _property: "textKey" },
        { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }
  ];
}

/** 复制自工具箱 lib/ps.js 的 textLayerSetDesc()（已实测可用的写回形状）。 */
function textLayerWriteBackDesc(tkDesc) {
  return {
    _obj: "set",
    _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: tkDesc,
    _options: { dialogOptions: "dontDisplay" }
  };
}

/** 从读回的 textKey 描述符里找 textStyleRange[0].textStyle，返回 { holder, style }。 */
function pickTextStyle(tk) {
  if (!tk) return null;
  const root = tk.textKey ? tk.textKey : tk;
  const ranges = root.textStyleRange;
  if (!ranges || !ranges.length) return null;
  const r0 = ranges[0];
  if (!r0 || !r0.textStyle) return null;
  return { root: root, range: r0, style: r0.textStyle };
}

const R14 = {
  id: "R14",
  name: "★ 字体最后一试：读回 textKey → 改 fontName → 整份写回（照抄录制，不编键名）",
  note: "★ 前两条路（建层带 fontName / set textStyle{fontName}）已被像素证明无效；这条是工具箱已验证过的写回形状",
  async run() {
    const lines = [];
    const TEXT = "永和九年岁在癸丑";
    const WANT = "SimSun";    // 宋体，字面与默认的 AdobeHeiti（黑体）差别极大，像素一比就分得出

    const doc = await makeDoc(plainPreset(400, 160, 72, "RP-R14-writeback"), "R14");
    if (!doc) throw new Error("createDocument 未返回文档");

    /* ① 建层（**不带** fontName —— 与 R13 的 F0 完全同一套参数，便于跨项比像素） */
    let mkErr = null;
    try {
      await runModal(async () => {
        await batchPlay([boxTextDesc({
          text: TEXT,
          sizePt: 28,
          rgb: { r: 0, g: 0, b: 0 },
          box: { left: 10, top: 20, right: 390, bottom: 140 },
          name: "RP-R14-写回"
        })], {});
      }, "Review Probe: R14 建文字层");
    } catch (e) {
      mkErr = errText(e);
    }
    lines.push("建层报错：" + (mkErr || "（无）"));
    if (mkErr) {
      lines.push("⇒ 建层不成立 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    /* ② 读回 textKey，先看清 PS 自己给的字段 */
    let tk = null;
    let tkErr = null;
    try {
      await runModal(async () => {
        const res = await batchPlay(readTextKeyLocal(), {});
        tk = res && res[0] ? res[0] : null;
      }, "Review Probe: R14 读 textKey");
    } catch (e) {
      tkErr = errText(e);
    }
    lines.push("读 textKey 报错：" + (tkErr || "（无）"));

    const picked = pickTextStyle(tk);
    if (!picked) {
      lines.push("读回的描述符里找不到 textStyleRange[0].textStyle —— 结构可能不同。");
      lines.push("原始描述符（截断）：" + brief(tk, 1200));
      lines.push("");
      lines.push("⇒ 拿不到可改的字段 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    let styleKeys = [];
    const ks = safe(() => Object.keys(picked.style));
    if (ks.ok) styleKeys = ks.value;
    lines.push("textStyle 的字段（PS 自己给的）：" + brief(styleKeys, 600));
    lines.push("当前 fontName = " + brief(picked.style.fontName));
    lines.push("当前 fontStyleName = " + brief(picked.style.fontStyleName));

    /* ③ 只改 fontName 一个字段，整份写回 */
    let mutated = null;
    let mutateErr = null;
    try {
      mutated = JSON.parse(JSON.stringify(tk));
    } catch (e) {
      mutateErr = "描述符无法 JSON 化：" + errText(e);
    }
    if (!mutateErr) {
      const p2 = pickTextStyle(mutated);
      if (!p2) mutateErr = "复制后找不到 textStyle";
      else p2.style.fontName = WANT;
    }

    if (mutateErr) {
      lines.push("");
      lines.push("⇒ 改描述符失败：" + mutateErr + " ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }

    let wbErr = null;
    try {
      await runModal(async () => {
        await batchPlay([textLayerWriteBackDesc(mutated)], {});
      }, "Review Probe: R14 写回 textKey");
    } catch (e) {
      wbErr = errText(e);
    }
    lines.push("");
    lines.push("整份写回报错：" + (wbErr || "（无）"));

    /* ④ 再读一次，看 fontName 有没有真的变成 SimSun */
    let tk2 = null;
    try {
      await runModal(async () => {
        const res = await batchPlay(readTextKeyLocal(), {});
        tk2 = res && res[0] ? res[0] : null;
      }, "Review Probe: R14 复读 textKey");
    } catch (e) { /* 忽略 */ }
    const p3 = pickTextStyle(tk2);
    const got = p3 ? p3.style.fontName : null;
    lines.push("复读 fontName = " + brief(got));
    const readbackHit = got && String(got).toLowerCase() === WANT.toLowerCase();
    lines.push("是否变成 " + WANT + "：" + (readbackHit ? "✅ 是" : "✗ 否"));

    /* ⑤ 导出物证 —— 最终判据仍然是像素（读回值单独不算数） */
    let art = null;
    try { art = await exportPng(doc, "review-probe-r14-writeback"); } catch (e) { lines.push("导出失败：" + errText(e)); }
    lines.push("物证：" + (art ? art.name : "（无）"));

    lines.push("");
    lines.push("── 这一项的判据 ──");
    lines.push("  把本张的字区像素与 R13 的 F0（默认字体）比：");
    lines.push("   · 不一样 ⇒ 字体**真的写进去了**（那条路打通）；");
    lines.push("   · 一样 ⇒ 写回也没用，字体在本机确实不可控。");

    if (!art) {
      lines.push("");
      lines.push("⇒ 物证没产出 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 物证已产出：" + art.name + "。读回值=" + brief(got) + "，**最终以像素比对为准**。");
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R15 */
/*
 * R14 的读回暴露了一个关键细节：`textStyle` 里 **同时**有
 *   `fontPostScriptName`（真正的机器名）与 `fontName`（带空格的显示名，如 "Adobe Heiti Std"）。
 * 我上一轮只改了 `fontName`，**没动 `fontPostScriptName`** —— 大概率就是它没生效的原因。
 *
 * 本项把两种名字都试一遍，并且**先从 app.fonts 里查出目标字体的三个名字再写**
 * （不用我拼的名字）。
 */

/** 在 app.fonts 里找一个字体，返回它的三个名字。 */
function findFontEntry(want) {
  const fonts = safe(() => app.fonts);
  if (!fonts.ok || !fonts.value) return { ok: false, error: "读不到 app.fonts" };
  const n = safe(() => fonts.value.length);
  const len = n.ok ? n.value : 0;
  if (typeof len !== "number") return { ok: false, error: "app.fonts 没有 length" };
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[\s\-_]/g, "");
  const w = norm(want);
  for (let i = 0; i < len; i++) {
    const it = safe(() => fonts.value[i]);
    if (!it.ok || !it.value) continue;
    const ps = safe(() => it.value._postScriptName);
    const nm = safe(() => it.value._name);
    const fm = safe(() => it.value._family);
    if (norm(ps.value) === w || norm(nm.value) === w || norm(fm.value) === w) {
      const st = safe(() => it.value._style);
      return {
        ok: true,
        name: nm.ok ? nm.value : null,
        family: fm.ok ? fm.value : null,
        ps: ps.ok ? ps.value : null,
        style: st.ok ? st.value : null,
        raw: it.value
      };
    }
  }
  return { ok: false, error: "在 app.fonts 里没找到 " + want };
}

const R15 = {
  id: "R15",
  name: "★ 字体终局：fontPostScriptName + fontName 四种组合，逐个写回并留像素物证",
  note: "★ 上一轮漏了 fontPostScriptName；本项把可能的组合一次试完",
  async run() {
    const lines = [];
    const TEXT = "永和九年岁在癸丑";
    const TARGET = "SimSun";

    const fe = findFontEntry(TARGET);
    lines.push("在 app.fonts 里查 " + TARGET + "：" + (fe.ok ? "找到" : "没找到（" + fe.error + "）"));
    if (!fe.ok) {
      lines.push("⇒ 目标字体不在本机 ⇒ 换字体前先解决这个 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("  _name           = " + brief(fe.name));
    lines.push("  _family         = " + brief(fe.family));
    lines.push("  _postScriptName = " + brief(fe.ps));

    /* 四种写回组合（对照组 F0 见 R13，字区哈希 fdbeb2a5c4ef28c4） */
    const VARIANTS = [
      { id: "W1", desc: "只改 fontName", fn: (st) => { st.fontName = String(fe.name); } },
      { id: "W2", desc: "只改 fontPostScriptName", fn: (st) => { st.fontPostScriptName = String(fe.ps); } },
      {
        id: "W3", desc: "fontName(_name) + fontPostScriptName(_ps)",
        fn: (st) => { st.fontName = String(fe.name); st.fontPostScriptName = String(fe.ps); }
      },
      {
        id: "W4", desc: "fontName(_family) + fontPostScriptName(_ps)",
        fn: (st) => { st.fontName = String(fe.family); st.fontPostScriptName = String(fe.ps); }
      }
    ];

    const rows = [];

    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      lines.push("");
      lines.push("── " + v.id + "：" + v.desc + " ──");

      const doc = await makeDoc(plainPreset(400, 160, 72, "RP-R15-" + v.id), "R15-" + v.id);
      if (!doc) { lines.push("  建稿失败"); continue; }

      let err = null;
      try {
        await runModal(async () => {
          await batchPlay([boxTextDesc({
            text: TEXT, sizePt: 28, rgb: { r: 0, g: 0, b: 0 },
            box: { left: 10, top: 20, right: 390, bottom: 140 },
            name: "RP-R15-" + v.id
          })], {});
        }, "Review Probe: R15 建层 " + v.id);

        let tk = null;
        await runModal(async () => {
          const res = await batchPlay(readTextKeyLocal(), {});
          tk = res && res[0] ? res[0] : null;
        }, "Review Probe: R15 读 " + v.id);

        const p = pickTextStyle(tk);
        if (!p) throw new Error("读回的描述符里没有 textStyle");

        const mutated = JSON.parse(JSON.stringify(tk));
        const pm = pickTextStyle(mutated);
        v.fn(pm.style);

        await runModal(async () => {
          await batchPlay([textLayerWriteBackDesc(mutated)], {});
        }, "Review Probe: R15 写回 " + v.id);
      } catch (e) {
        err = errText(e);
      }

      /* 复读 */
      let got = null;
      try {
        let tk2 = null;
        await runModal(async () => {
          const res = await batchPlay(readTextKeyLocal(), {});
          tk2 = res && res[0] ? res[0] : null;
        }, "Review Probe: R15 复读 " + v.id);
        const p3 = pickTextStyle(tk2);
        got = p3 ? p3.style.fontName : null;
      } catch (e) { /* 忽略 */ }

      let art = null;
      try { art = await exportPng(doc, "review-probe-r15-" + v.id); } catch (e) { err = err || errText(e); }

      lines.push("  报错：" + (err || "（无）"));
      lines.push("  复读 fontName = " + brief(got));
      lines.push("  物证：" + (art ? art.name : "（无）"));

      rows.push({ id: v.id, desc: v.desc, err: err, readback: got, artifact: art ? art.name : null });
    }

    lines.push("");
    lines.push("── 汇总 ──");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      lines.push("  " + r.id + "  " + r.desc + "  复读=" + brief(r.readback) +
        "  物证=" + (r.artifact || "无") + (r.err ? "  报错：" + r.err : ""));
    }
    lines.push("");
    lines.push("── 判据（外部像素比对）──");
    lines.push("  与 R13 的 F0（默认字体，字区哈希 fdbeb2a5c4ef28c4）逐张比：");
    lines.push("   · 哪一张的哈希不同 ⇒ 那个组合就是**正确的写回方式**；");
    lines.push("   · 全部与 F0 相同 ⇒ 本机**确实无法通过这条路改字体**，");
    lines.push("     参数条只能用 PS 的默认中文字体（并把这个限制写进方案）。");

    const withArt = rows.filter((r) => r.artifact);
    if (!withArt.length) {
      lines.push("");
      lines.push("⇒ 一张物证都没产出 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 物证已产出 " + withArt.length + " 张。**结论由外部像素比对给出**，本项不自判。");
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R16 */
/*
 * R15 四组全败，但读回里露出一个我一直没动的字段：**`fontStyleName`**。
 * 读回是 "R"（Adobe Heiti Std 的 Regular 简写）。而 `app.fonts` 每项正好有 `_style`
 * （本机 SimSun 的 `_style` 可以拿去比对）。
 * 假设：**只换字体名却不换样式名 ⇒ PS 解析不到 "SimSun + R" 这个组合 ⇒ 回退默认**。
 * 所以这一轮把 fontStyleName 一起换掉 —— 这是最后一个高概率怀疑点。
 */

const R16 = {
  id: "R16",
  name: "★ 字体终局二：连 fontStyleName 一起换（最后一个高概率怀疑点）",
  note: "★ 只换字体名不换样式名 ⇒ PS 可能解析不到而回退；本项把样式名一起替换",
  async run() {
    const lines = [];
    const TEXT = "永和九年岁在癸丑";
    const TARGET = "SimSun";

    const fe = findFontEntry(TARGET);
    if (!fe.ok) {
      lines.push("找不到目标字体：" + fe.error + " ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("目标字体三个名字 + 样式：");
    lines.push("  _name           = " + brief(fe.name));
    lines.push("  _family         = " + brief(fe.family));
    lines.push("  _postScriptName = " + brief(fe.ps));
    lines.push("  _style          = " + brief(fe.style) + "　★ 本项的关键（上一轮没换它）");

    const VARIANTS = [
      {
        id: "X1", desc: "fontName + fontStyleName(_style)",
        fn: (st) => { st.fontName = String(fe.name); st.fontStyleName = String(fe.style); }
      },
      {
        id: "X2", desc: "fontName + fontStyleName + fontPostScriptName",
        fn: (st) => {
          st.fontName = String(fe.name);
          st.fontStyleName = String(fe.style);
          st.fontPostScriptName = String(fe.ps);
        }
      },
      {
        id: "X3", desc: "fontName + fontStyleName(_style) + fontStyleName 用 _name 拼（SimSun Regular）",
        fn: (st) => { st.fontName = String(fe.name); st.fontStyleName = "Regular"; }
      }
    ];

    const rows = [];

    for (let i = 0; i < VARIANTS.length; i++) {
      const v = VARIANTS[i];
      lines.push("");
      lines.push("── " + v.id + "：" + v.desc + " ──");

      const doc = await makeDoc(plainPreset(400, 160, 72, "RP-R16-" + v.id), "R16-" + v.id);
      if (!doc) { lines.push("  建稿失败"); continue; }

      let err = null;
      let gotName = null;
      let gotStyle = null;
      try {
        await runModal(async () => {
          await batchPlay([boxTextDesc({
            text: TEXT, sizePt: 28, rgb: { r: 0, g: 0, b: 0 },
            box: { left: 10, top: 20, right: 390, bottom: 140 },
            name: "RP-R16-" + v.id
          })], {});
        }, "Review Probe: R16 建层 " + v.id);

        let tk = null;
        await runModal(async () => {
          const res = await batchPlay(readTextKeyLocal(), {});
          tk = res && res[0] ? res[0] : null;
        }, "Review Probe: R16 读 " + v.id);

        const mutated = JSON.parse(JSON.stringify(tk));
        const pm = pickTextStyle(mutated);
        if (!pm) throw new Error("读回的描述符里没有 textStyle");
        v.fn(pm.style);

        await runModal(async () => {
          await batchPlay([textLayerWriteBackDesc(mutated)], {});
        }, "Review Probe: R16 写回 " + v.id);

        let tk2 = null;
        await runModal(async () => {
          const res = await batchPlay(readTextKeyLocal(), {});
          tk2 = res && res[0] ? res[0] : null;
        }, "Review Probe: R16 复读 " + v.id);
        const p3 = pickTextStyle(tk2);
        gotName = p3 ? p3.style.fontName : null;
        gotStyle = p3 ? p3.style.fontStyleName : null;
      } catch (e) {
        err = errText(e);
      }

      let art = null;
      try { art = await exportPng(doc, "review-probe-r16-" + v.id); } catch (e) { err = err || errText(e); }

      lines.push("  报错：" + (err || "（无）"));
      lines.push("  复读 fontName = " + brief(gotName) + "　fontStyleName = " + brief(gotStyle));
      lines.push("  物证：" + (art ? art.name : "（无）"));
      rows.push({ id: v.id, desc: v.desc, err: err, name: gotName, style: gotStyle, artifact: art ? art.name : null });
    }

    lines.push("");
    lines.push("── 汇总 ──");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      lines.push("  " + r.id + "  " + r.desc);
      lines.push("      复读 name=" + brief(r.name) + " style=" + brief(r.style) +
        "  物证=" + (r.artifact || "无") + (r.err ? "  报错：" + r.err : ""));
    }
    lines.push("");
    lines.push("── 判据（外部像素）──");
    lines.push("  与基线 fdbeb2a5c4ef28c4（R13-F0，不传字体）比：任一不同 ⇒ 找到正确写法。");
    lines.push("  若仍全部相同 ⇒ 程序化设置字体在本机**确实做不到**，");
    lines.push("  参数条 v1 采用默认中文字体，并把这个限制写进方案（后续靠录制动作打通）。");

    const withArt = rows.filter((r) => r.artifact);
    if (!withArt.length) {
      lines.push("");
      lines.push("⇒ 没产出物证 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 物证已产出 " + withArt.length + " 张，结论由外部像素比对给出。");
    return { status: "PASS", detail: lines.join("\n") };
  }
};

/* ------------------------------------------------------------------ R17 */
/*
 * R17 不是"验能力"，是**出实物**：把「参数条」按不同高度比例渲染成真图，
 * 让用户**看图挑比例**，而不是拍一个数字（docs/50 §六 4 已拍板「先出样张」）。
 *
 * 用的是本轮已验证的写法：
 *   · 图片区铺一个占位色（实际实现里就是用户的稿）
 *   · 背景色临时设白 → resizeCanvas(W, H+条高, AnchorPosition.TOPCENTER)
 *   · 条内写文字（字体只能默认；已如实标注）
 *   · saveAs.png(entry, {}, true) 导出
 *
 * ⚠️ 这里**故意不在参数条里编造数据** —— 文字内容用一份"示例读数"，
 *    真实现必须来自 `docInspect()`（docs/49 §3.0「一个数据源」）。
 */

const SAMPLE_PCTS = [0.04, 0.06, 0.08];

const R17 = {
  id: "R17",
  name: "参数条样张：按图宽的 4% / 6% / 8% 三档出真图，供选比例",
  note: "★ 本项产出是**给人看的样张**，不是能力验证",
  async run() {
    const lines = [];
    const W = 1600, H = 1200;
    const IMAGE_RGB = { r: 92, g: 118, b: 140 };   // 占位色，代表"用户的图"

    for (let i = 0; i < SAMPLE_PCTS.length; i++) {
      const pct = SAMPLE_PCTS[i];
      const stripH = Math.max(48, Math.round(W * pct));
      const tag = Math.round(pct * 100) + "pct";

      lines.push("── " + tag + "：图宽 " + W + " → 条高 " + stripH + "px（"
        + (pct * 100).toFixed(0) + "%）──");

      const doc = await makeDoc(plainPreset(W, H, 72, "RP-R17-" + tag), "R17-" + tag);
      if (!doc) { lines.push("  建稿失败"); continue; }

      const bgBefore = await readColorSlot("background");
      let err = null;
      /* ⚠️ 这三个量要**在 try 之外可见**（下面写读数要用）——
         上一版写成 try 里的 const，直接换来个 `lineH is not defined`。 */
      let pad = 0;
      let lineH = 0;
      let sizePt = 0;
      try {
        /* ① 图片区铺占位色 */
        await runModal(async () => {
          await batchPlay([fillWholeLayerDesc(IMAGE_RGB)], {});
        }, "Review Probe: R17 占位色 " + tag);

        /* ② 背景色设白 → 扩画布（新区域就是白的条） */
        await writeColorSlot("background", { r: 255, g: 255, b: 255 });
        await runModal(async () => {
          await doc.resizeCanvas(W, H + stripH, photoshop.constants.AnchorPosition.TOPCENTER);
        }, "Review Probe: R17 扩画布 " + tag);

        /* ③ 条内文字：左列三行 + 右下角角标 */
        pad = Math.max(6, Math.round(stripH * 0.10));
        lineH = (stripH - 2 * pad) / 3;
        sizePt = Math.max(6, lineH * 0.60);
        const LINES = [
          "品牌主视觉_v3.psd　│　导出 2026-10-13 19:40",
          "CMYK · 300 dpi · 210.0 × 297.0 mm · 出血 含 3 mm · Japan Color 2001 Coated",
          "未转曲文字层 3 个 · 缺失字体 1 个　│　依据 Vellum 出图规范 v3 · 2026-10-12 生效"
        ];
        for (let k = 0; k < LINES.length; k++) {
          const top = H + pad + k * lineH;
          await runModal(async () => {
            await batchPlay([boxTextDesc({
              text: LINES[k],
              sizePt: sizePt,
              rgb: { r: 40, g: 40, b: 40 },
              box: { left: pad, top: top, right: Math.round(W * 0.70), bottom: top + lineH },
              name: "RP-R17-" + tag + "-行" + (k + 1)
            })], {});
          }, "Review Probe: R17 条内文字 " + tag + " 行" + (k + 1));
        }

        /* 角标（右对齐 —— 字段名与枚举族沿用 S37 已实测的 align / alignmentType） */
        await runModal(async () => {
          await batchPlay([boxTextDesc({
            text: "审核用 · 非成品",
            sizePt: Math.min(sizePt * 1.35, stripH * 0.42),
            rgb: { r: 150, g: 30, b: 30 },
            box: {
              left: Math.round(W * 0.72), top: H + pad,
              right: W - pad, bottom: H + stripH - pad
            },
            align: { cls: "alignmentType", value: "right" },
            name: "RP-R17-" + tag + "-角标"
          })], {});
        }, "Review Probe: R17 角标 " + tag);

        /* ④ 图片区中间加一行说明（让人一眼看出这里是占位） */
        await runModal(async () => {
          await batchPlay([boxTextDesc({
            text: "图片区（占位色，实际是你的稿）",
            sizePt: 36,
            rgb: { r: 255, g: 255, b: 255 },
            box: { left: 100, top: 560, right: W - 100, bottom: 640 },
            name: "RP-R17-" + tag + "-占位说明"
          })], {});
        }, "Review Probe: R17 占位说明 " + tag);
      } catch (e) {
        err = errText(e);
      }

      /* ⑤ 导出 + 还原背景色 */
      let art = null;
      try { art = await exportPng(doc, "review-probe-r17-strip-" + tag); } catch (e) { err = err || errText(e); }
      if (bgBefore.ok) {
        const rb = await writeColorSlot("background", bgBefore.rgb);
        lines.push("  背景色已还原：" + (rb.ok ? "是" : "失败 " + rb.error));
      }

      lines.push("  报错：" + (err || "（无）"));
      lines.push("  样张：" + (art ? art.name + "（" + (art.bytes === null ? "?" : art.bytes) + " B）" : "（无）"));
      lines.push("  条高 " + stripH + "px · 行高 " + Math.round(lineH) + "px · 字号 " + Math.round(sizePt) + "pt");
      lines.push("");
    }

    lines.push("── 说明（给你看图时对照）──");
    lines.push("  · 图片区是**占位色**，不是真图；条内的字段值也是示例（真实现从 docInspect 取）。");
    lines.push("  · 字体是 PS 的**默认中文字体**（本轮已证明程序化改不了字体，见 §三 3）。");
    lines.push("  · 三张图的画布总高不同（1200+条高），条高分别 "
      + SAMPLE_PCTS.map((p) => Math.max(48, Math.round(W * p)) + "px").join(" / ") + "。");

    const ok = ARTIFACTS.filter((a) => a.name.indexOf("review-probe-r17-") === 0).length;
    if (!ok) {
      lines.push("");
      lines.push("⇒ 一张样张都没产出 ⇒ 无结论。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
    lines.push("");
    lines.push("⇒ 已产出 " + ok + " 张样张。挑一个比例（或说「都不合适、换成 X%」）。");
    return { status: "PASS", detail: lines.join("\n") };
  }
};

const CHECKS = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16];

/** 只跑样张（`samples.flag` 存在时）—— 免得为了看三张图把 16 项全跑一遍。 */
const SAMPLE_CHECKS = [R17];

/* ============================================================ 运行与报告 */

async function runProbe(trigger, checks) {
  const started = Date.now();
  const results = [];
  /* 允许只跑一个子集（样张模式）—— 免得为了看三张图把 16 项全跑一遍。 */
  const list = checks && checks.length ? checks : CHECKS;

  /* ⚠️ 安全自证：探针**绝不能动用户已打开的稿子**。
     所以记下"开跑前 / 收尾后"的文档数 —— 排除探针自己建的那些之后应当相同。
     这一条比任何承诺都硬：报告里能核对。 */
  let docsBefore = null;
  try { docsBefore = app.documents ? app.documents.length : null; } catch (e) { /* 忽略 */ }

  setStatus("探针开始（" + trigger + "，" + list.length + " 项）…");
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const t0 = Date.now();
    setStatus("正在跑 " + c.id + "：" + c.name);
    try {
      const r = await c.run();
      results.push({
        id: c.id,
        name: c.name,
        note: c.note || "",
        status: r.status,
        ok: r.status === "PASS",
        ms: Date.now() - t0,
        detail: r.detail || "",
        error: ""
      });
    } catch (e) {
      results.push({
        id: c.id,
        name: c.name,
        note: c.note || "",
        status: "FAIL",
        ok: false,
        ms: Date.now() - t0,
        detail: "",
        error: errText(e)
      });
    }
  }

  // 收尾：把探针自己建的文档全部关掉，绝不污染用户的稿子
  let cleanup = [];
  try {
    cleanup = await closeOwnDocs();
  } catch (e) {
    cleanup = ["收尾关闭文档时出错：" + errText(e)];
  }

  let pass = 0, fail = 0, inc = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "PASS") pass++;
    else if (results[i].status === "INCONCLUSIVE") inc++;
    else fail++;
  }

  let uxpVersion = null;
  try { uxpVersion = (uxp.versions && uxp.versions.uxp) || null; } catch (e) { /* 忽略 */ }
  let dataPath = null;
  try { dataPath = (await lfs.getDataFolder()).nativePath; } catch (e) { /* 忽略 */ }

  /* 安全自证：收尾后的文档数。探针自己建的都已关闭 ⇒ 应当回到开跑前的数。 */
  let docsAfter = null;
  try { docsAfter = app.documents ? app.documents.length : null; } catch (e) { /* 忽略 */ }

  const report = {
    plugin: PLUGIN_ID,
    version: PLUGIN_VERSION,
    at: nowIso(),
    trigger: trigger,
    uxp: uxpVersion,
    dataFolder: dataPath,
    durationMs: Date.now() - started,
    ok: fail === 0 && inc === 0,
    summary: pass + " 通过 / " + fail + " 失败 / " + inc + " 无结论（共 " + results.length + " 项）",
    counts: { pass: pass, fail: fail, inconclusive: inc, total: results.length },
    docsBefore: docsBefore,
    docsAfter: docsAfter,
    userDocsUntouched: docsBefore !== null && docsAfter !== null && docsBefore === docsAfter,
    cleanup: cleanup,
    artifacts: ARTIFACTS,
    sample: SAMPLE,
    census: CENSUS,
    pickedCanvas: R2_WINNER ? { id: R2_WINNER.id, desc: R2_WINNER.desc } : null,
    pickedExport: R3_WINNER ? { id: R3_WINNER.id, desc: R3_WINNER.desc } : null,
    pickedFont: FONT_PICK,
    results: results
  };

  let reportPath = null;
  let writeError = null;
  try {
    const folder = await lfs.getDataFolder();
    const file = await folder.createFile(REPORT_NAME, { overwrite: true });
    await file.write(JSON.stringify(report, null, 2));
    reportPath = file.nativePath;
  } catch (e) {
    writeError = errText(e);
  }

  const human = [report.summary, ""];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const mk = r.status === "PASS" ? "✓" : r.status === "INCONCLUSIVE" ? "—" : "✗";
    human.push(mk + " " + r.id + " " + r.name + "  (" + r.ms + "ms)");
    if (r.status === "FAIL" && r.error) human.push("    ⚠ " + r.error);
  }
  human.push("");
  human.push(reportPath ? "报告已写入：\n" + reportPath : "报告写入失败：" + writeError);
  setStatus(human.join("\n"));
  console.log("[ReviewProbe] 探针完成 " + report.summary);

  return report;
}

/* ==================================================================== UI */

let uiBound = false;
function bindUI() {
  if (uiBound) return;
  const btn = document.getElementById("btnRun");
  if (btn) {
    btn.addEventListener("click", function () {
      runProbe("button");
    });
    uiBound = true;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}

/* ============================================================== 入口点 */

entrypoints.setup({
  plugin: {
    async create() {
      setStatus("探针已加载 ✓\n检查是否开启自动运行…");
      try {
        const folder = await lfs.getPluginFolder();
        let auto = false;
        let samples = false;
        try {
          await folder.getEntry(FLAG_NAME);
          auto = true;
        } catch (e) {
          auto = false;
        }
        try {
          await folder.getEntry(SAMPLES_FLAG);
          samples = true;
        } catch (e) {
          samples = false;
        }
        if (samples) {
          /* 样张模式优先 —— 只出三张图，不跑全套 */
          await runProbe("samples", SAMPLE_CHECKS);
        } else if (auto) {
          await runProbe("autorun");
        } else {
          setStatus("探针已加载 ✓\n未开启自动运行（插件目录下没有 " + FLAG_NAME + " 或 "
            + SAMPLES_FLAG + "）。");
        }
      } catch (e) {
        setStatus("加载后运行失败：" + errText(e));
      }
    }
  },
  panels: {
    reviewProbePanel: {
      create() { bindUI(); },
      show() { bindUI(); }
    }
  },
  commands: {
    reviewProbeRun: {
      async run() {
        await runProbe("command");
      }
    }
  }
});
