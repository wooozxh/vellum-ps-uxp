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
    async read(opts) {
      const v = files[full];
      // v0.2.8：镜像里的缩略图是**二进制** —— UXP 侧必须 read({format:binary})，
      // 不传 format 会按文本解码。mock 也得能区分，否则测不到这条路径。
      if (opts && opts.format) {
        const s = String(v === undefined || v === null ? "" : v);
        const ab = new ArrayBuffer(s.length);
        const u8 = new Uint8Array(ab);
        for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
        return ab;
      }
      return v;
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
    // v0.2.8：缩略图要按二进制读（lib/data.js readBinaryIn 会先查这个）
    formats: { binary: "binary" },
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

  /* ---- 29~32：软件侧 2026-10-10 按契约 §十 提的三处加法 ----
     （① 缩略图命名空间 / ② asset.source / ③ groups[].parentId；均为「加法」，不升契约版本）
     这些都是**跨项目接口**，错了会静默出错（筛选少一批素材 / 切库后显示上一个库的图），
     所以逐条钉在离线回归里。真机行为由自检 S19 / S20c / S20d 负责。 */
  {
    const mirror = require(path.join(PKG, "lib", "mirror.js"));

    /* 29. §5.3 加法 ③：parentId 两级分组 */
    const two = mirror.flattenBrand({
      groups: [
        { id: 1, name: "公司素材", sortOrder: 0, assets: [{ id: 1, name: "a.png", ext: "png", thumb: "thumb/b1.png" }] },
        { id: 2, name: "我的收藏", sortOrder: 1, assets: [{ id: 3, name: "c.png", ext: "png", thumb: "thumb/b3.png" }] },
        { id: 11, name: "节日素材", parentId: 1, sortOrder: 0, assets: [{ id: 4, name: "d.png", ext: "png", thumb: "thumb/b4.png" }] },
      ],
    });
    const shape = two.map((r) => [r.group, r.sub]);
    const tree = mirror.groupTree(two);
    check(
      "29 §5.3 加法：parentId 解析成两级（父组含子组素材、顺序父在前）",
      shape.length === 3 &&
        shape[0][0] === "公司素材" && shape[0][1] === "" &&
        shape[1][0] === "公司素材" && shape[1][1] === "节日素材" &&
        shape[2][0] === "我的收藏" && shape[2][1] === "" &&
        tree.length === 2 &&
        tree[0].name === "公司素材" && tree[0].count === 2 &&
        tree[0].children.length === 1 && tree[0].children[0].name === "节日素材" &&
        tree[0].children[0].count === 1 &&
        tree[1].name === "我的收藏" && tree[1].count === 1 && tree[1].children.length === 0,
      "展平=" + JSON.stringify(shape) + "　树=" + JSON.stringify(tree)
    );

    /* 30. §5.3 容错：缺失 / 坏 parentId / 三层 —— 一律当顶层，**绝不丢素材**
       判据是"条数不变"，因为丢素材是最难发现的那种错（界面不报，只是少东西）。 */
    const safeRows = mirror.flattenBrand({
      groups: [
        { id: 5, name: "孤儿", parentId: 999, assets: [{ id: 1, name: "x.png", ext: "png", thumb: "thumb/b1.png" }] },
        { id: 6, name: "老镜像无此字段", assets: [{ id: 2, name: "y.png", ext: "png", thumb: "thumb/b2.png" }] },
        { id: 7, name: "A", assets: [] },
        { id: 8, name: "B", parentId: 7, assets: [] },
        { id: 9, name: "C", parentId: 8, assets: [{ id: 3, name: "z.png", ext: "png", thumb: "thumb/b3.png" }] },
      ],
    });
    check(
      "30 §5.3 容错：parentId 缺失 / 指向不存在的组 / 三层 → 当顶层，一个素材都不丢",
      safeRows.length === 3 &&
        safeRows.filter((r) => r.group === "孤儿").length === 1 &&
        safeRows.filter((r) => r.group === "老镜像无此字段").length === 1 &&
        safeRows.filter((r) => r.group === "C").length === 1,
      "条数=" + safeRows.length + "（应为 3）　" +
        JSON.stringify(safeRows.map((r) => [r.group, r.sub]))
    );

    /* 31. §5.4 加法 ②：source 是**可选**的 —— 老镜像没有它就是空数组，不许当异常 */
    const withSrc = mirror.flattenBrand({
      groups: [
        {
          id: 1,
          name: "G",
          assets: [
            { id: 1, name: "u.png", ext: "png", thumb: "thumb/b1.png", source: "user" },
            { id: 2, name: "c.png", ext: "png", thumb: "thumb/b2.png", source: "company" },
            { id: 3, name: "n.png", ext: "png", thumb: "thumb/b3.png" }, // 无 source
          ],
        },
      ],
    });
    const noSrc = mirror.sourceSummary(two); // two 里的 asset 都没有 source
    const srcRows = mirror.sourceSummary(withSrc);
    check(
      "31 §5.4 加法：asset.source 可选（无则空数组）+ 顺序固定 company→user + 空值不计入",
      noSrc.length === 0 &&
        srcRows.length === 2 &&
        srcRows[0].value === "company" && srcRows[0].label === "公司" && srcRows[0].count === 1 &&
        srcRows[1].value === "user" && srcRows[1].label === "我的" && srcRows[1].count === 1,
      "无 source 时=" + JSON.stringify(noSrc) + "（应为空数组）　混合时=" + JSON.stringify(srcRows) +
        "　（3 张里 1 张没有 source，不计入）"
    );

    /* 32. §5.5 加法 ① 暴露出的**本项目真实缺陷**：缩略图缓存键不能是 asset.id。
       两库 asset.id **各自从 1 起** ⇒ 同 id 命中同一个缓存项；而"revision 变了就清缓存"
       兜不住"两库 revision 恰好相等"（首次同步后 task=1 / brand=1 就是这种情形）。
       判据：两个 **同 id、同 revision**、只差 thumb 的 asset，得到的 URL 必须不同。 */
    dirs["library"] = true;
    dirs["library/thumb"] = true;
    files["library/thumb/t1.png"] = "TASK-BYTES";
    files["library/thumb/b1.png"] = "BRAND-BYTES";
    mirror.clearThumbs();
    const tA = await mirror.thumbUrl({ id: 1, thumb: "thumb/t1.png" }, 5);
    const tB = await mirror.thumbUrl({ id: 1, thumb: "thumb/b1.png" }, 5); // ← 同一个 revision
    const tC = await mirror.thumbUrl({ id: 1, thumb: "thumb/t1.png" }, 5);
    check(
      "32 §5.5 加法：缩略图缓存键按 thumb（同 id 同 revision 的两库素材不会串图）",
      tA.ok && tB.ok && tA.url !== tB.url && tC.ok && tC.url === tA.url && tC.cached === true,
      "task id=1 ok=" + tA.ok + "（cached=" + !!tA.cached + "）" +
        "　brand id=1 ok=" + tB.ok + "（cached=" + !!tB.cached + "）" +
        "　两条 URL 不同=" + (tA.url !== tB.url) + "（键若仍是 asset.id 则必然相同）" +
        "　同 thumb 二次命中缓存=" + (tC.cached === true)
    );
    delete dirs["library"];
    delete dirs["library/thumb"];
    delete files["library/thumb/t1.png"];
    delete files["library/thumb/b1.png"];
    mirror.clearThumbs();
  }

  /* ---- 33~36：v0.3.0 的两个界面需求（九宫格落点 + 自绘下拉） ----
     需求来源：用户要「二级筛选改成下拉控件」+「素材放到画布指定位置」。
     能力结论见 docs/25（S23 真机实测）；这几条只钉**逻辑与结构**，真机行为由 S20c/S24 负责。 */
  {
    const psm = require(path.join(PKG, "lib", "ps.js"));

    /* 33. anchorOffset：九宫格 → placeEvent 的 offset（依据：默认落点=画布居中、offset 与位移 1:1） */
    const A = {};
    for (const a of psm.ANCHORS) A[a] = psm.anchorOffset(a, 400, 400, 320, 240);
    const ok33 =
      psm.ANCHORS.length === 9 &&
      A.mc.ok && A.mc.x === 40 && A.mc.y === 80 && A.mc.offsetX === 0 && A.mc.offsetY === 0 &&
      A.tl.x === 0 && A.tl.y === 0 && A.tl.offsetX === -40 && A.tl.offsetY === -80 &&
      A.br.x === 80 && A.br.y === 160 && A.br.offsetX === 40 && A.br.offsetY === 80 &&
      A.tc.offsetX === 0 && A.tc.offsetY === -80 &&
      A.ml.offsetX === -40 && A.ml.offsetY === 0;
    check(
      "33 anchorOffset：九宫格换算（居中=0,0；右上/左下都对；offset 与 bounds 同向）",
      ok33,
      "mc=" + A.mc.offsetX + "," + A.mc.offsetY + "（左上角 " + A.mc.x + "," + A.mc.y + "）" +
        "　tl=" + A.tl.offsetX + "," + A.tl.offsetY +
        "　br=" + A.br.offsetX + "," + A.br.offsetY +
        "　tc=" + A.tc.offsetX + "," + A.tc.offsetY +
        "　ml=" + A.ml.offsetX + "," + A.ml.offsetY
    );

    /* 34. anchorOffset 的边界：素材比画布大 / 非法输入 —— 不许崩、不许瞎给数 */
    const big = {};
    for (const a of ["tl", "mc", "br"]) big[a] = psm.anchorOffset(a, 200, 200, 320, 240);
    const bad1 = psm.anchorOffset("zz", 400, 400, 320, 240);
    const bad2 = psm.anchorOffset("mc", 0, 400, 320, 240);
    const bad3 = psm.anchorOffset("mc", null, 400, 320, 240);
    check(
      "34 anchorOffset 边界：素材比画布大时不特判（贴左就是对齐左缘）、非法输入返回 ok:false",
      big.tl.x === 0 && big.tl.y === 0 && big.tl.offsetX === 60 && big.tl.offsetY === 20 &&
        big.mc.x === -60 && big.mc.y === -20 && big.mc.offsetX === 0 && big.mc.offsetY === 0 &&
        big.br.offsetX === -60 && big.br.offsetY === -20 &&
        bad1.ok === false && bad2.ok === false && bad3.ok === false,
      "素材>画布：tl x=" + big.tl.x + " offset=" + big.tl.offsetX + "," + big.tl.offsetY +
        "　mc x=" + big.mc.x + " offset=" + big.mc.offsetX + "," + big.mc.offsetY +
        "　未知锚点=" + JSON.stringify(bad1.error) +
        "　零尺寸=" + JSON.stringify(bad2.error)
    );

    /* 35. placeDesc 的 offset 形状（真机实测过：offset 与位移 1:1 精确） */
    const d0 = psm.placeDesc("tok");
    const d1 = psm.placeDesc("tok", { x: 64, y: 48 });
    const d2 = psm.placeDesc("tok", { x: 10 });
    check(
      "35 placeDesc 的 offset：给了就写进去、没给就是 0、半残的也要补成合法描述符",
      d0.offset.horizontal._value === 0 && d0.offset.vertical._value === 0 &&
        d1.offset.horizontal._value === 64 && d1.offset.vertical._value === 48 &&
        d1.offset.horizontal._unit === "pixelsUnit" &&
        d2.offset.horizontal._value === 10 && d2.offset.vertical._value === 0,
      "无 offset=" + JSON.stringify(d0.offset) +
        "　(64,48)=" + JSON.stringify(d1.offset) +
        "　半残=" + JSON.stringify(d2.offset)
    );
  }

  /* ---- 36. 二层筛选是自绘下拉，不许写回原生 <select> / Spectrum（源码级守门） ----
     依据 docs/25：`<select>` 外观改不动且设值只能走 option.selected；`sp-picker` 真机未注册。
     这条断言的作用是**防止以后有人"顺手换回原生控件"**（那会同时丢掉可换肤能力与可用性）。 */
  {
    const lib = fs.readFileSync(path.join(PKG, "tools", "library.js"), "utf8");
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const usesSelect = /createElement\(\s*["']select["']\s*\)/.test(lib);
    const usesSp = /createElement\(\s*["']sp-/.test(lib);
    const popBlock = (/\.fsel-pop\s*\{[^}]*\}/.exec(css) || [""])[0];
    const wrapBlock = (/\.fsel-wrap\s*\{[^}]*\}/.exec(css) || [""])[0];
    check(
      "36 二层筛选：自绘下拉（不碰原生 select / Spectrum），且浮层带 max-height+overflow 与 relative 定位",
      !usesSelect && !usesSp &&
        popBlock.indexOf("max-height") >= 0 &&
        popBlock.indexOf("overflow-y") >= 0 &&
        popBlock.indexOf("position: absolute") >= 0 &&
        wrapBlock.indexOf("position: relative") >= 0,
      "用原生 select=" + usesSelect + "　用 sp-*=" + usesSp +
        "　.fsel-pop 有 max-height+overflow=" +
        (popBlock.indexOf("max-height") >= 0 && popBlock.indexOf("overflow-y") >= 0) +
        "　.fsel-wrap relative=" + (wrapBlock.indexOf("position: relative") >= 0)
    );
  }

  /* ==================================================================
   * v0.3.1：用户 2026-10-11 提的四条 UI 调整
   *   ① 详情区：置入按钮居左、落点九宫格居右（「落点」在九宫格上方）、
   *      信息区与动作区之间加细分隔线、去掉「置入为新图层」文案
   *   ② 任务库：刷新按钮左侧加「项目」筛选下拉
   *   ③ 素材网格：3 列 → 2 列
   *   ④ 通用库：二级下拉与一级按钮放同一行的最右侧
   * ================================================================== */

  /* ---- 37. 素材网格改 2 列（缩略图跟着加高） ---- */
  {
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const cardBlock = (/\.card\s*\{[^}]*\}/.exec(css) || [""])[0];
    const thBlock = (/\.card-th\s*\{[^}]*\}/.exec(css) || [""])[0];
    const w = /width:\s*([0-9.]+)%/.exec(cardBlock);
    const h = /height:\s*(\d+)px/.exec(thBlock);
    check(
      "37 素材网格 2 列：.card 宽 50% + .card-th 加高（卡片变小格子 → 变大）",
      !!w && Number(w[1]) === 50 && !!h && Number(h[1]) >= 100,
      ".card 宽=" + (w ? w[1] + "%" : "?") +
        "　.card-th 高=" + (h ? h[1] + "px" : "?") +
        "　（3 列旧值 33.3333% / 84px）"
    );
  }

  /* ---- 38. 四条调整的"结构件"齐备（源码级，防止以后手滑改回去） ----
     重点两条：
       · 下拉浮层必须**右对齐**（`right:0` 且没有 `left:0`）—— 这两个下拉都贴**行尾**，
         而滚动容器有 `overflow-x:hidden`，往右展开会被裁掉（真机 S20c 是硬判据）；
       · `.fchips` 必须能伸缩（`flex:1 1 auto`）—— 二级下拉靠它被顶到行尾。 */
  {
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const pop = (/\.fsel-pop\s*\{[^}]*\}/.exec(css) || [""])[0];
    const proj = (/\.lib-proj\s*\{[^}]*\}/.exec(css) || [""])[0];
    const fchips = (/\.fchips\s*\{[^}]*\}/.exec(css) || [""])[0];
    const sep = (/\.lf-sep\s*\{[^}]*\}/.exec(css) || [""])[0];
    const hd = (/\.anchor-hd\s*\{[^}]*\}/.exec(css) || [""])[0];
    const rightAnchored = pop.indexOf("right: 0") >= 0 && pop.indexOf("left: 0") < 0;
    check(
      "38 四条调整的结构件齐备（下拉右对齐 / chips 可伸缩 / 顶部槽位 / 分隔线 / 落点标题）",
      rightAnchored && proj.indexOf("flex") >= 0 && fchips.indexOf("flex: 1 1 auto") >= 0 &&
        /height:\s*1px/.test(sep) && !!hd,
      "浮层右对齐（right:0 且无 left:0）=" + rightAnchored +
        "　.lib-proj=" + !!proj + "　.fchips 可伸缩=" + (fchips.indexOf("flex: 1 1 auto") >= 0) +
        "　.lf-sep=" + (/height:\s*1px/.test(sep) ? "1px 细线" : "缺少") +
        "　.anchor-hd=" + !!hd
    );
  }

  /* ---- 39. mirror.scopeKind：按**结构**判镜像形态（不靠 scope id 硬编码） ----
     为什么重要：界面要按"这个库有没有项目层"决定排布。若写成 `if (id === "task")`，
     软件侧将来加库 / 改名就会静默失效（界面照常渲染，只是少了那一块）。 */
  {
    const mirror = require(path.join(PKG, "lib", "mirror.js"));
    const a = mirror.scopeKind({ projects: [] });
    const b = mirror.scopeKind({ groups: [] });
    const c = mirror.scopeKind({});
    const d = mirror.scopeKind(null);
    const e = mirror.scopeKind({ projects: [], groups: [] });
    check(
      "39 mirror.scopeKind —— 结构判定（projects→task / groups→brand / 其它→unknown）",
      a === "task" && b === "brand" && c === "unknown" && d === "unknown" && e === "task",
      "projects→" + a + "　groups→" + b + "　{}→" + c + "　null→" + d +
        "　两者都有→" + e + "（projects 更具体，优先）"
    );
  }

  /* ---- 40. 真实挂载一遍：项目下拉 / 二级下拉同行 / 详情区新布局 ----
     把一份最小镜像灌进 mock 文件树（前面 23 条验的是"镜像缺失"那条路，
     这条走**有镜像**那条路）。判据全部读 DOM，不读模块内部状态。 */
  {
    files["library/manifest.json"] = JSON.stringify({
      contract: "vellum-link/1",
      generatedAt: "2026-10-11T02:00:00+08:00",
      scopes: [
        { id: "task", label: "任务库", file: "task.json", revision: 11, count: 3 },
        { id: "brand", label: "通用库", file: "brand.json", revision: 3, count: 2 },
      ],
    });
    const mkAsset = (id, name, thumb, extra) =>
      Object.assign(
        {
          id: id, name: name, ext: "png", kind: "image", role: "成品",
          width: 100, height: 100, versionId: null, thumb: thumb, missing: false,
          absPath: "D:/w/" + name,
        },
        extra || {}
      );
    files["library/task.json"] = JSON.stringify({
      contract: "vellum-link/1", scope: "task", revision: 11,
      projects: [
        {
          id: 1, name: "甲项目",
          packs: [{
            id: 11, name: "甲包",
            versions: [{ id: 30, seq: 1, isCurrent: true, folderName: "V1" }],
            assets: [
              mkAsset(401, "a.png", "thumb/t1.png", { versionId: 30 }),
              mkAsset(402, "b.png", "thumb/t1.png", { versionId: 30 }),
            ],
          }],
        },
        {
          id: 2, name: "乙项目",
          packs: [{
            id: 21, name: "乙包",
            versions: [{ id: 40, seq: 1, isCurrent: true, folderName: "V1" }],
            assets: [mkAsset(403, "c.png", "thumb/t1.png", { versionId: 40 })],
          }],
        },
      ],
    });
    files["library/brand.json"] = JSON.stringify({
      contract: "vellum-link/1", scope: "brand", revision: 3,
      // ⚠️ 必须有**两个顶层分组**：只有一个顶层组时，"一级 chips 行"本身不构成筛选、不许画
      //    （那时二级下拉会退化成独占一行的兜底分支 —— 正是这个 fixture 第一版踩的坑）
      groups: [
        {
          id: 1, name: "公司素材", sortOrder: 0,
          assets: [mkAsset(901, "x.png", "thumb/t1.png", { source: "company" })],
        },
        {
          id: 2, name: "节日素材", parentId: 1, sortOrder: 1,
          assets: [mkAsset(902, "y.png", "thumb/t1.png", { source: "company" })],
        },
        {
          id: 3, name: "我的收藏", sortOrder: 2,
          assets: [mkAsset(903, "z.png", "thumb/t1.png", { source: "user" })],
        },
      ],
    });
    dirs["library"] = true;
    dirs["library/thumb"] = true;
    files["library/thumb/t1.png"] = "\u0089PNG-fake"; // 内容不重要，只要"有缩略图"这条路走通

    const libMod = require(path.join(PKG, "tools", "library.js"));
    await libMod.mount(view, {
      setStatus() {},
      data: require(path.join(PKG, "lib", "data.js")),
      ps: require(path.join(PKG, "lib", "ps.js")),
    });
    await sleep(300);

    const click = (el) => {
      if (el) el.dispatchEvent(new Event("click", { bubbles: true }));
      return !!el;
    };
    /**
     * ⚠️ mock 的 `byId` 是**只增不减**的注册表 —— `removeChild` 不会把它摘掉，
     * 所以脱离 DOM 的老节点**仍然能被 getElementById 找到**。
     * 因此"这个元素没了"必须判**是否还挂在文档上**，不能只判 `!!el`。
     * （真机 UXP 的 getElementById 是正常的，这条只影响离线。）
     */
    const attached = (el) => {
      for (let n = el; n; n = n.parentNode) {
        if (n === global.document.documentElement) return true;
      }
      return false;
    };
    /** 往上找第一个 class 含 cls 的祖先。 */
    const ancWith = (el, cls) => {
      for (let n = el; n; n = n.parentNode) {
        const c = String((n.getAttribute && n.getAttribute("class")) || "");
        if (c.split(/\s+/).indexOf(cls) >= 0) return n;
      }
      return null;
    };
    /** 递归收集带某属性的元素。 */
    const collectByAttr = (root, attr, out) => {
      if (!root) return out;
      for (const c of root.children) {
        if (c.getAttribute && c.getAttribute(attr) !== null) out.push(c);
        collectByAttr(c, attr, out);
      }
      return out;
    };

    // ① 任务库：项目下拉存在，而且真的在**顶部槽位**里
    const projSel = document.getElementById("vt-lib-projsel");
    const slot = document.getElementById("vt-lib-projslot");
    let inSlot = false;
    for (let n = projSel; n; n = n.parentNode) if (n === slot) { inSlot = true; break; }

    // ② 选第二个项目 → 卡片收窄到 1（自数） + 筛选区**不再重复**这个条件
    click(projSel);
    const pop = document.getElementById("vt-lib-projpop");
    let opt2 = null;
    if (pop) {
      for (const c of pop.children) if (c.getAttribute("data-proj") === "乙项目") opt2 = c;
    }
    const optCount = pop ? pop.children.length : -1;
    click(opt2);
    await sleep(200);
    const g1 = document.getElementById("vt-lib-grid");
    const cardsTask = g1 ? g1.children.length : -1;
    // 任务库只有一层（`flattenTask` 的 `sub` 恒为空）⇒ 筛选区里不该再出现项目 chip
    const barChips = collectByAttr(document.getElementById("vt-lib-bar"), "data-key", []).length;

    // ③ 切到通用库：项目下拉必须**从 DOM 摘掉**；二级下拉与一级按钮**同一行**
    click(document.getElementById("vt-lib-tab-brand"));
    await sleep(300);
    const projGone = !attached(document.getElementById("vt-lib-projsel"));
    const bar = document.getElementById("vt-lib-bar");
    const findChip = (key) => {
      for (const c of collectByAttr(bar, "data-key", [])) {
        if (c.getAttribute("data-key") === key) return c;
      }
      return null;
    };
    click(findChip("公司素材"));
    await sleep(200);
    const subSel = document.getElementById("vt-lib-subsel");
    const rowOfChip = ancWith(findChip("公司素材"), "frow");
    const rowOfSub = ancWith(subSel, "frow");
    const sameRow = !!(attached(subSel) && rowOfChip && rowOfSub && rowOfChip === rowOfSub);
    // 失败时"自己解释自己"：把筛选区的结构签名打出来（只看直接子节点的 class + 里面的 chip key）
    const barSig = () => {
      if (!bar) return "no-bar";
      const out = [];
      for (const r of bar.children) {
        const rc = String((r.getAttribute && r.getAttribute("class")) || "").replace(/\s+/g, ".");
        const bits = [];
        for (const c of collectByAttr(r, "data-key", [])) bits.push("chip:" + JSON.stringify(c.getAttribute("data-key")));
        for (const c of collectByAttr(r, "data-opt", [])) bits.push("opt:" + JSON.stringify(c.getAttribute("data-opt")));
        if (r.querySelector && r.querySelector(".fsel")) bits.push("trig");
        out.push(rc + "{" + bits.join(",") + "}");
      }
      return out.join(" | ");
    };

    // ④ 详情区：细分隔线 + 「落点」标题在九宫格上方 + 去掉了「置入为新图层」
    const g2 = document.getElementById("vt-lib-grid");
    click(g2 && g2.children.length ? g2.children[0] : null);
    await sleep(150);
    const foot = document.getElementById("vt-lib-foot");
    let sepOk = false;
    let hdOk = false;
    if (foot) {
      const walk = (n) => {
        for (const c of n.children) {
          const cl = String((c.getAttribute && c.getAttribute("class")) || "");
          if (cl.split(/\s+/)[0] === "lf-sep") sepOk = true;
          if (cl.split(/\s+/)[0] === "anchor-hd") hdOk = true;
          walk(c);
        }
      };
      walk(foot);
    }
    const footTxt = foot ? String(foot.textContent || "") : "";
    const planNoteGone = footTxt.indexOf("置入为新图层") < 0 && footTxt.indexOf("置入为智能对象") < 0;

    check(
      "40 真实挂载：项目下拉在顶部槽位/不重复画 chip · 二级与一级同行 · 详情区分隔线+落点标题",
      inSlot && optCount === 3 && cardsTask === 1 && barChips === 0 &&
        projGone && sameRow && sepOk && hdOk && planNoteGone,
      "项目下拉在顶部槽位=" + inSlot +
        "　选项数=" + optCount + "（期望 3 = 2 项目 + 全部）" +
        "　选「乙项目」→卡片=" + cardsTask + "（期望 1）" +
        "　筛选区里的 chip 数=" + barChips + "（须 0：项目条件已挪到顶部，不许重复画）" +
        "　切通用库后项目下拉已摘下=" + projGone +
        "　二级与一级同一 .frow=" + sameRow +
        "　详情区 .lf-sep=" + sepOk + "·.anchor-hd=" + hdOk +
        "　「置入为新图层」文案已去掉=" + planNoteGone +
        "　‖ 失败时看这里·筛选区结构=" + barSig() +
        "　（二级下拉 attached=" + attached(subSel) + "　chip 所在行=" + !!rowOfChip +
        "　下拉所在行=" + !!rowOfSub + "）"
    );

    libMod.unmount();
    await sleep(50);
  }

  /* ---- 41. 详情/置入区必须在**瀑布流上方**（用户第 3 条：素材多时不必滚到底部按置入） ----
     ⚠️ mock DOM 没有 compareDocumentPosition —— 用"在父节点 children 里的下标"比顺序，
        这比读源码里的书写顺序更硬（它验的是**实际挂载出来的结构**）。 */
  {
    const libMod = require(path.join(PKG, "tools", "library.js"));
    const ctx41 = {
      setStatus() {},
      data: require(path.join(PKG, "lib", "data.js")),
      ps: require(path.join(PKG, "lib", "ps.js")),
    };
    await libMod.mount(view, ctx41);
    await sleep(250);

    const idxOf = (id) => {
      const el = document.getElementById(id);
      const wrap = el ? el.parentNode : null;
      if (!wrap) return -1;
      for (let i = 0; i < wrap.children.length; i++) {
        if (wrap.children[i].getAttribute("id") === id) return i;
      }
      return -1;
    };
    const footIdx = idxOf("vt-lib-foot");
    const bodyIdx = idxOf("vt-lib-body");
    const barIdx = idxOf("vt-lib-bar");
    // 顺序应当是：筛选行 → 详情/置入 → 网格
    const orderOk = barIdx >= 0 && footIdx > barIdx && bodyIdx > footIdx;
    // 两个库时不该显示"只有 N 个库"的提示
    const note = document.getElementById("vt-lib-metanote");
    const noteHidden = !!(note && String(note.style.display) === "none");
    check(
      "41 详情/置入区在瀑布流上方（筛选行 → 详情 → 网格），且两个库时不显示提示",
      orderOk && noteHidden,
      "筛选行 index=" + barIdx + "　详情 index=" + footIdx + "　网格 index=" + bodyIdx +
        "（须 筛选<详情<网格）　库数提示隐藏=" + noteHidden
    );
    libMod.unmount();
    await sleep(50);
  }

  /* ---- 42. 镜像里只有 1 个库时，面板要**如实说明**（用户报「通用素材库入口丢失」） ----
     真因是软件侧那一版 manifest 只声明了 task ⇒ 插件只渲染 1 个 tab（这是**设计如此**：
     库列表完全由 scopes[] 决定）。但不说明白，用户只会看到"入口不见了"。 */
  {
    const savedManifest = files["library/manifest.json"];
    const onlyTask = JSON.parse(savedManifest);
    onlyTask.scopes = onlyTask.scopes.filter((s) => s.id === "task");
    files["library/manifest.json"] = JSON.stringify(onlyTask);

    const libMod = require(path.join(PKG, "tools", "library.js"));
    await libMod.mount(view, {
      setStatus() {},
      data: require(path.join(PKG, "lib", "data.js")),
      ps: require(path.join(PKG, "lib", "ps.js")),
    });
    await sleep(250);
    const note = document.getElementById("vt-lib-metanote");
    const txt = note ? String(note.textContent || "") : "";
    const shown = !!(note && String(note.style.display) !== "none");
    const tabs = document.getElementById("vt-lib-tabs");
    const tabCount = tabs ? tabs.children.length : -1;
    check(
      "42 镜像只有 1 个库时给出如实提示（库列表由 manifest.scopes 决定，不是插件丢了入口）",
      tabCount === 1 && shown && txt.indexOf("只有 1 个库") >= 0,
      "tab 数=" + tabCount + "（期望 1，与 scopes 一致）　提示显示=" + shown +
        "　文案=" + JSON.stringify(txt.slice(0, 60))
    );
    libMod.unmount();
    await sleep(50);
    files["library/manifest.json"] = savedManifest; // 还原，别影响后面的断言
  }

  /* ---- 43. handoff：res 先到、文件后到 ⇒ 必须**等文件落盘**，不能看一眼就判死 ----
     这条直接对应用户报的 ①「原图已就位但拿不到文件句柄」：真机上 res.json 写着
     `ok:true / size=627927`，而 handoff/ 里压根没有那个文件。 */
  {
    const handoff = require(path.join(PKG, "lib", "handoff.js"));
    delete files["library/handoff/incoming.png"];
    const resObj = {
      contract: "vellum-link/1", reqId: "r-late", ok: true,
      file: "handoff/incoming.png", size: 12,
    };
    // 文件"迟到" 400ms 才出现
    setTimeout(() => {
      files["library/handoff/incoming.png"] = "hello-bytes!";
    }, 400);
    const t0 = Date.now();
    const inc = await handoff.fetchIncoming(resObj, { waitMs: 3000, intervalMs: 100 });
    const dt = Date.now() - t0;

    // 反面：文件**始终不来**时，错误文案要能说明"res 说 ok 但文件不在"
    delete files["library/handoff/incoming.png"];
    const t1 = Date.now();
    const miss = await handoff.fetchIncoming(
      { reqId: "r-never", ok: true, file: "handoff/incoming.png", size: 627927 },
      { waitMs: 500, intervalMs: 100 }
    );
    const dt1 = Date.now() - t1;

    // 源码级：那句错位的"原图已就位"必须已经不存在（用**完整的旧公文**，避免误伤引用它的注释）
    const libSrc = fs.readFileSync(path.join(PKG, "tools", "library.js"), "utf8");
    const wordingFixed =
      libSrc.indexOf("原图已就位但拿不到可置入的文件句柄") < 0 &&
      libSrc.indexOf("先拷文件、后写 res.json") >= 0;

    check(
      "43 handoff：等文件落盘（res 先到/文件后到）+ 文件真的不来时不谎报「已就位」",
      inc.ok === true && inc.byteLength === 12 && dt >= 350 &&
        miss.ok === false && miss.res && miss.res.size === 627927 &&
        miss.error.indexOf("不存在") >= 0 && dt1 >= 450 && wordingFixed,
      "迟到场景：ok=" + inc.ok + " 字节=" + inc.byteLength + " 等了=" + dt + "ms（须 ≥350）" +
        "　不来场景：ok=" + miss.ok + " 等了=" + dt1 + "ms　res.size=" + (miss.res ? miss.res.size : "-") +
        "　错误=" + JSON.stringify(miss.error) +
        "　错位文案已改掉=" + wordingFixed
    );
  }

  /* ---- 44. 假软件桩**拒绝**覆盖真软件写的镜像（不允许"--force"以外的方式清掉真镜像） ----
     为什么值得一条断言：真 VellumDesk 上线后，真镜像与 fixture 躺在同一个目录里，
     一句随手命令就会把用户的真素材换成假数据，而且**看起来是成功的**。
     ⚠️ 本环境**起不了子进程**（`spawnSync` 报 EBUSY）⇒ 改用两件更强的东西：
        ① 安全闸抽成**纯函数** `canWrite()`，直接单测四种情形；
        ② **源码级**确认两条写路径（正常写 / `--clean`）**都调了**它 —— 只测纯函数不够，
           得确认它真的被接上。 */
  {
    const os = require("os");
    const stub = require(path.join(__dirname, "fake-vellumdesk.cjs"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vellum-fake-"));
    const man = path.join(tmp, "manifest.json");
    const write = (obj) => fs.writeFileSync(man, JSON.stringify(obj));

    write({ contract: "vellum-link/1", generator: { app: "VellumDesk", version: "1.9.7" }, scopes: [] });
    const a = stub.canWrite(man, false); // 真软件写的 → 拒
    write({ contract: "vellum-link/1", generator: { app: "VellumDesk", fixture: true }, scopes: [] });
    const b = stub.canWrite(man, false); // 本桩自己写的 → 允
    write({ generator: { app: "VellumDesk" } });
    const c = stub.canWrite(man, true); // --force → 允
    fs.rmSync(man);
    const d = stub.canWrite(man, false); // 空目录 → 允
    write({ contract: "vellum-link/1", generator: { app: "VellumDesk" } });
    const e = stub.canWrite(man, true); // --force + 真镜像 → 允（user 明确的意图）
    fs.rmSync(tmp, { recursive: true, force: true });

    const src = fs.readFileSync(path.join(__dirname, "fake-vellumdesk.cjs"), "utf8");
    const callCount = (src.match(/assertNotClobbering\(\);/g) || []).length;
    const exits3 = src.indexOf("process.exit(3)") >= 0;
    const guarded = callCount === 2 && exits3;

    check(
      "44 假软件桩拒绝覆盖真镜像（canWrite 单测 + 两条写路径都接了闸）",
      a.ok === false && a.reason === "foreign" &&
        b.ok === true && c.ok === true && d.ok === true && e.ok === true && guarded,
      "真 manifest→" + (a.ok ? "允许" : "拒绝") + "（须拒绝）" +
        "　fixture→" + (b.ok ? "允许" : "拒绝") + "（须允许）" +
        "　--force→" + (c.ok ? "允许" : "拒绝") + "（须允许）" +
        "　空目录→" + (d.ok ? "允许" : "拒绝") + "（须允许）" +
        "　‖ 源码闸：assertNotClobbering() 调用 " + callCount + " 处（须 2：正常写 + --clean）" +
        "　process.exit(3)=" + exits3
    );
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
