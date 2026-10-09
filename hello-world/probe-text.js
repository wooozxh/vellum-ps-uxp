/*
 * probe-text.js —— 「文本图层正确写法」探针（开发期工具，非产品代码）
 * ===========================================================================
 * 起因（2026-10-09 用户回报）：
 *   点面板「在当前文档插入 "Hello World" 文字」后，
 *     ① Photoshop 弹出原生错框：「Hello World: 命令"设置"当前不可用。」
 *     ② 只建出一个名叫 "Hello World" 的**普通图层**，不是文本图层
 *
 * 实测结论（2026-10-09，PS 2026 v27.2 / UXP 9.0.2）：
 *
 *   A 轮 · 谁能造出文本层
 *   ┌──────────────────────────────────────────────────┬────────────────────┐
 *   │ 写法                                              │ 结果               │
 *   ├──────────────────────────────────────────────────┼────────────────────┤
 *   │ A1 make + using{layer, name, textKey}      （旧）  │ layerKind=1 普通层 │
 *   │ A2 同上再加 layerKind:{_enum:...:textLayer}       │ layerKind=1 普通层 │
 *   │ A3 make + using{textLayer, name, textKey}         │ layerKind=1 普通层 │
 *   │ A4 DOM document.createTextLayer({contents})       │ layerKind=3 文本层 │
 *   └──────────────────────────────────────────────────┴────────────────────┘
 *   → batchPlay 的 make+textKey 在本版本上**不再生成文本图层**；名字却照样对，
 *     所以只比对图层名的自检会假阳性 —— 这正是用户报的 bug 当初能溜进 boot.log 的原因。
 *
 *   B 轮 · 文本层属性怎么读写（在 A4 造出的真文本层上测）
 *   → TextItem 的属性只有 characterStyle / paragraphStyle / warpStyle / _parent，
 *     **没有 fontSize**；字号得写 textItem.characterStyle.size（12 → 72，PS 回读确认）。
 *
 *   另外两条硬约束：
 *   → 在**非**文本层上 set textLayer（to 里带 textKey），PS 会弹出原生错误框
 *     「命令"设置"当前不可用。」并**阻塞**整个 executeAsModal —— 第一轮探针就是被它
 *     卡死的，用户遇到的也正是这一幕。故本探针剔除了一切会触发 set 的变体。
 *   → 插件目录是**只读存储**：插件既不能在自己目录里建文件，也删不掉文件。
 *     flag 只能由外部创建/删除；「跑过没有」的印章只能写到可写的 PluginData。
 *
 * ⚠️ 判定坑（本项目连踩两次，务必记牢）：判据必须对准数据的**实际形态**。
 *    ① layerKind 经 batchPlay 出来是**数字** 1/3，经 DOM 出来是**字符串** "pixel"/"text"；
 *       第一版拿字符串去匹配数字 → 把唯一的正确答案 A4 判成 FAIL（假阴性）。
 *    ② size 从 PS 回读是 {"_unit":"pointsUnit","_value":72}，不是数字 72；
 *       第二版按 /"size":72/ 匹配 → 又把成功判成失败（假阴性）。
 *
 * 触发方式：插件目录下存在 probe-text.flag 时，插件加载后自动跑一次。
 *          跑过之后在 PluginData 写 probe-text.done，下次跳过；
 *          想重跑就删掉 probe-text.done，想关掉就删掉 probe-text.flag。
 * 观测方式：node tools/report.mjs
 *
 * 安全边界：全程只在**新建的临时文档**上操作，结束即关闭，绝不碰用户已打开的文档。
 */

const photoshop = require("photoshop");
const uxp = require("uxp");

// 注意：不要写成 { ...photoshop }，UXP 模块的属性不可枚举，展开后会全丢。
const app = photoshop.app;
const core = photoshop.core;
const action = photoshop.action;
const storage = uxp.storage;

const batchPlay = action.batchPlay;

/** 探针用的文字内容与临时文档名。 */
const TEXT = "Hello World";
const TMPDOC = "HW-probe";

/** Photoshop 的 layerKind 枚举值（实测）：1 = 普通像素层，3 = 文本层。 */
const KIND_NORMAL = 1;
const KIND_TEXT = 3;

/* =================================================================== 工具 */

