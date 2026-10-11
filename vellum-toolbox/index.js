/*
 * Vellum 工具箱 —— 外壳（index.js）
 * ===========================================================================
 * 形态：**一个插件、两类入口、共用一份代码**（docs/10 §2.1）
 *   Panel   vellumToolboxPanel  —— 常驻工作台：首页工具列表 → 进工具 → 返回
 *   Command ×3                  —— 高频一步动作，不依赖面板
 *      · 品牌主色 → 前景色
 *      · 品牌主色 → 背景色
 *      · 品牌主色 → **填充当前图层 / 选区**（v0.2.2 新增）
 *
 * 外壳只干三件事（docs/10 §2.3）：**读注册表 → 渲染首页 → mount / unmount**
 * 所以「以后加第 5、6 个工具 = 加一个文件 + 注册表加一行，外壳零改动」。
 *
 * ⚠️ **命令快捷键的现实**（v0.2.2 查证后更正 v0.2.1 的说法）：
 *   manifest v5 的 `shortcut` 语法是有的（必须含 Ctrl/Cmd、只支持字母数字、
 *   与宿主内置快捷键冲突会被静默忽略）—— 但那是 **Premiere / InDesign / XD** 的文档。
 *   Adobe 官方论坛（Photoshop / UXP 分区）从 2021 一直问到 2024，
 *   结论都是 **Photoshop 不支持**：Adobe 员工明确说"UXP 核心 API 不支持键盘快捷键"，
 *   社区给的替代方案是"录成动作再绑 F 键"。
 *   所以 manifest 里那条 shortcut 是 **best-effort**：
 *   语法合规、无害，但**很可能被 PS 直接忽略**，必须人工按一次才知道。
 *   真正能自证的是面板内的修饰键（Alt+左键）—— 它走的是我们自己的事件处理器。
 *
 * 视觉：design-demos/B-native-pro.html 方向 B「Native Pro」
 *   v0.2.1 按用户真机反馈修了一批 UI bug，明细见 docs/16-UI修复记录.md：
 *     · 顶栏左侧：首页显示品牌标（原来是返回键留出的空位）
 *     · hero：改用透明 PNG 品牌标（原来是 SVG，真机渲染成黑块）
 *     · 首页四项：调色板 / 素材库 / 表格生成 / AI-MCP，左对齐 + 图标 + 号位
 *     · 顶栏环境 chip：圆点改 margin 定距，不再与文字重叠
 *   v0.2.2 修调色板悬停闪烁 + 新增「Alt+左键 = 填充」，见 docs/17。
 *   v0.2.3 修「填充不能用」：`fill` 只对**像素族**图层有效，形状/纯色填充这类
 *          **内容图层**必须改内容色（PS 的「填充」对它们不可用）—— 见 docs/18。
 *   v0.2.4 补**文字图层**改色（`set` → `to.textStyle.color`，非破坏性、文字保持可编辑）；
 *          真机确认「形状图层」改色正常（via=contentColorA），
 *          「纯色填充图层」仍未解决（已知限制，非回归）—— 见 docs/21。
 *   v0.2.5 M2 素材库地基探针（读自身 PluginData 的镜像）—— 见 docs/11。
 *          ⇒ 实测出**UXP 的 `<img>` 不解码 webp**，缩略图格式改为 png/jpg（契约 §5.5 修正）。
 *   v0.2.7 **素材库界面落地**（`tools/library.js`）：库切换 / 分组筛选 / 缩略图网格 /
 *          详情 / 每 3 秒对 revision 自动刷新 / 置入（先直连 absPath，不行再走 handoff 握手）
 *          —— 见 docs/23。
 *   v0.2.8 跟进软件侧按契约 §十 提的三处**加法**（不升契约版本，见 LINK-LOG）：
 *          `groups[].parentId` 两级分组 → 筛选区第二行；`asset.source` → 来源筛选 + 卡片角标；
 *          缩略图命名空间 `t<b>` → 对插件透明，但**它暴露了本项目一个真实缺陷**：
 *          缩略图缓存键原来用 `asset.id`，而两库 id 各自从 1 起 ⇒ 切库可能串图
 *          —— 已改为按 `asset.thumb` 做键（离线断言 32 钉死）。
 *   v0.3.0 两个界面需求落地（评估见 docs/25）：
 *          ① **二层筛选改自绘下拉** —— 原生 `<select>` 外观改不动、Spectrum `sp-picker`
 *             真机实测未注册 ⇒ 只能自绘；浮层必须落在滚动容器内（S20c 是可测不变量）。
 *          ② **九宫格落点** —— `placeEvent` 默认落在画布居中，而 `offset` 与位移 **1:1 精确**
 *             ⇒ 选一个锚点就能把素材贴到画布对应位置，**零新能力**（画布尺寸来自 `docInfo()`、
 *             素材宽高来自镜像）。⚠️ 它只管位置、不管尺寸。
 *
 * ⚠️ 两条真机硬纪律（改 UI 前必读 index.html 头部注释）
 *   ① SVG 每个子元素都要显式写 fill/stroke（UXP 不做继承）→ 见 lib/icons.js
 *   ② 布局只用 div 上的 display:flex，不用 inline-flex、不用 <button> 承载布局
 *
 * 两条反馈通道（vibecoding 的命脉，docs/10 §六）
 *   boot.log   —— 加载 / 工具切换 / 每次动作 + 结果 + 失败原因（外部脚本可读）
 *   verify.flag—— 存在时加载即跑无痕自检（lib/selfcheck.js），自证面板真能点通
 *
 * UXP 硬约束：引宿主模块只能 require()；改文档必须包在 executeAsModal 里。
 */

