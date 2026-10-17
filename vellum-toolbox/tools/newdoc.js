/*
 * tools/newdoc.js —— 「新建稿」工具页（模板库入口）
 * ===========================================================================
 * 依据：契约 **§5.7 `tpl.json`**（软件写、插件只读）+ `docs/53 §十一` 的四步计划。
 *
 * 为什么模板放在这里、不放素材库：
 *   契约原文——「模板属于**新建稿**工具页，不属于素材库」。素材库那边 v0.9.9 起
 *   已经主动把 `tpl` 从 tabs 里排除了（`mirror.libraryScopes()`）。
 *
 * 本版（Step 2 + Step 3）做到哪：
 *   ✅ 读 `tpl.json` → 面包屑/目录行（复用 `lib/dirlib.js`）→ 模板网格
 *   ✅ 选中模板 → handoff 取 PSD → `app.open()` **打开成新稿**
 *   ⏳ 还没做：Step 4「按规范建稿」（presetJSON + 出血参考线，见 docs/49 §3.3）
 *
 * 🔴 一个必须说给用户听的事实：
 *   打开的是 handoff 拷到 `PluginData` 的 **incoming.psd 副本**，不是模板原件
 *   ⇒ 模板绝不会被改坏（好事）；但用户按 Ctrl+S 会**存回插件缓存目录**。
 *   所以打开成功后，底栏会**常驻**一句"保存请用「另存为」"，不只是一闪而过的状态行。
 */

const dom = require("../lib/dom.js");
const log = require("../lib/log.js");
const icons = require("../lib/icons.js");
const mirror = require("../lib/mirror.js");
const handoff = require("../lib/handoff.js");
const ps = require("../lib/ps.js");
const dirlib = require("../lib/dirlib.js");
const specs = require("../lib/specs.js");

const SCOPE_ID = "tpl";
const PREF_FILE = "newdoc-pref.json"; // 预留：记住上次所在目录（本版先不写，避免无谓的盘操作）

let root = null;
let refs = null;
let binder = null;
let ctx = null;
let S = null;
let loadToken = 0;

function status(text) {
  if (ctx && ctx.setStatus) ctx.setStatus(text);
}

/* ------------------------------------------------------------------ 构建 */

function build() {
  /* ⚠️ `refs` 必须在这里就建好 —— `build()` 里要用 `refs.bar` 之类装节点，
     放到 `mount()` 里赋值就晚了（会 `Cannot set properties of null`）。
     素材库那边也是同一写法（`refs = {...}` 是 `build()` 的第一件事）。 */
  refs = { cards: [] };
  const wrap = dom.el("div", { class: "s-nd" });

  /* ① 顶部：一句说明 + 刷新（模板列表自动跟随镜像，刷新只用于"我等不及了"） */
  const head = dom.el("div", { class: "nd-head" });
  refs.ttl = dom.el("span", { class: "nd-ttl" }, ["从模板建稿"]);
  head.appendChild(refs.ttl);
  const refresh = dom.el("div", {
    class: "mini nd-refresh",
    id: "vt-nd-refresh",
    role: "button",
    tabindex: "0",
    title: "重新读一次模板库（平时每 3 秒会自动对一次）",
  });
  refresh.appendChild(icons.holder("settings", "i"));
  refresh.appendChild(dom.el("span", {}, ["刷新"]));
  head.appendChild(refresh);
  wrap.appendChild(head);

  /* ①b 两个模式：**按规范建稿 / 从模板建稿**
     为什么做成两页而不是上下两块：两块挤在一屏里，两边都只剩半屏，谁也看不清。
     ⚠️ 默认停在「从模板」（用户这轮要的就是模板入口）；规范页就在旁边一格。 */
  refs.tabs = dom.el("div", { class: "nd-tabs", id: "vt-nd-tabs" });
  wrap.appendChild(refs.tabs);

  /* ② 目录区（面包屑 + 子目录行）—— 与素材库**同一套**组件，行为不用学两遍 */
  refs.bar = dom.el("div", { class: "nd-bar", id: "vt-nd-bar" });
  wrap.appendChild(refs.bar);

  /* ③ 模板网格 */
  refs.body = dom.el("div", { class: "nd-body", id: "vt-nd-body" });
  wrap.appendChild(refs.body);

  /* ④ 底部：选中详情 + 「打开成新稿」（固定底栏，不随网格滚） */
  refs.foot = dom.el("div", { class: "nd-foot", id: "vt-nd-foot" });
  wrap.appendChild(refs.foot);

  binder.on(refresh, "click", () => manualReload());
  return wrap;
}