function runModal(fn, commandName) {
  return core.executeAsModal(fn, { commandName: commandName });
}

/** UXP 返回的枚举可能是字符串，也可能是 { _enum, _value } 对象或数字，统一成字符串。 */
function normalizeEnum(v) {
  if (v === null || v === undefined) return "?";
  if (typeof v === "object") {
    return String(v._value !== undefined ? v._value : JSON.stringify(v));
  }
  return String(v);
}

/** 数字枚举与字符串两种形态都认。 */
function isTextKind(kind) {
  const s = String(kind).toLowerCase();
  return s === String(KIND_TEXT) || s.indexOf("text") >= 0;
}

function errText(e) {
  return e && e.message ? e.message : String(e);
}

/** 读当前选中图层（即刚建出来的那个）的名称与 layerKind。需在模态作用域内调用。 */
async function readTopLayer() {
  let name = "?";
  let layers = 0;
  let domKind = "?";

  try {
    const doc = app.activeDocument;
    layers = doc.layers.length;
    const top = doc.activeLayers && doc.activeLayers.length
      ? doc.activeLayers[0]
      : doc.layers[0];
    if (top) {
      name = top.name;
      try {
        domKind = String(top.kind);
      } catch (e) {
        domKind = "ERR:" + errText(e);
      }
    }
  } catch (e) {
    name = "ERR:" + errText(e);
  }

  let psdKind = "?";
  try {
    const res = await batchPlay(
      [
        {
          _obj: "get",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" }
        }
      ],
      {}
    );
    psdKind = normalizeEnum(res && res[0] ? res[0].layerKind : null);
  } catch (e) {
    psdKind = "ERR:" + errText(e);
  }

  return { name: name, psdKind: psdKind, domKind: domKind, layers: layers };
}

/**
 * 深挖证据：把「这个层到底是不是文本层」用多条独立线索交叉验证，
 * 免得再出现"一个判据错了就全盘皆错"的事。
 */
async function deepInspect() {
  const out = {};

  try {
    const top = app.activeDocument.layers[0];
    out.domKind = String(top.kind);
  } catch (e) {
    out.domKind = "ERR:" + errText(e);
  }

  try {
    const LK = photoshop.constants && photoshop.constants.LayerKind;
    out.constLayerKind = LK ? "TEXT=" + LK.TEXT + " NORMAL=" + LK.NORMAL : "constants.LayerKind 不存在";
  } catch (e) {
    out.constLayerKind = "ERR:" + errText(e);
  }

  try {
    const res = await batchPlay(
      [
        {
          _obj: "get",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" }
        }
      ],
      {}
    );
    const d = res && res[0];
    out.getKeys = d ? Object.keys(d).join(",") : "空";
    out.hasTextKey = d && d.textKey !== undefined ? "有 textKey=" + d.textKey : "无 textKey";
  } catch (e) {
    out.getKeys = "ERR:" + errText(e);
  }

  try {
    const top = app.activeDocument.layers[0];
    out.textItem = top.textItem ? "存在" : "不存在";
  } catch (e) {
    out.textItem = "ERR:" + errText(e);
  }

  return out;
}

/** 关掉所有本次探针遗留的临时文档，防止失败时越堆越多。 */
async function cleanupTempDocs() {
  try {
    const doomed = [];
    for (let i = 0; i < app.documents.length; i++) {
      if (app.documents[i].name === TMPDOC) doomed.push(app.documents[i]);
    }
    if (!doomed.length) return;
    await runModal(async () => {
      for (const d of doomed) {
        try {
          await d.closeWithoutSaving();
        } catch {
          /* 关不掉就留着，不阻断后续 */
        }
      }
    }, "probe：清理临时文档");
  } catch {
    /* 清理失败不阻断 */
  }
}

/** 写 report.json（与 hello-uxp 同格式，report.mjs 能直接渲染）。 */
async function writeReport(data) {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    let file;
    try {
      file = await folder.getEntry("report.json");
    } catch {
      file = await folder.createFile("report.json", { overwrite: true });
    }
    await file.write(JSON.stringify(data, null, 2));
  } catch {
    /* 报告写不出去了也没别的办法，日志里会体现 */
  }
}

