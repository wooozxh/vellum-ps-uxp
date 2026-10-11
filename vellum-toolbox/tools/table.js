/*
 * tools/table.js —— 表格生成（M3）
 * ===========================================================================
 * 用户拍板的形态：
 *   · 「每格一个文字图层 + 矢量线条，插入后可继续编辑」（tools/index.js 里的定案）
 *   · UI 走「工作台 + 列抽屉」：数据永远在眼前，区域/样式/绑定三个块折叠，
 *     底部两个动作常驻（生成表格 / 生成 N 个稿件）；**点列头就地长出这一列的设置**
 *
 * 这一轮（v0.4.0）落地的是 **M3a：CSV → 一张可继续编辑的表格**。
 * 「按行批量出稿」（M3b）按用户拍板是**并列的第二个动作**，本轮先把按钮放在那儿并
 * **如实置灰**（写明"下一步做"），不假装能用。
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ 为什么这一页能成立（全部是 v0.3.8 / v0.3.9 的真机读数，不是猜的）
 * ════════════════════════════════════════════════════════════════════════
 *   · 线条 = **矩形形状图层**（`kind=solidColor` = 内容图层 = 矢量），
 *     bounds 精确命中、线内取色命中（S31）
 *   · 文字 = **框文本**（`char:box` + bounds）；字号/颜色建层时给，
 *     **对齐**走 `set _property:"paragraphStyle"` 的 `align`（枚举族 `alignmentType`），
 *     左/中/右三档都验过（S32 / S37）；文字内容以后要换就走 DOM `textItem.contents`
 *   · 区域 = **有选区按选区、没选区按落点**（S36 验过两端都能分辨）
 *   · 一条命令都不许逐条发：批量 `batchPlay` 37.5ms/层，逐条 267ms/层（差 7.8 倍，S34）
 *   · CSV = 自己解码（UXP 没有 TextDecoder；GBK 查表；UTF-16 明确拒绝）
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ UXP 硬约束（每一处都踩过）
 * ════════════════════════════════════════════════════════════════════════
 *   · 无 gap / 无 Grid / 无伪元素；表格预览**不能**用 <table> ⇒ flex 行 + 百分比宽
 *   · 不用 <button> ⇒ 一律 div[role="button"]（`.tbtn`）；间距全走 margin
 *   · 没有原生数字输入可用（`<input>` 在这一版没验过）⇒ **自绘步进器 `.tnum`**
 *   · 面板会被反复 mount / unmount ⇒ 所有监听器走 binder.offAll()
 *   · 布局是异步的 ⇒ 需要几何时先 `dom.settle()`
 */

const dom = require("../lib/dom.js");
const log = require("../lib/log.js");
const store = require("../lib/store.js");
const csv = require("../lib/csv.js");
const tbl = require("../lib/table.js");
const ps = require("../lib/ps.js");

const PREF_FILE = "table-pref.json";
/** 没有选区时，落点锚上放多大的框（后续可做成参数） */
const ANCHOR_W = 420;
const ANCHOR_H = 320;

/**
 * 插件自带的样例数据（放在插件目录 `samples/` 里，随 ccx 一起走）。
 *
 * 为什么要有它：**面板里真正的"导入 CSV"要弹系统文件选择器，而系统弹窗
 * 自检点不了、自动化也点不了** ⇒ 那样"解码 → 解析 → 预览 → 生成"这条链子
 * 就永远只有"结构断言"没有"行为断言"。内置样例把这条链子补上：
 * 除了最后那一次 `getFileForOpening()`，**走的是完全相同的读字节与解析路径**
 * （同样 `read({format:binary})`、同样 `csv.readBytes()`）。
 *
 * 顺带它也是个真功能：第一次装插件的人不用先去找 CSV 就能看到效果。
 * 三份分别压 **UTF-8 / GBK / TSV** 三种真实情况（GBK 是中文 Excel
 * 「另存为 CSV」的默认编码，最容易踩）。
 */
const SAMPLE_SPECS = [
  { id: "utf8", label: "UTF-8", file: "prices-2026.csv", note: "普通 UTF-8（带 CRLF）" },
  { id: "gbk", label: "GBK", file: "prices-2026-gbk.csv", note: "GBK 编码（中文 Excel 另存为 CSV 的默认）" },
  { id: "tsv", label: "TSV", file: "prices-2026-tab.tsv", note: "制表符分隔" },
];

let ctx = null;
let binder = null;
let root = null;
let refs = null;
let S = null;

function setStatus(text) {
  if (ctx && ctx.setStatus) ctx.setStatus(String(text));
}

/**
 * 面板**可能随时被 unmount**（切工具、关面板），而面板里到处是**异步**回调
 * （点一下样式要重算区域、导入要读文件、生成要跑几秒）。
 * 这些回调在 await 之后必须重新确认"我还活着"，否则会摸到已经置 null 的 `S`：
 *   `TypeError: Cannot set properties of null (setting 'region')`
 * —— 这是离线回归**当场抓到的**（v0.4.4），真机上"点完样式马上切走"会撞同一个坑。
 */
function alive() {
  return !!S && !!refs;
}

/** 文件名去扩展名（只砍已知后缀，和 v0.3.6 的图层命名同一条纪律） */
function baseName(fileName) {
  const n = String(fileName || "表格");
  const m = /\.(csv|txt|tsv)$/i.exec(n);
  return (m ? n.slice(0, n.length - m[0].length) : n).trim() || "表格";
}

function fmtRect(r) {
  if (!r) return "?";
  const n = (v) => Math.round(Number(v));
  return n(r.left) + "," + n(r.top) + " → " + n(r.right) + "," + n(r.bottom);
}

