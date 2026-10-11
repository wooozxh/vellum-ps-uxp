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
 *   v0.3.8 新增（**M3「表格生成」地基探针** —— 本轮只加探针，不动 M1/M2 业务代码）：
 *   目标：开工前先把 5 个"决定架构"的问题用**真机证据**钉死（不许猜）。
 *   S31 矢量线条 = **矩形形状图层**（`contentLayer` + `shape:rectangle`）。
 *       描述符来源 = Adobe 社区一份 **ScriptListener 录制输出**（不是手拼）。
 *       判据：基准（已知可用的内容图层建法）成功 + `kind === "solidColor"` +
 *       图层 bounds 命中目标矩形 + 线内取样色命中（两条独立读数）。
 *   S32 文字图层精细参数 —— 建层走 **Adobe 官方样例**的**框文本**描述符
 *       （`char:box` + `bounds`，表格每格要的就是它）；字体/字号/对齐/行距/颜色
 *       改走 **UXP DOM `layer.textItem`**，逐项试写并**读回**，另配"一定不存在"的
 *       属性名当对照，防止把"读到自己设的输入"误当成"能力存在"。
 *   S33 **批量出稿的形态**（架构级）—— ① 查 `dataSets`/`variables` 这些
 *       "变量 + 数据组"接口在 UXP 侧到底有没有（配对照项）；② 同时实测替代路径
 *       **复制图层组 + 逐组换文字**，判据是"**副本变了 且 原件没变**"。
 *   S34 图层规模 —— 实测 N 个框文本图层的**单层成本**（不可能真建 2000 层，
 *       那是拿用户机器做压力测试），并比 **逐条循环 vs 一次 batchPlay 批量**。
 *   S35 CSV 输入侧 —— 文件选择器只能验"API 在不在"（真弹窗自检点不了，如实标注）；
 *       能测的是解码：utf-8 / **GBK、GB18030**（用写死的已知答案 `D6 D0 CE C4` = "中文"），
 *       外加**负对照**（伪造编码名必须抛，否则前两项的通过没有意义）+ CSV 往返。
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
const csv = require("./csv.js");
const tbl = require("./table.js");

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
      /* 🔴 记**最后一次读数**（含失败原因）：只写"未命中"的话，下一次还得猜是
         "读像素抛错了" 还是 "读到了但不是目标色"（v0.4.5：真机上这两种都出现过）。 */
      let pixLast16 = null;
      const pix = await waitFor(async () => {
        const p = await ps.readLayerAvgColor();
        pixLast16 = p;
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
        "　最后一次读数=" + (pixLast16 ? (pixLast16.ok ? pixLast16.hex : "✗抛错：" + (pixLast16.error || "?")) : "没读到") +
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
      const seedErr = seeded.ok ? null : (seeded.error || "?");

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
        "　建层色=" + seed + "→回读 " + (seeded.hex || "✗抛错：" + seedErr) + (seedOk ? " ✓" : " ✗") +
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

  /* ---------- S28: 素材缺 `width`/`height` 时的兜底（v0.3.5 新增）
     🔴 契约 §5.4 明确 `width`/`height` **可能为 null**（PSD / PDF / 视频探不到尺寸）。
        没有兜底时，`anchorInfo()` 会返回"算不出来" ⇒ 调用方什么都不传
        ⇒ 退回最原始的置入（画布居中）—— **用户选的落点九宫格被静默忽略**。
     修法：拿不到尺寸时，把"PS 给的实际尺寸"当成目标尺寸，**只定位、不改尺寸**。

     判据三条，都点在"这次到底做了什么"上（不是"没报错"）：
       ① `fix.byActualSize === true` —— 确实走的是"只定位"这条路
       ② 置入后**右上角贴住画布右上角**（±1px）—— 锚点真的生效了
       ③ 校正前后**宽高一致** —— 这才叫"只定位"（不是偷偷缩放了一下）
     ⚠️ 只作用在自建临时文档上，跑完关掉。 */
  const S28 = "S28 缺素材尺寸时仍能定位（anchorPlace：只定位、不改尺寸）";
  try {
    const tf28 = await testThumbFile();
    const e28 = tf28 ? await data.entryIn(tf28.dir, tf28.name) : null;
    if (!e28) {
      rec(S28, true, "【不适用】镜像里没有可用的测试图（" + ((tf28 && tf28.name) || "无") + "）");
    } else {
      /* 🔴 画布必须**明显大于**素材（这里 2000 > 缩略图换算后的 ~907）——
         否则 PS 的"超出画布就等比缩到适应"会让素材**填满画布**，那时"贴右上"和"贴左上"
         都是 0,0，**锚点生没生效根本测不出来**（第一版用 400×400，素材正好缩成 400×400，
         判据 `0+400 == 400` 是**碰巧**成立的 —— 又一次"样本没有区分度"）。 */
      const SIDE = 2000;
      const sc28 = await ps.createScratchDoc({ size: SIDE, name: "Vellum 自检临时文档(兜底)" });
      if (!sc28 || !sc28.ok) {
        rec(S28, false, "建临时文档失败：" + ((sc28 && sc28.error) || "未知"));
      } else {
        try {
          const p28 = await ps.placeFile(e28, {
            verify: "change",
            anchorPlace: { anchor: "tr", docW: SIDE, docH: SIDE },
          });
          const fx = p28.fix || null;
          const fin = p28.rect || null;
          const bW = fx && fx.before ? Math.round(fx.before.right - fx.before.left) : 0;
          const bH = fx && fx.before ? Math.round(fx.before.bottom - fx.before.top) : 0;
          const aW = fx && fx.after ? Math.round(fx.after.right - fx.after.left) : 0;
          const aH = fx && fx.after ? Math.round(fx.after.bottom - fx.after.top) : 0;
          const sizedSame = bW > 0 && bW === aW && bH === aH;
          // ⚠️ 必须要求 `fin.left > 0` —— 素材若恰好填满画布，"右上"也会是 0,0，
          //    那样这条判据就是"永远成立"（第一版正是这么过的）。
          const atTopRight =
            !!fin && fin.left > 0 &&
            Math.abs(fin.left + fin.w - SIDE) <= 1 && Math.abs(fin.top) <= 1;
          const byActual = !!(fx && fx.byActualSize);

          rec(
            S28,
            byActual && atTopRight && sizedSame,
            "锚点=右上（画布 " + SIDE + "×" + SIDE + "）" +
            "　走「只定位」那条路=" + byActual +
            "　落点=" + (fin ? fin.left + "," + fin.top + " (" + fin.w + "×" + fin.h + ")" : "?") +
            "（须右上角贴 " + SIDE + ",0）" +
            "　尺寸未改=" + sizedSame + "（" + bW + "×" + bH + " → " + aW + "×" + aH + "）" +
            (fx && fx.error ? "　fixErr=" + fx.error : "")
          );
        } finally {
          try {
            await ps.closeDocument(sc28.id);
          } catch {
            /* 忽略 */
          }
        }
      }
    }
  } catch (e) {
    rec(S28, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S29: 置入的图层按素材名命名（v0.3.6 新增）
     PS 置入时拿"**被置入文件的名字**"当图层名，而契约 §六 规定交接文件固定叫
     `incoming.<ext>` ⇒ 每个新图层都叫 `incoming`。这里改成读镜像的 `asset.name`。

     判据两条（都要**读回**验证，不看"命令没报错"）：
       ① 第一次置入 → 图层名正好是**去掉扩展名**的素材名（`自检素材.jpg` → `自检素材`）
       ② 再置入一次同名素材 → 必须变成 **`自检素材 (2)`**（用户拍板的去重规则）
     ⚠️ 用**假 asset**（只用到 `name`/`ext`）⇒ 不依赖镜像里恰好有什么名字。
     ⚠️ 只作用在自建临时文档上，跑完关掉。 */
  const S29 = "S29 置入的图层按素材名命名（去扩展名 + 同名加 (n)）";
  try {
    const tf29 = await testThumbFile();
    const e29 = tf29 ? await data.entryIn(tf29.dir, tf29.name) : null;
    if (!e29) {
      rec(S29, true, "【不适用】镜像里没有可用的测试图（" + ((tf29 && tf29.name) || "无") + "）");
    } else {
      const SIDE = 400;
      const sc29 = await ps.createScratchDoc({ size: SIDE, name: "Vellum 自检临时文档(命名)" });
      if (!sc29 || !sc29.ok) {
        rec(S29, false, "建临时文档失败：" + ((sc29 && sc29.error) || "未知"));
      } else {
        try {
          const fake = { name: "自检素材.jpg", ext: "jpg" };

          const p1 = await ps.placeFile(e29, { verify: "change" });
          const first = p1.ok && p1.changed
            ? await ps.renameInsertedLayer(fake)
            : { ok: false, error: "置入失败：" + (p1.error || "图层数没变") };

          const p2 = await ps.placeFile(e29, { verify: "change" });
          const second = p2.ok && p2.changed
            ? await ps.renameInsertedLayer(fake)
            : { ok: false, error: "第二次置入失败：" + (p2.error || "图层数没变") };

          const ok1 = !!(first && first.ok && first.want === "自检素材");
          const ok2 = !!(second && second.ok && second.want === "自检素材 (2)");

          rec(
            S29,
            ok1 && ok2,
            "基名=" + JSON.stringify((first && first.base) || "") + "（须「自检素材」—— 不带 .jpg）" +
            "　① 期望「自检素材」→ 实得 " + JSON.stringify((first && first.got) || "") +
            "　② 期望「自检素材 (2)」→ 实得 " + JSON.stringify((second && second.got) || "") +
            (first && first.ambiguous ? "　（①读回的名字在文档里存在 ⇒ 可能是 PS 自己加了副本后缀）" : "") +
            (first && first.error ? "　1st err=" + first.error : "") +
            (second && second.error ? "　2nd err=" + second.error : "")
          );
        } finally {
          try {
            await ps.closeDocument(sc29.id);
          } catch {
            /* 忽略 */
          }
        }
      }
    }
  } catch (e) {
    rec(S29, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S30: 下拉触发条里三个片段「同顶同高」（v0.3.7 新增）
     用户 2026-10-11 报：「下拉菜单控件文字旁边的数字都会高一点」。
     根因：`vertical-align: top` 对**纯文本**与**inline-block** 的语义不同 ——
        · inline-block ⇒ 它的**盒子顶**贴行盒顶（盒内文字居中）；
        · 纯文本 ⇒ **内容区顶**贴行盒顶，而内容区只有 ~13px、行盒 20px
          ⇒ 它比居中位置**高约 3px**。
     修法：`.fs-t` / `.fs-n` / `.fs-cv` 全部做成 20px 高的 inline-block。
     判据：三个片段的 `offsetTop` 一致、`offsetHeight` 一致（±1px）——
        **盒对齐 + 盒内文字居中 ⇒ 视觉上就是对齐的**（文字本身的渲染位置量不到，
        但"同盒"是可测的、且是这件事的充分条件）。
     ⚠️ 当前库里没有下拉触发条时（不构成筛选时不画）记「不适用」，不判失败。 */
  const S30 = "S30 下拉触发条三个片段同顶同高（计数/箭头不再比文字高一点）";
  try {
    const probes = [];
    for (const id of ["vt-lib-subsel", "vt-lib-projsel"]) {
      const el = document.getElementById(id);
      if (el && el.children && el.children.length >= 2) probes.push({ id: id, el: el });
    }
    if (!probes.length) {
      rec(S30, true, "【不适用】当前界面里没有下拉触发条（不构成筛选时不画）—— 本条不判失败");
    } else {
      let allOk = true;
      const bits = [];
      for (const p of probes) {
        const tops = [];
        const hs = [];
        const names = [];
        for (let i = 0; i < p.el.children.length; i++) {
          const c = p.el.children[i];
          const cls = String((c.getAttribute && c.getAttribute("class")) || "");
          const first = cls.split(/\s+/)[0];
          if (first !== "fs-t" && first !== "fs-n" && first !== "fs-cv") continue;
          names.push(first);
          tops.push(c.offsetTop || 0);
          hs.push(c.offsetHeight || 0);
        }
        const dt = tops.length ? Math.max.apply(null, tops) - Math.min.apply(null, tops) : 99;
        const dh = hs.length ? Math.max.apply(null, hs) - Math.min.apply(null, hs) : 99;
        const ok = tops.length >= 2 && dt <= 1 && dh <= 1;
        if (!ok) allOk = false;
        bits.push(
          p.id + "[" + names.join(",") + "]　top=" + tops.join("/") +
          "　高=" + hs.join("/") + (ok ? " ✓" : " ✗")
        );
      }
      rec(S30, allOk, bits.join("　‖　") + "　（须 top 与高都一致，±1px）");
    }
  } catch (e) {
    rec(S30, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S31: 矢量线条 = 矩形形状图层（v0.3.8 新增，M3 地基）
     🔴 表格框线要「矢量 + 可继续编辑」⇒ 不能用像素图层画线。
        而 UXP 里**没有建形状图层的 DOM API** ⇒ 必须走 batchPlay，且描述符**不许手拼**。
        来源 = Adobe 社区一份 **ScriptListener 录制输出**（见 lib/ps.js rectShapeMakeDesc 顶部注释）。

     判据分档（先造"必定成功"的基准把变量分开）：
       ① **基准**：已知可用的内容图层建法（makeSolidColorLayer）—— 基准失败 ⇒ 本条**无结论**
       ② 目标：细矩形形状图层建出来了，且 `kind === "solidColor"`（矢量，不是 pixel）
       ③ 两条**互相独立**的读数：图层 bounds 命中目标矩形（±1px）＋ 线内取样色 = 目标色（±25）
     ⚠️ 只作用在自建临时文档上，跑完不保存关掉。 */
  const S31 = "S31 矢量线条 = 矩形形状图层（contentLayer + shape:rectangle；kind=solidColor 才算矢量）";
  try {
    const SIDE = 400;
    const sc31 = await ps.createScratchDoc({ size: SIDE, name: "Vellum 自检临时文档(线条)" });
    if (!sc31 || !sc31.ok) {
      rec(S31, false, "建临时文档失败：" + ((sc31 && sc31.error) || "未知"));
    } else {
      try {
        // ① 基准：已知能建出来的内容图层（不是本次要验的东西，只用来把变量分开）
        const n0 = ps.countLayers();
        await ps.makeSolidColorLayer({ r: 10, g: 200, b: 120 });
        const n1 = ps.countLayers();
        const baseOk = n0 >= 0 && n1 > n0;

        // ② 目标：一条 320×4 的横线（表格线就长这样）
        const line = { left: 40, top: 100, right: 360, bottom: 104 };
        const want = { r: 230, g: 0, b: 18 };
        const mk = await ps.makeRectShapeLayer(line, want, {});
        const li = mk.ok ? ps.layerInfo() : null;
        const kindOk = !!(li && li.ok && li.kind === "solidColor");
        const bb = ps.readActiveLayerBounds();
        const hitRect = !!(mk.ok && bb.ok &&
          Math.abs(bb.bounds.left - line.left) <= 1 &&
          Math.abs(bb.bounds.top - line.top) <= 1 &&
          Math.abs(bb.bounds.right - line.right) <= 1 &&
          Math.abs(bb.bounds.bottom - line.bottom) <= 1);
        // ③ 线内取色（避开抗锯齿边缘）
        const sample = mk.ok
          ? await ps.sampleRectAvgColor({ left: 200, top: 101, right: 260, bottom: 103 })
          : { ok: false, error: "没建出图层" };
        const wantHex = ps.rgbToHex(want);
        const hitColor = !!(sample.ok && sample.rgb &&
          Math.abs(sample.rgb.r - want.r) <= 25 &&
          Math.abs(sample.rgb.g - want.g) <= 25 &&
          Math.abs(sample.rgb.b - want.b) <= 25);

        if (!baseOk) {
          rec(S31, true, "【无结论】基准（已知可用的内容图层建法）就失败了（" + n0 + "→" + n1 + "）" +
            " ⇒ 本次读数不能下任何结论　attempts=[" + ((mk.attempts || []).join(" ")) + "]");
        } else {
          // 取样能力本身不可用时，不拿它判死（如实标注"这一半没测"）
          const judge = kindOk && hitRect && (!sample.ok ? true : hitColor);
          rec(
            S31,
            judge,
            "基准=内容图层建成（" + n0 + "→" + n1 + "）" +
            "　形状写法=" + (mk.via || "-") +
            "　kind=" + ((li && li.kind) || "-") + "（须 solidColor；是 pixel 就说明画成像素了）" +
            "　bounds=" + (bb.ok
              ? [Math.round(bb.bounds.left), Math.round(bb.bounds.top), Math.round(bb.bounds.right), Math.round(bb.bounds.bottom)].join(",")
              : "-") +
            "（须 " + [line.left, line.top, line.right, line.bottom].join(",") + "）" +
            "　线内取色=" + (sample.ok ? sample.hex + "✓判" : "取不到（" + (sample.error || "?") + "）不判") +
            "（须 " + wantHex + "，±25）" +
            "　attempts=[" + ((mk.attempts || []).join(" ")) + "]" +
            (mk.error ? "　err=" + mk.error : "") +
            "　⇒ " + (judge
              ? "表格框线可做成**矢量形状图层**（每格线一层，可继续编辑）"
              : "⚠️ 未成立：见 attempts（两条候选都失败 ⇒ 换路）")
          );
        }
      } finally {
        try {
          await ps.closeDocument(sc31.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S31, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S32: 文字图层精细参数（v0.3.8 新增，M3 地基）
     表格每格一个文字框，需要 **字体 / 对齐 / 行距 / 颜色**，而现有 `makeTextLayer`
     只给了内容/字号/位置 ⇒ 得先问清楚"这些参数归谁管"。

     两半分开问：
       ① 建层：走 **Adobe 官方样例**的框文本描述符（`char:box` + `bounds` + fontName/size/color）
          ⇒ 判据 `kind === "text"`（建出来的是真文字图层，不是像素）
       ② 精细参数：**UXP DOM 的 `layer.textItem`** 能不能读、能不能写（逐个试写并**读回**）
          配一个"一定不存在"的属性名当对照，防止把"读到自己设的输入"当成"能力存在"
     ⚠️ 只作用在自建临时文档上，跑完关掉。 */
  const S32 = "S32 文字图层样式 —— 建层用官方框文本描述符；样式走 AM（DOM 只接了 contents）";
  try {
    const sc32 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(文字)" });
    if (!sc32 || !sc32.ok) {
      rec(S32, false, "建临时文档失败：" + ((sc32 && sc32.error) || "未知"));
    } else {
      try {
        const mk32 = await ps.makeTextLayerBox({
          text: "单元格 A1",
          box: { left: 40, top: 60, right: 360, bottom: 120 },
          sizePt: 24,
          rgb: { r: 20, g: 20, b: 20 },
        });
        const li32 = ps.layerInfo();
        const kindOk = !!(li32.ok && li32.kind === "text");

        /* ① 读回 textKey —— 先看清 PS 自己吐出来的键名与枚举族名（这就是"钉死命令形状"），
              再谈怎么改。顺带验证"建层时给的 size/color 到底生效没有"。 */
        const tk0 = await ps.readTextKeyDesc();
        const s0 = tk0.ok ? ps.summarizeTextKey(tk0.raw) : null;

        /* ② DOM 的 textItem 能控什么（逐个试写并读回；原值读不到就不试） */
        const pr = ps.textItemProbe();
        const tries = [];
        if (pr.textItemExists) {
          tries.push(await ps.trySetTextItem("contents", "M3 探针"));
          tries.push(await ps.trySetTextItem("fontSize", 36));
          tries.push(await ps.trySetTextItem("leading", 40));
          tries.push(await ps.trySetTextItem("tracking", 120));
          tries.push(await ps.trySetTextItem("justification", (require("photoshop").constants || {}).Justification
            ? require("photoshop").constants.Justification.CENTER
            : undefined));
        }

        /* ③ AM 改样式：字号 + 颜色（用 v0.2.4 已验证的 `set textStyle` 模板泛化而来） */
        const wantSize = 40;
        const wantRgb = { r: 230, g: 0, b: 18 };
        const st = await ps.applyTextStyle({ sizePt: wantSize, color: wantRgb });
        const tk1 = await ps.readTextKeyDesc();
        const s1 = tk1.ok ? ps.summarizeTextKey(tk1.raw) : null;
        const sizeOk = !!(st.ok && s1 && Math.abs(Number(s1.size) - wantSize) < 0.6);
        const colorOk = !!(st.ok && s1 && s1.color &&
          Math.abs(s1.color.r - wantRgb.r) <= 2 &&
          Math.abs(s1.color.g - wantRgb.g) <= 2 &&
          Math.abs(s1.color.b - wantRgb.b) <= 2);

        /* ④ 对齐：**枚举族名只能从读回的描述符里拿**（不猜）。
              第二轮读数已确认 justification / leading **不在 textStyle 里**
              （textStyle 只有 autoLeading / baselineShift）⇒ 去段落层找：
              命中就"把读回来的描述符改一个字段再写回"（描述符形状是 PS 自己给的，不是手拼）。 */
        let justTried = false;
        let justOk = false;
        let justNote = "段落样式里既没有 align 也没有 justification ⇒ 没试（不猜枚举族名）。" +
          "下一步：在 PS 里录一个「居中对齐」的动作 → 动作面板「复制为 JavaScript」";
        const pj = (s1 && (s1.paragraphAlign || s1.paragraphJustification)) || null;
        const pjField = s1 && s1.paragraphAlign ? "align" : "justification";
        if (pj && pj.cls) {
          justTried = true;
          /* 两条候选，按序试并分别读数（"命令没报错但值没变"是最难查的一类 ⇒ 必须读回）：
             A 把**读回来的整份 textKey**改一个字段再写回（描述符形状是 PS 自己给的）
             B 直接 `set` `_property:"paragraphStyle"`，只带 align 一个字段
                （属性名与已验证的 textStyle 同一套写法；字段名/枚举族是读回来的） */
          let mutated = null;
          let mutateErr = null;
          try {
            mutated = JSON.parse(JSON.stringify(tk1.raw));
            const tkDesc = mutated.textKey ? mutated.textKey : mutated;
            const ranges = tkDesc.paragraphStyleRange || [];
            if (!ranges[0] || !ranges[0].paragraphStyle) {
              throw new Error("读回的描述符里没有 paragraphStyle 可改");
            }
            ranges[0].paragraphStyle[pjField] = { _enum: pj.cls, _value: "center" };
          } catch (e) {
            mutateErr = (e && e.message) || String(e);
          }
          const parts = [];
          if (mutateErr) {
            parts.push("A·改描述符失败(" + mutateErr + ")");
          } else {
            const wA = await ps.applyTextLayerDesc(mutated);
            const tkA = await ps.readTextKeyDesc();
            const sA = tkA.ok ? ps.summarizeTextKey(tkA.raw) : null;
            const gA = sA && (sA.paragraphAlign || sA.paragraphJustification);
            const okA = !!(wA.ok && gA && gA.value === "center");
            parts.push("A·写回整份 textKey=" + (okA ? "✓" : "✗ 实得 " + ((gA && gA.value) || "?")));
            if (okA) justOk = true;
          }
          if (!justOk) {
            const wB = await ps.applyParagraphStyle({ align: { cls: pj.cls, value: "center" } });
            const tkB = await ps.readTextKeyDesc();
            const sB = tkB.ok ? ps.summarizeTextKey(tkB.raw) : null;
            const gB = sB && (sB.paragraphAlign || sB.paragraphJustification);
            const okB = !!(wB.ok && gB && gB.value === "center");
            parts.push("B·set paragraphStyle=" + (okB ? "✓" : "✗ 实得 " + ((gB && gB.value) || "?") +
              (wB.error ? "(" + wB.error + ")" : "")));
            if (okB) justOk = true;
          }
          justNote = "字段 " + pjField + "·枚举族=" + pj.cls + "（原值 " + pj.value + "）→ 试 center： " +
            parts.join("　") + (justOk ? " ⇒ 对齐可设 ✓" : " ⇒ **对齐仍未打通**");
        }

        const contentsOk = !!(tries.some((t) => t.prop === "contents" && t.ok));
        const bad = tries.filter((t) => !t.ok);
        // 判据 = 建的是真文字层 + 后期能换文字（批量出稿的命脉）+ 字号/颜色改得动
        const judge = kindOk && contentsOk && sizeOk && colorOk;

        rec(
          S32,
          judge,
          "建层=" + (mk32.ok ? "成功" : "失败(" + (mk32.error || "?") + ")") +
          "　kind=" + ((li32 && li32.kind) || "-") + "（须 text）" +
          "　‖ 建层后 textKey 读回" + (tk0.ok ? "（" + tk0.bytes + "B）" : "失败:" + tk0.error) +
          "　textKey 顶层键=[" + ((s0 && s0.keys) || []).join(",") + "]" +
          "　textStyle 键=[" + ((s0 && s0.styleKeys) || []).join(",") + "]" +
          "　建层给定 24pt→读回 " + ((s0 && s0.size) || "?") +
          "　建层给定 #141414→读回 " + (s0 && s0.color ? ps.rgbToHex(s0.color) : "?") +
          "　框文本 char=" + ((s0 && s0.shapeChar) || "?") +
          "　段落样式键=[" + ((s0 && s0.paragraphStyleKeys) || []).join(",") + "]" +
          "　段落对齐字段=" + (s0 && (s0.paragraphAlign || s0.paragraphJustification)
            ? (s0.paragraphAlign ? "align" : "justification") + ":" +
              (s0.paragraphAlign || s0.paragraphJustification).value
            : "无") +
          "　段落行距类型=" + (s0 && s0.paragraphLeadingType
            ? s0.paragraphLeadingType.cls + ":" + s0.paragraphLeadingType.value : "无") +
          "　‖ DOM textItem：存在=" + pr.textItemExists +
          "　能读的=[" + (pr.keys || []).join(",") + "]" +
          "　对照·__vellumNotARealThing=" + pr.notARealThing +
          "　contents 可写=" + contentsOk +
          (bad.length ? "　DOM 未通过=[" + bad.map((t) => t.prop).join(",") + "]" : "") +
          "　‖ AM 改样式：目标 " + wantSize + "pt → 读回 " + ((s1 && s1.size) || "?") +
          "（" + (sizeOk ? "✓" : "✗") + "）　目标 " + ps.rgbToHex(wantRgb) +
          " → 读回 " + (s1 && s1.color ? ps.rgbToHex(s1.color) : "?") + "（" + (colorOk ? "✓" : "✗") + "）" +
          "　‖ 对齐：" + justNote +
          "　⇒ " + (judge
            ? "字号/颜色/排版能改（AM），文字内容能换（DOM）" +
              (justTried ? (justOk ? "，对齐也能设" : "，**对齐还没打通**") : "，对齐那项待定")
            : "⚠️ 未成立 —— 分段读数见上（哪些能、哪些不能，不要一概而论）")
        );
      } finally {
        try {
          await ps.closeDocument(sc32.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S32, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S33: 批量出稿的地基（v0.3.8 新增，M3 **架构级**问题）
     用户记的是"把表格的列绑定到图层，按行批量生成稿件"。
     PS 的「变量 + 数据组」是 **ExtendScript 侧**的东西，UXP 侧大概率没有 ⇒ 先查清楚。
     查不清就别把架构压在它上面 ⇒ 同时实测**替代路径**：复制图层组 + 逐组换文字。

     两部分：
       ① 能力存在性（`doc.dataSets` / `doc.variables` …）—— 配"一定不存在"的对照属性名
       ② 实操：建组 → 组里两个文字层 → **复制组** → 只改副本组里的文字
          ⇒ 判据是 **副本变了 + 原件没变**（这两条一起才叫"逐组换文字"） */
  const S33 = "S33 批量出稿地基 —— 变量/数据组 API 是否存在 + 复制图层组并逐组换文字";
  try {
    const sc33 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(批量)" });
    if (!sc33 || !sc33.ok) {
      rec(S33, false, "建临时文档失败：" + ((sc33 && sc33.error) || "未知"));
    } else {
      try {
        /* ① 能力存在性 —— 注意必须配对照，否则"读到了个 undefined"会被误读成"存在" */
        const surf = {};
        const probeProp = (label, fn) => {
          try {
            const v = fn();
            surf[label] = v === undefined ? "undefined" : (v === null ? "null" : typeof v);
          } catch (e) {
            surf[label] = "抛异常";
          }
        };
        try {
          const d = ps.app.activeDocument;
          probeProp("doc.dataSets", () => d.dataSets);
          probeProp("doc.variables", () => d.variables);
          probeProp("doc.layerComps", () => d.layerComps);
          probeProp("app.variables", () => ps.app.variables);
          probeProp("对照·__vellumNotARealThing", () => d.__vellumNotARealThing);
        } catch (e) {
          surf.top = String((e && e.message) || e);
        }

        /* ② 复制图层组 + 逐组换文字 */
        /* ⚠️ 计数必须**递归**：组里的文字层不会让 `doc.layers.length` 变（第一版就栽在这，
           读数写着"组内两个文字层=false"，其实两层都在 —— 是判据口径错，不是平台不行）。 */
        const deepBefore = ps.countLayersDeep();
        const grp = await ps.makeGroup("稿件 1");
        const tA = await ps.makeTextLayerBox({
          text: "旧值-A", box: { left: 40, top: 60, right: 200, bottom: 100 },
          sizePt: 18, rgb: { r: 0, g: 0, b: 0 },
        });
        const tB = await ps.makeTextLayerBox({
          text: "旧值-B", box: { left: 210, top: 60, right: 360, bottom: 100 },
          sizePt: 18, rgb: { r: 0, g: 0, b: 0 },
        });
        const deepAfter = ps.countLayersDeep();
        const bothPlaced = deepAfter - deepBefore === 3; // 组 + 两个文字层
        const nG = ps.countLayers();

        /** 列出所有文字层：{组名, 图层名, 内容} —— 用来判"副本变了、原件没变"。 */
        const listCells = () => {
          const out = [];
          const walk = (arr, parent) => {
            for (const l of arr || []) {
              const isGrp = l.kind === "group";
              if (isGrp) walk(l.layers, l);
              else {
                let c = null;
                try {
                  c = l.textItem ? l.textItem.contents : null;
                } catch {
                  c = null;
                }
                if (c !== null && c !== undefined) {
                  out.push({ group: parent ? String(parent.name) : "(根)", name: String(l.name), contents: String(c) });
                }
              }
            }
          };
          try {
            walk(ps.app.activeDocument.layers, null);
          } catch {
            /* 忽略 */
          }
          return out;
        };

        // 选中组（DOM：activeLayers 可赋值 —— 这条本身也是能力读数）
        let selErr = null;
        try {
          await ps.runModal(async () => {
            const d = ps.app.activeDocument;
            let g = null;
            const walk = (arr) => {
              for (const l of arr || []) {
                if (l.kind === "group" && String(l.name).indexOf("稿件 1") >= 0) {
                  g = l;
                  return;
                }
                if (!g && l.layers && l.layers.length) walk(l.layers);
              }
            };
            walk(d.layers);
            if (!g) throw new Error("找不到刚建的组");
            d.activeLayers = [g];
          }, "Vellum 工具箱：选中图层组");
        } catch (e) {
          selErr = (e && e.message) || String(e);
        }
        const dup = selErr ? { ok: false, error: "选中组失败：" + selErr } : await ps.duplicateActiveLayer();
        const nD = ps.countLayers();

        // 找到**副本组**里的文字层（副本组名通常带"副本"），只改它
        let changed = null;
        let editErr = null;
        if (dup.ok) {
          try {
            await ps.runModal(async () => {
              const d = ps.app.activeDocument;
              let target = null;
              for (const l of d.layers) {
                if (l.kind !== "group") continue;
                if (String(l.name).indexOf("稿件 1") < 0) continue;
                if (String(l.name) === "稿件 1") continue; // 排除原件
                const kids = l.layers || [];
                for (const k of kids) {
                  let c = null;
                  try {
                    c = k.textItem ? k.textItem.contents : null;
                  } catch {
                    c = null;
                  }
                  if (String(c) === "旧值-A") {
                    target = k;
                    break;
                  }
                }
                if (target) break;
              }
              if (!target) throw new Error("副本组里找不到内容为「旧值-A」的文字层");
              d.activeLayers = [target];
              target.textItem.contents = "新值-A";
            }, "Vellum 工具箱：改副本组里的文字");
          } catch (e) {
            editErr = (e && e.message) || String(e);
          }
          const cells = listCells();
          const origGroup = cells.filter((c) => c.group === "稿件 1" && c.contents === "旧值-A");
          const dupGroup = cells.filter((c) => c.group !== "稿件 1" && c.group.indexOf("稿件 1") >= 0);
          const dupChanged = dupGroup.some((c) => c.contents === "新值-A");
          const origIntact = origGroup.length > 0;
          changed = {
            ok: dupChanged && origIntact,
            dupChanged: dupChanged,
            origIntact: origIntact,
            groups: cells.map((c) => c.group + ":" + c.contents).join("｜"),
          };
        }

        const judge = !!(grp.ok && bothPlaced && dup.ok && changed && changed.ok);
        rec(
          S33,
          judge,
          "① 变量/数据组 API：" + JSON.stringify(surf) +
          "（对照项若也是 undefined ⇒ 这些读数只说明「没暴露」，不说明「有」）" +
          "　‖　② 建组=" + grp.ok + "　组内两个文字层=" + bothPlaced +
          "（递归计数 " + deepBefore + "→" + deepAfter + "，须 +3）" +
          "　选中组=" + (selErr ? "✗" + selErr : "✓") +
          "　复制组=" + (dup.ok ? "✓（图层 " + nG + "→" + nD + "）" : "✗" + dup.error) +
          "　逐组换文字=" + (changed ? (changed.ok ? "✓" : "✗") : "✗" + (editErr || "未执行")) +
          "　副本改了=" + (changed ? changed.dupChanged : "-") +
          "　原件未变=" + (changed ? changed.origIntact : "-") +
          "　[cells " + (changed ? changed.groups : "-") + "]" +
          (editErr ? "　editErr=" + editErr : "") +
          "　⇒ " + (judge
            ? "**复制图层组 + 逐组换文字**这条路成立（批量出稿不必依赖变量/数据组）"
            : "⚠️ 未成立 —— 见上面分段读数，别一概而论")
        );
      } finally {
        try {
          await ps.closeDocument(sc33.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S33, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S34: 图层规模（v0.3.8 新增，M3 上限策略的依据）
     6 行 × 5 列 ≈ 60 层；200 行 × 10 列 = 2000+ 层。**不可能真建 2000 层去试**
     （会拖死 PS，也是拿用户机器做压力测试）⇒ 实测**单层成本**，再据此定上限策略。

     同时比**两种发命令的方式**（这决定实现方式，不是微优化）：
       A：每条描述符各自一个 runModal 循环
       B：N 条描述符塞进**一次** batchPlay（batchPlay 本来就接受数组）
     ⚠️ 只作用在自建临时文档上，跑完关掉。 */
  const S34 = "S34 图层规模 —— N 个框文本图层实测耗时；单条循环 vs 一次 batchPlay 批量";
  try {
    const N = 15;
    const sc34 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(规模)" });
    if (!sc34 || !sc34.ok) {
      rec(S34, false, "建临时文档失败：" + ((sc34 && sc34.error) || "未知"));
    } else {
      try {
        const boxOf = (i) => ({ left: 20, top: 20 + (i % 18) * 20, right: 220, bottom: 40 + (i % 18) * 20 });
        const nA0 = ps.countLayers();

        const tA = Date.now();
        let failA = 0;
        for (let i = 0; i < N; i++) {
          const r = await ps.makeTextLayerBox({ text: "A" + i, box: boxOf(i), sizePt: 12, rgb: { r: 0, g: 0, b: 0 } });
          if (!r.ok) failA++;
        }
        const msA = Date.now() - tA;
        const nA1 = ps.countLayers();

        const descs = [];
        for (let i = 0; i < N; i++) {
          descs.push(ps.textLayerBoxDesc({ text: "B" + i, box: boxOf(i), sizePt: 12, rgb: { r: 0, g: 0, b: 0 } }));
        }
        const tB = Date.now();
        let batchErr = null;
        try {
          await ps.runModal(async () => {
            await ps.batchPlay(descs, {});
          }, "Vellum 工具箱：批量新建文字图层");
        } catch (e) {
          batchErr = (e && e.message) || String(e);
        }
        const msB = Date.now() - tB;
        const nB1 = ps.countLayers();

        const addedA = nA1 - nA0;
        const addedB = nB1 - nA1;
        const perA = msA / N;
        const perB = msB / N;
        const judge = addedA === N && addedB === N && !batchErr;
        // 外推值只做**读数**，不拿来当判据（外推不是实测）
        const extA = Math.round((perA * 2000) / 1000);
        const extB = Math.round((perB * 2000) / 1000);

        rec(
          S34,
          judge,
          "N=" + N +
          "　A·逐条循环：+" + addedA + " 层　" + msA + "ms（" + perA.toFixed(1) + "ms/层，失败 " + failA + "）" +
          "　B·一次 batchPlay：+" + addedB + " 层　" + msB + "ms（" + perB.toFixed(1) + "ms/层）" +
          (batchErr ? "　batchErr=" + batchErr : "") +
          "　‖ 外推 2000 层≈ A " + extA + "s / B " + extB + "s（**外推不是实测**，只用来定上限策略）" +
          "　⇒ " + (judge
            ? "批量塞进一次 batchPlay " + (msB < msA ? "**明显更快**（" + (msA / msB).toFixed(1) + "×）" : "没有更快") +
              " ⇒ 实现按批量发命令，并按实测成本定行数上限"
            : "⚠️ 有层没建出来 —— 见上面数字")
        );
      } finally {
        try {
          await ps.closeDocument(sc34.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S34, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S35: CSV 输入侧（v0.3.8 新增，M3 输入侧）
     ⚠️ 文件选择器**会弹系统对话框，自检里点不了** ⇒ 只能验"API 在不在"，
        并如实标注"真弹窗没测"。真正能测、也是真正会坑人的是**解码**那半边。

     判据用**已知答案**（不是"没报错"），并且先造基准把变量分开：
       ① 基准：把 GBK 字节 `D6 D0 CE C4`（"中文"的 GBK 编码，**写死的已知答案**）
          以**二进制**写进 PluginData，再用 `read({format:binary})` 读回**逐字节比对**
          —— 基准不成立 ⇒ 本条**无结论**（后面的解码读数都不可信）
       ② 决定性实验：同一个文件用 `read()`（**文本模式**）读回，看到底得到什么 ——
          解出「中文,A」⇒ 宿主按系统代码页解码，中文 CSV 有原路；
          乱码 ⇒ 文本模式不可靠，得自带解码表（架构要另想办法）
       ③ `TextDecoder` 在几个可能的位置（global / window / globalThis）都找一遍（配负对照：
          伪造属性名必须"找不到"，否则分不清"没有"和"我没找对地方"）
       ④ utf-8 CSV 往返：BOM + 字段内逗号 + 字段内换行，必须**逐字相同** */
  const S35 = "S35 CSV 输入侧 —— 文件选择器 API + GBK 文件到底能不能解（含二进制基准）+ utf-8 往返";
  try {
    const fs2 = (() => {
      try {
        return require("uxp").storage.localFileSystem;
      } catch {
        return null;
      }
    })();
    const formats2 = (() => {
      try {
        return require("uxp").storage.formats || {};
      } catch {
        return {};
      }
    })();
    /* 🔴 v0.4.3：`getFileForOpening` **存在 ≠ 能用**。
       v0.4.2 真机点了「导入 CSV」，拿到的错误是：
         `Plugin is not permitted to access the file picker. Manifest entry not found.`
       —— 因为 `requiredPermissions` 是空的（默认只有 `"plugin"` 沙箱权限）。
       官方文档（UXP Filesystem Operations）：`localFileSystem` 可取
         `"plugin"`（默认，仅沙箱）/ `"request"`（**允许用文件选择器请求用户授权**）/ `"fullAccess"`。
       这一条**读插件自己的 manifest.json** 来判权限声明 —— 它是可自动化的**因果**判据
       （错误文案点名的就是"manifest entry 缺失"），不必去弹那个系统窗口。
       ⚠️ 它证明"门开着"，**不证明"对话框一定弹得出来"**（那一步只能人去点）。 */
    let permDeclared = "(读不到 manifest)";
    let permOk = false;
    try {
      const uxp35 = require("uxp");
      const pf35 = await uxp35.storage.localFileSystem.getPluginFolder();
      const mfEntry = await pf35.getEntry("manifest.json");
      const mfText = await mfEntry.read();
      const mfJson = JSON.parse(String(mfText));
      const rp = mfJson.requiredPermissions || {};
      permDeclared = String(rp.localFileSystem === undefined ? "(未声明 ⇒ 默认 plugin = 无文件选择器)" : rp.localFileSystem);
      permOk = rp.localFileSystem === "request" || rp.localFileSystem === "fullAccess";
    } catch (e) {
      permDeclared = "(读 manifest 失败：" + ((e && e.message) || e) + ")";
    }

    const hasOpen = !!(fs2 && typeof fs2.getFileForOpening === "function");

    /* ③ TextDecoder 位置探测（"一种读数都没有"不能算"测过了"） */
    const loc = {};
    try {
      loc["global.TextDecoder"] = typeof TextDecoder;
      loc["window.TextDecoder"] = typeof window !== "undefined" ? typeof window.TextDecoder : "(无 window)";
      loc["globalThis.TextDecoder"] =
        typeof globalThis !== "undefined" ? typeof globalThis.TextDecoder : "(无 globalThis)";
      loc["对照·__notARealDecoder"] =
        typeof globalThis !== "undefined" ? typeof globalThis.__notARealDecoder : "undefined";
    } catch (e) {
      loc.err = String((e && e.message) || e);
    }
    const TD = (function () {
      try {
        if (typeof TextDecoder === "function") return TextDecoder;
      } catch {
        /* 继续找 */
      }
      try {
        if (typeof globalThis !== "undefined" && typeof globalThis.TextDecoder === "function") {
          return globalThis.TextDecoder;
        }
      } catch {
        /* 没有就算了 */
      }
      return null;
    })();
    const bogus = TD
      ? (function () {
          try {
            const t = new TD("vt-not-an-encoding");
            return { threw: false, text: t.decode(new Uint8Array([0x41])) };
          } catch (e) {
            return { threw: true };
          }
        })()
      : { threw: false, error: "没有 TextDecoder" };
    const gbkViaTD = TD
      ? (function () {
          try {
            return { ok: true, text: new TD("gbk").decode(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])) };
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
        })()
      : { ok: false, error: "没有 TextDecoder" };

    /* ① 基准 + ② 文本模式读同一文件 */
    const GBK = [0xd6, 0xd0, 0xce, 0xc4, 0x2c, 0x41]; // "中文,A"
    let base = { ok: false, error: "未执行" };
    let textMode = { ok: false, text: null, error: null };
    try {
      const folder = await data.getDataFolder();
      let entry;
      try {
        entry = await folder.getEntry("m3-gbk-probe.csv");
      } catch {
        entry = await folder.createFile("m3-gbk-probe.csv", { overwrite: true });
      }
      const u8 = new Uint8Array(GBK.length);
      for (let i = 0; i < GBK.length; i++) u8[i] = GBK[i];
      await entry.write(u8.buffer);

      if (!formats2.binary) {
        base = { ok: false, error: "storage.formats.binary 不存在 ⇒ 读不回字节，基准不成立" };
      } else {
        const back = await entry.read({ format: formats2.binary });
        const b8 = new Uint8Array(back);
        const same = b8.length === GBK.length && GBK.every((v, i) => b8[i] === v);
        base = {
          ok: same,
          byteLength: b8.length,
          hex: Array.prototype.slice.call(b8).map((v) => v.toString(16).padStart(2, "0")).join(" "),
          error: same ? null : "读回的字节与写入的不一致",
        };
      }
      try {
        const t = await entry.read();
        textMode = { ok: true, text: typeof t === "string" ? t : String(t) };
      } catch (e) {
        textMode = { ok: false, error: (e && e.message) || String(e) };
      }
    } catch (e) {
      base = { ok: false, error: "基准实验抛异常：" + ((e && e.message) || e) };
    }

    /* ④ utf-8 CSV 往返 */
    const csvFixture = "\uFEFF" + [
      "名称,价格,备注",
      "\"图一,终稿\",1.20,\"第一行\n第二行\"",
      "图二 (2),3.40,普通",
    ].join("\r\n");
    let rt = { ok: false, error: "未执行" };
    try {
      await data.writeText("m3-selftest.csv", csvFixture);
      const back = await data.readText("m3-selftest.csv", null);
      rt = { ok: back === csvFixture, len: back === null ? -1 : String(back).length };
    } catch (e) {
      rt = { ok: false, error: (e && e.message) || e };
    }

    const textModeIsGbk = !!(textMode.ok && textMode.text === "中文,A");
    /* 判据只用**该稳的**那几项：
       · "文本模式能不能解 GBK"是**平台事实**（答"不能"也不是 bug）⇒ 只作读数，不判生死
       · 基准（二进制往返）必须先成立，否则整条无结论 */
    const judge = base.ok === true && rt.ok === true && hasOpen === true &&
      (TD ? bogus.threw === true : true) && permOk === true;

    rec(
      S35,
      judge,
      "getFileForOpening=" + (hasOpen ? "API 存在" : "不存在") +
      "　manifest.localFileSystem=" + permDeclared + (permOk ? " ✓（选择器已授权）" : " ✗（选择器会被拒）") +
      "　‖ ①基准·GBK 字节二进制往返=" + (base.ok ? "逐字节相同(" + base.hex + ")" : "✗" + base.error) +
      "　②文本模式读同一文件=" + (textMode.ok ? JSON.stringify(textMode.text) : "✗" + textMode.error) +
      "（解出「中文,A」⇒ 走系统代码页；乱码 ⇒ 文本模式不可靠）" +
      "　⇒ 中文 CSV " + (textModeIsGbk ? "能直接读" : "**不能靠宿主解码**") +
      "　‖ ③TextDecoder 位置=" + JSON.stringify(loc) +
      "　负对照抛异常=" + bogus.threw +
      (TD ? "（须 true，否则③的读数不可信）" : "（没有 TextDecoder ⇒ 这一半**没测**，不是判据不成立）") +
      (TD ? "　gbk 解码=" + (gbkViaTD.ok ? JSON.stringify(gbkViaTD.text) : "✗" + gbkViaTD.error) : "") +
      "　‖ ④utf-8 CSV 往返=" + (rt.ok ? "逐字相同" : "不一致(" + (rt.error || rt.len) + ")") +
      "　⇒ " + (!base.ok
        ? "【无结论】连二进制基准都没成立 ⇒ 后面的解码读数不可信"
        : textModeIsGbk
          ? "宿主能按系统代码页解 GBK ⇒ 中文 CSV 有原路"
          : "utf-8/BOM 的 CSV 无损可读；**GBK 得自己做解码**（见读数）")
    );
  } catch (e) {
    rec(S35, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S36: 读当前选区（v0.3.9 新增，M3 决策④）
     竞品「PS表格助手」的核心交互是：**用户用 PS 自带选框工具在画布上拉一个框**，
     插件读这个框当表格的**位置 + 尺寸**。我方 `readSelectionBounds()` 其实一直在用
     （`placeBaseCenter()` 算落点就靠它，v0.3.0 的 S25 也间接读过），但**从没单独钉过**，
     而且从来没验过"**没有选区时**"那一侧 —— 那正是"有框用框、没框用默认"的分支条件。

     判据两半（缺一不可）：
       ① **对照**：刚建的临时文档**没有选区** ⇒ 必须读到 `null`（不能当成 0,0）
       ② **目标**：建一个已知矩形（`setSelectionRect`，v0.3.0 已验）⇒ 读回**命中 ±1px**
     ⚠️ 诚实边界：这里建的框与用户手拉的是**同一种文档状态**、走同一条读取代码路径，
        但"真手拉一次"自检点不了 ⇒ 开工后让用户手工拉一次框复验最后一步。
     ⚠️ 只作用在自建临时文档上，跑完关掉。 */
  const S36 = "S36 区域输入 —— 读当前选区（『按画布上拉的框排版』的前提；含『无选区』对照）";
  try {
    const sc36 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(选区)" });
    if (!sc36 || !sc36.ok) {
      rec(S36, false, "建临时文档失败：" + ((sc36 && sc36.error) || "未知"));
    } else {
      try {
        const before = ps.readSelectionBounds();
        const rect = { left: 60, top: 80, right: 260, bottom: 240 };
        const mk36 = await ps.setSelectionRect(rect);
        const after = ps.readSelectionBounds();
        const hit = !!(after &&
          Math.abs(after.left - rect.left) <= 1 && Math.abs(after.top - rect.top) <= 1 &&
          Math.abs(after.right - rect.right) <= 1 && Math.abs(after.bottom - rect.bottom) <= 1);
        const judge = before === null && mk36.ok === true && hit;
        rec(
          S36,
          judge,
          "①对照·新文档无选区=" + (before === null
            ? "读到 null ✓（没有被当成 0,0）"
            : "⚠️ 读到了 " + JSON.stringify(before) + "（无选区时读数不可信）") +
          "　②目标·建选区=" + (mk36.ok ? "✓" : "✗" + mk36.error) +
          "　读回=" + (after
            ? [after.left, after.top, after.right, after.bottom].map((v) => Math.round(v)).join(",")
            : "null") +
          "（须 " + [rect.left, rect.top, rect.right, rect.bottom].join(",") + "）" +
          "　读法=UXP DOM `doc.selection.bounds`" +
          "　⇒ " + (judge
            ? "「有框用框 / 没框用默认」这条分支条件是**可判的**（两边读数都能区分）"
            : "⚠️ 未成立 —— 见分段读数")
        );
      } finally {
        try {
          await ps.closeDocument(sc36.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S36, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S37: 对齐三档（v0.3.9 新增，M3 决策③「默认居中但要能调」）
     v0.3.8 只验了 `align: center` 能设且读回（字段 `align` / 枚举族 `alignmentType`）。
     用户要的是"**默认居中、但给用户调整**" ⇒ 左/中/右**三档都得能设**，不能只验中间那一档。
     判据：三档逐个设置并**读回**，值必须等于目标（不看"命令没报错"）。
     ⚠️ 只作用在自建临时文档上，跑完关掉。 */
  const S37 = "S37 文字对齐三档（左 / 中 / 右）都能设且读回 —— 默认居中、但要允许调整";
  try {
    const sc37 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(对齐)" });
    if (!sc37 || !sc37.ok) {
      rec(S37, false, "建临时文档失败：" + ((sc37 && sc37.error) || "未知"));
    } else {
      try {
        const mk37 = await ps.makeTextLayerBox({
          text: "对齐三档", box: { left: 40, top: 60, right: 360, bottom: 140 },
          sizePt: 18, rgb: { r: 20, g: 20, b: 20 },
        });
        const rows = [];
        let allOk = !!mk37.ok;
        for (const v of ["left", "center", "right"]) {
          const w = await ps.applyParagraphStyle({ align: { cls: "alignmentType", value: v } });
          const tk = await ps.readTextKeyDesc();
          const s = tk.ok ? ps.summarizeTextKey(tk.raw) : null;
          const got = s && (s.paragraphAlign || s.paragraphJustification);
          const ok = !!(w.ok && got && got.value === v);
          if (!ok) allOk = false;
          rows.push(v + "→" + ((got && got.value) || "?") + (ok ? "✓" : "✗"));
        }
        rec(
          S37,
          allOk,
          "建层=" + (mk37.ok ? "✓" : "✗") +
          "　字段=align　枚举族=alignmentType　三档：" + rows.join("　") +
          "　⇒ " + (allOk
            ? "左/中/右**都能设** ⇒ 「默认居中 + 用户可调」这条成立"
            : "⚠️ 有档位没生效 —— 不要把某一档的结论推广到三档")
        );
      } finally {
        try {
          await ps.closeDocument(sc37.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S37, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S38: 样式配置「导出给别人」的能力盘点（v0.3.9 新增，M3 决策⑥）
     用户明确要"样式配置保存/导出"（保存不用验，`store.js` 写 PluginData 早就通了）。
     要验的是**导出**：把 JSON 交到用户能拿到的地方。
     三条候选：① 让用户选保存位置 ② 让用户选文件夹再写 ③ 复制到剪贴板（最省事，直接粘给别人）。
     ⚠️ ①②**都会弹系统对话框，自检点不了** ⇒ 只能验"API 在不在"；
        ③ 只验方法存在，**不真的写剪贴板**（不拿用户的剪贴板做实验）。
     基准：写进 PluginData 再原样读回（已知可行，防止"整条导出链路其实断了"）。 */
  const S38 = "S38 样式配置导出 —— 存到用户选的位置 / 复制到剪贴板（API 盘点，含对照）";
  try {
    const uxp38 = (() => {
      try {
        return require("uxp");
      } catch {
        return null;
      }
    })();
    const lfs38 = uxp38 && uxp38.storage && uxp38.storage.localFileSystem;
    const hasSave = !!(lfs38 && typeof lfs38.getFileForSaving === "function");
    const hasFolder = !!(lfs38 && typeof lfs38.getFolder === "function");
    const cb38 = (() => {
      try {
        if (uxp38 && uxp38.clipboard) return uxp38.clipboard;
      } catch {
        /* 继续 */
      }
      try {
        return require("clipboard");
      } catch {
        return null;
      }
    })();
    const cbNames = ["copyText", "readText", "read", "write", "getContent", "setContent", "clear"];
    const cbMethods = [];
    if (cb38) {
      for (const k of cbNames) {
        try {
          if (typeof cb38[k] === "function") cbMethods.push(k);
        } catch {
          /* 忽略 */
        }
      }
    }
    // 基准：写进 PluginData 再读回（逐字）
    let baseOk = false;
    try {
      await data.writeText("m3-export-probe.json", '{"probe":1}');
      baseOk = (await data.readText("m3-export-probe.json", null)) === '{"probe":1}';
    } catch {
      baseOk = false;
    }
    const negOk = (function () {
      try {
        return typeof (uxp38 && uxp38.__notARealThing) === "undefined";
      } catch {
        return false;
      }
    })();
    /* 🔴 v0.4.3：「存在」不等于「能用」—— 这一条就是踩过坑的地方。
       v0.3.9 的 S38 只问了"有没有这些方法"就写下"剪贴板 ✗"，而真机上
       `getFileForOpening` 明明存在、一调却报 `Manifest entry not found`
       （`requiredPermissions` 是空的）⇒ 同一顶帽子也会扣在剪贴板上。
       现在改成：① 读自己的 manifest 判 `localFileSystem` / `clipboard` 是否声明；
                 ② 剪贴板**真写一次再读回**（写进用户剪贴板的东西立刻被读回覆盖，无副作用）；
                 ③ 剪贴板这条路本来就"有则更好、无则退回文件"，所以它**不参与判生死**。 */
    let perm38 = "(读不到 manifest)";
    let clipDeclared = "(未声明)";
    try {
      const uxp38b = require("uxp");
      const pf38 = await uxp38b.storage.localFileSystem.getPluginFolder();
      const mf38 = JSON.parse(String(await (await pf38.getEntry("manifest.json")).read()));
      const rp38 = mf38.requiredPermissions || {};
      perm38 = String(rp38.localFileSystem === undefined ? "(未声明 ⇒ 默认 plugin)" : rp38.localFileSystem);
      clipDeclared = String(rp38.clipboard === undefined ? "(未声明)" : rp38.clipboard);
    } catch (e) {
      perm38 = "(失败：" + ((e && e.message) || e) + ")";
    }
    const perm38Ok = perm38 === "request" || perm38 === "fullAccess";

    let clipTry = "没试（模块拿不到）";
    let clipOk = false;
    if (cb38) {
      const wKey = ["copyText", "write", "setContent"].filter((k) => cbMethods.indexOf(k) >= 0)[0];
      const rKey = ["readText", "read", "getContent"].filter((k) => cbMethods.indexOf(k) >= 0)[0];
      if (!wKey) {
        clipTry = "有模块但没有可写方法";
      } else {
        const probe = "vt-clip-" + Date.now();
        /* ⚠️ 这是**用户的**剪贴板 ⇒ 先把旧内容存下来，验完**还原**
           （无痕，和 palette.json 的备份同一个道理：自检不该留下痕迹） */
        let keep = null;
        let canRestore = false;
        if (rKey) {
          try {
            keep = await cb38[rKey]();
            canRestore = typeof keep === "string";
          } catch {
            canRestore = false;
          }
        }
        try {
          await cb38[wKey](probe);
          if (rKey) {
            const back = await cb38[rKey]();
            clipOk = String(back) === probe;
            clipTry = "写(" + wKey + ")+读(" + rKey + ")=" + JSON.stringify(String(back).slice(0, 24)) + (clipOk ? " ✓" : " ✗不一致");
          } else {
            clipTry = "写了(" + wKey + ")但模块没有读方法 ⇒ 只能算「写没抛错」";
            clipOk = true;
          }
        } catch (e) {
          clipTry = "调用抛错：" + ((e && e.message) || e);
        }
        if (canRestore) {
          try {
            await cb38[wKey](keep);
            clipTry += "（已还原原内容）";
          } catch {
            clipTry += "（⚠️ 还原失败）";
          }
        }
      }
    }
    const judge = baseOk && (hasSave || hasFolder) && perm38Ok && negOk;
    rec(
      S38,
      judge,
      "基准·PluginData 写入读回=" + (baseOk ? "逐字相同" : "✗") +
      "　manifest.localFileSystem=" + perm38 + (perm38Ok ? " ✓" : " ✗（文件选择器会被拒）") +
      "　①getFileForSaving=" + hasSave + "、getFolder=" + hasFolder + "（⚠️ 真弹窗自检点不了）" +
      "　②剪贴板：manifest.clipboard=" + clipDeclared + "、模块=" +
      (cb38 ? "有[" + cbMethods.join(",") + "]" : "拿不到") + "、**真写读回**=" + clipTry +
      "　负对照·__notARealThing=" + (negOk ? "undefined ✓" : "⚠️ 竟有值 ⇒ 读数不可信") +
      "　⇒ " + (judge
        ? "样式配置「导出给别人」有路走：" + (hasSave ? "「另存为文件」✓" : "") +
          (clipOk ? " + 剪贴板真能读写 ✓" : "（剪贴板不可用 ⇒ 只走文件，符合预期）")
        : "⚠️ 未成立 —— 见分段读数（权限没声明的话，用户点了也是白点）")
    );
  } catch (e) {
    rec(S38, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S39: xlsx（Excel 导入）需要的能力原语盘点（v0.3.9 新增，M3 决策⑦）
     用户问"Excel 导入成本高在哪"。**不猜**：把 xlsx 这条路需要的原语逐个问一遍真机。
     xlsx = **zip 容器（要 DEFLATE 解压）** + **若干 XML（要 XML 解析）**；
     再叠加一个第三方 zip 库（官方 jszip-sample 用的是 `jszip@3.7` + **webpack 打包**，
     而本插件是**无打包器**的纯 require 结构）⇒ 成本就在这几项上。
     ⚠️ 这是**诊断项**：只记录"有什么/没什么"，不判生死。
     判据只保证"读数机制可信"（负对照必须不存在 + 至少取到 5 项读数）。 */
  const S39 = "S39 Excel 导入所需原语盘点（解压 / XML / 二进制 / 剪贴板，诊断项）";
  try {
    const g39 = typeof globalThis !== "undefined" ? globalThis : {};
    const pick39 = (n) => {
      try {
        const v = g39[n];
        if (v === undefined || v === null) return "无";
        return typeof v === "function" ? "function" : typeof v;
      } catch {
        return "抛异常";
      }
    };
    const names39 = [
      "DecompressionStream", "CompressionStream", "DOMParser", "XMLSerializer",
      "Blob", "File", "FileReader", "Response", "fetch", "atob", "btoa",
      "TextDecoder", "TextEncoder", "Uint8Array", "ArrayBuffer", "Worker",
    ];
    const got39 = {};
    for (const n of names39) got39[n] = pick39(n);
    const hit39 = names39.filter((n) => got39[n] !== "无").length;
    const neg39 = pick39("__notARealThing");
    // 剪贴板**读**的存在性（"Excel 里复制 → 面板里粘贴"这条低成本路的前提）
    let cbRead39 = "没有剪贴板对象";
    try {
      const c = (function () {
        try {
          return require("uxp").clipboard;
        } catch {
          /* 继续 */
        }
        try {
          return require("clipboard");
        } catch {
          return null;
        }
      })();
      if (c) {
        const m = [];
        for (const k of ["readText", "read", "getContent", "copyText"]) {
          try {
            if (typeof c[k] === "function") m.push(k);
          } catch {
            /* 忽略 */
          }
        }
        cbRead39 = "有，方法=[" + m.join(",") + "]";
      }
    } catch (e) {
      cbRead39 = "抛异常";
    }
    const judge = neg39 === "无" && hit39 >= 5;
    rec(
      S39,
      judge,
      "【诊断项】原语=" + JSON.stringify(got39) +
      "　负对照·__notARealThing=" + neg39 + "（须「无」）" +
      "　剪贴板读=" + cbRead39 +
      "　⇒ 逐项解读：DecompressionStream=" + got39.DecompressionStream +
      "（有它=纯前端解 zip 一条路）、DOMParser=" + got39.DOMParser +
      "（没有它=XML 得自己抠或正则）、atob=" + got39.atob +
      "　—— **本项只记录事实，不判可行性**"
    );
  } catch (e) {
    rec(S39, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S40: 生成表格端到端（v0.4.0 新增，M3a 的核心）
     这是 M3「表格生成」第一次把整条链子跑通：
       CSV 文本 →（自己解码）→（自己解析）→ 归一化 → 布局计划 → 一次 batchPlay 落地

     判据全部**读回**（不看"命令没报错"）：
       ① CSV 解析：字段内的逗号与引号转义必须对（这是最容易错的地方）
       ② 图层数增量 **正好等于** 计划里的层数（多一层少一层都算错）
       ③ 建出来的东西在**一个组**里，组名就是我们要的
       ④ 最后一个文字层：**文字内容** / **图层名** / **段落对齐** 三项都要命中
          —— 后两项是本轮的两个**未知**：`make textLayer` 里给 `name` 会不会被接受、
             建层时就带 `paragraphStyleRange` 会不会生效，都靠这一条钉死
       ⑤ 线条用**像素**验：在第一条横线所在的区域取样，必须命中线色
       ⚠️ 只作用在自建临时文档上，跑完不保存关掉。 */
  const S40 = "S40 生成表格端到端 —— CSV 解析 → 布局 → 落地（层数/组/文字/图层名/对齐/线条取色）";
  try {
    const CSV_TEXT = '名称,价格,备注\r\n"图一,终稿","1.20","含税"\r\n图二,3.40,普通\r\n图三,5.00,"含""引号"""\r\n';
    const parsed = csv.readBytes(csv.encodeUtf8(CSV_TEXT));
    const csvOk = !!(parsed.ok && parsed.rows.length === 4 && parsed.rows[0][0] === "名称" &&
      parsed.rows[1][0] === "图一,终稿" && parsed.rows[3][2] === '含"引号"');

    const sc40 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(表格)" });
    if (!sc40 || !sc40.ok) {
      rec(S40, false, "建临时文档失败：" + ((sc40 && sc40.error) || "未知"));
    } else {
      try {
        const norm = parsed.ok ? tbl.normalizeRows(parsed.rows, true) : null;
        const region = { left: 40, top: 40, right: 280, bottom: 240 };
        const plan = norm && norm.cols
          ? tbl.layoutTable({ header: norm.header, body: norm.body, region: region, style: {} })
          : null;
        if (!plan || !plan.ok) {
          rec(S40, false, "布局计划没成立：" + ((plan && plan.error) || "没有归一化出表"));
        } else {
          const r = await ps.buildTable(plan, { name: "自检表格" });
          const last = plan.cells[plan.cells.length - 1];

          // ③ 组是否存在（递归找，名字要**正好**是我们要的）
          let grpFound = false;
          let grpCount = 0;
          try {
            const walk = (arr) => {
              for (const l of arr || []) {
                if (l.kind === "group") { grpCount++; if (String(l.name) === "自检表格") grpFound = true; }
                if (l.layers && l.layers.length) walk(l.layers);
              }
            };
            walk(ps.app.activeDocument.layers);
          } catch { /* 忽略 */ }

          // ④ 最后一个文字层：内容 / 名字 / 对齐
          const li = ps.layerInfo();
          const pr = ps.textItemProbe();
          const tk = await ps.readTextKeyDesc();
          const sm = tk.ok ? ps.summarizeTextKey(tk.raw) : null;
          const gotAlign = sm && (sm.paragraphAlign || sm.paragraphJustification);
          const wantName = ps.tableCellName(last);

          /* ⑤ 线条：**按 bounds 认出那条线**（v0.4.1 起线条不再靠名字），再用 DOM 选中它取样
             ⚠️ 挑**内部横线**（`!outer`）：外框是单独的颜色（strokeColor），拿它验 lineColor 会误判。 */
          const target =
            plan.lines.filter((l) => l.kind === "h" && !l.outer)[0] ||
            plan.lines.filter((l) => l.kind === "h")[0];
          let lineSample = { ok: false, error: "没有横线" };
          if (target) {
            try {
              let picked = null;
              await ps.runModal(async () => {
                const doc = ps.app.activeDocument;
                let grp = null;
                const walk = (arr) => {
                  for (const l of arr || []) {
                    if (grp) return;
                    if (l.kind === "group" && String(l.name) === "自检表格") { grp = l; return; }
                    if (l.layers && l.layers.length) walk(l.layers);
                  }
                };
                walk(doc.layers);
                if (!grp) throw new Error("找不到组");
                const num = (v) => (v && typeof v === "object" && "_value" in v ? v._value : v);
                const near = (a, b) => Math.abs(Number(num(a)) - Number(b)) <= 1;
                for (const s of (grp.layers || [])) {
                  if (s.kind !== "solidColor" || !s.bounds) continue;
                  const b = s.bounds;
                  if (near(b.left, target.rect.left) && near(b.top, target.rect.top) &&
                      near(b.right, target.rect.right) && near(b.bottom, target.rect.bottom)) { picked = s; break; }
                }
                if (!picked) throw new Error("组里找不到 bounds 等于第一条横线的形状层");
                doc.activeLayers = [picked];
              }, "Vellum 工具箱：按 bounds 找到第一条横线");
              lineSample = await ps.sampleRectAvgColor({
                left: target.rect.left + 4, top: target.rect.top,
                right: target.rect.right - 4, bottom: target.rect.bottom,
              });
            } catch (e) {
              lineSample = { ok: false, error: (e && e.message) || String(e) };
            }
          }
          const lc = (target && target.color) || plan.style.lineColor;
          const lineOk = !!(lineSample.ok && lineSample.rgb &&
            Math.abs(lineSample.rgb.r - lc.r) <= 25 &&
            Math.abs(lineSample.rgb.g - lc.g) <= 25 &&
            Math.abs(lineSample.rgb.b - lc.b) <= 25);

          const addedOk = r.ok && r.added === plan.layers;
          const nameOk = !!(li.ok && li.name === wantName);
          const textOk = !!(pr.values && pr.values.contents === last.text);
          const alignOk = !!(gotAlign && gotAlign.value === last.align);
          /* v0.4.7：阶段二 = **内联对齐 + 一次 batchPlay 改名（所有图层）**。
             期望改名条数 = 层数 − 1（背景 + 线 + 文字），不再是"只给文字层改名"。 */
          const phaseOk = r.alignMode === "inline" && r.renamed === plan.layers - 1;
          /* v0.4.7：改名现在是"所有图层一起改"（背景/线/外框/文字）。
             `make contentLayer` 里的 `name` **被忽略**（S46 实测）⇒ 必须验"事后 set 真生效了"：
             找得到按规则命名的**形状层**，才算命名这条路真的通了（不能只看"命令没报错"）。 */
          const frameOk = !!ps.findLayerDeep("外框 · 上");
          const judge = csvOk && addedOk && grpFound && nameOk && textOk && alignOk && phaseOk && frameOk;
          const judgeAll = judge && lineOk;

          rec(
            S40,
            judgeAll,
            "① CSV=" + (csvOk ? "解析对（含字段内逗号与双引号转义）" : "✗ 解析不对") +
            "　② 层数=" + (r.added === undefined ? "?" : r.added) + "/" + plan.layers +
            (addedOk ? " ✓" : " ✗") +
            "（组 " + grpCount + " 个，名字命中=" + grpFound + "）" +
            "　③ 文字=" + JSON.stringify((pr.values && pr.values.contents) || "") +
            "（须 " + JSON.stringify(last.text) + "）" + (textOk ? "✓" : "✗") +
            "　④ 图层名=" + JSON.stringify((li && li.name) || "") +
            "（须 " + JSON.stringify(wantName) + "）" + (nameOk ? "✓" : "✗") +
            "　⑤ 对齐=" + ((gotAlign && gotAlign.value) || "?") +
            "（须 " + last.align + "）" + (alignOk ? "✓" : "✗") +
            "　⑥ 阶段二=" + r.nameMode + "（改名 " + r.renamed + "/" + (plan.layers - 1) +
            (r.renameMs === undefined ? "" : "，批次 " + r.renameMs + "ms") + "）" + (phaseOk ? " ✓" : " ✗") +
            "　形状层「外框 · 上」存在=" + frameOk + (frameOk ? " ✓" : " ✗") +
            "　⑦ 线条取色=" + (lineSample.ok ? lineSample.hex : "取不到（" + (lineSample.error || "?") + "）") +
            "（须 " + ps.rgbToHex(lc) + "，±25）" + (lineOk ? "✓" : "✗") +
            (r.error ? "　err=" + r.error : "") +
            (r.phase2Error ? "　phase2=" + r.phase2Error : "") +
            "　⇒ " + (judgeAll
              ? "整条链子通：CSV → 计划 → 落地；图层名/对齐/线条全部读回命中，且**全是已验原语**"
              : (judge ? "⚠️ 只剩线条取色没中 —— 表格本身是对的"
                : "⚠️ 有项没中 —— 见分段读数"))
          );
        }
      } finally {
        try { await ps.closeDocument(sc40.id); } catch { /* 忽略 */ }
      }
    }
  } catch (e) {
    rec(S40, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S43: 垂直对齐（顶/垂直居中/底）—— 量**文字墨迹**落在行的上/中/下
     v0.4.6 重写。上一版两个毛病：① 判据拿"墨迹中心距行中心 ≤3px"去卡 PS 自己的行盒排版
     ⇒ 误报失败（实测恒定偏 4px，那是 PS 把字形画在行盒上方的固有偏移，不是我们的错）；
     ② 取图层用**全局** `findLayerDeep` ⇒ 三张表的格子名完全相同，会串到第一张表去。

     这一版的判据只问**我们控制的东西**有没有落地：
       期望墨迹中心 = `箱顶 + INK_MID × 字号`（真机实测常数 0.40em，见 lib/table.js 注释）
     三档各自比一遍，残差 >1.5px 才算失败。顺带量位移：
       · 宽松组 60/18：三档之间应移动 37.24px
       · **用户实配 28/12**：应移动 10.16px（老实现只有 4.16px —— 这是用户报
         「垂直居中没有生效」的真正原因：位移太小 + 按框对齐导致整体偏上） */
  const S43 = "S43 垂直对齐 —— 按墨迹验证：三档各对期望值 / 用户实配那组的居中真的居中";
  try {
    const sc43 = await ps.createScratchDoc({ size: 700, name: "Vellum 自检临时文档(垂直对齐)" });
    if (!sc43 || !sc43.ok) {
      rec(S43, false, "建临时文档失败：" + ((sc43 && sc43.error) || "未知"));
    } else {
      try {
        const act0 = await ps.activateDocument(sc43.id);
        const info43 = ps.docInfo() || {};
        const ppi43 = info43.resolution || 72;
        const order = ["top", "middle", "bottom"];
        const GROUPS = [
          { id: "loose", rowH: 60, fontPx: 18, y0: 30 },
          { id: "tight", rowH: 28, fontPx: 12, y0: 300 },
        ];
        const canvasOk = isFinite(info43.docW) && isFinite(info43.docH) &&
          info43.docW >= 340 && info43.docH >= 560;
        /* 在**指定组里**找那一格 —— 三张表的格子名一样，全局找会串表 */
        const inkOf = async (groupName, layerName) => {
          let layer = null;
          await ps.runModal(async () => {
            const doc = ps.app.activeDocument;
            let grp = null;
            const walk = (arr) => {
              for (const l of arr || []) {
                if (grp) return;
                if (l.kind === "group" && String(l.name) === groupName) { grp = l; return; }
                if (l.layers && l.layers.length) walk(l.layers);
              }
            };
            walk(doc.layers);
            if (!grp) throw new Error("找不到组 " + groupName);
            const walk2 = (arr) => {
              for (const l of arr || []) {
                if (layer) return;
                if (l.kind === "text" && String(l.name) === layerName) { layer = l; return; }
                if (l.layers && l.layers.length) walk2(l.layers);
              }
            };
            walk2(grp.layers || []);
            if (!layer) throw new Error("组里找不到 " + layerName);
            doc.activeLayers = [layer];
          }, "Vellum 工具箱：选中 " + layerName);
          return ps.readActiveLayerBounds();
        };

        const notes = [];
        let bad = 0;
        const per = {};
        for (const G of GROUPS) {
          const vals = {};
          for (let k = 0; k < order.length; k++) {
            const v = order[k];
            const y0 = G.y0 + k * 90;
            const region = { left: 30, top: y0, right: 330, bottom: y0 + G.rowH + 30 };
            const plan = tbl.layoutTable({
              header: ["表"], body: [["中"]], region: region, ppi: ppi43,
              style: {
                rowH: G.rowH, headerH: 30, fontPx: G.fontPx, headerFontPx: G.fontPx,
                fontColor: { r: 0, g: 0, b: 0 }, headerFontColor: { r: 0, g: 0, b: 0 },
                border: "none", headerBgMode: "none", rowBgMode: "none",
                rowVAlign: v, headerVAlign: v,
              },
            });
            /* ⚠️ 这里**不能 `return`** —— 那会把后面所有探针一起跳过（S43 之后还有 S44/S42/S41）。
               抛出去让本地 catch 记一条失败，流程继续。 */
            if (!plan.ok) throw new Error("布局没成立（" + v + "）：" + (plan.error || "?"));
            const tname = "vt-va-" + G.id + "-" + v;
            const r = await ps.buildTable(plan, { name: tname });
            if (!r.ok) throw new Error("建表失败（" + tname + "）：" + (r.error || "?"));
            const cell = plan.cells[1];                       // 数据行那一格
            const lb = await inkOf(tname, ps.tableCellName(cell));
            if (!lb.ok) throw new Error("读不到墨迹（" + tname + "）：" + (lb.error || "?"));
            const inkC = (lb.bounds.top + lb.bounds.bottom) / 2;
            const wantC = cell.box.top + tbl.INK_MID * cell.fontPx;   // 独立算的期望值
            vals[v] = {
              inkC: inkC, wantC: wantC, inkTop: lb.bounds.top, inkBot: lb.bounds.bottom,
              /* 🔴 行中心要**按这一档自己的那张表**算：三档是三张表（region 纵向错开 90px），
                 第一版忘了加 `k * 90` ⇒ 拿"第一张表的行中心"去比"第二张表的墨迹"，差 90px。 */
              rowMid: (y0 + 30) + G.rowH / 2,
            };
            if (Math.abs(inkC - wantC) > 1.5) bad++;
            notes.push(G.id + "/" + v + "=" + Math.round(inkC) + "vs" + Math.round(wantC * 10) / 10);
          }
          vals.travel = Math.round((vals.bottom.inkTop - vals.top.inkTop) * 10) / 10;
          vals.travelWant = Math.round((vals.bottom.wantC - vals.top.wantC) * 10) / 10;
          if (Math.abs(vals.travel - vals.travelWant) > 2) bad++;
          per[G.id] = vals;
        }
        /* 「用户实配」那一组的**居中**：墨迹中心必须落在**行中心**上（±1.5px）——
           这正是用户拿来说"没生效"的那件事 */
        const midOff = Math.round((per.tight.middle.inkC - per.tight.middle.rowMid) * 10) / 10;
        if (Math.abs(midOff) > 1.5) bad++;
        const judge = bad === 0 && canvasOk;

        rec(
          S43,
          judge,
          "两组样式 × 三档，逐档比「墨迹中心 vs 期望（箱顶 + 0.40em）」：" +
          "　宽松 60/18 位移 " + per.loose.travel + "px（期望 " + per.loose.travelWant + "）" +
          "　**用户实配 28/12 位移 " + per.tight.travel + "px（期望 " + per.tight.travelWant + "）**" +
          "　居中档落点 vs 行中心 = " + midOff + "px（须 ≤1.5）" +
          "　超差 " + bad + " 项　画布=" + info43.docW + "×" + info43.docH +
          "　激活=" + JSON.stringify(act0) +
          "　逐档：" + notes.join(" ") +
          "　⇒ " + (judge
            ? "三档都按**墨迹**落到位（居中真的居中、底档墨迹贴下内边距线），" +
              "且 28/12 的位移从老实现的 4.16px 提到 " + per.tight.travel + "px ⇒ 肉眼看得出来"
            : "⚠️ 有档位残差超 1.5px —— 见逐档读数（画布尺寸若为 0/NaN，是建文档那步的问题）")
        );
      } finally {
        try {
          await ps.closeDocument(sc43.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S43, false, (e && e.message) || String(e));
  }


  /* ---------- S45: 建层描述符的两个"能省掉阶段二"的加法（v0.4.7）
     为什么要有它：阶段二（逐格 `doc.activeLayers=` + `layer.name=`）真机量出来是
     **O(格数 × 文档层数)** —— 35 格 / 51 层时单次 **196ms / 169ms**，整段 **12.7s**；
     而同在阶段二的 `batchPlay(set paragraphStyle)` 只要 **23ms/格**（线性、便宜）。
     ⇒ 开销在 UXP **DOM**，不在 AM。⇒ 只要"图层名"和"段落对齐"能在**建层那一条描述符**里带上，
       阶段二就整个消失（12.7s → 0，总耗时回到"第①批"那 2 秒量级）。

     ⚠️ 这两个加法正是 v0.4.0 卡死宿主的**同一类**"推理出来的描述符"。
        ⇒ **一条命令单独发、发完立刻读回**，绝不与其它未验项合批（两条也分开验）。
        卡住的话日志会停在"即将发第 N 条"，那就是分野线。

     判据（全部**读回**，不看"命令没报错"）：
       ① 层名读到 == 我们要的（不是默认的"文字图层 n"）
       ② 段落对齐读到 == 我们要的（枚举族 alignmentType / 值 center）
       ③ 文字内容没被改坏，且读到的是**刚建的那一层** */
  const S45 = "S45 建层描述符能否一次带上「图层名 + 段落对齐」（分别单条验，省掉阶段二）";
  try {
    const sc45 = await ps.createScratchDoc({ size: 300, name: "Vellum 自检临时文档(S45建层加法)" });
    if (!sc45 || !sc45.ok) {
      rec(S45, false, "建临时文档失败：" + ((sc45 && sc45.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc45.id);
        const note45 = [];
        /* ---- 第 1 条：`name`（不带对齐） ---- */
        await log.appendLog("S45 即将发第 1 条：make textLayer + name（若卡住请点掉 PS 里的对话框，日志会停在这一行）");
        let r1 = null;
        try {
          await ps.runModal(async () => {
            await ps.batchPlay([ps.textLayerBoxDesc({
              text: "甲", box: { left: 20, top: 20, right: 180, bottom: 60 },
              sizePt: 18, rgb: { r: 0, g: 0, b: 0 }, name: "vt-s45-name",
            })], {});
          }, "Vellum 工具箱：S45 第 1 条");
          r1 = { ok: true };
        } catch (e) {
          r1 = { ok: false, error: (e && e.message) || String(e) };
        }
        const li1 = r1.ok ? ps.layerInfo() : null;
        const pr1 = r1.ok ? ps.textItemProbe() : null;
        const nameOk = !!(li1 && li1.ok && String(li1.name) === "vt-s45-name");
        const textOk1 = !!(pr1 && pr1.values && pr1.values.contents === "甲");
        await log.appendLog("S45 第 1 条回来了：发送=" + (r1.ok ? "没抛错" : "抛错 " + r1.error) +
          "　层名=" + JSON.stringify((li1 && li1.name) || null) + "　内容=" +
          JSON.stringify((pr1 && pr1.values && pr1.values.contents) || null));

        /* ---- 第 2 条：`paragraphStyleRange`（对齐），单独一发 ---- */
        await log.appendLog("S45 即将发第 2 条：make textLayer + paragraphStyleRange(center)");
        let r2 = null;
        try {
          await ps.runModal(async () => {
            await ps.batchPlay([ps.textLayerBoxDesc({
              text: "乙", box: { left: 20, top: 90, right: 180, bottom: 130 },
              sizePt: 18, rgb: { r: 0, g: 0, b: 0 },
              align: { cls: "alignmentType", value: "center" },
            })], {});
          }, "Vellum 工具箱：S45 第 2 条");
          r2 = { ok: true };
        } catch (e) {
          r2 = { ok: false, error: (e && e.message) || String(e) };
        }
        let alignOk = false;
        let alignGot = null;
        let textOk2 = false;
        if (r2.ok) {
          const tk = await ps.readTextKeyDesc();
          const sm = tk.ok ? ps.summarizeTextKey(tk.raw) : null;
          const a = sm && (sm.paragraphAlign || sm.paragraphJustification);
          alignGot = a ? a.cls + ":" + a.value : null;
          alignOk = !!(a && a.value === "center");
          const pr2 = ps.textItemProbe();
          textOk2 = !!(pr2 && pr2.values && pr2.values.contents === "乙");
        }
        await log.appendLog("S45 第 2 条回来了：发送=" + (r2.ok ? "没抛错" : "抛错 " + r2.error) +
          "　段落对齐=" + JSON.stringify(alignGot) + "　内容=" + (textOk2 ? "乙" : "?"));

        /* 判据只押**我们要依赖的那一条**（对齐内联生效）。
           `name` 被忽略是**读数**、不是失败：PS 用文字内容当默认层名 ⇒ 命名改走第②批 `set name`（S46 已验）。
           ⚠️ 哪天真机上 `name` 开始生效，这里会先看出来（那时第②批可以省掉）。 */
        const judge = !!(r1.ok && textOk1 && r2.ok && alignOk && textOk2);
        rec(
          S45,
          judge,
          "第1条 name：发送=" + (r1.ok ? "没抛错" : "✗" + r1.error) +
          "　层名=" + JSON.stringify((li1 && li1.name) || null) + "（须 vt-s45-name）" + (nameOk ? " ✓" : " ✗") +
          "　内容=" + JSON.stringify((pr1 && pr1.values && pr1.values.contents) || null) + (textOk1 ? " ✓" : " ✗") +
          "　‖ 第2条 paragraphStyleRange：发送=" + (r2.ok ? "没抛错" : "✗" + r2.error) +
          "　对齐=" + JSON.stringify(alignGot) + "（须 alignmentType:center）" + (alignOk ? " ✓" : " ✗") +
          "　内容=" + (textOk2 ? "乙 ✓" : "✗") +
          "　⇒ 对齐**可以内联**（这一条已改为默认走法）；`name` 被忽略（" +
          (nameOk ? "⚠️ 这次**居然生效了** —— 若稳定，第②批改名可以省掉" : "PS 用文字内容当默认层名") +
          "）⇒ 命名仍走第②批 `set name`（S46 已验）" +
          (judge ? "；阶段二只剩**一次 batchPlay**，UXP DOM 的两个写操作全部消失" : " ⚠️ 对齐内联没成立，只能退回逐格 DOM")
        );
      } finally {
        try {
          await ps.closeDocument(sc45.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S45, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S46: 「改名」的两条路能不能走 AM（v0.4.7）
     S45 的结论：`paragraphStyleRange`（对齐）建层时就生效 ✓，但 `name` 被**忽略**
     （层名变成文字内容）。而阶段二里**改名占 5.9s**（35 格 / 51 层时 169ms/格 ——
     UXP DOM 的 `layer.name=` 单次代价随**文档层数**涨）。
     ⇒ 试两条**走 AM** 的路（AM 那边 23ms/命令且可以合批）：
        ① 按 `_id` 选中图层后 `set` 它的 `name`（一次 batchPlay 能合 35 条）
        ② 形状图层（`make contentLayer`）的 `name` —— 录制样例里**有**这个字段，
           若成立，线/外框/背景一起在建层那一发里命名（0 成本）
     ⚠️ 两条都是**单条发、发完立刻读回**（未验描述符的纪律）。 */
  const S46 = "S46 改名的两条路：AM 按 _id set name / contentLayer 的 name（分别单条验）";
  try {
    const sc46 = await ps.createScratchDoc({ size: 300, name: "Vellum 自检临时文档(S46改名)" });
    if (!sc46 || !sc46.ok) {
      rec(S46, false, "建临时文档失败：" + ((sc46 && sc46.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc46.id);
        /* 先用**已验**描述符造一个文字层，再拿它的 id 去试 AM 改名 */
        await ps.runModal(async () => {
          await ps.batchPlay([ps.textLayerBoxDesc({
            text: "丙", box: { left: 20, top: 20, right: 180, bottom: 60 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 },
          })], {});
        }, "Vellum 工具箱：S46 造层");

        /* 取 id（DOM 读，不写） */
        let id0 = null;
        await ps.runModal(async () => {
          const doc = ps.app.activeDocument;
          const l = doc.activeLayers && doc.activeLayers[0];
          if (!l) throw new Error("没有活动图层");
          id0 = l.id;
        }, "Vellum 工具箱：S46 取 id");

        /* ---- ① AM：按 _id `set name` ---- */
        await log.appendLog("S46 即将发第 1 条：set name（按 _id=" + id0 + "）");
        let r1 = null;
        try {
          await ps.runModal(async () => {
            await ps.batchPlay([{
              _obj: "set",
              _target: [{ _ref: "layer", _id: id0 }],
              to: { name: "vt-s46-byid" },
            }], {});
          }, "Vellum 工具箱：S46 AM 改名");
          r1 = { ok: true };
        } catch (e) {
          r1 = { ok: false, error: (e && e.message) || String(e) };
        }
        const after1 = ps.layerInfo();
        const byIdOk = !!(r1.ok && after1 && after1.ok && String(after1.name) === "vt-s46-byid");
        await log.appendLog("S46 第 1 条回来了：发送=" + (r1.ok ? "没抛错" : "抛错 " + r1.error) +
          "　层名=" + JSON.stringify((after1 && after1.name) || null));

        /* ---- ② 形状图层（contentLayer）的 `name` ---- */
        await log.appendLog("S46 即将发第 2 条：make contentLayer(rectangle) + name");
        let r2 = null;
        try {
          await ps.runModal(async () => {
            await ps.batchPlay([ps.rectShapeMakeDesc(
              { left: 20, top: 150, right: 180, bottom: 154 },
              { r: 200, g: 0, b: 0 },
              { fill: true, stroke: false, name: "vt-s46-shape" }
            )], {});
          }, "Vellum 工具箱：S46 形状命名");
          r2 = { ok: true };
        } catch (e) {
          r2 = { ok: false, error: (e && e.message) || String(e) };
        }
        const after2 = r2.ok ? ps.layerInfo() : null;
        const shapeOk = !!(after2 && after2.ok && String(after2.name) === "vt-s46-shape");
        await log.appendLog("S46 第 2 条回来了：发送=" + (r2.ok ? "没抛错" : "抛错 " + r2.error) +
          "　形状层名=" + JSON.stringify((after2 && after2.name) || null));

        /* 判据只押**要依赖的那一条**（AM 按 _id 改名 —— 阶段二就靠它）。
           `contentLayer` 的 `name` 被忽略是**读数**（录制样例里有这个字段、但真机不吃）⇒ 形状用 PS 默认名。 */
        const judge = !!byIdOk;
        rec(
          S46,
          judge,
          "① AM 按 _id set name：发送=" + (r1.ok ? "没抛错" : "✗" + r1.error) +
          "　层名=" + JSON.stringify((after1 && after1.name) || null) + "（须 vt-s46-byid）" + (byIdOk ? " ✓" : " ✗") +
          "　‖ ② contentLayer 的 name：发送=" + (r2.ok ? "没抛错" : "✗" + r2.error) +
          "　层名=" + JSON.stringify((after2 && after2.name) || null) + "（须 vt-s46-shape）" + (shapeOk ? " ✓" : " ✗") +
          "　⇒ 改名走**一次 batchPlay**（不再碰 UXP DOM）；`contentLayer` 的 name " +
          (shapeOk ? "⚠️ 这次居然生效了（那真机行为变了，可以考虑省掉形状改名）" : "被忽略 ⇒ 形状保持 PS 默认名")
          + (byIdOk ? "" : " ⚠️ 但 AM 改名**不通** ⇒ 只能退回 DOM 改名或不要命名")
        );
      } finally {
        try {
          await ps.closeDocument(sc46.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S46, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S48: M3b 出稿引擎（真机）—— 模板组复制 N 份 + 每份写自己那行的值
     为什么只验"引擎"不验"面板"：面板那条链已经由 S41（挂载/几何）覆盖；
     出稿真正会出事的地方是**引擎**（复制 → 新模态读副本 → 写文字 → 位移），
     离线那份用的是 mock 的 duplicate 模拟 ⇒ 真机上必须再跑一遍。
     模板怎么造：`make textLayer` 的层名 = **文字内容**（S45 实测）⇒ 直接建两个内容为
     「标题」「价格」的文字层，它们的名字就是这两个词，正好当绑定键。
     判据（全部读回，不看"命令没报错"）：
       ① 复制出 3 份、名字按规则带行值 ② **每份写的是自己那一行**的值（不是同一行写三遍）
       ③ **原件一字没动** ④ 副本被网格推开（bounds 相对模板位移 = 计划里的 dx/dy）
       ⑤ 分段耗时（复制批次 / 写文字 / 移动）—— 用来对账"预估耗时"准不准 */
  const S48 = "S48 M3b 出稿引擎（真机）：复制 3 份 + 每份写自己那行的值 + 原件不动 + 网格排开";
  try {
    const bmod = require("./batch.js");
    const sc48 = await ps.createScratchDoc({ size: 1000, name: "Vellum 自检临时文档(M3b 出稿)" });
    if (!sc48 || !sc48.ok) {
      rec(S48, false, "建临时文档失败：" + ((sc48 && sc48.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc48.id);
        const TPL = "vt-s48-版式";
        const TGT = "vt-s48-靶";
        const OTHER = "vt-s48-别的层";
        /* 靶层与对照组**先造**（在模板之前）：这样它们落在**顶层**、不会混进模板组
           （第一轮就是因为在建完模板组之后造靶层 ⇒ 靶层跑进了组里、被一起复制进副本，读数全歪）。
           对照组的作用：证明 move 认的是 `_target` 而不是"当前活动图层" ——
           第一轮的探针里靶层**恰好就是活动层**，所以那条 ✓ 是无效读数（又是"没有对照组的失败实验"）。 */
        await ps.runModal(async () => {
          await ps.batchPlay([
            ps.textLayerBoxDesc({ text: TGT, box: { left: 300, top: 40, right: 420, bottom: 80 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 } }),
            ps.textLayerBoxDesc({ text: OTHER, box: { left: 300, top: 200, right: 420, bottom: 240 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 } }),
          ], {});
        }, "Vellum：S48 造靶层与对照组");
        await ps.runModal(async () => {
          await ps.batchPlay([ps.groupMakeDesc(TPL)], {});
          await ps.batchPlay([
            ps.textLayerBoxDesc({ text: "标题", box: { left: 40, top: 40, right: 200, bottom: 80 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 } }),
            ps.textLayerBoxDesc({ text: "价格", box: { left: 40, top: 100, right: 200, bottom: 140 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 } }),
          ], {});
        }, "Vellum：S48 建模板");
        /* ⚠️ 跨模态读模板（v0.4.7 / S47 的教训：同一模态里刚建的东西读不全） */
        const brief = (() => {
          const b = ps.groupBriefByName(TPL);
          return b && b.ok ? b.tpl : null;
        })();
        if (!brief) throw new Error("读不到模板组（" + ((ps.groupBriefByName(TPL) || {}).error || "?") + "）");

        /* ⚠️ AM `move` 是**新描述符** ⇒ 按纪律**先单条发、读回位移对上了再用**。
           （DOM `translate()` 对这个组不生效 —— 第一轮实测"调用没报错、副本 bounds 一动不动"。） */
        await log.appendLog("S48 即将单条验**两个位移原语**（靶层**非活动**、另设对照组）；若卡住请点掉对话框");
        const findByName = (nm) => {
          let hit = null;
          const walk = (arr) => {
            for (const l of arr || []) {
              if (hit) return;
              if (String(l.name) === nm) { hit = l; return; }
              if (l.layers && l.layers.length) walk(l.layers);
            }
          };
          walk(ps.app.activeDocument.layers);
          return hit;
        };
        const boundsOf = async (nm) => {
          let r = null;
          await ps.runModal(async () => {
            const l = findByName(nm);
            if (!l) throw new Error("找不到 " + nm);
            const b = l.bounds;
            r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
          }, "Vellum：S48 读 " + nm);
          return r;
        };
        const activate = async (nm) => {
          await ps.runModal(async () => {
            const l = findByName(nm);
            if (!l) throw new Error("找不到 " + nm);
            ps.app.activeDocument.activeLayers = [l];
          }, "Vellum：S48 选中 " + nm);
        };
        /* 一次探针：把**对照组设为活动**，然后对**靶层**（按 _id / 按对象）施加位移。
           判据要两组读数：靶层必须动 (20,12)、对照组必须**一动不动**。 */
        const probeMove = async (how) => {
          const r = { how: how, ok: false };
          try {
            await activate(OTHER);                       // 让靶层**不是**活动层
            const before = await boundsOf(TGT);
            if (how === "am") {
              const id = (await (async () => {
                let id = null;
                await ps.runModal(async () => { id = findByName(TGT).id; }, "Vellum：S48 取靶层 id");
                return id;
              })());
              await ps.runModal(async () => {
                await ps.batchPlay([ps.moveByIdCmd(id, 20, 12)], {});
              }, "Vellum：S48 AM move（靶层非活动）");
            } else {
              await ps.runModal(async () => {
                findByName(TGT).translate(20, 12);
              }, "Vellum：S48 DOM translate（靶层非活动）");
            }
            const after = await boundsOf(TGT);
            const other = await boundsOf(OTHER);
            r.targetMoved = !!(before && after && Number(after.left) - Number(before.left) === 20 &&
              Number(after.top) - Number(before.top) === 12);
            r.otherUnmoved = !!(other && Number(other.left) === 300 && Number(other.top) === 200);
            r.ok = r.targetMoved && r.otherUnmoved;
          } catch (e) {
            r.error = (e && e.message) || String(e);
          }
          return r;
        };
        const mAm = await probeMove("am");
        const mDom = await probeMove("dom");
        const mprobe = { am: mAm, dom: mDom, ok: mAm.ok || mDom.ok, via: mAm.ok ? "am" : (mDom.ok ? "dom" : null) };
        /* 探针只是**读数**（目标是"非活动层"时两个原语都不认目标 ⇒ 实现改走"先选中再平移"），
           不再当判据 —— 网格到底行不行，由后面的**副本 bounds 位移断言**说了算。 */

        const brief2 = (() => {
          const b = ps.groupBriefByName(TPL);
          return b && b.ok ? b.tpl : null;
        })();
        if (!brief2) throw new Error("move 之后读不到模板组了");
        /* 绑定按**序号**（真机上 duplicate 会把副本子层改名成「标题 拷贝」⇒ 名字没法配） */
        const idxOf = (nm) => brief2.textLayers.map((x) => String(x.name)).indexOf(nm);
        const iTitle = idxOf("标题");
        const iPrice = idxOf("价格");
        if (iTitle < 0 || iPrice < 0) throw new Error("模板里的文字层名不是预期的： " + JSON.stringify(brief2.textLayers.map((x) => x.name)));

        const rows = [["开学季", "199"], ["秋季班", "299"], ["寒假营", "399"]];
        const plan = bmod.planExport({
          rows: rows, header: ["名称", "价格"],
          bindings: { 0: iTitle, 1: iPrice },
          tpl: brief2, tplRect: brief2.rect, cols: 3,
        });
        if (!plan.ok) throw new Error("出稿计划没成立：" + plan.error);

        const r = await ps.exportByRows(plan, { tplId: brief.id });   // 默认：逐份"选中 → translate"

        /* 读回：找到 3 份副本 + 各自的两处文字 + 原件的两处文字 */
        let got = null;
        await ps.runModal(async () => {
          const doc = ps.app.activeDocument;
          const findOne = (nm) => {
            let hit = null;
            const walk = (arr) => {
              for (const l of arr || []) {
                if (hit) return;
                if (String(l.name) === nm) { hit = l; return; }
                if (l.layers && l.layers.length) walk(l.layers);
              }
            };
            walk(doc.layers);
            return hit;
          };
          const textsOf = (g) => {
            const out = [];
            const walk = (arr) => {
              for (const k of arr || []) {
                if (k.kind === "text") {
                  /* ⚠️ 只取**内容**：文字图层的名字会跟着内容变（写进"开学季"后名字也成了"开学季"），
                     拿"名字=内容"当判据会误判。 */
                  let c = "";
                  try { c = String(k.textItem.contents); } catch { c = ""; }
                  out.push(c);
                }
                if (k.layers && k.layers.length) walk(k.layers);
              }
            };
            walk(g && g.layers);
            return out.sort();
          };
          const box = (g) => {
            try { const b = g.bounds; return { l: Math.round(b.left), t: Math.round(b.top) }; } catch { return null; }
          };
          const c1 = findOne(plan.copies[0].name);
          const c2 = findOne(plan.copies[1].name);
          const c3 = findOne(plan.copies[2].name);
          const tplG = findOne(TPL);
          got = {
            tplName: tplG ? String(tplG.name) : null,
            tplTexts: textsOf(tplG),
            tplBox: tplG ? box(tplG) : null,
            c1: c1 ? { name: String(c1.name), texts: textsOf(c1), box: box(c1) } : null,
            c2: c2 ? { name: String(c2.name), texts: textsOf(c2) } : null,
            c3: c3 ? { name: String(c3.name), texts: textsOf(c3) } : null,
            copyNames: [c1, c2, c3].filter(Boolean).map((x) => String(x.name)),
          };
        }, "Vellum：S48 读回");

        const wantName = ["稿件 1 · 开学季", "稿件 2 · 秋季班", "稿件 3 · 寒假营"];
        const namesOk = got.copyNames.length === 3 && wantName.every((n) => got.copyNames.indexOf(n) >= 0);
        const has = (arr, v) => !!(arr && arr.indexOf(v) >= 0);
        const c1ok = has(got.c1 && got.c1.texts, "开学季") && has(got.c1 && got.c1.texts, "199");
        const c2ok = has(got.c2 && got.c2.texts, "秋季班") && has(got.c2 && got.c2.texts, "299");
        const c3ok = has(got.c3 && got.c3.texts, "寒假营") && has(got.c3 && got.c3.texts, "399");
        const tplOk = got.tplTexts.length === 2 && has(got.tplTexts, "标题") && has(got.tplTexts, "价格");
        const dx0 = got.c1 && got.tplBox ? got.c1.box.l - got.tplBox.l : null;
        const dy0 = got.c1 && got.tplBox ? got.c1.box.t - got.tplBox.t : null;
        /* ⚠️ 允许 ±1：bounds 是整数，同一套字形在不同实例上会差 1px（实测 53/92 vs 计划 52/93） */
        const moveOk = dx0 !== null && Math.abs(dx0 - plan.copies[0].dx) <= 1 &&
          Math.abs(dy0 - plan.copies[0].dy) <= 1;
        const judge = r.ok === true && r.copies === 3 && r.writes === 6 && r.moved === 3 &&
          namesOk && c1ok && c2ok && c3ok && tplOk && moveOk;
        await log.appendLog("S48 明细：r=" + JSON.stringify({ ok: r.ok, copies: r.copies, writes: r.writes, writesWant: r.writesWant, moved: r.moved }) +
          " 耗时 dup=" + r.dupMs + "ms step2=" + r.step2Ms + "ms（写 " + r.writesMs + " / 移动 " + r.moveMs + "）" +
          " 计划预估=" + plan.estimatedMs + "ms　副本名=" + JSON.stringify(got.copyNames) +
          "　原件=" + JSON.stringify(got.tplTexts) + "　副本1=" + JSON.stringify(got.c1 && got.c1.texts) +
          "　位移=" + JSON.stringify([dx0, dy0]) + "（须 " + JSON.stringify([plan.copies[0].dx, plan.copies[0].dy]) + "）" +
          (r.missing && r.missing.length ? "　missing=" + r.missing.slice(0, 3).join("；") : "") +
          (r.firstError ? "　firstErr=" + r.firstError : "") + (r.error ? "　err=" + r.error : ""));

        rec(
          S48,
          judge,
          "复制 " + r.copies + "/3 份、写 " + r.writes + "/6 处、移动 " + r.moved + "/3" +
          "　副本名对=" + namesOk + "（" + JSON.stringify(got.copyNames) + "）" +
          "　第1份=" + JSON.stringify(got.c1 && got.c1.texts) + (c1ok ? " ✓" : " ✗") +
          "　第2份=" + JSON.stringify(got.c2 && got.c2.texts) + (c2ok ? " ✓" : " ✗") +
          "　第3份=" + JSON.stringify(got.c3 && got.c3.texts) + (c3ok ? " ✓" : " ✗") +
          "　**原件**=" + JSON.stringify(got.tplTexts) + (tplOk ? "（没被动过 ✓）" : " ✗ 被改了！") +
          "　位移=" + JSON.stringify([dx0, dy0]) + (moveOk ? " ✓" : " ✗ 与计划不符") +
          "　【读数·不进判据】目标是**非活动**层时：AM move=" +
          (mAm.targetMoved ? "动" : "**不动**") + "/对照组" + (mAm.otherUnmoved ? "不动" : "**动了**") +
          "、DOM translate=" + (mDom.targetMoved ? "动" : "**不动**") + "/对照组" + (mDom.otherUnmoved ? "不动" : "**动了**") +
          " ⇒ 两个原语都**只认当前活动层**，实现改走「先选中、再 translate」" +
          "　耗时：复制批次 " + r.dupMs + "ms / 阶段二 " + r.step2Ms + "ms（写 " + r.writesMs + "、移动 " + r.moveMs + "）" +
          "、计划预估 " + plan.estimatedMs + "ms" +
          (r.error ? "　err=" + r.error : "") +
          "　⇒ " + (judge
            ? "M3b 引擎在真机上成立：一次 batchPlay 复制 + 一次模态写完文字并排开，原件不动、每份拿到自己那行的值"
            : "⚠️ 有项没成立 —— 见明细行（每份的值 / 原件是否被动 / 位移是硬条件）")
        );
      } finally {
        try {
          await ps.closeDocument(sc48.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S48, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S47: 批量出稿（M3b）开工前的测量 + 单条验证（v0.5.0）
     M3b 的两个动作在 v0.3.8 / S33 都已验过**能用**：
       · 复制图层组：`doc.activeLayers=[group]` → `Layer.duplicate()`（DOM）
       · 换文字：`layer.textItem.contents = 值`（DOM —— 是 `textItem` **唯一**可写属性）
     **但"能用"≠"够快"**：v0.4.7 刚量出 DOM 写操作在文档变大时会变成 O(文档大小)，
     而 M3b 恰恰是"复制 N 份 × 每份换 M 处文字"，把它们放进了**规模循环**。
     ⇒ 开工前先量成本曲线（四分位），并顺手试一条可能让 M3b 全走 AM 的路。

     ① DOM 选择模板组 + `duplicate()` 的成本（四分位 —— 后段明显变慢 ⇒ O(文档层数)）
     ② DOM 改文字（`textItem.contents`）的成本
     ③ 副本的文字**独立**（改副本不动原件）——"多份"规模下复验 S33
     ④ 单条 AM `duplicate`（按 `_id`）能不能成立（若成立：M3b 可以全走 AM 并合批）

     ⚠️ 只作用在自建临时文档上，跑完关掉；④ 是**单条**发、发完读回。 */
  const S47 = "S47 批量出稿开工前：复制/改文字的**成本曲线** + AM duplicate 能不能用";
  try {
    const sc47 = await ps.createScratchDoc({ size: 400, name: "Vellum 自检临时文档(M3b 测量)" });
    if (!sc47 || !sc47.ok) {
      rec(S47, false, "建临时文档失败：" + ((sc47 && sc47.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc47.id);
        const TNAME = "vt-s47-模板";
        /* 模板：一个组 + 两个文字层（全部用已验描述符） */
        await ps.runModal(async () => {
          await ps.batchPlay([ps.groupMakeDesc(TNAME)], {});
          await ps.batchPlay([
            ps.textLayerBoxDesc({ text: "旧-A", box: { left: 20, top: 20, right: 180, bottom: 60 }, sizePt: 16, rgb: { r: 0, g: 0, b: 0 } }),
            ps.textLayerBoxDesc({ text: "旧-B", box: { left: 20, top: 70, right: 180, bottom: 110 }, sizePt: 16, rgb: { r: 0, g: 0, b: 0 } }),
          ], {});
        }, "Vellum：S47 建模板");

        const N = 10;                       // 两条路各复制 10 份（够看出曲线，又不拖时间）
        const TPL_TEXT = ["旧-A", "旧-B"];   // 模板里两个文字层的初始内容（建层顺序）
        const findByName = (name) => {
          let hit = null;
          const walk = (arr) => {
            for (const l of arr || []) {
              if (hit) return;
              if (l.kind === "group" && String(l.name) === name) { hit = l; return; }
              if (l.layers && l.layers.length) walk(l.layers);
            }
          };
          walk(ps.app.activeDocument.layers);
          return hit;
        };
        const findById = (id) => {
          let hit = null;
          const walk = (arr) => {
            for (const l of arr || []) {
              if (hit) return;
              if (l.id === id) { hit = l; return; }
              if (l.layers && l.layers.length) walk(l.layers);
            }
          };
          walk(ps.app.activeDocument.layers);
          return hit;
        };
        const textsOf = (grp) => {
          const kids = (grp && grp.layers) ? grp.layers.filter((l) => l.kind === "text") : [];
          const out = [];
          for (const k of kids) {
            try {
              out.push({ layer: k, text: String(k.textItem.contents) });
            } catch {
              /* 读不到就跳过 */
            }
          }
          return out;
        };
        const trunc = (s, n) => String(s === null || s === undefined ? "null" : s).slice(0, n);

        await log.appendLog("S47 开始：两条路各复制 " + N + " 份");

        /* ── A) DOM 路径：每份**三个模态边界**（选中 / 复制 / 改文字）—— 这就是 DOM 实现的样子 ──
           为什么必须分三个模态：v0.4.7 那轮学过"DOM 是懒的"，这次实测**在同一个 modal 里
           `duplicate()` 之后立刻读 `copy.layers` 会读到空数组**（第一版就是这么"改文字 0 次"的）。 */
        const A4 = { sel: 0, dup: 0, txt: 0 };
        let aCopies = 0;
        let aWrites = 0;
        let aErr = null;
        const tA = Date.now();
        for (let i = 0; i < N; i++) {
          let t = Date.now();
          let grpId = null;
          try {
            await ps.runModal(async () => {
              const g = findByName(TNAME);
              if (!g) throw new Error("找不到模板组");
              ps.app.activeDocument.activeLayers = [g];
              grpId = g.id;
            }, "Vellum：S47-A 选中模板");
          } catch (e) {
            aErr = "选中：" + ((e && e.message) || e);
            break;
          }
          A4.sel += Date.now() - t;
          t = Date.now();
          let copyId = null;
          try {
            await ps.runModal(async () => {
              const sel = ps.app.activeDocument.activeLayers[0];
              if (!sel) throw new Error("没有活动图层");
              const c = await sel.duplicate();
              copyId = c ? c.id : null;
            }, "Vellum：S47-A 复制");
            aCopies++;
          } catch (e) {
            aErr = "复制：" + ((e && e.message) || e);
            break;
          }
          A4.dup += Date.now() - t;
          t = Date.now();
          try {
            await ps.runModal(async () => {
              const c = copyId === null ? null : findById(copyId);
              if (!c) throw new Error("复制完读不到副本（copyId=" + copyId + "）");
              for (const k of textsOf(c)) {
                k.layer.textItem.contents = "A" + (i + 1) + "-" + trunc(k.text, 3);
                aWrites++;
              }
              c.name = TNAME + " A" + (i + 1);
            }, "Vellum：S47-A 改文字");
          } catch (e) {
            aErr = "改文字：" + ((e && e.message) || e);
            break;
          }
          A4.txt += Date.now() - t;
        }
        const msA = Date.now() - tA;

        /* ── B) AM 路径：**一次 batchPlay** 复制 N 份（按 _id），再**一次 DOM 模态**写完所有文字 ── */
        let tplId = null;
        await ps.runModal(async () => {
          const g = findByName(TNAME);
          tplId = g ? g.id : null;
        }, "Vellum：S47 取模板 id");
        await log.appendLog("S47 即将发 AM duplicate × " + N + "（一次 batchPlay，_id=" + tplId + "）");
        const tB0 = Date.now();
        let bErr = null;
        let bCopies = 0;
        try {
          const cmds = [];
          for (let i = 0; i < N; i++) {
            cmds.push({
              _obj: "duplicate",
              _target: [{ _ref: "layer", _id: tplId }],
              name: TNAME + " B" + (i + 1),
              _options: { dialogOptions: "dontDisplay" },
            });
          }
          await ps.runModal(async () => {
            await ps.batchPlay(cmds, {});
          }, "Vellum：S47-B AM 批量复制");
        } catch (e) {
          bErr = (e && e.message) || String(e);
        }
        const msBdup = Date.now() - tB0;

        /* 复制完**跨一个新模态**去读（同一个模态里读不到），并把两份的文字一次性写完 */
        let bWrites = 0;
        let bTxt0 = Date.now();
        let bTexts = [];
        try {
          await ps.runModal(async () => {
            const doc = ps.app.activeDocument;
            const groups = [];
            const walk = (arr) => {
              for (const l of arr || []) {
                if (l.kind === "group" && String(l.name).indexOf(TNAME) === 0) groups.push(l);
                if (l.layers && l.layers.length) walk(l.layers);
              }
            };
            walk(doc.layers);
            for (const g of groups) {
              const nm = String(g.name);
              if (nm === TNAME) continue;
              const bn = /B(\d+)$/.exec(nm);
              if (!bn) continue;
              bCopies++;
              const kids = textsOf(g);
              const after = [];
              for (let k = 0; k < kids.length; k++) {
                kids[k].layer.textItem.contents = "B" + bn[1] + "-" + k;
                bWrites++;
                /* ⚠️ 读回**写之后**的值（第一版记的是写之前捕获的旧文本 ⇒ 那条读数证明不了写入生效） */
                after.push(trunc(kids[k].layer.textItem.contents, 6));
              }
              bTexts.push(bn[1] + "=" + after.join(","));
            }
          }, "Vellum：S47-B 一次写完所有文字");
        } catch (e) {
          bErr = (bErr ? bErr + "；" : "") + "写文字：" + ((e && e.message) || e);
        }
        const msBtxt = Date.now() - bTxt0;

        /* ── 读回：原件有没有被动过（这是 M3b 的硬条件） ── */
        let origTexts = [];
        let aTexts = [];
        let bTextsBack = [];
        await ps.runModal(async () => {
          const tpl = findByName(TNAME);
          origTexts = textsOf(tpl).map((x) => trunc(x.text, 6));
          const a1 = findByName(TNAME + " A1");
          aTexts = textsOf(a1).map((x) => trunc(x.text, 6));
          bTextsBack = bTexts.slice(0, 4);
        }, "Vellum：S47 读回");

        const sum = (a) => a.reduce((x, y) => x + y, 0);
        const quart = (v, n) => v;   // A 路已经分了四段（这里只打印）
        const origIntact = origTexts.length === 2 && origTexts[0] === TPL_TEXT.slice().reverse()[0] &&
          origTexts[1] === TPL_TEXT.slice().reverse()[1];
        const aIndependent = aCopies > 0 && aTexts.length === 2 && aTexts.every((t) => t.indexOf("A1-") === 0);
        const judge = aCopies === N && aWrites === N * 2 && bCopies === N && bWrites === N * 2 && origIntact;

        rec(
          S47,
          judge,
          "**A) DOM 三步舞步**：" + aCopies + "/" + N + " 份、" + aWrites + "/" + (N * 2) + " 次写文字，总 " + msA + "ms" +
          "（选中 " + A4.sel + " / 复制 " + A4.dup + " / 改文字 " + A4.txt + "）" +
          "　**B) AM 一次批量复制**：" + bCopies + "/" + N + " 份、批量 " + msBdup + "ms（" + Math.round(msBdup / Math.max(1, N)) + "ms/份）" +
          " ⇒ 再**一次模态**写完 " + bWrites + "/" + (N * 2) + " 次文字 " + msBtxt + "ms" +
          "　‖ 原件=" + JSON.stringify(origTexts) + "（须没被动过：" + JSON.stringify(TPL_TEXT.slice().reverse()) + "）" +
          "　A1 副本=" + JSON.stringify(aTexts) +
          "　B 副本样本=" + JSON.stringify(bTextsBack) +
          (aErr ? "　A 首个错误=" + aErr : "") +
          (bErr ? "　B 首个错误=" + bErr : "") +
          "　⇒ " + (judge
            ? "两条路都能跑；B 路把 " + N + " 份复制压成 **1 次 batchPlay**、" + (N * 2) + " 次写文字压成**一次模态**"
            : "⚠️ 有项没成立（原件被动过 / 份数或写次数不对）—— M3b 不能开工")
        );
      } finally {
        try {
          await ps.closeDocument(sc47.id);
        } catch {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    rec(S47, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S42: 面板整链（免弹窗版，v0.4.2 新增）
     为什么要有它：面板上真正的「导入 CSV」要弹**系统文件选择器** —— 自检点不了、
     自动化也点不了 ⇒ "解码 → 解析 → 预览 → 生成"这条链在真机上一直缺中间一段：
     S40 是**绕过面板**直接调 `ps.buildTable`，S41 只验"挂得起来 + 控件几何"，
     **"人在面板上点"这一段没人验**。
     这里走「内置样例」（读插件自带 `samples/`，**同样 `read({format:binary})`、
     同样 `csv.readBytes()`**），差的只有最后那一次 `getFileForOpening()`。

     判据（期望值都是**独立算/写死**的，不复用被测模块的中间结果）：
       ① 点芯片后预览行数 = 7（1 表头 + 6 数据）
       ② 编码行显示 GBK，首个数据格 = 「开学季特训营」（写死的已知答案）
       ③ 预估文案里出现「51 个图层」
       ④ 点「生成表格」后：文档层数增量 **正好 51**
       ⑤ 组名 = 「表格 · prices-2026-gbk」、状态栏出现「已生成」
     🔴 期望层数**独立算**：7 行 × 5 列 = 35 文字 + 外框 4 + 内部横线 6 + 内部竖线 4
        + 表头背景 1 + 组 1 = **51** */
  const S42 = "S42 面板整链（免弹窗）：点内置 GBK 样例 → 预览 → 点「生成表格」→ 文档里真出 51 层";
  try {
    const txt = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.textContent || "") : "";
    };
    const sc42 = await ps.createScratchDoc({ size: 500, name: "Vellum 自检临时文档(面板)" });
    if (!sc42 || !sc42.ok) {
      rec(S42, false, "建临时文档失败：" + ((sc42 && sc42.error) || "未知"));
    } else {
      /* 🔴 读数**先声明在外面**：第一版把它们放在会抛异常的那句之后，结果
         `ps.findLayerDeep is not a function` 一抛，**一条读数都没留下**（只有异常文本）。
         "只有一种读数的失败 = 没测" —— 反过来也成立：**读数必须比异常先到**。 */
      let previewRows = -1;
      let cell1 = "";
      let encTxt = "";
      let estTxt = "";
      let added = -1;
      let grpOk = false;
      let statusTxt = "";
      let finishedOk = false;
      let genMs = -1;
      let stepErr = null;
      const want = 7 * 5 + 4 + 6 + 4 + 1 + 1; // 51（独立算：35 文字 + 外框 4 + 横 6 + 竖 4 + 背景 1 + 组 1）
      /* 🔴 v0.4.4：这个 51 只在**默认样式**下成立，而面板会**读用户存过的样式偏好**
         （真实翻车：用户在面板上开过「底色」，偏好里就多了 3 块行背景 ⇒ 实际 54，探针误报）。
         ⇒ 跑之前把偏好换成"确定基线"、跑完**原样还原**（和 palette.json 的备份同一个套路）。
         纪律：**期望值不许偷偷依赖被测环境的残留状态** —— 要么清干净，要么把状态写死。 */
      const prefRaw = await data.readText("table-pref.json", "");
      let prefTouched = false;
      try {
        await data.writeText("table-pref.json",
          '{"variant":1,"regionSource":"selection","headerRow":true,"style":{}}');
        prefTouched = true;
      } catch (e) {
        stepErr = "写基线偏好失败：" + ((e && e.message) || e);
      }
      try {
        await ctx.shell.showTool("table", "selfcheck");
        await waitFor(() => document.getElementById("vt-tbl"), 6000);
        const chip = document.getElementById("vt-tbl-sample-gbk");
        if (!chip) {
          stepErr = "面板上没有「GBK 样例」芯片（#vt-tbl-sample-gbk）";
        } else {
          const before = ps.countLayersDeep();

          syntheticClick(chip, null);
          await waitFor(() => {
            const g = document.getElementById("vt-tbl-grid");
            return g && g.children.length === 7 ? true : null;
          }, 6000);

          const gridEl = document.getElementById("vt-tbl-grid");
          previewRows = gridEl ? gridEl.children.length : -1;
          cell1 = gridEl && gridEl.children[1] && gridEl.children[1].children[0]
            ? String(gridEl.children[1].children[0].textContent || "") : "";
          encTxt = txt("vt-tbl-enc");
          estTxt = txt("vt-tbl-estimate");

          const genBtn = document.getElementById("vt-tbl-gen");
          if (!genBtn) {
            stepErr = "找不到「生成表格」按钮（#vt-tbl-gen）";
          } else {
            const statusBefore = txt("vt-status");
            syntheticClick(genBtn, null);
            /* 等的条件必须**就是要判的那个东西**，而且要"与点击前不同"：
               · 只等"层数涨到 51" ⇒ 那只是第①批发完，阶段二还没完、状态栏还没写
                 （v0.4.2 第一版就这么读早了，读到的还是"正在生成表格…"）；
               · 只等"按钮从『正在生成…』恢复" ⇒ 又早了一步：`doGenerate` 在恢复按钮之后
                 还要 `await` 一次日志落盘，然后才 `setStatus`（第二次就是这么错的）；
               · 不要求"与点击前不同" ⇒ 同一个 PS 会话里连跑两轮时，会读到**上一轮的陈旧文案**。 */
            await waitFor(() => (ps.countLayersDeep() - before >= want ? true : null), 30000);
            added = ps.countLayersDeep() - before;
            const finished = await waitFor(() => {
              const t = txt("vt-status");
              const looksDone = t.indexOf("已生成") >= 0 || t.indexOf("生成失败") >= 0 || t.indexOf("还不能生成") >= 0;
              return looksDone && t !== statusBefore ? t : null;
            }, 120000);
            finishedOk = !!finished;
            statusTxt = finished ? String(finished) : txt("vt-status");
            /* v0.4.7：把面板自己报的耗时抽出来 —— 它才是"性能优化到底有没有用"的读数 */
            const durHit = /用时\s*(\d+)\s*ms/.exec(statusTxt);
            genMs = durHit ? Number(durHit[1]) : -1;
            /* 找组这一步单独兜住：v0.4.2 第一次跑就是这里抛的（`findLayerDeep` 当时没导出），
               而它一抛，前面四条读数全跟着丢了 */
            try {
              grpOk = !!ps.findLayerDeep("表格 · prices-2026-gbk");
            } catch (e) {
              grpOk = false;
              stepErr = "找组失败：" + ((e && e.message) || e);
            }
          }
        }
      } catch (e) {
        stepErr = "步骤抛异常：" + ((e && e.message) || e);
      }

      const judge = stepErr === null && previewRows === 7 && encTxt.indexOf("GBK") >= 0 &&
        cell1 === "开学季特训营" && estTxt.indexOf(String(want) + " 个图层") >= 0 &&
        added === want && finishedOk && grpOk && statusTxt.indexOf("已生成") >= 0;

      rec(
        S42,
        judge,
        (stepErr ? "⚠ " + stepErr + "　" : "") +
        "① 预览行数=" + previewRows + "/7" +
        "　② 编码行=" + JSON.stringify(encTxt.slice(0, 22)) + "（须含 GBK）" +
        "、首个数据格=" + JSON.stringify(cell1) + "（须「开学季特训营」）" +
        "　③ 预估=" + JSON.stringify(estTxt.slice(0, 56)) +
        "（基线偏好已置默认、跑完还原）" +
        "　④ 点生成后层数增量=" + added + "/" + want +
        "（收尾=" + finishedOk + "）" +
        "　⑤ 组「表格 · prices-2026-gbk」=" + grpOk +
        "、状态栏=" + JSON.stringify(statusTxt.slice(0, 60)) +
        "、**本次生成耗时 " + genMs + "ms**" +
        "　⇒ " + (judge
          ? "面板整链通：点样例 → 读字节 → GBK 解码 → 预览 → 点生成 → 文档里真出 " + want + " 层" +
            "（**唯一没覆盖的**只剩系统文件选择器那一次弹窗）"
          : "⚠️ 有项没中 —— 见分段读数（①②③ 与文档无关；④⑤ 需要文档与区域）")

      );
      /* 还原偏好（没写过就当没有；写过就把原文写回去） */
      if (prefTouched) {
        try {
          await data.writeText("table-pref.json", prefRaw || "{}");
        } catch {
          /* 还原失败不影响结论，但要在读数里说一声 */
          stepErr = (stepErr ? stepErr + "；" : "") + "⚠️ 偏好还原失败";
        }
      }
      try {
        await ps.closeDocument(sc42.id);
      } catch {
        /* 忽略 */
      }
    }
  } catch (e) {
    rec(S42, false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S41: 表格面板真机挂载（v0.4.1 新增，M3a 的「面板」那一半）
     面板 800+ 行、控件**全是自绘**（`sp-*` 未注册，UXP 的 CSS/组件都是子集）
     ⇒ 离线只能验到**结构**（选择器在不在），"它到底能不能挂起来、控件有没有几何"
     只能上真机。这条走**真实 mount 路径**（`ctx.shell.showTool("table")`），再**量几何**。
     ⚠️ UXP 布局是异步的：同步 appendChild 后立刻量会得到 0（不是"没渲染"）
     ⇒ 一律**轮询到非零几何再量**（都是这么做的）。 */
  const S41 = "S41 表格面板真机挂载 —— 真实 mount 路径 + 关键控件几何 + 折叠块能点开";
  try {
    await ctx.shell.showTool("table", "selfcheck");

    const rootEl = await waitFor(() => {
      const el = document.getElementById("vt-tbl");
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return r && r.width > 0 && r.height > 0 ? el : null;
    }, 6000);

    if (!rootEl) {
      rec(S41, false, "挂载后 6s 内 #vt-tbl 仍没有非零几何 ⇒ 面板没挂起来（或布局卡住了）");
    } else {
      const rectOf = (id) => {
        const el = document.getElementById(id);
        if (!el || !el.getBoundingClientRect) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      const fmt = (id) => {
        const r = rectOf(id);
        return id + "(" + (r ? r.w + "×" + r.h : "无") + ")";
      };

      /* 🔴 判据的关键一层：**量几何之前必须先确认元素是可见的**。
         折叠块默认 `closed`（`.tbl-grp.closed .tbl-gb{display:none}`）⇒ 块内控件量出来
         是 0×0 —— 那是"没显示"，不是"没渲染"。第一版把两者混了，S41 自己 FAIL 过一次
         （vt-tbl-styletabs 报 0×0，其实只是它躺在收起的「样式」块里）。 */
      const alwaysIds = [
        "vt-tbl", "vt-tbl-src", "vt-tbl-grid", "vt-tbl-body", "vt-tbl-foot",
        "vt-tbl-g1", "vt-tbl-g2", "vt-tbl-g3",
        "vt-tbl-estimate", "vt-tbl-save",
        "vt-tbl-import", "vt-tbl-gen", "vt-tbl-docs",
      ];
      const missing = [];
      const zero = [];
      for (const id of alwaysIds) {
        const r = rectOf(id);
        if (!r) { missing.push(id); continue; }
        if (r.w <= 0 || r.h <= 0) zero.push(fmt(id));
      }

      /* 三个折叠块逐个**点标题展开**，展开后再量块内控件
         （顺带把"自绘控件的点击在真机上灵不灵 + 展开后真有内容"一起验了） */
      const expand = async (gid) => {
        const g = document.getElementById(gid);
        if (!g) return { ok: false, note: gid + " 不存在" };
        if (String(g.getAttribute("class") || "").indexOf("closed") >= 0 && g.children[0]) {
          syntheticClick(g.children[0], null);
          await waitFor(() => {
            const cls = String(g.getAttribute("class") || "");
            const b = g.children[1];
            const r = b && b.getBoundingClientRect ? b.getBoundingClientRect() : null;
            return cls.indexOf("closed") < 0 && r && r.height > 0 ? true : null;
          }, 3000);
        }
        const b = g.children[1];
        const r = b && b.getBoundingClientRect ? b.getBoundingClientRect() : null;
        const h = r ? Math.round(r.height) : -1;
        const open = String(g.getAttribute("class") || "").indexOf("closed") < 0;
        return { ok: open && h > 0, note: gid + (open ? " 展开→内容 " : " 仍收起→") + h + "px" };
      };

      const g1r = await expand("vt-tbl-g1");
      const g2r = await expand("vt-tbl-g2");
      const g3r = await expand("vt-tbl-g3");

      const innerIds = ["vt-tbl-regioninfo", "vt-tbl-styletabs"];
      const innerBad = [];
      for (const id of innerIds) {
        const r = rectOf(id);
        if (!r) { innerBad.push(id + "(无)"); continue; }
        if (r.w <= 0 || r.h <= 0) innerBad.push(fmt(id));
      }

      const rr = rootEl.getBoundingClientRect();
      const judge = missing.length === 0 && zero.length === 0 &&
        g1r.ok && g2r.ok && g3r.ok && innerBad.length === 0;
      rec(
        S41,
        judge,
        "挂载到 #vt-tbl=" + Math.round(rr.width) + "×" + Math.round(rr.height) + "px" +
        "　常显控件 " + alwaysIds.length + " 个：缺 " + missing.length +
        (missing.length ? "=[" + missing.join(",") + "]" : "") +
        "、零几何 " + zero.length + (zero.length ? "=[" + zero.join(",") + "]" : "") +
        "　折叠块点标题：" + g1r.note + " ／ " + g2r.note + " ／ " + g3r.note +
        "　块内控件（**展开后**量）" + innerIds.length + " 个：零几何 " + innerBad.length +
        (innerBad.length ? "=[" + innerBad.join(",") + "]" : "") +
        "　⇒ " + (judge
          ? "面板在真机上挂得起来：常显控件都有非零几何，三个折叠块都点得开且展开后真有内容"
          : "⚠️ 有项没成立（缺失=选择器没了；零几何=CSS/布局；块展不开=自绘控件失灵）")
      );

      /* 收尾：切回首页，别把自检的面板留在屏幕上（init 之后本来也会 showHome，这里显式一次） */
      try {
        await ctx.shell.showHome();
      } catch {
        /* 忽略 */
      }
    }
  } catch (e) {
    rec(S41, false, "抛异常：" + ((e && e.message) || e));
  }


  /* ---------- S44: 步进器几何（v0.4.6 新增）
     为什么单独立一条：`[−][12][+]` 的**边框盒**曾经只画 32px（子元素位置却是对的）⇒
     用户看到「边框只包住 −，数字和 + 掉在框外」，并把它报成"灰字压数字"。
     真机字符画看得出来，但**字符画不能自动跑** ⇒ 把"量几何"写进自检：
       ① 全尺寸步进器边框盒宽 == 88（紧凑版 64）—— UXP 算 flex 容器尺寸**不认 flex-basis**，
          宽度必须**写死**（`.tnum{width:88px}`）
       ② `− / 值 / +` 三个子元素**都在盒内**（一个都不许溢到框外）
       ③ 内边距那 4 个并排的紧凑步进器**两两不重叠**，最后一个不超出面板右边界
     期望值独立算：88 = 1 + 22 + 42 + 22 + 1；64 = 1 + 16 + 30 + 16 + 1。 */
  const S44 = "S44 步进器几何 —— 边框盒宽度 / 子元素不出框 / 4 个并排不重叠";
  try {
    await ctx.shell.showTool("table", "selfcheck");
    await waitFor(() => document.getElementById("vt-tbl"), 6000);

    const R = (id) => {
      const e = document.getElementById(id);
      if (!e || !e.getBoundingClientRect) return null;
      const r = e.getBoundingClientRect();
      return {
        l: Math.round(r.left), t: Math.round(r.top),
        r: Math.round(r.right), b: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    };
    const kidsOf = (id) => {
      const e = document.getElementById(id);
      if (!e || !e.children) return [];
      const out = [];
      for (let i = 0; i < e.children.length; i++) {
        const c = e.children[i];
        const r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
        if (r) out.push({
          l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width),
          cls: String(c.getAttribute("class") || ""),
        });
      }
      return out;
    };
    /* 展开折叠块（**幂等 + 一次重试**）：
       已经开着的别再点（点了反而会关）；第一次没开成再试一次并留痕 ——
       v0.4.6 首轮真机上 g1 开成了、g2 没开成（量出来 0×0），所以这里既要重试也要能看见过程。 */
    const gcls = {};
    const openGrp = async (id) => {
      const g = document.getElementById(id);
      if (!g) { gcls[id] = "(没有这个元素)"; return false; }
      const isClosed = () => String(g.getAttribute("class") || "").indexOf("closed") >= 0;
      const bodyH = () => {
        const body = g.children[1];
        const r = body && body.getBoundingClientRect ? body.getBoundingClientRect() : null;
        return r ? Math.round(r.height) : -1;
      };
      gcls[id] = String(g.getAttribute("class") || "") + "(高 " + bodyH() + ")";
      if (!isClosed() && bodyH() > 0) return true;
      for (let attempt = 0; attempt < 2; attempt++) {
        syntheticClick(g.children[0], null);
        const ok = await waitFor(() => (!isClosed() && bodyH() > 0 ? true : null), 2500);
        if (ok) {
          gcls[id] += " → 开(第 " + (attempt + 1) + " 次点)";
          return true;
        }
      }
      gcls[id] += " → 仍是关(" + String(g.getAttribute("class") || "") + " 高 " + bodyH() + ")";
      return false;
    };
    /* 诊断：同一 id 出现多次 ⇒ 面板被重复挂载（`getElementById` 只返回第一个） */
    let dupRoots = -1;
    try {
      dupRoots = document.querySelectorAll ? document.querySelectorAll("#vt-tbl").length : -1;
    } catch (e) {
      dupRoots = -1;
    }
    const open1 = await openGrp("vt-tbl-g1");     // 置入方式（行高 / 内边距）
    const open2 = await openGrp("vt-tbl-g2");     // 样式（字号在「行」tab）
    const tabs = document.getElementById("vt-tbl-styletabs");
    if (tabs && tabs.children.length >= 3) syntheticClick(tabs.children[2], null);
    /* 🔴 等的条件必须点名**我真正等的东西**：这里等的是"**布局落定**"，不是"元素出现"。
       点 tab 会 `dom.clear(g.gb)` 重建整个 pane ⇒ `#vt-tbl-fs` 是**刚被创建**的，
       而 UXP 的布局是**异步**的 ⇒ 只等"元素存在"就去量，拿到的是 `0×0`
       （v0.4.6 首轮真机就是这么 FAIL 的：行高在 g1、几秒前就建好了 ⇒ 88；字号刚建 ⇒ 0）。 */
    await waitFor(() => {
      const e = document.getElementById("vt-tbl-fs");
      if (!e || !e.getBoundingClientRect) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? true : null;
    }, 5000);

    const root = R("vt-tbl");
    const boxFS = R("vt-tbl-fs");                 // 字号（全尺寸）
    const kFS = kidsOf("vt-tbl-fs");
    const boxRH = R("vt-tbl-rh");                 // 行高（全尺寸）
    const kRH = kidsOf("vt-tbl-rh");
    const padIds = ["vt-tbl-pad-t", "vt-tbl-pad-r", "vt-tbl-pad-b", "vt-tbl-pad-l"];
    const pads = padIds.map(R);

    const near = (a, b, tol) => isFinite(a) && Math.abs(a - b) <= tol;
    const wideOk = !!(boxFS && near(boxFS.w, 88, 1) && boxRH && near(boxRH.w, 88, 1));
    /* 子元素全在盒内 + 三格宽度是 22/42/22
       ⚠️ 必须**先要求盒和子元素宽度都非零** —— 全 0 时 `l >= box.l-1` 恒成立，
       等于把一个"没量到"的读数判成通过（v0.4.6 首轮就是这么自己骗自己的）。 */
    const inside = (box, kids) => !!box && box.w > 0 && kids.length === 3 &&
      kids.every((k) => k.w > 0 && k.l >= box.l - 1 && k.r <= box.r + 1);
    const widthsOk = kFS.length === 3 && near(kFS[0].w, 22, 1) && near(kFS[1].w, 42, 1) && near(kFS[2].w, 22, 1) &&
      kRH.length === 3 && near(kRH[0].w, 22, 1) && near(kRH[1].w, 42, 1) && near(kRH[2].w, 22, 1);
    const kidsOk = inside(boxFS, kFS) && inside(boxRH, kRH);
    const cptOk = pads.every((p) => p && near(p.w, 64, 1));
    let noOverlap = true;
    for (let i = 1; i < pads.length; i++) {
      if (!pads[i] || !pads[i - 1] || pads[i].l < pads[i - 1].r) noOverlap = false;
    }
    const inPane = !!(pads[3] && root && pads[3].r <= root.r);
    const judge = !!(open1 && open2 && root && wideOk && widthsOk && kidsOk && cptOk && noOverlap && inPane);

    rec(
      S44,
      judge,
      "字号步进器=" + (boxFS ? boxFS.w + "×" + boxFS.h : "缺") + "（须宽 88）" +
      "　行高=" + (boxRH ? boxRH.w + "×" + boxRH.h : "缺") + "（须宽 88）" +
      "　子格宽度=[" + kFS.map((k) => k.w).join(",") + "]（须 22,42,22）" +
      "　子元素都在盒内=" + kidsOk +
      "　内边距 4 个宽=[" + pads.map((p) => (p ? p.w : "缺")).join(",") + "]（须 64）" +
      "　不重叠=" + noOverlap +
      "　最后一个右边界 " + (pads[3] ? pads[3].r : "?") + " ≤ 面板右 " + (root ? root.r : "?") + " = " + inPane +
      "　折叠块：" + JSON.stringify(gcls) + "　同 id 面板数=" + dupRoots +
      "　⇒ " + (judge
        ? "步进器的边框盒把 `− 值 +` 完整包住，4 个并排的也不打架 —— 「灰字压数字」这一类问题被**量**住了"
        : "⚠️ 有项没成立 —— 边框盒宽度写死失效（UXP 又换了算法？）或 4 个并排放不下")
    );
  } catch (e) {
    rec(S44, false, "抛异常：" + ((e && e.message) || e));
  }


  /* ---------- 收尾：写报告 ---------- */
  const passCount = results.filter((r) => r.ok).length;
  const summary = passCount + "/" + results.length;
  const report = {
    plugin: "com.vellum.toolbox",
    version: "0.5.0",
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