/** 写一份原始文本日志，方便肉眼直读。 */
async function writeLog(name, text) {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    let file;
    try {
      file = await folder.getEntry(name);
    } catch {
      file = await folder.createFile(name, { overwrite: true });
    }
    await file.write(text);
  } catch {
    /* 同上 */
  }
}

/**
 * 关于开关，两个实测到的硬约束：
 *   1. UXP 的 Folder **没有 deleteEntry**（报 "folder.deleteEntry is not a function"）
 *   2. **插件目录是只读存储**（getPluginFolder() 创建文件报
 *      "The file uses a storage provider that is read-only."）
 *   → 所以 flag 只能由外部（人/AI）创建和删除，插件自己动不了它；
 *     而「已经跑过」的印章只能写到可写的 PluginData 目录。
 *   → 想重跑探针：删掉 PluginData 里的 probe-text.done。
 *   → 想彻底关掉探针：删掉插件目录里的 probe-text.flag。
 */
async function hasDone() {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    await folder.getEntry("probe-text.done");
    return true;
  } catch {
    return false;
  }
}

async function markDone(text) {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    const file = await folder.createFile("probe-text.done", { overwrite: true });
    await file.write(text);
    return "ok";
  } catch (e) {
    return "FAILED " + errText(e);
  }
}

/* ======================================================== A 轮：谁造得出文本层 */

/**
 * 只测「造层」，不测任何 set —— 因为普通层上的 set textLayer 会让 PS 弹原生框
 * 并阻塞整个模态，第一轮探针就是被这个卡死的。
 */
const MAKE_VARIANTS = [
  {
    name: "A1（旧写法）make + using{layer, name, textKey}",
    build: () =>
      batchPlay(
        [
          {
            _obj: "make",
            _target: [{ _ref: "layer" }],
            using: { _obj: "layer", name: TEXT, textKey: TEXT },
            _options: { dialogOptions: "dontDisplay" }
          }
        ],
        {}
      )
  },
  {
    name: "A2 make + using{layer, name, layerKind:textLayer, textKey}",
    build: () =>
      batchPlay(
        [
          {
            _obj: "make",
            _target: [{ _ref: "layer" }],
            using: {
              _obj: "layer",
              name: TEXT,
              layerKind: { _enum: "layerKind", _value: "textLayer" },
              textKey: TEXT
            },
            _options: { dialogOptions: "dontDisplay" }
          }
        ],
        {}
      )
  },
  {
    name: "A3 make + using{textLayer, name, textKey}",
    build: () =>
      batchPlay(
        [
          {
            _obj: "make",
            _target: [{ _ref: "layer" }],
            using: { _obj: "textLayer", name: TEXT, textKey: TEXT },
            _options: { dialogOptions: "dontDisplay" }
          }
        ],
        {}
      )
  },
  {
    name: "A4 DOM：document.createTextLayer({contents})",
    build: () => app.activeDocument.createTextLayer({ contents: TEXT })
  }
];

/* ==================================================== B 轮：DOM 上还能做什么 */

/**
 * A4 是唯一能造出文本层的写法，那「设字号」自然也要在这条路上找答案。
 * DOM 抛错只会 reject，**不会弹 PS 原生框**，所以这一轮可以放心跑。
 */