/* ==========================================================================
 * 界面骨架
 * ========================================================================== */

function el(tag, cls, id, text) {
  const a = {};
  if (cls) a.class = cls;
  if (id) a.id = id;
  if (text !== undefined) a.text = text;
  return dom.el(tag, a);
}

/** 折叠块：标题 + 右侧摘要（收起也知道现状）+ 内容。 */
function makeGroup(title, id, summary) {
  const wrap = el("div", "tbl-grp closed", id);
  const gh = el("div", "tbl-gh");
  const t = el("span", "t", null, title);
  const n = el("span", "n", null, summary || "");
  /* 🔴 v0.4.4：这里原来还有一个 `.cv`（用 border 技巧画的折角三角）。
     真机上 UXP **不支持透明边框** ⇒ 它退化成**实心黑方块**、还贴在面板右边缘。
     用户点名要删 —— 删掉。折叠状态由"内容显不显示"本身就看得出来了。 */
  gh.appendChild(t);
  gh.appendChild(n);
  const gb = el("div", "tbl-gb");
  wrap.appendChild(gh);
  wrap.appendChild(gb);
  return { wrap: wrap, gh: gh, gb: gb, n: n, title: t };
}

function field(label, ctl) {
  const row = el("div", "tf");
  row.appendChild(el("span", "lb", null, label));
  const ct = el("div", "ct");
  if (ctl) ct.appendChild(ctl);
  row.appendChild(ct);
  return row;
}

/** 分段控件：options = [{v,label}] */
/**
 * 分段控件（自绘）。
 * 🔴 v0.4.4：点选时**必须自己把高亮挪过去**。原来只在构建时算一次 `on`，
 * 点击只改状态、不碰 DOM ⇒ 真机上"改了选项，高亮不动，切一下 tab 才跳过去"
 * （用户报的第 2 条）。这类"状态变了但界面没跟着变"的 bug 一条修掉全部控件。
 */
function seg(id, options, value, onPick) {
  const box = el("div", "tseg", id);
  const kids = [];
  const paint = (cur) => {
    kids.forEach((k, i) => {
      if (k.classList && k.classList.add && k.classList.remove) {
        if (options[i].v === cur) k.classList.add("on");
        else k.classList.remove("on");
      } else {
        /* 兜底（离线 mock 没有 classList）：直接写 class */
        k.setAttribute("class", options[i].v === cur ? "on" : "");
      }
    });
  };
  options.forEach((o) => {
    const d = el("div", o.v === value ? "on" : null, null, o.label);
    d.setAttribute("role", "button");
    d.onclick = () => {
      paint(o.v);       // ← 先挪高亮，再回调（回调可能只更新状态/重算预估）
      onPick(o.v);
    };
    kids.push(d);
    box.appendChild(d);
  });
  box.__paint = paint;
  return box;
}

/**
 * 数字步进器（自绘）。
 * UXP 这一版没验过 `<input>`，所以不赌它 —— 加减两个按钮 + 中间读数，行为完全确定。
 */
function num(id, value, opt, onChange) {
  const o = Object.assign({ min: 0, max: 999, step: 1 }, opt || {});
  const box = el("div", o.cpt ? "tnum cpt" : "tnum", id);
  const mn = el("div", "mn", null, "−");
  const vl = el("div", "vl", null, String(value));
  const pl = el("div", "pl", null, "+");
  mn.setAttribute("role", "button");
  pl.setAttribute("role", "button");
  const set = (v) => {
    let nv = Math.round(v);
    if (nv < o.min) nv = o.min;
    if (nv > o.max) nv = o.max;
    if (nv === value) return;
    value = nv;
    vl.textContent = String(nv);
    onChange(nv);
  };
  mn.onclick = () => set(value - o.step);
  pl.onclick = () => set(value + o.step);
  box.appendChild(mn);
  box.appendChild(vl);
  box.appendChild(pl);
  box.__set = set;
  return box;
}

function colorChip(hex) {
  const c = el("span", "tclr");
  c.setAttribute("style", "background:" + String(hex));
  return c;
}

function note(text) {
  return el("p", "tnote", null, text);
}

function warnRow(text, id) {
  const w = el("div", "twarn", id);
  w.appendChild(el("span", "tdot"));
  w.appendChild(el("span", null, null, text));
  return w;
}

function btn(label, cls, id) {
  const b = el("div", "tbtn" + (cls ? " " + cls : ""), id, label);
  b.setAttribute("role", "button");
  return b;
}

/* --------------------------------------------------------------------------
 * 表格预览：**每行一个 flex 行 + 百分比宽**（UXP 不能 <table>）
 * 点表头 = 打开这一列的抽屉
 * ------------------------------------------------------------------------ */
function renderGrid() {
  if (!alive() || !refs || !refs.grid) return;
  dom.clear(refs.grid);
  if (!S.norm || !S.norm.cols) {
    const e = el("div", "tbl-empty", null, "还没有数据。");
    refs.grid.appendChild(e);
    return;
  }
  const cols = S.norm.cols;
  // 用与真实生成一致的**列宽比例**（拿 400px 当参考宽算一遍比例即可）
  const widths = tbl.columnWidths(S.norm.header, S.norm.body, 400, S.style.colwMode, S.style.colWidth);
  const total = widths.reduce((a, b) => a + b, 0) || 1;

  const rows = [S.norm.header].concat(S.norm.body);
  for (let i = 0; i < rows.length; i++) {
    const r = el("div", "tbl-row" + (i === 0 && S.headerRow ? " hd" : ""));
    for (let c = 0; c < cols; c++) {
      const cell = el("div", "tbl-c" + (S.openCol === c ? " hot" : ""), null,
        String(rows[i][c] === undefined ? "" : rows[i][c]));
      cell.setAttribute("style", "flex:0 0 " + ((widths[c] / total) * 100).toFixed(3) + "%");
      if (i === 0) cell.onclick = () => openCol(c);
      r.appendChild(cell);
    }
    refs.grid.appendChild(r);
  }
}

