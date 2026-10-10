/*
 * lib/cssprobe.js —— CSS / 渲染能力探针（真机实测）
 * ===========================================================================
 * 为什么需要它：docs/14 的评审里，方向 B 这套视觉能不能成立，取决于几个
 * **官方文档没写清、我（AI）在纸上拍不了板** 的 CSS 能力。与其猜，不如在真机上
 * 量一次，把结论落到 boot.log 与 selfcheck.json，据此决定要不要加视觉增强项。
 *
 * 判据原则（继承 docs/12 的「以机制换兼容」）：
 *   ⚠️ **优先几何实测，而不是读 computed 值**。
 *      因为 UXP 会对不支持的特性「静默忽略」—— 写了属性、computed 还留着原值，
 *      但屏幕上什么都没发生。所以能测几何的就测几何（宽度差 / 位移差），
 *      测不了几何的（outline / box-shadow / 伪元素）才退而读 computed，
 *      并在结果里标注「仅 computed」。
 *
 * ---------------------------------------------------------------------------
 * 探针自身的翻车史（这段比结论更值钱，别再踩）
 * ---------------------------------------------------------------------------
 * 2026-10-10 第一版：所有几何探针返回 0。当时的解释是「离屏容器 left:-9999px 被
 * UXP 裁剪（culling）」，于是改成 visible-but-clipped（left:0 + height:1px +
 * overflow:hidden）。**改完仍然是 0**（真机日志：容器宽=0px、基准块 120x12 → 0x0）。
 *
 * 同一轮里 computed 类探针（outline / box-shadow / linear-gradient）返回的是**正确值**
 * → 证明 style 确实应用了，问题不在"样式没生效"，而在"量不到几何"。
 * 而自检 S13 能量到真实几何（行高=54、图标=26x26），差别在于：
 *     S13 量的是**早就在 DOM 里、中间隔了若干 await** 的元素；
 *     探针量的是**刚 append 完、同一同步块里** 的元素。
 * → 结论：**UXP 的布局是异步/延迟的**，同步 append 后立即 getBoundingClientRect()
 *    拿到的是尚未参与布局的 0，而不是"该特性不支持"。
 *
 * 于是本文件改成：**先建、再等它真的进布局、后量**（`waitLaidOut()` → 轮询到能给出非零几何）。
 * 并且加了 ⓪「测量基座」探针把这件事显式量出来（sync 值 vs settled 值），
 * 基座一旦失效，所有几何结论自动标注「不可信」—— 宁可承认测不准，也不给假阳性。
 *
 * 副作用：`run()` 从同步变成了 **async**，调用方必须 await（selfcheck S9 已改）。
 *
 * ---------------------------------------------------------------------------
 * 修正后的真机结论（2026-10-10 17:34，PS 27.2.0 / UXP 9.0.2，9/14 支持）
 * ---------------------------------------------------------------------------
 *   ✅ 支持：CSS 自定义属性(var)、letter-spacing、outline、box-shadow、
 *            transform、linear-gradient、SVG 命名空间、rect/offset* 布局测量
 *   ❌ 不支持：flex gap（间距必须用 margin）、伪元素 ::before、
 *            window.matchMedia（整个不存在 → 媒体查询与 prefers-color-scheme 全废）、
 *            SVG 子元素继承 fill/stroke（**图标系统必须逐元素写属性**）
 *
 *   被本次修正**推翻**的三条旧结论（旧版都是量法错导致的假阴性）：
 *     · 「CSS 变量不能用/读不到」→ 实际几何上完全生效（宽 137px 量到了）
 *     · 「letter-spacing 不生效」→ 实际生效（10px 字距差出 +100px）
 *     · 「transform 无效」→ 实际生效（translateX(30px) 量到 +30px）
 *     · 附带：「offsetWidth 恒为 0」也是假的，真机 =100，两套 API 都可用
 *   三条里面真正**没被推翻**的硬约束是：flex gap、SVG 继承、matchMedia —— 恰好
 *   也是 v0.2.1 那批 UI bug 的根因（图标黑块 / 圆点重叠）。
 *
 * ---------------------------------------------------------------------------
 * v0.2.2 复查：⓪ 基座判据本身有 bug（这条比结论更值得记）
 * ---------------------------------------------------------------------------
 * 现象：`⓪测量基座自证` 一直判 NO（`容器宽=0px`），于是 `rec()` 给**每一条**
 * `via="几何实测"` 的结论追加「⚠️ 基座未参与布局，此结论不可信」——
 * 连那些明明量到真值的（CSS 变量 137px、layout 100px）也被盖了章。
 *
 * 根因：基座把「首次 append 一整棵子树」的延迟，当成了「量法不可靠」。
 *   同一个容器在后面的探针里每次都能量到真值 → 说明 2 帧不够的是**第一次**，
 *   不是"容器不参与布局"。
 *
 * 修：① 量之前先给容器**预热**（自己先让两帧，把首次布局消化掉）；
 *     ② settled 改成 `settleUntil()` **轮询到为止**（上限 10 帧）并记录帧数与耗时；
 *     ③ 所有几何探针从「等固定 2 帧」改成 `waitLaidOut()` **轮询到进布局**。
 *        证据：同一份 `CSS 变量` 探针在**相邻两次运行**里分别量到 137px 与 0px，
 *        而代码一个字没改 —— 说明"2 帧就够"是个赌注。等固定帧数迟早还会骗我们一次。
 * 教训（与上次同一家族）：**判据写错，会把自己的可信度一起抹掉**。
 *   "不可信"这种标注尤其要谨慎 —— 它一旦误报，人就会开始忽略它。
 * ---------------------------------------------------------------------------
 */

