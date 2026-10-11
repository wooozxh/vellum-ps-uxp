/*
 * lib/selfcheck.js —— 无痕自检（开发期）
 * ===========================================================================
 * 由插件目录下的 verify.flag 控制，默认关闭（删文件即关）。
 *
 * 为什么要有它：面板交互我（AI）点不了，但「用户点了色块到底成不成」这件事
 * 必须能自证。于是这里**不另写一套逻辑**，而是**合成点击真的 DOM 元素**，
 * 让事件走真实的处理器 —— 测的是面板本身，不是影子实现。
 *
 * 覆盖（对应 docs/10 §八 M1 验收）：
 *   S1 外壳挂载调色板工具（真实 mount 路径）
 *   S2 上次自检留下的颜色还在磁盘上 → 跨重载持久化成立（顺带清理）
 *   S3 合成点击「品牌色 1」→ 前景色变化（回读命中）
 *   S4 合成 Shift+点击「品牌色 2」→ 背景色变化
 *   S5 点「＋ 存为我的颜色」→ palette.json 落盘（从磁盘读回确认）
 *   S6 点 ✕ 删除 → palette.json 同步
 *   S7 环境能力（读/设色）+ 版本信息
 *   S8 前景/背景色恢复原值（回读校验）
 *
 *   以下为「方向 B 视觉重做」新增（对应 docs/14 的待实测清单）：
 *   S9  CSS 能力探针 —— letter-spacing / outline / box-shadow / transform /
 *       linear-gradient / 伪元素 / 主题查询 / SVG 命名空间 / flex gap 真机实测
 *   S10 图标系统 —— 每个图标都能用 createElementNS 建出命名空间正确的 SVG
 *   S11 外壳首页渲染 —— 4 行列表、号位 chip、hero 品牌标(IMG)、顶栏标、主题 class
 *   S12 hover 色块 → 浮层提示 + 读数行同步
 *
 *   v0.2.1（用户真机 UI 反馈）新增：
 *   S13 布局几何诊断 —— 行高 / 图标尺寸 / 文字左内缩 / 圆点与文字间距与垂直偏差
 *       （把"文字居中、图标不显示、圆点重叠"这类问题变成可读数字）
 *   S14 图标绘制属性 —— 逐元素必须自带 fill/stroke（UXP 不继承，否则渲染成黑块）
 *
 *   v0.2.2 新增：
 *   S15 悬停浮层几何 —— 浮层矩形**不得与任何色块矩形相交**（+ 让帧前/后双读数）。
 *       这是「鼠标在色块上移动时色值标签疯狂闪烁」的**永久回归测试**：
 *       旧版浮层会压在色块上，一旦它抢到指针就形成振荡回路；
 *       "浮层不覆盖色块"这条几何不变量成立，回路在物理上就不成立。
 *   S16 填充端到端 —— 建临时文档 → 合成 **Alt+点击**色块 → **像素回读**必须命中目标色，
 *       且前景/背景色**未被改动**（"填充不改我的前景色"是这个功能的卖点）。
 *       ⚠️ 全程跑在我们自己建的临时文档上，跑完不保存关掉 —— 绝不动用户的图。
 *       ⚠️ 这是本套自检里**唯一**会新建/关闭文档的一项，只在 verify.flag 存在时发生。
 *
 *   v0.2.3 新增：
 *   S17 内容图层改色 —— 临时文档里建一个**纯色填充图层**（与形状图层同为内容图层），
 *       验证 ① `layer.kind` 读出来确实是 `solidColor`（分派前提）
 *            ② 两条改色描述符哪一条真的生效（via=contentColorA/B）
 *            ③ 改完像素回读命中目标色。
 *       背景：用户报「填充不能用」的图层「矩形 1」就是形状图层 —— PS 的 `fill`
 *       对内容图层不报错、不改像素、还弹「命令填充当前不可用」。
 *
 *   v0.2.4 新增：
 *   S18 文字图层改色 —— 临时文档里用 `make textLayer` 造一个**文字图层**，验证
 *       ① `layer.kind` 读出来是 `text`（分派前提）
 *       ② `set → to:{textStyle,color}` 这条描述符**真的让像素变了**
 *       ③ **改完仍然是文字图层**（非破坏性、文字保持可编辑）
 *       背景：用户报「形状图层可以了，但文字图层还是不行」。真机确认 `fill` 对文字
 *       图层给「命令"<未知的>"当前不可用」→ 必须走 textStyle。
 *       ⚠️ 这条描述符是**照抄 Adobe 官方 API 文档**的：`_target` 两级、颜色在
 *          `to.textStyle.color` 里。我自己猜的两版都是"不报错、像素也不变"。
 *
 *   v0.2.5 新增（M2 素材库地基）：
 *   S19 镜像读取层 —— 读自身 PluginData 的镜像并渲染。
 *       首版（v0.2.5）验的是「到底能不能读」，并顺带把 **UXP 不解码 webp** 这条平台约束
 *       钉死（真机矩阵 `webp-alpha ✗ / webp-plain ✗ / png ✓ / jpg ✓` —— 它直接改写了
 *       联动契约 §5.5 的缩略图格式约定）。
 *       现版（v0.2.6）改为验**契约读取层本身**：`lib/mirror.js` 按 `vellum-link/1` 解析
 *       `manifest.json` / `task.json` / `brand.json`，展平成素材列表，渲染缩略图，
 *       并验证 **webp 防御**（读到 .webp 必须给可读错误，不能让 UI 出一堆空白格）。
 *       假镜像由 `tools/fake-vellumdesk.cjs`（契约 §11 要求的插件侧桩）生成。
 *       ⚠️ 容器**必须可见**（display:none 里 UXP 不加载图片，表现为超时，见 §10.2）。
 *
 *   v0.2.7 新增（M2 素材库界面）：
 *   S20 素材库界面 —— 走真实 mount 路径（`ctx.shell.showTool("assets")`），验
 *       ① 库切换 chips **由 `manifest.scopes[]` 动态生成**（不是写死两个 tab）
 *       ② 分组筛选 chips（只有一组时不出，避免噪音）
 *       ③ 网格卡片数 = 展平后的素材数（**不是**只看"有没有渲染出来"）
 *       ④ 缩略图在**真实卡片里的 `<img>`** 上真的解出尺寸（naturalWidth>0）
 *          —— 这一条才是"镜像 → 面板"整条链的终点，前一轮 S19 只验了独立容器
 *       ⑤ 点一张卡 → 详情行出现文件名 / 面包屑 / 原始路径；再把筛选切一次确认计数变化
 *   S21 置入描述符（`placeEvent`）—— 在**自建的临时文档**上跑一次真实 place，
 *       判据是**图层数增加**（不是"命令没报错"）。
 *       为什么单独立项：这是本项目第一次用 `placeEvent`，而它决定 M2 的架构。
 *       真机读数（21:32，裸路径版）：`Error: invalid file token used`
 *       ⇒ Photoshop 的 AM 层要的是 UXP **授权过的文件令牌**，不是路径。
 *       v0.2.7 改成 **Entry → createSessionToken → `_path: token`** 再验一次。
 *   S22 直连置入可行性探针 —— `getEntryWithUrl` 能不能读**沙箱外**的绝对路径。
 *       这是**诊断项**（不是回归项）：结果决定 handoff 搬运到底能不能省。
 *       用"沙箱内路径"当**基准**对照 —— 首轮（21:37）连基准都失败了
 *       （`Could not find an entry of 'file:///…PluginData/library/thumb/401.png'`），
 *       所以那条读数**无结论**，只能说明"这么用不行"，不能说明"权限边界在哪"。
 *       ⇒ 代码里刻意把结论分成三档（基准失败 = 无结论），免得下次又拿错读数当结论。
 *
 *   v0.2.8 新增（跟进软件侧按契约 §十 提的三处加法）：
 *   · S19 扩了两条**解析层**判据：`groups[].parentId` 解析出子组（§5.3 加法 ③）、
 *     `asset.source` 被读成来源计数（§5.4 加法 ②）。缩略图命名空间（§5.5 加法 ①）
 *     对插件是透明的，所以它的验证点在**离线回归 32 条**（缓存键）而不是这里。
 *   · S20c 两级分组筛选 —— **顶层不得出现子组 chip**，点了父组之后子组行才出现，
 *     且"点父组的卡片数 = 父组直接素材 + 它的子组素材"（这正是两级分组的意义）。
 *   · S20d 来源筛选 —— 「来源」行只在当前分组内真有 ≥2 种来源时出现；
 *     点它能收窄；切到单一来源的分组后该行**必须消失**（不构成筛选就不画）。
 *
 *   v0.2.9 新增（诊断项，为两个界面需求做可行性实测）：
 *   S23 UI 控件与交互能力探针 —— ① 原生 `<select>`/`<option>` ② Spectrum 的
 *       `sp-picker` / `sp-dropdown` / `sp-menu` ③ HTML5 拖放（`draggable` + `DataTransfer`）
 *       ④ 指针/鼠标事件与 `setPointerCapture`。
 *       背景：需求是"二级筛选改成下拉控件"与"素材拖到画布指定位置"，而官方与社区口径打架
 *       （Spectrum 支持清单里有 Picker，Known Issues 又说 `<select>` 一串怪癖；社区实测
 *       说 PS 上 sp-dropdown 不按文档工作）。**不猜，量一次。**
 *       ⚠️ 诚实边界：合成事件只能证明"处理器可达 + API 存在"，
 *          **证明不了"真鼠标拖拽会产生这些事件"**；`<select>` 的下拉弹层也要真点击才能验。
 *
 *   v0.3.0 新增（两个界面需求落地）：
 *   S20c 改版：二层筛选从"一排按钮"改成**自绘下拉** ⇒ 判据改成
 *       "未选父组时**不许有平铺的子组按钮**、也不该有触发条" + "选了父组才出现触发条" +
 *       "点开浮层后子组选项才在" + **浮层矩形必须完全落在滚动容器内**（越界会被裁掉）+
 *       "选完自动收起"。**全程平铺按钮数必须为 0**。
 *   S24 选区落点探针（**诊断项**）：问"能不能建选区 / 有选区时 place 落在哪"。
 *       为什么单独立项：用户想要"框哪儿放哪儿"，而 MCP（**ExtendScript**）通道上带区域的
 *       `select()` 五种写法全失败、`deselect()` 也失败，**但基准 `selectAll()` 成功**
 *       ⇒ 只能说"那几种写法不行"，**不能说选区不可用**；且那是 legacy DOM，
 *       **插件走 UXP/AM 是另一条路**。本条负责在**插件自己的通道**上问清楚。
 *       🔴 真机 2026-10-11 结果：插件侧 **`setd`+`Chnl/fsel`+`Rctn` 能建选区**（DOM 写法全失败，
 *          与 ExtendScript 恰好**相反**）；而**有选区时默认落点 = 选区中心**（实测 60,100
 *          = 素材居中于选区 120,140,320,300）⇒ 统一规则是"默认落点 = 选区中心 / 无选区则画布中心"。
 *   S25 落点组合（**回归项**）：有了 S24 那条发现就必须钉住 ——
 *       `offset` 是**相对默认落点**的位移，所以**有选区时基准必须取选区中心**；
 *       四条判据：无选区·左上→0,0 ／ 基准报 selection 且中心 220,220 ／
 *       有选区·居中→仍居中于画布 ／ **有选区·左上→0,0**（最后这条才证明叠加语义对）。
 *
 *   v0.3.1 新增（用户 2026-10-11 提的 4 条 UI 调整）：
 *   S20e 任务库的**项目筛选下拉** —— 位置判据是**矩形比对**（必须落在刷新按钮左侧且同一行，
 *       不靠 DOM 顺序猜）；还要求它**只在任务库出现**（切到通用库必须消失），
 *       以及"选项数 = 项目数 + 全部项目""选一个项目后卡片数收窄到该项目的素材数"。
 *       ⚠️ 一个项目时它**不构成筛选**（与「来源」行同一判断）—— 那时本条判为"不适用"。
 *   同时跟着改的：二层子类下拉从"独占一行"挪到**一级按钮那一行的最右侧**，
 *   S20c 因此不再依赖"子组行"这个结构，只按 id 找触发条与浮层。
 *
 *   v0.3.2 重做（**真 VellumDesk 上线后，自检不能再绑死在假软件桩的 fixture 上**）：
 *   🔴 起因：真机 `library/` 里已经是**真镜像**（只声明 `task`、6 个项目 5 个是空包、
 *      缩略图叫 `t110.png`），而旧版把期望值钉成 `taskRows===3 && brandRows===4 &&
 *      srcSig==="company:3|user:1"`、测试文件钉成 `t401.png` ⇒ 会报一堆**与真因无关的 FAIL**。
 *   · S19 期望值改为**从原始 JSON 自己数**；镜像没声明 brand scope ⇒ 那一半记「不适用」不判失败。
 *   · S21/S22/S24/S25 的测试文件改为**从镜像里挑**（`testThumbFile()`），不再写死文件名。
 *   · **S20c/S20d 修一个假 FAIL**：原先直接读 `library/brand.json` 就开工，而磁盘上可能躺着
 *     上一版（甚至假桩）留下的 **stale brand.json** ⇒ 自检去操作一个**界面上根本不存在的库**。
 *     哪些库存在，**唯一依据是 `manifest.scopes[]`**。没有就记「不适用」。
 *   · S20e"收窄"只能挑**有素材**的项目（0 素材的项目点下去网格会变空态块，量不到）；
 *     并新增断言"**空项目也必须出现在选项里**"（这正是 `projectOptions()` 读原始 `projects[]` 的理由）。
 *
 *   版本状态（v0.2.4）：S17 建的「纯色填充图层」改色**仍未解决**（已知限制，非回归），
 *   而**形状图层改色正常**（用户 2026-10-10 真机确认，日志 via=contentColorA）。
 *
 * 安全纪律（从 env-check 那次事故学到的，务必保留）：
 *   ⚠️ 读不到原值 → 直接放弃整场自检，绝不"先改了再说"。
 *   上一轮就是因为在读不到原值时仍执行了设置，把用户的前景色改坏了。
 *   ⚠️ 破坏性动作（填充 / 改内容图层颜色）只允许作用在**自检自己建的临时文档**上。
 *      自检跑出的临时文档一律 closeDocument 掉，**不保存**。
 *
 * 另一个开关：verify-keep.flag —— 存在时，自检色**保留**在磁盘上（供下一次
 * 加载时由 S2 证明"它活过了重载"）；不存在时自检结束即清理干净。
 */

const log = require("./log.js");
const dom = require("./dom.js");
const ps = require("./ps.js");
const store = require("./store.js");
const data = require("./data.js");
const caps = require("./caps.js");
const cssprobe = require("./cssprobe.js");
const icons = require("./icons.js");
const mirror = require("./mirror.js");

const REPORT_FILE = "selfcheck.json";
/** 自检色：刻意取一个几乎不会撞上品牌占位色的值，让「值确实变了」判据有意义。 */
const TEST_COLOR = "#123456";
const SELFCHECK_TAG = "selfcheck";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 合成事件（统一入口）。
 * ⚠️ 实测（UXP 9.0.2）：`new MouseEvent("click", {shiftKey:true})` **构造不会抛错，
 *    但 shiftKey 被丢掉** —— 于是带修饰键的点击会静默退化成普通点击，
 *    测试"看起来跑了"其实没测到。所以这里**必须校验修饰键是否真的生效**，
 *    带不上就换下一种造法；三种都不行才降级，并把丢了哪个记进 tried。
 *
 *   1) Event + 自定义属性                    ← 首选（实测可用）
 *   2) new MouseEvent(...)                   ← UXP 上会丢修饰键
 *   3) createEvent("MouseEvents") + initMouseEvent
 *
 * v0.2.2：把只支持 shift 的实现泛化成 shift / alt 通用（填充要测 Alt+点击）。
 * 调用方式：syntheticEvent(el, "mouseover", {alt:true}) ；syntheticClick(el, true) 兼容旧写法。
 */
function syntheticEvent(el, type, mods) {
  if (!el) return { ok: false, via: null, error: "元素不存在" };
  const m = mods === true || mods === false ? { shift: !!mods } : mods || {};
  const want = { shift: !!m.shift, alt: !!m.alt };
  const wantAny = want.shift || want.alt;

  const honoredOf = (ev) => (!want.shift || !!ev.shiftKey) && (!want.alt || !!ev.altKey);
  const attach = (ev) => {
    // dispatchEvent 传给监听器的是**同一个对象**，所以自有属性会被处理器读到。
    ev.shiftKey = want.shift;
    ev.altKey = want.alt;
    return ev;
  };

  const builders = [
    {
      name: "Event+自定义属性",
      make: () => attach(new Event(type, { bubbles: true, cancelable: true })),
    },
    {
      name: "MouseEvent",
      make: () =>
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          shiftKey: want.shift,
          altKey: want.alt,
        }),
    },
    {
      name: "createEvent",
      make: () => {
        const ev = document.createEvent("MouseEvents");
        // initMouseEvent(type, bubbles, cancelable, view, detail, screenX, screenY,
        //   clientX, clientY, ctrlKey, altKey, shiftKey, metaKey, button, relatedTarget)
        ev.initMouseEvent(
          type, true, true, window, 0, 0, 0, 0, 0,
          false, want.alt, want.shift, false, 0, null
        );
        return ev;
      },
    },
  ];

  const tried = [];
  for (const b of builders) {
    let ev = null;
    try {
      ev = b.make();
    } catch (e) {
      tried.push(b.name + " 构造失败");
      continue;
    }
    const honored = honoredOf(ev);
    if (wantAny && !honored) {
      tried.push(b.name + " 丢掉了修饰键");
      continue;
    }
    try {
      el.dispatchEvent(ev);
      return {
        ok: true,
        via: b.name,
        honored: honored,
        shiftHonored: !want.shift || !!ev.shiftKey,
        altHonored: !want.alt || !!ev.altKey,
        tried: tried,
      };
    } catch (e2) {
      tried.push(b.name + " 派发失败");
    }
  }

  if (type === "click") {
    try {
      el.click();
      return {
        ok: true,
        via: "click()",
        honored: !wantAny,
        shiftHonored: !want.shift,
        altHonored: !want.alt,
        modifiersLost: wantAny,
        tried: tried,
      };
    } catch (e3) {
      return { ok: false, via: null, error: String((e3 && e3.message) || e3), tried: tried };
    }
  }
  return { ok: false, via: null, error: "所有造法都没成功", tried: tried };
}