/** 顶部的源文件行 / 编码行 */
function renderTop() {
  if (!alive() || !refs) return;
  dom.clear(refs.src);
  if (!S.fileName) {
    const b = btn("导入 CSV", "sm", "vt-tbl-import");
    b.onclick = () => doImport();
    refs.src.appendChild(el("span", "nm", null, "还没有导入数据"));
    const sp = el("span", "tbl-grow");
    refs.src.appendChild(sp);
    refs.src.appendChild(b);
  } else {
    refs.src.appendChild(el("span", "nm", null, S.fileName));
    refs.src.appendChild(el("span", "cnt", null, S.rows.length + " 行 · " + (S.norm ? S.norm.cols : 0) + " 列"));
    const sp = el("span", "tbl-grow");
    refs.src.appendChild(sp);
    const b = btn("换一个", "sm gh", "vt-tbl-reimport");
    b.onclick = () => doImport();
    refs.src.appendChild(b);
  }

  dom.clear(refs.trybar);
  if (!S.fileName) {
    refs.trybar.appendChild(el("span", "lb", null, "没有 CSV？用内置样例试："));
    for (const sp of SAMPLE_SPECS) {
      const b = btn(sp.label, "sm gh", "vt-tbl-sample-" + sp.id);
      b.setAttribute("style", "margin-left:6px");
      b.onclick = () => loadSample(sp.id);
      refs.trybar.appendChild(b);
    }
  }

  dom.clear(refs.enc);
  if (S.encError) {
    refs.enc.className = "tbl-enc bad";
    const t = el("span", null, null, S.encError);
    refs.enc.appendChild(t);
  } else if (S.encText) {
    refs.enc.className = "tbl-enc" + (S.encWarn ? " bad" : "");
    const t = el("span");
    t.appendChild(el("b", null, null, S.encoding || "?"));
    refs.enc.appendChild(t);
    refs.enc.appendChild(el("span", null, null, S.encText));
  }
}

/* --------------------------------------------------------------------------
 * 列抽屉：点列头就地设置这一列（方向 3 的那个交互，并进方向 2 的骨架里）
 * ------------------------------------------------------------------------ */
function openCol(c) {
  S.openCol = (S.openCol === c) ? -1 : c;
  renderGrid();
  renderDrawer();
}

function renderDrawer() {
  if (!alive() || !refs || !refs.drawer) return;
  dom.clear(refs.drawer);
  if (!S.norm || S.openCol < 0 || S.openCol >= S.norm.cols) {
    refs.drawer.setAttribute("style", "display:none");
    return;
  }
  refs.drawer.setAttribute("style", "");
  const c = S.openCol;

  const dh = el("div", "tbl-dh");
  const dot = el("span", "tdot");
  dot.setAttribute("style", "background:var(--vt-ac);width:6px;height:6px;border-radius:50%");
  dh.appendChild(dot);
  dh.appendChild(el("span", "t", null, "第 " + (c + 1) + " 列 ·「" + S.norm.header[c] + "」"));
  const close = btn("收起", "sm gh", "vt-tbl-colclose");
  close.onclick = () => openCol(c);
  dh.appendChild(close);
  refs.drawer.appendChild(dh);

  // 列宽
  const curW = tbl.columnWidths(S.norm.header, S.norm.body, 400, S.style.colwMode, S.style.colWidth)[c];
  const wBox = num("vt-tbl-colw", S.style.colWidth[c] || curW, { min: 20, max: 400, step: 6 }, (v) => {
    S.style.colWidth[c] = v;
    savePref();
    renderDrawer();
    renderGrid();
  });
  refs.drawer.appendChild(field("列宽", wBox));
  const unit = el("span", "tunit", null, "px");
  wBox.parentNode.appendChild(unit);

  // 对齐（默认居中，三档都可设 —— S37 验过）
  refs.drawer.appendChild(field("对齐", seg(
    "vt-tbl-colalign",
    [{ v: "left", label: "左" }, { v: "center", label: "中" }, { v: "right", label: "右" }],
    S.style.colAlign[c] || S.style.rowAlign,
    (v) => {
      S.style.colAlign[c] = v;
      savePref();
      renderDrawer();
    }
  )));

  refs.drawer.appendChild(note("对齐是**你选的**，不是按内容猜的 —— 我们不做「数字自动右对齐」那种猜。"));
}

/* ==========================================================================
 * 参数面板（三个折叠块）
 * ========================================================================== */