async function probeDomTextCapabilities() {
  const out = {
    created: false,
    domKindOfCreated: "?",
    textItem: "?",
    itemProps: "?",
    characterStyle: "?",
    csProps: "?",
    csSizeBefore: "?",
    csSizeAfter: "?",
    csFont: "?",
    tiFontSize: "?",
    psAfterCsSize: "?",
    psAfterTiFontSize: "?",
    sizeApplied: false
  };

  /** 用 Photoshop 自己吐出来的 textKey 判定字号到底改没改 —— DOM 读回可能只是缓存。 */
  async function readPsTextKey() {
    try {
      const res = await batchPlay(
        [
          {
            _obj: "get",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            _options: { dialogOptions: "dontDisplay" }
          }
        ],
        {}
      );
      const tk = res && res[0] ? res[0].textKey : null;
      return tk ? JSON.stringify(tk) : "无 textKey";
    } catch (e) {
      return "ERR:" + errText(e);
    }
  }

  await runModal(async () => {
    /* ---- 第一步：造层，看清楚 textItem 里到底有什么 ---- */
    await app.createDocument({ width: 400, height: 300, resolution: 72, name: TMPDOC });
    const layer = await app.activeDocument.createTextLayer({ contents: TEXT });
    out.created = !!layer;

    try {
      out.domKindOfCreated = String(layer.kind);
    } catch (e) {
      out.domKindOfCreated = "ERR:" + errText(e);
    }

    const ti = layer.textItem;
    out.textItem = ti ? "存在" : "不存在";

    if (ti) {
      try {
        out.itemProps = Object.keys(ti).join(",") || "(空)";
      } catch {
        out.itemProps = "(取不到 keys)";
      }

      const cs = ti.characterStyle;
      out.characterStyle = cs ? "存在" : "不存在";

      if (cs) {
        try {
          out.csProps = Object.keys(cs).join(",") || "(空)";
        } catch {
          out.csProps = "(取不到 keys)";
        }
        try {
          out.csSizeBefore = String(cs.size);
        } catch (e) {
          out.csSizeBefore = "ERR:" + errText(e);
        }
        try {
          out.csFont = String(cs.font);
        } catch (e) {
          out.csFont = "ERR:" + errText(e);
        }

        // 候选写法 1：characterStyle.size
        try {
          cs.size = 72;
          out.csSizeAfter = String(cs.size);
        } catch (e) {
          out.csSizeAfter = "ERR:" + errText(e);
        }
        out.psAfterCsSize = await readPsTextKey();
      }

      // 候选写法 2：textItem.fontSize（如果 1 没生效再试这个）
      if (String(out.psAfterCsSize).indexOf("72") < 0) {
        try {
          ti.fontSize = 72;
          out.tiFontSize = String(ti.fontSize);
        } catch (e) {
          out.tiFontSize = "ERR:" + errText(e);
        }
        out.psAfterTiFontSize = await readPsTextKey();
      }
    }
  }, "probe B：DOM 文本能力");

  const psCs = String(out.psAfterCsSize);
  const psTi = String(out.psAfterTiFontSize);

  // ⚠️ 判据必须对准 PS 实际吐出来的形态：size 不是数字，而是
  //    "size":{"_unit":"pointsUnit","_value":72}
  //    第一版写成 /"size":72/ 于是把成功判成了失败（假阴性）。
  const SIZE_OK = /"size"\s*:\s*\{[^}]*"_value"\s*:\s*72/;
  out.sizeApplied = SIZE_OK.test(psCs) || SIZE_OK.test(psTi);

  return out;
}

/* ================================================================ 主流程 */

/**
 * 跑完整套探针。
 * @param {{appendLog?: Function}} opts 由 index.js 传入的日志函数（可选）
 * @returns {Promise<Array>} results
 */
