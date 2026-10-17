/*
 * tools/review.js —— 导出审核版 / 成品图（M5 第 4 步，v0.8.0；方案 docs/50）
 * ===========================================================================
 * 这个页面做两件事：
 *   · 「导出审核版」：给图加一条参数条再导出一份 PNG（**主路**：改稿 → 导出 → 一步还原）
 *   · 「导出成品图」：原样 asCopy 导出一份 PNG（不动稿）
 *
 * 【三条纪律 —— 都来自真机实测，不是设计者偏好】
 *   ① **先弹窗、用户答完，再进模态**。出血三态是本页内的浮层，**先于**任何
 *      `executeAsModal` 出现。反了会让用户在 PS 被锁住的状态下思考甚至卡死。
 *   ② **不用没验过的控件**。真机自检 S23 读数：`sp-textfield` / `sp-picker` /
 *      `sp-button` **全部「未注册」**（基准对照 `sp-not-a-real-thing-xyz` 读数相同 ⇒
 *      "未注册"这个读数是可信的）；`<input>` 本项目**从没验过**（table.js 当年就为此
 *      绕开它自绘了步进器）。⇒ 这里同样**自绘**：按钮是 `div role=button`，
 *      毫米数是「− 数值 ＋」步进器。
 *   ③ **页面上显示的，就是导出时会用的那一份**。参数条预览直接调
 *      `lib/review.js`（纯函数）与 `lib/inspect.js`（只读内核），与真正导出时
 *      `lib/ps.js` 内部调的**是同一份实现** ⇒ 不可能"预览写着 3 个、导出变成 2 个"。
 *
 * 【为什么导出目录要"首次选一次后记住"】用户拍板项（docs/50 §六 ③）。
 *   插件权限是 `localFileSystem: "request"`，**不能直接访问任意路径** ——
 *   只有**用户选过的**目录才拿得到句柄，所以必须把选择存成**持久令牌**
 *   （`createPersistentToken`），下次用 `getEntryForPersistentToken` 拿回来。
 */

const dom = require("../lib/dom.js");
const inspect = require("../lib/inspect.js");
const review = require("../lib/review.js");
const store = require("../lib/store.js");

const STORE_FILE = "review.json";

let ctx = null;
let binder = null;
let root = null;
let refs = null;

/** 本页状态。**只在内存里**（关掉面板即丢）—— 唯一写盘的是导出目录的令牌。 */
const S = {
  docId: null,        // 界面当前对应的文档 id
  choice: null,       // { state, mm } 出血三态（**同文档记住**，换文档就重新问）
  mm: 3,              // 步进器上的毫米数
  folder: null,       // Folder Entry
  folderName: "",
  folderFrom: "",     // "remembered"（从令牌拿回）| "picked"（这次选的）
  last: null,         // 上一次导出结果
  theme: null,        // 主题判定结果（pickTheme 的返回）
  themeDocId: null,   // 上面那份主题是**哪张稿**判出来的（换稿就作废）
  busy: false,
  dialog: null        // 浮层节点（null = 没开）
};

function setStatus(t) {
  if (ctx && ctx.setStatus) ctx.setStatus(t);
}

async function logLine(t) {
  try {
    if (ctx && ctx.log && ctx.log.appendLog) await ctx.log.appendLog("review " + t);
  } catch (e) {
    /* 日志失败不该影响主流程 */
  }
}

const alive = () => !!ctx;

/* ===========================================================================
 * 一、当前体检（只读）
 * ------------------------------------------------------------------------- */