function renderAreaGroup() {
  const g = refs.g1;
  dom.clear(g.gb);

  g.gb.appendChild(field("区域来源", seg(
    "vt-tbl-areasrc",
    [{ v: "selection", label: "用画布选区" }, { v: "anchor", label: "用落点锚" }],
    S.regionSource,
    (v) => { S.regionSource = v; savePref(); renderAreaGroup(); refreshRegion(); }
  )));

  const info = el("div", "tnote", "vt-tbl-regioninfo");
  g.gb.appendChild(info);

  g.gb.appendChild(field("表头高", withUnit(num("vt-tbl-hh", S.style.headerH, { min: 16, max: 200, step: 2 }, (v) => {
    S.style.headerH = v; savePref(); refreshRegion(); updateValignNote();
  }), "px")));
  g.gb.appendChild(field("行高", withUnit(num("vt-tbl-rh", S.style.rowH, { min: 16, max: 200, step: 2 }, (v) => {
    S.style.rowH = v; savePref(); refreshRegion(); updateValignNote();
  }), "px")));

  // 内边距：上右下左（它是**排版参数**，决定文字框 bounds 的收缩量）
  /* 🔴 这一行并排放 **4 个**，所以必须用紧凑版（`.tnum.cpt`，64px）：
     全尺寸 88px 的话 4 × 88 = 352 > `.ct` 可用的 ~308px ⇒ 必然溢出、互相压。
     （真机上曾经就是这样：用户看到"数字上有灰色字符遮挡"。宽度是**写死**的，
      原因见 index.html 里那段注释：UXP 算 flex 容器自身尺寸时**不认 flex-basis**。） */
  const pad = el("div", "ct");
  ["t", "r", "b", "l"].forEach((k, i) => {
    const b = num("vt-tbl-pad-" + k, S.style.pad[k], { min: 0, max: 60, step: 1, cpt: true }, (v) => {
      S.style.pad[k] = v; savePref(); refreshRegion(); updateValignNote();
    });
    if (i > 0) b.setAttribute("style", "margin-left:5px");
    pad.appendChild(b);
  });
  g.gb.appendChild(field("内边距", pad));
  g.gb.appendChild(note("上 / 右 / 下 / 左。它决定文字框比格子内缩多少，是排版的一部分。"));

  g.gb.appendChild(field("列宽", seg(
    "vt-tbl-colwmode",
    [{ v: "even", label: "等分" }, { v: "content", label: "按内容" }],
    S.style.colwMode,
    (v) => { S.style.colwMode = v; savePref(); renderAreaGroup(); renderGrid(); renderDrawer(); }
  )));
  g.gb.appendChild(note("想单独改某一列：点上面表格里那一列的**表头**。"));
}

function withUnit(node, unit) {
  const box = el("span");
  box.setAttribute("style", "display:flex;align-items:center");
  box.appendChild(node);
  box.appendChild(el("span", "tunit", null, unit));
  return box;
}

function renderStyleGroup() {
  const g = refs.g2;
  dom.clear(g.gb);

  // tab：通用 / 表头 / 行
  const tabs = el("div", "ttabs", "vt-tbl-styletabs");
  [["g", "通用"], ["h", "表头"], ["r", "行"]].forEach(([k, label]) => {
    const d = el("div", S.tab === k ? "on" : null, null, label);
    d.setAttribute("role", "button");
    d.onclick = () => { S.tab = k; renderStyleGroup(); };
    tabs.appendChild(d);
  });
  g.gb.appendChild(tabs);

  const pane = el("div");

  /* 水平对齐三档的**文案**（用户 2026-10-11 要求写全：「左对齐 / 水平居中 / 右对齐」） */
  const H_OPTS = [
    { v: "left", label: "左对齐" },
    { v: "center", label: "水平居中" },
    { v: "right", label: "右对齐" },
  ];
  /* 垂直对齐：PS 的框文本**只能从框顶往下排**，没有"框内垂直居中"这个属性
     ⇒ 这三档是靠**把文字框缩到一行高、再挪到目标位置**做出来的（见 lib/table.js 的 valign）。 */
  const V_OPTS = [
    { v: "top", label: "顶对齐" },
    { v: "middle", label: "垂直居中" },
    { v: "bottom", label: "底对齐" },
  ];

  if (S.tab === "g") {
    pane.appendChild(field("线条规则", seg("vt-tbl-border",
      [{ v: "all", label: "横竖都有" }, { v: "h", label: "只要横线" }, { v: "v", label: "只要竖线" }, { v: "none", label: "都不要" }],
      S.style.border, (v) => { S.style.border = v; savePref(); refreshRegion(); })));
    pane.appendChild(field("外框宽", withUnit(num("vt-tbl-sw", S.style.strokeW, { min: 0, max: 10, step: 1 }, (v) => {
      S.style.strokeW = v; savePref(); refreshRegion();
    }), "px")));
    pane.appendChild(field("圆角半径", withUnit(num("vt-tbl-radius", S.style.radius, { min: 0, max: 40, step: 2 }, (v) => {
      S.style.radius = v; savePref(); refreshRegion();
    }), "px")));
    pane.appendChild(field("底色", seg("vt-tbl-rowbg",
      [{ v: "none", label: "无" }, { v: "solid", label: "单色" }],
      S.style.rowBgMode, (v) => { S.style.rowBgMode = v; savePref(); refreshRegion(); })));
  } else if (S.tab === "h") {
    pane.appendChild(field("水平对齐", seg("vt-tbl-halign", H_OPTS,
      S.style.headerAlign, (v) => { S.style.headerAlign = v; savePref(); refreshRegion(); })));
    pane.appendChild(field("垂直对齐", seg("vt-tbl-hvalign", V_OPTS,
      S.style.headerVAlign, (v) => { S.style.headerVAlign = v; savePref(); refreshRegion(); })));
    pane.appendChild(valignNote(true));
    pane.appendChild(field("背景", seg("vt-tbl-hbg",
      [{ v: "none", label: "无" }, { v: "solid", label: "单色" }],
      S.style.headerBgMode, (v) => { S.style.headerBgMode = v; savePref(); refreshRegion(); })));
    pane.appendChild(field("字号", withUnit(num("vt-tbl-hfs", S.style.headerFontPx, { min: 6, max: 72, step: 1 }, (v) => {
      S.style.headerFontPx = v; savePref(); refreshRegion(); updateValignNote();
    }), "px")));
    pane.appendChild(note("字号与颜色**建层时**就给（官方框文本描述符），改完仍是普通文字层。"));
  } else {
    pane.appendChild(field("水平对齐", seg("vt-tbl-ralign", H_OPTS,
      S.style.rowAlign, (v) => { S.style.rowAlign = v; savePref(); refreshRegion(); })));
    pane.appendChild(field("垂直对齐", seg("vt-tbl-rvalign", V_OPTS,
      S.style.rowVAlign, (v) => { S.style.rowVAlign = v; savePref(); refreshRegion(); })));
    pane.appendChild(valignNote(false));
    pane.appendChild(field("隔行变色", seg("vt-tbl-zebra",
      [{ v: "off", label: "关" }, { v: "on", label: "开" }],
      S.style.zebra ? "on" : "off", (v) => { S.style.zebra = v === "on"; savePref(); refreshRegion(); })));
    pane.appendChild(field("字号", withUnit(num("vt-tbl-fs", S.style.fontPx, { min: 6, max: 72, step: 1 }, (v) => {
      S.style.fontPx = v; savePref(); refreshRegion(); updateValignNote();
    }), "px")));
    pane.appendChild(note("每个格子一个文字层，所以改某一行某个字以后可以直接在画布上双击改。"));
  }
  g.gb.appendChild(pane);
}

