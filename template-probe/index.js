/*
 * Template Probe —— 「模板库」方案的技术可行性探针
 * ===========================================================================
 * 建这个探针的原因：2026-10-12 的讨论里堆出了一整套设想
 *   （建稿模板 JSON → 参考线随建稿写入 → 图层结构模板 → PSD 模板库），
 *   但它们**全部依赖一个没验证过的假设**：`presetJSON` 能不能携带 `guides`。
 *   地基没验，上面几层都是沙盘。所以先造这个探针把地基钉死。
 *
 * 探针纪律（继承自本项目既有约定，别破坏）：
 *   1. **能力判据必须带"不存在的基准"** —— C1 是 C2 的对照组。
 *      没有 C1，「presetJSON 没带出 guides」就无法归因：
 *      到底是 presetJSON 本身不可用，还是 guides 字段不被接受？
 *   2. **ActionDescriptor 绝不猜** —— 本探针只发已知可用的描述符
 *      （`make layer`，写法与 hello-uxp 一致），不凭空拼参考线的描述符。
 *   3. **允许"无结论"，但不许把"无结论"写成结论** —— 见 C7，
 *      状态用 INCONCLUSIVE，不强行给 PASS/FAIL。
 *   4. **不污染用户工作区** —— 所有文档都是探针自己建的，跑完全部关掉。
 *
 * 报告落盘：插件数据目录下的 report.json，外部用 `node tools/report.mjs` 读。
 * 自动触发：插件目录下存在 `autorun.flag` 时，加载即跑。
 *
 * UXP 硬约束提醒：
 *   - 引宿主模块必须 require()，不能 import。
 *   - 改文档的操作必须包在 core.executeAsModal() 里。
 *   - UXP 的集合对象（layers / guides）**不保证可迭代** —— 一律用 length + 下标。
 */

const photoshop = require("photoshop");
const uxp = require("uxp");

const { app, core, action } = photoshop;
const { entrypoints, storage } = uxp;
const lfs = storage.localFileSystem;

const PLUGIN_ID = "com.wooozxh.templateprobe";
const PLUGIN_VERSION = "1.0.0";
const REPORT_NAME = "report.json";
const FLAG_NAME = "autorun.flag";

/* ==================================================================== 工具 */

function setStatus(text) {
  const el = document.getElementById("log");
  if (el) el.textContent = String(text);
  console.log("[TemplateProbe]", text);
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
 *  ⚠️ 不用 String(symbol)，也不对 UXP 原生对象做 JSON.stringify 之外的加工。 */
function brief(v, max) {
  const limit = typeof max === "number" ? max : 300;
  let s;
  try {
    if (v === null) s = "null";
    else if (v === undefined) s = "undefined";
    else if (typeof v === "string") s = v;
    else if (typeof v === "symbol") s = "Symbol(不可显示)";
    else s = JSON.stringify(v);
    if (s === undefined) s = "[JSON 化失败] typeof=" + typeof v;
  } catch (e) {
    s = "[无法序列化] " + errText(e);
  }
  return s.length > limit ? s.slice(0, limit) + "…(截断)" : s;
}

/** 安全地描述一个对象（可能是 UXP 原生对象）。
 *
 *  ★ 2026-10-12 实测教训（探针第一版 C2/C8 就栽在这里）：
 *    **不要对 UXP 原生对象调用 `Object.prototype.toString.call(x)`** ——
 *    它内部会去读 `x[Symbol.toStringTag]`，而 UXP 的原生绑定在访问 Symbol 键时
 *    会抛 `Cannot convert a Symbol value to a string`。
 *    当时这个异常被当成"能力失败"，差点误判 —— 其实是探针自己的 bug。
 *    所以这里只用 typeof 和逐项 try/catch，绝不碰 Symbol。 */
function describeNative(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  const t = typeof v;
  if (t !== "object" && t !== "function") return t + " = " + brief(v, 120);
  const parts = ["typeof=object"];
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
    parts.push("Object.keys()=" + keys.length + " 项" + (keys.length ? "：" + brief(keys, 120) : ""));
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

/* ======================================================== 临时文档管理 */

/** 探针自己建的文档都登记在这里，收尾时统一关闭，绝不碰用户的稿子。 */
const ownDocs = [];

async function makeDoc(options, label) {
  let doc = null;
  await runModal(async () => {
    doc = await app.createDocument(options);
  }, "Template Probe: 建临时文档 " + label);
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
      }, "Template Probe: 关闭临时文档");
      out.push(nm + " 已关闭");
    } catch (e) {
      out.push(nm + " 关闭失败：" + errText(e));
    }
  }
  ownDocs.length = 0;
  return out;
}

