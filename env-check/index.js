/*
 * Vellum 环境体检（env-check）
 * ===========================================================================
 * 这不是业务插件，是**跨机器能力采集器**。
 *
 * 为什么需要它：开发机是本机 PS 2026（UXP 9.0.2），但同事有 PS 2024 / 2025，
 * 而那些版本的真实 UXP 行为**不可能在本机复现**。于是做一个"同事点一下就能
 * 出报告"的插件，把"我猜"变成"数据"。
 *
 * 它测什么（六组）：
 *   A 运行时与宿主 —— UXP 版本、宿主名/版本（三路交叉）、平台、sandbox 路径（含 PS 大版本号）
 *   B 核心 API      —— executeAsModal / DOM 对象图 / batchPlay 只读 / 写自身 PluginData
 *   C 版本差异项    —— DOM createTextLayer（新路）vs batchPlay make+textKey（老路）
 *   D 调色板地基    —— 读/设前景、背景色（batchPlay 多 target 写法 + DOM）
 *   E UI 组件       —— <input type="color">、内置 sp-* 组件可用性
 *   F 其他          —— fetch / WebSocket 是否存在（路线 ③ 的可选性）
 *
 * 纪律（继承自 hello-world / hello-uxp / link-probe）：
 *   - 引宿主模块只能 require()，不能 import。
 *   - 反馈只走文件：console.log 外部读不到 → 写 report.json + boot.log。
 *   - 每一项都捕获**原始错误**，不吞、不猜。
 *   - 改文档必须包在 core.executeAsModal() 里。
 *
 * ⚠️ 安全红线（来自 docs/04 的血泪教训）：
 *   绝不对"非文本层"发带 textKey 的 `set textLayer` —— 那会让 PS 弹**原生模态框**，
 *   阻塞整个 executeAsModal。本插件只做 `make`（安全），绝不做后续的 `set`。
 *
 * ⚠️ 副作用与安全策略：
 *   - C 组在**临时文档**上跑，跑完立即关闭，不污染用户工作区。
 *   - D 组会改「前景/背景色」→ **仅在能读到原值时才改**（否则无法恢复，宁可不测）。
 *     读到原值 → 设新值 → 回读比对 → **立即恢复原值**。
 *
 * ---------------------------------------------------------------------------
 * 2026-10-10 首轮实跑暴露的问题（已在本版修正，留档以免后人再踩）：
 *   1. batchPlay 的 `_target` 若只写 `[{_property:"x"}]`，PS 会返回**整份 application
 *      对象**，取 `res[0].x` 得到 undefined → 看起来像"功能不支持"，实为写法错。
 *      **正确写法**：`[{_property:"x"}, {_ref:"application", _enum:"ordinal", _value:"targetEnum"}]`。
 *   2. DOM `app.foregroundColor = {red,green,blue}` 抛 `reading 'desc'` ——
 *      setter **不收裸对象**，要传 SolidColor（拿现有 `app.foregroundColor` 改属性再赋值）。
 *   3. 判据假阳性：`app.version` 返回 `undefined` 也算 PASS；UXP **没有 `customElements`**，
 *      所以不能用它判定 `sp-*` 是否注册 —— 改用"与已知未知标签对比"的办法。
 * ---------------------------------------------------------------------------
 */

const photoshop = require("photoshop");
const uxp = require("uxp");

const { app, core, action } = photoshop;
const { entrypoints, storage } = uxp;

const lfs = storage.localFileSystem;

// ⚠️ 必须与 manifest.json 的 id 一致
const PLUGIN_ID = "com.wooozxh.envcheck";
const PLUGIN_VERSION = "1.0.0";
const REPORT_NAME = "report.json";
const LOG_NAME = "boot.log";

/** @type {{group:string,name:string,ok:boolean,detail:string}[]} */
const results = [];
/** 最近一次报告对象（供「另存报告」用） */
let lastReport = null;

/* ==================================================================== 工具 */

function el(id) {
  return document.getElementById(id);
}

function msg(e) {
  return e && e.message ? e.message : String(e);
}

function esc(s) {
  const m = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => m[c]);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

function nowIso() {
  return new Date().toISOString();
}

/** 安全 JSON 短串（回读值原样呈现，不美化判断）。 */
function short(o) {
  if (o === undefined) return "undefined";
  try {
    return JSON.stringify(o);
  } catch {
    return String(o);
  }
}