function currentInsp() {
  try {
    return inspect.docInspect();
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function docNameOf(insp) {
  if (insp && insp.ok && insp.snapshot && insp.snapshot.info) {
    return insp.snapshot.info.docName || "未命名";
  }
  return "未命名";
}

/* ===========================================================================
 * 二、渲染
 * ------------------------------------------------------------------------- */

function sevNote(insp) {
  if (!insp || !insp.ok) return "没有打开的文档 —— 导出需要有稿子。";
  const warn = insp.findings.filter((f) => f.severity === "warn").length;
  const unknown = insp.findings.filter((f) => f.severity === "unknown").length;
  const bits = [];
  if (warn) bits.push(warn + " 项提醒");
  if (unknown) bits.push(unknown + " 项无结论");
  return bits.length ? "体检：" + bits.join("、") + "（详情见「出图体检」页）" : "体检：无提醒";
}

/** 出血三态 —— 用**自绘 chip**，不用 sp-* / input。 */
function buildBleed() {
  const box = dom.el("div", { class: "rv-sec" });
  box.appendChild(dom.el("div", { class: "rv-h" }, ["出血（同文档记住上次选择）"]));

  const row = dom.el("div", { class: "rv-chips" });
  const chips = [];
  for (const c of review.BLEED_CHOICES) {
    const on = S.choice && S.choice.state === c.state;
    const chip = dom.el("div", {
      class: "rv-chip" + (on ? " is-on" : ""),
      role: "button",
      tabindex: "0",
      "data-state": c.state,
      title: "选「" + c.label + "」"
    }, [c.label]);
    binder.on(chip, "click", function () {
      chooseBleed(c.state);
    });
    chips.push(chip);
    row.appendChild(chip);
  }
  box.appendChild(row);

  /* 毫米步进器：只在「有出血」时可操作（选「无出血」时**禁用**，防呆） */
  const step = dom.el("div", { class: "rv-step" + (S.choice && S.choice.state === "has" ? "" : " is-off") });
  refs.mmMinus = dom.el("div", {
    class: "rv-sbtn", role: "button", tabindex: "0", title: "减 0.5 mm"
  }, ["−"]);
  refs.mmVal = dom.el("div", { class: "rv-sval" }, [S.mm.toFixed(1) + " mm"]);
  refs.mmPlus = dom.el("div", {
    class: "rv-sbtn", role: "button", tabindex: "0", title: "加 0.5 mm"
  }, ["＋"]);
  binder.on(refs.mmMinus, "click", function () { bumpMm(-0.5); });
  binder.on(refs.mmPlus, "click", function () { bumpMm(0.5); });
  step.appendChild(refs.mmMinus);
  step.appendChild(refs.mmVal);
  step.appendChild(refs.mmPlus);
  step.appendChild(dom.el("span", { class: "rv-hint" }, [
    S.choice && S.choice.state === "has" ? "下版会支持直接输入" : "选「有出血」才能改毫米数"
  ]));
  box.appendChild(step);

  if (S.choice && S.choice.state === "unknown") {
    box.appendChild(dom.el("div", { class: "rv-note" }, [
      "参数条会照实写「出血 无法判断」——**不猜**。"
    ]));
  }
  return box;
}

function bumpMm(d) {
  if (!S.choice || S.choice.state !== "has") {
    setStatus("想改毫米数，先选「有出血」。");
    return;
  }
  const next = Math.round((S.mm + d) * 10) / 10;
  if (next < 0.5) { setStatus("出血最小 0.5 mm。"); return; }
  if (next > review.BLEED_MM_MAX) { setStatus("出血上限 " + review.BLEED_MM_MAX + " mm。"); return; }
  S.mm = next;
  S.choice.mm = next;
  renderPreview();
  if (refs.mmVal) refs.mmVal.textContent = S.mm.toFixed(1) + " mm";
}

function chooseBleed(state) {
  S.choice = { state: state, mm: state === "has" ? S.mm : null };
  logLine("bleed state=" + state + (state === "has" ? " mm=" + S.mm : ""));
  render();
  setStatus("出血选择：" + bleedLabel(state) + (state === "has" ? "（" + S.mm.toFixed(1) + " mm）" : ""));
}

function bleedLabel(state) {
  const c = review.BLEED_CHOICES.filter((x) => x.state === state)[0];
  return c ? c.label : state;
}

/** 参数条预览 —— 与真正导出调的是**同一份** review 纯函数，连配色都用真判定的主题。 */
function buildPreview(insp) {
  const box = dom.el("div", { class: "rv-sec" });
  box.appendChild(dom.el("div", { class: "rv-h" }, ["参数条预览（配色 = 导出时的真实主题）"]));
  refs.prev = dom.el("div", { class: "rv-prev" });
  box.appendChild(refs.prev);
  box.appendChild(dom.el("div", { class: "rv-hint", style: "margin-top:6px" }, [
    "图片区保持干净、参数条在下方；导出时用 PS 默认中文字体（本版改不了字体，见 docs/50 §3.6）。"
  ]));
  renderPreview(insp);
  return box;
}

function renderPreview(insp) {
  if (!refs || !refs.prev) return;
  const got = insp || currentInsp();
  dom.clear(refs.prev);

  if (!got || !got.ok) {
    refs.prev.appendChild(dom.el("div", { class: "rv-note" }, ["没有文档，无法预览。"]));
    return;
  }
  const bleed = S.choice ? { state: S.choice.state, mm: S.choice.mm } : { state: "unknown", mm: null };
  const plan = review.planScale(got.snapshot.info.pxW, got.snapshot.info.pxH);
  const st = review.stripLines(got, { bleed: bleed, when: new Date(), scale: plan });
  if (!st.ok) {
    refs.prev.appendChild(dom.el("div", { class: "rv-note" }, ["预览算不出来：" + st.error]));
    return;
  }
  const info = got.snapshot.info;
  const met = review.stripMetrics(info.pxW, info.pxH, info.ppi, st.lines, st.tag, st.basis);

  /* 主题：S.theme 由 refreshTheme() 异步取；**换了稿就作废**（主题是绑文档的）。 */
  const sameThemeDoc = S.theme && String(S.themeDocId) === String(info.docId);
  const theme = sameThemeDoc ? S.theme.theme : review.THEME_LIGHT;
  const themeNote = sameThemeDoc
    ? (S.theme.note + (S.theme.from === "fallback" ? "（判定失败，用的退回值）" : ""))
    : "还没判色（点「重新判色」，或导出时会自动判）—— 下面按浅条显示";

  refs.prev.appendChild(dom.el("div", { class: "rv-meta mono" }, [
    "条高 " + met.stripH + " px" + (met.grown ? "（比 8% 高：按实际行数加高了）" : "（= 图宽 8%）") +
    " · 字号 " + met.fontPt + " pt · 行高 " + met.lineHPx +
    " px · 文字约 " + met.rows + " 行 · 左右留白 " + met.padXPx +
    " px · 图片区 " + (info.pxW === null ? "?" : info.pxW) + " × " +
    (info.pxH === null ? "?" : info.pxH) + " px" +
    (met.fontShrunk ? "（已缩字号：文字比可用宽度长）" : "")
  ]));
  refs.prev.appendChild(dom.el("div", { class: "rv-note" }, ["主题：" + themeNote]));
  if (plan.applied) {
    refs.prev.appendChild(dom.el("div", { class: "rv-note" }, [
      "缩放计划：" + plan.reason + "（" + Math.round(plan.pct) + "% ｜ 导出 " +
      plan.w + " × " + plan.h + " px）"
    ]));
  }

  /* 按主题配色画一条"迷你参数条"，让配色一眼可见 */
  const fake = dom.el("div", {
    class: "rv-fake",
    style: "background:" + theme.bgHex + ";color:" + theme.fgHex + ";"
  });
  for (let i = 0; i < st.lines.length; i++) {
    fake.appendChild(dom.el("div", { class: "rv-pline" }, [st.lines[i]]));
  }
  const row = dom.el("div", { class: "rv-frow" });
  row.appendChild(dom.el("span", { class: "rv-fbasis" }, [
    dom.el("img", { class: "rv-flogo", src: "icons/logo-mark.png", alt: "logo" }),
    dom.el("span", {}, [st.basis])
  ]));
  row.appendChild(dom.el("span", {
    class: "rv-ftag", style: "color:" + theme.tagHex + ";"
  }, [st.tag]));
  fake.appendChild(row);
  refs.prev.appendChild(fake);
  refs.prev.appendChild(dom.el("div", { class: "rv-note" }, [
    "（预览是文字预览不是渲染图；图上角标在第 1 行右端、「依据」块在最后一行右端，角标与依据块不会互相压。）"
  ]));
}

/** 异步：量一次图片底部的平均色，定出主题。 */
async function refreshTheme() {
  if (!alive() || !ctx.ps || typeof ctx.ps.sampleRectAvgColor !== "function") return;
  const insp = currentInsp();
  if (!insp || !insp.ok) return;
  const info = insp.snapshot.info;
  const base = review.stripMetrics(info.pxW, info.pxH, info.ppi, [], review.STRIP.tag, "");
  const band = review.sampleBandRect(info.pxW, info.pxH, base.baseStripH);
  let sample = null;
  try {
    sample = await ctx.ps.sampleRectAvgColor(band, { composite: true });
  } catch (e) {
    sample = { ok: false, error: (e && e.message) || String(e) };
  }
  if (!alive()) return;
  S.theme = review.pickTheme(sample);
  S.themeDocId = info.docId;
  logLine("theme " + S.theme.theme.id + " luma=" + S.theme.luma + " from=" + S.theme.from);
  render(insp);
}

/** 导出位置 —— 首次选一次后记住。 */
function buildOutput() {
  const box = dom.el("div", { class: "rv-sec" });
  box.appendChild(dom.el("div", { class: "rv-h" }, ["导出位置"]));

  const row = dom.el("div", { class: "rv-out" });
  refs.outName = dom.el("div", { class: "rv-outname" }, [
    S.folderName ? S.folderName : "（还没选过目录）"
  ]);
  const pick = dom.el("div", {
    class: "rv-btn", role: "button", tabindex: "0",
    title: "选一个目录；选一次就记住，之后不用再选"
  }, [S.folderName ? "改目录…" : "选择目录…"]);
  binder.on(pick, "click", function () { pickFolder(); });
  row.appendChild(refs.outName);
  row.appendChild(pick);
  box.appendChild(row);
  box.appendChild(dom.el("div", { class: "rv-hint", style: "margin-top:6px" }, [
    S.folderFrom === "remembered"
      ? "用的是上次选过的目录（存在插件数据里，重启也还在）。"
      : "选一次就记住；导出的文件名带时间戳，不会互相覆盖。"
  ]));
  return box;
}

function buildLast() {
  const box = dom.el("div", { class: "rv-sec" });
  box.appendChild(dom.el("div", { class: "rv-h" }, ["上一次导出"]));
  const r = S.last;
  if (!r) {
    box.appendChild(dom.el("div", { class: "rv-note" }, ["这次会话还没导出过。"]));
    return box;
  }
  const okLine = dom.el("div", { class: "rv-ressum " + (r.ok ? "is-ok" : "is-bad") }, [
    (r.ok ? "成功" : "未成功") + "：" + (r.file ? r.file.name : "（没写文件）") +
    (r.fileBytes ? "（" + Math.round(r.fileBytes / 1024) + " KB）" : "")
  ]);
  box.appendChild(okLine);
  if (r.error) box.appendChild(dom.el("div", { class: "rv-note" }, ["原因：" + r.error]));

  if (r.restored) {
    const R = r.restored;
    const backAll = R.w && R.h && R.layers && R.bg;
    box.appendChild(dom.el("div", { class: "rv-meta" }, [
      "还原自证（读回）：画布 " + (R.w && R.h ? "✓" : "✗") +
      " · 图层数 " + (R.layers ? "✓" : "✗") +
      " · 背景色 " + (R.bg ? "✓" : "✗") +
      "　→ " + (backAll ? "稿子已回到原样" : "**没完全回原位，请按 Ctrl+Z**")
    ]));
  }
  if (r.before && r.after) {
    box.appendChild(dom.el("div", { class: "rv-meta mono" }, [
      "读数：图层 " + r.before.layers + " → " + r.after.layers +
      "（应回到 " + r.before.layers + "）　尺寸 " +
      r.before.w + "×" + r.before.h + " → " + r.after.w + "×" + r.after.h
    ]));
  }
  if (r.warnings && r.warnings.length) {
    for (const w of r.warnings) {
      box.appendChild(dom.el("div", { class: "rv-note" }, ["⚠ " + w]));
    }
  }
  return box;
}

function buildFoot() {
  const foot = dom.el("div", { class: "rv-foot" });

  const b0 = dom.el("div", {
    class: "rv-btn", role: "button", tabindex: "0",
    title: "重新量一次图片底部的平均色，定参数条的黑/白主题"
  }, ["重新判色"]);
  binder.on(b0, "click", function () { refreshTheme(); });

  const b1 = dom.el("div", {
    class: "rv-btn is-primary", role: "button", tabindex: "0",
    title: "给图加参数条再导出一份（改稿 → 导出 → 自动还原）"
  }, ["导出审核版"]);
  binder.on(b1, "click", function () { doExport("review"); });

  const b2 = dom.el("div", {
    class: "rv-btn", role: "button", tabindex: "0",
    title: "原样导出一份（不动你的稿）"
  }, ["导出成品图"]);
  binder.on(b2, "click", function () { doExport("final"); });

  refs.btnReview = b1;
  refs.btnFinal = b2;
  refs.btnTheme = b0;
  foot.appendChild(b0);
  foot.appendChild(b1);
  foot.appendChild(b2);
  return foot;
}

function render(insp) {
  if (!refs || !refs.body) return;
  const got = insp || currentInsp();
  dom.clear(refs.body);

  const sum = dom.el("div", { class: "rv-sum" });
  sum.appendChild(dom.el("div", { class: "rv-doc" }, [
    got && got.ok ? docNameOf(got) : "（没有打开的文档）"
  ]));
  sum.appendChild(dom.el("div", { class: "rv-basis mono" }, [
    got && got.ok ? inspect.summaryLine(got) : "体检不可用"
  ]));
  sum.appendChild(dom.el("div", { class: "rv-note" }, [sevNote(got)]));
  refs.body.appendChild(sum);

  refs.body.appendChild(buildBleed());
  refs.body.appendChild(buildPreview(got));
  refs.body.appendChild(buildOutput());
  refs.body.appendChild(buildLast());
}

/* ===========================================================================
 * 三、出血浮层（**先于模态**；用户答完才继续）
 * ------------------------------------------------------------------------- */

function closeDialog() {
  if (S.dialog && S.dialog.parentNode) S.dialog.parentNode.removeChild(S.dialog);
  S.dialog = null;
}

/**
 * 弹出出血三态浮层。
 * @param {string} why 为什么要问（显示给用户）
 * @param {function} onOk 用户确认后的回调（拿到 {state, mm}）
 */
function openBleedDialog(why, onOk) {
  closeDialog();
  const mask = dom.el("div", { class: "rv-mask" });
  const box = dom.el("div", { class: "rv-dlg" });
  box.appendChild(dom.el("div", { class: "rv-dlg-t" }, ["导出前 —— 这张稿有出血吗？"]));
  box.appendChild(dom.el("div", { class: "rv-dlg-sub" }, [why]));

  let pick = "unknown";
  let mm = S.mm;
  /* ⚠️ 不要用 `row.attrs["data-state"]` 回读状态 —— 那是**离线 mock** 才有的字段，
     真机上 DOM 节点没有 `.attrs`，回读会直接抛。状态一律**留在闭包里**。 */
  const radioOf = [];
  for (const c of review.BLEED_CHOICES) {
    const row = dom.el("div", {
      class: "rv-dlg-row", role: "button", tabindex: "0", "data-state": c.state
    });
    const radio = dom.el("span", { class: "rv-dlg-radio" }, ["○"]);
    row.appendChild(radio);
    row.appendChild(dom.el("span", { class: "rv-dlg-lb" }, [c.label]));
    const item = { state: c.state, row: row, radio: radio };
    radioOf.push(item);
    binder.on(row, "click", function () {
      pick = c.state;
      for (const it of radioOf) {
        const isOn = it.state === pick;
        it.radio.textContent = isOn ? "●" : "○";
        it.row.setAttribute("class", "rv-dlg-row" + (isOn ? " is-on" : ""));
      }
      mmRow.setAttribute("class", "rv-dlg-mm" + (pick === "has" ? "" : " is-off"));
    });
    box.appendChild(row);
  }

  const mmRow = dom.el("div", { class: "rv-dlg-mm is-off" });
  const mmMinus = dom.el("div", { class: "rv-sbtn", role: "button", tabindex: "0" }, ["−"]);
  const mmVal = dom.el("div", { class: "rv-sval" }, [mm.toFixed(1) + " mm"]);
  const mmPlus = dom.el("div", { class: "rv-sbtn", role: "button", tabindex: "0" }, ["＋"]);
  binder.on(mmMinus, "click", function () {
    mm = Math.max(0.5, Math.round((mm - 0.5) * 10) / 10); mmVal.textContent = mm.toFixed(1) + " mm";
  });
  binder.on(mmPlus, "click", function () {
    mm = Math.min(review.BLEED_MM_MAX, Math.round((mm + 0.5) * 10) / 10); mmVal.textContent = mm.toFixed(1) + " mm";
  });
  mmRow.appendChild(mmMinus);
  mmRow.appendChild(mmVal);
  mmRow.appendChild(mmPlus);
  box.appendChild(mmRow);
  box.appendChild(dom.el("div", { class: "rv-dlg-note" }, [
    "「不确定」也是有效答案 —— 参数条会照实写「无法判断」，不猜。"
  ]));

  const foot = dom.el("div", { class: "rv-dlg-foot" });
  const cancel = dom.el("div", { class: "rv-btn", role: "button", tabindex: "0" }, ["取消"]);
  binder.on(cancel, "click", function () {
    closeDialog();
    logLine("bleed dialog cancel");
    setStatus("已取消导出（没有问出血）。");
  });
  const go = dom.el("div", { class: "rv-btn is-primary", role: "button", tabindex: "0" }, ["继续导出"]);
  binder.on(go, "click", function () {
    const made = review.makeBleed(pick, mm);
    if (!made.ok) {
      box.appendChild(dom.el("div", { class: "rv-note" }, ["⚠ " + made.error]));
      return;
    }
    S.mm = made.mm === null ? mm : made.mm;
    closeDialog();
    logLine("bleed dialog ok state=" + made.state + " mm=" + made.mm);
    onOk(made);
  });
  foot.appendChild(cancel);
  foot.appendChild(go);
  box.appendChild(foot);

  mask.appendChild(box);
  root.appendChild(mask);
  S.dialog = mask;
}

/* ===========================================================================
 * 四、导出目录（首次选一次后记住）
 * ------------------------------------------------------------------------- */

function lfs() {
  try {
    return require("uxp").storage.localFileSystem;
  } catch (e) {
    return null;
  }
}

/** 从持久令牌拿回上次选的目录。拿不回返回 null（**不报错**，退回"再选一次"）。 */
async function folderFromToken() {
  const ls = lfs();
  if (!ls || typeof ls.getEntryForPersistentToken !== "function") return null;
  let tok = "";
  try {
    const st = await store.readJson(STORE_FILE, {});
    tok = (st && st.folderToken) || "";
  } catch (e) {
    return null;
  }
  if (!tok) return null;
  try {
    const f = await ls.getEntryForPersistentToken(tok);
    return f || null;
  } catch (e) {
    /* 令牌失效（目录被删 / 换机器）⇒ 静默退回"再选一次" */
    await logLine("folder token failed: " + ((e && e.message) || e));
    return null;
  }
}

/** 用户选一个目录，并把选择存成持久令牌。 */
async function pickFolder() {
  if (S.busy) return null;
  const ls = lfs();
  if (!ls || typeof ls.getFolder !== "function") {
    setStatus("这个 UXP 版本没有 localFileSystem.getFolder ⇒ 选不了目录。");
    await logLine("pickFolder FAILED 没有 getFolder");
    return null;
  }
  let f = null;
  try {
    f = await ls.getFolder();
  } catch (e) {
    const m = (e && e.message) || String(e);
    await logLine("pickFolder THREW " + m);
    setStatus("打开目录选择器失败：" + m);
    return null;
  }
  if (!f) {
    await logLine("pickFolder cancel 用户取消");
    setStatus("没有选择目录。");
    return null;
  }
  S.folder = f;
  S.folderName = f.name || "(已选目录)";
  S.folderFrom = "picked";
  /* 存令牌。⚠️ 存不上**不拦路** —— 最多下次再问一遍，不该让导出失败。 */
  try {
    if (typeof ls.createPersistentToken === "function") {
      const tok = await ls.createPersistentToken(f);
      await store.patchJson(STORE_FILE, {}, function (cur) {
        const n = Object.assign({}, cur || {});
        n.folderToken = tok;
        n.folderName = S.folderName;
        n.at = new Date().toISOString();
        return n;
      });
      await logLine("pickFolder ok name=" + S.folderName + " token=saved");
    } else {
      await logLine("pickFolder ok name=" + S.folderName + " token=API_MISSING");
      setStatus("选了目录，但这个 UXP 版本没有 createPersistentToken ⇒ 下次还要再选一次。");
    }
  } catch (e) {
    await logLine("pickFolder token save FAILED " + ((e && e.message) || e));
    setStatus("选了目录，但没能记住（下次还要再选一次）：" + ((e && e.message) || e));
  }
  render();
  setStatus("导出位置：" + S.folderName + "。");
  return f;
}

/** 确保有一个可写的目录 Entry；没有就问一次。 */
async function ensureFolder() {
  if (S.folder) return S.folder;
  const f = await folderFromToken();
  if (f) {
    S.folder = f;
    S.folderName = f.name || "(上次的目录)";
    S.folderFrom = "remembered";
    return f;
  }
  return pickFolder();
}

/* ===========================================================================
 * 五、导出主流程
 * ------------------------------------------------------------------------- */

async function doExport(kind) {
  if (!alive() || S.busy) return;
  const insp = currentInsp();
  if (!insp || !insp.ok) {
    setStatus("导出不可用：" + ((insp && insp.error) || "没有打开的文档"));
    return;
  }
  const docId = insp.snapshot && insp.snapshot.info ? insp.snapshot.info.docId : null;

  /* 同文档/同会话记住上次选择；换了文档就重新问（**先弹窗，再进模态**）。 */
  const sameDoc = S.choice && S.docId !== null && String(S.docId) === String(docId);
  if (kind === "review" && !sameDoc) {
    openBleedDialog(
      "这张稿被导出成审核版时，参数条上要印出血情况。选一次就够（同一张稿不会再问）。",
      function (bleed) {
        S.docId = docId;
        S.choice = { state: bleed.state, mm: bleed.mm };
        render();
        doExport(kind);
      }
    );
    return;
  }
  if (kind === "review") S.docId = docId;

  const bleed = kind === "review" && S.choice
    ? { state: S.choice.state, mm: S.choice.mm }
    : { state: "unknown", mm: null };

  /* ---- 拿目录（可能要弹系统选择器；**仍然在任何模态之前**）---- */
  const folder = await ensureFolder();
  if (!folder) {
    setStatus("没有导出目录，已取消。");
    return;
  }

  /* ---- 建目标文件 ---- */
  const when = new Date();
  const fname = review.exportFileName(docNameOf(insp), kind, when);
  let file = null;
  try {
    file = await folder.createFile(fname, { overwrite: true });
  } catch (e) {
    const m = (e && e.message) || String(e);
    await logLine("createFile FAILED " + fname + " err=" + m);
    setStatus("在「" + S.folderName + "」里建不了文件：" + m);
    return;
  }
  if (!file) {
    setStatus("建文件失败（" + fname + "）。");
    return;
  }

  /* ---- 真正动手 ---- */
  S.busy = true;
  if (refs.btnReview) refs.btnReview.setAttribute("class", "rv-btn is-primary is-busy");
  /* ★ v0.9.2（docs/52 修法 1 · 备路）：**不再临时改你的稿** ——
     导出是在一张**副本**上做的（副本关掉即消失），所以文案也跟着改，
     不然"会临时改一下你的稿"会让人不敢点。 */
  setStatus((kind === "review" ? "正在导出审核版" : "正在导出成品图") +
    "…（在副本上作业，不动你的稿）");
  await logLine("export start kind=" + kind + " file=" + fname + " folder=" + (S.folderFrom || "?"));

  let r = null;
  try {
    r = await ctx.ps.exportReview({
      entry: file,
      folder: folder,     /* ★ v0.9.1：导出后要**问目录**"这文件在不在"（独立复核） */
      kind: kind,
      bleed: bleed,
      when: when
    });
  } catch (e) {
    r = { ok: false, error: "导出抛异常：" + ((e && e.message) || e), warnings: [] };
  }
  S.busy = false;
  /* ★ v0.9.1：steps 会从界面状态里删掉（避免撑爆），但**日志里必须留** ——
     2026-10-17 那次真机事故查不下去，就是因为日志只有一行结论、没有逐步骤读数。 */
  const stepsForLog = (r.steps || []).join(" | ");
  S.last = r;
  try { delete r.steps; } catch (e) { /* 不让 steps 撑爆界面状态 */ }

  await logLine("export done kind=" + kind + " ok=" + r.ok +
    " bytes=" + r.fileBytes +
    " layers=" + (r.before ? r.before.layers : "?") + "->" + (r.after ? r.after.layers : "?") +
    " restored=" + JSON.stringify(r.restored || null) +
    " err=" + (r.error || "-") +
    " fileCheck=" + JSON.stringify(r.fileCheck || null) +
    " savedDoc=" + JSON.stringify(r.savedDoc || null) +
    " docMode=" + (r.docMode || "-") +
    " entryPath=" + JSON.stringify((r.file && r.file.path) || ""));
  await logLine("export steps kind=" + kind + " :: " + stepsForLog);

  if (ctx.shell && ctx.shell.refreshUndo) {
    try { ctx.shell.refreshUndo(); } catch (e) { /* 忽略 */ }
  }

  /* 状态条：**把成败和读数说清楚**，不靠"没报错" */
  if (r.ok) {
    setStatus(
      "✓ 已导出 " + (r.file ? r.file.name : "") +
      (r.fileBytes ? "（" + Math.round(r.fileBytes / 1024) + " KB）" : "") +
      "\n稿子已一步还原（画布/图层数/背景色都读回确认过）。"
    );
  } else {
    setStatus(
      "✗ 导出未成功：" + (r.error || "未知") +
      ((r.warnings && r.warnings.length) ? "\n⚠ " + r.warnings.join("　⚠ ") : "")
    );
  }

  render();
}

/* ===========================================================================
 * 六、挂载 / 卸载
 * ------------------------------------------------------------------------- */

async function mount(container, context) {
  /* ⚠️ 外壳在"已是当前工具时再次 showTool"不会先 unmount（见 index.js）⇒ 自己先解绑，
     否则 binder 会叠一层（同一坑在 tools/inspect.js 里记过）。 */
  if (binder) {
    try { binder.offAll(); } catch (e) { /* 忽略 */ }
  }
  ctx = context;
  binder = dom.makeBinder();
  closeDialog();

  root = dom.el("div", { class: "rv" });
  refs = { body: dom.el("div", { class: "rv-body" }) };
  root.appendChild(refs.body);
  root.appendChild(buildFoot());

  dom.clear(container);
  container.appendChild(root);

  /* 出血默认「不确定」——**这不是替用户答题**，而是"还没问"时的安全值：
     参数条会照实写「无法判断」。用户真正点导出时才会被问。 */
  if (!S.choice) S.choice = { state: "unknown", mm: null };

  render();
  /* 主题要读像素（异步）：先渲染、再补一次 —— 拿到就重绘预览的配色 */
  try { await refreshTheme(); } catch (e) { /* 忽略：预览会显示"还没判色" */ }

  /* 记住的目录名先显示出来（异步，不阻塞渲染） */
  try {
    const st = await store.readJson(STORE_FILE, {});
    if (!S.folderName && st && st.folderName) {
      S.folderName = st.folderName;
      S.folderFrom = "remembered";
      render();
    }
  } catch (e) { /* 忽略 */ }

  await logLine("review mount doc=" + docNameOf(currentInsp()) +
    " spec=" + (currentInsp().spec ? currentInsp().spec.specVersion : "?"));
}

function unmount() {
  closeDialog();
  if (binder) binder.offAll();
  binder = null;
  root = null;
  refs = null;
  ctx = null;
  S.busy = false;
}

module.exports = {
  id: "review",
  title: "导出审核版",
  subtitle: "带参数条导出 · 改完自动还原",
  badge: "M5",
  ready: true,
  mount: mount,
  unmount: unmount,

  /* 供自检复用 —— 与面板走同一份实现，别在自检里另写一套 */
  __diag: {
    S: S,
    currentInsp: currentInsp,
    doExport: doExport,
    ensureFolder: ensureFolder,
    openBleedDialog: openBleedDialog,
    closeDialog: closeDialog,
    render: render,
    docNameOf: docNameOf
  }
};