const uxpNS = require("uxp");
const { entrypoints } = uxpNS;

const log = require("./lib/log.js");
const ps = require("./lib/ps.js");
const store = require("./lib/store.js");
const data = require("./lib/data.js");
const dom = require("./lib/dom.js");
const caps = require("./lib/caps.js");
const icons = require("./lib/icons.js");
const registry = require("./tools/index.js");
const palette = require("./tools/palette.js");
const library = require("./tools/library.js");
const selfcheck = require("./lib/selfcheck.js");

/** ⚠️ 必须与 manifest.json 的 version 一致 —— 两者任一改动都要同步另一处。 */
const PLUGIN_ID = "com.vellum.toolbox";
const VERSION = "0.4.0";

let ui = null;
let homeBinder = null;
let currentTool = null;
let inited = false;

/* ------------------------------------------------------------ 状态条 */

function setStatus(text) {
  const t = String(text);
  if (ui && ui.status) ui.status.textContent = t;
  try {
    console.log("[" + PLUGIN_ID + "] " + t);
  } catch {
    /* 无调试窗时忽略 */
  }
}

/* --------------------------------------------------- 主题（跟随 PS 深浅色）

   设计稿是**硬编码固定深色**；本项目定为**跟随 PS 主题自适应**（用户拍板 6.1）。

   ⚠️ 真机实测（v0.2.1 探针）推翻了原来的两条假设：
     ① `window.matchMedia` 在 UXP 里**根本不存在**（不是返回 false，是没有这个函数）
        → 原来的"媒体查询优先"这条路是死的，CSS 里的 @media (prefers-color-scheme)
          同样不会生效，只能靠 JS 挂 .vt-dark / .vt-light。
     ② `getComputedStyle(el).getPropertyValue("--x")` **读不到自定义属性**（恒返回 ""）
        → 不能直接读 --uxp-host-background-color 的值。

   现在按可靠性排序试四条路，并把命中的那条记进 boot.log（themeVia=…）：
     ① require("uxp").hostUI.theme        —— 有就直接用
     ② window.matchMedia                  —— 兼容将来版本
     ③ 渲染层读宿主背景亮度               —— 把宿主变量贴到临时元素上读解析后的
                                              background-color（走渲染，绕开 getPropertyValue）
     ④ 兜底深色（PS 默认）
*/
let themePath = "未探测";

function hostBgLuminance() {
  // 把宿主变量用在 background-color 上，再读**解析后**的颜色 —— 渲染层读法。
  // 变量不存在时该声明在计算值阶段失效 → background-color 退化为 transparent，
  // 于是我们拿到 alpha=0，明确判定"读不到"，而不是瞎猜一个 0.5。
  try {
    if (!document.body) return null;
    const probe = document.createElement("div");
    probe.setAttribute(
      "style",
      "position:absolute;left:-9999px;top:0;width:1px;height:1px;" +
        "background-color:var(--uxp-host-background-color);"
    );
    document.body.appendChild(probe);
    const bg = String(getComputedStyle(probe).backgroundColor || "");
    if (probe.parentNode) probe.parentNode.removeChild(probe);

    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i.exec(bg);
    let r;
    let g;
    let b;
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // 全透明 = 变量不存在
      r = +m[1];
      g = +m[2];
      b = +m[3];
    } else {
      const h = /#([0-9a-f]{6})/i.exec(bg);
      if (!h) return null;
      const n = parseInt(h[1], 16);
      r = (n >> 16) & 255;
      g = (n >> 8) & 255;
      b = n & 255;
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  } catch {
    return null;
  }
}

