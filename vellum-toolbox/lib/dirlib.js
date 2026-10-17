/**
 * 目录导航：**面包屑 + 子目录列表** —— 素材库与将来的模板库共用一套。
 *
 * ── 为什么要单独抽出来 ──────────────────────────────────────────────
 * 用户 2026-10-17 拍板「方向 B：面包屑下钻」。两个库（素材库 / 模板库）都会用到，
 * **各写一遍必然长歪**（一个能折叠、一个不能；一个点了回上级、一个不回）——
 * 所以这里只管"长什么样、点了回调谁"，**状态与数据都在调用方**。
 *
 * ── 形态以 mock 为准（`preview/multi-level-dir-mock.png` 中间那一屏）─────
 *   ① 面包屑：`通用库 › 品牌视觉 › Logo`，右端跟一句 `第 2/3 层`。
 *      ⚠️ 第 0 段是**库名**（不是「全部」）—— "全部"在根层本来就等于库名，
 *         两个词指同一件事只会让人多犹豫一次。
 *   ② 子目录：**整行**，📁 + 名字 +（右端）`N 项`。**不是 chips** ——
 *      第一版为了省高度做成了 chips，用户当场指出"新 UI 不是这个吗？"
 *      ⇒ 设计稿是行，就做行。行的好处：名字能写全（目录名往往很长）、
 *        点按目标 26px 高（chips 只有 22px，手指/触控板都更难点准）。
 *   ③ 超过 `MAX_VISIBLE` 行折叠成一行「还有 N 个」。
 *
 * ── 高度约束（docs/55 §九 / §十三）─────────────────────────────────
 *   一行 26 + 3 间距 ≈ 29px；面包屑一行 ≈ 26px。
 *   **超过 3 行就折叠** —— 子目录数量由软件侧决定，10 个 = 290px 会把网格挤没。
 *
 * ── 判据/坑 ────────────────────────────────────────────────────────
 *   · 面包屑每段带 `data-crumb="<下标>"`，**下标 0 是库名**（回到根）；
 *     最后一段是当前层，**不可点**；
 *   · 目录行带 `data-key="<组名>"`（遗留字段名，排障脚本/断言还在按它找）；
 *   · `path` 里任何一段都**不能是空串**（空段会让"第几段"与"点回第几层"错位）。
 */

const icons = require("./icons.js");

/** 最多同时显示几行子目录，超过就折叠。行高 26 + 间距 3 ⇒ 3 行约 87px。 */
const MAX_VISIBLE = 3;

/**
 * 取一条素材的**完整分组路径**。
 * 兼容老数据：没有 `groupPath` 就退化成 `[group]`，再退化成「未分组」。
 * ⚠️ 与 `mirror.groupTree()` 里那段取法**必须一致** —— 否则"树里有这个组、
 *    按路径却筛不出素材"，表现就是点进去一片空白。
 */
function pathOf(item) {
  if (item && Array.isArray(item.groupPath) && item.groupPath.length) return item.groupPath;
  return [(item && item.group) || "未分组"];
}

/**
 * 按路径在分组树里找到节点。
 * @returns {object|null} 命中返回节点（`{name,count,children}`）；路径为空返回 `null`（= 根）。
 */
function resolve(tree, path) {
  let node = null;
  let level = tree || [];
  for (const name of path || []) {
    let hit = null;
    for (const n of level) if (n.name === name) hit = n;
    if (!hit) return null;
    node = hit;
    level = hit.children || [];
  }
  return node;
}

/** 整棵树的最大层数（根层算 0）。面包屑右端那句「第 N/M 层」要用。 */
function maxDepth(tree) {
  let best = 0;
  const walk = (nodes, d) => {
    for (const n of nodes || []) {
      if (d > best) best = d;
      if (n.children && n.children.length) walk(n.children, d + 1);
    }
  };
  walk(tree || [], 1);
  return best;
}