async function run(opts) {
  const appendLog = (opts && opts.appendLog) || (async () => {});

  const results = [];
  const stamp = new Date().toString();
  let makeWinner = null;

  if (await hasDone()) {
    await appendLog("probe  已跑过（probe-text.done 在），跳过。要重跑就删掉该文件。");
    return results;
  }

  await appendLog("probe  开始：文本图层写法矩阵（A 轮造层 / B 轮 DOM 能力）");

  await cleanupTempDocs();

  /* ---------------------------------------------------- A 轮：造层 */

  for (const v of MAKE_VARIANTS) {
    let detail = "";
    let error = "";
    let ok = false;

    try {
      await runModal(async () => {
        await app.createDocument({ width: 400, height: 300, resolution: 72, name: TMPDOC });
      }, "probe A：新建临时文档");

      try {
        await runModal(() => v.build(), "probe A：" + v.name);
      } catch (e) {
        error = errText(e);
      }

      let info = { name: "?", psdKind: "?", domKind: "?", layers: 0 };
      try {
        info = await runModal(() => readTopLayer(), "probe A：读回图层");
      } catch (e) {
        error = (error ? error + " | " : "") + "读回失败 " + errText(e);
      }

      ok = isTextKind(info.psdKind) || isTextKind(info.domKind);
      detail =
        "层名=" + info.name +
        "  layerKind=" + info.psdKind +
        "  domKind=" + info.domKind +
        "  图层数=" + info.layers;
      if (info.name === TEXT && !ok) {
        detail += "   ← 名称对了、类型是普通层（1）—— 正是用户报的现象";
      }
      if (ok && !makeWinner) makeWinner = v;
    } catch (e) {
      error = errText(e);
      detail = "未能完成（见错误）";
    }

    results.push({ name: v.name, ok: ok, detail: detail, error: error });
    await appendLog(
      "probe A " + (ok ? "PASS" : "FAIL") + "  " + v.name + "  " + detail + (error ? "  err=" + error : "")
    );

    await cleanupTempDocs();
  }

  await appendLog("probe  A 轮结束：可用写法 = " + (makeWinner ? makeWinner.name : "无（全部失败）"));

  /* ---------------------------------------------------- 交叉验证 */

  if (makeWinner) {
    let evidence = {};
    try {
      await runModal(async () => {
        await app.createDocument({ width: 400, height: 300, resolution: 72, name: TMPDOC });
        await makeWinner.build();
        evidence = await deepInspect();
      }, "probe：交叉验证");
      results.push({
        name: "交叉验证：A4 造出的层到底是不是文本层",
        ok: isTextKind(evidence.domKind) || String(evidence.constLayerKind).indexOf("TEXT=3") >= 0,
        detail:
          "domKind=" + evidence.domKind +
          "  " + evidence.constLayerKind +
          "  " + evidence.hasTextKey +
          "  textItem=" + evidence.textItem,
        error: ""
      });
      await appendLog("probe  交叉验证  " + JSON.stringify(evidence));
    } catch (e) {
      results.push({
        name: "交叉验证：A4 造出的层到底是不是文本层",
        ok: false,
        detail: "未能完成",
        error: errText(e)
      });
    }
    await cleanupTempDocs();
  }

  /* ---------------------------------------------------- B 轮：DOM 能力 */

  let dom = null;
  try {
    dom = await probeDomTextCapabilities();
    results.push({
      name: "B1 DOM 字号：textItem.characterStyle.size = 72",
      ok: dom.sizeApplied === true,
      detail:
        "textItem=" + dom.textItem + " [" + dom.itemProps + "]" +
        "  characterStyle=" + dom.characterStyle + " [" + dom.csProps + "]" +
        "  字号 " + dom.csSizeBefore + " → " + dom.csSizeAfter +
        "  字体=" + dom.csFont +
        "  PS 回读：" + String(dom.psAfterCsSize).slice(0, 260),
      error: ""
    });
    await appendLog("probe B " + (dom.sizeApplied ? "PASS" : "FAIL") + "  DOM 字号  " + JSON.stringify(dom));
  } catch (e) {
    results.push({
      name: "B1 DOM 文本能力：createTextLayer → textItem.fontSize",
      ok: false,
      detail: "未能完成",
      error: errText(e)
    });
    await appendLog("probe B FAIL  " + errText(e));
  }

  await cleanupTempDocs();

  /* ---------------------------------------------------- 落盘 + 结论 */

  const pass = results.filter((r) => r.ok).length;

  await writeReport({
    plugin: "com.wooozxh.helloworld / probe-text",
    version: "1.0.0",
    at: stamp,
    ok: pass === results.length && results.length > 0,
    summary: {
      makeWinner: makeWinner ? makeWinner.name : null,
      pass: pass,
      total: results.length
    },
    results: results
  });

  const lines = [];
  lines.push("文本图层写法探针 · " + stamp);
  lines.push("A 轮可用写法：" + (makeWinner ? makeWinner.name : "无"));
  lines.push("通过 " + pass + "/" + results.length);
  lines.push("");
  for (const r of results) {
    lines.push((r.ok ? "[PASS] " : "[FAIL] ") + r.name);
    if (r.detail) lines.push("        " + r.detail);
    if (r.error) lines.push("        错误：" + r.error);
  }
  await writeLog("probe-text.log", lines.join("\n") + "\n");

  await appendLog("probe  结束：通过 " + pass + "/" + results.length + "  报告已写入 report.json / probe-text.log");

  const marked = await markDone(
    "probe-text v1.0.0\n" + stamp + "\n通过 " + pass + "/" + results.length + "\n"
  );
  await appendLog("probe  盖章 probe-text.done → " + marked);

  return results;
}

module.exports = { run: run };
