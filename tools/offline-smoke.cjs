/*
 * tools/offline-smoke.cjs —— 离线结构回归（不需要 Photoshop）
 * ===========================================================================
 * 为什么有它：真机装载一次成本高（要开 PS、装插件、点面板）。而「外壳渲染出的
 * DOM 结构，和自检脚本依赖的选择器是否一致」这件事，**在 Node 里就能验**。
 * 这一层挡掉的正是最烦的一类错：自检跑完一堆 FAIL，其实只是 id/class 改了名。
 *
 * 用最小 DOM mock + 假 uxp / photoshop，把插件真跑一遍：
 *   · lib/icons.js       所有图标能建出命名空间正确的 SVG
 *   · index.js（外壳）   init() → 首页列表 / 顶栏环境 / 主题 class
 *   · 外壳 → 工具        合成点击首页「调色板」行 → 调色板挂载
 *   · tools/palette.js   色块网格 / fgbg 卡片 / hover 浮层 / 设色回读链路
 *
 * ⚠️ 它能证明的：**结构与选择器一致性 + 事件处理器能跑通**（自检脚本能否命中）
 * ⚠️ 它不能证明的：CSS 渲染效果、batchPlay 真实行为、真机主题、滚动与布局
 *    —— 那些只能靠真机自检（lib/selfcheck.js）。二者互补，不能互相替代。
 *
 * 用法：node tools/offline-smoke.cjs
 */

const path = require("path");
const fs = require("fs");
const Module = require("module");

const PKG = path.join(__dirname, "..", "vellum-toolbox");
const WANT_PREVIEW = process.argv.indexOf("--preview") >= 0;

/* ==================================================================
 * 一、最小 DOM
 * ================================================================== */

const byId = Object.create(null);