/**
 * 面包屑。**路径为空时返回 `null`**（根层只显示一个库名，纯噪音）。
 *
 * @param {object} dom     `lib/dom.js`
 * @param {object} binder  当前工具的 binder（卸载时会 offAll）
 * @param {object} opts
 *   · `path`      当前路径数组
 *   · `rootLabel` 第 0 段的名字（= 库名，如「通用库」）
 *   · `levelText` 右端那句，如「第 2/3 层」
 *   · `onPick`    `(下标) => {}`，下标 0 = 回根
 * @returns {object|null} `.bc` 元素
 */
function breadcrumb(dom, binder, opts) {
  const path = (opts && opts.path) || [];
  if (!path.length) return null;

  const bar = dom.el("div", { class: "bc", id: "vt-lib-bc" });

  const segs = [{ name: (opts && opts.rootLabel) || "全部", idx: 0 }];
  for (let i = 0; i < path.length; i++) segs.push({ name: path[i], idx: i + 1 });

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    if (i > 0) bar.appendChild(dom.el("span", { class: "bc-sep" }, ["›"]));
    const seg = dom.el("span", {
      class: "bc-s" + (last ? " is-on" : ""),
      "data-crumb": String(s.idx),
      role: last ? "" : "button",
      tabindex: last ? "" : "0",
      title: last ? "当前目录" : "回到「" + s.name + "」",
    }, [s.name]);
    if (!last) {
      const idx = s.idx;
      binder.on(seg, "click", () => opts.onPick(idx));
    }
    bar.appendChild(seg);
  }

  if (opts && opts.levelText) {
    bar.appendChild(dom.el("span", { class: "bc-n mono" }, [opts.levelText]));
  }
  return bar;
}

/**
 * 子目录列表（**整行**，不是 chips）。
 *
 * @param {object} opts
 *   · `kids`     子节点数组 `[{name,count,children}]`
 *   · `expanded` 是否已展开（超过 MAX_VISIBLE 时）
 *   · `unit`     计数单位（默认「项」）
 *   · `onPick`   `(name) => {}`
 *   · `onExpand` `(bool) => {}`
 * @returns {object|null} `.dirs` 元素；没有子目录时返回 `null`
 */
function dirRow(dom, binder, opts) {
  const kids = (opts && opts.kids) || [];
  if (!kids.length) return null;

  const wrap = dom.el("div", { class: "dirs", id: "vt-lib-dirs" });
  const expanded = !!(opts && opts.expanded);
  const unit = (opts && opts.unit) || "项";
  const shown = expanded ? kids : kids.slice(0, MAX_VISIBLE);

  for (const k of shown) {
    const row = dom.el("div", {
      class: "dir",
      role: "button",
      tabindex: "0",
      "data-key": k.name, // ← 沿用旧 chips 的字段名：断言/排障脚本仍按它找
      title: "进入「" + k.name + "」",
    });
    row.appendChild(icons.holder("folder", "i"));
    row.appendChild(dom.el("span", { class: "dn" }, [k.name]));
    row.appendChild(
      dom.el("span", { class: "dc mono" }, [String(k.count) + " " + unit])
    );
    binder.on(row, "click", () => opts.onPick(k.name));
    wrap.appendChild(row);
  }

  const rest = kids.length - shown.length;
  if (rest > 0) {
    const more = dom.el("div", {
      class: "dir more",
      role: "button",
      tabindex: "0",
      title: "还有 " + rest + " 个子目录",
    }, ["还有 " + rest + " 个"]);
    binder.on(more, "click", () => opts.onExpand(true));
    wrap.appendChild(more);
  } else if (expanded && kids.length > MAX_VISIBLE) {
    const less = dom.el("div", {
      class: "dir more",
      role: "button",
      tabindex: "0",
      title: "收起子目录",
    }, ["收起"]);
    binder.on(less, "click", () => opts.onExpand(false));
    wrap.appendChild(less);
  }

  return wrap;
}

module.exports = { MAX_VISIBLE, pathOf, resolve, maxDepth, breadcrumb, dirRow };