const dom = require("./dom.js");

/**
 * v0.2.2：settle() 的实现已收进 `lib/dom.js`（调色板的悬停浮层也要用它），
 * 这里改为引用同一份 —— 两处各写一份「让帧」迟早走偏。
 */
const settle = dom.settle;

const PROBE_ITEMS = [
  "harness", "cssVars", "letterSpacing", "outline", "boxShadow", "transform",
  "gradient", "pseudoEl", "mediaWidth", "prefersColorScheme", "svgNS",
  "svgPaint", "layout", "flexGap",
];

function errMsg(e) {
  return String((e && e.message) || e);
}

/**
 * 反复让帧，直到 predicate 为真或到达帧数上限。
 * 用途：UXP 的布局延迟**不是固定 2 帧** —— 首次 append 一棵新子树需要更多。
 * 与其猜一个帧数，不如"轮询到为止"，并把**用了几帧**记下来（这本身就是证据）。
 * @returns {Promise<{ok:boolean, frames:number, ms:number}>}
 */
async function settleUntil(predicate, maxFrames) {
  const t0 = Date.now();
  const limit = maxFrames || 8;
  for (let i = 0; i < limit; i++) {
    await settle();
    let v = null;
    try {
      v = predicate();
    } catch {
      v = null;
    }
    if (v) return { ok: true, frames: i + 1, ms: Date.now() - t0 };
  }
  return { ok: false, frames: limit, ms: Date.now() - t0 };
}

/**
 * 挂进容器后**轮询等到它真的进了布局**，再返回。
 *
 * ⚠️ 为什么不"等固定帧数"：v0.2.2 复验抓到同一份探针在**相邻两次运行**里
 *    分别量到 137px 与 0px —— "让 2 帧就够"是个赌注，布局何时完成取决于
 *    元素挂进去时处在帧的哪个相位。判据改成"等到能给出非零几何"才稳。
 * @param {Element|Element[]} nodes 待测节点（任一给出非零宽度即认为已进布局）
 */
function waitLaidOut(nodes) {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  return settleUntil(() => {
    for (const n of list) {
      if (n && rectW(n) > 0) return true;
    }
    return false;
  }, 12);
}

function mk(style, text, tag) {
  const el = document.createElement(tag || "div");
  if (style) el.setAttribute("style", style);
  if (text !== null && text !== undefined) el.textContent = String(text);
  return el;
}

function rectW(el) {
  try {
    return Math.round(el.getBoundingClientRect().width || 0);
  } catch {
    return -1;
  }
}

function rectOf(el) {
  try {
    return el.getBoundingClientRect();
  } catch {
    return null;
  }
}

/**
 * 跑一遍全部探测（**异步**：内部会轮询等布局）。
 * @returns {Promise<{ran:boolean, error?:string, results:Array, summary:string, pass:number, total:number}>}
 */
