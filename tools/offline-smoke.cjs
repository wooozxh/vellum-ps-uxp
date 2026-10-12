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
  /* v0.4.2：支持 `el.onclick = fn` 这种**属性式**绑定。
     ⚠️ 这不是给 mock 加特权 —— 真机上确实支持：S41 点折叠块标题就是走
     `gh.onclick = …` + syntheticClick，真机两轮都真的展开了（说明 UXP 认这个写法）。
     之前 mock 只有 addEventListener，于是 tools/table.js 的按钮在离线**点不动**。 */
  set onclick(fn) {
    if (!this._listeners) this._listeners = Object.create(null);
    if (fn) this._listeners.click = [fn];
    else delete this._listeners.click;
  }
  get onclick() {
    const a = this._listeners && this._listeners.click;
    return (a && a[0]) || null;
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

/* v0.4.2：把**插件自带**的样例真读进虚拟盘，模拟 `getPluginFolder()`。
   这样离线也能点面板里的「内置样例」，跑完整条"读字节 → 解码 → 预览"链路
   （系统文件选择器自动化点不了，只能靠这条同源入口补上行为断言）。
   ⚠️ mock 的二进制读是 `String(v)` + `charCodeAt` 还原字节 ⇒ 这里必须用 **latin1**
   （一字符 = 一字节）读，才能逐字节一致 —— GBK 那份错一个字节，"中文"就整片解错。 */
try {
  const sampleDir = path.join(PKG, "samples");
  dirs["samples"] = true;
  for (const f of fs.readdirSync(sampleDir)) {
    files["samples/" + f] = fs.readFileSync(path.join(sampleDir, f), "latin1");
  }
} catch (e) {
  console.log("（离线：插件样例目录读不到，22d 会失败）" + ((e && e.message) || e));
}

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
/* v0.4.1：再记**整批**命令（`batchPlay` 收到的是数组，`sentCalls` 只留了第一条）。
   用途：给 M3「生成表格」做**命令形状离线断言** —— 这是纪律：
   "新描述符先写命令形状离线断言"，因为 v0.4.0 就是靠推理往 `make textLayer` 里
   塞了两个没验过的键，真机上直接把 PS 卡进模态。 */
const sentBatches = [];
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

/**
 * 模拟一条 `duplicate`（M3b 出稿唯一的 AM 命令）。
 * 够真是指：新层的 id **大于调用前的最大 id**（exportByRows 就靠这个"只认新层"），
 * 并把模板的文字层**克隆**一份（内容独立 ⇒ 才能验"改副本不动原件"）。
 */
function simDuplicate(cmd) {
  const doc = mockApp.documents[0];
  if (!doc || !cmd._target || typeof cmd._target[0]._id !== "number") return;
  let tpl = null;
  const find = (arr) => {
    for (const l of arr || []) {
      if (l.id === cmd._target[0]._id) { tpl = l; return; }
      if (l.layers && l.layers.length) find(l.layers);
    }
  };
  find(doc.layers);
  if (!tpl) return;
  let mx = 0;
  const scan = (arr) => {
    for (const l of arr || []) {
      if (typeof l.id === "number" && l.id > mx) mx = l.id;
      if (l.layers && l.layers.length) scan(l.layers);
    }
  };
  scan(doc.layers);
  let next = mx + 1;
  const kids = [];
  const walkKids = (arr) => {
    for (const k of arr || []) {
      if (k.kind === "text") {
        kids.push({ id: next++, name: k.name, kind: "text", textItem: { contents: k.textItem ? k.textItem.contents : "" } });
      }
      if (k.layers && k.layers.length) walkKids(k.layers);
    }
  };
  walkKids(tpl.layers);
  doc.layers.push({
    id: next++, name: String(cmd.name === undefined ? tpl.name + " 副本" : cmd.name), kind: "group",
    layers: kids, moved: null,
    translate(dx, dy) { this.moved = [dx, dy]; },
  });
}

const mockPhotoshop = {
  app: mockApp,
  core: { executeAsModal: async (fn) => fn() },
  action: {
    async batchPlay(cmds) {
      const c = cmds[0];
      sentCalls.push(c);
      if (Array.isArray(cmds) && cmds.length) sentBatches.push(cmds.slice());
      /* v0.5.0：**按顺序模拟每一条** duplicate（M3b 是一批发 N 条 —— 只处理第一条会少建副本） */
      for (const cc of (Array.isArray(cmds) ? cmds : [])) {
        if (cc && cc._obj === "duplicate" && cc._target && cc._target[0] && cc._target[0]._ref === "layer") {
          simDuplicate(cc);
        }
      }
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
      /* v0.5.0：模拟 `duplicate`（M3b 出稿的唯一 AM 命令）。
         不模拟的话"复制完在新模态里读副本"这条链路在离线**根本测不了**
         （副本不存在 ⇒ 一份都找不到 ⇒ 断言只会看到 0）。
         模拟要够真：新层的 id **大于**调用前的最大 id（exportByRows 就是靠这个只认新层），
         并且把模板的文字层**克隆**一份（文字层内容独立，才能验"改副本不动原件"）。 */
      if (false && c._obj === "duplicate" && t0 && t0._ref === "layer" && typeof t0._id === "number") {
        const doc = mockApp.documents[0];
        let tpl = null;
        const find = (arr) => {
          for (const l of arr || []) {
            if (l.id === t0._id) { tpl = l; return; }
            if (l.layers && l.layers.length) find(l.layers);
          }
        };
        if (doc) find(doc.layers);
        if (tpl) {
          let mx = 0;
          const scan = (arr) => {
            for (const l of arr || []) { if (typeof l.id === "number" && l.id > mx) mx = l.id; if (l.layers && l.layers.length) scan(l.layers); }
          };
          scan(doc.layers);
          let next = mx + 1;
          const cloneText = (src) => {
            const o = { id: next++, name: src.name, kind: "text", textItem: { contents: src.textItem ? src.textItem.contents : "" } };
            return o;
          };
          const kids = [];
          const walkKids = (arr) => {
            for (const k of arr || []) {
              if (k.kind === "text") kids.push(cloneText(k));
              if (k.layers && k.layers.length) walkKids(k.layers);
            }
          };
          walkKids(tpl.layers);
          const copy = {
            id: next++, name: String(c.name === undefined ? tpl.name + " 副本" : c.name), kind: "group",
            layers: kids, moved: null,
            translate(dx, dy) { this.moved = [dx, dy]; },
          };
          doc.layers.push(copy);       // 真机上副本落在**同一个父级**
        }
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
  /* v0.6.0：状态条拆成「常驻体检 chip（定高）+ 可滚动消息区」两行。
     ⚠️ **必须与 index.html 的结构逐字对齐** —— 否则 `dom.$("vt-status-tx")` 取到 null，
        `setStatus()` 写了个空，离线就会误报"状态栏没消息"。
        （本轮 16 / 19 / 20 三条就是这么挂的：mock 还是旧的单节点。） */
  const status = mk("div", "vt-status", "statusbar");
  const vchip = mk("div", "vt-inspect", "vchip");
  vchip.setAttribute("role", "button");
  vchip.appendChild(mk("i", "vt-inspect-led", "led off"));
  vchip.appendChild(mk("span", "vt-inspect-tx", "vchip-tx"));
  status.appendChild(vchip);
  /* v0.6.0：撤销入口（与 index.html 的 `#vt-undo` 逐字对齐）。
     ⚠️ 它在真 HTML 上默认是**内联 display:none** —— mock 里也照做，
        否则"默认不显示"这条行为在离线就测不到（正是上一轮 mock 脱节的同族坑）。 */
  const vundo = mk("div", "vt-undo", "vchip is-act");
  vundo.setAttribute("role", "button");
  vundo.style.display = "none";
  vundo.appendChild(mk("i", "vt-undo-led", "led"));
  vundo.appendChild(mk("span", "vt-undo-tx", "vchip-tx"));
  status.appendChild(vundo);
  status.appendChild(mk("div", "vt-status-tx", "stx"));
  app.appendChild(status);
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

  /* ⚠️ v0.6.0 改法：原来这里**写死了 4 行与 4 个名字**，于是"往宫格加一行"必然打断它。
     既不该每次加行都回来改数字（脆），也不该干脆不验（松）。
     现在改成**与注册表逐行对齐**：行数、顺序、data-tool、名称四项都要对上 ——
     这比原来的"名字等于某个字符串"**更强**（原来根本没验顺序和 data-tool），
     而且加行/改名时它自动跟着走。 */
  const registry0 = require(path.join(PKG, "tools", "index.js"));
  const expectRows = registry0.allRows();
  const expectIds = expectRows.map((r) => r.id);
  const expectNames = expectRows.map((r) => r.title);
  const navIds = Array.prototype.map.call(navs, (n) => n.getAttribute("data-tool"));
  const navNames = Array.prototype.map.call(navs, (n) => {
    const nm = n.querySelector(".ni-name");
    return nm ? nm.textContent : "?";
  });

  check(
    "2 外壳 init：首页按注册表逐行渲染（行数 / 顺序 / data-tool / 名称全对得上）",
    navs.length === expectRows.length &&
      navIds.join(",") === expectIds.join(",") &&
      navNames.join(" / ") === expectNames.join(" / "),
    "渲染 " + navs.length + " 行（注册表 " + expectRows.length + " 项）\n" +
      "        渲染 ids = " + navIds.join(",") + "\n" +
      "        期望 ids = " + expectIds.join(",") + "\n" +
      "        渲染名称 = " + navNames.join(" / ") + "\n" +
      "        期望名称 = " + expectNames.join(" / ")
  );

  /* 2b 改成验**「已实现」与「规划中」有没有被正确区分**（灰行 class）——
     这是原来那条"名字字符串相等"完全没覆盖的东西，也是首页最要紧的视觉语义：
     已实现的必须点得动，规划中的必须灰着 + 点了给提示。 */
  const rowOf = (id) => {
    for (let i = 0; i < navs.length; i++) {
      if (navs[i].getAttribute("data-tool") === id) return navs[i];
    }
    return null;
  };
  const isGrey = (row) => !!row && String(row.getAttribute("class") || "").indexOf("is-planned") >= 0;
  const implBad = registry0.tools.filter((t) => isGrey(rowOf(t.id))).map((t) => t.id);
  const planBad = registry0.planned.filter((p) => !isGrey(rowOf(p.id))).map((p) => p.id);
  const chipCount = home ? home.querySelectorAll(".ni-key").length : 0;
  check(
    "2b 首页区分「已实现 / 规划中」：已实现的不灰（可点）、规划的灰着；每行都有号位 chip",
    implBad.length === 0 && planBad.length === 0 && chipCount === navs.length && navs.length > 0,
    "已实现 " + registry0.tools.map((t) => t.id).join(",") + " 全部可点 = " + (implBad.length === 0) +
      (implBad.length ? "（误灰：" + implBad.join(",") + "）" : "") +
      "　规划中 " + registry0.planned.map((p) => p.id).join(",") + " 全部灰行 = " + (planBad.length === 0) +
      (planBad.length ? "（漏灰：" + planBad.join(",") + "）" : "") +
      "　号位 chip = " + chipCount + "（须 = 行数 " + navs.length + "）"
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

  /* ---- 22b. 表格生成（M3a）已上线：注册表 + 首页第 3 行可点 ----
     （和第 22 条同一个判据：别让"首页少一行 / 还灰着"这种错跑到真机上才发现） */
  {
    const registry = require(path.join(PKG, "tools", "index.js"));
    const ids = registry.tools.map((t) => t.id);
    const inPlanned = registry.planned.some((p) => p.id === "table");
    const tMod = registry.byId("table");
    const row3 = navs.length >= 3 ? navs[2] : null;
    const row3Key = row3 ? row3.getAttribute("data-tool") : null;
    const stillPlanned = row3
      ? String(row3.getAttribute("class") || "").indexOf("is-planned") >= 0
      : true;
    check(
      "22b 表格生成已上线：registry.tools 里 + ready + 首页第 3 行可点（M4 仍是灰行）",
      ids.indexOf("table") >= 0 && !inPlanned && !!tMod && tMod.ready === true &&
        typeof tMod.mount === "function" && typeof tMod.unmount === "function" &&
        row3Key === "table" && !stillPlanned &&
        /* ⚠️ 原来这里写死 `planned.length === 1` —— 加一行规划项就会打断它。
           改成只断言**真正要保的那件事**：M4 的 mcp 仍然灰着（待排期）。 */
        registry.planned.some((p) => p.id === "mcp"),
      "tools=" + ids.join(",") + "　planned=" + registry.planned.map((p) => p.id).join(",") +
        "　第 3 行 data-tool=" + row3Key + "　仍标 is-planned=" + stillPlanned
    );
  }

  /* ---- 22c. 表格面板：**离线挂载一次**（真机 S41 的前哨） ----
     离线验不到 CSS 渲染效果，但能验到"挂载过程不抛异常 + S41 依赖的选择器都在"
     —— 免得真机上那一堆 FAIL 其实只是我改了 id。 */
  {
    const tMod = require(path.join(PKG, "tools", "table.js"));
    let mountErr = null;
    try {
      await tMod.mount(view, { setStatus() {} });
      await sleep(200);
    } catch (e) {
      mountErr = (e && e.message) || String(e);
    }
    const wantIds = [
      "vt-tbl", "vt-tbl-src", "vt-tbl-grid", "vt-tbl-body", "vt-tbl-foot",
      "vt-tbl-g1", "vt-tbl-g2", "vt-tbl-g3", "vt-tbl-styletabs",
      "vt-tbl-import", "vt-tbl-gen", "vt-tbl-docs", "vt-tbl-estimate",
    ];
    const missing = wantIds.filter((id) => !document.getElementById(id));
    check(
      "22c 表格面板：离线能挂起来 + S41 要量的选择器齐备",
      mountErr === null && missing.length === 0,
      (mountErr ? "挂载抛异常：" + mountErr + "　" : "挂载不抛异常　") +
        "选择器缺 " + missing.length + (missing.length ? "=[" + missing.join(",") + "]" : "") +
        "　（画面效果与几何仍只能上真机，见 S41）"
    );
    try {
      tMod.unmount();
    } catch {
      /* 忽略 */
    }
  }

  /* ---- 22d. 内置样例：**真点一次「GBK」芯片**（v0.4.2）
     系统文件选择器自动化点不了 ⇒ 面板上给了一条"不弹窗"的同源入口
     （只有"怎么拿到字节"不同：`getPluginFolder()` 而非 `getFileForOpening()`）。
     这里测 **GBK** —— 三种编码里最容易踩的那种，也正是 v0.3.9 花了一整轮做的表。
     判据用**独立算出来的期望值**（7 行 / 首格「开学季特训营」），不复用模块的中间结果。 */
  {
    const tMod = require(path.join(PKG, "tools", "table.js"));
    let err = null;
    try {
      await tMod.mount(view, { setStatus() {} });
      await sleep(200);
      const chip = document.getElementById("vt-tbl-sample-gbk");
      if (!chip) {
        err = "找不到 GBK 样例芯片（#vt-tbl-sample-gbk）";
      } else {
        chip.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
        for (let i = 0; i < 40; i++) {
          const g = document.getElementById("vt-tbl-grid");
          if (g && g.children.length > 1) break;
          await sleep(50);
        }
      }
    } catch (e) {
      err = (e && e.message) || String(e);
    }

    const srcTxt = (document.getElementById("vt-tbl-src") || {}).textContent || "";
    const encTxt = (document.getElementById("vt-tbl-enc") || {}).textContent || "";
    const grid = document.getElementById("vt-tbl-grid");
    const rows = grid ? grid.children.length : 0;
    // 期望值自己算：样例 7 行 CSV（1 表头 + 6 数据），预览渲染的是"表头 + 全部数据行"
    const firstCell = grid && grid.children[1] && grid.children[1].children[0]
      ? String(grid.children[1].children[0].textContent || "") : "";

    check(
      "22d 内置样例（GBK）：点芯片 → 读字节 → 查表解码 → 预览渲染",
      err === null && String(srcTxt).indexOf("prices-2026-gbk.csv") >= 0 &&
        String(encTxt).indexOf("GBK") >= 0 && rows === 7 && firstCell === "开学季特训营",
      (err ? "异常：" + err + "　" : "") +
        "源行=" + JSON.stringify(String(srcTxt).slice(0, 34)) +
        "　编码行=" + JSON.stringify(String(encTxt).slice(0, 26)) +
        "　预览行数=" + rows + "（须 7 = 表头 + 6 数据）" +
        "　首个数据格=" + JSON.stringify(firstCell) + "（须 「开学季特训营」）"
    );
    try {
      tMod.unmount();
    } catch {
      /* 忽略 */
    }
  }

  /* ---- 22e. 用户报的 5 个界面缺陷：逐条离线防回归（v0.4.4） ----
     来源：2026-10-11 用户在真机上跑完 M3a 后的 5 条反馈。每条都对应一个**具体的错**，
     所以每条都要有一条能独立失败的判据 —— 别合并成一个"界面看起来对"。 */
  {
    const tMod = require(path.join(PKG, "tools", "table.js"));
    await tMod.mount(view, { setStatus() {} });
    await sleep(200);

    /* ① 折叠块标题：用户第 4 条要求「画在哪儿」→「置入方式」 */
    const g1 = document.getElementById("vt-tbl-g1");
    const g1Title = g1 && g1.children[0] && g1.children[0].children[0]
      ? String(g1.children[0].children[0].textContent || "") : "(没有 g1 标题)";

    /* ② 用户第 5 条：那个自绘折角在真机上退化成**实心黑方块** ⇒ 整个去掉 */
    const cvCount = document.querySelectorAll(".tbl-gh .cv").length;

    /* ③ 用户第 3 条：水平 + 垂直对齐，**表头与行两个 tab 都要有**、文案要写全。
       ⚠️ 样式的三个 tab 是"只渲染当前那个 pane"的 ⇒ 必须**逐个切过去**再验；
       一开始我在切到「行」之后才去抓「表头」的控件，抓到的是空数组（自己踩的）。 */
    const hWant = ["左对齐", "水平居中", "右对齐"];
    const vWant = ["顶对齐", "垂直居中", "底对齐"];
    const has = (arr, want) => want.every((t) => arr.indexOf(t) >= 0);
    const segText = (id) => {
      const e = document.getElementById(id);
      if (!e || !e.children) return [];
      return Array.prototype.slice.call(e.children).map((c) => String(c.textContent || ""));
    };
    const tabs = document.getElementById("vt-tbl-styletabs");
    let labelsOk = false;
    let labelsNote = "找不到样式 tab";
    let segOk = false;
    let segNote = "未执行";
    if (tabs && tabs.children.length >= 3) {
      // ---- 「表头」tab ----
      tabs.children[1].dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      await sleep(60);
      const hl1 = segText("vt-tbl-halign");
      const hv1 = segText("vt-tbl-hvalign");
      // ---- 「行」tab ----
      tabs.children[2].dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      await sleep(60);
      const hl2 = segText("vt-tbl-ralign");
      const hv2 = segText("vt-tbl-rvalign");
      labelsOk = has(hl1, hWant) && has(hv1, vWant) && has(hl2, hWant) && has(hv2, vWant);
      labelsNote = "表头=" + JSON.stringify(hl1) + " / " + JSON.stringify(hv1) +
        "　行=" + JSON.stringify(hl2) + " / " + JSON.stringify(hv2);

      /* ④ 用户第 2 条：改了选项 UI 高亮必须**当场**挪过去（原来的 bug 要切 tab 才更新） */
      const seg = document.getElementById("vt-tbl-rvalign");
      if (seg && seg.children && seg.children.length === 3) {
        const c0Before = String(seg.children[0].getAttribute("class") || "");
        seg.children[2].dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
        const c0 = String(seg.children[0].getAttribute("class") || "");
        const c2 = String(seg.children[2].getAttribute("class") || "");
        segOk = c2.indexOf("on") >= 0 && c0.indexOf("on") < 0;
        segNote = "点前[0]=" + JSON.stringify(c0Before) + "　点后[0]=" + JSON.stringify(c0) + "、[2]=" + JSON.stringify(c2);
      } else {
        segNote = "找不到 #vt-tbl-rvalign（或不是 3 项）";
      }
    }

    /* ⑤ 用户第 1 条：内边距那一行的 4 个步进器必须是**紧凑版**（否则会被压扁、灰字压数字） */
    const padIds = ["vt-tbl-pad-t", "vt-tbl-pad-r", "vt-tbl-pad-b", "vt-tbl-pad-l"];
    const padMiss = padIds.filter((id) => !document.getElementById(id));
    const padCpt = padIds.filter((id) => {
      const e = document.getElementById(id);
      return e && String(e.getAttribute("class") || "").indexOf("cpt") >= 0;
    }).length;

    check(
      "22e 用户报的 5 条界面缺陷：标题/折角/高亮/紧凑步进器/对齐标签",
      g1Title === "置入方式" && cvCount === 0 && segOk &&
        padMiss.length === 0 && padCpt === 4 && labelsOk,
      "①标题（第4条）=" + JSON.stringify(g1Title) + "（须「置入方式」）" +
        "　②折角元素数（第5条）=" + cvCount + "（须 0：UXP 不支持透明边框，它会变黑方块）" +
        "　③段控件高亮自更新（第2条）=" + segOk + "（" + segNote + "）" +
        "　④内边距紧凑步进器（第1条）缺 " + padMiss.length + "、紧凑版 " + padCpt + "/4" +
        "　⑤水平+垂直对齐文案（第3条）=" + labelsOk + "（" + labelsNote + "）"
    );
    /* 🔴 故意"点完立刻 unmount"：第一次跑这里时整个脚本**崩了** ——
       `refreshRegion()` 是异步的，unmount 把 `S` 置 null 之后它才回来赋值 ⇒
       `TypeError: Cannot set properties of null (setting 'region')`。
       真机上"点一下样式马上切走工具"是同一个坑。现在面板里所有 async 回调都过 `alive()`；
       **这条用例的判据就是"脚本能跑到收尾"** —— 崩了整轮会响亮地死在这里。 */
    try {
      tMod.unmount();
    } catch {
      /* 忽略 */
    }
    await sleep(120);
  }

  /* ---- 22f. CSS 源码防回归（v0.4.4 起，v0.4.6 换成"宽度必须写死"） ----
     两条都是"UXP 特性没实现"踩出来的：
       ① flex **容器**算自身尺寸时不认 `flex-basis` ⇒ `[−][12][+]` 的边框盒只画了 32px
          （真机字符画证明：**子元素位置是对的**，只有边框盒小了）⇒ 宽度必须写死；
       ② UXP 不支持透明边框 ⇒ 折角三角画出来是个实心黑方块。
     ⚠️ 这里只防"CSS 被改回去"；**真机上的实际几何由 S44 量**（量 != 读源码）。 */
  {
    const html = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const w88 = /\.tnum\s*\{[^}]*width:\s*88px/.test(html);
    const w64 = /\.tnum\.cpt\s*\{\s*width:\s*64px/.test(html);
    const basis = /\.tnum\s+\.mn,\s*\.tnum\s+\.pl\s*\{[^}]*flex:\s*0\s+0\s+22px/.test(html) &&
      /\.tnum\s+\.vl\s*\{[^}]*flex:\s*0\s+0\s+42px/.test(html) &&
      /\.tnum\.cpt\s+\.vl\s*\{[^}]*flex:\s*0\s+0\s+30px/.test(html);
    const noCv = html.indexOf(".tbl-gh .cv") < 0;
    check(
      "22f CSS 防回归：步进器宽度必须写死（UXP 不认 flex-basis）+ 折角三角已删",
      w88 && w64 && basis && noCv,
      "`.tnum{width:88px}`=" + w88 + "　`.tnum.cpt{width:64px}`=" + w64 +
        "（88 = 1+22+42+22+1；64 = 1+16+30+16+1）　子格 22/42/22=" + basis +
        "　`.tbl-gh .cv` 已删=" + noCv +
        "　⇒ 宽度写死是「灰字压数字」的根因修法（子元素位置本来就对，是边框盒只画了 32px）；" +
        "透明边框那条在真机上是实心黑方块"
    );
  }

  /* ---- 22g. 垂直对齐 / 单位换算的**纯函数**判据（v0.4.6：改成"按**墨迹**对齐"） ----
     期望值**全部独立算**，常数按真机实测**写死在测试里**（不从被测模块读 `INK_MID`）——
     否则"改了常量测试跟着变"，等于没测。
       墨迹中心 = 箱顶 + 0.40em　墨迹底边 = 箱顶 + 0.82em　箱高 = 1em
     表头行 y 100–130、数据行 130–158、内边距上下各 4 ⇒ 表头内容区 104–126、数据行 134–154。
     ppi 的关键性质：**画面上文字的位置/箱高与 ppi 无关**（全用画布 px），变的只是交给 PS 的 pt。 */
  {
    const tmod = require(path.join(PKG, "lib", "table.js"));
    const rows = [["名称", "价格"], ["图一", "1.20"], ["图二", "3.40"]];
    const mk = (style, ppi) => tmod.layoutTable({
      header: rows[0], body: rows.slice(1),
      region: { left: 100, top: 100, right: 300, bottom: 260 },
      style: style, ppi: ppi,
    });
    const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.01 : tol);
    const INK_MID = 0.40, INK_BOT = 0.82, EM = 12;      // 真机实测常数，独立写死
    const hTop = 104, hBot = 126, bTop = 134, bBot = 154; // 上下内边距 4 独立算出来的内容区
    const mid = mk({}, 72);
    const top = mk({ headerVAlign: "top", rowVAlign: "top" }, 72);
    const bot = mk({ headerVAlign: "bottom", rowVAlign: "bottom" }, 72);
    const h0 = mid.cells[0];   // 表头格
    const b0 = mid.cells[2];   // 第一数据行

    // ① 箱高 = 1em（老实现是 1.32em，白吃掉 0.32em 的可调空间）
    const boxOk = near(h0.box.bottom - h0.box.top, EM) && near(b0.box.bottom - b0.box.top, EM) &&
      near(b0.boxH, EM);
    // ② 垂直居中 = **墨迹**中心落在行中心（墨迹中心 = **箱顶** + 0.40em，不是箱中心！）
    const midOk = h0.valign === "middle" &&
      near(h0.box.top, (hTop + hBot) / 2 - INK_MID * EM) &&
      near(b0.box.top, (bTop + bBot) / 2 - INK_MID * EM) &&
      near(h0.box.top + INK_MID * EM, (hTop + hBot) / 2) &&
      near(b0.box.top + INK_MID * EM, (bTop + bBot) / 2);
    // ③ 顶对齐 = 框顶贴内边距线
    const topOk = near(top.cells[0].box.top, hTop, 0.5) && near(top.cells[2].box.top, bTop, 0.5);
    // ④ 底对齐 = 墨迹底边贴下内边距线（箱顶 = 内容区底 − 0.82em）
    const botOk = near(bot.cells[0].box.top, hBot - INK_BOT * EM, 0.5) &&
      near(bot.cells[2].box.top, bBot - INK_BOT * EM, 0.5);
    // ⑤ 位移：既等于独立算的值，又等于面板上显示给用户的那个数，还要**大于老实现**（4.16px）
    const travel = bot.cells[2].box.top - top.cells[2].box.top;
    const travelWant = (bBot - INK_BOT * EM) - bTop;
    const travelOk = near(travel, travelWant, 0.05) && near(tmod.inkTravel({}), travel, 0.05) &&
      travel > 4.2 && near(tmod.inkTravel({ rowH: 60, fontPx: 18 }), (60 - 8 - INK_BOT * 18), 0.05);
    // ⑥ ppi：画布上的箱高不变，只有交给 PS 的 pt 变
    const p300 = mk({}, 300);
    const ppiOk = near(p300.cells[0].box.bottom - p300.cells[0].box.top, EM) &&
      near(p300.cells[0].sizePt, 12 * 72 / 300) &&
      near(mk({}, 600).cells[0].sizePt, 12 * 72 / 600);
    const alignOk = mk({ headerAlign: "left", rowAlign: "right" }, 72).cells.map((c) => c.align).join(",") ===
      "left,left,right,right,right,right";

    check(
      "22g 垂直对齐（按墨迹的纯几何）+ 字号按画布像素（pt 随 ppi 折算）",
      boxOk && midOk && topOk && botOk && travelOk && ppiOk && alignOk,
      "①箱高=" + (b0.box.bottom - b0.box.top) + "（须 1em=12；老实现 1.32em=15.84）" +
        "　②居中：表头框顶 " + h0.box.top + "（须 " + ((hTop + hBot) / 2 - INK_MID * EM) + "）、数据行 " + b0.box.top +
        "（须 " + ((bTop + bBot) / 2 - INK_MID * EM) + "），墨迹中心=" + (b0.box.top + INK_MID * EM) + "（须 = 行中心 144）" +
        "　③顶对齐：" + top.cells[0].box.top + " / " + top.cells[2].box.top + "（须 104 / 134）" +
        "　④底对齐：框顶 " + bot.cells[0].box.top + " / " + bot.cells[2].box.top + "（须 116.16 / 144.16）" +
        "　⑤位移 " + travel + "px（独立算 " + travelWant + "、面板显示 " + tmod.inkTravel({}) + "、须 >4.2）" +
        "　⑥ppi：300ppi 时箱高 " + (p300.cells[0].box.bottom - p300.cells[0].box.top) + "（须不变）且 pt=" + p300.cells[0].sizePt + "（须 2.88）" +
        "　⑦表头/行水平对齐各自独立=" + alignOk
    );
  }

  /* ---- 22h. M3b 批量出稿：计划（纯函数）+ 执行（命令形状与数据流）+ 负对照 ----
     ⚠️ mock 会**真的模拟 `duplicate`**（新层 id 大于调用前的最大 id、克隆模板的文字层）——
        否则"复制完在新模态里读副本"这条链路在离线根本测不了。 */
  try {
    const bmod = require(path.join(PKG, "lib", "batch.js"));
    const psm2 = require(path.join(PKG, "lib", "ps.js"));

    const header = ["名称", "价格", "备注"];
    const rows = [["开学季", "199", "含教材"], ["秋季班", "299", "小班制"], ["", "", "空行"]];
    const tpl = {
      name: "版式", id: 500,
      textLayers: [{ name: "标题", contents: "标题占位", id: 501 }, { name: "价格", contents: "000", id: 502 }],
      rect: { left: 100, top: 100, right: 300, bottom: 250 },
    };
    /* 绑定：第 0 列 → 模板的**第 0 个**文字层（有效）；第 2 列 → 序号 5（越界，该报 warning）；第 1 列没绑 */
    const bind = { 0: 0, 2: 5 };
    const plan = bmod.planExport({ rows: rows, header: header, bindings: bind, tpl: tpl, tplRect: tpl.rect, cols: 5 });

    /* 期望值**独立算**（不许读被测模块的中间结果）：
         有效绑定 = 只有第 0 列 ⇒ 每份 1 处
         写入：第 1 行 标题=开学季 ✓、第 2 行 标题=秋季班 ✓、第 3 行 标题="" ⇒ **跳过** ⇒ 共 2 次
         空格子 = 3×1 − 2 = 1（要出 warning）
         警告 = 绑到不存在的层(1) + 未绑定列(1) + 空格子(1) = 3
         预估 = 2×60 + 3×19 + 3×40 = 297ms
         网格：模板 200×150、gap = max(16, round(150×0.08)=12) = 16 ⇒ 步距 216/166
              第 1/2/3 份 → dx 216/432/648、dy 全 166
         名字：前两行取到值，第 3 行没有值 ⇒ 只有序号 */
    const planOk = plan.ok === true && plan.n === 3 && plan.writeCount === 2 && plan.perCopy === 1 &&
      plan.unbound.length === 1 && plan.unbound[0] === 1 &&
      plan.warnings.length === 3 && plan.emptyCells === 1 &&
      plan.copies[0].name === "稿件 1 · 开学季" && plan.copies[1].name === "稿件 2 · 秋季班" &&
      plan.copies[2].name === "稿件 3" &&
      plan.copies[0].dx === 216 && plan.copies[1].dx === 432 && plan.copies[2].dx === 648 &&
      plan.copies[0].dy === 166 && plan.copies[2].dy === 166 &&
      plan.estimatedMs === 297 && plan.tooMany === false;
    check(
      "22h M3b 出稿计划（纯函数）：绑定 / 空格跳过 / 网格 / 命名 / 警告 / 预估（期望值独立算）",
      planOk,
      "n=" + plan.n + "（须 3）写入=" + plan.writeCount + "（须 2，第 3 行空值跳过）每份=" + plan.perCopy + "（须 1）" +
      "　未绑定列=" + JSON.stringify(plan.unbound) + "（须 [1]）　警告 " + plan.warnings.length + "（须 3）" +
      "　空格 " + plan.emptyCells + "（须 1）" +
      "　名字=" + JSON.stringify(plan.copies.map((c) => c.name)) +
      "　网格 dx=" + JSON.stringify(plan.copies.map((c) => c.dx)) + " dy=" + plan.copies[0].dy +
      "（须 216/432/648 · 166）　预估=" + plan.estimatedMs + "ms（须 297 = 2×60 + 3×19 + 3×40）"
    );

    /* 闸门 + "一列都没绑" 两条负路 */
    const big = bmod.planExport({ rows: new Array(201).fill(["x"]), header: ["a"], bindings: { 0: 0 }, tpl: tpl, tplRect: tpl.rect });
    const none = bmod.planExport({ rows: rows, header: header, bindings: {}, tpl: tpl, tplRect: tpl.rect });
    const noTpl = bmod.planExport({ rows: rows, header: header, bindings: bind, tpl: null });
    check(
      "22h-2 M3b 闸门与拒绝：超份数给 tooMany（不静默截断）/ 一列没绑要拒 / 没模板要拒且说清原因",
      big.ok === true && big.tooMany === true && none.ok === false && String(none.error).indexOf("标题") >= 0 &&
        noTpl.ok === false && String(noTpl.error).indexOf("模板") >= 0,
      "201 行 → tooMany=" + big.tooMany + "（须 true）　一列没绑 → " + JSON.stringify(none.error) +
      "　没模板 → " + JSON.stringify(noTpl.error)
    );

    /* ── 执行层（mock 会真的模拟复制，所以整条链路能跑）── */
    const mkDoc = () => {
      const tplG = {
        id: 500, name: "版式", kind: "group",
        layers: [
          { id: 501, name: "标题", kind: "text", textItem: { contents: "标题占位" } },
          { id: 502, name: "价格", kind: "text", textItem: { contents: "000" } },
        ],
      };
      return { id: 950, name: "出稿文档", mode: "RGB", activeLayers: [tplG], layers: [tplG] };
    };
    mockApp.documents.length = 0;
    mockApp.documents.push(mkDoc());
    sentBatches.length = 0;
    sentCalls.length = 0;

    const r = await psm2.exportByRows(plan, { tplId: 500 });
    const batch1 = sentBatches[0] || [];
    const dupShapeOk = (c) => !!(c && c._obj === "duplicate" && c._target && c._target[0]._ref === "layer" &&
      typeof c._target[0]._id === "number" && typeof c.name === "string");
    const moveShapeOk = (c) => !!(c && c._obj === "move" && c._target && c._target[0]._ref === "layer" &&
      typeof c._target[0]._id === "number" && c.to && c.to._obj === "offset" &&
      c.to.horizontal && c.to.vertical);
    const batch2 = sentBatches[1] || [];
    /* 位移也必须**一次批**、且值等于计划里的 dx/dy（DOM translate 对这个组不生效 ⇒ 走 AM move） */
    /* 位移是**逐叶层**发的（组当 target 只动一个子层 —— 真机实测）⇒ 3 份 × 每份 2 个文字层 = 6 条 */
    const moveOk2 = batch2.length === 6 && batch2.every(moveShapeOk) &&
      batch2[0].to.horizontal._value === plan.copies[0].dx && batch2[0].to.vertical._value === plan.copies[0].dy &&
      batch2[1].to.horizontal._value === plan.copies[0].dx &&
      batch2[4].to.horizontal._value === plan.copies[2].dx && batch2[5].to.horizontal._value === plan.copies[2].dx;
    const dupOk = sentBatches.length === 1 && batch1.length === 3 && batch1.every(dupShapeOk);   // 只发复制那批

    const doc2 = mockApp.documents[0];
    const pick = (nm) => doc2.layers.filter((l) => l.name === nm)[0];
    const c1 = pick("稿件 1 · 开学季");
    const c2 = pick("稿件 2 · 秋季班");
    const c3 = pick("稿件 3");
    const txt = (cp, n) => {
      if (!cp) return "(缺副本)";
      const l = (cp.layers || []).filter((k) => k.name === n)[0];
      return l ? String(l.textItem.contents) : "(缺层)";
    };
    const tplG = pick("版式");
    const tplIntact = txt(tplG, "标题") === "标题占位" && txt(tplG, "价格") === "000";
    const flowOk = dupOk && r.ok === true && r.copies === 3 && r.writes === 2 &&
      txt(c1, "标题") === "开学季" && txt(c2, "标题") === "秋季班" &&
      txt(c3, "标题") === "标题占位" &&          // 空值 ⇒ 保留模板原文
      txt(c1, "价格") === "000" &&                // 未绑定的列不许被动
      tplIntact === true &&
      c1 && c1.moved && c1.moved[0] === 216 && c1.moved[1] === 166 &&
      c3 && c3.moved && c3.moved[0] === 648;
    check(
      "22h-3 M3b 执行：一次 batchPlay 只发 duplicate（按 _id）+ 每份写**自己那一行**的值 + 未绑定列不动 + 原件不动 + 网格位移",
      dupOk && flowOk,
      "批次数=" + sentBatches.length + "（须 1：只发复制）　复制命令 " + batch1.length + " 条全按 _id=" + dupOk +
      "　位移（DOM translate，mock 记录）=" + JSON.stringify([c1 && c1.moved, c3 && c3.moved]) +
      "　copies=" + r.copies + "/3　writes=" + r.writes + "/2　dup=" + r.dupMs + "ms step2=" + r.step2Ms +
      "ms（写 " + r.writesMs + " / 移动 " + r.moveMs + "）" +
      "　第1份标题=" + JSON.stringify(txt(c1, "标题")) + "（须 开学季）" +
      "　第2份标题=" + JSON.stringify(txt(c2, "标题")) + "（须 秋季班）" +
      "　第3份标题=" + JSON.stringify(txt(c3, "标题")) + "（须保留模板原文）" +
      "　未绑定列（价格）=" + JSON.stringify(txt(c1, "价格")) + "（须 000 不动）" +
      "　原件没动=" + tplIntact + "　AM move 批（应为 0）=" + batch2.length
    );

    /* 负对照：duplicate 判据不许放过"按名字选层"或漏了名字的 */
    const poison = [
      { _obj: "duplicate", _target: [{ _ref: "layer", _name: "版式" }], name: "x" },   // 按名字（没验过）
      { _obj: "duplicate", _target: [{ _ref: "layer", _id: 500 }], name: "x" },        // 合规（必须命中）
      { _obj: "duplicate", _target: [{ _ref: "layer", _id: 500 }] },                   // 没给名字
      { _obj: "make", _target: [{ _ref: "layer" }], name: "x" },                       // 别的命令
    ];
    check(
      "22h-4 M3b 判据自证（负对照）：duplicate 判据只放过「按 _id 且带名字」那一条",
      poison.filter(dupShapeOk).length === 1,
      "4 条构造命令里命中 " + poison.filter(dupShapeOk).length + " 条（必须**正好 1**）"
    );

    mockApp.documents.length = 0;
  } catch (e) {
    check("M3b 离线断言（自身抛异常）", false, (e && e.message) || String(e));
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
        gridBlock.indexOf("flex") >= 0 &&
        gridBlock.indexOf("gap") < 0 &&
        // v0.3.4 瀑布流：两列容器在，不再靠 flex-wrap（wrap 会按行高对齐、就不是瀑布流了）
        css.indexOf(".lib-col") >= 0,
      "源码含 display:grid=" + (src.indexOf("display:grid") >= 0) +
        "　源码建 <button>=" + badBtn +
        "　.lib-grid 用 flex=" + (gridBlock.indexOf("flex") >= 0) +
        "　.lib-grid 含 gap=" + (gridBlock.indexOf("gap") >= 0) +
        "　两列容器 .lib-col=" + (css.indexOf(".lib-col") >= 0)
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

  /* ---- 37. 素材网格 = 两列瀑布流（v0.3.4 起：列容器 50% + 卡片占满列） ----
     旧版是 `.lib-grid{flex-wrap}` + `.card{width:50%}`；
     瀑布流把"列"提出来做成 `.lib-col`（纵向堆叠），卡片宽度随之变成 100%（占满列）。
     这条断言跟着实现改 —— 判据换的是**结构**，不是把阈值放宽去迎合代码。 */
  {
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const colBlock = (/\.lib-col\s*\{[^}]*\}/.exec(css) || [""])[0];
    const cardBlock = (/\.card\s*\{[^}]*\}/.exec(css) || [""])[0];
    const thBlock = (/\.card-th\s*\{[^}]*\}/.exec(css) || [""])[0];
    const cw = /width:\s*([0-9.]+)%/.exec(colBlock);
    const kw = /width:\s*([0-9.]+)%/.exec(cardBlock);
    const stacked = /flex-direction:\s*column/.test(colBlock);
    const th = /height:\s*(\d+)px/.exec(thBlock);
    check(
      "37 素材网格 = 两列瀑布流（列 50% 纵向堆叠 + 卡片占满列 + 缩略图盒子有保底高）",
      !!cw && Number(cw[1]) === 50 && stacked &&
        !!kw && Number(kw[1]) === 100 &&
        !!th && Number(th[1]) >= 100,
      ".lib-col 宽=" + (cw ? cw[1] + "%" : "?") + "（两列）" +
        "　.lib-col 纵向堆叠=" + stacked +
        "　.card 宽=" + (kw ? kw[1] + "%" : "?") + "（占满所在列）" +
        "　.card-th 保底高=" + (th ? th[1] + "px" : "?") +
        "（实际高度由 JS 按缩略图比例写成 inline style）"
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
    // v0.3.4：卡片现在躺在 `.lib-col` 里，不能再数 grid 的直接子节点（那是两列容器）
    const countCardsIn = (n) => {
      let c = 0;
      if (!n || !n.children) return c;
      for (const k of n.children) {
        const cl = String((k.getAttribute && k.getAttribute("class")) || "");
        if (cl.split(/\s+/)[0] === "card") c++;
        c += countCardsIn(k);
      }
      return c;
    };
    const firstCardIn = (n) => {
      if (!n || !n.children) return null;
      for (const k of n.children) {
        const cl = String((k.getAttribute && k.getAttribute("class")) || "");
        if (cl.split(/\s+/)[0] === "card") return k;
        const d = firstCardIn(k);
        if (d) return d;
      }
      return null;
    };
    const g1 = document.getElementById("vt-lib-grid");
    const cardsTask = g1 ? countCardsIn(g1) : -1;
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
    click(g2 ? firstCardIn(g2) : null);
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

    /* ---- 47（v0.3.4）：通用库不再画重复的「来源」行 ----
       一级分组（公司素材 / 我的收藏）**就是** source（company / user）的另一种叫法，
       两行同时出现说的是同一件事 —— 用户 2026-10-11 报「这些和上面有些重复了」。 */
    const barTxt = bar ? String(bar.textContent || "") : "";
    const srcRowShown = barTxt.indexOf("来源") >= 0;
    check(
      "47 通用库不再画重复的「来源」行（一级分组已经是来源）",
      bar ? !srcRowShown : false,
      "筛选区里出现「来源」行=" + srcRowShown + "　‖ 结构=" + barSig()
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

  /* ---- 45. 素材库「固定区 + 单滚动区」结构（v0.3.3） ----
     用户要求：「滚动条应当嵌入瀑布流中，不然会导致置入下面的图还要跑回顶部点击置入」。
     做法：页面**绝对定位撑满** `.scroll`，拆成 flex 纵向的「固定区 + 滚动区」，
     只有 `.lib-body`（瀑布流）滚 ⇒ 置入区永远在视野里。
     ⚠️ 这是**结构守门**：以后谁把 `.lib-body` 的 overflow 或 `.s-lib` 的 flex 去掉，
        界面会退化成"整页滚动"，而这种退化在离线看不出来。 */
  {
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const rule = (sel) => {
      const i = css.indexOf(sel);
      if (i < 0) return "";
      const open = css.indexOf("{", i);
      if (open < 0) return "";
      const close = css.indexOf("}", open);
      return close < 0 ? "" : css.slice(open, close);
    };
    const slib = rule(".s-lib {");
    const body = rule(".lib-body {");
    const scrollRule = rule(".scroll {");
    const gi = css.indexOf(".lib-top,");
    let group = "";
    if (gi >= 0) {
      const open = css.indexOf("{", gi);
      const close = css.indexOf("}", open);
      if (open >= 0 && close >= 0) group = css.slice(gi, close);
    }

    const slibOk =
      slib.indexOf("position: absolute") >= 0 &&
      slib.indexOf("display: flex") >= 0 &&
      slib.indexOf("flex-direction: column") >= 0;
    const bodyOk =
      body.indexOf("flex: 1 1 auto") >= 0 &&
      body.indexOf("overflow-y: auto") >= 0 &&
      body.indexOf("min-height: 0") >= 0;
    const groupOk = group.indexOf("flex: 0 0 auto") >= 0 && group.indexOf(".lib-foot") >= 0;
    const scrollOk = scrollRule.indexOf("position: relative") >= 0;

    check(
      "45 素材库：固定区 + 单滚动区（滚动条只进瀑布流，置入区永在视野内）",
      slibOk && bodyOk && groupOk && scrollOk,
      ".s-lib 绝对定位撑满+flex 纵向=" + slibOk +
        "　.lib-body 伸缩+overflow-y:auto+min-height:0=" + bodyOk +
        "　固定区组（含 .lib-foot）flex:0 0 auto=" + groupOk +
        "　.scroll 提供定位上下文=" + scrollOk
    );
  }

  /* ---- 46. 置入「精确落点」：不再靠 offset，改 scale+translate 自校正（v0.3.3） ----
     真机事故：PS 的置入**按物理尺寸**放（源图 300ppi → 72ppi 画布，1500px 只剩 360px），
     而 offset 那套假定"素材在画布上就是它的像素宽高" ⇒ 尺寸与位置**一起错**。
     ⚠️ 断言同时守住"**已经不再传 offset**" —— 否则新旧两条路并存，
        旧路会静默覆盖新路的结果（两者都作用于同一个 placeEvent）。 */
  {
    const psSrc = fs.readFileSync(path.join(PKG, "lib", "ps.js"), "utf8");
    const libSrc = fs.readFileSync(path.join(PKG, "tools", "library.js"), "utf8");

    const hasFn = psSrc.indexOf("async function applyLayerRect(") >= 0;
    const usesScale = psSrc.indexOf("l.scale(pctW, pctH)") >= 0;
    const usesTranslate = psSrc.indexOf("l.translate(dx, dy)") >= 0;
    const expIdx = psSrc.indexOf("module.exports");
    const exported = expIdx >= 0 && /applyLayerRect\s*,/.test(psSrc.slice(expIdx));
    const guardedByChanged = psSrc.indexOf("if (changed && wantRect)") >= 0;
    const libPasses = libSrc.indexOf("targetRect: ai.ok ? ai.rect : null") >= 0;
    const libDroppedOffset = libSrc.indexOf("offset: ai.ok ? { x: ai.off.offsetX") < 0;

    check(
      "46 置入精确落点：scale+translate 自校正，且已不再走 offset",
      hasFn && usesScale && usesTranslate && exported && guardedByChanged &&
        libPasses && libDroppedOffset,
      "applyLayerRect=" + hasFn + "　scale 调用=" + usesScale +
        "　translate 调用=" + usesTranslate + "　已导出=" + exported +
        "　只在 changed 时校正=" + guardedByChanged +
        "　library.js 传 targetRect=" + libPasses + "　已去掉 offset=" + libDroppedOffset
    );
  }

  /* ---- 48. 缺素材尺寸时的兜底（v0.3.5，源码级） ----
     契约 §5.4 写明 `width`/`height` **可能为 null**（PSD / PDF / 视频探不到尺寸）。
     没有兜底时 `anchorInfo()` 算不出来就整个不传 ⇒ 退回画布居中、**九宫格被静默忽略**。
     现在退回"用置入后的**实际尺寸**只定位"。真机判据是自检 S28，这里守**接线**：
       · ps.js 有 anchorPlace 分支，且打上 byActualSize 标记
       · library.js 在"算不出素材尺寸、但画布尺寸有"时真的把它传下去
       · 缩略图高度多一条 `naturalWidth/Height` 回落（否则那些卡片永远卡在 120px 保底）
       · 失败文案带上 scope/id（v0.3.5 的 not_found 就是靠它一眼定位的） */
  {
    const psSrc = fs.readFileSync(path.join(PKG, "lib", "ps.js"), "utf8");
    const libSrc = fs.readFileSync(path.join(PKG, "tools", "library.js"), "utf8");

    const hasBranch = psSrc.indexOf("o.anchorPlace") >= 0;
    const marksIt = psSrc.indexOf("fix.byActualSize = true") >= 0;
    const libPassesAnchor =
      libSrc.indexOf("anchorPlace:") >= 0 && libSrc.indexOf("needAnchorPlace") >= 0;
    const thumbFallback =
      libSrc.indexOf("function thumbBoxHFor(") >= 0 && libSrc.indexOf("thumbBoxHFor(c, w)") >= 0;
    const errHasCtx = libSrc.indexOf('scope=" + sel.scope + " · id=" + a.id') >= 0;

    check(
      "48 缺素材尺寸的兜底接线齐备（只定位不改尺寸 + 缩略图按 natural 回落 + 报错带 scope/id）",
      hasBranch && marksIt && libPassesAnchor && thumbFallback && errHasCtx,
      "ps.js anchorPlace 分支=" + hasBranch + "　打 byActualSize 标记=" + marksIt +
        "　library 传下去=" + libPassesAnchor +
        "　缩略图 natural 回落=" + thumbFallback +
        "　报错带 scope/id=" + errHasCtx
    );
  }

  /* ---- 49. 图层命名（v0.3.6，纯函数级） ----
     用户 2026-10-11 拍板：**不带扩展名** + 同名加 **` (n)`**。
     这几条全是纯函数，最适合离线钉死（真机那条是自检 S29）。
     ⚠️ "只砍已知的 `asset.ext`" 是重点：名字里带点很常见（`v1.2 终稿`），
        用"砍最后一个点"的写法会把它砍成 `v1`。 */
  {
    const psm = require(path.join(PKG, "lib", "ps.js"));
    const cases = [
      [{ name: "图一(1).jpg", ext: "jpg" }, "图一(1)"],
      [{ name: "无扩展名", ext: "png" }, "无扩展名"],
      [{ name: "v1.2 终稿.png", ext: "png" }, "v1.2 终稿"],
      [{ name: "报告.PDF", ext: "pdf" }, "报告"],
      [{ name: "ab.jpg", ext: "jpg" }, "ab"],
      [{ name: " 两边有空格 .png ", ext: "png" }, "两边有空格"],
      [{ name: "", ext: "jpg" }, ""],
      [{ name: ".jpg", ext: "jpg" }, ".jpg"],
    ];
    const failed = cases.filter((c) => psm.layerBaseName(c[0]) !== c[1]);
    const baseOk = failed.length === 0;

    const u1 = psm.uniqueLayerName("图一(1)", {});
    const u2 = psm.uniqueLayerName("图一(1)", { "图一(1)": true });
    const u3 = psm.uniqueLayerName("图一(1)", { "图一(1)": true, "图一(1) (2)": true });
    const u4 = psm.uniqueLayerName("", {});
    const long = psm.fitName("长".repeat(300), " (2)", 255);
    const fitOk = long.length <= 255 && long.slice(-4) === " (2)";

    check(
      "49 图层命名：去扩展名（只认 asset.ext）+ 同名加 (n) + 超长截断保住后缀",
      baseOk && u1 === "图一(1)" && u2 === "图一(1) (2)" && u3 === "图一(1) (3)" &&
        u4 === "素材" && fitOk,
      "去扩展名 8 例全对=" + baseOk +
        (baseOk ? "" : "（错的是 " + JSON.stringify(failed) + "）") +
        "　无冲突=" + JSON.stringify(u1) +
        "　一次冲突=" + JSON.stringify(u2) +
        "　两次冲突=" + JSON.stringify(u3) +
        "　空基名=" + JSON.stringify(u4) +
        "　超长(300字+后缀)=" + long.length + " 字符、后缀还在=" + fitOk
    );
  }

  /* ---- 50. 下拉触发条三个片段「同盒」（v0.3.7，源码级） ----
     用户报「数字比文字高一点」：`vertical-align: top` 对纯文本与 inline-block 的语义不同
     （前者贴"内容区顶"、后者贴"盒子顶"，差约 3px）。
     修法是把计数/箭头也做成 20px 高的 inline-block ⇒ 三个片段用同一套盒子语义。 */
  {
    const css = fs.readFileSync(path.join(PKG, "index.html"), "utf8");
    const rule = (sel) => {
      const i = css.indexOf(sel);
      if (i < 0) return "";
      const open = css.indexOf("{", i);
      if (open < 0) return "";
      const close = css.indexOf("}", open);
      return close < 0 ? "" : css.slice(open, close);
    };
    // 带逗号 ⇒ 只会命中那条**组选择器**，不会命中后面 .fs-n 自己的规则块
    const numBlk = rule(".fsel .fs-n,");
    const tBlk = rule(".fsel .fs-t {");
    const ib = /display:\s*inline-block/.test(numBlk);
    const hh = /height:\s*20px/.test(numBlk);
    const lh = /line-height:\s*20px/.test(numBlk);
    const va = /vertical-align:\s*top/.test(numBlk);
    const tOk = /display:\s*inline-block/.test(tBlk) && /vertical-align:\s*top/.test(tBlk);

    check(
      "50 下拉触发条三个片段同盒（计数/箭头也是 20px inline-block，不再比文字高一点）",
      ib && hh && lh && va && tOk,
      "计数/箭头：display:inline-block=" + ib + "　height:20px=" + hh +
        "　line-height:20px=" + lh + "　vertical-align:top=" + va +
        "　（对照 .fs-t 本来就是 inline-block+top=" + tOk + "）"
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

  /* ==================================================================
   * 六、M3「生成表格」：**命令形状离线断言**（v0.4.1）
   *
   * 为什么单独立这一组：真机的 `batchPlay` 是「黑盒 + 会把宿主卡死」——
   * 描述符里多塞一个没验过的键，PS 可能直接弹模态框，`executeAsModal` 就永不返回，
   * **整个插件陪葬**（v0.4.0 实测：自检卡住、连 plugin load 都报 busy/modal）。
   * 所以纪律是：**发出去之前先在离线把"命令长什么样"钉死**，只允许已验原语。
   * ================================================================== */
  try {
    const tmod = require(path.join(PKG, "lib", "table.js"));
    const psm = require(path.join(PKG, "lib", "ps.js"));

    const plan = tmod.layoutTable({
      header: ["名称", "价格", "备注"],
      body: [["图一, 终稿", "1.20", "含税"], ["图二", "3.40", ""]],
      region: { left: 40, top: 40, right: 440, bottom: 300 },
      style: {},
    });

    /* 假文档：**必须和真机同序** —— UXP DOM 的 `layers` 是"面板序"（第 0 个在最上），
       而 buildTable 的建层顺序是 [背景 → 线 → 文字] 从下往上叠 ⇒ 组里数组 = **建层顺序的逆序**。
       id 故意编成 `2000 + 建层序号`：这样"第几条改名命令动的是哪一层"可以**精确断言**
       ——顺序反了 = 整张表的名字安到别的层上，真机上极难查（v0.4.7 起改名是**一次 batchPlay**，
       不再有"逐格 DOM 改名"那层兜底，所以这条判据比过去更重要）。 */
    const kinds = [];
    for (let i = 0; i < plan.bg.length; i++) kinds.push("solidColor");
    for (let i = 0; i < plan.lines.length; i++) kinds.push("solidColor");
    for (let i = 0; i < plan.cells.length; i++) kinds.push("text");
    const g = { id: 900, kind: "group", name: "离线表", layers: [] };
    for (let i = kinds.length - 1; i >= 0; i--) {
      g.layers.push({ id: 2000 + i, kind: kinds[i], name: "未命名 " + i });
    }
    mockApp.documents.length = 0;
    mockApp.documents.push({ id: 950, name: "假表文档", mode: "RGB", activeLayers: [], layers: [g] });
    sentBatches.length = 0;
    sentCalls.length = 0;

    const res = await psm.buildTable(plan, { name: "离线表" });
    const batch1 = sentBatches[0] || [];

    const ref = (c) => (c._target && c._target[0] && c._target[0]._ref) || "";
    const isGroup = (c) => ref(c) === "layerSection";
    const shapeCmds = batch1.filter((c) => ref(c) === "contentLayer");
    const textCmds = batch1.filter((c) => ref(c) === "textLayer");
    const grpCmds = batch1.filter(isGroup);

    /* 判据提成具名函数 —— 后面第五条的"负对照"要**复用同一个判据**，
       否则那条对照只是在自证它自己（"永远成立的样本验不出任何东西"）。 */
    const isVerifiedShape = (c) => {
      const u = c.using || {};
      const s = u.strokeStyle || {};
      return u.shape && u.shape._obj === "rectangle" &&
        u.type && u.type._obj === "solidColorLayer" &&
        s.fillEnabled === true && s.strokeEnabled === false;
    };
    /* 判据提成具名函数 —— 后面两条"负对照"要**复用同一个判据**，
       否则对照只是在自证它自己（"永远成立的样本验不出任何东西"）。
       v0.4.7 两处判据都换了对象：
        · 文字命令**该带** `paragraphStyleRange`（S45 真机验过：读回 alignmentType 命中），
          但形状必须**只**含 {from,to,paragraphStyle{align:{alignmentType, 三档之一}}} ——
          多一个键就说明我们塞了没验过的东西（v0.4.0 卡死宿主就是这么来的）；
        · 改名改成**按 `_id` 的 set**（S46 真机验过），一次 batchPlay 合批。 */
    const ALIGNS = ["left", "center", "right"];
    const inlineAlignOk = (c) => {
      const u = (c && c.using) || null;
      if (!u || u.name !== undefined) return false;            // `name` 没验过（S45 实测被忽略），不许出现
      const r = u.paragraphStyleRange;
      if (!Array.isArray(r) || r.length !== 1) return false;
      const psr = r[0];
      const ps = psr && psr.paragraphStyle;
      return !!(psr && psr._obj === "paragraphStyleRange" &&
        psr.from === 0 && psr.to === String(u.textKey === undefined ? "" : u.textKey).length &&
        ps && ps._obj === "paragraphStyle" &&
        Object.keys(ps).length === 2 &&                        // 只有 _obj + align
        ps.align && ps.align._enum === "alignmentType" && ALIGNS.indexOf(ps.align._value) >= 0);
    };
    const idRenameOk = (c) => !!(c && c._obj === "set" && c.to && typeof c.to.name === "string" &&
      Array.isArray(c._target) && c._target.length === 1 &&
      c._target[0]._ref === "layer" && typeof c._target[0]._id === "number");

    // ① 形状命令：只能是 S31 验过的那一种
    const shapeBad = shapeCmds.filter((c) => !isVerifiedShape(c));
    check(
      "M3 命令形状①：形状图层只有 S31 验过的那一种（矩形 / fill 开 / stroke 关）",
      shapeCmds.length > 0 && shapeBad.length === 0,
      "形状命令 " + shapeCmds.length + " 条 = 线 " + plan.lines.length + "（含外框 " + plan.outer.bars + "）+ 背景 " + plan.bg.length +
      "　违反 " + shapeBad.length + " 条" +
      (shapeBad.length ? "　首条违规=" + JSON.stringify(shapeBad[0].using.strokeStyle || {}).slice(0, 150) : "") +
      "　⇒ 「只描边不填充」那条路**刻意没走**（fill/stroke 组合没验过），外框是 4 条细矩形拼的"
    );

    // ② 文字命令：带**已验形状**的段落对齐（S45），且**不带** name（S45 实测被忽略）
    const badText = batch1.filter((c) => ref(c) === "textLayer" && !inlineAlignOk(c));
    check(
      "M3 命令形状②：文字命令带**已验形状**的 paragraphStyleRange（S45）、不带 name（被忽略）",
      textCmds.length === plan.cells.length && badText.length === 0,
      "文字命令 " + textCmds.length + "/" + plan.cells.length + " 条　形状不对 " + badText.length + " 条" +
      (badText.length
        ? "　首条=" + JSON.stringify(badText[0].using.paragraphStyleRange || badText[0].using.name).slice(0, 170)
        : "") +
      "　⇒ 形状 = [{paragraphStyleRange:{from,to,paragraphStyle:{align:{alignmentType,left|center|right}}}}]，" +
      "**只许这 4 个键**；对齐内联是 S45 真机验过的（改完仍是普通文字层）"
    );

    // ③ 层数：命令条数必须**正好**等于计划层数
    check(
      "M3 层数：命令条数 = 计划层数（1 组 + 线 + 背景 + 文字）",
      batch1.length === plan.layers && grpCmds.length === 1 && grpCmds[0].using.name === "离线表",
      "命令 " + batch1.length + " 条 / 计划 " + plan.layers + " 个图层　组命令 " + grpCmds.length +
      " 条（名字=" + JSON.stringify(grpCmds[0] && grpCmds[0].using.name) + "）" +
      "　‖ 拆解 1 组 + 线 " + plan.lines.length + " + 背景 " + plan.bg.length + " + 文字 " + plan.cells.length
    );

    // ④ 落地形状：**一次** batchPlay 合批改名（按 _id）、对齐**不再**逐格 set
    /* v0.4.7 换了设计：阶段二从"逐格 DOM 选择 + 改名 + 每格一条 set paragraphStyle"（真机 13.6s）
       改成"内联对齐 + 一次 batchPlay 按 _id 改名"。这里钉死四件事：
         ① **只有两个批次**（建层 + 改名）—— 批次数就是性能断言（DOM 那条路是 36 个批次）
         ② 改名条数 = 层数 − 1（**所有**图层都命名：背景/线/文字）
         ③ **id 顺序 = 建层顺序**（反了 = 整表串格，真机极难查）
         ④ 对齐**不再**出现在阶段二（已内联） */
    const phase2 = sentBatches.slice(1).reduce((a, b) => a.concat(b), []);
    const renameCmds = phase2.filter(idRenameOk);
    const alignCmds = phase2.filter((c) => c._target && c._target[0]._property === "paragraphStyle");
    const idOrderOk = renameCmds.length > 0 && renameCmds.every((c, i) => c._target[0]._id === 2000 + i);
    const textStart = plan.bg.length + plan.lines.length;      // 独立算：文字在建层序里的起点
    const nameTailOk = renameCmds.length > textStart + plan.cells.length - 1 &&
      renameCmds[renameCmds.length - 1].to.name === psm.tableCellName(plan.cells[plan.cells.length - 1]) &&
      renameCmds[textStart].to.name === psm.tableCellName(plan.cells[0]) &&
      renameCmds[0].to.name === "背景 · 表头";
    check(
      "M3 落地：一次 batchPlay 合批改名（按 _id、顺序 = 建层序）+ 对齐已内联不再逐格 set",
      sentBatches.length === 2 && renameCmds.length === plan.layers - 1 &&
      renameCmds.length === phase2.length && idOrderOk && nameTailOk &&
      alignCmds.length === 0 && res.nameMode === "am" && res.renamed === plan.layers - 1,
      "批次数=" + sentBatches.length + "（须 2：建层 + 改名；退回路径是 37 个以上）" +
      "　改名命令 " + renameCmds.length + "/" + (plan.layers - 1) + "（须全部按 _id）" +
      "　id 顺序对=" + idOrderOk + "　首/中/末名字对=" + nameTailOk +
      "　逐格对齐命令 " + alignCmds.length + " 条（须 0，已内联）" +
      "　nameMode=" + res.nameMode + "　renamed=" + res.renamed
    );

    // ⑤ 负对照：文字命令的判据必须只放过**那一条合规的**（多键/错枚举族/错值/带 name 都要抓住）
    const mkText = (using) => ({ _obj: "make", _target: [{ _ref: "textLayer" }], using: using });
    const goodUsing = (align) => ({
      _obj: "textLayer", textKey: "y",
      paragraphStyleRange: [{
        _obj: "paragraphStyleRange", from: 0, to: 1,
        paragraphStyle: { _obj: "paragraphStyle", align: { _enum: "alignmentType", _value: align } },
      }],
    });
    const poisonedText = [
      mkText({ _obj: "textLayer", textKey: "x", name: "poison" }),                       // 带 name
      mkText(goodUsing("center")),                                                       // 合规（必须命中）
      (() => { const u = goodUsing("center"); u.paragraphStyleRange[0].paragraphStyle.justification = { _enum: "x", _value: "y" }; return mkText(u); })(),
      (() => { const u = goodUsing("center"); u.paragraphStyleRange[0].paragraphStyle.align._enum = "justification"; return mkText(u); })(),
      (() => { const u = goodUsing("center"); u.paragraphStyleRange[0].paragraphStyle.align._value = "middle"; return mkText(u); })(),
    ];
    check(
      "M3 判据自证（负对照）：文字命令判据只放过那一条合规的（多键/错枚举族/错值/带 name 都得抓住）",
      poisonedText.filter(inlineAlignOk).length === 1,
      "5 条构造命令里命中 " + poisonedText.filter(inlineAlignOk).length + " 条（必须**正好 1**）" +
      "　⇒ 判据不是空壳；若这里 ≠1，②的 PASS 就该被推翻"
    );

    // ⑥ 负对照：改名判据不许放过"按名字选层"（那是**没验过**的形状）或缺 `to.name` 的
    const poisonedRename = [
      { _obj: "set", _target: [{ _ref: "layer", _name: "某层" }], to: { name: "x" } },   // 按名字（没验过）
      { _obj: "set", _target: [{ _ref: "layer", _id: 2001 }], to: { name: "x" } },       // 合规（必须命中）
      { _obj: "set", _target: [{ _ref: "layer", _id: 2001 }] },                          // 没有 to.name
    ];
    check(
      "M3 判据自证（负对照）：改名判据只放过「按 _id 且真的在改名」",
      poisonedRename.filter(idRenameOk).length === 1,
      "3 条构造命令里命中 " + poisonedRename.filter(idRenameOk).length + " 条（必须**正好 1**）"
    );

    /* ⑦ 观测完整性（v0.5.1）：位移耗时曾被一行 `out.moveMs = tMove;` **覆盖成恒 0** ——
       而 `tMove` 声明后从未被赋值 ⇒ 真机 boot.log 里的「移动 0」是**假读数**，
       真实位移耗时被藏在「总耗时 − dup − step2」里（约 460ms / 6 份）⇒ 待办「N=20+ 性能」是盲的。
       这里做**源码级**断言（附负对照），防止它再被写回来。 */
    const psSrcT = fs.readFileSync(path.join(PKG, "lib", "ps.js"), "utf8");
    const tblSrcT = fs.readFileSync(path.join(PKG, "tools", "table.js"), "utf8");
    const timingJudge = (src) => ({
      realMove: /out\.moveMs\s*=\s*Date\.now\(\)\s*-\s*t3/.test(src),
      noOverwrite: !/out\.moveMs\s*=\s*tMove/.test(src),
      noDeadVar: !/\btMove\b/.test(src),
      walkMeasured: /out\.walkMs\s*=\s*tWalk/.test(src) && /walkMs:\s*0/.test(src),
    });
    const tOK = timingJudge(psSrcT);
    const tPoison = timingJudge(psSrcT.replace("out.walkMs = tWalk;", "out.moveMs = tMove;"));
    const tblOk = /r\.walkMs/.test(tblSrcT) && /r\.moveMs/.test(tblSrcT) && /batch bind col=/.test(tblSrcT);
    check(
      "M3b 观测：位移耗时如实回传（不许被 `out.moveMs = tMove` 覆盖）+ 遍历单独计时 + 面板打全",
      tOK.realMove && tOK.noOverwrite && tOK.noDeadVar && tOK.walkMeasured && !tPoison.noOverwrite && tblOk,
      "真值赋值=" + tOK.realMove + "　无覆盖行=" + tOK.noOverwrite + "　无死变量 tMove=" + tOK.noDeadVar +
      "　遍历单独计时=" + tOK.walkMeasured + "　负对照抓到覆盖=" + (!tPoison.noOverwrite) +
      "　面板引用 walkMs/moveMs/绑定日志=" + tblOk +
      "　⇒ 位移与遍历的耗时都能被量到；`step2Ms` **不含**位移（面板日志已写明）"
    );

    /* ⑧ 绑定：模板里**第 1 个**文字层（序号 0）必须绑得上（v0.5.2 真机反馈）
       症状 = 用户原话「模板的第一个图层不能被绑定，点击 UI 不更新」。
       根因 = 面板里 `if (v) S.bind[c] = v; else delete S.bind[c];` —— `v = 0` 是**合法序号**
       （模板第 1 个文字层）却被当成假值 ⇒ 直接 delete ⇒ 高亮不挪、计划仍说"一列都没绑上"。
       `lib/batch.js` 里那条纪律（"0 不能当没绑"）修过了，**面板这两个入口漏了**。
       这条**真点一次**（离线 mock 能挂真面板 + 派发 click），判据读**界面**（chip 高亮 + 警告行），
       不复用内部变量 —— 用户看到的就是这两样。 */
    try {
      const tMod = require(path.join(PKG, "tools", "table.js"));
      const tplG = {
        id: 900, name: "离线模板组", kind: "group",
        bounds: { left: 0, top: 0, right: 120, bottom: 90 },
        layers: [
          { id: 901, name: "标题", kind: "text", textItem: { contents: "旧标题" } },
          { id: 902, name: "价格", kind: "text", textItem: { contents: "0" } },
        ],
      };
      fakeDoc.layers = [tplG];
      fakeDoc.activeLayers = [tplG];              // 模板来源 = 当前选中的组
      mockApp.documents.length = 0;
      mockApp.documents.push(fakeDoc);

      await tMod.mount(view, { setStatus() {} });
      await sleep(200);
      const schip = document.getElementById("vt-tbl-sample-gbk");   // 先有数据，绑定表才渲染
      if (schip) schip.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      for (let i = 0; i < 40; i++) {
        const g = document.getElementById("vt-tbl-grid");
        if (g && g.children.length > 1) break;
        await sleep(50);
      }
      const tplBtn = document.getElementById("vt-tbl-tplre");       // 认模板
      if (tplBtn) tplBtn.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      for (let i = 0; i < 40; i++) {
        if (document.getElementById("vt-tbl-bind-0")) break;
        await sleep(50);
      }
      const boxA = document.getElementById("vt-tbl-bind-0");
      const chipsA = boxA ? Array.prototype.slice.call(boxA.children) : [];
      const labels = chipsA.map((e) => String(e.textContent || ""));
      const hit = chipsA[1];                                        // items[1] = 第 1 个文字层（序号 0）
      if (hit) hit.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      await sleep(200);

      const boxB = document.getElementById("vt-tbl-bind-0");
      const chipsB = boxB ? Array.prototype.slice.call(boxB.children) : [];
      const onIdx = chipsB
        .map((e, i) => (String(e.getAttribute("class") || "").split(/\s+/).indexOf("on") >= 0 ? i : -1))
        .filter((i) => i >= 0);
      const warnEl = document.getElementById("vt-tbl-bindwarn");
      const warnTxt = warnEl ? String(warnEl.textContent || "") : "";
      // 期望值独立算：样例 5 列，只绑第 1 列 ⇒ 未绑 **4** 列
      check(
        "22h-6 绑定：模板第 1 个文字层（序号 0）点得动 —— 高亮挪过去 + 警告说「4 列没绑定」",
        chipsA.length === 3 && labels[0].indexOf("不绑定") >= 0 && labels[1] === "1. 标题" &&
          onIdx.length === 1 && onIdx[0] === 1 && warnTxt.indexOf("4 列没绑定") >= 0,
        "绑定芯片 = " + JSON.stringify(labels) + "　点后高亮在第 " + JSON.stringify(onIdx) + " 个（须 [1]）" +
          "　警告行 = " + JSON.stringify(warnTxt.slice(0, 48)) + "（须含「4 列没绑定」）"
      );
      try { tMod.unmount(); } catch { /* 忽略 */ }
    } catch (e) {
      check("22h-6 绑定：模板第 1 个文字层（序号 0）点得动", false, "步骤抛异常：" + ((e && e.message) || String(e)));
    }
    fakeDoc.layers = [];
    fakeDoc.activeLayers = [{ id: 201, name: "图层 1", kind: "pixel" }];
    mockApp.documents.length = 0;

    /* ⑨ 源码守卫：面板**不许**再用 `if (v) S.bind[...]` 判空（序号 0 会被当假值删掉）。
       附负对照：把旧写法塞回去，判据必须抓住。 */
    const tblSrc2 = fs.readFileSync(path.join(PKG, "tools", "table.js"), "utf8");
    const bindJudge = (src) => ({
      hasHelper: /function setBind\s*\(\s*col\s*,\s*v\s*\)/.test(src),
      noFalsyZero: !/if\s*\(\s*v\s*\)\s*S\.bind\[/.test(src),
      usesHelper: (src.match(/setBind\(c, v\)/g) || []).length,
      nullGuard: /v === "" \|\| v === undefined \|\| v === null/.test(src),
    });
    const bOK = bindJudge(tblSrc2);
    const bPoison = bindJudge(tblSrc2.replace("setBind(c, v);", "if (v) S.bind[c] = v; else delete S.bind[c];"));
    check(
      "22h-7 源码守卫：绑定只有唯一的 setBind() 写入口，且不再用 `if (v)` 判空",
      bOK.hasHelper && bOK.noFalsyZero && bOK.usesHelper === 2 && bOK.nullGuard && !bPoison.noFalsyZero,
      "唯一写入口 setBind()=" + bOK.hasHelper + "　无 `if (v) S.bind`=" + bOK.noFalsyZero +
      "　两个入口都调它=" + bOK.usesHelper + "（须 2）　显式判空=" + bOK.nullGuard +
      "　负对照抓到旧写法=" + (!bPoison.noFalsyZero)
    );

    mockApp.documents.length = 0;
  } catch (e) {
    check("M3 命令形状离线断言（自身抛异常）", false, (e && e.message) || String(e));
  }

  /* ---- M5 出图体检：纯函数离线断言（docs/49 第 1 步） ----
     ⚠️ 这里只验 **judge / pxToMm / worstOf 这些纯函数** —— 它们不碰 PS，所以能离线跑。
        真机行为由自检 S50 负责（那边验的是"快照从真文档读出来对不对"）。
     ⚠️ 每条判据都带**负对照**（同一个快照换个条件，结论必须变）——
        否则"恒等于某个值"也会被误判成通过。 */
  try {
    const insp = require(path.join(PKG, "lib", "inspect.js"));

    const sevOf = (findings, k) => {
      for (const f of findings) if (f.key === k) return f.severity;
      return null;
    };
    const valOf = (findings, k) => {
      for (const f of findings) if (f.key === k) return f.value;
      return null;
    };
    const clone = (o) => JSON.parse(JSON.stringify(o));

    /* 合成快照（不碰 PS）：2480×3508 @300dpi、RGB、无文字层、0 条参考线 */
    const snap = {
      info: {
        docName: "合成稿.psd", saved: true,
        mode: "RGBColorMode", bits: "bitDepth8",
        profileName: "sRGB IEC61966-2.1", profileType: "workingSpaceCode",
        pxW: 2480, pxH: 3508, ppi: 300
      },
      layers: { total: 3, textCount: 0, hidden: 1, groups: 0, fonts: [] },
      guideCount: 0,
      fontNames: {
        ps: [insp.normFont("AdobeHeitiStd-Regular")],
        loose: [insp.normFont("Microsoft YaHei UI")],
        count: 2
      }
    };

    /* ① 单位换算：无效 ppi 与空值必须返回 null（**不默认 72**） */
    const mm = insp.pxToMm(300, 72);
    check(
      "M5-1 pxToMm：有效 ppi 换算正确；ppi=0 / px=null 一律返回 null（不默认 72）",
      Math.abs(mm - 105.8333) < 0.01 && insp.pxToMm(300, 0) === null && insp.pxToMm(null, 72) === null,
      "300px@72dpi = " + mm.toFixed(4) + "（须 105.8333）　ppi=0 → " + insp.pxToMm(300, 0) +
      "　px=null → " + insp.pxToMm(null, 72)
    );

    /* ② usage 必须真的生效 —— 负对照：同一个快照，只改 usage，结论必须变 */
    const fPrint = insp.judge(snap, { usage: "print" });
    const fScreen = insp.judge(snap, { usage: "screen" });
    check(
      "M5-2 usage 生效（负对照）：同一快照，print 判 RGB 为 warn / screen 判为 ok",
      sevOf(fPrint, "mode") === "warn" && sevOf(fScreen, "mode") === "ok",
      "print → " + sevOf(fPrint, "mode") + "　screen → " + sevOf(fScreen, "mode") +
      "（两者必须不同，否则 usage 根本没被用上）"
    );

    /* ③ 未转曲文字层：0 个恒 ok；有层时按用途分岔 */
    const snapText = clone(snap);
    snapText.layers.textCount = 3;
    const ftP = insp.judge(snapText, { usage: "print" });
    const ftS = insp.judge(snapText, { usage: "screen" });
    check(
      "M5-3 未转曲文字层：0 个 = ok；3 个时 print = warn / screen = info",
      sevOf(insp.judge(snap, { usage: "print" }), "text") === "ok" &&
        sevOf(ftP, "text") === "warn" && sevOf(ftS, "text") === "info" &&
        String(valOf(ftP, "text")).indexOf("3") >= 0,
      "0 个 → " + sevOf(insp.judge(snap, { usage: "print" }), "text") +
      "　3 个 & print → " + sevOf(ftP, "text") +
      "　3 个 & screen → " + sevOf(ftS, "text")
    );

    /* ④ 分辨率下限只在印刷侧设（屏幕稿 72dpi 是正常的，不该报警） */
    const snapLow = clone(snap);
    snapLow.info.ppi = 72;
    check(
      "M5-4 分辨率：print 下 72dpi = warn，screen 下 = info（屏幕稿不设下限）",
      sevOf(insp.judge(snapLow, { usage: "print" }), "ppi") === "warn" &&
        sevOf(insp.judge(snapLow, { usage: "screen" }), "ppi") === "info",
      "print → " + sevOf(insp.judge(snapLow, { usage: "print" }), "ppi") +
      "　screen → " + sevOf(insp.judge(snapLow, { usage: "screen" }), "ppi")
    );

    /* ⑤ 缺字体必须是 warn —— **不许是 fatal**（名字比对可能误报，见 lib/inspect.js 文件头） */
    const snapBadFont = clone(snap);
    snapBadFont.layers.fonts = [{ layer: "标题", font: "NotInstalledFont-Regular" }];
    const fbf = insp.judge(snapBadFont, { usage: "print" });
    check(
      "M5-5 缺字体 = warn（不是 fatal —— 名字比对会误报，v1 不拦）",
      sevOf(fbf, "font") === "warn" && String(valOf(fbf, "font")).indexOf("1") >= 0,
      "severity = " + sevOf(fbf, "font") + "　value = " + valOf(fbf, "font")
    );

    /* ⑥ 命中本机清单 = ok；**清单读不到 = unknown**（不当作"没问题"） */
    const snapOkFont = clone(snap);
    snapOkFont.layers.fonts = [{ layer: "标题", font: "AdobeHeitiStd-Regular" }];
    const snapNoList = clone(snap);
    snapNoList.layers.fonts = [{ layer: "标题", font: "AdobeHeitiStd-Regular" }];
    snapNoList.fontNames = { ps: [], loose: [], count: 0 };
    check(
      "M5-6 字体判定：命中本机清单 = ok；清单读不到 = unknown（不当作没问题）",
      sevOf(insp.judge(snapOkFont, { usage: "print" }), "font") === "ok" &&
        sevOf(insp.judge(snapNoList, { usage: "print" }), "font") === "unknown",
      "命中 → " + sevOf(insp.judge(snapOkFont, { usage: "print" }), "font") +
      "　无清单 → " + sevOf(insp.judge(snapNoList, { usage: "print" }), "font")
    );

    /* ⑦ 出血恒为 unknown —— 坐标读不到的已知缺口，**不许写成结论** */
    const snapG = clone(snap);
    snapG.guideCount = 4;
    check(
      "M5-7 出血恒为 unknown（0 条与 4 条都一样）—— 坐标读不到的已知缺口",
      sevOf(insp.judge(snap, { usage: "print" }), "bleed") === "unknown" &&
        sevOf(insp.judge(snapG, { usage: "print" }), "bleed") === "unknown",
      "0 条 → " + sevOf(insp.judge(snap, { usage: "print" }), "bleed") +
      "　4 条 → " + sevOf(insp.judge(snapG, { usage: "print" }), "bleed")
    );

    /* ⑧ ppi 读不到 → 物理尺寸 = unknown（不是 0、不是乱算） */
    const snapNoPpi = clone(snap);
    snapNoPpi.info.ppi = null;
    const fnp = insp.judge(snapNoPpi, { usage: "print" });
    check(
      "M5-8 ppi 读不到时，物理尺寸 = unknown（不猜、不默认 72）",
      sevOf(fnp, "phys") === "unknown",
      "phys severity = " + sevOf(fnp, "phys") + "　value = " + valOf(fnp, "phys")
    );

    /* ⑨ worstOf 取最要紧那一档 */
    check(
      "M5-9 worstOf：fatal > warn > unknown > ok > info",
      insp.worstOf([{ severity: "info" }, { severity: "ok" }]) === "ok" &&
        insp.worstOf([{ severity: "ok" }, { severity: "unknown" }, { severity: "warn" }]) === "warn" &&
        insp.worstOf([{ severity: "warn" }, { severity: "fatal" }]) === "fatal",
      "info+ok → " + insp.worstOf([{ severity: "info" }, { severity: "ok" }]) +
      "　ok+unknown+warn → " + insp.worstOf([{ severity: "ok" }, { severity: "unknown" }, { severity: "warn" }]) +
      "　warn+fatal → " + insp.worstOf([{ severity: "warn" }, { severity: "fatal" }])
    );

    /* ⑩ 宫格：体检已上线（tools + ready + 有 mount/unmount），新建稿仍是灰行 */
    const reg = require(path.join(PKG, "tools", "index.js"));
    const pids = reg.planned.map((p) => p.id);
    const tids = reg.tools.map((t) => t.id);
    const inspMod = reg.byId("inspect");
    const wronglyReady = reg.planned.filter((p) => p.ready === true).length;
    check(
      "M5-10 宫格：出图体检已上线（tools + ready + mount/unmount），「新建稿」仍是灰行",
      tids.indexOf("inspect") >= 0 && pids.indexOf("inspect") < 0 &&
        pids.indexOf("template") >= 0 && wronglyReady === 0 &&
        !!inspMod && inspMod.ready === true &&
        typeof inspMod.mount === "function" && typeof inspMod.unmount === "function",
      "tools = " + JSON.stringify(tids) + "　planned = " + JSON.stringify(pids) +
      "　inspect.ready = " + (inspMod ? inspMod.ready : "无") +
      "　标成 ready 的规划项数 = " + wronglyReady + "（须 0）"
    );

    /* ⑪ bounds 归一化 + 超标量计算（兼容 UXP 的 `_left` 与普通 `left` 两种键名） */
    const bdA = insp.normBounds({ _left: 200, _top: 89, _right: 1452, _bottom: 102 });
    const bdOut = insp.normBounds({ left: -5, top: 0, right: 400, bottom: 200 });
    const bdIn = insp.normBounds({ left: 10, top: 10, right: 400, bottom: 200 });
    const bdBad = insp.normBounds({ _left: null, _top: 0, _right: 10, _bottom: 10 });
    check(
      "M5-11 normBounds / overflowPx：兼容 _left 与 left；四边取最大；缺字段/空值返回 null",
      !!bdA && bdA.right === 1452 &&
        bdOut && bdOut.left === -5 && bdIn && bdIn.left === 10 &&
        insp.overflowPx(bdA, 400, 200) === 1052 &&
        insp.overflowPx(bdOut, 400, 200) === 5 &&
        /* ⚠️ 负 left 是"左边出界"，画布再大也出界 —— 第一版这里我写成了期望 0，是**断言写错** */
        insp.overflowPx(bdOut, 5000, 5000) === 5 &&
        insp.overflowPx(bdIn, 500, 300) === 0 &&
        insp.normBounds(null) === null && bdBad === null,
      "_left 版 right = " + (bdA ? bdA.right : "null") +
      "　超 400×200 画布 = " + (bdA ? insp.overflowPx(bdA, 400, 200) : "-") + "（须 1052）" +
      "　负 left 超 = " + insp.overflowPx(bdOut, 400, 200) + "（须 5）" +
      "　负 left 在大画布上仍 = " + insp.overflowPx(bdOut, 5000, 5000) + "（须 5）" +
      "　完全在内 = " + insp.overflowPx(bdIn, 500, 300) + "（须 0）" +
      "　缺字段 → " + bdBad
    );

    /* ⑫ 「元素超出画布」的分档：0 个 = ok；小超出 = info；大超出 = warn
       （阈值按毫米换算，所以 300dpi 下 5mm ≈ 59px） */
    const mkOver = (n, maxPx) => {
      const s = clone(snap);
      s.layers.overflowCount = n;
      s.layers.overflowMaxPx = maxPx;
      s.layers.overflowWorst = "某个图层";
      return s;
    };
    const fO0 = insp.judge(mkOver(0, 0), { usage: "print" });
    const fO1 = insp.judge(mkOver(1, 20), { usage: "print" });
    const fO2 = insp.judge(mkOver(2, 200), { usage: "print" });
    check(
      "M5-12 元素超出画布分档：0 个 = ok；20px = info；200px = warn（5mm@300dpi≈59px 为阈值）",
      sevOf(fO0, "overflow") === "ok" &&
        sevOf(fO1, "overflow") === "info" &&
        sevOf(fO2, "overflow") === "warn" &&
        String(valOf(fO2, "overflow")).indexOf("2") >= 0,
      "0 个 → " + sevOf(fO0, "overflow") +
      "　1 个/20px → " + sevOf(fO1, "overflow") +
      "　2 个/200px → " + sevOf(fO2, "overflow") + "（" + valOf(fO2, "overflow") + "）"
    );

    /* ⑬ 缺字体/出血/超出画布三项的"无结论"边界：不许被写成结论 */
    const snapNoPx = clone(snap);
    snapNoPx.info.pxW = null;
    const fNoPx = insp.judge(snapNoPx, { usage: "print" });
    check(
      "M5-13 画布尺寸读不到时，「元素超出画布」= unknown（不是 ok，也不是 0）",
      sevOf(fNoPx, "overflow") === "unknown",
      "overflow severity = " + sevOf(fNoPx, "overflow") + "　value = " + valOf(fNoPx, "overflow")
    );

    /* ⑭ 撤销标记的可用性判定（纯函数）。
       ★ 关键是**两条相近情形必须给出不同答案**：
         · 换了文档        ⇒ 拒绝（不跨文档撤回）
         · 图层数已与标记时相同 ⇒ **仍是可用**，只加提示
         若这两条答成一样，说明这条判定没在区分东西。 */
    const hist = require(path.join(PKG, "lib", "history.js"));
    const mkA = {
      has: true, label: "批量出稿 20 份", docId: 101, docName: "A.psd",
      layers: 5, markError: null,
    };
    const hSame = hist.assess(mkA, { docId: 101, layers: 25 });
    const hOther = hist.assess(mkA, { docId: 202, layers: 25 });
    const hEqual = hist.assess(mkA, { docId: 101, layers: 5 });
    const hNone = hist.assess({ has: false }, { docId: 101, layers: 5 });
    const hErr = hist.assess(
      { has: true, label: "x", docId: 101, docName: "A.psd", layers: 5, markError: "取标记失败" },
      { docId: 101, layers: 9 }
    );
    check(
      "M5-14 assess：同文档可用 / 换文档拒绝 / 数量已相同仍可用（只提示）/ 无标记不可用 / 记标记出错不可用",
      hSame.usable === true && hSame.hint === "" &&
        hOther.usable === false && String(hOther.reason).indexOf("不是记标记那一张") >= 0 &&
        hEqual.usable === true && String(hEqual.hint).indexOf("碰巧") > 0 &&
        hNone.usable === false &&
        hErr.usable === false && String(hErr.reason).indexOf("取标记失败") >= 0 &&
        hOther.usable !== hEqual.usable,
      "同文档 usable=" + hSame.usable +
        "　换文档 usable=" + hOther.usable + "（" + hOther.reason + "）" +
        "　数量已相同 usable=" + hEqual.usable + "（hint：" + hEqual.hint + "）" +
        "　无标记 usable=" + hNone.usable + "　记标记出错 usable=" + hErr.usable
    );

    /* ⑮ 撤回读数：主路说「精确」、备路**必须自己说出来**「可能不精确」——
       备路是相对位移，用户若在撤回前又手动操作过就会退到偏早的位置。
       把它和主路说成一个样，就是用读数**掩盖一条真限制**。 */
    const rv1 = hist.describeRevert({ ok: true, via: "state", before: 25, after: 5, want: 5 });
    const rv2 = hist.describeRevert({ ok: true, via: "offset", n: 20, before: 25, after: 5, want: 5 });
    const rv3 = hist.describeRevert({ ok: false, error: "没回到位" });
    check(
      "M5-15 describeRevert：主路不许带「可能不精确」、备路必须带、失败带原因（三条互不相同）",
      rv1.indexOf("精确") >= 0 && rv1.indexOf("可能不精确") < 0 &&
        rv2.indexOf("可能不精确") >= 0 &&
        rv3.indexOf("未成功") >= 0 && rv3.indexOf("没回到位") >= 0 &&
        rv1 !== rv2 && rv1 !== rv3 && rv2 !== rv3,
      "主路 = " + JSON.stringify(rv1) +
        "\n        备路 = " + JSON.stringify(rv2) +
        "\n        失败 = " + JSON.stringify(rv3)
    );

    /* ⑯ 标记摘要：必须带「标签 + 多久之前 + 图层数」——
       它是"事后"才被看到的，用户那时已经在想别的事，光写「有标记」等于没有信息。 */
    const de1 = hist.describe({ has: true, label: "批量出稿 20 份", ageMs: 5000, layers: 5 });
    const de2 = hist.describe({ has: false });
    check(
      "M5-16 describe：有标记带「标签 + 多久前 + 图层数」；无标记如实说（两者必须不同）",
      de1.indexOf("批量出稿 20 份") >= 0 && de1.indexOf("秒前") >= 0 && de1.indexOf("5 个") >= 0 &&
        de2.indexOf("没有撤销标记") >= 0 && de1 !== de2,
      "有标记 = " + JSON.stringify(de1) + "\n        无标记 = " + JSON.stringify(de2)
    );

    /* ⑰ 结构性纪律：history.js **不许** require ps.js。
       依赖必须是单向的 ps.js → history.js：history 要当"批量前记标记"的地基，
       反过来引 ps.js 就成了**循环依赖** —— 症状是某个模块拿到半截 exports，
       报错位置离病根很远、极难查。所以这里直接把方向钉死。 */
    const hSrc = fs.readFileSync(path.join(PKG, "lib", "history.js"), "utf8");
    const hBackRef = /require\(\s*["']\.\/ps\.js["']\s*\)/.test(hSrc);
    check(
      "M5-17 history.js 不 require ps.js（ps.js → history.js 单向，防循环依赖）",
      !hBackRef,
      "history.js 里" + (hBackRef ? "**有**" : "没有") + " require(\"./ps.js\")"
    );
  } catch (e) {
    check("M5 出图体检纯函数离线断言（自身抛异常）", false, (e && e.message) || String(e));
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
