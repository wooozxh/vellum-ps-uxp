/*
 * Hello World —— 第一个 Photoshop UXP 插件
 * ===========================================================================
 * 这不是环境探针（探针是 hello-uxp 的职责），而是一个「最小但完整」的插件：
 *   1. 演示一个插件该怎么写（manifest v5 / 模态 / batchPlay / 双入口）
 *   2. 让你亲手对比 Command（菜单命令，点完即走）与 Panel（常驻面板）两种形态
 *   3. 作为后续真正产品的骨架起点
 *
 * 两个入口属于**同一个插件、共用这份代码**：
 *   Panel    → Photoshop「窗口 > 插件」里的常驻面板
 *   Command  → Photoshop「插件 / 增效工具」菜单里的一项，点完直接执行、无需面板
 *
 * 关于 boot.log（日志通道）：
 *   UXP 跑在 Photoshop 进程里，console.log 只有调试窗口能看到，外部脚本读不到。
 *   所以这里把「关键事件」追加写到插件自己的数据目录 boot.log：
 *     插件加载 / 每次执行插入动作（含触发来源）
 *   于是「你点了按钮 → AI 能读到」这条反馈通道就成立了。
 *   位置：%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.wooozxh.helloworld\PluginData\boot.log
 *
 * UXP 硬约束（改这份代码前务必知道）：
 *   - 不是浏览器、也不是 Node：引宿主模块只能 require()，不能用 import。
 *   - 所有会修改文档的操作必须包在 core.executeAsModal() 内，否则报「模态被占用」。
 *   - DOM API 覆盖不到的动作，走 action.batchPlay() 发 ActionDescriptor。
 */

const photoshop = require("photoshop");
const { entrypoints, storage } = require("uxp");

const { app, core, action } = photoshop;
const batchPlay = action.batchPlay;

/** ⚠️ 必须与 manifest.json 的 id 保持一致（两者任一改动都要同步另一处）。 */
const PLUGIN_ID = "com.wooozxh.helloworld";

/** 要插入到画布上的文字。 */
const TEXT = "Hello World";

/** 日志文件名（落在插件自己的 PluginData 目录）。 */
const LOG_NAME = "boot.log";

/* =================================================================== 工具 */

let statusEl = null;

function setStatus(text) {
  if (!statusEl) statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = String(text);
  console.log("[" + PLUGIN_ID + "] " + text);
}

/** 修改文档必须走模态作用域。 */
function runModal(fn, commandName) {
  return core.executeAsModal(fn, { commandName: commandName });
}

/** 像素/分辨率可能是 number，也可能是带单位的对象，统一成可读文本。 */
function toPx(v) {
  if (v === null || v === undefined) return "?";
  if (typeof v === "number") return String(Math.round(v));
  if (typeof v === "object" && typeof v.value === "number") {
    return String(Math.round(v.value));
  }
  return String(v);
}

function escapeHtml(s) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

/**
 * 追加一行到插件数据目录的 boot.log。
 * 这是「插件 → 外部脚本」的唯一反馈通道，失败也不该影响主流程，所以全程吞异常。
 */
async function appendLog(line) {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    let file;
    try {
      file = await folder.getEntry(LOG_NAME);
    } catch {
      file = await folder.createFile(LOG_NAME, { overwrite: true });
    }
    let prev = "";
    try {
      prev = await file.read();
    } catch {
      prev = "";
    }
    await file.write(prev + timestamp() + "  " + line + "\n");
  } catch {
    /* 日志失败不打断功能 */
  }
}

/* =============================================================== 业务动作 */

/** 只读：读当前文档的基本信息。不修改任何东西，所以不需要模态。 */
function readDocument() {
  const doc = app.activeDocument;
  if (!doc) return { has: false };

  let mode = "";
  try {
    mode = String(doc.mode || "");
  } catch {
    mode = "";
  }

  return {
    has: true,
    name: doc.name,
    width: toPx(doc.width),
    height: toPx(doc.height),
    resolution: toPx(doc.resolution),
    mode: mode,
    layers: doc.layers.length
  };
}

/** 把文档信息渲染到面板的卡片里。 */
function renderDocument() {
  const d = readDocument();
  const el = document.getElementById("docInfo");
  if (!el) return d;

  if (!d.has) {
    el.innerHTML =
      '<span class="k">当前没有打开的文档</span><br>' +
      '<span class="k">点上面的按钮会先帮你新建一个再插入。</span>';
    return d;
  }

  el.innerHTML =
    '<div><span class="k">文档　</span>' + escapeHtml(d.name) + "</div>" +
    '<div><span class="k">尺寸　</span>' + d.width + " × " + d.height + " px" +
    '<span class="k">　分辨率　</span>' + d.resolution + "</div>" +
    '<div><span class="k">图层　</span>' + d.layers + " 个" +
    (d.mode ? '<span class="k">　模式　</span>' + escapeHtml(d.mode) : "") +
    "</div>";

  return d;
}

/**
 * 建文字图层。
 * insertHelloWorld（正式流程）与 selfVerify（开发期自检）共用这一份 descriptor，
 * 避免两处各写一份、改一处漏一处。
 */