/** 截断长串（batchPlay 有时会甩出整份 application 对象）。 */
function shortMax(o, n) {
  const s = short(o);
  return s.length > n ? s.slice(0, n) + " …(共 " + s.length + " 字符)" : s;
}

/** 记一条结论 + 立即重绘。 */
function rec(group, name, ok, detail) {
  results.push({ group: group, name: name, ok: !!ok, detail: detail == null ? "" : String(detail) });
  render();
}

function render() {
  const list = el("list");
  if (list) {
    let html = "";
    let g = null;
    for (const r of results) {
      if (r.group !== g) {
        html += '<div class="grp">' + esc(r.group) + "</div>";
        g = r.group;
      }
      html +=
        '<div class="item ' + (r.ok ? "ok" : "no") + '">' +
        '<div class="n">' + (r.ok ? "✓" : "✗") + " " + esc(r.name) + "</div>" +
        (r.detail ? '<div class="d">' + esc(r.detail) + "</div>" : "") +
        "</div>";
    }
    list.innerHTML = html;
  }
  const sum = el("sum");
  if (sum) {
    const okc = results.filter((r) => r.ok).length;
    sum.textContent = "小计 " + okc + " / " + results.length;
  }
}

function setRaw(text) {
  const box = el("raw");
  if (box) box.textContent = text;
}

/** 追加一行到 PluginData/boot.log（外部脚本的读取通道）。 */
async function appendLog(line) {
  try {
    const folder = await lfs.getDataFolder();
    let f;
    try {
      f = await folder.getEntry(LOG_NAME);
    } catch {
      f = await folder.createFile(LOG_NAME, { overwrite: true });
    }
    let prev = "";
    try {
      prev = await f.read();
    } catch {
      prev = "";
    }
    await f.write(prev + stamp() + "  " + line + "\n");
  } catch {
    /* 日志失败不打断体检 */
  }
}

function runModal(fn, name) {
  return core.executeAsModal(fn, { commandName: name });
}

function uxpVer() {
  try {
    return (uxp.versions && uxp.versions.uxp) || "未暴露";
  } catch (e) {
    return "读取失败:" + msg(e);
  }
}

function pluginRuntime() {
  try {
    return (uxp.versions && uxp.versions.plugin) || "未暴露";
  } catch (e) {
    return "读取失败:" + msg(e);
  }
}

/** 标准"当前 application"目标（独立 _ref），可复用于任何 app 级属性读写。 */
function appRef() {
  return { _ref: "application", _enum: "ordinal", _value: "targetEnum" };
}

/* ============================================================ A 运行时与宿主 */

async function pVersions() {
  const u = uxpVer();
  rec("A 运行时与宿主", "UXP 运行时版本 ★", u !== "未暴露" && !/失败/.test(u),
      "UXP = " + u + "\n插件运行时 = " + pluginRuntime() + "\n插件自身版本 = " + PLUGIN_VERSION);

  // 宿主信息：uxp.host 是最可靠的来源（官方在 _warning 里也这么劝告）
  let hn = "?", hv = "?", loc = "?";
  try { hn = uxp.host && uxp.host.name; } catch (e) { hn = "读取失败:" + msg(e); }
  try { hv = uxp.host && uxp.host.version; } catch (e) { hv = "读取失败:" + msg(e); }
  try { loc = uxp.host && uxp.host.uiLocale; } catch { loc = "?"; }
  const hostOk = !!hv && hv !== "?" && !/失败/.test(String(hv));
  rec("A 运行时与宿主", "宿主应用 uxp.host ★", hostOk,
      "name = " + hn + "\nversion = " + hv + "\nuiLocale = " + loc);

  // DOM 侧读 app.version（docs/04 记载本版本可能拿不到 → 严格判据）
  let domV;
  try {
    domV = app.version;
  } catch (e) {
    domV = "抛异常: " + msg(e);
  }
  const domOk = domV !== undefined && domV !== null && !/抛异常/.test(String(domV));
  rec("A 运行时与宿主", "photoshop.app.version（DOM）", domOk, "值 = " + short(domV));

  // batchPlay 侧读 application.version（用**标准 _target**）
  let bpV;
  try {
    await runModal(async () => {
      const res = await action.batchPlay(
        [{ _obj: "get", _target: [{ _property: "version" }, appRef()] }],
        {}
      );
      bpV = res && res[0] ? res[0].version : undefined;
    }, "env-check: 读 application.version");
  } catch (e) {
    bpV = "抛异常: " + msg(e);
  }
  rec("A 运行时与宿主", "batchPlay 读 application.version",
      bpV !== undefined && bpV !== null && !/抛异常/.test(String(bpV)),
      "值 = " + shortMax(bpV, 200));

  rec("A 运行时与宿主", "平台信息", true,
      "platform = " + navigator.platform + "\nuserAgent = " + navigator.userAgent);
}