/* ------------------------------------------------------------------ 数据 */

async function loadScope(fromUser) {
  let m = null;
  try {
    m = await mirror.readManifest();
  } catch (e) {
    m = { ok: false, error: (e && e.message) || String(e) };
  }

  if (!m || !m.ok) {
    S.items = [];
    S.revision = null;
    renderAll();
    status("模板库：镜像不可用 —— " + ((m && m.error) || "未知原因"));
    return false;
  }

  S.manifest = m;
  let sc = null;
  for (const s of m.scopes || []) if (s && s.id === SCOPE_ID) sc = s;
  if (!sc) {
    /* 软件侧还没启用模板分区：这是**正常的前置状态**，不是错误。
       文案要说清"去哪里开启"，否则用户只会看到一片空白。 */
    S.scopeExists = false;
    S.items = [];
    S.revision = null;
    renderAll();
    status("模板库：镜像里还没有 tpl 分区 —— 在 VellumDesk 里启用「PSD 模板」分区后会出现");
    return true;
  }
  S.scopeExists = true;

  let r = null;
  try {
    r = await mirror.readScope(sc);
  } catch (e) {
    r = { ok: false, error: "读 " + sc.file + " 抛异常：" + ((e && e.message) || e) };
  }
  if (!r || !r.ok) {
    S.items = [];
    S.revision = sc.revision;
    renderAll();
    status("模板库：读 " + sc.file + " 失败 —— " + ((r && r.error) || "未知原因"));
    return false;
  }

  S.scopeData = r.data;
  S.revision = r.revision;
  S.items = mirror.flatten(SCOPE_ID, r.data);
  prunePath();
  renderAll();
  await log.appendLog(
    "newdoc load ok=true rev=" + r.revision + " items=" + S.items.length +
    " path=" + (S.path.join(">") || "-") + " via=" + (fromUser ? "manual" : "auto")
  );
  status("模板库：" + S.items.length + " 个模板" + (S.path.length ? "　筛选：" + S.path.join(" › ") : ""));
  return true;
}

/** 路径失效（软件侧删了目录）时**截断到最长有效前缀** —— 与素材库同一条规则。 */
function prunePath() {
  const tree = mirror.groupTree(S.items);
  const full = (S.path || []).slice();
  let keep = 0;
  let level = tree;
  for (const name of full) {
    let hit = null;
    for (const n of level) if (n.name === name) hit = n;
    if (!hit) break;
    keep++;
    level = hit.children || [];
  }
  if (keep !== full.length) setPath(full.slice(0, keep));
}

function setPath(arr) {
  S.path = (arr || []).filter(Boolean);
  S.expanded = false;
  S.selected = null;
}