/* ── 垂直对齐那条**动态**说明（v0.4.6）──────────────────────────────────────
   用户报「垂直居中没有生效」，量出来的真相是：**生效了，但位移只有 2px**
   （行高 28 / 字号 12 ⇒ 内容高 20、墨迹高 9.8 ⇒ 三档总共只有 10px 可调，
   当时还是老的"按框对齐 + 箱高 1.32em"，只余 4px）。
   ⇒ 与其让用户以为坏了，不如**把可调位移写在界面上**，并说清"行高越大越明显"。
   这条要随 行高 / 字号 / 内边距 就地更新，所以留一个模块级引用。 */
let valignNoteEl = null;

function valignNoteText(isHeader) {
  const travel = tbl.inkTravel(S.style, isHeader);
  const h = isHeader ? S.style.headerH : S.style.rowH;
  const em = isHeader ? S.style.headerFontPx : S.style.fontPx;
  return "三档之间的文字位移约 " + travel + "px（由行高 " + h + " 与字号 " + em + " 决定）。" +
    (travel < 6
      ? "现在偏紧，所以差别不明显 —— 把行高调大就会很明显。"
      : "行高比字号大得越多，差别越明显。");
}

function valignNote(isHeader) {
  valignNoteEl = el("p", "tnote", "vt-tbl-vanote", valignNoteText(isHeader));
  return valignNoteEl;
}

/** 行高/字号/内边距变了就地刷新那条说明（不重建整个面板，免得把用户正在点的控件换掉） */
function updateValignNote() {
  if (valignNoteEl && S) valignNoteEl.textContent = valignNoteText(S.tab === "h");
}

function renderBindGroup() {
  const g = refs.g3;
  dom.clear(g.gb);
  g.n.textContent = "下一步做";
  const w = el("div", "tnote");
  w.appendChild(el("span", null, null,
    "「按行批量出稿」是把每一行套进**你自己的版式**（列名 ↔ 图层名），一份稿一行数据。"));
  g.gb.appendChild(w);
  g.gb.appendChild(note(
    "技术已经验过：复制图层组 + 只改副本里的文字（副本改了、原件不动）。这一轮先把界面位置留出来，" +
    "下一次开工做绑定表与出稿。"
  ));
}

/** 更新折叠块标题上的摘要（收起也知道现状） */
function renderGroupSummaries() {
  if (!alive() || !refs || !S.norm) return;
  if (S.region) {
    refs.g1.n.textContent = S.region.from === "selection"
      ? "选区 " + Math.round(S.region.rect.right - S.region.rect.left) + "×" + Math.round(S.region.rect.bottom - S.region.rect.top)
      : "落点锚";
  } else {
    refs.g1.n.textContent = "无区域";
  }
  refs.g2.n.textContent = "通用 / 表头 / 行";
  if (S.plan && S.plan.ok) {
    refs.g3.n.textContent = "下一步做";
  }
}

/* ==========================================================================
 * 状态与数据
 * ========================================================================== */

function rebuildNorm() {
  if (!S.rows || !S.rows.length) {
    S.norm = null;
    return;
  }
  S.norm = tbl.normalizeRows(S.rows, S.headerRow);
}

async function refreshRegion() {
  if (!alive()) return;
  const r = await resolveRegion();
  if (!alive()) return;          // ← 等来的可能是"面板已经被关了"
  S.region = r.ok ? { from: r.from, rect: r.rect } : null;
  S.regionError = r.ok ? null : r.error;
  const info = refs && refs.g1 ? refs.g1.gb.querySelector("#vt-tbl-regioninfo") : null;
  if (info) {
    dom.clear(info);
    if (!r.ok) {
      info.textContent = "读不到区域：" + r.error;
    } else if (r.from === "selection") {
      info.textContent = "已读到选区 " + fmtRect(r.rect) + "（宽 " +
        Math.round(r.rect.right - r.rect.left) + " · 高 " + Math.round(r.rect.bottom - r.rect.top) + "）";
    } else {
      info.textContent = "当前没有选区 ⇒ 按落点放一个 " + ANCHOR_W + "×" + ANCHOR_H + " 的框：" + fmtRect(r.rect);
    }
  }
  // 顺手更新"会生成多少层"的预估
  updateEstimate();
  renderGroupSummaries();
}