function detectDark() {
  // ① 宿主主题 API
  try {
    const t = uxpNS && uxpNS.hostUI && uxpNS.hostUI.theme;
    if (t) {
      themePath = "hostUI.theme=" + t;
      return String(t).toLowerCase().indexOf("dark") >= 0;
    }
  } catch {
    /* 继续 */
  }
  // ② 媒体查询（真机上不存在，留给以后的版本）
  try {
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq && typeof mq.matches === "boolean") {
        themePath = "matchMedia";
        return !!mq.matches;
      }
    }
  } catch {
    /* 继续 */
  }
  // ③ 渲染层读宿主背景亮度
  const lum = hostBgLuminance();
  if (lum !== null) {
    themePath = "hostBg亮度=" + lum.toFixed(2);
    return lum < 0.5;
  }
  // ④ 兜底
  themePath = "兜底深色";
  return true;
}

function applyTheme(why) {
  const dark = detectDark();
  const root = document.documentElement;
  try {
    if (dark) root.classList.add("vt-dark");
    else root.classList.remove("vt-dark");
    if (!dark) root.classList.add("vt-light");
    else root.classList.remove("vt-light");
  } catch {
    /* 极端情况下无 class，CSS 的 @media 兜底 */
  }
  return { dark: dark, via: why || "", path: themePath };
}

function watchTheme(onChange) {
  try {
    if (!window.matchMedia) return false;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (!mq) return false;
    const fire = () => onChange(detectDark() ? "dark" : "light");
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", fire);
      return true;
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(fire);
      return true;
    }
  } catch {
    /* 忽略 */
  }
  return false;
}

/* --------------------------------------------------------- 传给工具 */

const ctx = {
  pluginId: PLUGIN_ID,
  version: VERSION,
  log: log,
  ps: ps,
  store: store,
  data: data,
  dom: dom,
  icons: icons,
  caps: caps,
  setStatus: setStatus,
  shell: {
    showHome: function () {
      return showHome();
    },
    showTool: function (id, via) {
      return showTool(id, via);
    },
  },
};

/* --------------------------------------------------------------- 首页 */

/** 工具 id → 图标名（图标由 lib/icons.js 提供）。 */
function iconForTool(id) {
  if (icons.SPECS[id]) return id;
  return "grid";
}

/**
 * 首页功能行。
 * ⚠️ 用 <div role="button">，**不用 <button>** —— 真机上 button 会强制 text-align:center
 *    且不吃 display:flex，这正是之前"文字居中、无图标"的成因（见 index.html 头部 ②）。
 * @param {object} item   注册表条目
 * @param {boolean} ready 是否已实现（false = 灰行 + 点击提示）
 * @param {number} index  顺序号（发「↑n」号位 chip）
 */
function makeNavItem(item, ready, index) {
  const row = dom.el("div", {
    class: "navitem" + (ready ? "" : " is-planned"),
    role: "button",
    tabindex: "0",
    "data-tool": item.id,
    title: ready ? "打开「" + item.title + "」" : item.note || "尚未上线",
  });

  row.appendChild(icons.holder(iconForTool(item.id), "ni-ico"));

  const main = dom.el("span", { class: "ni-main" });
  main.appendChild(dom.el("span", { class: "ni-name" }, [item.title]));
  main.appendChild(dom.el("span", { class: "ni-desc" }, [item.subtitle || ""]));
  row.appendChild(main);

  row.appendChild(
    dom.el(
      "span",
      {
        class: "ni-key mono",
        title: "号位占位 —— UXP 目前不支持面板导航快捷键（只支持命令的 Ctrl+字母/数字）",
      },
      ["↑" + (index + 1)]
    )
  );

  row.appendChild(icons.holder("chev", "i ni-arrow"));

  homeBinder.on(row, "click", async () => {
    if (ready) {
      await showTool(item.id, "panel");
    } else {
      setStatus(
        "「" + item.title + "」还没上线（" + (item.badge || "待定") + "）。" +
          (item.note ? "\n" + item.note : "")
      );
      await log.appendLog("tool blocked=" + item.id + " via=panel");
    }
  });
  return row;
}