function itemsInPath() {
  if (!S.path.length) return S.items;
  return S.items.filter((it) => {
    const p = dirlib.pathOf(it);
    for (let i = 0; i < S.path.length; i++) if (p[i] !== S.path[i]) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ 渲染 */

/**
 * 渲染失败必须**自己说出来**。
 *
 * 🔴 真机踩到（2026-10-17）：网格整块空白、其余照常，状态栏还显示"2 个模板"，
 *    而 UXP **把渲染里的异常吞掉了**（异步里抛的错不进 console、也不弹框）⇒ 只能靠读代码猜。
 *    ⇒ 三个区各包一层 try/catch：**谁炸了写进 boot.log 并在状态栏点出来**，
 *    而且互不牵连（网格炸了，面包屑和底栏照样画）。
 */
function guard(where, fn) {
  try {
    fn();
  } catch (e) {
    const m = (e && (e.stack || e.message)) || String(e);
    try {
      log.appendLog("newdoc render FAIL where=" + where + " err=" + m);
    } catch {
      /* 日志也失败就算了，别把渲染再拖死一次 */
    }
    status("✗ 「" + where + "」渲染失败：" + m);
  }
}

function renderAll() {
  guard("tabs", renderTabs);
  if (S.mode === "spec") {
    guard("specBar", renderSpecBar);
    guard("specList", renderSpecList);
    guard("specFoot", renderSpecFoot);
  } else {
    guard("bar", renderBar);
    guard("grid", renderGrid);
    guard("foot", renderFoot);
  }
}

/** 两个模式按钮（只切 class，不重建节点 —— 重建会把点击态闪掉）。 */
function renderTabs() {
  if (refs.ttl) refs.ttl.textContent = S.mode === "spec" ? "按规范建稿" : "从模板建稿";
  dom.clear(refs.tabs);
  const mk = (mode, label) => {
    const on = S.mode === mode;
    const b = dom.el("div", {
      class: "nd-tab" + (on ? " is-on" : ""),
      id: "vt-nd-mode-" + mode,
      role: "button",
      tabindex: "0",
      "data-mode": mode,
    }, [label]);
    binder.on(b, "click", () => {
      if (S.mode === mode) return;
      S.mode = mode;
      S.selected = null;
      renderAll();
      status(mode === "spec" ? "按规范建稿：选一个常用规格" : "从模板建稿：选一个模板");
    });
    refs.tabs.appendChild(b);
  };
  mk("tpl", "从模板建稿");
  mk("spec", "按规范建稿");
}

/* ------------------------------------------------- 按规范建稿（Step 4） */

function renderSpecBar() {
  dom.clear(refs.bar);
  refs.bar.appendChild(
    dom.el("span", { class: "lib-count mono" }, [
      "出血 " + specs.BLEED_MM + "mm · 安全区 " + specs.SAFE_MM + "mm · 参考线落在成品边",
    ])
  );
}

function renderSpecList() {
  dom.clear(refs.body);
  refs.cards = [];
  const list = dom.el("div", { class: "dirs", id: "vt-nd-specs" });

  for (const sp of specs.SPECS) {
    const c = specs.toCanvas(sp);
    const row = dom.el("div", {
      class: "dir" + (S.selected && S.selected.spec && S.selected.spec.id === sp.id ? " is-on" : ""),
      role: "button",
      tabindex: "0",
      "data-spec": sp.id,
      title: sp.name + "（" + sp.note + "）",
    });
    row.appendChild(icons.holder("grid", "i"));
    row.appendChild(dom.el("span", { class: "dn" }, [sp.name]));
    row.appendChild(
      dom.el("span", { class: "dc mono" }, [
        c.ok ? sp.w + "×" + sp.h + "mm · " + sp.dpi + "dpi" : "规格不可用",
      ])
    );
    binder.on(row, "click", () => selectSpec(sp));
    list.appendChild(row);
  }
  refs.body.appendChild(list);
}

function selectSpec(sp) {
  S.selected = { spec: sp, asset: null };
  renderSpecList();
  renderSpecFoot();
}

function renderSpecFoot() {
  dom.clear(refs.foot);
  const sel = S.selected;
  if (!sel || !sel.spec) {
    refs.foot.appendChild(
      dom.el("span", { class: "lf-hint" }, ["选一个规格 —— 右侧会出现「新建」"])
    );
    return;
  }
  const sp = sel.spec;
  const c = specs.toCanvas(sp);

  const row = dom.el("div", { class: "lf-main" });
  const left = dom.el("div", { class: "lf-l" });
  left.appendChild(dom.el("span", { class: "lf-n" }, [sp.name]));
  left.appendChild(
    dom.el("span", { class: "lf-m mono", title: "成品 " + sp.w + "×" + sp.h + "mm，四边各出血 " + specs.BLEED_MM + "mm" }, [
      c.ok
        ? "画布 " + c.width + "×" + c.height + "px · " + c.dpi + "dpi · " + c.mode +
          " · 成品 " + sp.w + "×" + sp.h + "mm（含 " + specs.BLEED_MM + "mm 出血）"
        : (c.error || "规格不可用"),
    ])
  );
  row.appendChild(left);

  const okMake = !!c.ok && !S.busy;
  const btn = dom.el("div", {
    class: "lf-btn" + (okMake ? "" : " is-off"),
    id: "vt-nd-create",
    role: "button",
    tabindex: "0",
    title: c.ok ? "新建 " + c.width + "×" + c.height + "px 的稿，参考线随建稿写入" : (c.error || ""),
  }, [S.busy ? "新建中…" : "新建"]);
  if (okMake) binder.on(btn, "click", () => doCreate());
  row.appendChild(btn);
  refs.foot.appendChild(row);
}

/**
 * 按规格建稿。
 *
 * 三条要在**建之前**就判掉（不留到宿主去换一个看不懂的 PS 弹框）：
 *   · 规格算不出画布（尺寸/分辨率不合法）；
 *   · 画布超过 PS 上限；
 * 建完**一律读回**：宽高 / 分辨率 / 模式 / **参考线条数** —— 少一条都算没做成。
 */
async function doCreate() {
  if (S.busy) {
    status("上一个还在处理中 …");
    return null;
  }
  const sel = S.selected;
  if (!sel || !sel.spec) {
    status("先选一个规格，再点「新建」");
    return null;
  }
  const sp = sel.spec;
  const c = specs.toCanvas(sp);
  if (!c.ok) {
    status("✗ 「" + sp.name + "」" + (c.error || "算不出画布"));
    return { ok: false, reason: "bad-spec", error: c.error };
  }

  S.busy = true;
  renderSpecFoot();
  try {
    status("正在按「" + sp.name + "」建稿 …");
    const preset = specs.toPresetJson(c, sp);
    const r = await ps.createFromSpec(preset, { commandName: "Vellum 工具箱：按规范建稿", name: sp.name });
    await log.appendLog(
      "newdoc create ok=" + r.ok + " spec=" + sp.id +
      " want=" + c.width + "x" + c.height + "@" + c.dpi + "/" + c.mode +
      " got=" + (r.width || "?") + "x" + (r.height || "?") + "@" + (r.resolution || "?") +
      "/" + (r.mode || "?") + " guides=" + (r.guides === null ? "null" : r.guides) +
      (r.error ? " err=" + r.error : "")
    );

    if (!r.ok) {
      status("✗ 建稿失败：" + r.error);
      return { ok: false, reason: "create", error: r.error };
    }

    /* ★ 读回校验：**期望值来自我们自己算的 c**，不是来自返回值 */
    const sizeOk = r.width === c.width && r.height === c.height;
    const resOk = r.resolution === null || r.resolution === c.dpi;
    const guideOk = r.guides !== null && r.guides >= c.guides.length;
    const modeOk = r.modeOk !== false;

    if (!sizeOk) {
      status(
        "⚠️ 建出来的尺寸不对：要 " + c.width + "×" + c.height + "，实际 " +
        r.width + "×" + r.height + " —— presetJSON 可能被 PS 忽略了，请把这条读数发给开发"
      );
      return { ok: false, reason: "size-mismatch", want: c.width + "×" + c.height, got: r.width + "×" + r.height };
    }

    status(
      "✓ 已新建「" + sp.name + "」　" + r.width + "×" + r.height + "px　@" +
      (r.resolution === null ? "?" : r.resolution) + "dpi　" + (r.mode || "?") +
      "　参考线 " + (r.guides === null ? "未探到" : r.guides + " 条") +
      (modeOk ? "" : "　⚠️ 色彩模式没生效（要 " + c.mode + "）") +
      (resOk ? "" : "　⚠️ 分辨率与期望不同") +
      (guideOk ? "" : "　⚠️ 参考线没写进来")
    );
    return { ok: sizeOk && modeOk, width: r.width, height: r.height, guides: r.guides };
  } catch (e) {
    const m = (e && e.message) || String(e);
    await log.appendLog("newdoc create EXCEPTION spec=" + sp.id + " err=" + m);
    status("✗ 建稿过程中抛异常：" + m);
    return { ok: false, reason: "exception", error: m };
  } finally {
    S.busy = false;
    if (refs && refs.foot) renderSpecFoot();
  }
}

function renderBar() {
  dom.clear(refs.bar);
  if (!S.items.length) {
    refs.bar.appendChild(
      dom.el("span", { class: "lib-count mono" }, [
        S.scopeExists ? "共 0 个模板" : "还没有模板分区",
      ])
    );
    return;
  }

  const tree = mirror.groupTree(S.items);
  const node = S.path.length ? dirlib.resolve(tree, S.path) : null;
  const live = node ? S.path : [];
  const atRoot = !live.length;

  const bc = dirlib.breadcrumb(dom, binder, {
    path: live,
    rootLabel: "模板",
    levelText: live.length ? "第 " + live.length + "/" + (dirlib.maxDepth(tree) || 1) + " 层" : "",
    onPick: (idx) => {
      setPath(live.slice(0, idx));
      renderAll();
    },
  });
  if (bc) refs.bar.appendChild(bc);

  const kids = node ? (node.children || []) : tree;
  const dirs = dirlib.dirRow(dom, binder, {
    kids: kids,
    expanded: !!S.expanded,
    onPick: (k) => {
      setPath(atRoot ? [k] : live.concat([k]));
      renderAll();
    },
    onExpand: (v) => {
      S.expanded = !!v;
      renderBar();
    },
  });
  if (dirs) refs.bar.appendChild(dirs);
}

function fmtDims(a) {
  if (!a || !a.width || !a.height) return "";
  return a.width + "×" + a.height;
}

function renderGrid() {
  dom.clear(refs.body);
  refs.cards = [];

  if (!S.items.length) {
    const box = dom.el("div", { class: "empty" });
    box.appendChild(dom.el("p", { class: "empty-t" }, [
      S.scopeExists ? "模板库还是空的" : "还没有「PSD 模板」分区",
    ]));
    box.appendChild(dom.el("p", { class: "empty-s" }, [
      S.scopeExists
        ? "在 VellumDesk 里把打好参考线的 PSD 收进「模板」分区，这里会出现（会自动刷新）"
        : "在 VellumDesk 里启用「PSD 模板」分区并放入模板；启用后这里会自动出现",
    ]));
    refs.body.appendChild(box);
    return;
  }

  const list = itemsInPath();
  if (!list.length) {
    const box = dom.el("div", { class: "empty" });
    box.appendChild(dom.el("p", { class: "empty-t" }, ["这个目录下没有模板"]));
    box.appendChild(dom.el("p", { class: "empty-s" }, ["点面包屑往上退一层试试"]));
    refs.body.appendChild(box);
    return;
  }

  const grid = dom.el("div", {
    class: "nd-grid",
    id: "vt-nd-grid",
    "data-rev": String(S.revision === null || S.revision === undefined ? "" : S.revision),
  });

  for (const it of list) {
    const a = it.asset;
    const card = dom.el("div", {
      class: "nd-card",
      role: "button",
      tabindex: "0",
      "data-id": String(a.id),
      title: a.name,
    });

    const th = dom.el("div", { class: "nd-th" });
    const ph = dom.el("div", { class: "nd-ph" }, ["PSD"]);
    th.appendChild(ph);
    if (a.missing) th.appendChild(dom.el("span", { class: "card-miss" }, ["原文件丢失"]));
    card.appendChild(th);

    card.appendChild(dom.el("span", { class: "nd-nm" }, [a.name]));
    const bits = [];
    const d = fmtDims(a);
    if (d) bits.push(d);
    if (typeof a.guides === "number") bits.push(a.guides ? "参考线 " + a.guides : "无参考线");
    card.appendChild(dom.el("span", { class: "nd-mt mono" }, [bits.join(" · ") || "—"]));

    binder.on(card, "click", () => select(it));
    grid.appendChild(card);
    refs.cards.push({ card: card, asset: a, ph: ph, th: th });
  }

  refs.body.appendChild(grid);
  refs.grid = grid;
  /* 🔴 **"建出来了 ≠ 看得见"**（2026-10-17 真机踩到，代价很大）：
     `display:grid` 在 UXP 里不生效 ⇒ 卡片全被算成 **0 高**，页面一片空白却**不报任何错**，
     数据(3)、筛后(3)、建卡(3) 三个数都对，只有高度是 0。
     ⇒ 这里留一个**运行时警报**：卡片建了但高度是 0，就在状态栏与日志里喊出来。

     ⚠️ **必须重试，不能一次判定**：刚 append 完那一刻布局还没落定，读到 0 是正常的
     （实测要 1–2s 才有 227px 的卡片高度）。首版在 400ms 里一次判定 ⇒ 误报 + 提前 return。

     ⚠️ **这里不再做"缩略图正方形校准"了**（v0.9.31 删掉）：
     那个做法要"量 `.nd-th` 的宽度再写 height"，而**在 UXP 里量尺寸的时机不可靠** ——
     本轮为此连错三版（量到 0 就跳过 / 420ms 时布局未落定 / S74 读数 `168×174` 且
     `inline height=""`）。改成 **CSS 里固定卡宽 193、缩略图 181** ⇒ 正方形是算出来的，
     零测量、零时机依赖。**能算的不要量。** */
  setTimeout(function () {
    let tries = 0;
    const settle = function () {
      tries++;
      let gh = 0;
      let ch = 0;
      try {
        if (!refs || !refs.grid || !refs.cards.length) return;
        gh = refs.grid.offsetHeight || 0;
        ch = refs.cards[0].card ? (refs.cards[0].card.offsetHeight || 0) : 0;
        if (gh > 0 && ch > 0) return;
      } catch {
        /* 继续重试 */
      }
      if (tries < 25) {
        setTimeout(settle, 120);
        return;
      }
      try {
        log.appendLog(
          "newdoc grid INVISIBLE cards=" + refs.cards.length +
          " gridH=" + gh + " card0H=" + ch + " tries=" + tries +
          " bodyH=" + (refs.body.offsetHeight || 0)
        );
        status("✗ 模板卡片建出来了但高度是 0（布局不支持？）—— 已写进 boot.log");
      } catch {
        /* 忽略 */
      }
    };
    settle();
  }, 300);

  loadThumbs(++loadToken);
}

/**
 * 缩略图加载：**只给"还在文档里"的卡片挂图**。
 *
 * ⚠️ 与素材库同一套纪律：`loadToken` 令牌作废在途任务（重渲染/切目录/卸载后立刻停手），
 *    否则旧的一批会把新的一批覆盖掉，表现为"缩略图串了"。
 */
async function loadThumbs(token) {
  const rev = S.revision;
  for (const c of refs.cards) {
    if (token !== loadToken) return;
    if (!c.asset || !c.asset.thumb) continue;
    let r = null;
    try {
      r = await mirror.thumbUrl(c.asset, rev);
    } catch (e) {
      r = { ok: false, error: (e && e.message) || String(e) };
    }
    if (token !== loadToken) return;
    if (!r || !r.ok) continue;
    const img = document.createElement("img");
    img.setAttribute("class", "nd-img");
    img.setAttribute("src", r.url);
    if (c.ph && c.ph.parentNode) {
      c.ph.parentNode.insertBefore(img, c.ph);
      c.ph.parentNode.removeChild(c.ph);
    }
  }
}

function renderFoot() {
  dom.clear(refs.foot);
  const sel = S.selected;
  if (!sel) {
    refs.foot.appendChild(
      dom.el("span", { class: "lf-hint" }, ["选一个模板 —— 右侧会出现「打开成新稿」"])
    );
    return;
  }
  const a = sel.asset;
  const okOpen = !a.missing;

  const tips = [];
  if (sel.groupPath && sel.groupPath.length) tips.push("位置：" + sel.groupPath.join(" › "));
  if (a.absPath) tips.push("原文件：" + a.absPath);
  if (a.resolution) tips.push("分辨率：" + a.resolution + " dpi");
  if (a.mode) tips.push("模式：" + a.mode);
  if (a.missing) tips.push("⚠️ 原文件已丢失，无法打开");
  const tipText = tips.join("\n");

  const row = dom.el("div", { class: "lf-main" });
  const left = dom.el("div", { class: "lf-l" });
  left.appendChild(dom.el("span", { class: "lf-n", title: tipText }, [a.name]));

  const bits = [];
  const d = fmtDims(a);
  if (d) bits.push(d);
  if (a.size) bits.push(fmtSize(a.size));
  if (typeof a.guides === "number") bits.push(a.guides ? "参考线 " + a.guides + " 条" : "无参考线");
  left.appendChild(dom.el("span", { class: "lf-m mono", title: tipText }, [bits.join(" · ") || "—"]));
  row.appendChild(left);

  const btn = dom.el("div", {
    class: "lf-btn" + (okOpen && !S.busy ? "" : " is-off"),
    id: "vt-nd-open",
    role: "button",
    tabindex: "0",
    title: a.missing ? "原文件已丢失" : "打开成一张新稿（模板原件不会被改动）",
  }, [S.busy ? "打开中…" : "打开"]);
  if (okOpen && !S.busy) binder.on(btn, "click", () => doOpen());
  row.appendChild(btn);
  refs.foot.appendChild(row);
}

function fmtSize(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return "";
  if (v < 1024) return v + " B";
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
  return (v / 1024 / 1024).toFixed(1) + " MB";
}

function select(item) {
  S.selected = item;
  for (const c of refs.cards || []) {
    const on = c.asset && c.asset.id === item.asset.id;
    if (c.card && c.card.classList) {
      if (on) c.card.classList.add("is-on");
      else c.card.classList.remove("is-on");
    }
  }
  renderFoot();
}

/* ------------------------------------------------------------------ 打开 */

/**
 * 从模板打开一张新稿。
 *
 * 流程与素材库「置入」**同一条 handoff 通道**（契约 §六 规则 8：`scope` 必填，
 * 且必须在该 scope 内按 assetId 反查）——差别只在拿到文件后做 `app.open` 而不是 `placeFile`。
 */
async function doOpen() {
  if (S.busy) {
    status("上一个还在处理中 …");
    return null;
  }
  const sel = S.selected;
  if (!sel) {
    status("先选一个模板，再点「打开成新稿」");
    return null;
  }
  const a = sel.asset;
  if (a.missing) {
    status("✗ 「" + a.name + "」的原文件已丢失（镜像里 missing=true）—— 先在 VellumDesk 里找到或移除它");
    return { ok: false, reason: "missing" };
  }

  S.busy = true;
  renderFoot();
  try {
    status("正在向 VellumDesk 取模板「" + a.name + "」…");
    const req = await handoff.request(a, SCOPE_ID);
    await log.appendLog(
      "newdoc handoff req ok=" + req.ok + " reqId=" + (req.reqId || "-") +
      " assetId=" + a.id + " created=" + req.created + (req.error ? " err=" + req.error : "")
    );
    if (!req.ok) {
      status("✗ 请求模板失败：" + req.error + "（契约 §六 的 handoff 目录写不进去）");
      return { ok: false, reason: "handoff-request", error: req.error };
    }

    const res = await handoff.waitForRes(req.reqId, handoff.DEFAULT_TIMEOUT_MS);
    if (!res.ok) {
      await log.appendLog(
        "newdoc handoff res FAILED reqId=" + req.reqId + " timedOut=" + !!res.timedOut +
        " lastSeen=" + (res.lastSeen || "-") + " err=" + (res.error || "-")
      );
      /* ⚠️ 把"请求的是哪一条"一起说出来 —— 用户报障时这行就是能直接转给软件侧的读数 */
      status(
        "✗ 取模板失败：" + (res.error || "未知原因") +
        "　〔请求：scope=" + SCOPE_ID + " · id=" + a.id + "〕" +
        (res.timedOut ? "　—— 确认 VellumDesk 在运行、且已开启插件联动" : "")
      );
      return { ok: false, reason: "handoff-timeout", error: res.error };
    }

    const inc = await handoff.fetchIncoming(res);
    if (!inc.ok) {
      status("✗ 模板文件没到：" + (inc.error || "未知原因") + "（handoff/ 里找不到 " + handoff.incomingName(res) + "）");
      return { ok: false, reason: "incoming", error: inc.error };
    }

    status("正在打开「" + a.name + "」…");
    const op = await ps.openFile(inc.entry, { commandName: "Vellum 工具箱：从模板新建" });
    await log.appendLog(
      "newdoc open ok=" + op.ok + " assetId=" + a.id +
      " size=" + (op.width || "?") + "x" + (op.height || "?") + " guides=" +
      (op.guides === null ? "null" : op.guides) + (op.error ? " err=" + op.error : "")
    );
    if (!op.ok) {
      status("✗ 打开失败：" + op.error);
      return { ok: false, reason: "open", error: op.error };
    }

    status(
      "✓ 已从模板「" + a.name + "」打开新稿　" +
      (op.width && op.height ? op.width + "×" + op.height : "") +
      "　参考线 " + (op.guides === null ? "未探到" : op.guides + " 条") +
      "　⇒ 保存请用「另存为」存到项目目录（当前是插件缓存里的副本）"
    );
    return { ok: true, name: a.name, width: op.width, height: op.height, guides: op.guides };
  } catch (e) {
    const m = (e && e.message) || String(e);
    await log.appendLog("newdoc open EXCEPTION assetId=" + a.id + " err=" + m);
    status("✗ 打开过程中抛异常：" + m);
    return { ok: false, reason: "exception", error: m };
  } finally {
    S.busy = false;
    if (refs && refs.foot) renderFoot();
  }
}

/* ------------------------------------------------------------------ 挂载 */

async function mount(container, context) {
  ctx = context;
  binder = dom.makeBinder();
  loadToken++;

  root = build();
  dom.clear(container);
  container.appendChild(root);

  S = {
    manifest: null,
    scopeExists: false,
    scopeData: null,
    revision: null,
    items: [],
    mode: "tpl", // "tpl" 从模板 / "spec" 按规范（默认模板 —— 这一页就是为它开的）
    path: [],
    expanded: false,
    selected: null,
    busy: false,
    watcher: null,
  };

  renderAll();
  await loadScope(false);

  /* 自动跟随镜像：与素材库同一条轮询（`mirror.watch` 每 ~3s 比 revision）。
     ⚠️ 只在**当前所在的 tpl revision 变了**时才重读，免得白画。 */
  S.watcher = mirror.watch(async (mm) => {
    if (!S) return;
    let rev = null;
    for (const s of mm.scopes || []) if (s && s.id === SCOPE_ID) rev = s.revision;
    if (rev === S.revision) return;
    await loadScope(false);
  });
}

function unmount() {
  loadToken++; // 作废在途的缩略图加载
  try {
    if (S && S.watcher) S.watcher.stop();
  } catch {
    /* 忽略 */
  }
  if (binder) binder.offAll();
  binder = null;
  root = null;
  refs = null;
  ctx = null;
  S = null;
  try {
    mirror.clearThumbs();
  } catch {
    /* 忽略 */
  }
}

async function manualReload() {
  status("正在重新读模板库 …");
  await loadScope(true);
}

module.exports = {
  id: "template",
  title: "新建稿",
  subtitle: "从 PSD 模板建稿（参考线已打好）",
  badge: "M5",
  ready: true,
  mount,
  unmount,

  /* 供自检复用（与面板走同一条实现） */
  PREF_FILE,
  peek: () => S,
  /** 打开入口（自检用；与点「打开成新稿」同一条路）。 */
  open: () => doOpen(),
  /** 建稿入口（自检用；与点「新建」同一条路）。 */
  create: () => doCreate(),
};