function currentPlan() {
  if (!S.norm || !S.region) return null;
  const info = ps.docInfo() || {};
  return tbl.layoutTable({
    header: S.norm.header,
    body: S.norm.body,
    region: S.region.rect,
    style: S.style,
    /* 🔴 文档 ppi 必须给：字号是**物理单位**（pt），而我们的布局全是画布像素，
       两者靠 ppi 换算；垂直居中/底对齐要拿"文字实际有多高"来定位，非它不可。 */
    ppi: info.resolution || 72,
  });
}

function updateEstimate() {
  if (!alive() || !refs.estimate) return;
  const plan = currentPlan();
  S.plan = plan;
  dom.clear(refs.estimate);
  if (!plan) {
    refs.estimate.textContent = S.regionError ? ("区域不可用：" + S.regionError) : "导入数据后这里会显示预估。";
    if (refs.btnGen) refs.btnGen.className = "tbtn pri off";
    return;
  }
  if (!plan.ok) {
    refs.estimate.textContent = plan.error + (plan.tooMany ? "（可减少行数，或只生成选中行）" : "");
    if (refs.btnGen) refs.btnGen.className = "tbtn pri off";
    return;
  }
  if (refs.btnGen) refs.btnGen.className = "tbtn pri";
  let s = tbl.describe(plan);
  if (plan.warnings.length) s += "　⚠ " + plan.warnings[0];
  refs.estimate.textContent = s;
}

async function resolveRegion() {
  const info = ps.docInfo() || {};
  if (!info.docW) return { ok: false, error: "没有打开的文档" };
  if (S.regionSource === "selection") {
    const sel = ps.readSelectionBounds();
    if (sel) return { ok: true, from: "selection", rect: sel };
  }
  const base = ps.placeBaseCenter();
  if (!base.ok) return { ok: false, error: base.error };
  return {
    ok: true, from: "anchor",
    rect: {
      left: base.cx - ANCHOR_W / 2, top: base.cy - ANCHOR_H / 2,
      right: base.cx + ANCHOR_W / 2, bottom: base.cy + ANCHOR_H / 2,
    },
  };
}

/* -------------------------------------------------------------------------- */

async function doImport() {
  let entry = null;
  try {
    const lfs = require("uxp").storage.localFileSystem;
    log.appendLog("table import ask 文件选择器（getFileForOpening types=csv,txt,tsv）");
    entry = await lfs.getFileForOpening({ types: ["csv", "txt", "tsv"] });
  } catch (e) {
    /* 🔴 这条也**必须写日志**：文件选择器弹不出来时，屏幕上只有一行会消失的状态文案，
       事后在 boot.log 上查不到任何痕迹（v0.4.2 之前就是这样）。 */
    const m = (e && e.message) || String(e);
    log.appendLog("table import FAILED 文件选择器抛错：" + m);
    setStatus("打开文件选择器失败：" + m);
    return;
  }
  if (!entry) {
    log.appendLog("table import cancel 用户取消了文件选择");
    setStatus("没有选择文件");
    return;
  }

  const formats = (require("uxp").storage || {}).formats || {};
  if (!formats.binary) {
    log.appendLog("table import FAILED 这个 UXP 版本没有 formats.binary");
    setStatus("这个 UXP 版本没有二进制读 ⇒ 读不了 CSV（会只能按文本读，中文会被毁）");
    return;
  }
  let u8 = null;
  try {
    const buf = await entry.read({ format: formats.binary });
    u8 = new Uint8Array(buf);
  } catch (e) {
    const m = (e && e.message) || String(e);
    log.appendLog("table import FAILED 读文件抛错：" + m);
    setStatus("读文件失败：" + m);
    return;
  }
  await ingest(u8, entry.name || "未命名", "picker");
}

/**
 * 读**插件自带**的样例文件（不弹任何系统窗口）。
 * ⚠️ 这条入口的存在理由见 `SAMPLE_SPECS` 上面那段：系统弹窗自动化点不了，
 *    而这条走的是**同样的字节读 + 同样的解码解析**，只少最后那一次 `getFileForOpening()`。
 */
async function loadSample(id) {
  if (!alive()) return;
  const spec = SAMPLE_SPECS.filter((s) => s.id === id)[0];
  if (!spec) {
    setStatus("没有这个样例：" + id);
    return;
  }
  setStatus("正在读内置样例「" + spec.file + "」（" + spec.note + "）…");
  let u8 = null;
  try {
    const uxp = require("uxp");
    const formats = uxp.storage.formats || {};
    const pf = await uxp.storage.localFileSystem.getPluginFolder();
    const dir = await pf.getEntry("samples");
    const entry = await dir.getEntry(spec.file);
    const buf = await entry.read({ format: formats.binary });
    u8 = new Uint8Array(buf);
  } catch (e) {
    const m = (e && e.message) || String(e);
    setStatus("读不到内置样例「" + spec.file + "」：" + m + "　⇒ 用上面的「导入 CSV」自己选一个文件");
    log.appendLog("table sample FAILED file=" + spec.file + " err=" + m);
    return;
  }
  await log.appendLog("table sample load file=" + spec.file + " bytes=" + u8.length);
  await ingest(u8, spec.file, "sample");
}

/**
 * 把一批字节接进来：**解码 → 解析 → 预览 → 量区域**。
 * 「导入 CSV」（系统弹窗）与「内置样例」共用这一段 —— 两条路的差别**只在怎么拿到字节**。
 */