async function makeTextLayer() {
  // 1) 建文字图层
  await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "layer" }],
        using: { _obj: "layer", name: TEXT, textKey: TEXT },
        _options: { dialogOptions: "dontDisplay" }
      }
    ],
    {}
  );

  // 2) 润色：把字号调大，否则默认 12pt 在白底上几乎看不见。
  //    这一步是可选的，失败也不该影响主流程，所以单独 try 掉。
  try {
    await batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
          to: {
            _obj: "textLayer",
            textKey: TEXT,
            textStyleRange: [
              {
                _obj: "textStyleRange",
                from: 0,
                to: TEXT.length,
                textStyle: {
                  _obj: "textStyle",
                  size: { _unit: "pointsUnit", _value: 72 }
                }
              }
            ]
          },
          _options: { dialogOptions: "dontDisplay" }
        }
      ],
      {}
    );
  } catch {
    /* 字号没设上也照样算成功，状态里会说明 */
  }
}

/** 插件目录下是否存在某个文件（用于开关开发期自检）。 */
async function hasFlag(name) {
  try {
    const folder = await storage.localFileSystem.getPluginFolder();
    await folder.getEntry(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * 开发期自检 —— 由插件目录下的 verify.flag 控制，默认关闭。
 * 做一次真实但无痕的演练：新建临时文档 → 插入文字图层 → 读回验证 → 关掉。
 * 目的：在「用户点按钮」之前，先确认这批 batchPlay descriptor 在当前 PS 版本上
 * 真的成立。结论写进 boot.log，于是外部脚本能读到。
 */
async function selfVerify() {
  let ok = false;
  let detail = "";
  try {
    await runModal(async () => {
      await app.createDocument({
        width: 640,
        height: 400,
        resolution: 72,
        name: "HW-verify"
      });
      await makeTextLayer();
    }, "Hello World 自检：临时文档 + 文字图层");

    const names = Array.from(app.activeDocument.layers).map((l) => l.name);
    ok = names.indexOf(TEXT) >= 0;
    detail = "layers=" + JSON.stringify(names);

    await runModal(async () => {
      await app.activeDocument.closeWithoutSaving();
    }, "Hello World 自检：关闭临时文档");
    detail += "  cleaned=yes";
  } catch (e) {
    detail = "FAILED " + (e && e.message ? e.message : String(e));
  }
  await appendLog("selfverify  ok=" + ok + "  " + detail);
  return ok;
}

/**
 * 核心动作：在当前文档插入一个内容为 “Hello World” 的文字图层。
 * 若一个文档都没打开，先新建一个 1200×800 的画布。
 * @returns {Promise<boolean>} 是否顺带新建了文档
 */
async function insertHelloWorld() {
  let createdDoc = false;

  await runModal(async () => {
    if (app.documents.length === 0) {
      await app.createDocument({
        width: 1200,
        height: 800,
        resolution: 72,
        name: "Hello World"
      });
      createdDoc = true;
    }

    await makeTextLayer();
  }, "Hello World：插入文字图层");

  return createdDoc;
}

/** 「插入」按钮 / 菜单命令共用的执行体。who 用于区分触发来源。 */
async function actionInsert(who) {
  setStatus("正在插入文字图层…（触发来源：" + who + "）");
  try {
    const created = await insertHelloWorld();
    const d = renderDocument();
    await appendLog(
      "insert  via=" + who +
        "  doc=" + (d.has ? d.name : "-") +
        "  layers=" + (d.has ? d.layers : "-") +
        (created ? "  createdDoc=yes" : "")
    );
    setStatus(
      "✓ 已插入「" + TEXT + "」文字图层\n" +
        (created ? "（当时没有打开的文档，已先新建 1200×800）\n" : "") +
        "当前文档：" + (d.has ? d.name : "?") +
        "　图层：" + (d.has ? d.layers : "?") + " 个"
    );
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await appendLog("insert  via=" + who + "  FAILED  " + msg);
    setStatus("✗ 插入失败：" + msg);
  }
}

/* ===================================================================== UI */

let uiBound = false;

function bindUI() {
  if (uiBound) return;

  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", fn);
      return true;
    }
    return false;
  };

  let count = 0;
  if (on("btnInsert", () => actionInsert("panel"))) count++;
  if (
    on("btnRefresh", () => {
      const d = renderDocument();
      setStatus(d.has ? "✓ 文档信息已刷新" : "当前没有打开的文档。");
    })
  ) {
    count++;
  }
  if (on("btnGreet", () => app.showAlert("Hello World —— 来自你的第一个 Photoshop 插件"))) {
    count++;
  }

  if (count > 0) uiBound = true;
  renderDocument();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}

/* ================================================================ 入口点 */

entrypoints.setup({
  plugin: {
    async create() {
      // 「插件真的被加载并执行了代码」这件事，必须留下可被外部读到的凭证
      await appendLog("loaded  plugin=" + PLUGIN_ID + "  uxp=" + safeUxpVersion());
      // 开发期自检：插件目录下存在 verify.flag 时跑一次无痕演练（默认关闭，删掉即关）
      if (await hasFlag("verify.flag")) await selfVerify();
    }
  },
  panels: {
    helloWorldPanel: {
      create() {
        bindUI();
      },
      show() {
        bindUI();
      }
    }
  },
  commands: {
    insertHelloWorld: {
      async run() {
        await actionInsert("command");
      }
    }
  }
});

function safeUxpVersion() {
  try {
    return require("uxp").versions.uxp || "?";
  } catch {
    return "?";
  }
}