function parseSimple(sel) {
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(String(sel).trim());
  if (!m) return null;
  const spec = { tag: m[1] ? m[1].toUpperCase() : null, id: null, classes: [] };
  for (const p of m[2] ? m[2].match(/[.#][\w-]+/g) || [] : []) {
    if (p[0] === ".") spec.classes.push(p.slice(1));
    else spec.id = p.slice(1);
  }
  return spec;
}

function matchesSel(el, spec) {
  if (!spec || !el || !el._classes) return false;
  if (spec.tag && el.tagName !== spec.tag) return false;
  if (spec.id && el.attrs.id !== spec.id) return false;
  for (const c of spec.classes) if (!el._classes.has(c)) return false;
  return true;
}

class TextNode {
  constructor(t) {
    this._text = String(t);
    this.childNodes = [];
    this.parentNode = null;
    this.isText = true;
  }
  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = String(v);
  }
}

class El {
  constructor(tag, ns) {
    this._tag = String(tag);
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns || null;
    this.attrs = Object.create(null);
    this.childNodes = [];
    this.parentNode = null;
    this._text = "";
    this._classes = new Set();
    this._listeners = Object.create(null);
    this._style = { setProperty(k, v) { this[k] = v; }, getPropertyValue() { return ""; } };
    const self = this;
    this.classList = {
      add() { for (const c of arguments) self._classes.add(c); },
      remove() { for (const c of arguments) self._classes.delete(c); },
      contains(c) { return self._classes.has(c); },
      toggle(c, on) {
        const want = on === undefined ? !self._classes.has(c) : !!on;
        if (want) self._classes.add(c); else self._classes.delete(c);
        return want;
      },
    };
  }
  get children() { return this.childNodes.filter((c) => !c.isText); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get style() { return this._style; }
  get className() { return Array.from(this._classes).join(" "); }
  set className(v) { this._classes = new Set(String(v || "").split(/\s+/).filter(Boolean)); }
  get textContent() {
    let s = this._text || "";
    for (const c of this.childNodes) s += c.textContent;
    return s;
  }
  set textContent(v) {
    this._text = String(v);
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
  }
  setAttribute(k, v) {
    const key = String(k);
    const val = String(v);
    if (key === "class") { this.className = val; return; }
    if (key === "id") byId[val] = this;
    this.attrs[key] = val;
  }
  getAttribute(k) {
    if (k === "class") return this.className;
    return this.attrs[String(k)] === undefined ? null : this.attrs[String(k)];
  }
  appendChild(c) {
    if (!c) throw new Error("appendChild(null)");
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error("removeChild: 不是子节点");
    this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this._listeners[type];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = this;
    const run = (node) => {
      const a = node._listeners && node._listeners[ev.type];
      if (a) for (const fn of a.slice()) fn.call(node, ev);
      if (ev.bubbles && node.parentNode) run(node.parentNode);
    };
    run(this);
    return true;
  }
  closest(sel) {
    const spec = parseSimple(sel);
    let n = this;
    while (n && n._classes) {
      if (matchesSel(n, spec)) return n;
      n = n.parentNode;
    }
    return null;
  }
  _walk(out) {
    for (const c of this.childNodes) {
      if (c.isText) continue;
      out.push(c);
      c._walk(out);
    }
    return out;
  }
  querySelectorAll(sel) {
    const spec = parseSimple(sel);
    return this._walk([]).filter((e) => matchesSel(e, spec));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

const documentElement = new El("html");
const head = new El("head");
const body = new El("body");
documentElement.appendChild(head);
documentElement.appendChild(body);
byId.html = documentElement;

global.document = {
  readyState: "complete",
  documentElement: documentElement,
  head: head,
  body: body,
  createElement: (t) => new El(t),
  createElementNS: (ns, t) => new El(t, ns),
  createTextNode: (t) => new TextNode(t),
  getElementById: (id) => byId[id] || null,
  querySelector: (s) => documentElement.querySelector(s),
  querySelectorAll: (s) => documentElement.querySelectorAll(s),
  addEventListener() {},
  removeEventListener() {},
};

global.window = {
  matchMedia: () => ({
    matches: true, // 假装深色主题
    addEventListener() {},
    addListener() {},
  }),
};

global.navigator = { platform: "Win32" };

global.getComputedStyle = () => ({
  getPropertyValue: () => "",
  getPropertyValue2: () => "",
});

global.Event = class Event {
  constructor(type, opts) {
    this.type = type;
    this.bubbles = !!(opts && opts.bubbles);
    this.cancelable = !!(opts && opts.cancelable);
    this.target = null;
  }
  preventDefault() {}
  stopPropagation() {}
};

/* ==================================================================
 * 二、假 uxp / photoshop
 * ================================================================== */

/* 最小文件树：键是 "a/b/file" 形式的路径，目录由前缀推出来。
   v0.2.7 起支持子目录 —— M2 素材库要读 `library/manifest.json`、
   写 `library/handoff/req.json`，根目录一个 mockFolder 已经不够用了。 */
const files = Object.create(null);
const dirs = Object.create(null);

function makeFile(full) {
  return {
    nativePath: "C:/fake/PluginData/" + full,
    async read() {
      return files[full];
    },
    async write(t) {
      files[full] = String(t);
    },
    async delete() {
      delete files[full];
    },
  };
}

function makeFolder(prefix) {
  return {
    nativePath: "C:/fake/PluginData" + (prefix ? "/" + prefix : ""),
    async getEntry(name) {
      const full = prefix ? prefix + "/" + name : name;
      if (dirs[full]) return makeFolder(full);
      if (full in files) return makeFile(full);
      throw new Error("ENOENT " + full);
    },
    async createFolder(name) {
      const full = prefix ? prefix + "/" + name : name;
      dirs[full] = true;
      return makeFolder(full);
    },
    async createFile(name, opts) {
      const full = prefix ? prefix + "/" + name : name;
      if (!(full in files) || (opts && opts.overwrite)) files[full] = "";
      return makeFile(full);
    },
  };
}

const mockFolder = makeFolder("");

const mockUxp = {
  storage: {
    localFileSystem: {
      getDataFolder: async () => mockFolder,
      getPluginFolder: async () => mockFolder,
      // v0.2.7：置入要把 Entry 换成 batchPlay 认的会话令牌
      createSessionToken: async (entry) =>
        "token:" + (entry && entry.nativePath ? entry.nativePath : "?"),
      getEntryWithUrl: async () => {
        throw new Error("offline mock：不模拟沙箱外读取");
      },
    },
  },
  host: { name: "Photoshop", version: "26.1.0", uiLocale: "zh_CN" },
  versions: { uxp: "9.0.2", plugin: "2.0.0" },
  entrypoints: { setup() {} },
};

// 初始色取设计稿的值，让预览里的 fgbg 卡片好看（不影响任何断言）
const colorState = {
  foregroundColor: { red: 0x2f, grain: 0x8f, blue: 0xe0 }, // #2F8FE0
  backgroundColor: { red: 255, grain: 255, blue: 255 }, // #FFFFFF
};

/* v0.2.2：记下所有 fill 命令，供「Alt+左键 = 填充」这条链路做断言。
   ⚠️ 断言 15 之前 documents 必须为空 —— 调色板要能对"没开文档"给出可读拒绝。
   v0.2.3：再加一个 sentCalls 记**全部**命令 —— 因为新逻辑要断言"内容图层上
   **一条 fill 都不许发**"（那正是用户真机上那个 PS 弹框的来源）。 */
const fillCalls = [];
const sentCalls = [];
const fakeDoc = {
  id: 101,
  name: "假文档",
  mode: "RGB",
  activeLayers: [{ id: 201, name: "图层 1", kind: "pixel" }],
};

const mockApp = {
  documents: [],
  version: "26.1.0",
};
Object.defineProperty(mockApp, "activeDocument", {
  get() {
    return mockApp.documents[0] || null;
  },
});

const mockPhotoshop = {
  app: mockApp,
  core: { executeAsModal: async (fn) => fn() },
  action: {
    async batchPlay(cmds) {
      const c = cmds[0];
      sentCalls.push(c);
      if (c._obj === "fill") {
        fillCalls.push(c);
        return [];
      }
      const t0 = c._target && c._target[0];
      const prop = t0 && t0._property;
      if (c._obj === "get") return [{ [prop]: colorState[prop] }];
      // ⚠️ 只有**颜色槽**（foregroundColor / backgroundColor）的 set 才算改色槽；
      //    内容图层那种 set、以及 v0.2.4 文字图层那种 `_property:"textStyle"` 的 set，
      //    都**不能**污染 colorState（否则后面的断言会读到被串味的前景色）。
      if (c._obj === "set" && (prop === "foregroundColor" || prop === "backgroundColor")) {
        colorState[prop] = c.to;
        return [];
      }
      return [];
    },
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "uxp") return mockUxp;
  if (request === "photoshop") return mockPhotoshop;
  return origLoad.apply(this, arguments);
};

/* ==================================================================
 * 三、按 index.html 的结构铺一份外壳骨架
 * ================================================================== */

function seedShell() {
  const app = new El("div");
  app.setAttribute("id", "vt-app");
  const mk = (tag, id, cls) => {
    const e = new El(tag);
    if (id) e.setAttribute("id", id);
    if (cls) e.setAttribute("class", cls);
    return e;
  };
  app.appendChild(mk("div", null, "brandbar"));
  const bar = mk("header", "vt-bar", "bar");
  // v0.2.1：返回键是 div[role=button]（不是 <button>）；右侧「⋯」已合并进 chip
  const back = mk("div", "vt-back", "back is-off");
  back.setAttribute("role", "button");
  bar.appendChild(back);
  const logo = mk("img", "vt-logo", "bar-logo");
  logo.setAttribute("src", "icons/logo-mark.png");
  bar.appendChild(logo);
  bar.appendChild(mk("span", "vt-title", "bar-title"));
  bar.appendChild(mk("span", "vt-sub", "bar-sub"));
  bar.appendChild(mk("span", null, "grow"));
  const chip = mk("div", "vt-chip", "bar-chip");
  chip.setAttribute("role", "button");
  chip.appendChild(mk("i", "vt-led", "led"));
  chip.appendChild(mk("span", "vt-env", "mono"));
  bar.appendChild(chip);
  app.appendChild(bar);
  const scroll = mk("div", "vt-body", "scroll");
  scroll.appendChild(mk("section", "vt-home", "screen active"));
  scroll.appendChild(mk("section", "vt-tool-view", "screen"));
  app.appendChild(scroll);
  app.appendChild(mk("div", "vt-status", "statusbar"));
  body.appendChild(app);
}

/* ==================================================================
 * 四、断言
 * ================================================================== */

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || "" });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ==================================================================
 * 四点五、把 mock DOM 序列化成 HTML（生成浏览器预览用）
 *
 * 关键：预览用的是**同一份渲染代码**产出的 DOM，不是照着实现手抄的一份
 * —— 所以它不会和真实界面走偏。
 * ================================================================== */

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function styleToString(el) {
  const parts = [];
  if (el.attrs && el.attrs.style) parts.push(String(el.attrs.style).replace(/;?$/, ";"));
  const st = el._style || {};
  for (const k of Object.keys(st)) {
    if (typeof st[k] === "function") continue;
    parts.push(k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) + ":" + st[k]);
  }
  return parts.join(";");
}

function serialize(node) {
  if (!node) return "";
  if (node.isText) return escapeHtml(node._text);
  let a = "";
  const cls = node.className;
  if (cls) a += ' class="' + escapeHtml(cls) + '"';
  if (node.attrs && node.attrs.id) a += ' id="' + escapeHtml(node.attrs.id) + '"';
  const st = styleToString(node);
  if (st) a += ' style="' + escapeHtml(st) + '"';
  // ⚠️ 其余属性一个都不能漏 —— SVG 的 viewBox / d / cx / stroke 全在这里，
  //    漏了预览里的图标就会变成空框。
  for (const k of Object.keys(node.attrs || {})) {
    if (k === "class" || k === "id" || k === "style") continue;
    a += " " + k + '="' + escapeHtml(node.attrs[k]) + '"';
  }
  const tag = node._tag;
  // SVG 用自闭合更稳妥（path/rect/circle 没有子节点）
  if (node.childNodes.length === 0 && node.namespaceURI) return "<" + tag + a + "/>";
  return "<" + tag + a + ">" + node.childNodes.map(serialize).join("") + "</" + tag + ">";
}

function buildPreviewHtml(homeHtml, paletteHtml, meta) {
  const src = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
  const m = /<style>([\s\S]*?)<\/style>/.exec(src);
  const pluginCss = m ? m[1] : "";
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    "<title>Vellum 工具箱 · 方向 B 落地预览</title>",
    "<style>" + pluginCss + "</style>",
    "<style>",
    "  html, body { height: auto; }",
    "  body { margin:0; padding:26px; background:#1b1b1b; color:#e6e6e6;",
    '    font-family: system-ui,"Segoe UI","Microsoft YaHei",sans-serif;',
    "    display:flex; gap:22px; align-items:flex-start; }",
    "  .pv-slot { flex:0 0 auto; }",
    "  .pv-cap { margin:0 0 9px 3px; font-size:12px; color:#8a8a8a; }",
    "  .pv-panel { width:420px; height:680px; overflow:hidden;",
    "    border:1px solid #111; border-radius:6px; position:relative; }",
    "  .pv-foot { position:fixed; left:26px; bottom:18px; font-size:11px; color:#5f5f5f; }",
    "</style></head>",
    "<body>",
    '  <div class="pv-slot"><p class="pv-cap">① 外壳 · 功能选择</p><div class="pv-panel">' + homeHtml + "</div></div>",
    '  <div class="pv-slot"><p class="pv-cap">② 调色板</p><div class="pv-panel">' + paletteHtml + "</div></div>",
    '  <div class="pv-foot">' + escapeHtml(meta) + "</div>",
    "</body></html>",
    "",
  ].join("\n");
}