function renderHome() {
  dom.clear(ui.home);

  // hero：品牌标（透明 PNG）+ 名称 + 版本
  const hero = dom.el("div", { class: "hero" });
  hero.appendChild(
    dom.el("img", {
      class: "hero-mark",
      src: "icons/logo-mark.png",
      alt: "Vellum Desk",
    })
  );
  const heroTxt = dom.el("div", { class: "hero-txt" });
  heroTxt.appendChild(dom.el("h1", {}, ["Vellum 工具箱"]));
  heroTxt.appendChild(
    dom.el("p", { class: "hero-sub mono" }, ["v" + VERSION + " · " + PLUGIN_ID])
  );
  hero.appendChild(heroTxt);
  ui.home.appendChild(hero);

  // 原生列表：已实现工具 + 规划中工具（顺序即号位 ↑1…↑4）
  const list = dom.el("div", { class: "navlist" });
  const rows = registry.allRows();
  for (let i = 0; i < rows.length; i++) {
    list.appendChild(makeNavItem(rows[i], !!rows[i].ready, i));
  }
  ui.home.appendChild(list);

  // 环境卡（真实数据由 renderTail 填）
  ui.tail = dom.el("div", { class: "tail" });
  ui.tail.appendChild(dom.el("p", { class: "tail-title" }, ["环境"]));
  ui.home.appendChild(ui.tail);
}

function renderTail(e) {
  if (!ui || !ui.tail) return;
  while (ui.tail.children.length > 1) ui.tail.removeChild(ui.tail.lastChild);
  let first = true;
  const item = (k, v) => {
    // 首行不画上边线（不用 :first-of-type，避免伪类支持度不确定）
    const d = dom.el("div", { class: "tail-item" + (first ? " is-first" : "") });
    first = false;
    d.appendChild(dom.el("span", { class: "t-key" }, [k]));
    d.appendChild(dom.el("span", { class: "t-val mono" }, [v]));
    return d;
  };
  ui.tail.appendChild(item("Photoshop", String(e.hostVersion || "未暴露")));
  ui.tail.appendChild(item("UXP", String(e.uxp || "未暴露")));
  ui.tail.appendChild(item("插件版本", "v" + VERSION));
}

function updateEnvChip(e) {
  if (!ui || !ui.env) return;
  ui.env.textContent = "PS " + String(e.hostVersion || "?");
  if (ui.led) {
    ui.led.classList.remove("off");
    ui.led.classList.add("ok");
  }
}

/* ----------------------------------------------------------- 视图切换 */

async function showTool(id, via) {
  const t = registry.byId(id);
  if (!t) {
    setStatus("没有这个工具：" + id);
    return false;
  }
  if (currentTool && currentTool !== t) {
    try {
      currentTool.unmount();
    } catch (e) {
      await log.appendLog("tool unmount FAILED  " + ((e && e.message) || e));
    }
  }

  ui.home.classList.remove("active");
  ui.view.classList.add("active");
  // 顶栏：进工具 → 显示返回键、收起品牌标
  if (ui.back) ui.back.classList.remove("is-off");
  if (ui.logo) ui.logo.classList.remove("is-on");
  ui.title.textContent = t.title;
  ui.sub.textContent = t.subtitle || "";
  ui.sub.style.display = t.subtitle ? "" : "none";

  currentTool = t;
  await t.mount(ui.view, ctx);
  await log.appendLog("tool open=" + t.id + " via=" + (via || "panel"));
  return true;
}

function showHome() {
  if (!ui) return false;
  if (currentTool) {
    try {
      currentTool.unmount();
    } catch {
      /* 忽略 */
    }
    currentTool = null;
  }
  dom.clear(ui.view);
  ui.view.classList.remove("active");
  ui.home.classList.add("active");
  // 顶栏：回首页 → 收起返回键、显示品牌标
  if (ui.back) ui.back.classList.add("is-off");
  if (ui.logo) ui.logo.classList.add("is-on");
  ui.title.textContent = "Vellum 工具箱";
  ui.sub.textContent = "";
  ui.sub.style.display = "none";
  return true;
}

