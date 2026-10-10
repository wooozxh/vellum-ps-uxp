/*
 * Link Probe —— UXP 插件侧「与本地服务联动」能力探针
 * ===========================================================================
 * 这不是业务插件（业务插件尚未开工），是**能力验证探针**：在真正给 VellumDesk
 * 加联动服务之前，先用真实 PS + UXP 跑一遍，把三件事问清楚：
 *
 *   1. 插件能不能 fetch 本地 HTTP 服务的 JSON？
 *   2. 插件能不能显示本地服务 / 本地磁盘上的图片？（缩略图是素材库的命脉）
 *   3. 插件能不能用 WebSocket 收「服务器主动推送」？（"实时更新"的命脉）
 *
 * 配套服务：tools/linkprobe/server.mjs（本地 127.0.0.1:8799）。
 * 结论写进 PluginData：report.json（结构化，给脚本读）+ boot.log（流水）。
 *
 * 纪律（继承自 hello-world / hello-uxp）：
 *   - UXP 里引宿主模块只能 require()，不能 import。
 *   - 反馈只走文件：console.log 外部读不到。
 *   - 每一项都带超时与原始错误捕获 —— 宁可记下 raw 错误，也不要猜。
 *
 * 加载即自动跑一遍；面板上的按钮可手动重跑。
 */

const { entrypoints, storage } = require("uxp");

const PLUGIN_ID = "com.wooozxh.linkprobe";
const HOST = "127.0.0.1:8799";
const BASE = "http://" + HOST;
const WS_URL = "ws://" + HOST + "/ws";
const REPORT_NAME = "report.json";
const LOG_NAME = "boot.log";

/** @type {{name:string, ok:boolean, detail:string}[]} */
const results = [];

/* ------------------------------------------------------------------ 小工具 */

function el(id) {
  return document.getElementById(id);
}

function esc(s) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  );
}

function msg(e) {
  return e && e.message ? e.message : String(e);
}

/** 记一条结论 + 立即重绘面板。 */
function rec(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: String(detail) });
  render();
}

function render() {
  const box = el("results");
  if (box) {
    box.innerHTML = results
      .map(
        (r) =>
          '<div class="row"><span class="badge ' + (r.ok ? "ok" : "no") + '">' +
          (r.ok ? "PASS" : "FAIL") + '</span><span>' + esc(r.name) + "</span></div>" +
          '<div class="det">' + esc(r.detail) + "</div>"
      )
      .join("");
  }
  const sum = el("summary");
  if (sum) {
    const okc = results.filter((r) => r.ok).length;
    sum.textContent = "小计 " + okc + " / " + results.length;
  }
}

/** 追加一行到 PluginData/boot.log（外部脚本的读取通道）。 */
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
    await file.write(prev + stamp() + "  " + line + "\n");
  } catch {
    /* 日志失败不打断探针 */
  }
}

/* ------------------------------------------------------------ 单项能力测试 */

/** 1) fetch 本地 HTTP JSON */
async function tFetchJson() {
  if (typeof fetch !== "function") {
    rec("HTTP fetch 本地 JSON", false, "运行环境没有 fetch");
    return;
  }
  try {
    const res = await fetch(BASE + "/api/list");
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    const n = data && Array.isArray(data.items) ? data.items.length : "?";
    rec(
      "HTTP fetch 本地 JSON",
      res.ok && n !== "?",
      "status=" + res.status + " bytes=" + text.length + " items=" + n
    );
  } catch (e) {
    rec("HTTP fetch 本地 JSON", false, "ERR " + msg(e));
  }
}

/** 造一个 <img> 测某 src 能否加载出来。 */
function loadImg(src, ms) {
  return new Promise((resolve) => {
    let done = false;
    const img = document.createElement("img");
    const fin = (ok, detail) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ ok: ok, detail: detail });
    };
    const t = setTimeout(() => fin(false, "超时（" + ms + "ms）"), ms);
    img.onload = () =>
      fin(true, "naturalWidth=" + img.naturalWidth + " naturalHeight=" + img.naturalHeight);
    img.onerror = () => fin(false, "onerror（图片未能加载）");
    try {
      img.src = src;
    } catch (e) {
      fin(false, "throw " + msg(e));
    }
    const sink = el("sink");
    if (sink) sink.appendChild(img);
  });
}

/** 2) <img> 直连 HTTP 图片 */
async function tHttpImg() {
  const r = await loadImg(BASE + "/img/test.png", 6000);
  rec("HTTP 图片（<img> 直连）", r.ok, r.detail);
}