async function ingest(u8, fileName, via) {
  if (!alive()) return null;
  let res = null;
  try {
    res = csv.readBytes(u8);
  } catch (e) {
    res = { ok: false, error: (e && e.message) || String(e) };
  }

  S.fileName = fileName || "未命名";
  S.openCol = -1;
  if (!res.ok) {
    S.rows = null;
    S.norm = null;
    S.encoding = null;
    S.encError = res.error || "读不了这个文件";
    S.encText = res.hex ? "（文件开头：" + res.hex + "）" : "";
    S.encWarn = true;
    log.appendLog("table import FAILED file=" + S.fileName + " via=" + via + " err=" + (res.error || "?"));
  } else {
    S.rows = res.rows;
    S.encoding = res.encoding;
    S.encError = null;
    S.encWarn = !!res.unmapped;
    S.encText = "　" + res.rows.length + " 行";
    if (res.unmapped) S.encText += "　⚠ 有 " + res.unmapped + " 处没有对应字（已标成 \uFFFD）";
    if (res.note) S.encText += "　" + res.note;
    if (res.warnings && res.warnings.length) S.encText += "　" + res.warnings.join("；");
    rebuildNorm();
    log.appendLog("table import ok file=" + S.fileName + " via=" + via + " enc=" + res.encoding +
      " rows=" + res.rows.length + " cols=" + (S.norm ? S.norm.cols : 0) + " bytes=" + u8.length);
  }
  if (!alive()) return res;
  renderTop();
  renderGrid();
  renderDrawer();
  await refreshRegion();
  if (!alive()) return res;
  setStatus(res.ok
    ? "已导入「" + S.fileName + "」：编码 " + S.encoding + "，" + S.rows.length + " 行"
    : "读不了「" + S.fileName + "」：" + S.encError);
  return res;
}

async function doGenerate() {
  if (!alive()) return;
  const plan = currentPlan();
  if (!plan || !plan.ok) {
    /* 🔴 这条**必须写日志**：v0.4.2 之前"还不能生成"只写状态栏，于是自检里那次失败
       在 boot.log 上**一个字都没有**（连 `table build` 都没有），只能靠猜。
       失败原因要同时到达"用户看得见的地方"和"事后能查的地方"。 */
    const why = !S.norm ? "没有数据" : (!S.region ? ("没有可用区域：" + (S.regionError || "?")) : ((plan && plan.error) || "计划没成立"));
    log.appendLog("table build REFUSED　why=" + why +
      "　norm=" + (S.norm ? S.norm.body.length + "行×" + S.norm.cols + "列" : "无") +
      "　region=" + (S.region ? S.region.from : "无"));
    setStatus("还不能生成：" + ((plan && plan.error) || why || "没有数据或没有区域"));
    return;
  }
  if (S.busy) return;
  S.busy = true;
  if (refs.btnGen) {
    refs.btnGen.className = "tbtn pri busy";
    refs.btnGen.textContent = "正在生成…";
  }
  setStatus("正在生成表格（" + plan.layers + " 个图层，一次提交）…");

  const t0 = Date.now();
  let r = null;
  try {
    r = await ps.buildTable(plan, { name: "表格 · " + baseName(S.fileName) });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || String(e) };
  }
  const ms = Date.now() - t0;

  S.busy = false;
  if (refs.btnGen) {
    refs.btnGen.className = "tbtn pri";
    refs.btnGen.textContent = "生成表格";
  }

  await log.appendLog(
    "table build ok=" + !!r.ok + " group=" + (r.group || "-") + " added=" + (r.added === undefined ? "-" : r.added) +
    "/" + (r.expected === undefined ? "-" : r.expected) + " ms=" + ms + " align=" + (r.alignMode || "-") +
    (r.phase2Ms === undefined ? "" : " phase2=" + r.phase2Ms + "ms 选中" + r.selected + "/" + (r.cells || "?") +
      " 改名" + r.renamed + " 对齐" + r.aligned +
      (r.firstSelectError ? " selErr=" + r.firstSelectError : "") +
      (r.firstNameError ? " nameErr=" + r.firstNameError : "") +
      (r.firstAlignError ? " alignErr=" + r.firstAlignError : "")) +
    (r.error ? " err=" + r.error : "")
  );
  if (r.ok) {
    setStatus("✓ 已生成「" + r.group + "」：图层 +" + r.added + "（预计 " + r.expected + "），用时 " + ms + "ms");
  } else {
    setStatus("✗ 生成失败：" + (r.error || "未知原因"));
  }
  renderGroupSummaries();
}

/* ==========================================================================
 * 偏好：记住区域来源与样式（下次进来还是这套）
 * ========================================================================== */

async function savePref() {
  if (!S) return;
  try {
    await store.writeJson(PREF_FILE, {
      variant: 1,
      regionSource: S.regionSource,
      headerRow: S.headerRow,
      style: S.style,
    });
  } catch {
    /* 偏好存不上不影响用 */
  }
}

async function loadPref() {
  let p = null;
  try {
    p = await store.readJson(PREF_FILE, null);
  } catch {
    p = null;
  }
  const style = JSON.parse(JSON.stringify(tbl.DEFAULTS));
  if (p && p.style) {
    for (const k of Object.keys(p.style)) {
      if (k in style) style[k] = p.style[k];
    }
    style.pad = Object.assign({}, tbl.DEFAULTS.pad, (p.style && p.style.pad) || {});
    style.colWidth = (p.style && p.style.colWidth) || {};
    style.colAlign = (p.style && p.style.colAlign) || {};
  }
  return {
    regionSource: p && p.regionSource === "anchor" ? "anchor" : "selection",
    headerRow: !(p && p.headerRow === false),
    style: style,
  };
}