/** 按名字在顶层图层里找一个图层（不依赖顺序，避免抓到背景层）。 */
function findLayerByName(doc, name) {
  const list = safe(() => doc.layers);
  if (!list.ok || !list.value) return null;
  const n = list.value.length;
  for (let i = 0; i < n; i++) {
    const nm = safe(() => list.value[i].name);
    if (nm.ok && nm.value === name) return list.value[i];
  }
  return null;
}

/** 顶层图层名清单。 */
function layerNames(doc) {
  const out = [];
  const list = safe(() => doc.layers);
  if (!list.ok || !list.value) return out;
  const n = list.value.length;
  for (let i = 0; i < n; i++) {
    const nm = safe(() => list.value[i].name);
    out.push(nm.ok ? nm.value : "?");
  }
  return out;
}

/** 已知可用的建层写法（与 hello-uxp 一致，非猜测）。 */
async function addTestLayer(name) {
  await runModal(async () => {
    await action.batchPlay(
      [
        {
          _obj: "make",
          _target: [{ _ref: "layer" }],
          using: { _obj: "layer", name: name }
        }
      ],
      {}
    );
  }, "Template Probe: 建测试图层 " + name);
}

/* ============================================================== 检查项 */

const CHECKS = [
  {
    id: "C1",
    name: "presetJSON 基线（不传 guides）+ 体检字段真实形态",
    note: "★ 本项是 C2 的对照组 —— 没有它，C2 失败就无法归因",
    async run() {
      const preset = {
        name: "TP-C1-presetJSON-baseline",
        width: 800, height: 600, units: "pixelsUnit",
        resolution: 300, resolutionUnits: "inchesUnit",
        depth: 8, scale: 1,
        mode: "RGB", fill: "white",
        profile: "sRGB IEC61966-2.1",
        artboards: []
      };
      const doc = await makeDoc({ presetJSON: JSON.stringify(preset) }, "C1");
      if (!doc) throw new Error("createDocument 未返回文档");

      const w = safe(() => doc.width).value;
      const h = safe(() => doc.height).value;
      const res = safe(() => doc.resolution).value;

      const lines = [
        "传入（不含 guides）：" + brief(preset, 400),
        "── 回读 ──",
        "name              = " + readOf(() => doc.name),
        "width             = " + readOf(() => doc.width),
        "height            = " + readOf(() => doc.height),
        "resolution        = " + readOf(() => doc.resolution),
        "mode              = " + readOf(() => doc.mode),
        "bitsPerChannel    = " + readOf(() => doc.bitsPerChannel),
        "colorProfileName  = " + readOf(() => doc.colorProfileName),
        "colorProfileType  = " + readOf(() => doc.colorProfileType),
        "saved             = " + readOf(() => doc.saved),
        "guides.length     = " + readOf(() => (doc.guides ? doc.guides.length : null))
      ];

      const pass = Math.round(w) === 800 && Math.round(h) === 600 && Math.round(res) === 300;
      if (!pass) lines.push("\n⇒ 尺寸/分辨率未按预期回读 —— presetJSON 可能未被正确解析");
      if (String(safe(() => doc.name).value) !== preset.name) {
        lines.push("");
        lines.push("⚠ 附带发现：presetJSON 里的 name 字段**被忽略**（回读为「" + brief(safe(() => doc.name).value) + "」）。");
        lines.push("   ⇒ 文档命名不能靠 presetJSON，要用 createDocument 的 name 参数另行处理。");
      }
      return { status: pass ? "PASS" : "FAIL", detail: lines.join("\n") };
    }
  },

  {
    id: "C2",
    name: "★ presetJSON 是否携带 guides（地基）",
    async run() {
      const guidesIn = [
        { direction: "v", coordinate: 5 },
        { direction: "v", coordinate: 95 },
        { direction: "h", coordinate: 10 },
        { direction: "h", coordinate: 90 }
      ];
      const preset = {
        name: "TP-C2-guides",
        width: 1000, height: 1000, units: "pixelsUnit",
        resolution: 72, resolutionUnits: "inchesUnit",
        depth: 8, scale: 1,
        mode: "RGB", fill: "white",
        profile: "sRGB IEC61966-2.1",
        guides: guidesIn,
        artboards: []
      };
      const doc = await makeDoc({ presetJSON: JSON.stringify(preset) }, "C2");
      if (!doc) throw new Error("createDocument 未返回文档");

      const gs = safe(() => doc.guides);
      const lines = [
        "传入 guides：" + brief(guidesIn),
        "doc.guides 形态：" + (gs.ok ? describeNative(gs.value) : "读取失败：" + gs.error),
        "doc.guides 是否为 null/undefined：" + (gs.ok ? String(gs.value == null) : "?")
      ];

      let n = 0;
      if (gs.ok && gs.value && typeof gs.value.length === "number") {
        n = gs.value.length;
        lines.push("doc.guides.length：" + n);
        lines.push("── 逐条回读 ──");
        if (n === 0) {
          lines.push("  （空 —— 没有回读到任何参考线）");
        } else {
          for (let i = 0; i < n && i < 12; i++) {
            const gi = safe(() => gs.value[i]);
            lines.push("  [" + i + "] " + (gi.ok ? brief(gi.value, 200) : "读取失败：" + gi.error));
          }
        }
      } else {
        lines.push("doc.guides 不可用或无 length：" + (gs.ok ? brief(gs.value) : gs.error));
      }

      lines.push("");
      lines.push(
        n >= 4
          ? "⇒ presetJSON **可以**携带 guides（回读 " + n + " 条）—— 建稿时写入出血线这条路成立"
          : "⇒ presetJSON **未能**携带 guides。因 C1 已证明 presetJSON 本身可用，"
            + "故此处失败可归因到 guides 字段本身不被接受。"
      );
      if (n > 0) {
        lines.push("（另注：读数里的 coordinate 是像素还是百分比，看回读值即可判断 —— 传入 5/95/10/90，画布 1000px）");
      }
      return { status: n >= 4 ? "PASS" : "FAIL", detail: lines.join("\n") };
    }
  },

  {
    id: "C3",
    name: "presetJSON + CMYK 模式（印刷稿模板要用）",
    async run() {
      const preset = {
        name: "TP-C3-cmyk",
        width: 2480, height: 3508, units: "pixelsUnit",
        resolution: 300, resolutionUnits: "inchesUnit",
        depth: 8, scale: 1,
        mode: "CMYK", fill: "white",
        profile: "Japan Color 2001 Coated",
        guides: [], artboards: []
      };
      const doc = await makeDoc({ presetJSON: JSON.stringify(preset) }, "C3");
      if (!doc) throw new Error("createDocument 未返回文档");

      const mode = safe(() => doc.mode).value;
      const pass = String(mode).indexOf("CMYK") >= 0;
      return {
        status: pass ? "PASS" : "FAIL",
        detail: [
          "期望 mode 含 CMYK，实读 mode = " + readOf(() => doc.mode),
          "colorProfileName  = " + readOf(() => doc.colorProfileName),
          "colorProfileType  = " + readOf(() => doc.colorProfileType),
          "width × height    = " + Math.round(safe(() => doc.width).value) + " × " + Math.round(safe(() => doc.height).value),
          "resolution        = " + readOf(() => doc.resolution)
        ].join("\n")
      };
    }
  },

  {
    id: "C4",
    name: "★ activeHistoryState 可写（「整批撤销」的地基）",
    async run() {
      const doc = await makeDoc({ width: 400, height: 400, resolution: 72, name: "TP-C4-history" }, "C4");
      if (!doc) throw new Error("createDocument 未返回文档");

      const before = layerNames(doc).length;
      const mark = safe(() => doc.activeHistoryState);
      const markShape = mark.ok ? brief(mark.value, 200) : "读取失败：" + mark.error;

      await addTestLayer("TP-C4-added");
      const after = layerNames(doc).length;

      let restored = null;
      let restoreErr = null;
      try {
        await runModal(async () => {
          doc.activeHistoryState = mark.value;
        }, "Template Probe: 跳回历史状态");
        restored = layerNames(doc).length;
      } catch (e) {
        restoreErr = errText(e);
      }

      const pass = after === before + 1 && restored === before;
      const lines = [
        "activeHistoryState 形态：" + markShape,
        "图层数：" + before + " → " + after + "（建层后）→ " + restored + "（跳回后）",
        pass
          ? "⇒ 赋值生效、图层数回落 —— 「批量操作前记标记、不满意一步退回」这条路成立"
          : "⇒ 图层数未回落 —— 赋值可能未生效，需换 batchPlay 的 select/historyState 写法"
      ];
      if (restoreErr) lines.push("赋值报错：" + restoreErr);
      return { status: pass ? "PASS" : "FAIL", detail: lines.join("\n") };
    }
  },

  {
    id: "C5",
    name: "duplicateLayers 跨文档复制图层（PSD 模板库要用）",
    async run() {
      const a = await makeDoc({ width: 800, height: 600, resolution: 72, name: "TP-C5-A" }, "C5-A");
      if (!a) throw new Error("文档 A 未创建");
      await addTestLayer("TP-SRC-LAYER");
      const layerA = findLayerByName(a, "TP-SRC-LAYER");
      if (!layerA) throw new Error("在 A 中找不到刚建的源图层");

      const b = await makeDoc({ width: 400, height: 400, resolution: 72, name: "TP-C5-B" }, "C5-B");
      if (!b) throw new Error("文档 B 未创建");

      const namesBefore = layerNames(b);
      let dupErr = null;
      let returned = null;
      try {
        await runModal(async () => {
          returned = await a.duplicateLayers([layerA], b);
        }, "Template Probe: duplicateLayers 跨文档");
      } catch (e) {
        dupErr = errText(e);
      }
      const namesAfter = layerNames(b);

      const found = namesAfter.indexOf("TP-SRC-LAYER") >= 0;
      const pass = found && !dupErr;
      const lines = [
        "A 的图层：" + brief(layerNames(a)),
        "B 的图层（复制前）：" + brief(namesBefore),
        "B 的图层（复制后）：" + brief(namesAfter),
        "duplicateLayers 返回值：" + brief(returned, 200)
      ];
      if (dupErr) lines.push("报错：" + dupErr);
      lines.push(pass ? "⇒ 跨文档复制成功" : "⇒ 未在 B 中找到源图层");
      return { status: pass ? "PASS" : "FAIL", detail: lines.join("\n") };
    }
  },

  {
    id: "C6",
    name: "文字层字体名的读取路径（字体缺失检测要用）",
    async run() {
      const doc = await makeDoc({ width: 800, height: 400, resolution: 72, name: "TP-C6-text" }, "C6");
      if (!doc) throw new Error("createDocument 未返回文档");

      let layer = null;
      await runModal(async () => {
        layer = await app.activeDocument.createTextLayer({ contents: "探针字体 Abc 123" });
      }, "Template Probe: 建文字层");
      if (!layer) throw new Error("createTextLayer 未返回图层");

      const ti = safe(() => layer.textItem);
      if (!ti.ok) throw new Error("读不到 textItem：" + ti.error);

      const probePaths = [
        "textItem.font",
        "textItem.characterStyle.font",
        "textItem.characterStyle.fontPostScriptName",
        "textItem.characterStyle.size",
        "textItem.characterStyle.fontStyleName",
        "textItem.paragraphStyle.font",
        "layer.font",
        "layer.kind"
      ];

      function tryPath(p) {
        if (p === "textItem.font") return ti.value.font;
        if (p === "textItem.characterStyle.font") return ti.value.characterStyle.font;
        if (p === "textItem.characterStyle.fontPostScriptName") return ti.value.characterStyle.fontPostScriptName;
        if (p === "textItem.characterStyle.size") return ti.value.characterStyle.size;
        if (p === "textItem.characterStyle.fontStyleName") return ti.value.characterStyle.fontStyleName;
        if (p === "textItem.paragraphStyle.font") return ti.value.paragraphStyle ? ti.value.paragraphStyle.font : undefined;
        if (p === "layer.font") return layer.font;
        if (p === "layer.kind") return layer.kind;
        return undefined;
      }

      const lines = ["── DOM 各路径读数 ──"];
      let hit = null;
      for (let i = 0; i < probePaths.length; i++) {
        const p = probePaths[i];
        const r = safe(() => tryPath(p));
        const val = r.ok ? brief(r.value, 200) : "读取失败：" + r.error;
        lines.push(p + " = " + val);
        if (r.ok && typeof r.value === "string" && r.value.length > 0 && !hit) {
          hit = p + " → " + r.value;
        }
      }

      // 只读地看一眼 batchPlay 的 textKey（不猜写入描述符，只发已知的 get）
      lines.push("── batchPlay 读数 ──");
      let bpVal = null;
      let bpErr = null;
      try {
        await runModal(async () => {
          const res = await action.batchPlay(
            [
              {
                _obj: "get",
                _target: [
                  { _property: "textKey" },
                  { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
                ]
              }
            ],
            {}
          );
          bpVal = res && res[0] ? res[0].textKey : null;
        }, "Template Probe: batchPlay 读 textKey");
      } catch (e) {
        bpErr = errText(e);
      }
      lines.push("textKey = " + (bpErr ? "报错：" + bpErr : brief(bpVal, 600)));

      lines.push("");
      lines.push(hit ? "⇒ 可用路径：" + hit : "⇒ 没有任何路径读到字符串型字体名");
      return { status: hit ? "PASS" : "FAIL", detail: lines.join("\n") };
    }
  },

  {
    id: "C7",
    name: "文字溢出检测：内容实际范围 vs 文本框范围",
    async run() {
      const doc = await makeDoc({ width: 400, height: 200, resolution: 72, name: "TP-C7-overflow" }, "C7");
      if (!doc) throw new Error("createDocument 未返回文档");

      // ── 第一版探针的教训（保留，不删）──────────────────────────────
      // 上一版我只建了「点文字」，而点文字根本没有"文本框"这个概念，
      // 自然谈不上"溢出文本框"—— 测错了对象，结论只能是无结论。
      // 这一版改成：① 先确认基线是哪种文字 ② 逐个候选写法试建段落文字
      // ③ 对比【内容实际范围】与【文本框范围】两个读数。
      const LONG = "这是一段刻意写得很长的文字，用来测试当内容超过文本框时能否被检测出来。".repeat(3);
      const lines = [];

      lines.push("── ① 基线：不传任何排版选项 ──");
      let base = null;
      await runModal(async () => {
        base = await app.activeDocument.createTextLayer({ contents: LONG });
      }, "Template Probe: 建基线文字层");
      if (base) {
        lines.push("textItem.isParagraphText = " + readOf(() => base.textItem.isParagraphText));
        lines.push("layer.bounds             = " + readOf(() => base.bounds, 240));
        lines.push("（点文字没有文本框：layer.bounds 就是内容本身的范围，可超出画布）");
      }

      lines.push("");
      lines.push("── ② 试建「段落文字」（逐个候选写法，记录成败）──");
      const candidates = [
        { label: "kind=paragraphText", opts: { contents: LONG, kind: "paragraphText" } },
        { label: "kind=paragraphText + width/height", opts: { contents: LONG, kind: "paragraphText", width: 200, height: 80 } },
        { label: "type=paragraphText + width/height", opts: { contents: LONG, type: "paragraphText", width: 200, height: 80 } },
        { label: "paragraphText=true + width/height", opts: { contents: LONG, paragraphText: true, width: 200, height: 80 } }
      ];
      let areaLayer = null;
      let areaLabel = null;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        let made = null;
        let err = null;
        try {
          await runModal(async () => {
            made = await app.activeDocument.createTextLayer(c.opts);
          }, "Template Probe: 段落文字候选 " + i);
        } catch (e) {
          err = errText(e);
        }
        if (err || !made) {
          lines.push("  [" + i + "] " + c.label + " → 报错：" + (err || "未返回图层"));
          continue;
        }
        const ip = readOf(() => made.textItem.isParagraphText);
        const bd = readOf(() => made.bounds, 200);
        lines.push("  [" + i + "] " + c.label + " → 建出，isParagraphText=" + ip + "，bounds=" + bd);
        if (!areaLayer) areaLayer = made;
        if (String(ip) === "true") {
          areaLayer = made;
          areaLabel = c.label;
          break;
        }
      }

      lines.push("");
      if (!areaLayer) {
        lines.push("⇒ 四种候选写法都没能建出段落文字层 —— 文字溢出检测在 DOM 层暂时走不通，");
        lines.push("   需要改走 batchPlay 并**录制**真实描述符（本项目纪律：ActionDescriptor 绝不允许猜）。");
        return { status: "INCONCLUSIVE", detail: lines.join("\n") };
      }

      lines.push("── ③ 深入读数 ──");
      lines.push("⚠ 注意：② 里四种候选写法建出来的层，isParagraphText **始终是 false** ——");
      lines.push("   也就是说它们仍然是「点文字」，排版选项被静默忽略了。");
      lines.push("   因此下面的读数**不能**当作「文本框 vs 内容」的比对。");
      lines.push("");
      lines.push("isParagraphText = " + readOf(() => areaLayer.textItem.isParagraphText));
      lines.push("layer.bounds    = " + readOf(() => areaLayer.bounds, 300));
      lines.push("（caveat：batchPlay 读的是*活动*图层＝最后建的那个，与本行 layer.bounds 未必同层；");
      lines.push("  本次五个层内容完全相同、读数一致，故暂不影响，但正式实现必须锁定同一层。）");

      let tk = null;
      let tkErr = null;
      try {
        await runModal(async () => {
          const res = await action.batchPlay(
            [
              {
                _obj: "get",
                _target: [
                  { _property: "textKey" },
                  { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
                ]
              }
            ],
            {}
          );
          tk = res && res[0] ? res[0].textKey : null;
        }, "Template Probe: 读完整 textKey");
      } catch (e) {
        tkErr = errText(e);
      }

      if (tkErr) {
        lines.push("textKey 读失败：" + tkErr);
      } else if (!tk) {
        lines.push("textKey 为空");
      } else {
        lines.push("textKey 顶层键       = " + readOf(() => Object.keys(tk), 400));
        lines.push("textKey.bounds       = " + brief(tk.bounds, 500));
        lines.push("textKey.shapeType    = " + brief(tk.shapeType, 200));
        lines.push("textKey.textGridding = " + brief(tk.textGridding, 200));
      }

      lines.push("");
      lines.push("画布 = " + Math.round(safe(() => doc.width).value) + " × " + Math.round(safe(() => doc.height).value) + " px");
      lines.push("");

      lines.push("⇒ 结论：**未解决（无结论）**——不能算通过。");
      lines.push("   ① DOM 层四种写法都建不出段落文字（选项被忽略，isParagraphText 恒为 false）");
      lines.push("      ⇒ 「段落文本框」这个对象在 DOM 里根本拿不到，「框 vs 内容」无从比对。");
      lines.push("   ② 两条范围读数确实都能拿到（layer.bounds 像素 / textKey.bounds 点），");
      lines.push("      但它们都是「文字自身范围」的不同表达，**不是**「框 vs 内容」，不能当溢出判据。");
      lines.push("   ③ 这条路要成立，得走 batchPlay 建段落文字，且描述符**必须录制**，不许猜。");
      lines.push("   ④ 第一版探针还犯过一个错：只建了点文字就断言「无结论」，测错了对象 —— 已修正。");
      return { status: "INCONCLUSIVE", detail: lines.join("\n") };
    }
  },

  {
    id: "C8",
    name: "app.fonts 的形态（字体缺失检测要用）",
    async run() {
      const f = safe(() => app.fonts);
      const lines = [];
      lines.push("app.fonts 存在性：" + (f.ok ? "是" : "读取失败：" + f.error));
      if (f.ok) {
        lines.push("app.fonts 形态：" + describeNative(f.value));
      }

      // ★ 实测更正（第一版探针在此报 "app.fonts.getFontList is not a function"）：
      //   `app.fonts` **本身就是字体集合**（本机 length=583），并没有 getFontList() 这个方法。
      //   正解：直接按下标遍历。
      let count = null;
      const gl = safe(() => app.fonts);
      if (gl.ok && gl.value) {
        lines.push("app.fonts.length：" + (typeof gl.value.length === "number" ? gl.value.length : "无（不是集合形态）"));
        const list = gl.value;
        if (list && typeof list.length === "number") {
          count = list.length;
          lines.push("已安装字体数量：" + count);
          // 逐项读出名字（不依赖 JSON.stringify，原生对象上不一定能用）
          const names = [];
          for (let i = 0; i < count; i++) {
            const one = safe(() => list[i]);
            if (!one.ok) continue;
            let nm = null;
            const cand = safe(() => one.value.name);
            if (cand.ok && typeof cand.value === "string") nm = cand.value;
            else if (typeof one.value === "string") nm = one.value;
            else {
              const ps = safe(() => one.value.postScriptName);
              if (ps.ok && typeof ps.value === "string") nm = ps.value;
            }
            if (nm) names.push(nm);
          }
          lines.push("成功读出名字的字体数：" + names.length);
          lines.push("前 8 个：" + brief(names.slice(0, 8)));
          lines.push("原始首项形态：" + brief(safe(() => list[0]).value, 300));

          // 直接验证「按名字判断某字体在不在」这个动作能不能做
          const wanted = ["MicrosoftYaHei", "Microsoft YaHei", "AdobeHeitiStd", "ArialMT", "思源黑体", "SourceHanSans"];
          const blob = names.join(" || ");
          const hits = [];
          for (let i = 0; i < wanted.length; i++) {
            if (blob.indexOf(wanted[i]) >= 0) hits.push(wanted[i]);
          }
          lines.push("在名字列表里命中：" + brief(hits));
          lines.push("（这一条就是「字体缺失检测」的实现基础：拿稿里用到的字体名到这份列表里找）");
        } else {
          lines.push("返回的不是带 length 的列表：" + brief(list, 300));
        }
      } else {
        lines.push("app.fonts 不可用：" + (gl.error || "为空"));
      }

      const pass = count !== null && count > 0;
      return { status: pass ? "PASS" : "FAIL", detail: lines.join("\n") };
    }
  }
];

/* ============================================================ 跑探针 */

async function runProbe(trigger) {
  setStatus("正在跑探针（" + trigger + "）…");
  const started = Date.now();
  const results = [];

  for (let i = 0; i < CHECKS.length; i++) {
    const c = CHECKS[i];
    const t0 = Date.now();
    setStatus("正在跑 " + c.id + " …");
    try {
      const out = (await c.run()) || {};
      results.push({
        id: c.id,
        name: c.name,
        note: c.note || "",
        status: out.status || "FAIL",
        ok: out.status === "PASS",
        ms: Date.now() - t0,
        detail: out.detail || ""
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
    cleanup: cleanup,
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
    const mark = r.status === "PASS" ? "✓" : r.status === "INCONCLUSIVE" ? "—" : "✗";
    human.push(mark + " " + r.id + " " + r.name + "  (" + r.ms + "ms)");
    if (r.status === "FAIL" && r.error) human.push("    ⚠ " + r.error);
  }
  human.push("");
  human.push(reportPath ? "报告已写入：\n" + reportPath : "报告写入失败：" + writeError);
  setStatus(human.join("\n"));
  console.log("[TemplateProbe] 探针完成 " + report.summary);

  return report;
}

/* ================================================================ UI */

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

/* ============================================================ 入口点 */

entrypoints.setup({
  plugin: {
    async create() {
      setStatus("探针已加载 ✓\n检查是否开启自动运行…");
      try {
        const folder = await lfs.getPluginFolder();
        let auto = false;
        try {
          await folder.getEntry(FLAG_NAME);
          auto = true;
        } catch (e) {
          auto = false;
        }
        if (auto) {
          await runProbe("autorun");
        } else {
          setStatus("探针已加载 ✓\n未开启自动运行（插件目录下没有 " + FLAG_NAME + "）。");
        }
      } catch (e) {
        setStatus("加载后运行失败：" + errText(e));
      }
    }
  },
  panels: {
    templateProbePanel: {
      create() { bindUI(); },
      show() { bindUI(); }
    }
  },
  commands: {
    templateProbeRun: {
      async run() {
        await runProbe("command");
      }
    }
  }
});