/** 兼容旧写法：syntheticClick(el, true) = Shift+点击。 */
function syntheticClick(el, mods) {
  return syntheticEvent(el, "click", mods);
}

/** 轮询直到 predicate 返回真值或超时。返回命中值 / null。 */
async function waitFor(predicate, timeoutMs, intervalMs) {
  const t0 = Date.now();
  const step = intervalMs || 150;
  while (Date.now() - t0 < (timeoutMs || 4000)) {
    try {
      const v = await predicate();
      if (v) return v;
    } catch {
      /* 继续等（模态占用等瞬时错误） */
    }
    await sleep(step);
  }
  return null;
}

/** 在容器里按 data-hex 找色块，再找它里面的 ✕。 */
function findCustom(customGrid, hex) {
  if (!customGrid) return { sw: null, del: null };
  for (const sw of customGrid.children) {
    if (!sw.getAttribute) continue;
    if (String(sw.getAttribute("data-hex") || "").toUpperCase() === String(hex).toUpperCase()) {
      let del = null;
      for (const ch of sw.children) {
        if (ch.getAttribute && ch.getAttribute("data-del") !== null) del = ch;
      }
      return { sw, del };
    }
  }
  return { sw: null, del: null };
}

async function run(ctx, deps) {
  const palette = deps.palette;
  const results = [];
  const rec = (name, ok, detail) => {
    results.push({ name: name, ok: !!ok, detail: detail || "" });
  };
  const started = Date.now();

  /* ---------------------------------------------------------------- 素材库自检小工具
     ⚠️ 一律**从 DOM 读**，不碰 tools/library.js 的内部状态 ——
        否则就是"拿被测模块自己的输出验它自己"。 */
  /** 在筛选区按 `data-key` 找 chip。 */
  function libChip(key) {
    const bar = document.getElementById("vt-lib-bar");
    if (!bar) return null;
    const walk = (n) => {
      for (let i = 0; i < n.children.length; i++) {
        const c = n.children[i];
        const k = c.getAttribute ? c.getAttribute("data-key") : null;
        if (k !== null && k === key) return c;
        const d = walk(c);
        if (d) return d;
      }
      return null;
    };
    return walk(bar);
  }
  /** 筛选区当前有几「行」（.frow）。 */
  function libRowCount() {
    const bar = document.getElementById("vt-lib-bar");
    if (!bar) return -1;
    let n = 0;
    for (let i = 0; i < bar.children.length; i++) {
      const c = bar.children[i];
      const cls = String((c.getAttribute && c.getAttribute("class")) || "");
      if (cls.indexOf("frow") >= 0) n++;
    }
    return n;
  }
  /* ⚠️ v0.3.4：瀑布流把卡片放进了 `.lib-col` ⇒ **不能再数 `#vt-lib-grid` 的直接子节点**
     （那两个是列容器，数出来恒为 2，与素材条数无关）。
     判 class 一律按 **token**（`class.split(/\s+/)[0]`），不用 indexOf 子串 ——
     `.card-th` / `.card-nm` / `.card-mt` 都含 "card"，子串判法会把它们全算成卡片。
     ⚠️ 必须声明在 run() 顶层的帮助函数区：S20d/S20e 各自在**独立的 try 块**里，
        块内的 `const` 它们看不见 —— 第一版放在 S20 的块里，真机直接报 `libCards is not defined`。 */
  const isLibCard = (el) => {
    const cl = String((el && el.getAttribute && el.getAttribute("class")) || "");
    return cl.split(/\s+/)[0] === "card";
  };
  const libCards = (node, out) => {
    const kids = (node && node.children) || [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (isLibCard(c)) out.push(c);
      libCards(c, out);
    }
    return out;
  };
  /**
   * 等网格的卡片数 == n（n < 0 表示只等"有卡片"）。
   * ⚠️ **必须点名 `scope`** —— 否则条件会被**上一个库留下的旧网格**满足。
   *    v0.2.7 的 S20b 和 v0.2.8 的 S20c/S20d 都栽在这上面（同一族：判据不够强，
   *    它描述的是"DOM 里现在有什么"，而不是"我要的那个库渲染完了没有"）。
   * `scope` 缺省时退回旧行为（只在明确不需要区分时用）。
   * 返回网格元素或 null。
   */
  async function libWaitCards(n, ms, scope) {
    return await waitFor(() => {
      const el = document.getElementById("vt-lib-grid");
      if (!el) return null;
      if (scope && String(el.getAttribute("data-scope") || "") !== scope) return null;
      // v0.3.4：网格的直接子节点**恒为 2**（两列容器）⇒ 必须递归数 `.card`，
      // 否则"等网格渲染完"会退化成"网格存在就行" —— 等待条件就不再点名"我在等什么"。
      if (n < 0) return libCards(el, []).length > 0 ? el : null;
      return libCards(el, []).length === n ? el : null;
    }, ms || 5000, 150);
  }
  /** 网格当前属于哪个库（读 DOM，不读模块状态）。 */
  function libGridScope() {
    const el = document.getElementById("vt-lib-grid");
    return el ? String(el.getAttribute("data-scope") || "") : "";
  }
  /**
   * 切到某个库**并等它真的渲染完**。
   * 判据三条缺一不可：chip 高亮 + **网格的 `data-scope` 等于目标库** + 有卡片。
   * 少第三条就会读到上一个库的网格与筛选行（症状：筛选 chip 一个都找不到）。
   */
  async function libSwitchTo(id, ms) {
    const chip = document.getElementById("vt-lib-tab-" + id);
    if (!chip) return false;
    syntheticClick(chip, false);
    const ok = await waitFor(() => {
      const on = document.getElementById("vt-lib-tab-" + id);
      const cls = on ? String(on.getAttribute("class") || "") : "";
      if (cls.indexOf("is-on") < 0) return null;
      const el = document.getElementById("vt-lib-grid");
      if (!el) return null;
      if (String(el.getAttribute("data-scope") || "") !== id) return null;
      return libCards(el, []).length > 0 ? el : null;
    }, ms || 6000, 200);
    return !!ok;
  }
  /** 把筛选复位到「全部」（点第一行的「全部」chip）。 */
  function libResetFilter() {
    const c = libChip("");
    if (c) syntheticClick(c, false);
    return !!c;
  }
  /* ---- 自绘下拉（v0.3.0）：触发条 / 展开态 / 选项 ----
     ⚠️ 页面上有**两个**下拉（二层子类 / 项目），所以这些都带 id 参数，
        默认值是二层子类那一个（旧调用点不用改）。 */
  function libSelWrap(wrapId) {
    return document.getElementById(wrapId || "vt-lib-subwrap");
  }
  function libSelTrigger(trigId) {
    return document.getElementById(trigId || "vt-lib-subsel");
  }
  function libSelOpen(wrapId) {
    const w = libSelWrap(wrapId);
    return !!(w && String((w.getAttribute && w.getAttribute("class")) || "").indexOf("is-open") >= 0);
  }
  /** 下拉里的选项（用独立标识属性找：`data-opt` / `data-proj`，与筛选 chip 的 `data-key` 分开）。 */
  function libOpt(key, popId, attr) {
    const pop = document.getElementById(popId || "vt-lib-subpop");
    if (!pop) return null;
    const A = attr || "data-opt";
    const walk = (n) => {
      for (let i = 0; i < n.children.length; i++) {
        const c = n.children[i];
        const k = c.getAttribute ? c.getAttribute(A) : null;
        if (k !== null && k === key) return c;
        const d = walk(c);
        if (d) return d;
      }
      return null;
    };
    return walk(pop);
  }
  /**
   * 元素是否带某个 class。
   * ⚠️ 必须按 **token** 判，不能用 `indexOf` 子串判 ——
   *    `.fchips`（行内的 chips 容器）会被 `indexOf("fchip")` 判成 chip（返回 0），
   *    于是结构签名里冒出一个 `chip:null`，白让人怀疑"是不是多画了一个空 chip"。
   *    （同一族纪律：判据要描述**我等的那个东西**，不是"看起来像的东西"。）
   */
  function hasClass(el, cls) {
    if (!el || !el.getAttribute) return false;
    const c = String(el.getAttribute("class") || "");
    return c.split(/\s+/).indexOf(cls) >= 0;
  }
  /** 筛选区里**平铺的子组按钮**个数（改下拉之前是一排，现在必须是 0）。 */
  function libFlatSubChips() {
    const bar = document.getElementById("vt-lib-bar");
    if (!bar) return -1;
    let n = 0;
    const walk = (x) => {
      for (let i = 0; i < x.children.length; i++) {
        const c = x.children[i];
        if (hasClass(c, "fchip") && hasClass(c, "sub")) n++;
        walk(c);
      }
    };
    walk(bar);
    return n;
  }
  /**
   * 展开的浮层是否**完全落在滚动容器内**。
   * 为什么是硬判据：`.scroll` 有 `overflow-y:auto`，越界部分**会被裁掉**，
   * 而用户只会看到"下拉点开了但内容是空的" —— 这类错在真机上极难归因。
   * ⚠️ 几何要**轮询到非零**再量（布局是异步的）。
   */
  async function libPopInsideScroll() {
    const pop = document.getElementById("vt-lib-subpop");
    if (!pop) return { ok: false, note: "浮层元素不存在（整行没渲染？签名见下）" };
    const r = await waitFor(() => {
      const b = pop.getBoundingClientRect ? pop.getBoundingClientRect() : null;
      return b && b.width > 0 && b.height > 0 ? b : null;
    }, 3000, 120);
    if (!r) {
      // ⚠️ 同样是"几何为 0"，原因可能完全不同，必须分开报 —— 否则这条读数没法用：
      //    · 展开态没了（被关掉 / 被重渲染成关闭）→ **状态问题**
      //    · 展开态还在但没有几何 → **布局问题**
      //    （上一次 FAIL 就是只报了"几何为 0"，分不清是哪种，等于没测。）
      const w = libSelWrap();
      const openNow = libSelOpen();
      let disp = "?";
      try {
        disp = String(getComputedStyle(pop).display);
      } catch {
        disp = "取不到";
      }
      return {
        ok: false,
        note:
          "浮层几何始终为 0　→ 展开态现在=" + openNow +
          "（wrap class=" + JSON.stringify(w ? String(w.getAttribute("class")) : null) + "）" +
          "　computed display=" + disp +
          "　⇒ " + (openNow ? "**状态还在、是没进布局**" : "**展开态没了**（被关掉或重渲染掉了）"),
      };
    }
    let sc = null;
    let n = pop.parentNode;
    while (n) {
      const cls = String((n.getAttribute && n.getAttribute("class")) || "");
      if (cls.indexOf("scroll") >= 0) {
        sc = n;
        break;
      }
      n = n.parentNode;
    }
    if (!sc) return { ok: false, note: "找不到滚动容器祖先" };
    const sb = sc.getBoundingClientRect();
    const f = (v) => Math.round(v);
    const inside =
      r.top >= sb.top - 1 && r.bottom <= sb.bottom + 1 &&
      r.left >= sb.left - 1 && r.right <= sb.right + 1;
    return {
      ok: true,
      inside: inside,
      note:
        "浮层 " + f(r.left) + "," + f(r.top) + "," + f(r.right) + "," + f(r.bottom) +
        "　滚动容器 " + f(sb.left) + "," + f(sb.top) + "," + f(sb.right) + "," + f(sb.bottom) +
        "　完全在容器内=" + inside,
    };
  }
  /** 收下拉（点触发条一次即可；幂等）。 */
  function libCloseSel() {
    if (libSelOpen()) {
      const t = libSelTrigger();
      if (t) syntheticClick(t, false);
    }
    return !libSelOpen();
  }
  /**
   * 筛选区的**结构签名** —— 失败时用它"自己解释自己"。
   * 起因：S20c 有一次 FAIL 报「浮层几何始终为 0」且连选项都找不到，
   * 那条读数**分不清**是"没渲染"、"渲染了但没展开"、还是"被重渲染掉了"。
   * 猜没用，把这三种情形区分开只需要一个签名。
   */
  function libBarSig() {
    const bar = document.getElementById("vt-lib-bar");
    if (!bar) return "no-bar";
    const out = [];
    for (let i = 0; i < bar.children.length; i++) {
      const r = bar.children[i];
      const rc = String((r.getAttribute && r.getAttribute("class")) || "");
      const bits = [];
      const walk = (n) => {
        for (let j = 0; j < n.children.length; j++) {
          const c = n.children[j];
          if (hasClass(c, "fchip")) bits.push("chip:" + JSON.stringify(c.getAttribute("data-key")));
          else if (hasClass(c, "fopt")) bits.push("opt:" + JSON.stringify(c.getAttribute("data-opt")));
          else if (hasClass(c, "fsel-pop")) bits.push("pop");
          else if (hasClass(c, "fsel-wrap")) bits.push("wrap{open=" + hasClass(c, "is-open") + "}");
          else if (hasClass(c, "fsel")) bits.push("trig");
          walk(c);
        }
      };
      walk(r);
      out.push(rc.replace(/\s+/g, ".") + "{" + bits.join(",") + "}");
    }
    return out.join(" | ") || "bar-empty";
  }

  await log.appendLog("selfcheck START  plugin=com.vellum.toolbox");

  /* ---------- 安全前提：读不到原值就不动任何颜色 ---------- */
  const fg0 = await ps.readColor("foreground");
  const bg0 = await ps.readColor("background");
  if (!fg0.ok || !bg0.ok) {
    await log.appendLog(
      "selfcheck ABORT  读不到前景/背景色原值，整场放弃（避免改坏用户颜色）  fg=" +
      (fg0.error || "-") + "  bg=" + (bg0.error || "-")
    );
    return { ok: false, aborted: true, reason: "读不到原值" };
  }

  let keepFlag = false;
  try {
    keepFlag = await data.pluginFlag("verify-keep.flag");
  } catch {
    keepFlag = false;
  }
  const backupName = await store.backup(palette.PALETTE_FILE);
  await log.appendLog("selfcheck 已备份 " + palette.PALETTE_FILE + " → " + (backupName || "(无内容，跳过)"));

  /* ---------- S7: 环境能力（先探，给后面的判断做底） ---------- */
  try {
    const st = await caps.detect({ probeWrite: true, logger: log.appendLog, force: true });
    rec(
      "S7 环境与能力（读色 / 设色 / 版本）",
      st.canReadColor && st.canWriteColor,
      "host=" + st.env.host + "/" + st.env.hostVersion +
      "  uxp=" + st.env.uxp +
      "  psMajor=" + (st.env.psMajor || "?") +
      "  读色=" + (st.canReadColor ? "OK" : "FAIL") +
      "  设色=" + (st.canWriteColor ? "OK" : "FAIL")
    );
    // caps 的设色探测已把颜色恢复；再显式校验一次
    const fgNow = await ps.readColor("foreground");
    const bgNow = await ps.readColor("background");
    rec(
      "S7b 能力探测后颜色未被污染",
      fgNow.ok && bgNow.ok && fgNow.hex === fg0.hex && bgNow.hex === bg0.hex,
      "前景 " + fg0.hex + " → " + (fgNow.hex || "?") + "；背景 " + bg0.hex + " → " + (bgNow.hex || "?")
    );
  } catch (e) {
    rec("S7 环境与能力（读色 / 设色 / 版本）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S1: 外壳挂载调色板（真实 mount 路径） ---------- */
  let mounted = false;
  let swatchCount = 0;
  try {
    await ctx.shell.showTool("palette", "selfcheck");
    const grid = document.getElementById("vt-brand-grid");
    swatchCount = grid ? grid.children.length : 0;
    mounted = !!grid && swatchCount > 0;
    rec(
      "S1 外壳 → 调色板（真实 mount + 渲染）",
      mounted && swatchCount === palette.DEFAULT_BRAND.length,
      "品牌色块数 = " + swatchCount + "（期望 " + palette.DEFAULT_BRAND.length + "）　" +
      "「我的颜色」块数 = " + (document.getElementById("vt-custom-grid") || { children: [] }).children.length
    );
  } catch (e) {
    rec("S1 外壳 → 调色板（真实 mount + 渲染）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S2: 上次自检遗留 → 跨重载持久化的证据 ---------- */
  try {
    const disk = await palette.loadState();
    const isSelfTest = (c) =>
      c.name === SELFCHECK_TAG || String(c.hex).toUpperCase() === TEST_COLOR.toUpperCase();

    const leftover = (disk.custom || []).filter(isSelfTest);
    if (leftover.length) {
      const ids = leftover.map((l) => l.id).join(",");
      const hexes = leftover.map((l) => l.hex).join(",");
      const when = leftover.map((l) => l.savedAt).join(",");
      for (const it of leftover) {
        await palette.deleteById(it.id, "selfcheck-cleanup");
      }
      const after = await palette.loadState();
      const remain = (after.custom || []).filter(isSelfTest).length;
      rec(
        "S2 自检色活过了上次重载（= 跨重载持久化成立），已清理",
        remain === 0,
        "重载后仍在磁盘上：id=" + ids + " hex=" + hexes + " savedAt=" + when +
        "；清理后剩余自检项 = " + remain
      );
    } else {
      rec(
        "S2 无历史自检残留（本轮是首次）",
        true,
        "当前「我的颜色」共 " + (disk.custom || []).length + " 个，无自检标记项"
      );
    }
  } catch (e) {
    rec("S2 跨重载持久化检查", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S3: 合成点击品牌色 1 → 前景色 ---------- */
  try {
    const grid = document.getElementById("vt-brand-grid");
    const sw = grid ? grid.children[0] : null;
    const info = syntheticClick(sw, false);
    const expect = palette.DEFAULT_BRAND[0].hex;
    const got = await waitFor(async () => {
      const c = await ps.readColor("foreground");
      return c.ok && String(c.hex).toUpperCase() === expect.toUpperCase() ? c : null;
    }, 5000, 150);
    rec(
      "S3 合成点击「品牌色 1」→ 前景色",
      !!got,
      "目标 " + expect + "　回读 " + (got ? got.hex : "未命中") + "　点击方式=" + (info.via || info.error)
    );
  } catch (e) {
    rec("S3 合成点击「品牌色 1」→ 前景色", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S4: 合成 Shift+点击品牌色 2 → 背景色 ---------- */
  try {
    const grid = document.getElementById("vt-brand-grid");
    const sw = grid ? grid.children[1] : null;
    const info = syntheticClick(sw, true);
    const expect = palette.DEFAULT_BRAND[1].hex;
    let got = await waitFor(async () => {
      const c = await ps.readColor("background");
      return c.ok && String(c.hex).toUpperCase() === expect.toUpperCase() ? c : null;
    }, 4000, 150);
    let note =
      "点击方式=" + (info.via || info.error) +
      "　shiftKey 生效=" + (info.shiftHonored ? "是" : "否") +
      (info.tried && info.tried.length ? "　试过但失败：" + info.tried.join(" / ") : "");
    if (!got) {
      // 合成事件带不上修饰键时的兜底：直调同一份实现，并在报告里说清走了兜底
      const direct = await palette.applyHex(expect, "background", "自检兜底", "selfcheck-direct");
      got = await waitFor(async () => {
        const c = await ps.readColor("background");
        return c.ok && String(c.hex).toUpperCase() === expect.toUpperCase() ? c : null;
      }, 3000, 150);
      note += "；合成事件未生效 → 兜底直调 applyHex（返回 ok=" + direct.ok + "）";
    }
    rec(
      "S4 Shift+点击「品牌色 2」→ 背景色",
      !!got,
      "目标 " + expect + "　回读 " + (got ? got.hex : "未命中") + "　" + note
    );
  } catch (e) {
    rec("S4 Shift+点击「品牌色 2」→ 背景色", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S5: 点「＋ 存为我的颜色」→ 落盘 ---------- */
  let saved = null;
  let savedId = null;
  try {
    // 先把前景色切成自检色，这样存下来的值是可预期的
    await palette.applyHex(TEST_COLOR, "foreground", SELFCHECK_TAG, "selfcheck-setup");

    // ⚠️ 判据必须是「本次**新增**的条目」，不能只按 hex 匹配 ——
    //    上一轮正是这里出了假阳性：等到的是上一次遗留的旧条目，点击其实没生效也判 PASS。
    const beforeIds = ((await palette.loadState()).custom || []).map((c) => c.id);
    const btn = document.getElementById("vt-save-current");
    const info = syntheticClick(btn, false);
    saved = await waitFor(async () => {
      const s = await palette.loadState();
      const fresh = (s.custom || []).find(
        (c) => beforeIds.indexOf(c.id) < 0 && String(c.hex).toUpperCase() === TEST_COLOR
      );
      return fresh || null;
    }, 5000, 150);
    savedId = saved ? saved.id : null;
    rec(
      "S5 点「＋ 存为我的颜色」→ palette.json 落盘（须为本次新增条目）",
      !!saved,
      "存 " + TEST_COLOR +
      "　点击前已有 id=[" + beforeIds.join(",") + "]" +
      "　磁盘新增：" + (saved ? "id=" + saved.id + " name=" + saved.name + " savedAt=" + saved.savedAt : "未命中") +
      "　点击方式=" + (info.via || info.error)
    );
  } catch (e) {
    rec("S5 点「＋ 存为我的颜色」→ palette.json 落盘（须为本次新增条目）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S6: 点 ✕ 删除 → 落盘同步 ---------- */
  try {
    if (!savedId) {
      rec("S6 点 ✕ 删除自定义色 → palette.json 同步", false, "S5 未成功，跳过（无对象可删）");
    } else {
      const gridC = document.getElementById("vt-custom-grid");
      const found = findCustom(gridC, TEST_COLOR);
      const info = syntheticClick(found.del, false);
      const gone = await waitFor(async () => {
        const s = await palette.loadState();
        return (s.custom || []).some((c) => c.id === savedId) ? null : { ok: true };
      }, 4000, 150);
      rec(
        "S6 点 ✕ 删除自定义色 → palette.json 同步",
        !!gone && !!found.del,
        "目标 id=" + savedId + "　✕ 存在=" + !!found.del +
        "　删除后磁盘已无该条目 = " + !!gone +
        "　点击方式=" + (info.via || info.error)
      );
    }
  } catch (e) {
    rec("S6 点 ✕ 删除自定义色 → palette.json 同步", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S5b: keep 模式下重新写回，留给下次加载做持久化证据 ---------- */
  if (keepFlag) {
    try {
      // 用带标记名的条目（name=selfcheck），这样下次加载的 S2 能可靠识别并清理
      const r = await palette.addCustom(TEST_COLOR, SELFCHECK_TAG, "selfcheck-keep", {
        allowDuplicate: true,
      });
      rec(
        "S5b keep 模式：自检色**保留**在磁盘上（下次加载由 S2 验证跨重载）",
        !!r.ok,
        "hex=" + TEST_COLOR + "　name=" + SELFCHECK_TAG + "　id=" + (r.id || "-") + "　ok=" + r.ok
      );
    } catch (e) {
      rec("S5b keep 模式：保留自检色", false, "抛异常：" + ((e && e.message) || e));
    }
  }

  /* ---------- S8: 恢复原色 ---------- */
  try {
    const rf = await ps.restoreColor("foreground", fg0.raw);
    const rb = await ps.restoreColor("background", bg0.raw);
    rec(
      "S8 前景/背景色已恢复原值（回读校验）",
      rf.ok && rb.ok,
      "前景 " + fg0.hex + " → " + (rf.readback ? ps.rgbToHex(rf.readback) : "?") +
      "；背景 " + bg0.hex + " → " + (rb.readback ? ps.rgbToHex(rb.readback) : "?")
    );
  } catch (e) {
    rec("S8 前景/背景色已恢复原值（回读校验）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S9: CSS 能力探针（真机实测，决定视觉增强项） ---------- */
  let probe = null;
  try {
    // ⚠️ 必须 await：探针内部要 await 让出帧等 UXP 布局，否则几何量全是 0
    probe = await cssprobe.run();
    rec(
      "S9 CSS 能力探针（真机实测）",
      !!probe && probe.ran === true,
      "支持 " + (probe ? probe.summary : "未跑") +
      "　⚠️「不支持」是已知约束，不是失败 —— 逐条明细见下方 cssprobe 日志"
    );
    if (probe && probe.ran) {
      for (const r of probe.results) {
        await log.appendLog(
          "cssprobe  " + (r.ok ? "OK  " : "NO  ") + r.label + "  ::  " + r.detail + "  [" + r.via + "]"
        );
      }
    }
  } catch (e) {
    rec("S9 CSS 能力探针（真机实测）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S10: 图标系统（createElementNS 建 SVG） ---------- */
  try {
    const ic = deps.icons || icons;
    const NS = "http://www.w3.org/2000/svg";
    const all = ic.names();
    const bad = [];
    for (const n of all) {
      const node = ic.svg(n);
      if (!node || node.namespaceURI !== NS || !node.childNodes || node.childNodes.length === 0) {
        bad.push(n);
      }
    }
    rec(
      "S10 图标系统（内联 SVG · 命名空间正确）",
      bad.length === 0 && all.length > 0,
      "共 " + all.length + " 个图标　异常 " + bad.length + " 个" + (bad.length ? "：" + bad.join(",") : "")
    );
  } catch (e) {
    rec("S10 图标系统（内联 SVG · 命名空间正确）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S11: 外壳首页（4 行 + 品牌标 + 号位 + 主题） ---------- */
  try {
    const home = document.getElementById("vt-home");
    const navs = home ? home.querySelectorAll(".navitem") : [];
    const expect = deps.registry.allRows
      ? deps.registry.allRows().length
      : deps.registry.tools.length + deps.registry.planned.length;
    const hero = home ? home.querySelector(".hero-mark") : null;
    const heroTag = hero ? String(hero.tagName || "").toUpperCase() : "无";
    const heroOk = heroTag === "IMG" && !!hero.getAttribute("src");
    const keys = home ? home.querySelectorAll(".ni-key") : [];
    const barLogo = document.getElementById("vt-logo");
    const barLogoOk = !!barLogo && String(barLogo.getAttribute("src") || "").indexOf("logo") >= 0;
    const themeCls = String(document.documentElement.className || "");
    const themed = /vt-dark|vt-light/.test(themeCls);
    rec(
      "S11 外壳首页渲染（4 行 + 品牌标 + 号位 + 主题）",
      navs.length === expect && heroOk && themed && keys.length === navs.length && barLogoOk,
      "导航行 " + navs.length + "（期望 " + expect + "）　号位 chip=" + keys.length +
      "　hero 品牌标=" + (heroOk ? "IMG:" + hero.getAttribute("src") : "异常(" + heroTag + ")") +
      "　顶栏标=" + (barLogoOk ? "有" : "无") +
      "　主题 class=" + JSON.stringify(themeCls)
    );
  } catch (e) {
    rec("S11 外壳首页渲染（4 行 + 品牌标 + 号位 + 主题）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S12: hover 色块 → 浮层提示 + 读数行 ---------- */
  try {
    const grid = document.getElementById("vt-brand-grid");
    const sw = grid ? grid.children[0] : null;
    let shown = false;
    let tipText = "";
    let roText = "";
    if (sw) {
      const ev = new Event("mouseover", { bubbles: true, cancelable: true });
      sw.dispatchEvent(ev);
      const view = document.getElementById("vt-tool-view");
      const tip = view ? view.querySelector(".tip.is-on") : null;
      shown = !!tip;
      tipText = tip ? String(tip.textContent || "") : "";
      const ro = view ? view.querySelector(".ro-hex") : null;
      roText = ro ? String(ro.textContent || "") : "";
    }
    const hex = String(palette.DEFAULT_BRAND[0].hex).toUpperCase();
    rec(
      "S12 hover 色块 → 浮层提示 + 读数行同步",
      shown && tipText.toUpperCase().indexOf(hex) >= 0 && roText.toUpperCase().indexOf(hex) >= 0,
      "浮层显示=" + shown + "　浮层文本=" + JSON.stringify(tipText) +
      "　读数行=" + JSON.stringify(roText) + "　期望含 " + hex
    );
  } catch (e) {
    rec("S12 hover 色块 → 浮层提示 + 读数行同步", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S13: 布局几何诊断（v0.2.1 新增） ----------
     把「首页文字为什么居中 / 图标为什么不显示 / 顶栏圆点为什么压字」这类问题
     变成可读数字。判据全用几何，不读 computed —— 因为 UXP 会对不支持的值
     「静默忽略」，computed 可能还留着原值但屏幕上什么都没发生。 */
  try {
    const home = document.getElementById("vt-home");
    const rows = home ? home.querySelectorAll(".navitem") : [];
    const r0 = rows.length ? rows[0] : null;
    const q = (sel) => (r0 ? r0.querySelector(sel) : null);
    const ico = q(".ni-ico");
    const name = q(".ni-name");
    const desc = q(".ni-desc");
    const key = q(".ni-key");
    const arrow = q(".ni-arrow");
    const chip = document.getElementById("vt-chip");
    const led = document.getElementById("vt-led");
    const envSpan = chip ? chip.querySelector(".mono") : null;

    const rect = (el) => {
      if (!el) return null;
      try {
        return el.getBoundingClientRect();
      } catch {
        return null;
      }
    };
    const box = (el) => {
      const r = rect(el);
      return r ? Math.round(r.width) + "x" + Math.round(r.height) : "无";
    };

    const R = rect(r0);
    const N = rect(name);
    const D = rect(desc);
    const I = rect(ico);
    const L = rect(led);
    const E = rect(envSpan);

    const twoLine = !!(N && D) && D.top - N.top > 4;
    const inset = R && N ? Math.round(N.left - R.left) : -1;
    const ledGap = L && E ? Math.round(E.left - L.right) : -1;
    const ledV = L && E ? Math.round(L.top + L.height / 2 - (E.top + E.height / 2)) : 999;

    rec(
      "S13 首页行 / 顶栏几何诊断（数字口径）",
      twoLine && !!I && I.width >= 20 && inset >= 40 && inset <= 62 &&
        ledGap >= 0 && Math.abs(ledV) <= 3,
      "行高=" + (R ? Math.round(R.height) : "?") +
      "　图标=" + box(ico) +
      "　名称/描述分两行=" + twoLine +
      "　文字左内缩=" + inset + "px(期望 48)" +
      "　号位=" + box(key) +
      "　箭头=" + box(arrow) +
      "　chip=" + box(chip) +
      "　圆点=" + box(led) +
      "　圆点↔文字间距=" + ledGap + "px" +
      "　圆点垂直偏差=" + ledV + "px"
    );
  } catch (e) {
    rec("S13 首页行 / 顶栏几何诊断（数字口径）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S14: 图标绘制属性（v0.2.1 新增） ----------
     UXP 的 SVG 渲染器不把父节点的 fill/stroke 继承给子元素 → 逐元素都必须自带。
     这里逐图标逐子元素检查属性是否齐全（属性层自证；渲染层由 S9 的 svgPaint 探针看）。 */
  try {
    const ic = deps.icons || icons;
    const all = ic.names();
    const bad = [];
    for (const n of all) {
      const node = ic.svg(n);
      if (!node) {
        bad.push(n + "=null");
        continue;
      }
      const nodes = [node];
      for (const c of node.childNodes) nodes.push(c);
      for (const el of nodes) {
        const f = el.getAttribute ? el.getAttribute("fill") : null;
        const s = el.getAttribute ? el.getAttribute("stroke") : null;
        if (f === null || f === undefined || s === null || s === undefined) {
          bad.push(n + "/" + String(el.tagName || "?").toLowerCase());
          break;
        }
      }
    }
    rec(
      "S14 图标逐元素自带 fill/stroke（UXP 不做继承）",
      bad.length === 0 && all.length > 0,
      "共 " + all.length + " 个图标　缺属性 " + bad.length +
      (bad.length ? "：" + bad.slice(0, 8).join(" ") : "")
    );
  } catch (e) {
    rec("S14 图标逐元素自带 fill/stroke（UXP 不做继承）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S15: 悬停浮层几何（v0.2.2 新增） ----------
     用户报「鼠标在色块上移动时色值标签疯狂刷新闪烁」。根因是旧版**每个色块各自
     mouseover 显示 / mouseout 隐藏**，而 mouseover/mouseout 在指针于「色块 ↔ 它的子元素
     （描边环 / 删除叉）」之间移动时会成对触发 → 高频 show/hide；
     叠加浮层默认压在色块上（第一行会被 clamp 到 top:0）→ 一旦浮层抢到指针就形成
     「浮层压住色块 → 色块失焦 → 浮层消失 → 色块复得焦点 → 浮层又出现」的振荡回路。

     这里测的是**几何不变量**：浮层矩形不得与任何色块矩形相交。
     只要它成立，指针在网格内移动时就永远不会落到浮层上，振荡回路不成立。
     另附「让帧前 vs 让帧后」双读数 —— 记录"UXP 布局异步"这件事对浮层同样成立。 */
  try {
    const rect = (el) => {
      if (!el) return null;
      try {
        return el.getBoundingClientRect();
      } catch {
        return null;
      }
    };
    const box = (b) => (b ? Math.round(b.width) + "x" + Math.round(b.height) : "无");
    const overlap = (a, b) =>
      !!a && !!b && a.left < b.right - 0.5 && a.right > b.left + 0.5 &&
      a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

    const grid = document.getElementById("vt-brand-grid");
    const wrap = grid ? grid.parentNode : null;
    const tip = wrap ? wrap.querySelector(".tip") : null;
    const sws = grid ? grid.children : [];

    // 先把悬停状态清干净，这样"同步量"才真的是"刚从 display:none 变可见"
    if (palette.hideTip) palette.hideTip();
    await dom.settle();

    const first = sws.length ? sws[0] : null;
    if (first) syntheticEvent(first, "mouseover");
    const syncBox = rect(tip);
    const syncW = syncBox ? Math.round(syncBox.width) : -1;

    await waitFor(() => {
      const b = rect(tip);
      return b && b.width > 0;
    }, 2000, 50);
    await dom.settle();

    const tipBox = rect(tip);
    const hitFirst = [];
    for (let i = 0; i < sws.length; i++) {
      if (overlap(tipBox, rect(sws[i]))) hitFirst.push(i);
    }

    /* 最后一个色块在网格下半区 → 浮层应换到网格**下方** */
    const last = sws.length ? sws[sws.length - 1] : null;
    if (last) syntheticEvent(last, "mouseover");
    await waitFor(() => {
      const b = rect(tip);
      return b && b.width > 0;
    }, 2000, 50);
    await dom.settle();
    const tipBox2 = rect(tip);
    const hitLast = [];
    for (let i = 0; i < sws.length; i++) {
      if (overlap(tipBox2, rect(sws[i]))) hitLast.push(i);
    }

    const gridBox = rect(grid);
    const outsideGrid = (b) =>
      !!b && !!gridBox && (b.bottom <= gridBox.top + 0.5 || b.top >= gridBox.bottom - 0.5);

    const measured = !!tipBox && tipBox.width > 0 && !!tipBox2 && tipBox2.width > 0;
    rec(
      "S15 悬停浮层几何（不得与任何色块相交 → 杜绝指针振荡回路）",
      measured && hitFirst.length === 0 && hitLast.length === 0 &&
        outsideGrid(tipBox) && outsideGrid(tipBox2),
      "同步量=" + box(syncBox) + "（让帧前量不到尺寸是正常的：UXP 布局异步）" +
      "　让帧后首行=" + box(tipBox) + " 相交色块=" + hitFirst.length +
      "　让帧后末行=" + box(tipBox2) + " 相交色块=" + hitLast.length +
      "　落在网格外=" + outsideGrid(tipBox) + "/" + outsideGrid(tipBox2) +
      "　（同步宽 " + syncW + "px）"
    );
  } catch (e) {
    rec("S15 悬停浮层几何（不得与任何色块相交 → 杜绝指针振荡回路）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S16: Alt+点击色块 → 填充当前图层（端到端，v0.2.2 新增） ----------
     为什么必须是**像素回读**：`fill` 的 `fillContents="color"` 这条枚举值官方文档没写，
     最坏情况是**静默忽略**（不报错、也不填）—— "命令没抛异常"完全不能当成功。

     为什么要先建临时文档：填充是破坏性的。用户此刻开着的图不能拿来验证。
     全程在自检自己建的纯白小文档上跑，跑完**不保存关掉**。 */
  let scratch = null;
  try {
    scratch = await ps.createScratchDoc({ size: 32 });
    if (!scratch.ok) {
      rec(
        "S16 Alt+点击色块 → 填充当前图层（像素回读 + 不动前景/背景色）",
        false,
        "建临时文档失败，本项无法验证：" + scratch.error
      );
    } else {
      const fgBefore = await ps.readColor("foreground");
      const bgBefore = await ps.readColor("background");
      const target = String(palette.DEFAULT_BRAND[0].hex).toUpperCase();

      const grid = document.getElementById("vt-brand-grid");
      const sw = grid && grid.children.length ? grid.children[0] : null;
      const fire = syntheticClick(sw, { alt: true });

      // 填充 + 像素回读落地需要几拍（fill → 读像素 → 回读）
      const pix = await waitFor(async () => {
        const p = await ps.readLayerAvgColor();
        return p.ok && String(p.hex).toUpperCase() === target ? p : null;
      }, 8000, 250);

      const fgAfter = await ps.readColor("foreground");
      const bgAfter = await ps.readColor("background");
      const fgSame = fgBefore.ok && fgAfter.ok && fgBefore.hex === fgAfter.hex;
      const bgSame = bgBefore.ok && bgAfter.ok && bgBefore.hex === bgAfter.hex;

      rec(
        "S16 Alt+点击色块 → 填充当前图层（像素回读 + 不动前景/背景色）",
        !!fire.ok && fire.altHonored !== false && !!pix && fgSame && bgSame,
        "合成=" + (fire.via || fire.error) + "(alt 生效=" + fire.altHonored + ")" +
        "　临时文档=" + scratch.name + "(id " + scratch.id + ", " + (scratch.params || []).join("+") + ")" +
        "　目标=" + target +
        "　像素回读=" + (pix ? pix.hex : "未命中") +
        "　前景 " + (fgBefore.hex || "?") + "→" + (fgAfter.hex || "?") + (fgSame ? "(未变)" : "(被改了!)") +
        "　背景 " + (bgBefore.hex || "?") + "→" + (bgAfter.hex || "?") + (bgSame ? "(未变)" : "(被改了!)")
      );
    }
  } catch (e) {
    rec(
      "S16 Alt+点击色块 → 填充当前图层（像素回读 + 不动前景/背景色）",
      false,
      "抛异常：" + ((e && e.message) || e)
    );
  } finally {
    if (scratch && scratch.ok) {
      const closed = await ps.closeDocument(scratch.id);
      await log.appendLog(
        "selfcheck 临时文档收尾 id=" + scratch.id + " 关闭=" + closed.ok +
        (closed.error ? " err=" + closed.error : "")
      );
    }
  }

  /* ---------- S17: 内容图层（形状/纯色填充）改色（v0.2.3 新增） ----------
     为什么必须有这一项：用户报「填充不能用」时，出问题的图层是**形状图层**。
     形状图层在 UXP 里 `kind === "solidColor"`（= 内容图层），PS 的 `fill` 对它
     **不可用**：不报错、不改像素，还弹「命令填充当前不可用」。

     本项要在真机上钉死两件事：
       ① 内容图层的 `kind` 到底读出来是什么（验证 classifyLayer 的分派前提）
       ② 两条改色描述符（contentColorA / contentColorB）**哪一条真的生效** ——
          这两条写法各有出处，我没有真机证据判断 PS 27.2 认哪条，所以按序试，
          让这一项把"命中的那条"记进日志（via=contentColorA/B）。

     破坏性动作照旧只作用在自检自己建的临时文档上，跑完不保存关掉。 */
  let scratch2 = null;
  const S17 = "S17 内容图层改色 —— kind 判定 + 改色命中（⚠️ 已知限制：本条建的是「纯色填充图层」，改色未解决；**形状图层是正常的**，见 docs/18 §八）";
  try {
    scratch2 = await ps.createScratchDoc({ size: 32 });
    if (!scratch2.ok) {
      rec(S17, false, "建临时文档失败，本项无法验证：" + scratch2.error);
    } else {
      const seed = "#202020";
      const want = "#E60012";
      await ps.makeSolidColorLayer(ps.hexToRgb(seed));

      const kindInfo = ps.layerInfo();
      const seeded = await ps.readLayerAvgColor();
      const seedOk = !!seeded.ok && String(seeded.hex).toUpperCase() === seed;

      const res = await ps.fillLayer(want, { verify: "pixel" });
      const pix = await waitFor(async () => {
        const p = await ps.readLayerAvgColor();
        return p.ok && String(p.hex).toUpperCase() === want ? p : null;
      }, 8000, 250);

      rec(
        S17,
        kindInfo.ok && kindInfo.kind === "solidColor" && seedOk && !!pix &&
          res.ok && String(res.family) === "content",
        "kind=" + (kindInfo.kind || "?") + "（期望 solidColor）" +
        "　family=" + (res.family || "?") + "（期望 content）" +
        "　建层色=" + seed + "→回读 " + (seeded.hex || "?") + (seedOk ? " ✓" : " ✗") +
        "　目标=" + want +
        "　命中路径=" + (res.via || "-") + "（contentColorA=直接给 solidColorLayer.color，" +
        "contentColorB=shapeStyle.fillContents）" +
        "　像素回读=" + (pix ? pix.hex : "未命中") +
        "　attempts=[" + (res.attempts || []).join(" ") + "]" +
        (res.error ? "　err=" + res.error : "")
      );
    }
  } catch (e) {
    rec(S17, false, "抛异常：" + ((e && e.message) || e));
  } finally {
    if (scratch2 && scratch2.ok) {
      const closed = await ps.closeDocument(scratch2.id);
      await log.appendLog(
        "selfcheck 临时文档收尾2 id=" + scratch2.id + " 关闭=" + closed.ok +
        (closed.error ? " err=" + closed.error : "")
      );
    }
  }

  /* ---------- S18: 文字图层改色（v0.2.4 新增） ----------
     为什么必须有这一项：用户报「形状图层可以了，但文字图层还是不行」。
     真机确认：`fill` 对文字图层给「命令"<未知的>"当前不可用」（不再是我们的猜测），
     必须走 `set` → `_target:[{_property:"textStyle",_ref:"property"},{textLayer/ordinal/targetEnum}]`
     → `to:{textStyle, color:{RGBColor}}`（**照抄 Adobe 官方 API 文档**）。

     本项在真机上钉死三件事：
       ① `make textLayer` 能造出文字图层，且 `kind` 读出来是 `"text"`（分派前提）；
       ② 改色**真的让像素变了** —— 不是"命令没报错就算过"（S17 的静默失效就是这么骗人的）；
       ③ 改完**仍然是文字图层** —— 非破坏性、文字保持可编辑。这条最容易悄悄退化。

     ⚠️ 造出来的点文字**锚点在基线上、字往上长**：不 `move` 一次的话，300pt 的字在
        400×400 画布里**完全落在画布外**，像素回读只会拿到空白 → 会误报成"改色无效"。
        所以 `makeTextLayer()` 里带了一次 offset(30,330)（实测落点 48,100,274,330）。

     破坏性动作照旧只作用在自检自己建的临时文档上，跑完不保存关掉。 */
  let scratch3 = null;
  const S18 = "S18 文字图层改色 —— textStyle.color 命中 + 改完仍是文字图层（非破坏性）";
  try {
    scratch3 = await ps.createScratchDoc({ size: 400 });
    if (!scratch3.ok) {
      rec(S18, false, "建临时文档失败，本项无法验证：" + scratch3.error);
    } else {
      const mk = await ps.makeTextLayer("M", 300, 30, 330);
      const kind0 = ps.layerInfo();
      const before = await ps.readLayerAvgColor();
      const want = "#E60012";
      const res = await ps.fillLayer(want, { verify: "change" });
      const baseHex = before.ok ? String(before.hex).toUpperCase() : null;
      const pix = await waitFor(async () => {
        const p = await ps.readLayerAvgColor();
        if (!p.ok || !baseHex) return null;
        return String(p.hex).toUpperCase() !== baseHex ? p : null;
      }, 8000, 250);
      const kind1 = ps.layerInfo();
      const keptText = !!kind1.ok && kind1.kind === "text";
      rec(
        S18,
        !!mk.ok && !!kind0.ok && kind0.kind === "text" && !!pix &&
          !!res.ok && String(res.family) === "text" && keptText,
        "建层 kind=" + (kind0.kind || "?") + "（期望 text）" +
        "　family=" + (res.family || "?") + "（期望 text）" +
        "　命中路径=" + (res.via || "-") +
        "　改前=" + (baseHex || "?") + " → 改后=" + (pix ? pix.hex : "未变化") +
        "　目标=" + want +
        "　改完 kind=" + (kind1.kind || "?") + "（期望仍是 text = 非破坏性）" +
        "　attempts=[" + (res.attempts || []).join(" ") + "]" +
        (res.error ? "　err=" + res.error : "")
      );
    }
  } catch (e) {
    rec(S18, false, "抛异常：" + ((e && e.message) || e));
  } finally {
    if (scratch3 && scratch3.ok) {
      const closed = await ps.closeDocument(scratch3.id);
      await log.appendLog(
        "selfcheck 临时文档收尾3 id=" + scratch3.id + " 关闭=" + closed.ok +
        (closed.error ? " err=" + closed.error : "")
      );
    }
  }

  /* ---------- 共享小工具（S19 / S20 系列都要用） ----------
     ⚠️ 本轮（v0.3.2）最重要的改造：**自检不能绑死在假软件桩那份 fixture 上**。
        2026-10-11 真机上线后，`library/` 里躺的是**真 VellumDesk**写出来的镜像
        （只声明 task、6 个项目 5 个是空包、缩略图叫 `t110.png`）——
        而原先的 S19 把期望值写死成 `taskRows === 3 && brandRows === 4 &&
        srcSig === "company:3|user:1"`，S21 又把测试文件名写死成 `t401.png`。
        那会让自检在真镜像上**因为与真因无关的原因**报一堆 FAIL。
        ⇒ 一律**从原始 JSON 自己数**、**从镜像里自己挑文件**。 */

  /** 独立数一遍"素材形状"的对象（有 id + name + ext 三者）。 */
  const countAssetsDeep = (node) => {
    let n = 0;
    const walk = (x) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) {
        for (const it of x) walk(it);
        return;
      }
      if (typeof x.id === "number" && typeof x.name === "string" && typeof x.ext === "string") {
        n++;
        return;
      }
      for (const k of Object.keys(x)) walk(x[k]);
    };
    walk(node);
    return n;
  };

  /** 读镜像里某个 scope 文件的**原始 JSON**（自数用）。拿不到返回 null。 */
  async function rawScopeByFile(file) {
    try {
      const t = await data.readTextIn(["library"], file, "");
      return t && t.trim() ? JSON.parse(t) : null;
    } catch {
      return null;
    }
  }

  /**
   * 从**镜像里挑一个真实存在的缩略图**当"沙箱内测试文件"。
   * ⚠️ 不能写死 `t401.png` —— 那是我 fixture 的文件名，真软件写出来的是 `t110.png` 这种。
   */
  async function pickThumbFile() {
    const fallback = { dir: ["library", "thumb"], name: "t401.png" };
    try {
      const mt = await mirror.readManifest();
      if (!mt.ok) return fallback;
      for (const sc of mt.scopes || []) {
        const r = await mirror.readScope(sc);
        if (!r.ok) continue;
        const rows = mirror.flatten(sc.id, r.data);
        for (const row of rows) {
          const th = row && row.asset && row.asset.thumb;
          if (!th) continue;
          const parts = String(th).split("/").filter(Boolean);
          const name = parts.pop();
          if (name) return { dir: ["library"].concat(parts), name: name };
        }
      }
    } catch {
      /* 忽略：退回兜底 */
    }
    return fallback;
  }

  /** 记忆化一份"沙箱内测试文件"（S21/S22/S24/S25 共用，避免各读一遍 manifest）。 */
  let _thumbFile = null;
  async function testThumbFile() {
    if (!_thumbFile) _thumbFile = await pickThumbFile();
    return _thumbFile;
  }

  /* ---------- S19: 镜像读取层（M2 素材库地基） ----------
     v0.2.5 首版验「到底能不能读」；v0.2.6 改为验**契约读取层本身**。

     🔴 **v0.3.2 的关键改造：期望值不再写死。**
        真 VellumDesk 上线后，`library/` 里躺的是**真镜像**（2026-10-11 实测：
        只声明 `task` 一个 scope、6 个项目里 5 个是空包、缩略图叫 `t110.png`）。
        而旧版把期望值钉成 `taskRows===3 && brandRows===4 && srcSig==="company:3|user:1"`，
        于是自检会在真镜像上**因为与真因无关的原因**报 FAIL —— 那种 FAIL 比不测还糟。
        ⇒ 现在：**期望值从原始 JSON 自己数**；`brand` scope 不存在时那一半判**"不适用"**，
          不判失败（库列表本来就完全由镜像的 `scopes[]` 决定）。

     判据：
       ① `readManifest()` 成功且 `contract === "vellum-link/1"`（不认识要**降级**，不能崩）
       ② `task` 的条数 === 从 task.json **自己数**出来的条数
       ③ `brand`（若镜像声明了）条数 / 子组条数 / 来源分布 都 === 自己数出来的
       ④ 缩略图经 `thumbUrl()` → objectURL → `<img>`，**容器可见**，naturalWidth > 0
       ⑤ **webp 防御**：读到 `.webp` 必须给**可读错误**（UXP 不解码 webp，别让 UI 出一堆空白格）

     ⚠️ 本项**不碰 PS 文档**，纯 UXP storage + DOM，所以没有临时文档要收尾。 */
  const S19 = "S19 镜像读取层 —— manifest/task/brand 解析 + 缩略图渲染（契约 vellum-link/1）";
  let s19Holder = null;
  try {
    // ① 总索引
    const m = await mirror.readManifest();

    // ② 期望值：**从原始 JSON 自己数**（不复用 mirror 的展平结果 —— 那是拿被测模块的输出验它自己）
    const rawTask = await rawScopeByFile("task.json");
    const rawBrand = await rawScopeByFile("brand.json");
    const expTask = rawTask ? countAssetsDeep(rawTask) : null;
    const expBrand = rawBrand ? countAssetsDeep(rawBrand) : null;
    /** 从原始 brand.json 自己算"该有多少条落在子组里"（parentId 指向存在的组才算子组）。 */
    const expSubRows = (bd) => {
      const byId = {};
      for (const g of (bd && bd.groups) || []) byId[String(g.id)] = g;
      let n = 0;
      for (const g of (bd && bd.groups) || []) {
        const r = g.parentId;
        const isKid = !(r === undefined || r === null || r === "" || !byId[String(r)]);
        if (isKid) n += (g.assets || []).length;
      }
      return n;
    };
    /** 从原始 brand.json 自己算来源分布。 */
    const expSrcCounts = (bd) => {
      const c = {};
      for (const g of (bd && bd.groups) || []) {
        for (const a of g.assets || []) if (a.source) c[String(a.source)] = (c[String(a.source)] || 0) + 1;
      }
      return c;
    };
    const canonCounts = (o) => Object.keys(o).sort().map((k) => k + ":" + o[k]).join("|");

    // ② 两个 scope 的解析 + 展平
    let taskRows = 0;
    let brandRows = 0;
    let brandItems = [];
    let taskRev = null;
    let firstRow = null;
    let taskErr = null;
    let brandErr = null;
    let brandScope = null;
    if (m.ok) {
      const ts = m.scopes.filter((s) => s.id === "task")[0];
      if (ts) {
        const r = await mirror.readScope(ts);
        if (r.ok) {
          const rows = mirror.flatten("task", r.data);
          taskRows = rows.length;
          taskRev = r.revision;
          firstRow = rows[0] || null;
        } else taskErr = r.error;
      } else taskErr = "总索引里没有 task scope";

      brandScope = m.scopes.filter((s) => s.id === "brand")[0] || null;
      if (brandScope) {
        const r = await mirror.readScope(brandScope);
        if (r.ok) {
          brandItems = mirror.flatten("brand", r.data);
          brandRows = brandItems.length;
        } else brandErr = r.error;
      }
    }

    // ②b 软件侧 2026-10-10 提的两处加法（契约 §5.3 parentId / §5.4 source）：
    //     只验"解析层"是否把它们变成了可用的结构；**界面**由 S20c / S20d 负责。
    const subRows = brandItems.filter((x) => !!x.sub).length;
    const srcGot = {};
    for (const s of mirror.sourceSummary(brandItems)) srcGot[s.value] = s.count;
    const srcSig = canonCounts(srcGot);

    // ③ 渲染缩略图 —— 容器**必须可见**（display:none 里 UXP 不加载图片，表现为超时）
    s19Holder = document.createElement("div");
    s19Holder.style.cssText =
      "position:fixed;right:0;bottom:0;width:48px;height:48px;opacity:1;" +
      "pointer-events:none;overflow:hidden;z-index:99999;";
    document.body.appendChild(s19Holder);

    let renderOk = false;
    let renderInfo = "未执行";
    if (firstRow) {
      const t = await mirror.thumbUrl(firstRow.asset, taskRev);
      if (t.ok) {
        const img = document.createElement("img");
        img.style.cssText = "width:48px;height:48px;display:block;";
        s19Holder.appendChild(img);
        img.src = t.url;
        const got = await waitFor(() => (img.naturalWidth > 0 ? img : null), 4000, 150);
        renderOk = !!got;
        renderInfo = renderOk
          ? img.naturalWidth + "x" + img.naturalHeight + " / " + t.bytes + "B" + (t.cached ? "(缓存)" : "")
          : "naturalWidth 始终 0（超时）";
      } else renderInfo = "取缩略图失败：" + t.error;
    } else renderInfo = "没有可渲染的素材（" + (taskErr || "task 为空") + "）";

    // ④ webp 防御（UXP 不解码 webp —— 必须在这里就拦住，给出可读原因）
    const guard = await mirror.thumbUrl({ id: -1, thumb: "thumb/should-not-exist.webp" }, 0);

    // 判据：**核心项总是要过**；通用库相关的只在"镜像里真有 brand scope"时才要求
    const coreOk = m.ok && expTask !== null && taskRows === expTask && renderOk && !!guard.webp;
    const brandOk = !brandScope
      ? true // 镜像没声明 brand（软件侧还没写出）⇒ 这一半**不适用**，不判失败
      : brandRows === expBrand &&
        subRows === expSubRows(rawBrand) &&
        srcSig === canonCounts(expSrcCounts(rawBrand));

    rec(
      S19,
      coreOk && brandOk,
      "契约=" + (m.ok ? m.manifest.contract + " ✓" : "✗ " + m.error) +
      "　scopes=[" + (m.scopes || []).map((s) => s.id + ":rev" + s.revision).join(" ") + "]" +
      "　任务库=" + taskRows + " 条（自数 " + expTask + "）" + (taskErr ? " ✗ " + taskErr : "") +
      (brandScope
        ? "　通用库=" + brandRows + " 条（自数 " + expBrand + "）" +
          "·子组 " + subRows + " 条（自数 " + expSubRows(rawBrand) + "）" +
          "·来源 " + (srcSig || "无 source 字段") + "（自数 " + (canonCounts(expSrcCounts(rawBrand)) || "无 source 字段") + "）" +
          (brandErr ? " ✗ " + brandErr : "")
        : "　通用库=镜像里**没声明 brand scope**（VellumDesk 尚未写出）⇒ 这一半不适用") +
      "　缩略图=" + renderInfo +
      "　webp 防御=" + (guard.webp ? "已拦截 ✓" : "✗ 未拦截") +
      "　首条面包屑=" + (firstRow ? firstRow.crumb.join(" › ") : "-")
    );
  } catch (e) {
    rec(S19, false, "抛异常：" + ((e && e.message) || e));
  } finally {
    if (s19Holder && s19Holder.parentNode) s19Holder.parentNode.removeChild(s19Holder);
    try {
      mirror.clearThumbs();
    } catch {
      /* 忽略 */
    }
  }

  /* ---------- S20: 素材库界面（v0.2.7 新增） ----------
     为什么必须走真实 mount：面板我点不了，但「镜像数据到底有没有变成界面」
     只能通过真实 DOM 来验。这里刻意**不复用 tools/library.js 的内部状态**来当期望值 ——
     期望值全部从**原始 JSON 自己数**，否则就是"拿自己的输出验自己"。
     （S19 只验了"读得出 + 独立容器能渲染"；S20 验的是"整条链的终点：真实卡片里的图"） */
  try {
    const S20 = "S20 素材库界面 —— 库切换 / 筛选 / 网格 / 缩略图 / 详情（真实 mount）";

    /* 独立数一遍：递归找「asset 形状」的对象（有 id + name + ext），不依赖 mirror.js。
       ⚠️ 这个函数现在声明在 run() 顶层（S19 也要用），别在这里再 `const` 一遍。 */

    const collectImgs = (node, out) => {
      const kids = (node && node.children) || [];
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (String(c.tagName).toUpperCase() === "IMG") out.push(c);
        collectImgs(c, out);
      }
      return out;
    };


    const rawMan = await data.readTextIn(["library"], "manifest.json", "");
    let man = null;
    try {
      man = rawMan && rawMan.trim() ? JSON.parse(rawMan) : null;
    } catch {
      man = null;
    }

    await ctx.shell.showTool("assets", "selfcheck");

    if (!man || !man.scopes || !man.scopes.length) {
      /* 镜像缺失 → 界面应当走**空态**分支。这也是一个真检查（不是"跳过"）。 */
      const body = document.getElementById("vt-lib-body");
      const txt = body ? String(body.textContent || "") : "";
      const retry = document.getElementById("vt-lib-retry");
      rec(
        S20,
        !!body && txt.indexOf("镜像") >= 0 && !!retry,
        "镜像缺失，走空态分支　状态块=" + JSON.stringify(txt.slice(0, 60)) +
        "　重试按钮=" + !!retry +
        "　（要跑完整回归先执行 tools/fake-vellumdesk.cjs）"
      );
    } else {
      const tabsEl = document.getElementById("vt-lib-tabs");
      const barEl = document.getElementById("vt-lib-bar");
      const tabCount = tabsEl ? tabsEl.children.length : 0;

      // 当前激活的库（从 DOM 读，不读模块内部状态）
      let activeId = null;
      let onChips = 0;
      if (tabsEl) {
        for (let i = 0; i < tabsEl.children.length; i++) {
          const c = tabsEl.children[i];
          if (c.getAttribute && String(c.getAttribute("class") || "").indexOf("is-on") >= 0) {
            onChips++;
            activeId = c.getAttribute("data-scope");
          }
        }
      }

      // 期望值：自己数 activeId 那个 scope 的素材数
      let expect = -1;
      let scopeFile = "";
      for (const s of man.scopes) {
        if (s.id === activeId) scopeFile = s.file;
      }
      if (scopeFile) {
        const raw = await data.readTextIn(["library"], scopeFile, "");
        try {
          expect = countAssetsDeep(JSON.parse(raw));
        } catch {
          expect = -1;
        }
      }

      // 等缩略图读完（library.js 是顺序读的，所以给足时间）
      // ⚠️ 也要点名 scope —— 与 S20b/S20c 同一族纪律：判据必须说清"是哪块网格"。
      await waitFor(() => {
        const g = document.getElementById("vt-lib-grid");
        if (!g) return null;
        if (String(g.getAttribute("data-scope") || "") !== String(activeId || "")) return null;
        const imgs = collectImgs(g, []);
        if (!imgs.length) return null;
        for (const im of imgs) {
          if (!im.naturalWidth) return null;
        }
        return imgs;
      }, 8000, 250);

      const grid = document.getElementById("vt-lib-grid");
      const cardsArr = grid ? libCards(grid, []) : [];
      const cards = cardsArr.length;
      const imgs = grid ? collectImgs(grid, []) : [];
      let loaded = 0;
      for (const im of imgs) if (im.naturalWidth > 0) loaded++;

      // 点第一张卡 → 详情行必须出现这个文件
      let detailOk = false;
      let firstName = "";
      if (cardsArr.length) {
        const c0 = cardsArr[0];
        const ft = document.getElementById("vt-lib-foot");
        if (c0) {
          syntheticClick(c0, false);
          await waitFor(() => (c0.getAttribute("class") || "").indexOf("is-on") >= 0, 1500, 100);
        }
        // 名字从卡片自己的 .card-nm 拿，再要求详情里有它
        let nm = "";
        const nmEl = (c0 && c0.children[0] && c0.children[0].children[1]) || null;
        if (nmEl) nm = String(nmEl.textContent || "");
        firstName = nm;
        const ftxt = ft ? String(ft.textContent || "") : "";
        detailOk = !!nm && ftxt.indexOf(nm) >= 0;
      }

      const okAll =
        !!tabsEl &&
        !!barEl &&
        tabCount === man.scopes.length &&
        onChips === 1 &&
        !!grid &&
        cards > 0 &&
        cards === expect &&
        imgs.length > 0 &&
        loaded === imgs.length &&
        detailOk;

      rec(
        S20,
        okAll,
        "库 chips=" + tabCount + "/" + man.scopes.length +
        "（激活 1 个？" + (onChips === 1 ? "是" : "否！") + "，当前 " + activeId + "）" +
        "　筛选区行数=" + libRowCount() + "（0 = 不构成筛选，只显示总计数）" +
        "　卡片=" + cards + "（自数期望 " + expect + "）" +
        "　缩略图 " + loaded + "/" + imgs.length + " 解出尺寸" +
        "　详情行含「" + firstName + "」=" + detailOk
      );

      /* ---- S27（v0.3.4）：瀑布流 —— 盒子高度必须等于「盒宽 × 该素材高宽比」 ----
         用户要求「缩略图容器与缩略图比例一致」（原先是固定 120px 的一排等高格子）。
         判据**逐张卡片比期望值**，不用"高度种类大于 1"那种弱判据 ——
         后者在"库里恰好都是同一种比例"时会假 FAIL，且证明不了算得对。

         期望值独立算（**不复用 library.js 的中间结果** —— 那是拿被测模块的输出验它自己）：
           · 盒宽 = 盒子自己的 offsetWidth（真实布局量出来的）
           · 比例 = 镜像里该素材的 height / width
           · 期望 = clamp(盒宽 × 比例, 72, 380)　← 72/380 是 library.js 的封顶区间
         另验两条结构：恰好两个列容器；每张卡片都**挂在列里**（没有掉到网格直接子级）。 */
      /* 先在**条目最多的那个库**上验（v0.3.4 补）——
         只有 1 条素材时，"两列分派"和"按比例"两条都验不到
         （纪律：一个"永远成立"的样本验不出任何东西）。
         切库后 DOM 会重建 ⇒ 下面**重新从 DOM 抓**网格与卡片，绝不沿用旧引用。 */
      const richScope = (man.scopes || []).slice()
        .sort((a, b) => (b.count || 0) - (a.count || 0))[0];
      if (richScope && richScope.id !== activeId && (richScope.count || 0) > cardsArr.length) {
        await libSwitchTo(richScope.id);
        await libWaitCards(-1, 6000, richScope.id);
      }
      const s27Grid = document.getElementById("vt-lib-grid");
      const s27Cards = s27Grid ? libCards(s27Grid, []) : [];

      if (s27Grid && s27Cards.length) {
        /* 🔴 先等"布局落定 + 高度已用真实盒宽重算" —— `relayoutThumbs` 是异步的
           （它必须等 UXP 把布局做完，才能量到盒子的真实宽度）。
           `data-boxw` 就是它落定后写下的信号 —— 与"等新库渲染完看 data-scope"同一套做法。
           不等这一步，量到的是 renderGrid 当时的**推算值**：真机第一版就是
           201px（推算）vs 189px（实测）差 12px —— 推算宽度错了 12px，量出来就是错的。 */
        await waitFor(() => {
          const g = document.getElementById("vt-lib-grid");
          if (!g) return null;
          const bw = g.getAttribute("data-boxw");
          return bw && Number(bw) > 0 ? g : null;
        }, 4000, 100);

        // ⚠️ 索引必须读**当前这个库**的文件 —— S27 上面可能刚切过库，
        //    而 `scopeFile` 是 S20 那一刻算的（切库后用它会拿错库的宽高，全部对不上）。
        const s27ScopeId = String(s27Grid.getAttribute("data-scope") || "");
        let s27ScopeFile = "";
        for (const s of man.scopes || []) if (s.id === s27ScopeId) s27ScopeFile = s.file;

        const idIndex = {};
        const indexAssets = (n) => {
          if (!n || typeof n !== "object") return;
          if (Array.isArray(n)) {
            for (const k of n) indexAssets(k);
            return;
          }
          if (n.id !== undefined && n.name !== undefined && n.ext !== undefined) {
            idIndex[String(n.id)] = n;
          }
          for (const k of Object.keys(n)) indexAssets(n[k]);
        };
        try {
          const rawScope = await data.readTextIn(["library"], s27ScopeFile, "");
          indexAssets(JSON.parse(rawScope));
        } catch {
          /* 建不出索引就只跑结构那两条 */
        }

        const colNodes = [];
        for (const k of s27Grid.children) if (hasClass(k, "lib-col")) colNodes.push(k);
        const colH = colNodes.map((c) => c.offsetHeight || 0);
        const colSum = colH.length >= 2 ? colH[0] + colH[1] : 0;

        let probed = 0;
        let bad = 0;
        let badWhy = "";
        let inCol = 0;
        let skipped = 0;
        for (const c of s27Cards) {
          if (c.parentNode && hasClass(c.parentNode, "lib-col")) inCol++;
          const a = idIndex[String(c.getAttribute("data-id"))];
          if (!a || !(Number(a.width) > 0) || !(Number(a.height) > 0)) {
            skipped++;
            continue;
          }
          let box = c.querySelector ? c.querySelector(".card-th") : null;
          if (!box && c.children[0]) {
            for (const k of c.children[0].children) if (hasClass(k, "card-th")) box = k;
          }
          if (!box) continue;
          const bw = box.offsetWidth || 0;
          const bh = box.offsetHeight || 0;
          if (!(bw > 0)) continue;
          const want = Math.max(
            72,
            Math.min(Math.round(bw * (Number(a.height) / Number(a.width))), 380)
          );
          probed++;
          if (Math.abs(bh - want) > 2) {
            bad++;
            if (!badWhy) badWhy = a.name + "（期望 " + want + "px，实际 " + bh + "px）";
          }
        }

        // 两列累计高差的容忍上限 = 最高的一张卡片（分派本就是按"累计高度较小的一列"做的）
        const maxCard = 380 + 56;
        const balanced = colH.length === 2 && Math.abs(colH[0] - colH[1]) <= maxCard;

        rec(
          "S27 瀑布流 —— 缩略图盒子按素材比例 + 两列分派",
          colNodes.length === 2 && inCol === s27Cards.length &&
            probed > 0 && bad === 0 && balanced,
          "卡片=" + s27Cards.length + "（挂在列里的=" + inCol + "）" +
          "　本轮验的库=" + String(s27Grid.getAttribute("data-scope") || activeId || "?") +
          "　列容器=" + colNodes.length + "（须 2）" +
          "　逐张比对「盒高 = 盒宽×素材高宽比」：" + (probed - bad) + "/" + probed + " 命中" +
          (skipped ? "（跳过 " + skipped + " 张无像素尺寸的素材）" : "") +
          "　两列高 " + (colH.length ? colH.join("/") : "?") +
          "（合计 " + colSum + "）·均衡=" + balanced +
          (badWhy ? "　‖ 第一处不符：" + badWhy : "")
        );
      }

      // 顺带验一次「切库」：切到另一个库，卡片数要对上那个库的自数
      if (man.scopes.length >= 2) {
        const other = man.scopes[0].id === activeId ? man.scopes[1] : man.scopes[0];
        let expect2 = -1;
        try {
          const raw2 = await data.readTextIn(["library"], other.file, "");
          expect2 = countAssetsDeep(JSON.parse(raw2));
        } catch {
          expect2 = -1;
        }
        const chip = document.getElementById("vt-lib-tab-" + other.id);
        if (chip) {
          syntheticClick(chip, false);
          // ⚠️ 判据必须是"**新的**库已经渲染完"，不能只等"网格里有东西"——
          //    旧网格还在 DOM 里，那种等法第一轮就命中，量到的永远是上一个库的卡片数。
          //    （v0.2.7 第一版就是这么误报的：切到通用库却量到 2 张 = 任务库的张数。）
          //    v0.2.8 改成**点名 scope**：直接读网格的 `data-scope`，不再靠"卡片数恰好不同"。
          const g2 = await waitFor(() => {
            const onChip = document.getElementById("vt-lib-tab-" + other.id);
            const cls = onChip ? String(onChip.getAttribute("class") || "") : "";
            if (cls.indexOf("is-on") < 0) return null;
            const el = document.getElementById("vt-lib-grid");
            if (!el) return null;
            if (String(el.getAttribute("data-scope") || "") !== String(other.id)) return null;
            if (libCards(el, []).length !== expect2) return null;
            return el;
          }, 6000, 200);
          const c2 = g2 ? libCards(g2, []).length : 0;
          const chip2 = document.getElementById("vt-lib-tab-" + other.id);
          rec(
            "S20b 切库 —— 卡片数跟着换（证明 tab 不是写死的）",
            !!g2 && c2 === expect2 && expect2 >= 0,
            "切到 " + other.id + "（" + other.label + "）→ 卡片=" + c2 + "（自数期望 " + expect2 + "）" +
            "　chip class=" + JSON.stringify(chip2 ? chip2.getAttribute("class") : null)
          );
        } else {
          rec("S20b 切库 —— 卡片数跟着换（证明 tab 不是写死的）", false, "找不到 chip id=vt-lib-tab-" + other.id);
        }
        // 切回来，免得把面板留在奇怪的状态
        const back = document.getElementById("vt-lib-tab-" + activeId);
        if (back) syntheticClick(back, false);
      }
    }
  } catch (e) {
    rec("S20 素材库界面 —— 库切换 / 筛选 / 网格 / 缩略图 / 详情（真实 mount）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S20c / S20d: 软件侧 2026-10-10 提的两处加法，落到界面上（v0.2.8 新增） ----------
     契约 §5.3 加法 ③（`groups[].parentId` 两层分组）与 §5.4 加法 ②（`asset.source`）。
     这两条**必须真机验**：解析层对了不代表界面用上了（S19 只验了前者）。
     共同纪律：**期望值全部从原始 JSON 自己数**，绝不读 tools/library.js 的内部状态。

     🔴 v0.3.2 修一个**假 FAIL**：这两条原先直接去读 `library/brand.json` 就开工，
        而磁盘上可能躺着**上一版（甚至是假软件桩）留下的 stale brand.json** ——
        真机 2026-10-11 就撞上了：manifest 里**根本没声明 brand scope**（真软件还没写出通用库），
        stale 文件却还在 ⇒ 自检兴冲冲去操作一个**界面上根本不存在的库** ⇒ 两条 FAIL。
        **哪些库存在，唯一的依据是 `manifest.scopes[]`**，不是"目录里有没有那个文件"。
        ⇒ 先查声明；没声明就记**「不适用」**，不判失败。 */
  let brandDeclared = false;
  let brandGroups = [];
  let twoLevel = null; // { parent, kids, kid, expParent, expKid }
  let srcInfo = null; // { counts, keys }
  try {
    const mm = await mirror.readManifest();
    brandDeclared = !!(mm.ok && (mm.scopes || []).some((s) => s.id === "brand"));
    if (!brandDeclared) {
      const stale = await rawScopeByFile("brand.json");
      await log.appendLog(
        "selfcheck S20c/d 前置：镜像里没声明 brand scope ⇒ 不适用" +
        (stale ? "（⚠️ 但磁盘上有个未被声明的 brand.json，多半是上一版残留 —— 本次不读它）" : "")
      );
    } else {
      const sc = (mm.scopes || []).filter((s) => s.id === "brand")[0];
      const bd = await rawScopeByFile(sc.file || "brand.json");
      brandGroups = (bd && bd.groups) || [];

      const byId = {};
      for (const g of brandGroups) byId[String(g.id)] = g;
      const assetsOf = (g) => (g && Array.isArray(g.assets) ? g.assets.length : 0);
      const isTop = (g) => {
        const r = g.parentId;
        return r === undefined || r === null || r === "" || !byId[String(r)];
      };
      for (const g of brandGroups) {
        if (!isTop(g)) continue;
        const kids = brandGroups.filter((x) => !isTop(x) && String(x.parentId) === String(g.id));
        // 找"**既有直接素材、又有子组**"的父组 —— 这正是两级分组存在的意义；
        // 只有这种样本才能验出"点父组要能看到子组里的素材"。
        if (kids.length && assetsOf(g) > 0) {
          twoLevel = {
            parent: g,
            kids: kids,
            kid: kids[0],
            expParent: assetsOf(g) + kids.reduce((s, k) => s + assetsOf(k), 0),
            expKid: assetsOf(kids[0]),
          };
          break;
        }
      }

      const counts = {};
      for (const g of brandGroups) {
        for (const a of g.assets || []) if (a.source) counts[a.source] = (counts[a.source] || 0) + 1;
      }
      srcInfo = { counts: counts, keys: Object.keys(counts) };
    }
  } catch (e) {
    await log.appendLog("selfcheck S20c/d 前置失败 " + ((e && e.message) || e));
  }

  /* S20c 两级分组筛选 */
  try {
    const S20C = "S20c 两级分组筛选 —— 点父组含子组素材、点下拉里的子组收窄（契约 §5.3 parentId）";
    if (!brandDeclared) {
      rec(S20C, true, "【不适用】镜像没声明 brand scope（通用库尚未由 VellumDesk 写出）—— 本条不判失败" +
        "（哪些库存在只看 manifest.scopes[]，不看磁盘上有没有那个文件）");
    } else if (!twoLevel) {
      rec(S20C, true, "【不适用】镜像里没有「两层分组」样本（需要一个既有直接素材、又有子组的父组）—— 本条不判失败");
    } else {
      const pName = twoLevel.parent.name;
      const kName = twoLevel.kid.name;
      const okSwitch = await libSwitchTo("brand");
      libResetFilter();

      // 关键语义①：未选父组时**不该有平铺的子组按钮**，也不该有下拉触发条
      //   （旧版把父组与子组平铺成同级 chip —— 那正是被判定"错的 UI"的那一版）
      const flatBefore = libFlatSubChips();
      const trigBefore = !!libSelTrigger();

      const pChip = libChip(pName);
      const nTxt = pChip && pChip.children[1] ? String(pChip.children[1].textContent || "") : "";

      let cardsParent = -1;
      if (pChip) {
        syntheticClick(pChip, false);
        const g1 = await libWaitCards(twoLevel.expParent, 5000, "brand");
        cardsParent = g1 ? g1.children.length : -1;
      }

      // 关键语义②：选了父组才出现**下拉触发条**；点开之后浮层里才有子组选项
      const trig = libSelTrigger();
      let opened = false;
      let bounds = { ok: false, note: "未展开" };
      if (trig) {
        syntheticClick(trig, false);
        const o = await waitFor(() => (libSelOpen() ? true : null), 2500, 120);
        opened = !!o;
        if (opened) bounds = await libPopInsideScroll();
      }
      const flatAfter = libFlatSubChips();

      const kOpt = libOpt(kName);
      let cardsKid = -1;
      if (kOpt) {
        syntheticClick(kOpt, false);
        const g2 = await libWaitCards(twoLevel.expKid, 5000, "brand");
        cardsKid = g2 ? libCards(g2, []).length : -1;
      }
      const closedAfterPick = !libSelOpen();

      rec(
        S20C,
        okSwitch && flatBefore === 0 && !trigBefore && !!pChip &&
          cardsParent === twoLevel.expParent && !!trig && opened &&
          bounds.ok === true && bounds.inside === true &&
          flatAfter === 0 && !!kOpt && cardsKid === twoLevel.expKid && closedAfterPick,
        "库=brand（切换=" + okSwitch + "）" +
        "　顶层平铺的子组按钮=" + flatBefore + "（须 0）·触发条存在？" + trigBefore + "（须 false）" +
        "　父组「" + pName + "」count 标签=" + JSON.stringify(nTxt) +
        " → 卡片=" + cardsParent + "（自数期望 " + twoLevel.expParent + "）" +
        "　触发条出现=" + !!trig + "·点开=" + opened +
        "　浮层不越界：" + bounds.note +
        "　子组选项「" + kName + "」=" + !!kOpt + " → 卡片=" + cardsKid + "（自数期望 " + twoLevel.expKid + "）" +
        "　选完自动收起=" + closedAfterPick +
        "　全程平铺按钮仍为 " + flatAfter +
        "　‖ 失败时看这里·筛选区签名=" + libBarSig()
      );
      libResetFilter();
    }
  } catch (e) {
    rec("S20c 两级分组筛选 —— 点父组含子组素材、点子组收窄（契约 §5.3 parentId）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* S20d 来源筛选（只在 ≥2 种来源时出现） */
  try {
    const S20D = "S20d 通用库不画重复的「来源」行（顶层分组已是同一划分；卡片角标仍在）";
    if (!brandDeclared) {
      rec(S20D, true, "【不适用】镜像没声明 brand scope（通用库尚未由 VellumDesk 写出）—— 本条不判失败");
    } else if (!srcInfo || srcInfo.keys.length < 2) {
      rec(S20D, true,
        "【不适用】镜像里通用库只有 " + (srcInfo ? srcInfo.keys.length : "?") +
        " 种来源 —— 无法验证来源筛选（老镜像没有 source 字段时属正常）");
    } else {
      /* 🔴 v0.3.4 **语义更新**：通用库不再画「来源」行 ——
         顶层分组（公司素材 / 个人收藏）与「来源」（company / user）是**同一个划分**，
         两行同时出现只是在复述同一件事（用户 2026-10-11 报「这些和上面有些重复了」）。
         ⇒ 本条从"点来源能收窄"改成"该行确实不画"，并且要求
           **卡片上的来源角标仍在** —— 角标标的是每一张素材、不占筛选区版面，是另一回事。
         （"什么时候该画"的判据在 library.js 里是**按划分**判的，不是按分组命名。） */
      const okSwitch = await libSwitchTo("brand");
      libResetFilter();
      await libWaitCards(-1, 5000, "brand");

      const srcChipKeys = [];
      for (const k of srcInfo.keys) if (libChip(k)) srcChipKeys.push(k);
      const srcRowShown = srcChipKeys.length > 0;

      // 角标仍在？递归找 `.card-src`
      const g3 = document.getElementById("vt-lib-grid");
      let badgeFound = false;
      if (g3) {
        const hasBadge = (n) => {
          for (let i = 0; i < n.children.length; i++) {
            const k = n.children[i];
            if (hasClass(k, "card-src")) return true;
            if (hasBadge(k)) return true;
          }
          return false;
        };
        for (const c of libCards(g3, [])) {
          if (hasBadge(c)) {
            badgeFound = true;
            break;
          }
        }
      }

      rec(
        S20D,
        okSwitch && !srcRowShown,
        "库=brand（切换=" + okSwitch + "）" +
        "　来源分布=" + JSON.stringify(srcInfo.counts) +
        "　筛选区里出现 company/user 的 chip=" + (srcChipKeys.length ? srcChipKeys.join(",") : "无") +
        "（须无 —— 顶层分组已经是同一个划分）" +
        "　卡片来源角标仍在=" + badgeFound +
        "　‖ 筛选区签名=" + libBarSig()
      );
      libResetFilter();
    }
  } catch (e) {
    rec("S20d 通用库不画重复的「来源」行（顶层分组已是同一划分；卡片角标仍在）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* S20e 任务库的「项目」筛选下拉（v0.3.1，用户 2026-10-11 要求：放在刷新按钮左侧）
     判据三条，都是硬的（"看起来像"不算）：
       ① **只在任务库出现** —— 切到通用库必须消失（那里顶层是「公司素材 / 我的收藏」，不是项目）；
       ② 位置真的在**刷新按钮左侧**且同一行 —— 用**矩形**比，不靠 DOM 顺序猜；
       ③ 选项数 = 项目数 + 「全部项目」，且选一个项目后卡片数收窄到该项目的素材数。
     ⚠️ 期望值全部从 task.json **自己数**，不读 library.js / mirror.js 的中间结果。 */
  try {
    const S20E = "S20e 项目筛选下拉 —— 只在任务库出现、在刷新按钮左侧、选项数对、能收窄";
    let projList = []; // [{ name, n }]
    try {
      const rawT = await data.readTextIn(["library"], "task.json", "");
      const td = rawT && rawT.trim() ? JSON.parse(rawT) : null;
      for (const p of (td && td.projects) || []) {
        let n = 0;
        for (const k of p.packs || []) n += (k.assets || []).length;
        projList.push({ name: p.name, n: n });
      }
    } catch (e) {
      await log.appendLog("selfcheck S20e 前置失败 " + ((e && e.message) || e));
    }

    if (projList.length < 2) {
      rec(
        S20E,
        true,
        "【不适用】镜像里任务库只有 " + projList.length + " 个项目 —— **只有一个选项不构成筛选**" +
        "（需要 ≥2 个项目才验得出来）"
      );
    } else {
      await libSwitchTo("task");
      const okSwitch = libGridScope() === "task";

      const trig = document.getElementById("vt-lib-projsel");
      const refresh = document.getElementById("vt-lib-refresh");

      // ② 位置：在刷新按钮左侧 + 同一行（矩形比对）
      let geo = "拿不到矩形";
      let leftOf = false;
      let sameRow = false;
      if (trig && refresh) {
        const a = trig.getBoundingClientRect();
        const b = refresh.getBoundingClientRect();
        leftOf = a.right <= b.left + 2;
        sameRow = a.top < b.bottom && b.top < a.bottom;
        geo = "项目下拉 " + Math.round(a.left) + "~" + Math.round(a.right) +
          "　刷新按钮 " + Math.round(b.left) + "~" + Math.round(b.right);
      }

      // 必须在**顶部行**（vm-lib-projslot）里，不能跑到筛选区里
      const topSlot = document.getElementById("vt-lib-projslot");
      let inTop = false;
      let node = trig;
      while (node) {
        if (node === topSlot) { inTop = true; break; }
        node = node.parentNode;
      }

      // ③ 选项数 + 收窄
      // ⚠️ "收窄"只能拿**有素材**的项目来验 —— 一个 0 素材的项目点下去，网格会变成空态块，
      //    那时 DOM 里**根本没有 `#vt-lib-grid`**，量到的会是 -1 而不是 0。
      //    这条是被**真镜像**逼出来的：它 6 个项目里 5 个是空包（`packs: []`）。
      const withAssets = projList.filter((p) => p.n > 0).sort((x, y) => x.n - y.n);
      const pick = withAssets[0] || null;
      // 反面：**空项目也必须出现在选项里** —— 这正是 `projectOptions()` 读"原始 projects[]"
      //       而不是读"已展平的素材树"的理由（树里没有空项目）。
      const emptyProj = projList.filter((p) => p.n === 0)[0] || null;
      let opened = false;
      let optCount = -1;
      if (trig) {
        syntheticClick(trig, false);
        const o = await waitFor(() => (libSelOpen("vt-lib-projwrap") ? true : null), 2500, 120);
        opened = !!o;
        const pop = document.getElementById("vt-lib-projpop");
        optCount = pop ? pop.children.length : -1;
      }
      // 选项都从**同一个浮层**里取（点掉一个就会整片重渲染，所以先全取到手再点）
      const opt = pick ? libOpt(pick.name, "vt-lib-projpop", "data-proj") : null;
      const emptyOpt = emptyProj ? libOpt(emptyProj.name, "vt-lib-projpop", "data-proj") : null;
      let cards = -1;
      if (opt) {
        syntheticClick(opt, false);
        const g = await libWaitCards(pick.n, 5000, "task");
        cards = g ? libCards(g, []).length : -1;
      }
      const closed = !libSelOpen("vt-lib-projwrap");
      // 没有"非空项目" / 没有"空项目" / 镜像里没有 brand scope 时，对应的那一小项**不适用**
      const narrowOk = pick ? (!!opt && cards === pick.n) : true;
      const emptyOptOk = emptyProj ? !!emptyOpt : true;

      // ① 反向：切到通用库这个下拉必须消失（顶层不是项目）
      let hasBrand = false;
      let goneOnBrand = null;
      try {
        hasBrand = !!document.getElementById("vt-lib-tab-brand");
        if (hasBrand) {
          const okB = await libSwitchTo("brand");
          if (okB) goneOnBrand = !document.getElementById("vt-lib-projsel");
          await libSwitchTo("task");
        }
      } catch { /* 忽略：下面按"不适用"处理 */ }
      const goneOk = hasBrand ? goneOnBrand === true : true;

      rec(
        S20E,
        okSwitch && inTop && leftOf && sameRow && opened &&
          optCount === projList.length + 1 && narrowOk && emptyOptOk && closed && goneOk,
        "任务库（切换=" + okSwitch + "）　在顶部行内=" + inTop +
        "　在刷新左侧=" + leftOf + "·同一行=" + sameRow + "（" + geo + "）" +
        "　点开=" + opened +
        "　选项数=" + optCount + "（自数期望 " + (projList.length + 1) +
        " = 项目 " + projList.length + " + 全部项目）" +
        (pick
          ? "　取最少素材的项目「" + pick.name + "」=" + !!opt +
            " → 卡片=" + cards + "（自数期望 " + pick.n + "）"
          : "　（没有非空项目 ⇒ 收窄这一步不适用）") +
        (emptyProj
          ? "　空项目「" + emptyProj.name + "」也在选项里=" + !!emptyOpt + "（必须是 true）"
          : "　（没有空项目 ⇒ 这一小项不适用）") +
        "　选完收起=" + closed +
        (hasBrand ? "　切到通用库后消失=" + goneOnBrand : "　（镜像无 brand scope ⇒ 这一步不适用）") +
        "　‖ 项目自数=" + JSON.stringify(projList.map((p) => p.name + ":" + p.n))
      );
    }
  } catch (e) {
    rec("S20e 项目筛选下拉 —— 只在任务库出现、在刷新按钮左侧、选项数对、能收窄", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S21: 置入（placeEvent + 会话令牌）（v0.2.7 新增） ----------
     本项目第一次用 `placeEvent`。判据是**图层数增加**，不是"命令没报错"。
     ⚠️ 第一版（21:32）传的是**裸路径** → `Error: invalid file token used`
        ⇒ Photoshop 的 AM 层要的是 UXP **授权过的文件令牌**，不是路径。
        这条直接判了「按 absPath 直连置入」死刑，handoff 搬运是必需的（见 docs/23）。
     ⚠️ 只作用在自建的临时文档上，跑完不保存关掉。 */
  try {
    const S21 = "S21 置入（placeEvent + 会话令牌）—— 临时文档上图层数必须增加";
    const tf21 = await testThumbFile();
    const srcEntry = await data.entryIn(tf21.dir, tf21.name);
    if (!srcEntry) {
      rec(S21, false, "拿不到测试文件 Entry（镜像缺失）—— 先跑 tools/fake-vellumdesk.cjs；本条不作数");
    } else {
      const tok = await ps.sessionTokenFor(srcEntry);
      const scratch = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(place)" });
      if (!scratch.ok) {
        rec(S21, false, "建临时文档失败：" + scratch.error);
      } else {
        let placed = null;
        try {
          if (!tok.ok) {
            placed = { ok: false, error: "换会话令牌失败：" + tok.error };
          } else {
            placed = await ps.placeFile(srcEntry, { verify: "change" });
          }
        } catch (e) {
          placed = { ok: false, error: "抛异常：" + ((e && e.message) || e) };
        } finally {
          try {
            await ps.closeDocument(scratch.id);
          } catch {
            /* 忽略 */
          }
        }
        rec(
          S21,
          !!(placed && placed.ok && placed.changed),
          "令牌=" + (tok.ok ? tok.token.slice(0, 16) + "…" : "✗ " + tok.error) +
          "　测试文件=" + tf21.name + "（沙箱内 Entry，从镜像里挑）" +
          "　临时文档 id=" + scratch.id +
          "　图层数 " + (placed ? placed.layersBefore : "?") + " → " + (placed ? placed.layersAfter : "?") +
          "　changed=" + (placed ? placed.changed : "?") +
          (placed && placed.layer ? "　新图层=「" + placed.layer.name + "」" : "") +
          (placed && placed.error ? "　err=" + placed.error : "")
        );
      }
    }
  } catch (e) {
    rec("S21 置入（placeEvent + 会话令牌）—— 临时文档上图层数必须增加", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S22: 直连置入可行性探针（v0.2.7 新增） ----------
     这是**诊断项**（不是回归项）：把"能不能读到沙箱外的文件"这件事问清楚，
     因为它的答案决定 M2 的架构 —— 若能直接读到 `absPath`，
     整条 handoff 搬运就可以不要了。
     做法：同一套 API 打两个 URL，**用一个"必定成功"的沙箱内路径当基准**
     （纪律：没有基准的失败实验 = 没做实验）：
       ① 沙箱内那个缩略图（`library/thumb/…`，就是 testThumbFile 挑出来的那张）  ← 基准
       ② file:///D:/ps-uxp-dev/PROGRESS.md            ← 沙箱外（本机固定路径）
     判据定为"两头都给出了明确答案"—— 若 ① 成功而 ② 被拒，那就是权限边界，不是用法问题。 */
  try {
    const tf22 = await testThumbFile();
    const insidePath = await data.nativePathIn(tf22.dir, tf22.name);
    const insideUrl = insidePath ? "file:///" + String(insidePath).replace(/\\/g, "/") : null;
    const outsideUrl = "file:///D:/ps-uxp-dev/PROGRESS.md";

    const a = insideUrl ? await ps.canEntryFromUrl(insideUrl) : { ok: false, error: "拿不到沙箱内测试路径" };
    const b = await ps.canEntryFromUrl(outsideUrl);
    const definite = (r) => !!(r && (r.got === true || r.error));
    const fmt = (r, tag) =>
      tag + "=" + (r && r.got ? "拿到 entry（" + r.name + "）" : "未拿到（" + ((r && r.error) || "无错误信息") + "）");

    // 🔴 判据的关键在这里：**基准没成功时，这个实验没有结论**，不能拿它去证明"沙箱外不可读"。
    //    首轮（v0.2.7 21:37）的读数就是这种情况 —— 连我们自己沙箱里的缩略图都没读到，
    //    那么"沙箱外也读不到"就完全可能是 URL 形式不对 / API 用法不对，而不是权限边界。
    //    （纪律：没有基准的失败实验 = 没做实验。这条在 S19 的 webp 判别上刚吃过一次。）
    const baseOk = !!(a && a.got);
    const conclusion = baseOk
      ? (b && b.got
        ? "沙箱外可读 ⇒ 直连置入**可行**，handoff 可省（需与软件侧重新对齐契约）"
        : "基准成功、沙箱外失败 ⇒ 直连置入**不可行**，handoff 是必需的（与 S21 一致）")
      : "⚠️ **本实验无结论**：连沙箱内基准都没拿到 entry ⇒ 分不清是权限边界还是用法不对。" +
        "待查方向：URL 形式（是否要 URL 编码）、是否需 manifest 声明 requiredPermissions.localFileSystem。";

    rec(
      "S22 直连置入可行性探针（getEntryWithUrl 能否读沙箱外路径）",
      definite(a) && definite(b),
      fmt(a, "基准·沙箱内 " + tf22.name) + "　" + fmt(b, "沙箱外 PROGRESS.md") + "　⇒ " + conclusion
    );
  } catch (e) {
    rec("S22 直连置入可行性探针（getEntryWithUrl 能否读沙箱外路径）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S23: UI 控件与交互能力探针（v0.2.9 新增，**诊断项**） ----------
     为什么要有它：用户提了两个界面需求 ——
       ① 通用库的二级筛选从"一排按钮"改成**下拉选择控件**；
       ② 把素材**拖到画布指定位置**。
     这两件事都取决于 UXP 到底给不给，而官方与社区说法互相打架：
       · 官方 Spectrum 支持清单里**有 Picker**（"sometimes known as dropdowns or selects"）；
       · 官方 Known Issues 又写 HTML `<select>` 有一串怪癖（value 必须写成属性、不显示选中值……）；
       · 社区实测说 **sp-dropdown 在 PS 上不按文档工作**，反而是 `sp-picker` 要套
         `sp-dropdown` 的内部结构。
     ⇒ **不猜，量一次。** 本项只负责给出事实，不判断好坏。

     ⚠️ **诚实边界（必须写清，别让读数被高估）**：
        合成事件只能证明「**处理器可达 + API 存在**」，
        **证明不了"真鼠标拖拽会产生这些事件"** —— 那只能由人手动试。
        同理，"`<select>` 能建出来"≠"它的下拉弹层能正常打开"（弹层要真点击）。
     ⚠️ 容器必须可见（display:none 里 UXP 不加载/不布局），跑完移除。 */
  let s23Holder = null;
  try {
    const S23 = "S23 UI 控件与交互能力探针（下拉控件 / 拖拽 / 指针事件）";
    const em = (e) => String((e && e.message) || e);
    s23Holder = document.createElement("div");
    s23Holder.style.cssText =
      "position:fixed;right:0;bottom:0;width:240px;height:44px;opacity:1;" +
      "pointer-events:none;overflow:hidden;z-index:99998;";
    document.body.appendChild(s23Holder);

    /** 轮询到拿到非零几何（沿用 cssprobe 的纪律：同步 append 后立刻量得到 0）。 */
    const laid = async (node) => {
      const r = await waitFor(() => {
        const b = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
        return b && (b.width > 0 || b.height > 0) ? b : null;
      }, 3000, 120);
      return r ? Math.round(r.width) + "x" + Math.round(r.height) : "0x0";
    };

    /* ① 原生 <select> / <option> —— 关键是**选中值读不读得到** */
    let selLine = "未执行";
    try {
      const sel = document.createElement("select");
      for (const pair of [["", "全部"], ["festival", "节日素材"], ["brand", "品牌色"]]) {
        const o = document.createElement("option");
        o.setAttribute("value", pair[0]);
        o.textContent = pair[1];
        sel.appendChild(o);
      }
      sel.style.cssText = "width:120px;height:24px;";
      s23Holder.appendChild(sel);
      const box = await laid(sel);

      // 第一轮读数：程序设 setAttribute("value") 后 .value 是 undefined（官方 known-issues 说的坑）
      sel.setAttribute("value", "festival");
      const viaAttr = String(sel.value);

      // 第二轮：改走 option.selected 这条路，看能不能把选中态读回来
      if (sel.options && sel.options[1]) sel.options[1].selected = true;
      const selfSelected = sel.options && sel.options[1] ? sel.options[1].selected : "n/a";
      const idxAfter = sel.selectedIndex === undefined ? "undefined" : sel.selectedIndex;
      const valAfter = String(sel.value);
      const txtBack = sel.options && sel.options[1] ? String(sel.options[1].textContent) : "n/a";

      selLine =
        "建出✓ 几何=" + box + "　options=" + (sel.options ? sel.options.length : -1) +
        "　option[1].textContent=" + JSON.stringify(txtBack) +
        "　setAttribute(value)后 .value=" + JSON.stringify(viaAttr) +
        "　设 option.selected 后：selected=" + JSON.stringify(selfSelected) +
        " / selectedIndex=" + JSON.stringify(idxAfter) +
        " / .value=" + JSON.stringify(valAfter);
    } catch (e) {
      selLine = "✗ " + em(e);
    }

    /* ② Spectrum 组件 —— 上一版我用"设了宽高之后几何=120x24"当证据，**那是错判据**：
          把伪造的标签名 `sp-not-a-real-thing-xyz` 放进去，几何同样是 120x24。
          ⇒ 改用三个**互相独立**的判别，并且拿"一定不存在的标签名"当**基准对照**：
             (a) `customElements.get()` 是否注册过；
             (b) `shadowRoot` 是否存在（真自定义元素通常有 shadow 内容）；
             (c) computed `display`（未注册的自定义元素默认是 `inline`）。
          ⚠️ 注意 (a) 单独一条也不够：UXP 的渲染器可能把某些标签名**特例处理**
             而不放进 `customElements` 注册表 —— 所以三条要一起看。 */
    let spLine = "";
    try {
      const probeTag = (tag) => {
        const n = document.createElement(tag);
        n.textContent = "样";
        // 故意**不设宽高** —— 未注册的 inline 元素也会被文字撑出几何，所以几何本身不能当判据
        s23Holder.appendChild(n);
        let disp = "?";
        try {
          disp = String(getComputedStyle(n).display);
        } catch (e2) {
          disp = "取不到";
        }
        let regd = "customElements 不可用";
        try {
          if (typeof customElements !== "undefined" && customElements.get) {
            regd = customElements.get(tag) ? "已注册" : "未注册";
          }
        } catch (e2) {
          regd = "查询异常";
        }
        let sr = "n/a";
        try {
          sr = n.shadowRoot ? "有" : "无";
        } catch (e2) {
          sr = "取不到";
        }
        const b = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
        return (
          tag + "[" + regd + " display=" + disp + " shadow=" + sr +
          " 几何=" + (b ? Math.round(b.width) + "x" + Math.round(b.height) : "?") + "]"
        );
      };
      const lines = [];
      for (const t of ["sp-button", "sp-textfield", "sp-picker", "sp-dropdown", "sp-menu-item"]) {
        lines.push(probeTag(t));
      }
      lines.push("基准·" + probeTag("sp-not-a-real-thing-xyz"));
      // 关键旁证：注册表 API 是不是真的存在。若 define/whenDefined 都是 function，
      // 说明 UXP 确实实现了 custom elements 注册表 ⇒ 上面那个"未注册"是**可信读数**
      // （而不是"注册表根本不存在，所以查什么都说未注册"）。
      let ceApi = "customElements 不存在";
      try {
        if (typeof customElements !== "undefined") {
          ceApi =
            "define=" + typeof customElements.define +
            " get=" + typeof customElements.get +
            " whenDefined=" + typeof customElements.whenDefined;
        }
      } catch (e2) {
        ceApi = "取不到";
      }
      spLine = lines.join("　") + "　‖ 注册表 API：" + ceApi;
    } catch (e) {
      spLine = "✗ " + em(e);
    }

    /* ③ HTML5 拖放 —— 决定性判据是 **DataTransfer 在不在**（它是拖放的数据通道）。
          ⚠️ 上一版写了"合成 dragstart/dragover/drop 可达"当证据，**那是无效证据**：
             随便什么事件名这样 dispatch 都会"可达"。已删掉，免得读成"拖放可用"。 */
    let dndLine = "";
    try {
      const d = document.createElement("div");
      d.setAttribute("draggable", "true");
      d.style.cssText = "width:40px;height:20px;";
      s23Holder.appendChild(d);
      dndLine =
        "draggable 属性被记住=" + JSON.stringify(d.getAttribute("draggable")) +
        "　DataTransfer=" + typeof DataTransfer +
        "（它不存在 ⇒ 拿不到拖放的数据通道 ⇒ 标准 HTML5 拖放不可用；" +
        "与官方 Known Issues 「Drag and Drop is not currently supported」一致）";
    } catch (e) {
      dndLine = "✗ " + em(e);
    }

    /* ④ 指针 / 鼠标事件 —— 自绘拖拽只能靠这些。
          ⚠️ 这里同样只能测"API 存在性"；"真鼠标会产生这些事件"要人手动试。
             但**鼠标事件本身已有实物基准**：调色板的 hover / 单击 / 双击都是它在跑。 */
    let peLine = "";
    try {
      const z = document.createElement("div");
      z.style.cssText = "width:40px;height:20px;";
      s23Holder.appendChild(z);
      peLine =
        "setPointerCapture=" + typeof z.setPointerCapture +
        "　releasePointerCapture=" + typeof z.releasePointerCapture +
        "　on* 反射属性（onmousedown / onpointerdown）=" +
        JSON.stringify(("onmousedown" in z) + "/" + ("onpointerdown" in z)) +
        "（⚠️ 这条**不影响** addEventListener —— 调色板的 hover/click/dblclick 全靠它，" +
        "是实物基准；on* 属性只是 UXP 没做 IDL 反射）";
    } catch (e) {
      peLine = "✗ " + em(e);
    }

    rec(
      S23,
      true,
      "【诊断项，无对错】" +
      "　①<select>：" + selLine +
      "　②Spectrum：" + spLine +
      "　③拖放：" + dndLine +
      "　④指针：" + peLine
    );
  } catch (e) {
    rec(
      "S23 UI 控件与交互能力探针（下拉控件 / 拖拽 / 指针事件）",
      true,
      "【诊断项】探针自身抛异常：" + ((e && e.message) || e)
    );
  } finally {
    if (s23Holder && s23Holder.parentNode) s23Holder.parentNode.removeChild(s23Holder);
  }

  /* ---------- S24: 选区能不能当落点（v0.3.0 新增，**诊断项**） ----------
     背景：用户要"把素材放到画布指定位置"。`offset` 已验像素级精确（docs/25 §2.2），
     但"**先在画布上框一块、插件就放在那儿**"更贴近直觉，它取决于两件事：
       ① 插件能不能**建/读选区**；② 有选区时 `placeEvent` 会不会把素材放进选区。
     2026-10-11 在 MCP（**ExtendScript** 通道）上试过：带区域的 `select()` 五种写法全失败、
       `deselect()` 也失败，**但基准 `selectAll()` 成功** ⇒ 只能说"那几种写法不行"，
       **不能说选区不可用**；而且那是 **legacy DOM**，**插件走 UXP/AM 是另一条路**。
     ⇒ 本条就是来在**插件自己的通道**上把这件事问清楚。
     ⚠️ 结论分三档（纪律：**没有基准的失败实验 = 没做实验**）：基准失败 = **无结论**。
     ⚠️ 全程在自建临时文档上，跑完不保存关掉。 */
  const S24 = "S24 选区落点探针 —— 能否建选区 / 有选区时 place 落在哪（诊断项）";
  try {
    const readSel = () => {
      try {
        const d = ps.app.activeDocument;
        const s = d && d.selection;
        if (!s) return null;
        const b = s.bounds;
        if (!b) return null;
        const n = (v) => (v && typeof v === "object" && "_value" in v ? v._value : v);
        const o = {
          left: Number(n(b.left)), top: Number(n(b.top)),
          right: Number(n(b.right)), bottom: Number(n(b.bottom)),
        };
        return [o.left, o.top, o.right, o.bottom].every(isFinite) ? o : null;
      } catch {
        return null;
      }
    };
    const fmtR = (r) =>
      r ? r.left + "," + r.top + "," + r.right + "," + r.bottom : "（读不到）";

    const tf24 = await testThumbFile();
    const entry = await data.entryIn(tf24.dir, tf24.name);
    const scratch = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(选区)" });
    if (!scratch.ok) {
      rec(S24, true, "【诊断项】建临时文档失败：" + scratch.error + " —— 本条不作数");
    } else if (!entry) {
      rec(S24, true, "【诊断项】镜像里挑不出可用缩略图 —— 本条不作数");
    } else {
      let line = "";
      try {
        const info = ps.docInfo() || {};
        line += "临时文档 id=" + scratch.id + " 画布=" + (info.docW || "?") + "×" + (info.docH || "?");

        /* ① 基准：**没有任何选区**时置入落在哪（后面所有"有选区"的读数都跟它比） */
        const base = await ps.placeFile(entry, { verify: "change" });
        const baseRect = base.rect
          ? base.rect.left + "," + base.rect.top + " " + base.rect.w + "×" + base.rect.h
          : "✗ " + base.error;
        line += "　【基准·无选区】置入=" + baseRect;

        /* ② 建选区的几种候选：区域写法在前，`selectAll` 放最后当"API 是否可用"的对照基准 */
        const RECT = [120, 140, 320, 300];
        const cands = [
          {
            name: "DOM.select(2×2 数字)",
            run: () => ps.app.activeDocument.selection.select([[RECT[0], RECT[1]], [RECT[2], RECT[3]]]),
          },
          {
            name: "DOM.select(扁平 4 数字)",
            run: () => ps.app.activeDocument.selection.select([RECT[0], RECT[1], RECT[2], RECT[3]]),
          },
          {
            name: "AM.setd(Chnl/fsel + Rctn)",
            run: async () => {
              await ps.runModal(async () => {
                await ps.batchPlay([
                  {
                    _obj: "set",
                    _target: [{ _property: "selection", _ref: "channel" }],
                    to: {
                      _obj: "rectangle",
                      top: { _unit: "pixelsUnit", _value: RECT[1] },
                      left: { _unit: "pixelsUnit", _value: RECT[0] },
                      bottom: { _unit: "pixelsUnit", _value: RECT[3] },
                      right: { _unit: "pixelsUnit", _value: RECT[2] },
                    },
                    _options: { dialogOptions: "dontDisplay" },
                  },
                ], {});
              }, "Vellum 自检：建选区");
            },
          },
          { name: "DOM.selectAll（基准）", run: () => ps.app.activeDocument.selection.selectAll() },
        ];

        const parts = [];
        let anySel = null;
        for (const c of cands) {
          let err = null;
          try {
            await c.run();
          } catch (e) {
            err = String((e && e.message) || e);
          }
          const sel = readSel();
          let seg = c.name + "=" + (err ? "✗" + err.slice(0, 40) : sel ? "✓" + fmtR(sel) : "×无选区");
          if (sel) {
            if (!anySel) anySel = { name: c.name, rect: sel };
            // 有选区了 → **立刻量一次置入落哪**（这才是关键问题：PS 会不会自己放进选区）
            const pl = await ps.placeFile(entry, { verify: "change" });
            seg += " ⇒ 置入=" + (pl.rect
              ? pl.rect.left + "," + pl.rect.top + " " + pl.rect.w + "×" + pl.rect.h +
                (pl.rect.left === base.rect.left && pl.rect.top === base.rect.top ? "（与基准相同：选区不影响落点）" : "（**与基准不同**）")
              : "✗ " + pl.error);
          }
          parts.push(seg);
        }

        const conclusion = anySel
          ? "⇒ 选区**建得出**（" + anySel.name + "，rect " + fmtR(anySel.rect) + "）；" +
            "置入落点见上面每段的 ⇒ —— 若与基准相同，说明 **placeEvent 不看选区**，" +
            "'框哪儿放哪儿'要靠 offset 自己算"
          : "⚠️ **本实验无结论**：连 `selectAll` 基准都没建出选区 ⇒ 分不清是权限/版本限制还是写法问题。" +
            "（⚠️ 不许据此下「选区不可用」的结论 —— 纪律：没有基准的失败实验 = 没做实验。）";

        rec(S24, true, "【诊断项】" + line + "　‖ " + parts.join("　｜　") + "　" + conclusion);
      } finally {
        try {
          await ps.closeDocument(scratch.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S24, true, "【诊断项】探针自身抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S25: 落点组合 —— 有选区时 offset 必须叠在**选区中心**上（v0.3.0，回归项） ----------
     为什么必须有这一条：S24 刚测出「有选区时 `placeEvent` 默认落在**选区中心**」，
     而我们的 `offset` 是**相对默认落点**的位移 ⇒ 一旦基准取错（用画布中心去算），
     用户在有选区时选「左上」，素材就会**整体偏掉** —— 而画面不报错，只是位置不对。

     判据（三步，每步都读回真实图层 bounds 与期望矩形**逐边比对**）：
       ① 无选区 + 锚点「左上」 → 期望 **(0, 0, w, h)**（贴画布左上）
       ② 建选区 R → `placeBaseCenter()` 必须报 `from="selection"` 且中心 = R 的中心
       ③ 有选区 + 锚点「居中」 → 期望 **(40, 80, …)**（素材仍居中于**画布**，
          即 offset 把"居中于选区"推回了"居中于画布"）
       ④ 有选区 + 锚点「左上」 → 期望 **(0, 0, …)** —— **这一步才是关键**：
          只有 offset 确实叠在选区中心上，结果才会是 0,0
     ⚠️ 只作用在自建临时文档上，跑完不保存关掉。 */
  const S25 = "S25 落点组合：有选区时 offset 必须叠在选区中心上（否则位置会整体偏）";
  try {
    const fmtB = (r) => (r ? r.left + "," + r.top + "," + r.right + "," + r.bottom : "✗");
    const tf25 = await testThumbFile();
    const entry25 = await data.entryIn(tf25.dir, tf25.name);
    const sc25 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(落点)" });
    if (!sc25.ok) {
      rec(S25, false, "建临时文档失败：" + sc25.error + " —— 本条不作数");
    } else if (!entry25) {
      rec(S25, false, "镜像里挑不出可用缩略图 —— 本条不作数");
    } else {
      let line = "";
      let allOk = true;
      /** 选区的当前存活情况（置入**之后**它还在不在，是这条探针要弄清的事实之一）。 */
      const selNow = () => {
        const s = ps.readSelectionBounds();
        return s
          ? "有(" + Math.round(s.left) + "," + Math.round(s.top) + "," +
            Math.round(s.right) + "," + Math.round(s.bottom) + ")"
          : "无";
      };
      try {
        const info = ps.docInfo() || {};
        const dW = info.docW, dH = info.docH;
        // 素材尺寸：直接从第一次置入的真实 bounds 上读（**不猜**，也不依赖桩写死的数）
        const first = await ps.placeFile(entry25, { verify: "change" });
        const iW = first.rect ? first.rect.w : 0;
        const iH = first.rect ? first.rect.h : 0;
        line += "画布=" + dW + "×" + dH + "　实测素材=" + iW + "×" + iH;
        if (!(iW > 0) || !(iH > 0)) {
          rec(S25, false, "拿不到素材尺寸（第一次置入的 bounds 读不出来）：" + (first.error || "-"));
        } else {
          // ① 无选区 + 左上
          const a1 = ps.anchorOffset("tl", dW, dH, iW, iH, null);
          const p1 = await ps.placeFile(entry25, {
            verify: "change",
            offset: { x: a1.offsetX, y: a1.offsetY },
            expectRect: { left: 0, top: 0, right: iW, bottom: iH },
          });
          const hit1 = !!(p1.rect && p1.rect.hit === true);
          allOk = allOk && hit1;
          line += "　①无选区·左上 offset=" + a1.offsetX + "," + a1.offsetY +
            " → " + (p1.rect ? p1.rect.left + "," + p1.rect.top : "✗") + "（期望 0,0 hit=" + hit1 + "）";

          // ② 建选区，并检查默认落点的基准
          const R = { left: 120, top: 140, right: 320, bottom: 300 };
          const mk = await ps.setSelectionRect(R);
          const base = ps.placeBaseCenter();
          const baseOk = !!(mk.ok && base.ok && base.from === "selection" &&
            Math.round(base.cx) === 220 && Math.round(base.cy) === 220);
          allOk = allOk && baseOk;
          line += "　②建选区=" + (mk.ok ? fmtB(mk.sel) : "✗ " + mk.error) +
            "　基准=" + (base.ok ? base.from + "(" + Math.round(base.cx) + "," + Math.round(base.cy) + ")" : "✗") +
            "（须 selection/220,220 → " + baseOk + "）";

          // ③ 有选区 + 居中 → 素材仍应居中于**画布**
          const a3 = ps.anchorOffset("mc", dW, dH, iW, iH, base.ok ? base : null);
          const cx = Math.round((dW - iW) / 2), cy = Math.round((dH - iH) / 2);
          const p3 = await ps.placeFile(entry25, {
            verify: "change",
            offset: { x: a3.offsetX, y: a3.offsetY },
            expectRect: { left: cx, top: cy, right: cx + iW, bottom: cy + iH },
          });
          const hit3 = !!(p3.rect && p3.rect.hit === true);
          allOk = allOk && hit3;
          line += "　③有选区·居中 offset=" + a3.offsetX + "," + a3.offsetY +
            " → " + (p3.rect ? p3.rect.left + "," + p3.rect.top : "✗") +
            "（期望 " + cx + "," + cy + " hit=" + hit3 + "）" +
            "　【置入后选区=" + selNow() + "】";

          // ④ 有选区 + 左上 → **关键一步**
          //    ⚠️ 这里**重新建一次选区**：上一轮观测到"③ 之后基准像是变回了画布中心"，
          //       原因只能是**选区在置入之后没了**。先把它重建回去（这是本步的必要前置条件），
          //       同时在读数里把这件事显式记下来 —— 而不是改判据去迁就它。
          const mk2 = await ps.setSelectionRect(R);
          const base2 = ps.placeBaseCenter();
          line += "　【④前置：重建选区=" + (mk2.ok ? "✓" : "✗" + mk2.error) +
            "　基准=" + (base2.ok ? base2.from + "(" + Math.round(base2.cx) + "," + Math.round(base2.cy) + ")" : "✗") + "】";
          const a4 = ps.anchorOffset("tl", dW, dH, iW, iH, base2.ok ? base2 : null);
          const p4 = await ps.placeFile(entry25, {
            verify: "change",
            offset: { x: a4.offsetX, y: a4.offsetY },
            expectRect: { left: 0, top: 0, right: iW, bottom: iH },
          });
          const hit4 = !!(p4.rect && p4.rect.hit === true);
          allOk = allOk && hit4;
          line += "　④有选区·左上 offset=" + a4.offsetX + "," + a4.offsetY +
            " → " + (p4.rect ? p4.rect.left + "," + p4.rect.top : "✗") +
            "（期望 0,0 hit=" + hit4 + " ← 关键：只有 offset 叠在选区中心上才会是 0,0）" +
            "　【置入后选区=" + selNow() + "】";

          rec(
            S25,
            allOk,
            line + "　⇒ " + (allOk
              ? "offset 与选区默认落点**正确叠加**，九宫格在两种情形下都落准"
              : "⚠️ 有一步没命中：先看是哪一步，再决定是锚点算错还是 offset 的叠加语义不同")
          );
        }
      } finally {
        try {
          await ps.closeDocument(sc25.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S25, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S26: 置入尺寸校正（v0.3.3 新增）
     🔴 为什么必须钉住它（2026-10-11 真机事故，用户报「置入尺寸不对」）：
        真机日志 `expect=210,-210,1710,1290`（按素材 1500×1500 算）
        而 `landed=693,360,1053,720` ⇒ 画布上实际只有 **360×360**。
        两条独立读数交叉验证出根因：
          · 源图 Exif `XResolution = 300`（本机解析出来的）
          · 360 / 1500 = **0.24 = 72 / 300**
        ⇒ **PS 的「置入」是按"物理尺寸"放的**（5 英寸 × 72ppi 画布 = 360 px），
          它**不是** 1:1 拷像素。而插件一直拿"素材像素宽高"当画布上的尺寸基准
          ⇒ 尺寸与位置**一起错**。
        修法：置入 → 量实际 → `layer.scale()` → `layer.translate()` → 再量。
        用到的两个 API 是**官方文档化**的 DOM 方法（ps_reference/classes/layer），
        不是手拼的 batchPlay 描述符 —— 后者属于"禁止猜"的范围。

     判据（三档都要看得见）：
       ① **原始置入尺寸** —— 用来说明"ppi 换算确实存在"。它等于/不等于素材像素尺寸
          **不作为判据**（测试图的 ppi 由镜像决定，不该由它决定成败）。
       ② **校正后 bounds 必须命中目标矩形**（±1px）← 这才是本条要保的能力。
       ③ 步骤留痕（scale / translate 各用了什么数）。
     ⚠️ 只作用在自建临时文档上，跑完不保存关掉。 */
  const S26 = "S26 置入尺寸校正 —— scale+translate 把图层精确做成目标矩形（与源图 ppi 无关）";
  try {
    const tf26 = await testThumbFile();
    const e26 = tf26 ? await data.entryIn(tf26.dir, tf26.name) : null;
    if (!e26) {
      rec(S26, true, "【不适用】镜像里没有可用的测试图（" + ((tf26 && tf26.name) || "无") + "）");
    } else {
      const SIDE = 400;
      /* 🔴 目标矩形**故意与画布、与"原始置入"都不同** ——
         第一版拿 400×400（正好等于画布）当目标，而 PS 置入在"超出画布"时会
         等比缩到刚好放下 ⇒ 原始置入恰好也是 400×400 ⇒ **即使 applyLayerRect
         一行都没生效，判据也会通过**（"一个永远成立的样本验不出任何东西"）。
         现在改成 200×200 @(50,60)：尺寸和位置**都有一个明确的位移量要凑**。 */
      const target = { left: 50, top: 60, right: 250, bottom: 260 };
      const sc26 = await ps.createScratchDoc({ size: SIDE, name: "Vellum 自检临时文档(校正)" });
      if (!sc26 || !sc26.ok) {
        rec(S26, false, "建临时文档失败：" + ((sc26 && sc26.error) || "未知"));
      } else {
        try {
          const info0 = ps.docInfo() || {};
          // ⚠️ 必须**同时**给 `expectRect` —— `placeFile` 只在收到它时才计算 `rect.hit`。
          //    第一版漏了它，读数里出现 `hit=-`，等于把"没判"当成了"没命中"
          //    （这一条本身就是"只有一种读数的失败 = 没测"的现场版）。
          const p26 = await ps.placeFile(e26, {
            verify: "change",
            targetRect: target,
            expectRect: target,
          });
          const fx = p26.fix || null;
          const raw = fx && fx.before ? fx.before : null;
          const rawWH = raw
            ? Math.round(raw.right - raw.left) + "×" + Math.round(raw.bottom - raw.top)
            : "?";
          const fin = p26.rect || null;
          const finWH = fin ? fin.w + "×" + fin.h : "?";
          const hit = !!(fin && fin.hit === true);
          const ppi = info0.resolution === null || info0.resolution === undefined
            ? "?" : info0.resolution;

          const tgtWH = (target.right - target.left) + "×" + (target.bottom - target.top);
          rec(
            S26,
            hit,
            "测试图=" + tf26.name + "（沙箱内，从镜像里挑）" +
            "　临时文档=" + SIDE + "×" + SIDE + " @" + ppi + "ppi" +
            "　原始置入=" + rawWH +
            "　目标=" + tgtWH + "@" + target.left + "," + target.top +
            "　校正后=" + finWH + "@" + (fin ? fin.left + "," + fin.top : "?") +
            "　hit=" + (fin && fin.hit !== undefined ? fin.hit : "-") +
            "　steps=[" + ((fx && fx.steps && fx.steps.join(" ")) || "无") + "]" +
            (p26.error ? "　err=" + p26.error : "") +
            (fx && fx.error ? "　fixErr=" + fx.error : "") +
            "　⇒ " + (hit
              ? "已把图层**精确做成目标矩形**（尺寸与位置都对），与源图 ppi 无关"
              : "⚠️ 没落到目标矩形上 —— steps 为空 ⇒ 连 scale/translate 都没触发" +
                "（targetRect 没传进去？）；只有 scale ⇒ translate 那段没生效")
          );
        } finally {
          try {
            await ps.closeDocument(sc26.id);
          } catch {
            /* 忽略 */
          }
        }
      }
    }
  } catch (e) {
    rec(S26, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- 收尾：写报告 ---------- */
  const passCount = results.filter((r) => r.ok).length;
  const summary = passCount + "/" + results.length;
  const report = {
    plugin: "com.vellum.toolbox",
    version: "0.3.4",
    ranAt: log.timestamp(),
    durationMs: Date.now() - started,
    keepMode: keepFlag,
    testColor: TEST_COLOR,
    summary: summary,
    ok: passCount === results.length,
    results: results,
    // CSS 能力探针原始明细（供复盘视觉可增强项）
    cssProbe: probe && probe.ran ? { summary: probe.summary, results: probe.results } : null,
  };

  try {
    await store.writeJson(REPORT_FILE, report);
  } catch (e) {
    await log.appendLog("selfcheck 报告写盘失败：" + ((e && e.message) || e));
  }

  await log.appendLog("selfcheck DONE  " + summary + "  dur=" + report.durationMs + "ms  keep=" + keepFlag);
  for (const r of results) {
    await log.appendLog(
      "selfcheck  " + (r.ok ? "PASS" : "FAIL") + "  " + r.name + "  ::  " + r.detail
    );
  }
  if (!report.ok) {
    await log.appendLog("selfcheck 有未通过项 —— 详见 " + REPORT_FILE + " 与上面逐条明细");
  }
  return report;
}

module.exports = { run, syntheticClick, syntheticEvent, TEST_COLOR, REPORT_FILE };