/* ------------------------------------------------------------- 命令入口 */

async function commandBrand(slot) {
  try {
    const hex = await palette.primaryBrandHex();
    const res = await palette.applyHex(hex, slot, "品牌主色", "command");
    return res;
  } catch (e) {
    const m = (e && e.message) || String(e);
    await log.appendLog("command FAILED slot=" + slot + "  " + m);
    return { ok: false, error: m };
  }
}

/** 品牌主色 → 填充当前图层/选区（v0.2.2）。与面板里的 Alt+左键共用 palette.fillHex。 */
async function commandFill() {
  try {
    const hex = await palette.primaryBrandHex();
    const res = await palette.fillHex(hex, "品牌主色", "command");
    return res;
  } catch (e) {
    const m = (e && e.message) || String(e);
    await log.appendLog("command FAILED fill  " + m);
    return { ok: false, error: m };
  }
}

/* --------------------------------------------------------------- 启动 */

function whenReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn);
  } else {
    fn();
  }
}

async function init(reason) {
  if (inited) return;
  inited = true;

  homeBinder = dom.makeBinder();
  ui = {
    app: dom.$("vt-app"),
    home: dom.$("vt-home"),
    view: dom.$("vt-tool-view"),
    status: dom.$("vt-status"),
    title: dom.$("vt-title"),
    sub: dom.$("vt-sub"),
    back: dom.$("vt-back"),
    logo: dom.$("vt-logo"),
    chip: dom.$("vt-chip"),
    led: dom.$("vt-led"),
    env: dom.$("vt-env"),
    tail: null,
  };

  // 顶栏图标（自绘 SVG，不是 sp-* 控件）
  if (ui.back) {
    dom.clear(ui.back);
    ui.back.appendChild(icons.holder("back", "i"));
  }

  const theme = applyTheme("boot");
  watchTheme(() => applyTheme("change"));

  homeBinder.on(ui.back, "click", () => showHome());
  // 环境详情：原来挂在右侧「⋯」按钮上，本轮为把 chip 靠右而合并到 chip 自身
  homeBinder.on(ui.chip, "click", async () => {
    const e = await caps.env();
    let folder = "?";
    try {
      folder = await data.dataFolderPath();
    } catch {
      /* 忽略 */
    }
    setStatus(
      "环境：" + e.host + " " + e.hostVersion + "　UXP " + e.uxp +
        "　主题 " + (theme.dark ? "深色" : "浅色") +
        "　数据目录 " + folder
    );
  });

  renderHome();
  showHome();

  const e = await caps.env();
  updateEnvChip(e);
  renderTail(e);

  await log.appendLog(
    "loaded  plugin=" + PLUGIN_ID + "  v=" + VERSION +
    "  host=" + e.host + "/" + e.hostVersion +
    "  uxp=" + e.uxp +
    "  psMajor=" + (e.psMajor || "?") +
    "  theme=" + (theme.dark ? "dark" : "light") +
    "  themeVia=" + (theme.path || "?") +
    "  locale=" + e.locale +
    "  via=" + (reason || "boot")
  );
  await log.appendLog("paths   data=" + (await data.dataFolderPath()));

  let doVerify = false;
  try {
    doVerify = await data.pluginFlag("verify.flag");
  } catch {
    doVerify = false;
  }

  if (doVerify) {
    try {
      await selfcheck.run(ctx, {
        palette: palette,
        library: library,
        registry: registry,
        icons: icons,
      });
    } catch (err) {
      await log.appendLog("selfcheck FAILED  " + ((err && err.message) || err));
    }
    showHome();
  }
}

entrypoints.setup({
  plugin: {
    create() {
      whenReady(() => init("plugin.create"));
    },
  },
  panels: {
    vellumToolboxPanel: {
      create() {
        whenReady(() => init("panel.create"));
      },
      show() {
        whenReady(() => init("panel.show"));
      },
    },
  },
  commands: {
    brandPrimaryToForeground: {
      async run() {
        await commandBrand("foreground");
      },
    },
    brandPrimaryToBackground: {
      async run() {
        await commandBrand("background");
      },
    },
    brandPrimaryFill: {
      async run() {
        await commandFill();
      },
    },
  },
});

whenReady(() => init("boot"));