/** 3) fetch → blob → objectURL → <img> */
async function tBlobImg() {
  if (typeof fetch !== "function") {
    rec("HTTP 图片（fetch→blob→objectURL）", false, "无 fetch");
    return;
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    rec("HTTP 图片（fetch→blob→objectURL）", false, "无 URL.createObjectURL");
    return;
  }
  try {
    const res = await fetch(BASE + "/img/test.png");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const r = await loadImg(url, 6000);
    rec("HTTP 图片（fetch→blob→objectURL）", r.ok, "blob=" + blob.size + "B " + r.detail);
  } catch (e) {
    rec("HTTP 图片（fetch→blob→objectURL）", false, "ERR " + msg(e));
  }
}

/** 3b) 内嵌 data:URL 图片 —— 与网络无关的对照项：
 *  若它也超时，说明卡在"渲染"而不是"网络"。 */
async function tDataImg() {
  const url =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const r = await loadImg(url, 4000);
  rec("内嵌图片（data: URL，对照项）", r.ok, r.detail);
}

/** 4) WebSocket 连接 + 收服务器主动推送 */
function tWs() {
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined") {
      rec("WebSocket 连接 + 收推送", false, "运行环境没有 WebSocket");
      return resolve();
    }
    let settled = false;
    let opened = false;
    const fin = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      rec("WebSocket 连接 + 收推送", ok, detail);
      resolve();
    };
    const t = setTimeout(
      () => fin(false, "超时（opened=" + opened + "，6s 内未收到推送）"),
      7000
    );
    try {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        opened = true;
      };
      ws.onmessage = (evt) => {
        fin(true, "已连接并收到推送：" + String(evt.data).slice(0, 100));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onerror = (e) => fin(false, "onerror " + (e && e.data ? e.data : ""));
      ws.onclose = () => {
        if (!settled) fin(false, "连接被关闭（opened=" + opened + "）");
      };
    } catch (e) {
      fin(false, "throw " + msg(e));
    }
  });
}

/** 5) 本地磁盘图片（file:// 直接给 <img>） —— 对应"直读工作区"路线 */
async function tDiskImg() {
  try {
    const folder = await storage.localFileSystem.getPluginFolder();
    const np = folder.nativePath;
    if (!np) {
      rec("本地磁盘图片（file:// <img>）", false, "拿不到插件目录 nativePath");
      return;
    }
    const url = "file:///" + String(np).replace(/\\/g, "/").replace(/^\//, "") + "/sample/disk-test.png";
    const r = await loadImg(url, 5000);
    rec("本地磁盘图片（file:// <img>）", r.ok, "url=" + url + " → " + r.detail);
  } catch (e) {
    rec("本地磁盘图片（file:// <img>）", false, "ERR " + msg(e));
  }
}

/* ---------------------------------------------------------------- 汇总写盘 */

async function writeReport() {
  const okc = results.filter((r) => r.ok).length;
  const payload = {
    plugin: PLUGIN_ID,
    version: "1.0.0",
    ranAt: new Date().toISOString(),
    base: BASE,
    ws: WS_URL,
    uxp: uxpVer(),
    env: {
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      panelEl: !!el("sink"),
      bodyChildren: document.body ? document.body.childElementCount : -1
    },
    summary: okc + "/" + results.length,
    results: results
  };
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    let f;
    try {
      f = await folder.getEntry(REPORT_NAME);
    } catch {
      f = await folder.createFile(REPORT_NAME, { overwrite: true });
    }
    await f.write(JSON.stringify(payload, null, 2));
  } catch (e) {
    await appendLog("probe  report 写入失败 " + msg(e));
  }
  for (const r of results) {
    await appendLog("probe  " + (r.ok ? "PASS" : "FAIL") + "  " + r.name + "  " + r.detail);
  }
  await appendLog("probe   小计 " + okc + "/" + results.length);
}

async function runAll() {
  results.length = 0;
  render();
  await appendLog("probe  开始（host=" + HOST + "）");
  await tFetchJson();
  await tHttpImg();
  await tDataImg();
  await tBlobImg();
  await tWs();
  await tDiskImg();
  await writeReport();
}

/* ------------------------------------------------------------------ UI/入口 */

let bound = false;
function bindUI() {
  if (bound) return;
  const b = el("btnRun");
  if (b) {
    b.addEventListener("click", () => {
      runAll();
    });
    bound = true;
  }
  render();
}

function uxpVer() {
  try {
    return require("uxp").versions.uxp || "?";
  } catch {
    return "?";
  }
}

function boot() {
  bindUI();
  runAll();
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
    linkProbePanel: {
      create() {
        bindUI();
      },
      show() {
        bindUI();
      }
    }
  }
});