async function pPaths() {
  let pf = "?", df = "?";
  try { pf = (await lfs.getPluginFolder()).nativePath; } catch (e) { pf = "失败:" + msg(e); }
  try { df = (await lfs.getDataFolder()).nativePath; } catch (e) { df = "失败:" + msg(e); }

  // 从路径里检出 PS 大版本号（PHSP\<数字>\）—— 联动契约 §7.1 关心的就是这个
  const m = /[\\/]PHSP[\\/](\d+)[\\/]/i.exec(String(df)) || /[\\/]PHSP[\\/](\d+)[\\/]/i.exec(String(pf));
  rec("A 运行时与宿主", "sandbox 路径（含 PS 大版本号）", !/失败/.test(pf) && !/失败/.test(df),
      "插件目录 = " + pf + "\n数据目录 = " + df + "\n检出 PS 大版本号 = " + (m ? m[1] : "未检出"));
}

/* ============================================================== B 核心 API */

async function pModal() {
  let executed = false;
  await runModal(async () => { executed = true; }, "env-check: 模态自检");
  rec("B 核心 API", "executeAsModal（模态作用域）", executed,
      executed ? "模态事务可正常开启与提交" : "回调未被执行");
}

async function pDom() {
  let cnt = "?";
  try {
    cnt = app.documents.length;
  } catch (e) {
    cnt = "抛异常:" + msg(e);
  }
  rec("B 核心 API", "DOM 对象图（app.documents.length）", typeof cnt === "number",
      "返回 = " + String(cnt) + "（当前文档数）");
}

async function pBatchPlay() {
  let n;
  let err = null;
  try {
    await runModal(async () => {
      const res = await action.batchPlay(
        [{ _obj: "get", _target: [{ _property: "numberOfDocuments" }, appRef()] }],
        {}
      );
      n = res && res[0] ? res[0].numberOfDocuments : undefined;
    }, "env-check: batchPlay 读文档数");
  } catch (e) {
    err = msg(e);
  }
  rec("B 核心 API", "batchPlay 只读（numberOfDocuments）",
      err === null && n !== undefined && n !== null,
      err ? "抛异常: " + err : "返回 = " + short(n));
}

async function pDataWrite() {
  try {
    const folder = await lfs.getDataFolder();
    const f = await folder.createFile("write-test.txt", { overwrite: true });
    await f.write("ok " + nowIso());
    const back = await f.read();
    rec("B 核心 API", "写自身 PluginData（M2 镜像通道地基）", String(back).indexOf("ok ") === 0,
        "写入并回读成功：" + String(back).slice(0, 60));
  } catch (e) {
    rec("B 核心 API", "写自身 PluginData（M2 镜像通道地基）", false, "抛异常: " + msg(e));
  }
}

/* ========================================================== C 版本差异项 */

function readTopLayer() {
  try {
    const layers = app.activeDocument.layers;
    const l = layers && layers[0];
    if (!l) return { kind: null, name: null };
    return { kind: l.kind, name: l.name };
  } catch (e) {
    return { kind: "读取失败:" + msg(e), name: null };
  }
}