/* ==========================================================================
 * 挂载 / 卸载
 * ========================================================================== */

function build() {
  const wrap = el("div", "s-tbl", "vt-tbl");
  refs = {};

  const top = el("div", "tbl-top");
  refs.src = el("div", "tbl-src", "vt-tbl-src");
  top.appendChild(refs.src);
  refs.trybar = el("div", "tbl-try", "vt-tbl-try");
  top.appendChild(refs.trybar);
  refs.enc = el("div", "tbl-enc", "vt-tbl-enc");
  top.appendChild(refs.enc);
  refs.grid = el("div", "tbl-wrap", "vt-tbl-grid");
  top.appendChild(refs.grid);
  refs.drawer = el("div", "tbl-drawer", "vt-tbl-drawer");
  refs.drawer.setAttribute("style", "display:none");
  top.appendChild(refs.drawer);
  wrap.appendChild(top);

  const body = el("div", "tbl-body", "vt-tbl-body");
  refs.g1 = makeGroup("置入方式", "vt-tbl-g1", "—");
  refs.g2 = makeGroup("样式", "vt-tbl-g2", "通用 / 表头 / 行");
  refs.g3 = makeGroup("按行批量出稿", "vt-tbl-g3", "下一步做");
  [refs.g1, refs.g2, refs.g3].forEach((g) => {
    g.gh.setAttribute("role", "button");
    g.gh.onclick = () => g.wrap.classList.toggle("closed");
    body.appendChild(g.wrap);
  });
  refs.estimate = el("p", "tnote", "vt-tbl-estimate", "导入数据后这里会显示预估。");
  body.appendChild(refs.estimate);
  wrap.appendChild(body);

  const foot = el("div", "tbl-foot", "vt-tbl-foot");
  const save = btn("保存样式", "gh", "vt-tbl-save");
  save.onclick = async () => { await savePref(); setStatus("样式已记住（下次打开还是这套）"); };
  foot.appendChild(save);
  foot.appendChild(el("span", "tbl-grow"));
  refs.btnGen = btn("生成表格", "pri off", "vt-tbl-gen");
  refs.btnGen.onclick = () => doGenerate();
  foot.appendChild(refs.btnGen);
  const docs = btn("批量出稿", "", "vt-tbl-docs");
  docs.setAttribute("style", "margin-left:6px");
  docs.onclick = () => {
    if (refs.g3.wrap.classList.contains("closed")) refs.g3.wrap.classList.remove("closed");
    setStatus("批量出稿还没做 —— 这一轮先落「生成表格」，下一轮做绑定与出稿");
  };
  foot.appendChild(docs);
  wrap.appendChild(foot);

  return wrap;
}

async function mount(container, context) {
  ctx = context;
  binder = dom.makeBinder();

  const pref = await loadPref();
  /* 读偏好是异步的（可能几百 ms）—— 这期间用户完全可能切走工具 ⇒ unmount 已经把
     `ctx` / `container` 收掉了。不确认的话后面会往一个已经废弃的容器里画，或者摸到 null。 */
  if (!ctx || !container) return;
  S = {
    fileName: null, rows: null, norm: null,
    encoding: null, encText: null, encError: null, encWarn: false,
    headerRow: pref.headerRow,
    style: pref.style,
    regionSource: pref.regionSource,
    region: null, regionError: null,
    openCol: -1, tab: "g",
    plan: null, busy: false,
  };

  root = build();
  dom.clear(container);
  container.appendChild(root);

  renderTop();
  renderGrid();
  renderDrawer();
  renderAreaGroup();
  renderStyleGroup();
  renderBindGroup();
  await refreshRegion();

  await log.appendLog("table mount ok region=" + S.regionSource + " doc=" + ((ps.docInfo() || {}).docW || "-"));
}

function unmount() {
  if (binder) binder.offAll();
  binder = null;
  root = null;
  refs = null;
  ctx = null;
  S = null;
}

module.exports = {
  id: "table",
  title: "表格生成",
  subtitle: "表格绑定图层，批量出稿",
  badge: "M3",
  ready: true,
  mount,
  unmount,

  /* 供外壳 / 自检复用（与面板走同一份实现） */
  PREF_FILE,
  peek: () => S,
  /** 自检用：直接喂文本导入（不弹选择器） */
  importBytes: async (u8, name) => {
    const res = csv.readBytes(u8);
    if (!S) return res;
    S.fileName = name || "selftest.csv";
    S.openCol = -1;
    if (res.ok) {
      S.rows = res.rows;
      S.encoding = res.encoding;
      S.encError = null;
      S.encWarn = !!res.unmapped;
      S.encText = "　" + res.rows.length + " 行";
      rebuildNorm();
    } else {
      S.rows = null; S.norm = null; S.encError = res.error; S.encWarn = true;
    }
    renderTop();
    renderGrid();
    renderDrawer();
    await refreshRegion();
    return res;
  },
  /** 自检用：跑一遍生成（与点按钮同一条路） */
  generate: () => doGenerate(),
  /** 自检用：当前计划 */
  plan: () => currentPlan(),
  /** 自检用：改一个样式值 */
  setStyle: (patch) => {
    if (!S) return;
    Object.assign(S.style, patch || {});
    renderAreaGroup();
    renderStyleGroup();
    updateEstimate();
    renderGrid();
  },
  /** 自检用：设置区域来源 */
  setRegionSource: async (v) => {
    if (!S) return;
    S.regionSource = v === "anchor" ? "anchor" : "selection";
    renderAreaGroup();
    await refreshRegion();
  },
};