async function run() {
  const results = [];
  /** 基座是否有效；失效时几何结论一律标注不可信。 */
  let harnessOk = false;

  const rec = (key, label, ok, detail, via) => {
    const how = via || "几何实测";
    let d = detail || "";
    if (how === "几何实测" && !harnessOk && key !== "harness") {
      d += "　⚠️ 基座未参与布局，此结论不可信";
    }
    results.push({ key: key, label: label, ok: !!ok, detail: d, via: how });
  };

  let host = null;
  try {
    host = mk(
      "position:absolute;left:0;top:0;width:320px;height:1px;overflow:hidden;pointer-events:none;",
      ""
    );
    document.body.appendChild(host);
  } catch (e) {
    return {
      ran: false,
      error: errMsg(e),
      results: results,
      summary: "0/0",
      pass: 0,
      total: 0,
    };
  }

  /* ---------------- ⓪ 测量基座自证 ----------------
     这条不测任何 CSS 特性，只测「这套量法本身靠不靠得住」。
     同一元素量两次：sync（append 完立刻量）与 settled（让帧后量）。

     ⚠️ v0.2.2 修正：旧版**漏了给容器预热**，结果量出来的其实是
        「首次 append 子树需要几帧才进布局」（真机 0x0）——
        而同一个容器在后面的探针里每次都能量到真值（137px / 100px）。
        于是这条一直判 NO，连累**每一条正确的几何结论**都被盖上
        「⚠️ 基座未参与布局，此结论不可信」，把日志的可信度自己抹掉了。
        现在：① 先把容器自己预热到完成布局（隔离掉"首次延迟"这个变量）；
              ② settled 用**轮询到为止**（上限 10 帧）并记录用了几帧 ——
                 这个帧数本身就是"UXP 布局异步"的量化证据。
     判据：sync 预期为 0（证明同步量不可用）、settled 必须命中 120x12。 */
  let syncW = -1;
  let settledW = -1;
  let settledH = -1;
  let hostW = -1;
  let waitFrames = -1;
  try {
    await settle();
    await settle();                 // 容器预热：把它自己的首次布局消化掉

    const ctrl = mk("width:120px;height:12px;", "");
    host.appendChild(ctrl);

    syncW = rectW(ctrl);            // ① 同步量：预期为 0（布局未跑）
    const waited = await settleUntil(() => rectW(ctrl) === 120, 10);
    waitFrames = waited.frames;
    const r = rectOf(ctrl);
    settledW = r ? Math.round(r.width || 0) : -1;
    settledH = r ? Math.round(r.height || 0) : -1;
    hostW = rectW(host);            // ③ 连容器本身也一起量

    harnessOk = settledW === 120 && settledH === 12;
    results.push({
      key: "harness",
      label: "测量基座自证（几何类结论的前提）",
      ok: harnessOk,
      detail:
        "同步量=" + syncW + "px（预期 0）　让帧后=" + settledW + "x" + settledH +
        "（期望 120x12）　容器宽=" + hostW + "px　用了几帧=" + waitFrames + "　" +
        "耗时=" + waited.ms + "ms" +
        (harnessOk
          ? "　→ 基座有效，几何量可信" +
            (syncW === 0 ? "（并证实：UXP 布局异步，同步量必为 0）" : "")
          : "　→ ⚠️ 基座无效：子树没进布局，一切几何结论作废"),
      via: "几何实测",
    });
  } catch (e) {
    results.push({
      key: "harness",
      label: "测量基座自证（几何类结论的前提）",
      ok: false,
      detail: errMsg(e),
      via: "几何实测",
    });
  }

  /* ---------------- ① CSS 自定义属性（几何判别） ----------------
     ⚠️ 真机实测：`getComputedStyle(el).getPropertyValue("--x")` **读不到自定义属性**
        （恒返回 ""），但这**不代表 CSS 变量不生效** —— 整个界面就是靠 var() 上色的。
        所以改成「把变量用在一个宽度上，量渲染结果」：走渲染层，结论才可信。 */
  try {
    const el = mk("--probe-w:137px;width:var(--probe-w,0px);height:10px;", "");
    host.appendChild(el);
    await waitLaidOut(el);
    const w = rectW(el);
    rec(
      "cssVars",
      "CSS 自定义属性（设计令牌的前提）",
      w === 137,
      "width:var(--probe-w) 且 --probe-w:137px → 实测宽 " + w + "px（期望 137）",
      "几何实测"
    );
  } catch (e) {
    rec("cssVars", "CSS 自定义属性（设计令牌的前提）", false, errMsg(e), "几何实测");
  }

  /* ---------------- ② letter-spacing（几何） ---------------- */
  try {
    const mkSpan = (ls) => {
      const s = document.createElement("span");
      s.setAttribute(
        "style",
        "display:inline-block;font-size:13px;white-space:nowrap;letter-spacing:" + ls + ";"
      );
      s.textContent = "HHHHHHHHHH";
      return s;
    };
    const a = mkSpan("0px");
    const b = mkSpan("10px");
    host.appendChild(a);
    host.appendChild(b);
    await waitLaidOut([a, b]);
    const wa = rectW(a);
    const wb = rectW(b);
    const d = wb - wa;
    rec(
      "letterSpacing",
      "letter-spacing 字距",
      d > 30,
      "0px → " + wa + "px；10px → " + wb + "px；差 " + d + "px（期望约 +100px）"
    );
  } catch (e) {
    rec("letterSpacing", "letter-spacing 字距", false, errMsg(e));
  }

  /* ---------------- ③ outline ---------------- */
  try {
    const el = mk("width:10px;height:10px;outline:2px solid rgb(255,0,0);", "");
    host.appendChild(el);
    const ow = String(getComputedStyle(el).outlineWidth || "");
    rec("outline", "outline 描边（色块 hover 环的备选）", ow === "2px", "outlineWidth=" + JSON.stringify(ow), "computed");
  } catch (e) {
    rec("outline", "outline 描边（色块 hover 环的备选）", false, errMsg(e), "computed");
  }

  /* ---------------- ④ box-shadow ---------------- */
  try {
    const el = mk("width:10px;height:10px;box-shadow:0 0 0 2px #00ff00;", "");
    host.appendChild(el);
    const bs = String(getComputedStyle(el).boxShadow || "");
    rec(
      "boxShadow",
      "box-shadow 阴影（需 CSSNextSupport）",
      !!bs && bs !== "none",
      "boxShadow=" + JSON.stringify(bs),
      "computed"
    );
  } catch (e) {
    rec("boxShadow", "box-shadow 阴影（需 CSSNextSupport）", false, errMsg(e), "computed");
  }

  /* ---------------- ⑤ transform（几何） ---------------- */
  try {
    const t1 = mk("position:absolute;left:0;top:0;width:20px;height:20px;", "");
    const t2 = mk(
      "position:absolute;left:0;top:0;width:20px;height:20px;transform:translateX(30px);",
      ""
    );
    host.appendChild(t1);
    host.appendChild(t2);
    await waitLaidOut([t1, t2]);
    const r1 = rectOf(t1);
    const r2 = rectOf(t2);
    const diff = Math.round(((r2 && r2.left) || 0) - ((r1 && r1.left) || 0));
    rec(
      "transform",
      "transform 位移（浮层定位的备选）",
      Math.abs(diff - 30) <= 2,
      "期望 +30px，实测 +" + diff + "px"
    );
  } catch (e) {
    rec("transform", "transform 位移（浮层定位的备选）", false, errMsg(e));
  }

  /* ---------------- ⑥ linear-gradient ---------------- */
  try {
    const el = mk(
      "width:20px;height:20px;background-image:linear-gradient(90deg,#ff0000,#0000ff);",
      ""
    );
    host.appendChild(el);
    const gi = String(getComputedStyle(el).backgroundImage || "");
    rec(
      "gradient",
      "linear-gradient 渐变（PS 2024 可能不生效）",
      /gradient/i.test(gi),
      "backgroundImage=" + JSON.stringify(gi),
      "computed"
    );
  } catch (e) {
    rec("gradient", "linear-gradient 渐变（PS 2024 可能不生效）", false, errMsg(e), "computed");
  }

  /* ---------------- ⑦ 伪元素 ::before ---------------- */
  try {
    let st = null;
    try {
      st = document.createElement("style");
      st.textContent = ".vt-probe-pe::before{content:'x';}";
      (document.head || document.documentElement).appendChild(st);
    } catch {
      st = null;
    }
    const el = mk("", "");
    el.setAttribute("class", "vt-probe-pe");
    host.appendChild(el);
    let content = "";
    try {
      content = String(getComputedStyle(el, "::before").content || "");
    } catch (e) {
      content = "";
    }
    const applied = /^["']/.test(String(content).trim());
    rec(
      "pseudoEl",
      "伪元素 ::before（结构类伪元素）",
      applied,
      "getComputedStyle(el,'::before').content=" + JSON.stringify(content) +
        (applied ? "　→ 生效" : "　→ 未生效（normal = 规则没应用）"),
      "computed"
    );
    if (st && st.parentNode) st.parentNode.removeChild(st);
  } catch (e) {
    rec("pseudoEl", "伪元素 ::before（结构类伪元素）", false, errMsg(e), "computed");
  }

  /* ---------------- ⑧ 宽度媒体查询 ---------------- */
  try {
    const mq = window.matchMedia("(min-width: 1px)");
    const ok = !!(mq && mq.matches);
    rec(
      "mediaWidth",
      "宽度媒体查询（窄面板自适应）",
      ok,
      "min-width:1px → " + (mq ? mq.matches : "无 matchMedia"),
      "API"
    );
  } catch (e) {
    rec("mediaWidth", "宽度媒体查询（窄面板自适应）", false, errMsg(e), "API");
  }

  /* ---------------- ⑨ prefers-color-scheme ---------------- */
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const ok = !!mq && typeof mq.matches === "boolean";
    rec(
      "prefersColorScheme",
      "prefers-color-scheme 主题查询（皮肤自适应）",
      ok,
      "dark → " + (mq ? mq.matches : "无 matchMedia"),
      "API"
    );
  } catch (e) {
    rec("prefersColorScheme", "prefers-color-scheme 主题查询（皮肤自适应）", false, errMsg(e), "API");
  }

  /* ---------------- ⑩ SVG 命名空间元素 ----------------
     这条判的是「元素建得对不对」，不是几何，所以标 API 而非几何 —— 
     免得被基座标记牵连（两个 getBBox 在真机上都不存在）。 */
  try {
    const NS = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(NS, "svg");
    svgEl.setAttribute("viewBox", "0 0 16 16");
    svgEl.setAttribute("width", "16");
    svgEl.setAttribute("height", "16");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M2 2 L14 14");
    p.setAttribute("stroke", "#ffffff");
    p.setAttribute("fill", "none");
    svgEl.appendChild(p);
    host.appendChild(svgEl);
    const ok = svgEl.namespaceURI === NS;
    rec(
      "svgNS",
      "SVG 命名空间元素（图标系统）",
      ok,
      "namespaceURI=" + svgEl.namespaceURI +
        "　子节点=" + (svgEl.childNodes ? svgEl.childNodes.length : "?") +
        "　getBBox=" + (typeof svgEl.getBBox === "function" ? "有" : "无"),
      "API"
    );
  } catch (e) {
    rec("svgNS", "SVG 命名空间元素（图标系统）", false, errMsg(e));
  }

  /* ---------------- ⑩b SVG 绘制：子元素会不会继承父节点的 fill/stroke ----------------
     这是 v0.2.1 修的那个"黑方块 / 看不见图标"的根因判据。
     父节点写 fill=none + stroke=currentColor，读子元素的 computed 值：
       · 得到 "none" / 红色 → **继承成立**，逐元素写属性只是保险
       · 得到 "rgb(0, 0, 0)" → **不继承**，子元素退回 SVG 初值 → 必须逐元素写
     顺带量一下 getBBox：能给出非零尺寸说明几何真的进了渲染树。 */
  try {
    const NS = "http://www.w3.org/2000/svg";
    const box = mk("width:16px;height:16px;color:rgb(255,0,0);", "");
    const svgEl = document.createElementNS(NS, "svg");
    svgEl.setAttribute("viewBox", "0 0 16 16");
    svgEl.setAttribute("width", "16");
    svgEl.setAttribute("height", "16");
    svgEl.setAttribute("fill", "none");
    svgEl.setAttribute("stroke", "currentColor");
    const child = document.createElementNS(NS, "path");
    child.setAttribute("d", "M2 2 L14 14"); // 故意**不**写自己的 fill/stroke
    svgEl.appendChild(child);
    box.appendChild(svgEl);
    host.appendChild(box);

    let cFill = "?";
    let cStroke = "?";
    try {
      cFill = String(getComputedStyle(child).fill || "");
    } catch (e) {
      cFill = "读不到";
    }
    try {
      cStroke = String(getComputedStyle(child).stroke || "");
    } catch (e) {
      cStroke = "读不到";
    }
    let bbox = "无 getBBox";
    if (typeof svgEl.getBBox === "function") {
      try {
        const b = svgEl.getBBox();
        bbox = Math.round(b.width) + "x" + Math.round(b.height);
      } catch (e) {
        bbox = "getBBox 抛错";
      }
    }
    const inherited = cFill.trim() === "none";
    rec(
      "svgPaint",
      "SVG 子元素继承 fill/stroke（不继承就必须逐元素写）",
      inherited,
      "父 fill=none/stroke=currentColor　子 computed fill=" + JSON.stringify(cFill) +
        " stroke=" + JSON.stringify(cStroke) +
        "　getBBox=" + bbox +
        (inherited ? "　→ 继承成立" : "　→ ⚠️ 不继承：子元素退回 fill:black，必须逐元素显式写"),
      "computed"
    );
  } catch (e) {
    rec("svgPaint", "SVG 子元素继承 fill/stroke", false, errMsg(e), "computed");
  }

  /* ---------------- ⑪ 布局测量 ---------------- */
  try {
    const el = mk(
      "position:absolute;left:40px;top:7px;width:100px;height:10px;",
      ""
    );
    host.appendChild(el);
    await waitLaidOut(el);
    const r = rectOf(el);
    const w = r ? Math.round(r.width || 0) : -1;
    /* ⚠️ 一次性把 rect / offset* 两套 API 全量出来。
       旧版曾断言「offsetWidth 恒为 0，绝不能用」—— 那个结论是**同步量**造成的假阴性：
       真机在让出两帧后 offsetWidth=100、offsetHeight=10 全部正常。
       两套 API 都能用，但**都必须在让帧之后量**。 */
    const ow = el.offsetWidth;
    const oh = el.offsetHeight;
    const ol = el.offsetLeft;
    const ot = el.offsetTop;
    const okW = w === 100 && ow === 100 && oh === 10;
    rec(
      "layout",
      "布局测量（rect 与 offset* 均可用，但须让帧后再量）",
      okW,
      "width:100px → rect.width=" + w + "px　offsetWidth=" + String(ow) +
        "　offsetHeight=" + String(oh) +
        "　offsetLeft=" + String(ol) + "　offsetTop=" + String(ot) +
        (okW ? "　→ 两套 API 都可用" : "　→ 测量异常，检查是否忘了让帧"),
      "几何实测"
    );
  } catch (e) {
    rec("layout", "布局测量（getBoundingClientRect）", false, errMsg(e));
  }

  /* ---------------- ⑫ flex gap ---------------- */
  try {
    const wrap = mk("display:flex;gap:10px;width:200px;", "");
    const c1 = mk("width:20px;height:10px;flex:0 0 auto;", "");
    const c2 = mk("width:20px;height:10px;flex:0 0 auto;", "");
    wrap.appendChild(c1);
    wrap.appendChild(c2);
    host.appendChild(wrap);
    await waitLaidOut([wrap, c1, c2]);
    const r1 = rectOf(c1);
    const r2 = rectOf(c2);
    const d = Math.round(((r2 && r2.left) || 0) - ((r1 && r1.left) || 0));
    rec(
      "flexGap",
      "flex gap（组件间距）",
      d === 30,
      "两子项各 20px + gap 10px → 起点差 " + d + "px（期望 30）" +
        (d === 30 ? "　→ gap 可用" : "　→ gap 不生效，间距要用 margin 兜"),
      "几何实测"
    );
  } catch (e) {
    rec("flexGap", "flex gap（组件间距）", false, errMsg(e));
  }

  /* ---------------- 清理 ---------------- */
  try {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  } catch {
    /* 忽略 */
  }

  const pass = results.filter((r) => r.ok).length;
  return {
    ran: true,
    results: results,
    pass: pass,
    total: results.length,
    summary: pass + "/" + results.length,
  };
}

module.exports = { run, PROBE_ITEMS };