async function pTextLayers() {
  let created = false;
  try {
    await runModal(async () => {
      await app.createDocument({ width: 320, height: 240, resolution: 72, name: "EnvCheck-temp" });
    }, "env-check: 建临时文档");
    created = true;
  } catch (e) {
    rec("C 版本差异项", "DOM createTextLayer（新路）", false, "无法建临时文档：" + msg(e));
    rec("C 版本差异项", "batchPlay make+textKey（老路）", false, "无法建临时文档：" + msg(e));
    return;
  }

  try {
    // --- C1: DOM createTextLayer（docs/04 认定这是 2026 下唯一可行写法）
    try {
      let ret = null;
      await runModal(async () => {
        ret = await app.activeDocument.createTextLayer({ contents: "EnvCheck-DOM" });
      }, "env-check: DOM 建文本层");
      let info = readTopLayer();
      if (ret && ret.kind) info = { kind: ret.kind, name: ret.name };
      const ok = String(info.kind) === "text";
      rec("C 版本差异项", "DOM createTextLayer（新路）", ok,
          "kind = " + String(info.kind) + "（\"text\" 才算成立）\nname = " + String(info.name));
    } catch (e) {
      rec("C 版本差异项", "DOM createTextLayer（新路）", false, "抛异常: " + msg(e));
    }

    // --- C2: batchPlay make + textKey（老路；只 make，绝不 set，见文件头红线）
    try {
      await runModal(async () => {
        await action.batchPlay(
          [{
            _obj: "make",
            _target: [{ _ref: "layer" }],
            using: { _obj: "layer", name: "EnvCheck-BP", textKey: "EnvCheck-BP" }
          }],
          {}
        );
      }, "env-check: batchPlay 建文本层");
      const info = readTopLayer();

      let layerKind;
      try {
        await runModal(async () => {
          const res = await action.batchPlay(
            [{
              _obj: "get",
              _target: [
                { _property: "layerKind" },
                { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
              ]
            }],
            {}
          );
          layerKind = res && res[0] ? res[0].layerKind : undefined;
        }, "env-check: 读 layerKind");
      } catch (e) {
        layerKind = "读取失败:" + msg(e);
      }

      const isText = String(info.kind) === "text" || layerKind === 3;
      rec("C 版本差异项", "batchPlay make+textKey（老路）", isText,
          "DOM kind = " + String(info.kind) + "   batchPlay layerKind = " + short(layerKind) +
          "\nname = " + String(info.name) +
          "\n（2026 上老路只建普通层：kind=pixel / layerKind=1 —— 本项 FAIL 属预期）");
    } catch (e) {
      rec("C 版本差异项", "batchPlay make+textKey（老路）", false, "抛异常: " + msg(e));
    }
  } finally {
    if (created) {
      try {
        await runModal(async () => { await app.activeDocument.closeWithoutSaving(); },
                       "env-check: 关临时文档");
      } catch {
        /* 关不掉也不阻断 */
      }
    }
  }
}

/* ============================================================ D 调色板地基 */

/** 前景/背景色可用的 _target 写法（按"标准写法优先"排列）。 */
function colorTargets(prop) {
  return [
    { t: "[prop, appRef]", target: [{ _property: prop }, appRef()] },
    { t: "[appRef, prop]", target: [appRef(), { _property: prop }] },
    { t: "[ref:color]", target: [{ _ref: "color", _property: prop }] },
    { t: "[prop]", target: [{ _property: prop }] }
  ];
}

function extractRGB(c) {
  if (!c || typeof c !== "object") return null;
  const r = c.red;
  const g = c.grain != null ? c.grain : c.green;
  const b = c.blue;
  if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }
  return null;
}

function rgbHit(raw, r, g, b) {
  const e = extractRGB(raw);
  return !!e && e.r === r && e.g === g && e.b === b;
}

/** 读色：遍历 target 写法，返回第一个真正取到值的。 */
async function bpGetColor(prop) {
  const notes = [];
  for (const tg of colorTargets(prop)) {
    try {
      let raw;
      await runModal(async () => {
        const res = await action.batchPlay([{ _obj: "get", _target: tg.target }], {});
        raw = res && res[0] ? res[0][prop] : undefined;
      }, "env-check: 读 " + prop);
      if (raw !== undefined && raw !== null) {
        return { ok: true, raw: raw, target: tg, note: notes.concat(tg.t + " → " + short(raw)).join("\n") };
      }
      notes.push(tg.t + " → undefined");
    } catch (e) {
      notes.push(tg.t + " → 抛异常 " + msg(e));
    }
  }
  return { ok: false, raw: null, target: null, note: notes.join("\n") };
}

/**
 * 设色：遍历「target 写法 × 颜色键名」。
 * ⚠️ 命中判据必须同时满足两条：
 *   ① 回读值等于目标色；② 回读值**不等于设置前的值**。
 *   只判 ① 会假阳性 —— 若测试色恰好等于当前色，"没设上"也会被当成"设上了"（首轮实测踩到）。
 * 返回 winner（真正生效的 target），供恢复时使用（**恢复不能用"读"的 target**）。
 */
