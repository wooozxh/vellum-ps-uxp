/*
 * tools/inspect.js —— 出图体检（M5，v0.6.0；方案 docs/49 §3.1）
 * ===========================================================================
 * 这个页面**只读**：只显示当前文档的体检结果，不改你的稿。
 *
 * 数据全部来自 `lib/inspect.js` 的 `docInspect()` —— 与状态条上的常驻摘要
 * **是同一份实现**（docs/49 §3.0「一个数据源、三个出口」）。
 * 所以这里看到的行数、结论，跟状态条上那句摘要不可能互相矛盾。
 *
 * ⚠️ 本版**没有**「一键补标」按钮，这是有意的：
 *    补标要给文档**写参考线**，而"UXP 能否主动创建参考线"**没验过**（探针只验了
 *    `presetJSON` 能不能带 guides）。在没验证之前不放会改稿的按钮 ——
 *    宁可少一个功能，不可让一个"点了没反应/点坏了"的按钮存在。
 *
 * 严重度用**文字标签**而不是符号图标：
 *    合格 / 提醒 / 必须处理 / 无结论 / 信息
 *    —— 本项目约定界面不用 emoji 当图标，且"无结论"这一档必须能被一眼看见
 *       （不许把无结论写成结论，见 DECISIONS）。
 */

const dom = require("../lib/dom.js");
const inspect = require("../lib/inspect.js");

let ctx = null;
let binder = null;
let root = null;
let refs = null;
let lastRender = null;

/** severity → 中文标签（固定宽度列，不靠图标）。 */
const SEV_CN = {
  ok: "合格",
  warn: "提醒",
  fatal: "必须处理",
  unknown: "无结论",
  info: "信息"
};

function sevClass(s) {
  if (s === "warn" || s === "fatal" || s === "unknown") return " is-" + s;
  return "";
}

/* ------------------------------------------------------------------ 渲染 */

function buildFindings(insp) {
  const box = dom.el("div", { class: "insp-list" });

  if (!insp || !insp.ok) {
    box.appendChild(
      dom.el("div", { class: "insp-empty" }, [
        "没有打开的文档 —— 体检需要有稿子。",
        dom.el("div", {
          class: "insp-note",
          style: "margin-top:6px"
        }, ["打开或新建一个文档后，这里会自动刷新（也能点下面的「重新体检」）"])
      ])
    );
    return box;
  }

  for (let i = 0; i < insp.findings.length; i++) {
    const f = insp.findings[i];
    const row = dom.el("div", { class: "insp-row" + sevClass(f.severity) });

    row.appendChild(
      dom.el("span", { class: "insp-mark" }, [SEV_CN[f.severity] || f.severity])
    );
    row.appendChild(dom.el("span", { class: "insp-lb" }, [f.label]));

    const right = dom.el("span", { class: "insp-vl" }, [f.value]);
    if (f.note) right.appendChild(dom.el("div", { class: "insp-note" }, [f.note]));
    row.appendChild(right);

    box.appendChild(row);
  }
  return box;
}

function buildSummary(insp) {
  const sum = dom.el("div", { class: "insp-sum" });

  if (!insp || !insp.ok) {
    sum.appendChild(dom.el("div", {}, ["体检不可用：没有打开的文档"]));
    return sum;
  }

  const info = insp.snapshot.info;
  sum.appendChild(
    dom.el("div", { class: "insp-doc" }, [info.docName || "未命名"])
  );
  sum.appendChild(
    dom.el("div", { class: "insp-basis mono" }, [
      "依据 " + insp.spec.specName + " v" + insp.spec.specVersion +
        "（按「" + (inspect.USAGE_CN[insp.spec.usage] || insp.spec.usage) + "」标准判）"
    ])
  );
  return sum;
}

function render(insp) {
  if (!refs || !refs.body) return;
  lastRender = insp;
  dom.clear(refs.body);
  refs.body.appendChild(buildSummary(insp));
  refs.body.appendChild(buildFindings(insp));
}

function doRefresh(fresh) {
  if (!ctx) return;
  let insp;
  try {
    insp = inspect.docInspect({ fresh: !!fresh });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    try {
      ctx.log.appendLog("inspect tool FAILED  " + msg);
    } catch (e2) {
      /* 忽略 */
    }
    insp = { ok: false, error: msg };
  }
  render(insp);

  if (insp && insp.ok) {
    const warns = insp.findings.filter(function (f) { return f.severity === "warn"; }).length;
    const fatal = insp.findings.filter(function (f) { return f.severity === "fatal"; }).length;
    ctx.setStatus(
      "体检完成（" + insp.findings.length + " 项）：" +
        (fatal ? fatal + " 项必须处理、" : "") +
        (warns ? warns + " 项提醒。" : "无提醒。") +
        "\n⚠ 本页只读，不会改动你的稿。"
    );
  } else {
    ctx.setStatus("体检不可用：" + ((insp && insp.error) || "未知原因"));
  }
}

/* ------------------------------------------------------------------ 挂载 */

async function mount(container, context) {
  /* ⚠️ 防御：外壳在"已是当前工具时再次 showTool"不会先 unmount（见 index.js 的
     `if (currentTool && currentTool !== t)`）。而状态条 chip 恰恰会在体检页上再被点一次
     —— 若不先解绑，binder 会叠一层。 */
  if (binder) {
    try {
      binder.offAll();
    } catch (e) {
      /* 忽略 */
    }
  }

  ctx = context;
  binder = dom.makeBinder();

  root = dom.el("div", { class: "insp" });

  const foot = dom.el("div", { class: "insp-foot" });
  const btn = dom.el("div", {
    class: "insp-btn",
    role: "button",
    tabindex: "0",
    title: "重新读一遍当前文档"
  }, ["重新体检"]);
  binder.on(btn, "click", function () {
    // 手点 = 强制重读字体清单（可能刚装了字体）
    doRefresh(true);
  });
  foot.appendChild(btn);
  foot.appendChild(
    dom.el("span", { class: "insp-hint" }, ["只读 —— 不改图层、不改像素、不动选区"])
  );

  refs = { body: dom.el("div", { class: "insp-body" }), foot: foot };
  root.appendChild(refs.body);
  root.appendChild(foot);

  dom.clear(container);
  container.appendChild(root);

  doRefresh(false);

  try {
    await ctx.log.appendLog("inspect mount  doc=" +
      ((lastRender && lastRender.ok && lastRender.snapshot.info.docName) || "无文档"));
  } catch (e) {
    /* 忽略 */
  }
}

function unmount() {
  if (binder) binder.offAll();
  binder = null;
  root = null;
  refs = null;
  ctx = null;
  lastRender = null;
}

module.exports = {
  id: "inspect",
  title: "出图体检",
  subtitle: "出图前先看清参数",
  badge: "M5",
  ready: true,
  mount: mount,
  unmount: unmount,

  /* 供自检复用 —— 与面板走同一份实现 */
  SEV_CN: SEV_CN
};