async function main() {
  seedShell();

  const icons = require(path.join(PKG, "lib", "icons.js"));

  /* ---- 1. 图标系统 ---- */
  const NS = "http://www.w3.org/2000/svg";
  const iconNames = icons.names();
  const badIcons = iconNames.filter((n) => {
    const node = icons.svg(n);
    return !node || node.namespaceURI !== NS || node.childNodes.length === 0;
  });
  check(
    "1 图标系统：全部图标建出命名空间正确的 SVG",
    badIcons.length === 0 && iconNames.length > 0,
    iconNames.length + " 个图标，异常 " + badIcons.length + (badIcons.length ? "：" + badIcons.join(",") : "")
  );

  /* ---- 1b. 图标绘制属性：UXP 不做继承 → 逐元素必须自带 fill/stroke ----
     这是 v0.2.1 修的「hero 变黑方块 / 返回箭头与色块 ✕ 看不见」的根因判据。 */
  const noPaint = [];
  for (const n of iconNames) {
    const node = icons.svg(n);
    if (!node) continue;
    const nodes = [node];
    for (const c of node.childNodes) nodes.push(c);
    for (const el of nodes) {
      const f = el.getAttribute ? el.getAttribute("fill") : null;
      const s = el.getAttribute ? el.getAttribute("stroke") : null;
      if (f === null || f === undefined || s === null || s === undefined) {
        noPaint.push(n + "/" + String(el.tagName || "?").toLowerCase());
        break;
      }
    }
  }
  check(
    "1b 图标逐元素自带 fill/stroke（否则真机渲染成黑块 / 看不见）",
    noPaint.length === 0,
    "缺属性 " + noPaint.length + (noPaint.length ? "：" + noPaint.slice(0, 8).join(" ") : "（全部齐全）")
  );

  /* ---- 2. 外壳 init ---- */
  require(path.join(PKG, "index.js"));
  await sleep(200);

  const home = document.getElementById("vt-home");
  const navs = home ? home.querySelectorAll(".navitem") : [];
  check(
    "2 外壳 init：首页渲染出 4 个功能入口",
    navs.length === 4,
    "导航行 " + navs.length + "（期望 4：调色板 / 素材库 / 表格生成 / AI-MCP）"
  );

  const rowTitles = Array.prototype.map
    .call(navs, (n) => {
      const nm = n.querySelector(".ni-name");
      return nm ? nm.textContent : "?";
    })
    .join(" / ");
  check(
    "2b 四项名称正确且带号位 chip（↑1…↑4）",
    rowTitles === "调色板 / 素材库 / 表格生成 / AI-MCP" &&
      (home ? home.querySelectorAll(".ni-key").length : 0) === 4,
    "名称 = " + rowTitles + "　号位 chip = " + (home ? home.querySelectorAll(".ni-key").length : 0)
  );

  const hero = home ? home.querySelector(".hero-mark") : null;
  const heroTag = hero ? String(hero.tagName || "").toUpperCase() : "无";
  check(
    "3 首页 hero：品牌标用透明 PNG（IMG + src）",
    heroTag === "IMG" && !!hero.getAttribute("src"),
    "hero-mark 标签 = " + heroTag + "　src = " + (hero ? hero.getAttribute("src") : "-")
  );

  /* ---- 3b. 功能行结构：图标 + 名称 + 描述 + 号位 + 箭头 ---- */
  const r0 = navs.length ? navs[0] : null;
  const ico0 = r0 ? r0.querySelector(".ni-ico") : null;
  const nm0 = r0 ? r0.querySelector(".ni-name") : null;
  const ds0 = r0 ? r0.querySelector(".ni-desc") : null;
  const ky0 = r0 ? r0.querySelector(".ni-key") : null;
  const ar0 = r0 ? r0.querySelector(".ni-arrow") : null;
  check(
    "3b 功能行结构：图标 + 名称 + 描述 + 号位 + 箭头",
    !!(ico0 && ico0.querySelectorAll("svg").length === 1 && nm0 && ds0 && ky0 && ar0),
    "图标 svg=" + (ico0 ? ico0.querySelectorAll("svg").length : 0) +
      "　名称=" + (nm0 ? nm0.textContent : "-") +
      "　描述=" + (ds0 ? ds0.textContent : "-") +
      "　号位=" + (ky0 ? ky0.textContent : "-") +
      "　箭头=" + (ar0 ? "有" : "无")
  );

  /* ---- 3c. 布局纪律：页面内不再用 <button> ----
     真机上 button 不吃 display:flex 且强制 text-align:center —— 这是之前
     「首页文字居中 / 顶栏圆点压字」的成因。全部改用 div[role=button]。 */
  const btns = home ? home.querySelectorAll("button") : [];
  const docBtns = document ? document.querySelectorAll("button") : [];
  check(
    "3c 布局纪律：不使用 <button> 承载布局",
    btns.length === 0 && docBtns.length === 0,
    "首页 button = " + btns.length + "　整页 button = " + docBtns.length
  );

  const env = document.getElementById("vt-env");
  check(
    "4 顶栏环境 chip：显示 Photoshop 版本",
    !!env && env.textContent.indexOf("PS") >= 0,
    'env 文本 = ' + JSON.stringify(env ? env.textContent : null)
  );

  const themeCls = String(documentElement.className || "");
  check(
    "5 主题令牌：<html> 已挂 vt-dark / vt-light",
    /vt-dark|vt-light/.test(themeCls),
    "className = " + JSON.stringify(themeCls)
  );

  // 抓首页快照（赶在切到调色板之前）—— 供生成浏览器预览
  const homeSnapshot = serialize(document.getElementById("vt-app"));

  /* ---- 6. 外壳 → 调色板（合成点击首页行） ---- */
  const paletteRow = navs.find((n) => n.getAttribute("data-tool") === "palette");
  check("6 首页导航行带 data-tool 路由键", !!paletteRow, paletteRow ? "找到 data-tool=palette" : "未找到");

  if (paletteRow) {
    paletteRow.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await sleep(200);
  }

  const view = document.getElementById("vt-tool-view");
  const viewActive = view && view._classes.has("active");
  const homeActive = home && home._classes.has("active");
  check(
    "7 外壳 → 工具：视图切换到调色板",
    viewActive && !homeActive,
    "view.active=" + viewActive + "　home.active=" + homeActive
  );

  /* ---- 8. 自检依赖的选择器全部命中 ---- */
  const ids = ["vt-brand-grid", "vt-custom-grid", "vt-save-current", "vt-custom-empty"];
  const missing = ids.filter((id) => !document.getElementById(id));
  check(
    "8 自检依赖的 id 全部存在（S1/S5/S6 的选择器）",
    missing.length === 0,
    missing.length ? "缺失：" + missing.join(",") : ids.join(" / ") + " 全在"
  );

  const brandGrid = document.getElementById("vt-brand-grid");
  check(
    "9 品牌色网格：6 个色块且各自带背景色",
    !!brandGrid && brandGrid.children.length === 6 &&
      brandGrid.children.every((c) => /background-color:/i.test(String(c.attrs.style || ""))),
    brandGrid ? "色块数 = " + brandGrid.children.length + "，样式样例 = " + brandGrid.children[0].attrs.style : "网格不存在"
  );

  const customGrid = document.getElementById("vt-custom-grid");
  const delBtns = customGrid ? customGrid.querySelectorAll(".sw-del") : [];
  check(
    "10 「我的颜色」空态：网格为空 + 空态提示可见",
    !!customGrid && customGrid.children.length === 0 &&
      (document.getElementById("vt-custom-empty").style.display || "block") !== "none",
    "网格子项 = " + (customGrid ? customGrid.children.length : "?") +
      "　删除按钮 = " + delBtns.length + "（空态应为 0）"
  );

  const tips = view.querySelectorAll(".tip");
  const wrapped = view.querySelectorAll(".sw-wrap");
  const rings = brandGrid ? brandGrid.children[0].querySelectorAll(".sw-ring") : [];
  check(
    "11 调色板结构：sw-wrap / tip / sw-ring 齐备",
    wrapped.length === 2 && tips.length === 2 && rings.length === 1,
    "sw-wrap=" + wrapped.length + "（期望 2）　tip=" + tips.length + "（期望 2）　首个色块的 ring=" + rings.length
  );

  const hintsBox = view.querySelector(".hints");
  const hints = hintsBox ? hintsBox.querySelectorAll("p") : [];
  check(
    "12 操作提示条：4 行说明（v0.2.2 增加 Alt+左键=填充）",
    hints.length === 4,
    "hints 内的行数 = " + hints.length + "（期望 4）"
  );

  /* ---- 13. hover 浮层（合成 mouseover，对应自检 S12） ---- */
  const sw0 = brandGrid ? brandGrid.children[0] : null;
  if (sw0) {
    sw0.dispatchEvent(new Event("mouseover", { bubbles: true, cancelable: true }));
    await sleep(30);
  }
  const tipOn = view.querySelector(".tip.is-on");
  const roHex = view.querySelector(".ro-hex");
  const expectHex = "#E60012";
  /** ActionDescriptor 的 RGBColor → #RRGGBB（绿色分量键名是 grain，见 lib/ps.js 头部）。 */
  const hexOf = (c) =>
    c
      ? "#" + [c.red, c.grain, c.blue].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase()
      : "-";
  check(
    "13 hover 色块 → 浮层 + 读数行同步（自检 S12 的路径）",
    !!tipOn && !!roHex && String(tipOn.textContent).indexOf(expectHex) >= 0 && String(roHex.textContent).indexOf(expectHex) >= 0,
    "tip=" + JSON.stringify(tipOn ? tipOn.textContent : null) + "　ro-hex=" + JSON.stringify(roHex ? roHex.textContent : null)
  );

  /* ---- 14. 设色链路（合成点击色块 → 回读） ---- */
  if (sw0) {
    sw0.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await sleep(200);
  }
  const gotFg = mockPhotoshop.action && colorState.foregroundColor;
  const fgHex =
    "#" +
    [gotFg.red, gotFg.grain, gotFg.blue]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  check(
    "14 合成点击色块 → 前景色真的变了（自检 S3 的路径）",
    fgHex === expectHex,
    "前景色 = " + fgHex + "（期望 " + expectHex + "）"
  );

  /* ---- 15. 面板不再绑色块级 mouseout（v0.2.2 闪烁根因的静态判据） ----
     用户报「鼠标在色块上移动时色值标签疯狂闪烁」：旧版每个色块各自 mouseover 显示 +
     mouseout 隐藏，而指针在「色块 ↔ 它的子元素（描边环 / 删除叉）」之间移动时
     这两个事件会成对触发 → 高频 show/hide。
     这里用**源码级**判据兜住：调色板里不允许再出现"色块自己的 mouseout"。
     （几何层的不变量由真机自检 S15 负责：浮层不得与任何色块相交。） */
  const paletteSrc = fs.readFileSync(path.join(PKG, "tools", "palette.js"), "utf8");
  const swMouseout = /binder\.on\(\s*sw\s*,\s*"mouseout"/.test(paletteSrc);
  check(
    "15 调色板不再绑色块级 mouseout（闪烁根因）",
    !swMouseout && /bindRootHover/.test(paletteSrc) && /insideSwatch/.test(paletteSrc),
    "sw 级 mouseout 绑定 = " + (swMouseout ? "仍存在（会闪！）" : "已移除") +
      "　根节点统一判断 = " + (/bindRootHover/.test(paletteSrc) ? "有" : "无") +
      "　insideSwatch = " + (/insideSwatch/.test(paletteSrc) ? "有" : "无")
  );

  /* ---- 16. Alt+点击色块 → 填充（无文档时必须给出可读拒绝，且不动前景色） ----
     调色板能脱离文档用，但**填充不能** —— 没开文档就要明说，不能"点了没反应"。 */
  if (sw0) {
    const fgBeforeAlt = JSON.stringify(colorState.foregroundColor);
    const evAlt = new Event("click", { bubbles: true, cancelable: true });
    evAlt.altKey = true; // 桩的 Event 构造器不吃这个选项，用自有属性挂上（真机同款手法）
    sw0.dispatchEvent(evAlt);
    await sleep(200);
    const fgAfterAlt = JSON.stringify(colorState.foregroundColor);
    const statusEl = document.getElementById("vt-status");
    const statusTxt = statusEl ? String(statusEl.textContent || "") : "";
    check(
      "16 Alt+点击（无文档）→ 可读拒绝且不改前景色",
      colorState.foregroundColor && fgBeforeAlt === fgAfterAlt &&
        statusTxt.indexOf("填充") >= 0 && statusTxt.indexOf("文档") >= 0,
      "前景色 " + fgBeforeAlt + " → " + fgAfterAlt +
        "　状态栏 = " + JSON.stringify(statusTxt)
    );
  }

  /* ---- 17. Alt+点击（有文档）→ 真的发出 fill 命令，且仍不改前景色 ---- */
  mockApp.documents.push(fakeDoc);
  fillCalls.length = 0;
  if (sw0) {
    const fgBeforeFill = JSON.stringify(colorState.foregroundColor);
    const evAlt2 = new Event("click", { bubbles: true, cancelable: true });
    evAlt2.altKey = true;
    sw0.dispatchEvent(evAlt2);
    await sleep(300);

    const call = fillCalls.length ? fillCalls[fillCalls.length - 1] : null;
    const col = call && call.color ? call.color : null;
    check(
      "17 Alt+点击（有文档）→ 发出 fill 命令 + 前景色未变",
      !!call && call.using && call.using._value === "color" &&
        hexOf(col) === expectHex && fgBeforeFill === JSON.stringify(colorState.foregroundColor) &&
        !call._target,
      "fill 命令 = " + fillCalls.length + " 条" +
        "　fillContents=" + (call && call.using ? call.using._value : "-") +
        "　颜色=" + hexOf(col) + "（期望 " + expectHex + "）" +
        "　带 _target=" + (call && call._target ? "是（论坛实例显示会失效！）" : "否") +
        "　前景色 " + fgBeforeFill + " → " + JSON.stringify(colorState.foregroundColor)
    );
  }
  mockApp.documents.length = 0;

  /* ---- 18. 内容图层（形状/纯色填充）→ **一条 fill 都不许发**，改走 set contentLayer ----
     这是用户真机事故的回归测试：形状图层 kind="solidColor"，`fill` 对它不报错、
     不改像素、还让 PS 弹「命令填充当前不可用」。所以必须在调色板这一层就换命令。 */
  const evAlt3 = () => {
    const e = new Event("click", { bubbles: true, cancelable: true });
    e.altKey = true;
    return e;
  };
  fakeDoc.activeLayers = [{ id: 201, name: "矩形 1", kind: "solidColor", allLocked: false }];
  mockApp.documents.push(fakeDoc);
  fillCalls.length = 0;
  sentCalls.length = 0;
  if (sw0) {
    sw0.dispatchEvent(evAlt3());
    await sleep(300);
    const contentSet = sentCalls.filter(
      (c) => c._obj === "set" && c._target && c._target[0] && c._target[0]._ref === "contentLayer"
    );
    const first = contentSet[0] || null;
    check(
      "18 内容图层（形状）→ 不发 fill，改发 set contentLayer 改色",
      fillCalls.length === 0 && contentSet.length >= 1 &&
        !!first && first.to && first.to.color &&
        hexOf(first.to.color) === expectHex &&
        first._target[0]._value === "targetEnum",
      "fill 命令 = " + fillCalls.length + " 条（必须 0）" +
        "　set contentLayer = " + contentSet.length + " 条" +
        "　颜色 = " + hexOf(first && first.to ? first.to.color : null) + "（期望 " + expectHex + "）" +
        "　to._obj = " + (first && first.to ? first.to._obj : "-")
    );
  }

  /* ---- 19. 锁定图层 → 前置拒绝：**一条命令都不发**，面板给可读原因 ---- */
  fakeDoc.activeLayers = [{ id: 201, name: "锁定层", kind: "pixel", allLocked: true }];
  fillCalls.length = 0;
  sentCalls.length = 0;
  if (sw0) {
    sw0.dispatchEvent(evAlt3());
    await sleep(300);
    const st = document.getElementById("vt-status");
    const txt = st ? String(st.textContent || "") : "";
    check(
      "19 锁定图层 → 前置拒绝（0 条命令 + 面板说明原因）",
      sentCalls.length === 0 && txt.indexOf("锁定") >= 0,
      "发出的命令 = " + sentCalls.length + " 条（必须 0）" +
        "　状态栏 = " + JSON.stringify(txt)
    );
  }

  /* ---- 20. 文字图层 → 发 textStyle 改色（**不许**发 fill） ----
     为什么从"前置拒绝"改成这样：v0.2.4 起文字图层**不再拒绝**了 ——
     用户报「形状图层可以了，但文字图层还是不行」。真机确认 `fill` 对文字图层给
     「命令"<未知的>"当前不可用」，必须走
       `set` → `_target:[{_property:"textStyle",_ref:"property"},
                         {_ref:"textLayer",_enum:"ordinal",_value:"targetEnum"}]`
             → `to:{_obj:"textStyle", color:{_obj:"RGBColor",...}}`（**照抄 Adobe 官方 API 文档**）。
     ⚠️ 这条必须**验命令形状**：`_target` 少一级、或颜色套错层级，
        PS 都是"不报错、像素也不变"（我自己猜的两版就是这么败的）——
        只有把形状钉死在离线断言里，回归才拦得住。 */
  fakeDoc.activeLayers = [{ id: 201, name: "标题", kind: "text", allLocked: false }];
  fillCalls.length = 0;
  sentCalls.length = 0;
  if (sw0) {
    sw0.dispatchEvent(evAlt3());
    await sleep(300);
    const call = sentCalls.length ? sentCalls[sentCalls.length - 1] : null;
    const tgt = call && Array.isArray(call._target) ? call._target : [];
    const lv0 = tgt[0] || {};
    const lv1 = tgt[1] || {};
    const to = call && call.to ? call.to : null;
    const col = to && to.color ? to.color : null;
    const shapeOk =
      !!call && call._obj === "set" && tgt.length === 2 &&
      lv0._ref === "property" && lv0._property === "textStyle" &&
      lv1._ref === "textLayer" && lv1._enum === "ordinal" && lv1._value === "targetEnum" &&
      !!to && to._obj === "textStyle" && !!col && col._obj === "RGBColor";
    const st = document.getElementById("vt-status");
    const txt = st ? String(st.textContent || "") : "";
    check(
      "20 文字图层 → 发 textStyle 改色（两级 _target + 颜色在 to.textStyle 里，且不发 fill）",
      shapeOk && fillCalls.length === 0 && txt.indexOf("文字颜色") >= 0,
      "命令=" + (call ? call._obj : "-") +
        "　_target 级数=" + tgt.length + "（期望 2）" +
        "　t0=" + JSON.stringify(lv0) +
        "　t1=" + JSON.stringify(lv1) +
        "　to._obj=" + (to ? to._obj : "-") +
        "　color._obj=" + (col ? col._obj : "-") +
        "　fill 命令 = " + fillCalls.length + " 条（必须 0）" +
        "　状态栏 = " + JSON.stringify(txt)
    );
  }

  /* ---- 21. kind 读不出来 + 是背景图层 → 用 isBackgroundLayer 兜底走像素族 ----
     为什么要这条：读过 `layer.kind` 的都知道，Clarity / Grain 这类 UXP DOM 还没收录的
     新调整图层会让 `layer.kind` **直接抛异常**。那时 kind 是空的，
     若一律判"未知"，就会把一个正常的**背景图层**也拒掉（S16 的临时文档正是背景图层）。 */
  fakeDoc.activeLayers = [{ id: 201, name: "背景", isBackgroundLayer: true }];
  fillCalls.length = 0;
  sentCalls.length = 0;
  if (sw0) {
    sw0.dispatchEvent(evAlt3());
    await sleep(300);
    check(
      "21 kind 读不到但 isBackgroundLayer → 兜底走像素族（发 fill）",
      fillCalls.length === 1 && sentCalls.length === 1,
      "fill 命令 = " + fillCalls.length + " 条（期望 1）" +
        "　全部命令 = " + sentCalls.length + " 条（期望 1，不该先试内容族）"
    );
  }

  fakeDoc.activeLayers = [{ id: 201, name: "图层 1", kind: "pixel" }];
  mockApp.documents.length = 0;

  /* ---- 22. 注册表：素材库已从 planned 升为可点工具 ----
     （首页仍是 4 行、顺序与号位不变，只是第 2 项从"灰行 + 提示"变成真能进的工具） */
  {
    const registry = require(path.join(PKG, "tools", "index.js"));
    const ids = registry.tools.map((t) => t.id);
    const inPlanned = registry.planned.some((p) => p.id === "assets");
    const libMod = registry.byId("assets");
    const row2 = navs.length >= 2 ? navs[1] : null;
    const row2Key = row2 ? row2.getAttribute("data-tool") : null;
    const stillPlanned = row2
      ? String(row2.getAttribute("class") || "").indexOf("is-planned") >= 0
      : true;
    check(
      "22 素材库已上线：registry.tools 里 + ready + 首页第 2 行可点",
      ids.indexOf("assets") >= 0 && !inPlanned && !!libMod && libMod.ready === true &&
        typeof libMod.mount === "function" && typeof libMod.unmount === "function" &&
        row2Key === "assets" && !stillPlanned,
      "tools=" + ids.join(",") + "　planned=" + registry.planned.map((p) => p.id).join(",") +
        "　第 2 行 data-tool=" + row2Key + "　仍标 is-planned=" + stillPlanned
    );
  }

  /* ---- 23. 素材库：真实挂载 + 镜像缺失时的空态 ----
     验两件事：① 自检 S20 依赖的选择器全部存在（免得真机上一堆 FAIL 其实只是改了名）；
     ② **镜像不存在时的降级路径不抛异常**（真机上这条就是"用户还没在 VellumDesk 里同步过"，
     必须给可读提示 + 重试，而不是白屏）。 */
  {
    const libMod = require(path.join(PKG, "tools", "library.js"));
    const fakeCtx = {
      setStatus() {},
      data: require(path.join(PKG, "lib", "data.js")),
      ps: require(path.join(PKG, "lib", "ps.js")),
    };
    await libMod.mount(view, fakeCtx);
    await sleep(200);
    const tabs = document.getElementById("vt-lib-tabs");
    const bar = document.getElementById("vt-lib-bar");
    const body = document.getElementById("vt-lib-body");
    const foot = document.getElementById("vt-lib-foot");
    const retry = document.getElementById("vt-lib-retry");
    const bodyTxt = body ? String(body.textContent || "") : "";
    check(
      "23 素材库：选择器齐备 + 镜像缺失时走空态（不抛、有重试）",
      !!tabs && !!bar && !!body && !!foot && !!retry && bodyTxt.indexOf("镜像") >= 0,
      "tabs=" + !!tabs + "　bar=" + !!bar + "　body=" + !!body + "　foot=" + !!foot +
        "　重试按钮=" + !!retry + "　空态文案=" + JSON.stringify(bodyTxt.slice(0, 46))
    );
    libMod.unmount();
    await sleep(50);
  }

  /* ---- 24. 素材库 UI 的 UXP 约束（源码级，防止以后手滑写回禁用特性） ---- */
  {
    const src = fs.readFileSync(path.join(PKG, "tools", "library.js"), "utf8");
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const m = /\.lib-grid\s*\{[^}]*\}/.exec(css);
    const gridBlock = m ? m[0] : "";
    const badBtn = src.indexOf('el("button"') >= 0 || src.indexOf('createElement("button")') >= 0;
    check(
      "24 素材库 UI 不碰禁用特性（无 Grid / 无 gap / 无 <button>）",
      src.indexOf("display:grid") < 0 &&
        !badBtn &&
        gridBlock.indexOf("flex-wrap") >= 0 &&
        gridBlock.indexOf("gap") < 0,
      "源码含 display:grid=" + (src.indexOf("display:grid") >= 0) +
        "　源码建 <button>=" + badBtn +
        "　.lib-grid 用 flex-wrap=" + (gridBlock.indexOf("flex-wrap") >= 0) +
        "　.lib-grid 含 gap=" + (gridBlock.indexOf("gap") >= 0)
    );
  }

  /* ---- 25. handoff 请求（契约 §六）：形状 + reqId 唯一 + 只认自己的 res ----
     这一条是跨项目的接口，错了会**悄悄置入错的那张图**（第二次请求认领到上一次的 res），
     所以三个判据缺一不可。 */
  {
    const handoff = require(path.join(PKG, "lib", "handoff.js"));
    const r1 = await handoff.request({ id: 401, name: "x.png" }, "task");
    const b1 = JSON.parse(files["library/handoff/req.json"] || "{}");
    const r2 = await handoff.request({ id: 401, name: "x.png" }, "task");
    const b2 = JSON.parse(files["library/handoff/req.json"] || "{}");
    const isoOk = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(String(b1.at || ""));
    const idOk = /^r-\d{8}T\d{6}-[0-9a-f]{4}$/.test(String(b1.reqId || ""));

    // 先放一份"上一次的" res → 必须被忽略（不认 reqId）
    files["library/handoff/res.json"] = JSON.stringify({
      contract: "vellum-link/1", reqId: "r-19700101T000000-dead", ok: true,
      file: "handoff/incoming.png",
    });
    const stale = await handoff.waitForRes(b2.reqId, 400, 100);
    // 再放"这一次的" → 必须认领成功
    files["library/handoff/res.json"] = JSON.stringify({
      contract: "vellum-link/1", reqId: b2.reqId, ok: true,
      file: "handoff/incoming.png", size: 1234,
    });
    const mine = await handoff.waitForRes(b2.reqId, 900, 100);

    check(
      "25 handoff 请求：契约形状 + reqId 每次新 + 只认自己的 res",
      r1.ok && r2.ok && b1.contract === "vellum-link/1" && b1.assetId === 401 &&
        b1.scope === "task" && isoOk && idOk && b1.reqId !== b2.reqId &&
        !stale.ok && stale.timedOut === true && mine.ok === true && mine.data.reqId === b2.reqId,
      "contract=" + b1.contract + "　assetId=" + b1.assetId + "　scope=" + b1.scope +
        "　at=" + b1.at + "（带时区=" + isoOk + "）" +
        "　reqId=" + b1.reqId + "（形状=" + idOk + "，两次不同=" + (b1.reqId !== b2.reqId) + "）" +
        "　别人的 res 被忽略=" + (stale.timedOut === true) +
        "　自己的 res 认领=" + (mine.ok === true)
    );
  }

  /* ---- 26. placeEvent 描述符形状（对应真机 S21） ----
     描述符**照抄** @alisaitteke/photoshop-mcp 的工作实现（ExtendScript 的
     `executeAction(cTID('Plc '), …)` 逐句翻成 ActionJSON）；这条断言把形状钉死，
     免得以后有人"顺手简化"成想当然的写法 —— 那种错最贵：不报错也不生效。 */
  {
    const psm = require(path.join(PKG, "lib", "ps.js"));
    const d = psm.placeDesc("D:\\a\\b.png");
    check(
      "26 placeEvent 描述符形状（照抄工作实现，不自己发挥）",
      d._obj === "placeEvent" && !!d.null && d.null._path === "D:\\a\\b.png" &&
        d.null._kind === "local" &&
        d.freeTransformCenterState._enum === "quadCenterState" &&
        d.freeTransformCenterState._value === "QCSAverage" &&
        d.offset._obj === "offset" &&
        d._options.dialogOptions === "dontDisplay",
      "_obj=" + d._obj + "　null._path=" + JSON.stringify(d.null && d.null._path) +
        "　null._kind=" + (d.null && d.null._kind) +
        "　FTcs=" + d.freeTransformCenterState._value +
        "　offset._obj=" + d.offset._obj +
        "　dialogOptions=" + d._options.dialogOptions
    );
  }

  /* ---- 27. 置入：裸路径必须**立即拒绝**且一条命令都不发 ----
     真机实测（v0.2.7 S21 第一版）：把 `asset.absPath` 直接塞进 placeEvent 的 `_path`
     会得到 `Error: invalid file token used` —— AM 层要的是 UXP 授权过的**文件令牌**。
     这条断言把"别再试裸路径"钉在离线回归里（否则以后很容易有人"顺手简化"回去）。 */
  {
    const psm = require(path.join(PKG, "lib", "ps.js"));
    mockApp.documents.length = 0; // 连文档都没有，仍然应该先被"裸路径"这一条挡住
    sentCalls.length = 0;
    const r = await psm.placeFile("D:\\vellum_workspace\\a\\b.png", { verify: "change" });
    check(
      "27 置入：裸路径立即拒绝（不发任何命令，提示要 Entry/令牌）",
      r.ok === false && r.noToken === true && sentCalls.length === 0 &&
        String(r.error).indexOf("令牌") >= 0,
      "ok=" + r.ok + "　noToken=" + r.noToken + "　发出的命令 = " + sentCalls.length + " 条（必须 0）" +
        "　提示=" + JSON.stringify(r.error)
    );
  }

  /* ---- 28. 置入：Entry → 会话令牌 → placeEvent ----
     离线这一条只钉**命令形状**（真机行为由 S21 负责）：`_obj="placeEvent"`，
     且 `null._path` 必须是**令牌**而不是路径。 */
  {
    const psm = require(path.join(PKG, "lib", "ps.js"));
    const entry = {
      name: "incoming.png",
      nativePath: "C:/fake/PluginData/library/handoff/incoming.png",
    };
    fakeDoc.layers = [{ id: 500 }];
    mockApp.documents.length = 1;
    sentCalls.length = 0;
    const r = await psm.placeFile(entry, { verify: "change" });
    const c = sentCalls.length ? sentCalls[sentCalls.length - 1] : null;
    const p = c && c.null ? String(c.null._path) : "";
    check(
      "28 置入：Entry → 令牌 → placeEvent（_path 是令牌，不是路径）",
      sentCalls.length === 1 && !!c && c._obj === "placeEvent" && p.indexOf("token:") === 0 &&
        p.indexOf(":\\") < 0 && c.freeTransformCenterState._value === "QCSAverage",
      "命令=" + (c ? c._obj : "-") + "　_path=" + JSON.stringify(p) +
        "　FTcs=" + (c ? c.freeTransformCenterState._value : "-") +
        "　ok=" + r.ok + "　layers=" + r.layersBefore + "→" + r.layersAfter
    );
    mockApp.documents.length = 0;
  }

  /* ---- 生成浏览器预览（用的是同一份渲染代码产出的 DOM） ---- */
  let previewPath = null;
  if (WANT_PREVIEW) {
    try {
      const paletteMod = require(path.join(PKG, "tools", "palette.js"));
      // 预览用样例常用色（断言已全部跑完，不影响结论）
      const sample = ["#E4572E", "#F2B134", "#7FB069", "#1B998B", "#4A6FA5", "#8E6C88", "#EFE3D6", "#2B2B2B"];
      files["palette.json"] = JSON.stringify({
        version: 1,
        brand: null,
        custom: sample.map((h, i) => ({
          id: "c" + i, name: h, hex: h, savedAt: "2026-10-10T00:00:00.000Z",
        })),
      });
      await paletteMod.mount(view, { setStatus() {} });
      await sleep(60);

      const paletteSnapshot = serialize(document.getElementById("vt-app"));
      const html = buildPreviewHtml(
        homeSnapshot,
        paletteSnapshot,
        "方向 B · Native Pro 落地预览 —— 由 tools/offline-smoke.cjs 用同一份渲染代码生成（深色主题）。真机表现以 Photoshop 内为准。"
      );
      const dir = path.join(__dirname, "..", "preview");
      fs.mkdirSync(dir, { recursive: true });
      previewPath = path.join(dir, "vellum-ui-preview.html");
      fs.writeFileSync(previewPath, html, "utf8");
    } catch (e) {
      console.log("预览生成失败：" + ((e && e.message) || e));
    }
  }

  /* ---- 收尾 ---- */
  const pass = results.filter((r) => r.ok).length;
  console.log("\n===== 离线结构回归 =====");
  for (const r of results) {
    console.log((r.ok ? "PASS  " : "FAIL  ") + r.name + "\n        " + r.detail);
  }
  console.log("\n结果：" + pass + "/" + results.length);
  console.log("（注意：本脚本只验结构与处理器，不验 CSS 渲染与 batchPlay 真实行为）");
  if (previewPath) console.log("浏览器预览已生成：" + previewPath);
  return pass === results.length ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("离线回归自身抛异常：", (e && e.stack) || e);
    process.exit(2);
  });