async function bpSetColor(prop, rgb, beforeRaw) {
  const colors = [
    { k: "grain", to: { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b } },
    { k: "green", to: { _obj: "RGBColor", red: rgb.r, green: rgb.g, blue: rgb.b } }
  ];
  const notes = [];
  for (const tg of colorTargets(prop)) {
    for (const c of colors) {
      const label = "target=" + tg.t + " colorKey=" + c.k;
      try {
        await runModal(async () => {
          await action.batchPlay([{ _obj: "set", _target: tg.target, to: c.to }], {});
        }, "env-check: set " + prop);
        const back = await bpGetColor(prop);
        const same = back.ok && rgbHit(back.raw, rgb.r, rgb.g, rgb.b);
        const changed = back.ok && short(back.raw) !== short(beforeRaw);
        if (same && changed) {
          notes.push(label + " → 回读 " + short(back.raw) + "  ✓命中（且值确实变了）");
          return { ok: true, detail: notes.join("\n"), winner: tg };
        }
        notes.push(label + " → 回读 " + short(back.raw) +
                   (same ? "  ✗值未变（可能未生效）" : "  ✗未命中"));
      } catch (e) {
        notes.push(label + " → 抛异常 " + msg(e));
      }
    }
  }
  return { ok: false, detail: notes.join("\n"), winner: null };
}

/** 恢复：优先用生效过的 target，再兜底遍历所有写法，并以**回读校验**收口。 */
async function restoreColor(prop, raw, winner) {
  if (raw === null || raw === undefined) return { ok: false, raw: null, via: "无原值可恢复" };
  const tries = [];
  if (winner) tries.push(winner);
  for (const tg of colorTargets(prop)) {
    if (!winner || tg.t !== winner.t) tries.push(tg);
  }
  for (const tg of tries) {
    try {
      await runModal(async () => {
        await action.batchPlay([{ _obj: "set", _target: tg.target, to: raw }], {});
      }, "env-check: 恢复 " + prop);
    } catch {
      continue;
    }
    const back = await bpGetColor(prop);
    if (back.ok && short(back.raw) === short(raw)) return { ok: true, raw: back.raw, via: tg.t };
  }
  const back = await bpGetColor(prop);
  return { ok: false, raw: back.ok ? back.raw : "读不到", via: null };
}

async function pColors() {
  // 测试色刻意选"不太可能与当前色重合"的值，配合上面的"值必须改变"判据
  const T_FG = { r: 17, g: 137, b: 211 };
  const T_BG = { r: 211, g: 17, b: 137 };

  // ---------- D1/D2: 读（先解决"读得到"才有资格谈"设"与"恢复"）----------
  const fg0 = await bpGetColor("foregroundColor");
  rec("D 调色板地基", "batchPlay 读「前景色」", fg0.ok, fg0.note);
  const bg0 = await bpGetColor("backgroundColor");
  rec("D 调色板地基", "batchPlay 读「背景色」", bg0.ok, bg0.note);

  if (!fg0.ok || !bg0.ok) {
    // 安全策略：读不到原值 = 无法恢复 = 不测"设色"，避免把用户的前景/背景色改坏
    rec("D 调色板地基", "batchPlay 设「前景色」★", false,
        "**跳过**：读不到原值，无法安全恢复，故不执行设置（避免污染用户前景/背景色）");
    rec("D 调色板地基", "batchPlay 设「背景色」★", false, "**跳过**：同上");
    rec("D 调色板地基", "DOM app.foregroundColor（SolidColor）", false, "**跳过**：读不到原值");
    return;
  }

  // ---------- D3/D4: 设前景 / 背景色 ----------
  const setFg = await bpSetColor("foregroundColor", T_FG, fg0.raw);
  rec("D 调色板地基", "batchPlay 设「前景色」★", setFg.ok, setFg.detail);

  const setBg = await bpSetColor("backgroundColor", T_BG, bg0.raw);
  rec("D 调色板地基", "batchPlay 设「背景色」★", setBg.ok, setBg.detail);

  // ---------- D5: DOM 设前景色（需 SolidColor，不能给裸对象）----------
  try {
    await runModal(async () => {
      const c = app.foregroundColor;   // 拿一个 SolidColor 实例
      c.rgb.red = 34; c.rgb.green = 12; c.rgb.blue = 200;
      app.foregroundColor = c;
    }, "env-check: DOM 设前景色");
    const back = await bpGetColor("foregroundColor");
    const hit = back.ok && rgbHit(back.raw, 34, 12, 200);
    rec("D 调色板地基", "DOM app.foregroundColor（SolidColor）", hit,
        "回读 = " + short(back.raw) + (hit ? "  ✓" : "  ✗") +
        "\n（裸对象 {red,green,blue} 会抛 reading 'desc'，见文件头）");
  } catch (e) {
    rec("D 调色板地基", "DOM app.foregroundColor（SolidColor）", false, "抛异常: " + msg(e));
  }

  // ---------- D6: 统一恢复（放在所有改色之后）并回读校验 ----------
  const rFg = await restoreColor("foregroundColor", fg0.raw, setFg.winner);
  const rBg = await restoreColor("backgroundColor", bg0.raw, setBg.winner);
  rec("D 调色板地基", "前景 / 背景色已恢复原值", rFg.ok && rBg.ok,
      "前景：原 " + short(fg0.raw) + "\n      → 恢复后 " + short(rFg.raw) +
      "（经 target " + String(rFg.via) + "）" +
      "\n背景：原 " + short(bg0.raw) + "\n      → 恢复后 " + short(rBg.raw) +
      "（经 target " + String(rBg.via) + "）");
}

/* ============================================================== E UI 组件 */

function pColorInput() {
  try {
    const inp = document.createElement("input");
    inp.type = "color";
    const t = inp.type;
    const v = inp.value;
    // 浏览器里 color input 的 value 默认是 "#000000"；为 null/undefined 说明实现不完整
    const hasHex = typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
    rec("E UI 组件", '<input type="color"> 取色控件', t === "color" && hasHex,
        "el.type = " + short(t) + "   el.value = " + short(v) +
        "\n（value 应为 \"#rrggbb\"；为 null 说明实现不完整 → M1 调色板不应依赖它）");
  } catch (e) {
    rec("E UI 组件", '<input type="color"> 取色控件', false, "抛异常: " + msg(e));
  }
}

function pSpComponents() {
  const tags = ["sp-button", "sp-textfield", "sp-textarea", "sp-picker", "sp-dropdown",
                "sp-slider", "sp-checkbox", "sp-radio", "sp-label", "sp-divider"];

  // UXP 没有 customElements（首轮实测），所以改用"与已知未知标签对比"的判据：
  // 若某 tag 的元素与一个绝对不存在的 tag 的元素是同类，则它也没被注册。
  // UXP 里自定义元素的 constructor.name 是空串，只能拿 String(constructor) 当指纹。
  // ⚠️ 必须用**完整串**比对：不同控件的前缀都一样（都是 "class extends r{constructor..."），
  // 截断过（首版截 48 字符）会导致 sp-textfield 被误判为"未知标签"。显示时才做精简。
  function ctorSrc(tag) {
    try {
      const e = document.createElement(tag);
      const c = e && e.constructor;
      if (!c) return "no-constructor";
      return c.name || String(c);
    } catch (e) {
      return "抛异常:" + msg(e);
    }
  }
  const unknownSrc = ctorSrc("definitely-not-a-real-tag-xyz");

  const supportedTags = [];
  const lines = [];
  for (const tag of tags) {
    const src = ctorSrc(tag);
    const ok = src !== unknownSrc && !/抛异常/.test(src) && src !== "no-constructor";
    if (ok) supportedTags.push(tag);
    lines.push(tag + (ok ? " ✓" : " ✗"));
  }
  rec("E UI 组件", "内置 Spectrum 组件 sp-*", supportedTags.length > 0,
      supportedTags.length + " / " + tags.length + " 已注册（判据：其 constructor 与「绝对不存在的标签」不同）\n" +
      "可用：" + (supportedTags.join(", ") || "（无）") + "\n" +
      "明细：" + lines.join("   "));
}

/* ================================================================ F 其他 */

function pNetwork() {
  rec("F 其他", "fetch / WebSocket 是否存在", true,
      "typeof fetch = " + typeof fetch + "\ntypeof WebSocket = " + typeof WebSocket +
      "\n（仅告知：路线 ③「本地联动服务」在旧版的可选性）");
}

/* ============================================================== 汇总与落盘 */

function buildRawText(report, reportPath, writeErr) {
  const lines = [];
  lines.push("Vellum 环境体检 · 报告");
  lines.push("时间：" + report.ranAt + "    小计：" + report.summary +
             "    耗时：" + report.durationMs + "ms");
  lines.push("UXP：" + report.env.uxp + "    插件运行时：" + report.env.pluginRuntime);
  lines.push("");
  let g = null;
  for (const r of report.results) {
    if (r.group !== g) { lines.push("── " + r.group + " ──"); g = r.group; }
    lines.push("[" + (r.ok ? "PASS" : "FAIL") + "] " + r.name);
    if (r.detail) r.detail.split("\n").forEach((l) => lines.push("       " + l));
  }
  lines.push("");
  lines.push(reportPath ? "report.json 已写入：\n" + reportPath
                        : "report.json 写入失败：" + writeErr);
  lines.push("");
  lines.push("→ 点「另存报告…」可保存到桌面再回传。");
  return lines.join("\n");
}

async function runAll(trigger) {
  results.length = 0;
  lastReport = null;
  render();
  setRaw("正在体检…");
  await appendLog("env-check  开始（trigger=" + trigger + "  uxp=" + uxpVer() + "）");

  const t0 = Date.now();

  await pVersions();
  await pPaths();
  await pModal();
  await pDom();
  await pBatchPlay();
  await pDataWrite();
  await pTextLayers();
  await pColors();
  pColorInput();
  pSpComponents();
  pNetwork();

  const okc = results.filter((r) => r.ok).length;
  lastReport = {
    plugin: PLUGIN_ID,
    version: PLUGIN_VERSION,
    ranAt: nowIso(),
    trigger: trigger,
    summary: okc + "/" + results.length,
    durationMs: Date.now() - t0,
    env: { uxp: uxpVer(), pluginRuntime: pluginRuntime() },
    results: results
  };

  let reportPath = null, writeErr = null;
  try {
    const folder = await lfs.getDataFolder();
    let f;
    try { f = await folder.getEntry(REPORT_NAME); }
    catch { f = await folder.createFile(REPORT_NAME, { overwrite: true }); }
    await f.write(JSON.stringify(lastReport, null, 2));
    reportPath = f.nativePath;
  } catch (e) {
    writeErr = msg(e);
  }

  setRaw(buildRawText(lastReport, reportPath, writeErr));
  await appendLog("env-check  小计 " + lastReport.summary + "  dur=" + lastReport.durationMs + "ms");
  return lastReport;
}

/** 「另存报告…」：弹系统保存框（需要 manifest 的 localFileSystem: "request"）。 */
async function saveReport() {
  if (!lastReport) { setRaw("请先运行一次体检。"); return; }
  try {
    const f = await lfs.getFileForSaving("env-check-report.json", { types: ["json"] });
    if (!f) { setRaw("已取消保存。"); return; }
    await f.write(JSON.stringify(lastReport, null, 2));
    setRaw("报告已另存：\n" + f.nativePath + "\n\n" + buildRawText(lastReport, null, null));
    await appendLog("env-check  另存报告 → " + f.nativePath);
  } catch (e) {
    setRaw("另存失败：" + msg(e) +
           "\n\n（仍可从插件数据目录手工取 report.json，路径见上方）");
  }
}

/* ================================================================== UI/入口 */

let bound = false;
function bindUI() {
  if (bound) return;
  const b = el("btnRun");
  if (b) b.addEventListener("click", () => { runAll("button"); });
  const s = el("btnSave");
  if (s) s.addEventListener("click", () => { saveReport(); });
  bound = true;
  render();
}

function boot() {
  bindUI();
  runAll("load");
}

entrypoints.setup({
  plugin: {
    async create() {
      await appendLog("loaded  plugin=" + PLUGIN_ID + "  uxp=" + uxpVer());
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
      } else {
        boot();
      }
    }
  },
  panels: {
    envCheckPanel: {
      create() { bindUI(); },
      show() { bindUI(); }
    }
  },
  commands: {
    envCheckCommand: {
      async run() { await runAll("command"); }
    }
  }
});
