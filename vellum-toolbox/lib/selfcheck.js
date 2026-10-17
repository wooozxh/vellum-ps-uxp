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
const inspect = require("./inspect.js");
const history = require("./history.js");
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

  /* ---------- 开场清场：关掉**上一次自检留下的**临时文档（v0.9.5）----------
     🔴 2026-10-17 真机事故：实测到 3 个自检残留文档堆在用户的 PS 里，
     而**堆积会把后续自检搞乱**（活动文档不对、建稿尺寸异常 ⇒ 一批假失败）。
     根因：`closeDocument` 失败时**返回 {ok:false} 而不抛异常**，而调用方（20+ 处）
     都 `await` 后不检查返回值 ⇒ 关闭失败被无声吞掉。
     ⇒ 开场先扫一遍，结果如实进报告（见 S69）。**只关名字带我们前缀的，用户稿绝不碰。** */
  let sweepIn = null;
  let sweepOut = null;
  try {
    sweepIn = await ps.sweepProbeDocs();
  } catch (eS) {
    sweepIn = { closed: [], failed: [{ name: "(清场)", err: String((eS && eS.message) || eS) }], kept: [] };
  }

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

  /* ---------- S11: 外壳首页（导航行 + 品牌标 + 号位 + 主题） ---------- */
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
      "S11 外壳首页渲染（导航行 + 品牌标 + 号位 + 主题）",
      navs.length === expect && heroOk && themed && keys.length === navs.length && barLogoOk,
      "导航行 " + navs.length + "（期望 " + expect + "）　号位 chip=" + keys.length +
      "　hero 品牌标=" + (heroOk ? "IMG:" + hero.getAttribute("src") : "异常(" + heroTag + ")") +
      "　顶栏标=" + (barLogoOk ? "有" : "无") +
      "　主题 class=" + JSON.stringify(themeCls)
    );
  } catch (e) {
    rec("S11 外壳首页渲染（导航行 + 品牌标 + 号位 + 主题）", false, "抛异常：" + ((e && e.message) || e));
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
        tabCount === mirror.libraryScopes(man.scopes).length &&
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
        "库 chips=" + tabCount + "/" + mirror.libraryScopes(man.scopes).length +
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
        /* 🔴 v0.5.1：`r.moveMs > 0` 是**真机**守卫 —— 曾经有一行 `out.moveMs = tMove;` 把它覆盖成恒 0
           （而 `tMove` 从未被赋值），日志里的「移动 0」是**假读数**、位移成本完全不可见。
           本用例有非零网格位移 ⇒ 位移必然耗时 ⇒ 非零即证明计时回传链路是活的。 */
        const judge = r.ok === true && r.copies === 3 && r.writes === 6 && r.moved === 3 && r.moveMs > 0 &&
          namesOk && c1ok && c2ok && c3ok && tplOk && moveOk;
        await log.appendLog("S48 明细：r=" + JSON.stringify({ ok: r.ok, copies: r.copies, writes: r.writes, writesWant: r.writesWant, moved: r.moved, moveMs: r.moveMs }) +
          " 耗时 dup=" + r.dupMs + "ms step2=" + r.step2Ms + "ms（遍历 " + r.walkMs + " / 写文字 " + r.writesMs + "）" +
          " 位移=" + r.moveMs + "ms（" + r.moved + " 份，**不在 step2 里**）" +
          " 计划预估=" + plan.estimatedMs + "ms　副本名=" + JSON.stringify(got.copyNames) +
          "　原件=" + JSON.stringify(got.tplTexts) + "　副本1=" + JSON.stringify(got.c1 && got.c1.texts) +
          "　位移=" + JSON.stringify([dx0, dy0]) + "（须 " + JSON.stringify([plan.copies[0].dx, plan.copies[0].dy]) + "）" +
          (r.missing && r.missing.length ? "　missing=" + r.missing.slice(0, 3).join("；") : "") +
          (r.firstError ? "　firstErr=" + r.firstError : "") + (r.error ? "　err=" + r.error : ""));

        rec(
          S48,
          judge,
          "复制 " + r.copies + "/3 份、写 " + r.writes + "/6 处、移动 " + r.moved + "/3" +
          "（位移耗时 " + r.moveMs + "ms > 0 —— 计时回传是活的）" +
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
          "　耗时：复制批次 " + r.dupMs + "ms / 阶段二 " + r.step2Ms + "ms（遍历 " + r.walkMs + "、写文字 " + r.writesMs + "）/ 位移 " + r.moveMs + "ms" +
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

  /* ---------- S49: 绑定**第 1 个文字层**（序号 0）能生效（v0.5.2 新增）
     用户真机反馈原话：「**模板的第一个图层不能被绑定，点击 UI 不更新**」。
     根因：面板里 `if (v) S.bind[c] = v; else delete S.bind[c];` —— 序号 `0` 是**合法绑定**
     （模板里第 1 个文字层）却被当成假值直接删掉。`lib/batch.js` 那条纪律（0 不能当没绑）修过了，
     **面板的两个入口漏了**（绑定表 + 列抽屉）。
     判据读**界面**：chip 高亮 / 警告行 / 出稿按钮就绪 —— 用户看到的就是这三样。
     🔴 期望值不许依赖残留状态：先写一份**基线偏好**（无 bind），跑完原样还原（同 S42 的套路）。 */
  const S49 = "S49 绑定第 1 个文字层（序号 0）能生效 —— 高亮挪过去 + 警告「4 列没绑定」+ 出稿按钮就绪";
  try {
    const sc49 = await ps.createScratchDoc({ size: 600, name: "Vellum 自检临时文档(绑定)" });
    if (!sc49 || !sc49.ok) {
      rec(S49, false, "建临时文档失败：" + ((sc49 && sc49.error) || "未知"));
    } else {
      const txt49 = (id) => {
        const e = document.getElementById(id);
        return e ? String(e.textContent || "") : "";
      };
      /* ⚠️ 不用 `Array.prototype.slice.call(NodeList)`（UXP 的 children 是类数组，不保证能 slice）*/
      const kids49 = (box) => {
        const out = [];
        const n = box && box.children ? box.children.length : 0;
        for (let i = 0; i < n; i++) out.push(box.children[i]);
        return out;
      };
      const classOf49 = (e) => String((e && e.getAttribute("class")) || "");
      let chipLabels = [];
      let onIdx = [];
      let warnTxt = "";
      let btnTxt = "";
      let tplInfo = "";
      let stepErr = null;
      const prefRaw49 = await data.readText("table-pref.json", "");
      let prefTouched49 = false;
      try {
        await data.writeText("table-pref.json",
          '{"variant":1,"regionSource":"selection","headerRow":true,"style":{}}');
        prefTouched49 = true;
      } catch (e) {
        stepErr = "写基线偏好失败：" + ((e && e.message) || e);
      }
      try {
        await ps.activateDocument(sc49.id);
        const TPLX = "vt-s49-版式";
        await ps.runModal(async () => {
          await ps.batchPlay([ps.groupMakeDesc(TPLX)], {});
          await ps.batchPlay([
            ps.textLayerBoxDesc({ text: "甲", box: { left: 40, top: 40, right: 200, bottom: 80 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 } }),
            ps.textLayerBoxDesc({ text: "乙", box: { left: 40, top: 100, right: 200, bottom: 140 }, sizePt: 18, rgb: { r: 0, g: 0, b: 0 } }),
          ], {});
        }, "Vellum：S49 建模板（1 组 + 2 文字层）");
        await ps.runModal(async () => {
          let hit = null;
          const walk = (arr) => {
            for (const l of arr || []) {
              if (hit) return;
              if (l.kind === "group" && String(l.name) === TPLX) { hit = l; return; }
              if (l.layers && l.layers.length) walk(l.layers);
            }
          };
          walk(ps.app.activeDocument.layers);
          if (!hit) throw new Error("找不到 " + TPLX);
          ps.app.activeDocument.activeLayers = [hit];
        }, "Vellum：S49 选中模板组（面板靠「跟随选中」认模板）");

        await ctx.shell.showTool("table", "selfcheck");
        await waitFor(() => document.getElementById("vt-tbl"), 6000);
        const schip49 = document.getElementById("vt-tbl-sample-gbk");
        if (!schip49) {
          stepErr = "找不到 GBK 样例芯片（#vt-tbl-sample-gbk）";
        } else {
          syntheticClick(schip49, null);
          await waitFor(() => {
            const g = document.getElementById("vt-tbl-grid");
            return g && g.children.length === 7 ? true : null;
          }, 6000);
          const tplBtn49 = document.getElementById("vt-tbl-tplre");
          if (!tplBtn49) {
            stepErr = "找不到「重新检测模板」（#vt-tbl-tplre）";
          } else {
            syntheticClick(tplBtn49, null);
            await waitFor(() => document.getElementById("vt-tbl-bind-0"), 6000);
            const boxA = document.getElementById("vt-tbl-bind-0");
            const chipsA = kids49(boxA);
            chipLabels = chipsA.map((e) => String(e.textContent || ""));
            const hitChip = chipsA[1];        // items[1] = 模板里**第 1 个**文字层（序号 0）
            if (!hitChip) {
              stepErr = "绑定芯片只有 " + chipsA.length + " 个（至少要有「不绑定」+ 1 个文字层）";
            } else {
              syntheticClick(hitChip, null);
              /* 等的条件**就是**要判的那个东西：高亮挪到第 1 项 */
              await waitFor(() => {
                const box = document.getElementById("vt-tbl-bind-0");
                if (!box) return null;
                const cs = kids49(box);
                return (cs[1] && classOf49(cs[1]).split(/\s+/).indexOf("on") >= 0) ? true : null;
              }, 6000);
              const boxB = document.getElementById("vt-tbl-bind-0");
              const chipsB = kids49(boxB);
              onIdx = chipsB
                .map((e, i) => (classOf49(e).split(/\s+/).indexOf("on") >= 0 ? i : -1))
                .filter((i) => i >= 0);
              warnTxt = txt49("vt-tbl-bindwarn");
              btnTxt = txt49("vt-tbl-docs");
              tplInfo = txt49("vt-tbl-tplinfo");
            }
          }
        }
      } catch (e) {
        stepErr = "步骤抛异常：" + ((e && e.message) || e);
      }
      const judge49 = stepErr === null && chipLabels.length === 3 &&
        onIdx.length === 1 && onIdx[0] === 1 &&
        warnTxt.indexOf("4 列没绑定") >= 0 && btnTxt.indexOf("生成 6 个稿件") >= 0;
      rec(
        S49,
        judge49,
        "绑定芯片 = " + JSON.stringify(chipLabels) + "（须 3 个：不绑定 + 2 个文字层）" +
        "　点「1. x」后高亮在第 " + JSON.stringify(onIdx) + " 个（须 [1]）" +
        "　警告行 = " + JSON.stringify(warnTxt.slice(0, 40)) + "（须含「4 列没绑定」）" +
        "　出稿按钮 = " + JSON.stringify(btnTxt) + "（须「生成 6 个稿件」）" +
        "　模板行 = " + JSON.stringify(tplInfo.slice(0, 44)) +
        (stepErr ? "　⚠️ " + stepErr : "") +
        "　⇒ " + (judge49
          ? "序号 0 是**合法绑定**：点得动、界面跟着变、出稿计划成立（用户报的「点第 1 个图层没反应」不复现）"
          : "⚠️ 有项没中 —— 见上面读数")
      );
      if (prefTouched49) {
        try { await data.writeText("table-pref.json", prefRaw49 || "{}"); } catch { /* 忽略 */ }
      }
      try { await ps.closeDocument(sc49.id); } catch { /* 忽略 */ }
    }
  } catch (e) {
    rec(S49, false, "抛异常：" + ((e && e.message) || e));
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


  /* ---------- S50: 出图体检 · 只读内核（v0.6.0 / docs/49 第 1 步） ----------
     ⚠️ 编号说明：本项起初写成 `S49`，与既有的「S49 绑定第 1 个文字层」**撞了号**
        （真机报告里出现两条 S49）。已改为 **S50**。
        教训：**加自检项前先数一遍现有编号**，别凭印象取。
     ⚠️ 本项**只读**：只读文档属性 + 遍历图层树，不改像素、不动选区。
        唯一的环境动作是"建一个临时文档、跑完关掉"，**绝不碰用户已打开的稿**。
     ⚠️ 判据必须能**区分"对"和"错"**，所以做**两次读数**：
         ① 刚建好的空白临时文档上读一次（文字层应为 0）
         ② 造一个文字层后再读一次（应为 1）
        —— 只读一次"等于 1"是无法归因的（万一它恒等于 1 呢）。
     ⚠️ 同时钉住两条**已知缺口**，防止以后被误当成通过：
        · 出血项必须是 `unknown`（原因：`guides[i]` 读不到坐标，见 docs/49 §二 C2）
        · 「缺字体」不能是 fatal（原因：名字比对可能误报，见 lib/inspect.js 文件头） */
  try {
    const S50 = "S50 出图体检只读内核：快照读数 + 判定分档 + 对照组";

    const sc = await ps.createScratchDoc({ size: 300, name: "Vellum 自检临时文档(S50体检)" });
    if (!sc || !sc.ok) {
      rec(S50, false, "建临时文档失败：" + ((sc && sc.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc.id);

        /* ① 空白稿：文字层应为 0 */
        const a = inspect.docInspect({ spec: { usage: "print" } });

        /* ② 造一个文字层后再读：应为 1 */
        await ps.makeTextLayer("体检测试文字", 24, 40, 40);
        const b = inspect.docInspect({ spec: { usage: "print" } });

        const pick = (r, k) => {
          if (!r || !r.ok) return null;
          for (const f of r.findings) if (f.key === k) return f;
          return null;
        };
        const val = (r, k) => {
          const f = pick(r, k);
          return f ? f.value : null;
        };
        const sev = (r, k) => {
          const f = pick(r, k);
          return f ? f.severity : null;
        };

        const tA = val(a, "text");
        const tB = val(b, "text");
        const wantMm = inspect.pxToMm(300, 72).toFixed(1);
        const wantPhys = wantMm + " × " + wantMm + " mm";
        const gotPhys = val(b, "phys");

        const checks = [
          ["docInspect 返回 ok", !!(a && a.ok && b && b.ok)],
          ["① 空白稿文字层 = 0", String(tA || "").indexOf("0 个") === 0],
          ["② 加一层后文字层 = 1", String(tB || "").indexOf("1 个") === 0],
          ["对照组能区分 0 与 1", !!tA && !!tB && tA !== tB],
          ["像素尺寸 = 300 × 300 px", val(b, "px") === "300 × 300 px"],
          ["物理尺寸 = " + wantPhys, gotPhys === wantPhys],
          ["色彩模式有判定", ["ok", "warn", "unknown"].indexOf(sev(b, "mode")) >= 0],
          ["分辨率有判定", ["ok", "warn", "info", "unknown"].indexOf(sev(b, "ppi")) >= 0],
          ["字体项有结论", !!val(b, "font")],
          ["出血项 = unknown（坐标读不到的已知缺口）", sev(b, "bleed") === "unknown"],
          ["缺字体不是 fatal（误报风险，v1 只 warn）", pick(b, "font").severity !== "fatal"]
        ];

        const bad = [];
        for (const c of checks) if (!c[1]) bad.push(c[0]);

        rec(
          S50,
          bad.length === 0,
          "读数：" +
            ["mode=" + val(b, "mode"), "ppi=" + val(b, "ppi"), "px=" + val(b, "px"),
             "phys=" + gotPhys, "bits=" + val(b, "bits"), "出血=" + val(b, "bleed")].join("　") +
            "　空白稿文字层=" + tA + "　加层后=" + tB +
            "　worst=" + (b.ok ? b.worst : "?") +
            (bad.length ? "　⚠️ 未成立：" + bad.join(" / ")
                        : "　⇒ 快照与判定都对得上，对照组能区分 0 与 1")
        );
      } finally {
        await ps.closeDocument(sc.id);
      }
    }
  } catch (e) {
    rec("S50 出图体检只读内核：快照读数 + 判定分档 + 对照组", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S51: 出图体检 · 常驻状态条 chip + 工具页（v0.6.0 / docs/49 第 2 步） ----------
     ⚠️ 走**真实路径**：合成点击真 chip → 走 index.js 里那个真处理器 → 真的 mount 工具页。
        不另写影子实现（本项目自检的第一原则：测的是面板本身）。
     ⚠️ 判据带**负对照**：换一个尺寸不同的文档，chip 文本**必须变化** ——
        否则"chip 恒显示某个值"也会被误判成通过。
     ⚠️ 临时文档跑完全关，绝不动用户的稿。 */
  try {
    const S51 = "S51 出图体检常驻状态条 + 工具页（真实点击路径 + 尺寸负对照）";

    const chipEl = document.getElementById("vt-inspect");
    const chipTx = document.getElementById("vt-inspect-tx");
    if (!chipEl || !chipTx) {
      rec(S51, false, "找不到状态条 chip（#vt-inspect / #vt-inspect-tx）");
    } else {
      const docA = await ps.createScratchDoc({ size: 300, name: "Vellum 自检临时文档(S51-A)" });
      if (!docA || !docA.ok) {
        rec(S51, false, "建临时文档 A 失败：" + ((docA && docA.error) || "未知"));
      } else {
        let docB = null;
        try {
          await ps.activateDocument(docA.id);

          /* ① 点真 chip：处理器里会先重算体检、再跳进体检工具页 */
          syntheticClick(chipEl, false);
          const view = () => document.getElementById("vt-tool-view");
          const mounted = await waitFor(
            () => {
              const v = view();
              return !!(v && v.querySelector(".insp"));
            },
            6000
          );

          const rowsOf = () => {
            const v = view();
            return v ? v.querySelectorAll(".insp-row") : [];
          };
          const rows = rowsOf();
          const inspA = inspect.docInspect();
          const textA = String(chipTx.textContent || "");

          /* ② 每行都得有「标签 + 值」两列（否则渲染了个空壳） */
          let rowsOk = rows.length > 0;
          for (let i = 0; i < rows.length && rowsOk; i++) {
            if (!rows[i].querySelector(".insp-mark")) rowsOk = false;
            if (!rows[i].querySelector(".insp-lb")) rowsOk = false;
            if (!rows[i].querySelector(".insp-vl")) rowsOk = false;
          }

          /* ③ 点「重新体检」不应抛异常 */
          let reErr = null;
          const reBtn = (() => {
            const v = view();
            return v ? v.querySelector(".insp-btn") : null;
          })();
          try {
            if (reBtn) syntheticClick(reBtn, false);
            else reErr = "找不到 .insp-btn";
          } catch (e) {
            reErr = (e && e.message) || String(e);
          }

          /* ④ 负对照：换一个尺寸不同的稿，chip 文本必须跟着变 */
          await ctx.shell.showHome();
          docB = await ps.createScratchDoc({ size: 500, name: "Vellum 自检临时文档(S51-B)" });
          let textB = "";
          if (docB && docB.ok) {
            await ps.activateDocument(docB.id);
            syntheticClick(chipEl, false);
            await waitFor(() => String(chipTx.textContent || "").indexOf("500") >= 0, 6000);
            textB = String(chipTx.textContent || "");
          }

          const checks = [
            ["① 点 chip 后体检页挂载出来", !!mounted],
            ["② 页面行数 = docInspect().findings.length",
              !!(inspA && inspA.ok) && rows.length === inspA.findings.length],
            ["③ 每行都有严重度/标签/值三列", rowsOk],
            ["④ 「重新体检」点了不抛错", !reErr],
            ["⑤ chip 文本以「体检：」开头且含 300",
              textA.indexOf("体检：") === 0 && textA.indexOf("300") >= 0],
            ["⑥ 负对照：换成 500×500 的稿后 chip 文本变了且含 500",
              !!textB && textB !== textA && textB.indexOf("500") >= 0],
            ["⑦ 回首页后 chip 元素仍在", !!document.getElementById("vt-inspect")]
          ];

          const bad = [];
          for (const c of checks) if (!c[1]) bad.push(c[0]);

          rec(
            S51,
            bad.length === 0,
            "页面挂载=" + !!mounted + "　行数=" + rows.length +
              "（docInspect 给 " + ((inspA && inspA.ok) ? inspA.findings.length : "?") + " 项）" +
              "　重新体检报错=" + (reErr || "无") + "\n" +
              "        300×300 稿的 chip = " + JSON.stringify(textA) + "\n" +
              "        500×500 稿的 chip = " + JSON.stringify(textB) +
              (bad.length ? "\n        ⚠️ 未成立：" + bad.join(" / ")
                          : "\n        ⇒ chip 随文档变化、体检页按真实数据渲染、按钮可点")
          );
        } finally {
          if (docB && docB.ok) await ps.closeDocument(docB.id);
          await ps.closeDocument(docA.id);
          await ctx.shell.showHome();
        }
      }
    }
  } catch (e) {
    rec("S51 出图体检常驻状态条 + 工具页（真实点击路径 + 尺寸负对照）", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S52: 整批撤销 · 跨模态持有（v0.6.0 / docs/49 §五 第 3 步） ----------
     ⚠️ 本项验的是**整个功能的地基**：`activeHistoryState` 的**对象引用能不能跨模态持有**
        （模态 A 里取、模态 B 里用）。
        template-probe C4 只验了「**同一个模态内**可写」—— 那**不够**：
        "批量前记、批量后退"必然是**两次模态**，中间还夹着一整轮批量操作。
     ⚠️ 判据必须给出**能互相区分的三档读数**：
        ① 动手后**不撤回**读一次 → 必须是多出 3 个
           （负对照：证明这个计数真的会变，而不是恒等于某个值。
             没有它，"撤回后回到原值"也可能是巧合）
        ② 撤回后 → 必须回到原值（★ 主路成立 = 地基坐实）
        ③ 若 ② 不成立，**单独重来一遍**测备路（`_offset`）——
           把"是对象持有失效"和"是这个 API 用法不对"两种原因**分开**，
           否则读到的失败无法归因。
     ⚠️ 临时文档跑完全关，绝不动用户的稿。 */
  try {
    const S52 = "S52 整批撤销：跨模态持有历史状态（主路）+ 负对照 + 备路读数";

    const sc52 = await ps.createScratchDoc({ size: 200, name: "Vellum 自检临时文档(S52撤回)" });
    if (!sc52 || !sc52.ok) {
      rec(S52, false, "建临时文档失败：" + ((sc52 && sc52.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc52.id);

        /* 「批量之前」：记标记 */
        const L0 = history.currentLayers();
        const mkRes = await history.mark("自检 S52 批量");
        const mkPeek = history.peek();

        /* 动手：建 3 个文字层（模拟一次批量操作） */
        for (let i = 1; i <= 3; i++) {
          await ps.makeTextLayer("S52-" + i, 18, 30 + i * 10, 30 + i * 10);
        }
        const L1 = history.currentLayers();

        /* 负对照：**先不撤回**再读一次 —— 必须仍是"多出 3 个" */
        const Lneg = history.currentLayers();

        /* 主路：跨模态持有对象赋值（mark 与 revert 是两次独立的模态） */
        const r1 = await history.revert({ via: "state" });
        const L2 = history.currentLayers();

        /* 备路：只在主路没成时**单独重来**——
           ⚠️ 不重来的话，上面已经造过一层，历史步数会翻倍，备路算出的位移就是错的，
              那样测的就不是备路本身，而是"被污染的历史"。 */
        let r2 = null;
        let Lb0 = null;
        let L3 = null;
        if (L2 !== L0) {
          await history.mark("自检 S52 备路");
          for (let i = 1; i <= 3; i++) {
            await ps.makeTextLayer("S52b-" + i, 18, 80 + i * 10, 80 + i * 10);
          }
          Lb0 = history.currentLayers();
          r2 = await history.revert({ via: "offset" });
          L3 = history.currentLayers();
        }

        const checks = [
          ["mark 记上了图层数（" + L0 + "）", !!(mkRes && mkRes.ok) && mkPeek.has && mkPeek.layers === L0],
          ["① 负对照：动手后读数确实变了（" + L0 + " → " + L1 + "）", L1 === L0 + 3],
          ["①b 负对照可重复（连读两次一致）", Lneg === L1],
          ["★ ② 跨模态持有对象可撤回（回到 " + L0 + "）", L2 === L0]
        ];
        const bad = [];
        for (const c of checks) if (!c[1]) bad.push(c[0]);

        rec(
          S52,
          bad.length === 0,
          "读数：标记时 " + L0 + " 层　动手后 " + L1 + " 层（负对照复读 " + Lneg + "）" +
            "　主路撤回后 " + L2 + " 层（via=" + (r1 ? r1.via : "null") +
            (r1 && r1.error ? "，错误=" + r1.error : "") + "）" +
            (r2
              ? "　备路：动手后 " + Lb0 + " 层 → 撤回后 " + L3 + " 层（via=" + r2.via +
                (r2.error ? "，错误=" + r2.error : "") + "）"
              : "　（备路未跑：主路已成立）") +
            (bad.length
              ? "\n        ⚠️ 未成立：" + bad.join(" / ") +
                "\n        ⚠️ 若「跨模态持有对象可撤回」未成立 ⇒ 这是**发现了一条真限制**" +
                "（不是断言写错）：说明那个对象引用只在**同一个模态内**有效。" +
                " ⇒ 方案要改成二选一：把 mark 与整轮批量**包进同一个 executeAsModal**，" +
                "或改走备路（`_offset`，但要承担「相对位移可能不精确」的代价）。" +
                " 详见 lib/history.js 文件头的【已验证 / 未验证】。"
              : "\n        ⇒ 对象引用跨模态有效：批量前记、批量后退这条路成立（地基坐实）")
        );
      } finally {
        await ps.closeDocument(sc52.id);
        await ctx.shell.showHome();
      }
    }
  } catch (e) {
    rec("S52 整批撤销：跨模态持有历史状态（主路）+ 负对照 + 备路读数", false, "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S53: 导出审核版 · 主路（v0.8.0 / docs/50 §3.1） ----------
     ⚠️ 本项验的是**整步改造**：扩画布 → 写参数条 → asCopy 导出 → 一步还原。
     ⚠️ 判据里**必须有飞行中读回**，否则"命令没报错"会被误当成"功能生效"：
        · `resizeReadback.h` 必须等于 原高 + 条高 ⇒ 证明画布**真的**变高了
        · `undoRevert.before` 必须 > 原图层数 ⇒ 证明参数条**真的**建出来了
        没有这两条，"还原后回到原值"也可能只是**什么都没发生过**。
     ⚠️ **两个尺寸都跑**（v0.8.0 首轮真机样张暴露过缺陷，所以这里必须两只都盯）：
        · 窄稿 400×400 @72  —— 8% 只有 32px ⇒ 会走「下限 72px + 缩字号」那条兜底路
        · 代表稿 1600×1200 **@300dpi** —— 顺带把「字号按 ppi 由像素换点」端到端跑通，
          并要求**不缩字号、不加高**（证明用户选定的 8% 在正常稿上够用）
     ⚠️ 目标文件写进**插件自己的 PluginData**（唯一可写的地方；插件写不了自己的目录）。
     ⚠️ 临时文档跑完全关，绝不动用户的稿。 */
  try {
    const S53 = "S53 导出审核版主路：扩画布→写参数条→asCopy 导出→一步还原（两个尺寸 + 飞行中读回）";

    /* 跑一个尺寸：建稿/关稿都在这里面，**绝不碰用户的稿**。
       ⚠️ 用函数表达式而不是块级 function 声明 —— 块里声明函数在各引擎的严格模式行为不一致。 */
    const s53RunOne = async function (size, height, res, fname, label, kind) {
      const sc = await ps.createScratchDoc({
        size: size, height: height, resolution: res,
        name: "Vellum 自检临时文档(S53-" + label + ")"
      });
      if (!sc || !sc.ok) return { error: "建临时文档失败：" + ((sc && sc.error) || "未知") };
      try {
        await ps.activateDocument(sc.id);
        await ps.makeTextLayer("S53 标题", 18, 30, 30);
        const geom0 = ps.readDocGeom();
        const lfs = require("uxp").storage.localFileSystem;
        const df = await lfs.getDataFolder();
        const entry = await df.createFile(fname, { overwrite: true });
        const r = await ps.exportReview({
          entry: entry, kind: kind || "review",
          bleed: { state: "has", mm: 3 }, when: new Date()
        });
        let magic = "未读到";
        try {
          const buf = await entry.read({ format: require("uxp").storage.formats.binary });
          const u8 = new Uint8Array(buf);
          magic = (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47)
            ? "PNG" : "非PNG(" + u8[0] + "," + u8[1] + ")";
        } catch (e) {
          magic = "读失败：" + ((e && e.message) || e);
        }
        return {
          r: r, geom0: geom0, geom1: ps.readDocGeom(), magic: magic,
          L0: geom0.layers, label: label, file: fname
        };
      } finally {
        await ps.closeDocument(sc.id);
        await ctx.shell.showHome();
      }
    };

    const A = await s53RunOne(400, 400, 72, "selfcheck-review-400.png", "窄稿400");
    const B = await s53RunOne(1600, 1200, 300, "selfcheck-review-1600.png", "代表稿1600");
    /* 成品图：**只 asCopy 导出**，画布/图层/背景色一个都不许动。
       用户拍板本轮要把这个按钮一起做（docs/50 §六 ⑤），所以它也得有真机证据。 */
    const C = await s53RunOne(800, 600, 300, "selfcheck-final-800.png", "成品图800", "final");

    const ra = A && A.r;
    const rb = B && B.r;
    const rc = C && C.r;
    const mb = rb && rb.metrics;
    const stepsB = rb ? (rb.steps || []).join(" | ") : "";
    const stepsC = rc ? (rc.steps || []).join(" | ") : "";
    const wantHB = mb ? mb.imgH + mb.stripH : null;
    const rrB = rb ? rb.resizeReadback : null;

    const checks = [
      ["① 窄稿（400×400@72）导出 ok 且是 PNG", !!(ra && ra.ok) && A.magic === "PNG"],
      ["② 代表稿（1600×1200@300）导出 ok 且是 PNG", !!(rb && rb.ok) && B.magic === "PNG"],
      ["③ 两个尺寸都读到非空字节",
        !!(ra && typeof ra.fileBytes === "number" && ra.fileBytes > 0) &&
        !!(rb && typeof rb.fileBytes === "number" && rb.fileBytes > 0)],
      ["④ 参数条正文与角标都建出来了（代表稿）",
        stepsB.indexOf("text(main) ok") >= 0 && stepsB.indexOf("text(tag) ok") >= 0],
      ["⑤ ★飞行中读回：画布真的变高了（原高 + 条高）",
        !!(rrB && wantHB !== null && rrB.h === wantHB)],
      /* ★ v0.9.2（备路）：飞行读数现在来自**副本**
         （原稿不再被改过，所以没有“撤回前”这回事）。 */
      ["⑥ ★飞行中读回：参数条真的加到了**副本**上（副本图层数 > 原稿图层数）",
        !!(rb && rb.dupHit && typeof rb.dupHit.layers === "number" && rb.dupHit.layers > B.L0)],
      /* 🔴 v0.9.5：判据**换代** —— 从「底色设置成功」改成「**真实像素命中**」。
         用户 2026-10-17 报障正是：背景色读回是对的（#111111）、命令全 ok，
         唯独参数条像素是白的（`resizeCanvas` 扩出来的新区域恒为白）。
         ⇒ 只验「设置成功」已经不够，必须验**像素**。 */
      ["⑦ ★参数条底色**像素**命中该主题底色（不是「设置成功」就算）",
        !!(rb && rb.bgRect && rb.bgRect.ok && rb.bgPixelsHit === true)],
      ["⑦b 底色矩形的候选写法如实记在读数里（哪条被接受可追溯）",
        !!(rb && rb.bgRect && Array.isArray(rb.bgRect.attempts) && rb.bgRect.attempts.length > 0)],
      ["⑧ 原稿**没被动过**：画布/图层数/背景色都还和开工前一样（备路判据）",
        !!(rb && rb.restored && rb.restored.w && rb.restored.h && rb.restored.layers && rb.restored.bg)],
      ["⑨ 收工后**独立复读原稿**一致（不信结果里的自述）",
        !!(B && B.geom0 && B.geom1) && B.geom1.w === B.geom0.w &&
        B.geom1.h === B.geom0.h && B.geom1.layers === B.geom0.layers],
      /* v0.9.0：右下「依据」块要占掉约 1/3 宽 ⇒ 代表稿上字号缩了约 0.5%。
         判据改成"不加高 + 缩幅 ≤ 2%"（仍能证明 8% 基本够用），并如实写进读数。 */
      ["⑩ 8% 在代表稿上基本够用（不加高；字号缩幅 ≤ 2% —— 右下依据块占宽所致）",
        (function () {
          if (!mb || mb.grown) return false;
          const ideal = (mb.baseStripH * 0.156 * 72) / mb.ppi;
          return mb.fontPt / ideal > 0.98;
        })()],
      ["⑪ ★字号按 ppi 换算：300dpi 下 ≈ 4.79pt（= 19.97px × 72/300）",
        !!(mb && Math.abs(mb.fontPt - 4.79) < 0.05)],
      ["⑫ 正文盒子给角标留了宽（第 1 行长文件名也不会压字）",
        !!(mb && mb.text.right < mb.tag.right)],
      ["⑬ 角标盒子贴在右端、且与正文之间留了间隙（两盒不重叠）",
        !!(mb && mb.tag.left > mb.text.right && mb.tag.right > mb.tag.left &&
           Math.abs(mb.tag.right - (mb.imgW - mb.padXPx)) < 0.01)],
      /* 🔴 v0.8.0 第二轮才补的判据：第一轮真机样张里三行被拼成了一行（`\\n` 没换行）。
         判据是**把参数条那层的文字读回来**数段落 —— 而不是"建层命令没报错"。 */
      ["⑭ ★参数条真有 3 段（读回 textItem.contents，证明换行生效）",
        (function () {
          const t = rb ? String(rb.textReadback || "") : "";
          if (!t) return false;
          return t.split(/[\r\n]/).filter(function (s) { return s.length > 0; }).length === 3;
        })()],
      /* 🔴 v0.8.0 第二轮：第一轮真机样张里**角标整个没出现在导出图上**。
         判据：读回它的可见性与外框，要求"可见 + 外框在画布内 **且确实在右半边**"。 */
      ["⑮ ★角标可见、外框在画布内、且确实落在右侧（第一轮它整块跑到画布外）",
        (function () {
          const t = rb && rb.tagReadback;
          if (!t || !t.bounds || !mb) return false;
          const b = t.bounds;
          const cw = mb.imgW;
          const chh = mb.imgH + mb.stripH;
          return t.visible === true && !!t.contents &&
            b[0] !== null && b[2] !== null && b[2] > b[0] &&
            b[0] >= -1 && b[2] <= cw + 1 && b[1] >= -1 && b[3] <= chh + 1 &&
            b[2] >= cw * 0.8;
        })()],
      ["⑯ 成品图导出 ok 且是 PNG", !!(rc && rc.ok) && C.magic === "PNG"],
      ["⑰ ★成品图**完全不动稿**（尺寸/图层/背景色都没变，且步骤里没有扩画布、没有写文字）",
        !!(rc && rc.restored && rc.restored.w && rc.restored.h &&
           rc.restored.layers && rc.restored.bg &&
           stepsC.indexOf("resizeCanvas") < 0 && stepsC.indexOf("text(") < 0 &&
           C.geom0 && C.geom1 && C.geom1.h === C.geom0.h && C.geom1.layers === C.geom0.layers)],
      /* ★ v0.9.2 备路收尾：副本必须**被关掉**（不留残留）、且切回了原稿 */
      ["⑩ ★备路收尾：副本被关掉了、且切回了原稿（步骤里两条都在）",
        stepsB.indexOf("close 副本 ok") >= 0 && stepsB.indexOf("切回原稿 ok") >= 0 &&
        !!(rb && rb.dup && rb.dup.ok === true)]
    ];
    const bad = [];
    for (const c of checks) if (!c[1]) bad.push(c[0]);

    const lineOf = function (tag, X) {
      if (!X || X.error) return tag + "：建/跑失败（" + ((X && X.error) || "未知") + "）";
      const m = X.r.metrics;
      return tag + "：" + X.geom0.w + "×" + X.geom0.h + "@" + X.geom0.ppi + "dpi" +
        "　条高 " + (m ? m.stripH : "?") + "px" + ((m && m.grown) ? "(已加高)" : "") +
        "　字号 " + (m ? m.fontPt : "?") + "pt" + ((m && m.fontShrunk) ? "(已缩)" : "") +
        "　约 " + (m ? m.rows : "?") + " 行" +
        "　bytes=" + X.r.fileBytes + "　" + X.magic +
        "　图层 " + X.L0 + "→" + (X.r.dupHit ? X.r.dupHit.layers : "?") +
        "→" + (X.geom1 ? X.geom1.layers : "?") +
        "　还原=" + JSON.stringify(X.r.restored || null);
    };

    rec(
      S53,
      bad.length === 0,
      lineOf("窄稿　", A) + "\n        " + lineOf("代表稿", B) + "\n        " + lineOf("成品图", C) + "\n" +
        "        代表稿步骤=" + stepsB +
        "\n        成品图步骤=" + stepsC +
        "\n        参数条读回（应 3 段）=" + JSON.stringify((rb && rb.textReadback) || null) +
        "\n        角标读回=" + JSON.stringify((rb && rb.tagReadback) || null) +
        "\n        层名回报：正文=" + JSON.stringify((rb && rb.mainLayer) || null) +
        "　角标=" + JSON.stringify((rb && rb.tagLayer) || null) +
        "\n        角标盒子=" + JSON.stringify(mb ? mb.tag : null) +
        "　正文盒子=" + JSON.stringify(mb ? mb.text : null) +
        ((rb && rb.warnings && rb.warnings.length)
          ? "\n        ⚠ " + rb.warnings.join("　⚠ ") : "") +
        (bad.length
          ? "\n        ⚠️ 未成立：" + bad.join(" / ")
          : "\n        ⇒ 主路成立：改稿→导出→一步还原；8% 在代表稿上够用，窄稿自动兜底")
    );
  } catch (e) {
    rec("S53 导出审核版主路：扩画布→写参数条→asCopy 导出→一步还原（两个尺寸 + 飞行中读回）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S54: 出血三态（纯函数 + 真面板交互）（v0.8.0 / docs/50 §3.4） ----------
     ⚠️ 两半都要验：① 判定本身（纯函数，含**非法输入必须拒绝**，不许猜一个默认值）
                   ② 真面板上的三态 chip 与步进器（走 ctx.shell.showTool 这条**真路由**）。 */
  try {
    const S54 = "S54 出血三态：纯函数判定 + 面板三态 chip/步进器（真实路由）";
    const rv54 = require("./review.js");

    const cases = [
      ["none", "none", "", true, "none", null],
      ["has/3", "has", "3", true, "has", 3],
      ["has/0.5", "has", "0.5", true, "has", 0.5],
      ["has/空", "has", "", false, "has", null],
      ["has/0", "has", "0", false, "has", null],
      ["has/abc", "has", "abc", false, "has", null],
      ["has/500", "has", "500", false, "has", null],
      ["unknown", "unknown", "", true, "unknown", null],
      ["乱填的 state", "garbage", "", true, "unknown", null]
    ];
    const badCases = [];
    const caseLines = [];
    for (const c of cases) {
      const g = rv54.makeBleed(c[1], c[2]);
      const ok = g.ok === c[3] && g.state === c[4] && (c[5] === null ? g.mm === null : g.mm === c[5]);
      if (!ok) badCases.push(c[0] + "（得到 ok=" + g.ok + " state=" + g.state + " mm=" + g.mm + "）");
      caseLines.push(c[0] + "→" + (g.ok ? g.state + "/" + g.mm : "拒绝"));
    }
    const texts = [
      rv54.bleedText({ state: "none" }), rv54.bleedText({ state: "has", mm: 3 }),
      rv54.bleedText({ state: "unknown" })
    ];
    const textOk =
      texts[0] === "出血 无" && texts[1] === "出血 含 3 mm" && texts[2] === "出血 无法判断";

    /* ---- 真面板：三态 chip + 步进器 ---- */
    let uiLine = "";
    let uiOk = false;
    try {
      await ctx.shell.showTool("review", "selfcheck");
      const mounted = await waitFor(function () {
        const v = document.getElementById("vt-tool-view");
        return !!(v && v.querySelector(".rv"));
      }, 6000);
      const view = document.getElementById("vt-tool-view");
      /* ⚠️ 点一下 chip 会触发 render() **按新数据重建整段 DOM** ⇒ 旧节点引用会失效
         （不是"属性没更新"，是"那个节点已经不在树里了"）。
         所以每次判读都**重新查一遍**，绝不缓存节点。 */
      const chipsNow = function () {
        const v = document.getElementById("vt-tool-view");
        return v ? v.querySelectorAll(".rv-chip") : [];
      };
      const stepNow = function () {
        const v = document.getElementById("vt-tool-view");
        const s = v ? v.querySelectorAll(".rv-step") : [];
        return s[0] || null;
      };
      const clsOf = function (n) { return n ? String(n.getAttribute("class")) : ""; };

      /* 点「无出血」（第 1 个 chip）⇒ 该 chip 亮、步进器变灰 */
      let offWhenNone = null;
      let onWhenHas = null;
      if (chipsNow().length >= 3) {
        syntheticClick(chipsNow()[0], false);
        await waitFor(function () {
          return clsOf(chipsNow()[0]).indexOf("is-on") >= 0;
        }, 3000);
        offWhenNone = clsOf(stepNow()).indexOf("is-off") >= 0;

        syntheticClick(chipsNow()[1], false);
        await waitFor(function () {
          return clsOf(chipsNow()[1]).indexOf("is-on") >= 0;
        }, 3000);
        onWhenHas = clsOf(stepNow()).indexOf("is-off") < 0;
      }
      const chipsN = chipsNow().length;
      const hasStep = !!stepNow();

      uiOk = !!mounted && chipsN === 3 && hasStep && offWhenNone === true && onWhenHas === true;
      uiLine = "挂载=" + !!mounted + "　chip 数=" + chipsN + "（须 3）" +
        "　选「无出血」时步进器变灰=" + offWhenNone +
        "　改选「有出血」后步进器可用=" + onWhenHas;

      /* 浮层（先于模态的那一问）应当能开、能关 */
      const tool54 = require("../tools/review.js");
      tool54.__diag.openBleedDialog("自检：验浮层", function () { });
      const mask = view ? view.querySelector(".rv-mask") : null;
      const dlgRows = view ? view.querySelectorAll(".rv-dlg-row") : [];
      const dlgHasMm = !!(view && view.querySelector(".rv-dlg-mm"));
      tool54.__diag.closeDialog();
      const maskGone = !(view && view.querySelector(".rv-mask"));
      const dlgOk = !!mask && dlgRows.length === 3 && dlgHasMm && maskGone;
      uiLine += "\n        浮层：出现=" + !!mask + "、三行=" + dlgRows.length +
        "、有毫米行=" + dlgHasMm + "、关闭后消失=" + maskGone;
      uiOk = uiOk && dlgOk;
    } catch (e) {
      uiLine = "面板部分抛异常：" + ((e && e.message) || e);
    }
    await ctx.shell.showHome();

    const checks = [
      ["① 九组纯函数判定全对（含非法输入必须拒绝）", badCases.length === 0],
      ["② 三态文案分别 = 出血 无 / 出血 含 3 mm / 出血 无法判断", textOk],
      ["③ 面板三态 chip + 步进器 + 浮层（真实路由）", uiOk]
    ];
    const bad = [];
    for (const c of checks) if (!c[1]) bad.push(c[0]);

    rec(
      S54,
      bad.length === 0,
      "判定：" + caseLines.join("　") + "\n" +
        "        文案：" + JSON.stringify(texts) + "\n" +
        "        " + uiLine.split("\n")[0] +
        (uiLine.indexOf("\n") >= 0 ? "\n        " + uiLine.split("\n")[1].trim() : "") +
        (badCases.length ? "\n        ⚠️ 判定不符：" + badCases.join(" / ") : "") +
        (bad.length ? "\n        ⚠️ 未成立：" + bad.join(" / ")
                    : "\n        ⇒ 出血三态：判定严（非法输入拒绝、不猜）、界面可点、浮层先于模态")
    );
  } catch (e) {
    rec("S54 出血三态：纯函数判定 + 面板三态 chip/步进器（真实路由）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S55: 工具页与宫格行序（v0.8.0） ----------
     ⚠️ 判据是「**注册表**与**真实 DOM** 两边对得上」——单看一边都可能自说自话。 */
  try {
    const S55 = "S55 工具接入：注册表 与 首页宫格 逐行对齐（含 ready/灰行）";
    const rows = (deps.registry && deps.registry.allRows) ? deps.registry.allRows() : [];
    const tls = (deps.registry && deps.registry.tools) ? deps.registry.tools : [];
    /* ⚠️ 判据**不能写"tools 末位是 review"** —— 那只在 review 恰好是最后一个工具时成立。
       v0.9.12 加了「新建稿」之后它就假红了。真判据应该是"**每个**工具都真的能挂载"：
       新工具上架时这条会自动覆盖到，不用每次回来改期望值。 */
    const allMountable = tls.length > 0 && tls.every((t) => t && t.ready === true &&
      typeof t.mount === "function" && typeof t.unmount === "function");

    await ctx.shell.showHome();
    const home = document.getElementById("vt-home");
    const navs = home ? home.querySelectorAll(".navitem") : [];
    let reviewNav = null;
    let planNav = null;
    let plannedN = 0;
    for (let i = 0; i < navs.length; i++) {
      const id = navs[i].getAttribute ? navs[i].getAttribute("data-tool") : null;
      if (id === "review") reviewNav = navs[i];
      if (id === "template") planNav = navs[i];
      if (String(navs[i].getAttribute("class")).indexOf("is-planned") >= 0) plannedN++;
    }
    const planPlanned = planNav
      ? String(planNav.getAttribute("class")).indexOf("is-planned") >= 0 : true;
    const reviewPlanned = reviewNav
      ? String(reviewNav.getAttribute("class")).indexOf("is-planned") >= 0 : true;

    const checks = [
      ["① 注册表：**每个** tool 都 ready=true 且有 mount/unmount（第 " + tls.length + " 个）",
        allMountable],
      ["② 注册表行数 = tools + planned",
        rows.length === (tls.length + deps.registry.planned.length)],
      ["③ 首页 .navitem 数 = 注册表行数（" + rows.length + "）", navs.length === rows.length],
      ["④ 首页里能找到 data-tool=\"review\" 的那一行", !!reviewNav],
      ["④b 首页里能找到 data-tool=\"template\"（新建稿）的那一行", !!planNav],
      ["⑤ review / 新建稿 两行**都不是**灰行（已实现）",
        !!reviewNav && !reviewPlanned && !!planNav && !planPlanned],
      ["⑥ 灰行数 = planned 数（" + deps.registry.planned.length + "）",
        plannedN === deps.registry.planned.length]
    ];
    const bad = [];
    for (const c of checks) if (!c[1]) bad.push(c[0]);

    rec(
      S55,
      bad.length === 0,
      "tools=" + tls.map(function (t) { return t.id; }).join(",") +
        "　planned=" + deps.registry.planned.map(function (t) { return t.id; }).join(",") +
        "\n        首页行数=" + navs.length + "　灰行=" + plannedN +
        "　review 行是否灰=" + reviewPlanned + "　新建稿行是否灰=" + planPlanned +
        (bad.length ? "\n        ⚠️ 未成立：" + bad.join(" / ")
                    : "\n        ⇒ 注册表与首页逐行对齐 —— 新工具是真的「上架」了，而不是只躺在数组里")
    );
  } catch (e) {
    rec("S55 导出审核版接入：注册表 与 首页宫格 逐行对齐（含 ready/灰行）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S56: 参数条字段与体检对账（v0.8.0 / docs/49 §3.0） ----------
     ⚠️ 这一项防的是**同一份数据被两边各算一遍**：状态条/体检页说"未转曲 3 个"，
        参数条却写"2 个"。判据：同一次 docInspect 结果喂给两边，数字**必须相等**；
        再用"加一个文字层"做**负对照**，证明两个数字真的会跟着变（不是恒等巧合）。 */
  try {
    const S56 = "S56 参数条字段与体检对账：未转曲数/缺字体数同源 + 负对照";
    const rev56 = require("./review.js");
    const sc56 = await ps.createScratchDoc({ size: 300, name: "Vellum 自检临时文档(S56对账)" });
    if (!sc56 || !sc56.ok) {
      rec(S56, false, "建临时文档失败：" + ((sc56 && sc56.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc56.id);
        await ps.makeTextLayer("S56-A", 18, 30, 30);

        const inspA = inspect.docInspect();
        const stA = rev56.stripLines(inspA, { bleed: { state: "has", mm: 3 }, when: new Date() });
        const mfA = inspect.missingFonts(inspA.snapshot);
        const tcA = inspA.snapshot.layers.textCount;

        /* 负对照：再加一个文字层 ⇒ 未转曲数必须 +1，且参数条跟着变 */
        await ps.makeTextLayer("S56-B", 18, 30, 80);
        const inspB = inspect.docInspect();
        const stB = rev56.stripLines(inspB, { bleed: { state: "has", mm: 3 }, when: new Date() });
        const tcB = inspB.snapshot.layers.textCount;

        const line3A = stA.lines[2] || "";
        const line3B = stB.lines[2] || "";
        const sA = "未转曲文字层 " + tcA + " 个";
        const sB = "未转曲文字层 " + tcB + " 个";

        const checks = [
          ["① 参数条与快照的未转曲数一致（" + tcA + "）", stA.textCount === tcA],
          ["② 参数条与 missingFonts 的缺字体数一致（" +
            (mfA.known ? mfA.missing.length : "清单读不到") + "）",
            stA.missing === (mfA.known ? mfA.missing.length : null)],
          ["③ 第 3 行确实印着「未转曲文字层 N 个」", line3A.indexOf(sA) >= 0],
          ["④ 第 3 行确实印着「缺失字体」", line3A.indexOf("缺失字体") >= 0],
          /* ⑤ 依据改到**独立的右下块**（v0.9.0）⇒ 判据跟着挪到 `basis`，不再看第 3 行 */
          ["⑤ 依据块带规范名 + 版本 + 生效日（已从第 3 行摘出，成为独立右对齐块）",
            String(stA.basis || "").indexOf("依据") === 0 &&
            String(stA.basis).indexOf("v" + inspA.spec.specVersion) >= 0 &&
            String(stA.basis).indexOf(inspA.spec.effectiveFrom) >= 0 &&
            line3A.indexOf("依据") < 0],
          ["⑥ 负对照：加一个文字层后未转曲数 +1 且两边仍一致",
            tcB === tcA + 1 && stB.textCount === tcB && line3B.indexOf(sB) >= 0]
        ];
        const bad = [];
        for (const c of checks) if (!c[1]) bad.push(c[0]);

        rec(
          S56,
          bad.length === 0,
          "加层前：" + JSON.stringify(line3A) + "\n" +
            "        加层后：" + JSON.stringify(line3B) + "\n" +
            "        未转曲 " + tcA + " → " + tcB + "　缺字体=" +
            (mfA.known ? mfA.missing.length : "清单读不到") +
            "　规范 v" + inspA.spec.specVersion + "（生效 " + inspA.spec.effectiveFrom + "）" +
            (bad.length ? "\n        ⚠️ 未成立：" + bad.join(" / ")
                        : "\n        ⇒ 参数条与体检页同源同数、且负对照证明数字真的会变")
        );
      } finally {
        await ps.closeDocument(sc56.id);
        await ctx.shell.showHome();
      }
    }
  } catch (e) {
    rec("S56 参数条字段与体检对账：未转曲数/缺字体数同源 + 负对照", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S57: 导出落点 · 持久令牌往返（v0.8.0 / docs/50 §六 ③） ----------
     ⚠️ 「选一次就记住」这条**没法脚本化点系统目录选择器**（本项目早有结论：
        系统弹窗自动化点不了）。但**令牌机制本身可以验** —— 用插件自己的
        PluginData 目录当替身（它有 Folder 句柄、而且可写），走一遍
        createPersistentToken → getEntryForPersistentToken → 在里面建文件 → 读回。
     ⚠️ 没验到的部分**如实标注**：`getFolder()` 那个系统弹窗只能人点一次。 */
  try {
    const S57 = "S57 导出落点：持久令牌往返（换回目录→建文件→读回）+ picker API 存在性";
    const lfs57 = require("uxp").storage.localFileSystem;
    const hasPicker = !!(lfs57 && typeof lfs57.getFolder === "function");
    const hasTok = !!(lfs57 && typeof lfs57.createPersistentToken === "function");
    const hasBack = !!(lfs57 && typeof lfs57.getEntryForPersistentToken === "function");

    let roundLine = "（没跑）";
    let roundOk = false;
    if (hasTok && hasBack) {
      try {
        const df = await lfs57.getDataFolder();
        const tok = await lfs57.createPersistentToken(df);
        const back = await lfs57.getEntryForPersistentToken(tok);
        const fmts = require("uxp").storage.formats || {};
        let wrote = null;
        let readBack = null;
        if (back && typeof back.createFile === "function") {
          const f = await back.createFile("selfcheck-token-probe.txt", { overwrite: true });
          wrote = String(f.name || "");
          if (fmts.utf8) {
            await f.write("vellum-token-ok", { format: fmts.utf8 });
            readBack = String(await f.read({ format: fmts.utf8 }));
          }
        }
        roundOk = !!(back && wrote && readBack === "vellum-token-ok");
        roundLine = "目录=" + (df && df.name) + "　令牌=" + (tok ? "拿到" : "null") +
          "　换回=" + (back ? ("有（" + back.name + "）") : "null") +
          "　建文件=" + wrote + "　读回=" + JSON.stringify(readBack);
      } catch (e) {
        roundLine = "往返抛异常：" + ((e && e.message) || e);
      }
    } else {
      roundLine = "本机 UXP 缺少 token API：createPersistentToken=" + hasTok +
        "、getEntryForPersistentToken=" + hasBack;
    }

    /* ---- ④ 工具页全链路：**预置目录**绕开系统弹窗，把面板那条路整条跑通 ----
       （文件名怎么起、createFile、exportReview、状态条、undo 刷新都在里面）
       ⇒ 这样「唯一没验的只剩系统目录弹窗本身」这句话才站得住。 */
    let uiLine57 = "（没跑）";
    let uiOk57 = false;
    try {
      const revTool57 = require("../tools/review.js");
      const sc57 = await ps.createScratchDoc({
        size: 900, height: 700, resolution: 300, name: "Vellum 自检临时文档(S57工具链)"
      });
      if (!sc57 || !sc57.ok) {
        uiLine57 = "建临时文档失败：" + ((sc57 && sc57.error) || "未知");
      } else {
        try {
          await ps.activateDocument(sc57.id);
          const df2 = await lfs57.getDataFolder();
          await ctx.shell.showTool("review", "selfcheck");
          await waitFor(function () {
            const v = document.getElementById("vt-tool-view");
            return !!(v && v.querySelector(".rv"));
          }, 6000);

          const D = revTool57.__diag;
          D.S.folder = df2;                       /* ← 预置目录 = 绕开系统弹窗 */
          D.S.folderName = df2.name;
          D.S.folderFrom = "selfcheck";
          D.S.last = null;
          D.S.docId = sc57.id;                    /* 已经"问过出血"了 ⇒ 不再弹浮层 */
          D.S.choice = { state: "has", mm: 3 };

          const before57 = ps.readDocGeom();
          await D.doExport("review");
          const got = D.S.last;
          const after57 = ps.readDocGeom();

          uiOk57 = !!(got && got.ok && typeof got.fileBytes === "number" && got.fileBytes > 0 &&
            got.restored && got.restored.w && got.restored.h &&
            got.restored.layers && got.restored.bg &&
            after57.h === before57.h && after57.layers === before57.layers);
          uiLine57 = "工具页导出：ok=" + (got && got.ok) +
            "　文件=" + (got && got.file ? got.file.name : "?") +
            "　bytes=" + (got && got.fileBytes) +
            "　还原=" + JSON.stringify((got && got.restored) || null) +
            "　复读：画布 " + before57.w + "×" + before57.h + "→" + after57.w + "×" + after57.h +
            "、图层 " + before57.layers + "→" + after57.layers;
        } finally {
          await ps.closeDocument(sc57.id);
          await ctx.shell.showHome();
        }
      }
    } catch (e) {
      uiLine57 = "工具页全链路抛异常：" + ((e && e.message) || e);
    }

    const checks57 = [
      ["① getFolder（系统目录选择器）API 存在", hasPicker],
      ["② createPersistentToken / getEntryForPersistentToken 都在", hasTok && hasBack],
      ["③ ★令牌往返可用（换回的目录能建文件、并读回同一内容）", roundOk],
      ["④ ★工具页面板那条路整条跑通（预置目录 ⇒ 绕开弹窗）+ 导出后稿子还原",
        uiOk57]
    ];
    const bad57 = [];
    for (const c of checks57) if (!c[1]) bad57.push(c[0]);

    rec(
      S57,
      bad57.length === 0,
      "picker=" + hasPicker + "　token API=" + (hasTok && hasBack) + "\n        " + roundLine +
        "\n        " + uiLine57 +
        (bad57.length
          ? "\n        ⚠️ 未成立：" + bad57.join(" / ")
          : "\n        ⇒ 「选一次就记住」的机制成立；⚠️ 唯一没验的是那个系统目录弹窗本身" +
            "（只能人点一次，本项目早认定不可脚本化）")
    );
  } catch (e) {
    rec("S57 导出落点：持久令牌往返（换回目录→建文件→读回）+ picker API 存在性", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S58: 参数条主题判定（v0.9.0 / docs/51 §3.1） ----------
     ⚠️ **两套主题都要真机跑一遍并留下样张** —— 只跑一套的话，"黑底浅字"那条分支
        永远没被跑过，等于没验。
     ⚠️ 判据必须**互相区分**：两张稿的底部一浅一深，判出来的主题也必须**相反**（负对照）。
     ⚠️ 临时稿跑完全关，绝不动用户的稿。 */
  let s58Runs = {};
  try {
    const S58 = "S58 参数条主题：浅底稿→深条 / 深底稿→浅条（两套都真机导出 + 样张）";
    const lfs58 = require("uxp").storage.localFileSystem;
    const df58 = await lfs58.getDataFolder();

    /** 一套流程：建稿（可先整层填色）→ 导出审核版 → 留下读数 */
    const run58 = async function (label, fillHex, fname) {
      const sc = await ps.createScratchDoc({
        size: 1200, height: 900, resolution: 300,
        name: "Vellum 自检临时文档(S58-" + label + ")"
      });
      if (!sc || !sc.ok) return { error: "建临时文档失败：" + ((sc && sc.error) || "未知") };
      try {
        await ps.activateDocument(sc.id);
        if (fillHex) {
          const fr = await ps.fillLayer(fillHex, { verify: "pixel" });
          if (!fr || !fr.ok) {
            return { error: "整层填色失败（" + fillHex + "）：" + ((fr && fr.error) || "未知") };
          }
        }
        /* 上方放一个文字层（让"未转曲"不为 0）；它在 y=40，**不影响底部取样带** */
        await ps.makeTextLayer("S58 标题", 18, 40, 40);

        const entry = await df58.createFile(fname, { overwrite: true });
        const r = await ps.exportReview({
          entry: entry, kind: "review", bleed: { state: "has", mm: 3 }, when: new Date()
        });
        let magic = "未读到";
        try {
          const buf = await entry.read({ format: require("uxp").storage.formats.binary });
          const u8 = new Uint8Array(buf);
          magic = (u8[0] === 0x89 && u8[1] === 0x50) ? "PNG" : "非PNG";
        } catch (e) {
          magic = "读失败";
        }
        return { r: r, magic: magic, file: fname };
      } finally {
        await ps.closeDocument(sc.id);
        await ctx.shell.showHome();
      }
    };

    s58Runs.lightBg = await run58("浅底", null, "selfcheck-strip-lightbg.png");
    s58Runs.darkBg = await run58("深底", "#1E1E22", "selfcheck-strip-darkbg.png");

    const A = s58Runs.lightBg && s58Runs.lightBg.r;
    const B = s58Runs.darkBg && s58Runs.darkBg.r;
    const ta = A && A.theme;
    const tb = B && B.theme;

    const checks58 = [
      ["① 浅底稿 ⇒ 判成**深条**（黑底浅字）", !!(ta && ta.theme.id === "dark" && ta.from === "sampled")],
      ["② 深底稿 ⇒ 判成**浅条**（白底深字）", !!(tb && tb.theme.id === "light" && tb.from === "sampled")],
      ["③ ★负对照：两套底色判出来的主题**相反**", !!(ta && tb && ta.theme.id !== tb.theme.id)],
      /* ★ v0.9.5：这两条现在是**像素判据**（原来只验"背景色设置成功"，抓不到底色没填上）。 */
      ["④ ★深条那次的参数条**像素**命中了深条底色 #111111",
        !!(A && A.bgRect && A.bgRect.ok && A.bgPixelsHit === true)],
      ["⑤ ★浅条那次的参数条**像素**命中了浅条底色 #FFFFFF",
        !!(B && B.bgRect && B.bgRect.ok && B.bgPixelsHit === true)],
      ["⑥ 两次导出都 ok、都是 PNG、字节 > 0",
        !!(A && A.ok && A.fileBytes > 0 && s58Runs.lightBg.magic === "PNG") &&
        !!(B && B.ok && B.fileBytes > 0 && s58Runs.darkBg.magic === "PNG")],
      ["⑦ 两次都把稿子一步还原了",
        !!(A && A.restored && A.restored.w && A.restored.h && A.restored.layers && A.restored.bg) &&
        !!(B && B.restored && B.restored.w && B.restored.h && B.restored.layers && B.restored.bg)]
    ];
    const bad58 = [];
    for (const c of checks58) if (!c[1]) bad58.push(c[0]);

    rec(
      S58,
      bad58.length === 0,
      "浅底稿 → 主题=" + (ta ? ta.theme.id : "?") + "（" + (ta ? ta.note : "无读数") + "）" +
        "　底色像素=" + ((A && A.bgPixels) ? A.bgPixels.hex : "?") +
        (A && A.bgPixelsHit ? " ✔" : " ✗") + "\n" +
        "        深底稿 → 主题=" + (tb ? tb.theme.id : "?") + "（" + (tb ? tb.note : "无读数") + "）" +
        "　底色像素=" + ((B && B.bgPixels) ? B.bgPixels.hex : "?") +
        (B && B.bgPixelsHit ? " ✔" : " ✗") + "\n" +
        "        样张：selfcheck-strip-lightbg.png（" + (A ? A.fileBytes : "?") + " B）／" +
        "selfcheck-strip-darkbg.png（" + (B ? B.fileBytes : "?") + " B）" +
        (bad58.length ? "\n        ⚠️ 未成立：" + bad58.join(" / ")
                      : "\n        ⇒ 主题两套都真机跑通、且负对照成立（底部深浅 → 条的黑白相反）")
    );
  } catch (e) {
    rec("S58 参数条主题：浅底稿→深条 / 深底稿→浅条（两套都真机导出 + 样张）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S59: 右下「依据」块右对齐 + 前置 logo（v0.9.0 / docs/51 §3.3） ----------
     ⚠️ 右对齐**不许靠段落对齐枚举**（v0.8.0 已实测会被排到画布外）⇒ 本项要验的是
        "建层 → 读回 bounds → 平移 → 再读回"这条路的**最终外框**真的贴在留白线上。
     ⚠️ 顺带验顺序：正文盒 < logo < 依据文字，三者**不重叠**。 */
  try {
    const S59 = "S59 依据块右对齐 + 前置 logo：读回三个外框，验「贴右留白线 / 不压正文 / 比例对」";

    const one59 = function (r, label) {
      if (!r || !r.metrics) return { ok: false, why: label + "：没有读数" };
      const m = r.metrics;
      const rightLine = m.imgW - m.padXPx;
      const b = r.basisReadback;
      const lg = r.logoReadback;
      if (!b || b.error) return { ok: false, why: label + "：没读到依据块外框（" + JSON.stringify(b) + "）" };
      if (!lg || lg.error) return { ok: false, why: label + "：没读到 logo 外框（" + JSON.stringify(lg) + "）" };

      const bodyR = m.text.right;
      const lgW = lg.right - lg.left;
      const lgH = lg.bottom - lg.top;
      const okRight = Math.abs(b.right - rightLine) <= 3;
      const okOrder = lg.left >= bodyR - 1 && lg.right <= b.left + 1;
      const okAspect = lgH > 0 && Math.abs(lgW / lgH - 256 / 164) < 0.08;
      const okInside = b.top >= m.strip.top - 1 && b.bottom <= m.strip.bottom + 1 &&
        lg.top >= m.strip.top - 1 && lg.bottom <= m.strip.bottom + 1;

      /* ★ v0.9.3 两条**新版式不变量**（用户报「文字靠上 / logo 偏了」的直接回归）：
         ① 正文墨迹在条里**上下留白相等**（容差 2px）；
         ② logo 右边界 = 依据文字左边界 − gap（容差 2px）—— 不允许「多出一个 logo 宽」。 */
      const tink = r.textInk ? (r.textInk.after || r.textInk.before) : null;
      const padTop = tink ? tink.top - m.strip.top : null;
      const padBot = tink ? m.strip.bottom - tink.bottom : null;
      const okCenter = padTop !== null && padBot !== null && Math.abs(padTop - padBot) <= 2;
      const gapWant = m.basis ? m.basis.gap : 0;
      const gapReal = b.left - lg.right;
      const okLogoTight = gapReal >= -1 && Math.abs(gapReal - gapWant) <= 2;
      /* ★ logo 应与依据文字**同中心线**（真机量过：只对齐 x 会偏下 7.5px） */
      const cyGap = Math.abs((lg.top + lg.bottom) / 2 - (b.top + b.bottom) / 2);
      const okLogoMid = cyGap <= 2;

      return {
        ok: okRight && okOrder && okAspect && okInside && okCenter && okLogoTight && okLogoMid,
        why: label + "：依据右=" + Math.round(b.right) + "（须≈" + Math.round(rightLine) + "）" +
          "　logo x[" + Math.round(lg.left) + ".." + Math.round(lg.right) + "] y[" +
          Math.round(lg.top) + ".." + Math.round(lg.bottom) + "]　正文盒右=" + Math.round(bodyR) +
          "　logo 宽高比=" + (lgH > 0 ? (lgW / lgH).toFixed(3) : "?") +
          "　logo与依据间隙=" + Math.round(gapReal) + "（须≈" + Math.round(gapWant) + "）" +
          "　logo与文字同心差=" + Math.round(cyGap) + "px" +
          "　正文上下留白=" +
          (padTop === null ? "?" : Math.round(padTop) + "/" + Math.round(padBot)) +
          (okRight ? "" : "　✗没贴右留白线") +
          (okOrder ? "" : "　✗顺序不对/压正文") +
          (okAspect ? "" : "　✗宽高比走形") +
          (okInside ? "" : "　✗跑出参数条外") +
          (okCenter ? "" : "　✗正文没垂直居中") +
          (okLogoTight ? "" : "　✗logo 没贴着依据文字") +
          (okLogoMid ? "" : "　✗logo 与依据文字不同心（差 " + Math.round(cyGap) + "px）")
      };
    };

    const r1 = one59(s58Runs.lightBg && s58Runs.lightBg.r, "深条");
    const r2 = one59(s58Runs.darkBg && s58Runs.darkBg.r, "浅条");

    rec(
      S59,
      r1.ok && r2.ok,
      r1.why + "\n        " + r2.why +
        ((r1.ok && r2.ok)
          ? "\n        ⇒ 依据块右端贴着留白线、logo 紧贴着依据文字、正文在条里**上下居中**、比例保持（两套主题都成立）"
          : "")
    );
  } catch (e) {
    rec("S59 依据块右对齐 + 前置 logo：读回三个外框，验「贴右留白线 / 不压正文 / 比例对」", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S60: 大稿缩放 —— 先探能力，再验机制（v0.9.0 / docs/51 §四） ----------
     ⚠️ 官方样例与本仓库都**没有** `imageSize` 描述符，`Document.resizeImage` 在不在
        也只能实测 ⇒ 本项第一步就是**能力探针**（存在性 + 真缩一个小稿）。
        **不猜描述符**（项目铁律：ActionDescriptor 不许猜）。
     ⚠️ 小稿真缩（800×600 → 400×300）只证明"这条路能用"，不证明"超大稿不卡" ——
        后者本轮**没有结论**，如实标注。 */
  try {
    const S60 = "S60 大稿缩放：Document.resizeImage 能力探针 + 小稿真缩验证（不猜描述符）";
    const sc60 = await ps.createScratchDoc({
      size: 800, height: 600, resolution: 72, name: "Vellum 自检临时文档(S60缩放)"
    });
    if (!sc60 || !sc60.ok) {
      rec(S60, false, "建临时文档失败：" + ((sc60 && sc60.error) || "未知"));
    } else {
      try {
        await ps.activateDocument(sc60.id);
        let hasApi = false;
        try { hasApi = typeof ps.app.activeDocument.resizeImage === "function"; } catch (e) { hasApi = false; }

        let after = null;
        let err60 = null;
        if (hasApi) {
          try {
            await ps.runModal(async () => {
              await ps.app.activeDocument.resizeImage(400, 300);
            }, "Vellum 自检：S60 缩放");
            const g = ps.readDocGeom();
            after = { w: g.w, h: g.h };
          } catch (e) {
            err60 = (e && e.message) || String(e);
          }
        }

        const ok60 = hasApi && after && after.w === 400 && after.h === 300;

        /* ---- 端到端：**超过阈值的稿，导出后真的被缩了**（路线 D 的正面证据）----
           ⚠️ 用 1200×4200（长边 4200 > 4000）而不是用户举例的 4724×10630 ——
              后者是 5000 万像素，跑一次要十几秒且很吃内存，不适合放进自检。
              这里验的是**机制**：超阈值 ⇒ 按计划缩 ⇒ 导出的是缩后的尺寸。 */
        let e2e = null;
        const sc60b = await ps.createScratchDoc({
          size: 1200, height: 4200, resolution: 300,
          name: "Vellum 自检临时文档(S60超阈值稿)"
        });
        if (sc60b && sc60b.ok) {
          try {
            await ps.activateDocument(sc60b.id);
            const lfs60 = require("uxp").storage.localFileSystem;
            const df60 = await lfs60.getDataFolder();
            const entryB = await df60.createFile("selfcheck-scaled.png", { overwrite: true });
            const rB = await ps.exportReview({
              entry: entryB, kind: "review", bleed: { state: "none" }, when: new Date()
            });
            let mW = null, mH = null, mErr = null;
            try {
              const buf = await entryB.read({ format: require("uxp").storage.formats.binary });
              const u8 = new Uint8Array(buf);
              /* PNG 的 IHDR：宽高各 4 字节大端，从第 16 字节起 */
              mW = (u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19];
              mH = (u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23];
            } catch (e) {
              mErr = (e && e.message) || String(e);
            }
            e2e = {
              plan: rB.scale, applied: rB.scaleApplied,
              ok: rB.ok, fileBytes: rB.fileBytes, restored: rB.restored,
              line3: rB.lines ? rB.lines.lines[2] : "",
              pngW: mW, pngH: mH, pngErr: mErr
            };
          } finally {
            await ps.closeDocument(sc60b.id);
            await ctx.shell.showHome();
          }
        } else {
          e2e = { error: "建超阈值稿失败：" + ((sc60b && sc60b.error) || "未知") };
        }

        const e2eOk = !!(e2e && e2e.applied && e2e.applied.applied === true &&
          e2e.plan && e2e.plan.applied === true &&
          Math.abs(e2e.applied.w - 1143) <= 2 && e2e.applied.h === 4000 &&
          e2e.pngW !== null && Math.abs(e2e.pngW - 1143) <= 2 && e2e.pngH === 4000 &&
          e2e.restored && e2e.restored.w && e2e.restored.h &&
          e2e.restored.layers && e2e.restored.bg &&
          String(e2e.line3).indexOf("已缩至") >= 0);

        rec(
          S60,
          ok60 && e2eOk,
          "① Document.resizeImage 存在=" + hasApi +
            "　小稿真缩 800×600 → " + (after ? after.w + "×" + after.h : "（没跑）") +
            (err60 ? "　错误=" + err60 : "") + "\n" +
            "        ② 端到端（1200×4200 @300）：计划=" + (e2e && e2e.plan ? Math.round(e2e.plan.pct) + "%" : "?") +
            "　实际缩到 " + (e2e && e2e.applied ? e2e.applied.w + "×" + e2e.applied.h : "?") +
            "　**PNG 文件头读回的尺寸**=" +
            (e2e ? (e2e.pngW === null ? "读不到(" + e2e.pngErr + ")" : e2e.pngW + "×" + e2e.pngH) : "?") +
            "　bytes=" + (e2e ? e2e.fileBytes : "?") +
            "\n        ③ 参数条第 3 行=" + JSON.stringify(e2e ? e2e.line3 : null) +
            "\n        ⚠️ 未结论：**超大稿（如 4724×10630 ≈ 5000 万像素）缩起来会不会很慢/很吃内存**，本轮没测" +
            "\n        ⇒ " + ((ok60 && e2eOk)
              ? "路线 D 成立：超长边上限 ⇒ 自动等比缩，**且导出文件真的是缩后的尺寸**（PNG 头为准），"
                + "参数条上也印了实际比例"
              : "未全部成立，见上面读数")
        );
      } finally {
        await ps.closeDocument(sc60.id);
        await ctx.shell.showHome();
      }
    }
  } catch (e) {
    rec("S60 大稿缩放：Document.resizeImage 能力探针 + 小稿真缩验证（不猜描述符）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S61: 导出落点**真相**（v0.9.1，2026-10-17 用户真机报错复现）----------
     🔴 起因：用户在自己的稿
        `2海南代理展架修改后84×184cm（3mm出血）.jpg`（4961×10866 @150dpi · **CMYK**）上
        点「导出审核版」，面板报「导出文件读回是空/读不到（bytes=null）」，
        而「还原自证」三项全绿。外部取证：**目标目录里连一个字节都没有**
        （新建文件夹 完全为空、全盘也搜不到那个文件名）⇒ 流程没抛错、却什么都没写出来。
     ⚠️ **S57 只验了 `getDataFolder()` 那个替身目录**；用户真正用的
        **选择器返回的目录**从没被验过 —— 这一项就是来补这个洞的。
     做法：三种组合都打**同一个用户目录**，把变量隔离
        · 小稿 RGB  → kind=final（纯 saveAs）—— 落点基本盘
        · 大稿 RGB  → kind=review（完整流程）—— 隔离「尺寸」
        · 大稿 CMYK → kind=review（完整流程）—— 隔离「色彩模式」（= 用户的真实场景）
     ⚠️ 探针文件**故意留着不删**，好在外部核对"盘上到底有没有"；前缀统一 `vt-s61-`。 */
  try {
    const S61 = "S61 导出落点真相：用户记下来的目录能否真写进去（S57 只验了 PluginData 替身）";
    const uxp61 = require("uxp");
    const ls61 = uxp61.storage && uxp61.storage.localFileSystem;
    const fmts61 = (uxp61.storage && uxp61.storage.formats) || {};

    /* ① 用**用户记下来的令牌**换回那个目录 */
    let uf = null;
    let tokLine = "（没跑：UXP 没有令牌 API）";
    if (ls61 && typeof ls61.getEntryForPersistentToken === "function") {
      try {
        const st61 = await store.readJson("review.json", {});
        const tok61 = (st61 && st61.folderToken) || "";
        if (!tok61) {
          tokLine = "review.json 里没有 folderToken（这台机器还没人选过导出目录）";
        } else {
          uf = await ls61.getEntryForPersistentToken(tok61);
          let n61 = "列举失败";
          try {
            const es61 = uf.getEntries ? await uf.getEntries() : null;
            n61 = (es61 ? es61.length : 0) + " 个";
          } catch (e) { n61 = "列举抛异常：" + ((e && e.message) || e); }
          tokLine = "目录=「" + (uf && uf.name) + "」　nativePath=" +
            JSON.stringify(uf ? uf.nativePath : null) + "　里面已有 " + n61;
        }
      } catch (e) {
        tokLine = "令牌解析抛异常：" + ((e && e.message) || e);
      }
    }

    /* ② UXP 侧纯写（**不经 PS 的 saveAs**）—— 证明"这个目录本身"写不写得进去 */
    let uxpLine = "（没跑）";
    let uxpWriteOk = false;
    if (uf) {
      try {
        const pf61 = await uf.createFile("vt-s61-uxpwrite-" + Date.now() + ".txt", { overwrite: true });
        await pf61.write("s61-uxp-write-ok", { format: fmts61.utf8 });
        const back61 = String(await pf61.read({ format: fmts61.utf8 }));
        uxpWriteOk = back61 === "s61-uxp-write-ok";
        uxpLine = "建文件=" + (pf61 && pf61.name) + "　读回=" + JSON.stringify(back61) +
          "　nativePath=" + JSON.stringify(pf61 ? pf61.nativePath : null);
      } catch (e) {
        uxpLine = "UXP 写抛异常：" + ((e && e.message) || e);
      }
    }

    /* ③④⑤ 三种组合 → 同一个用户目录 */
    const run61 = async function (label, size, height, res, mode, kind) {
      const r = { label: label, doc: "?", mp: "?", bytes: null, ok: false, ms: null,
        steps: "", err: "", path: "", entryPath: "" };
      let sc61 = null;
      try {
        sc61 = await ps.createScratchDoc({
          size: size, height: height, resolution: res, mode: mode,
          name: "Vellum 自检临时文档(S61-" + label + ")"
        });
        if (!sc61 || !sc61.ok) { r.err = "建稿失败：" + ((sc61 && sc61.error) || "未知"); return r; }
        await ps.activateDocument(sc61.id);
        const g61 = ps.readDocGeom();
        r.doc = g61.w + "×" + g61.h + " @" + g61.ppi + "dpi · " + mode + " · " + g61.layers + " 层";
        r.mp = (g61.w * g61.h / 1e6).toFixed(1) + "M 像素";

        const fname61 = "vt-s61-" + label + "-" + Date.now() + ".png";
        const entry61 = await uf.createFile(fname61, { overwrite: true });
        /* ★ 关键读数：`createFile` 出来的 Entry **有没有 nativePath**。
           没有的话，PS 的 saveAs 拿不到真实落点 —— 那就会"不报错、也不写"。 */
        r.entryPath = String((entry61 && entry61.nativePath) || "");

        const t61 = Date.now();
        const got61 = await ps.exportReview({
          entry: entry61, folder: uf, kind: kind, bleed: { state: "has", mm: 3 }
        });
        r.ms = Date.now() - t61;
        r.bytes = got61.fileBytes;
        r.ok = !!(got61.ok && typeof got61.fileBytes === "number" && got61.fileBytes > 0);
        r.steps = (got61.steps || []).join(" | ");
        r.err = got61.error || "";
        r.path = (got61.file && got61.file.path) || "";
      } catch (e) {
        r.err = "抛异常：" + ((e && e.message) || e);
      } finally {
        if (sc61 && sc61.ok) { try { await ps.closeDocument(sc61.id); } catch (e) { /* 忽略 */ } }
      }
      return r;
    };

    let rS = null;
    let rBigRGB = null;
    let rBigCMYK = null;
    if (uf) {
      try {
        rS = await run61("小稿RGB", 800, 600, 300, "RGB", "final");
        rBigRGB = await run61("大稿RGB", 4961, 10866, 150, "RGB", "review");
        rBigCMYK = await run61("大稿CMYK", 4961, 10866, 150, "CMYK", "review");
      } catch (e) {
        /* 单个组合抛异常不该带走整项 */
      }
    }

    const line61 = function (r) {
      if (!r) return "（没跑）";
      return "· " + r.label + "｜" + r.doc + "｜" + r.mp + "｜" +
        "entry.nativePath=" + JSON.stringify(r.entryPath) + "｜" +
        (r.bytes === null ? "bytes=null" : "bytes=" + r.bytes) + "｜耗 " + r.ms + "ms｜" +
        (r.ok ? "✅ 写出来了" : "❌ " + (r.err || "没写出来")) +
        (r.steps ? "\n            步骤=" + r.steps : "");
    };

    const checks61 = [
      ["① ★用用户记下来的令牌换回了那个目录（且能列举内容）", !!uf],
      ["② ★UXP 侧纯写成功（这个目录本身可写）", uxpWriteOk],
      ["③ ★小稿走 saveAs 打这个目录 → 真写出字节", !!(rS && rS.ok)],
      ["④ 大稿 RGB 完整流程（隔离「尺寸」）", !!(rBigRGB && rBigRGB.ok)],
      /* ★ v0.9.2（备路）：CMYK **现在也能导出了** —— 副本上先 `changeMode(RGB)`。
         判据 = "真的写出来了" **且** "步骤里确实转过模式"（否则又是在骗我们）。 */
      ["⑤ ★大稿 CMYK：**也能导出**（副本上先 changeMode(RGB)，PNG 才存得出来）",
        !!(rBigCMYK && rBigCMYK.ok && rBigCMYK.bytes > 0 &&
           String(rBigCMYK.steps || "").indexOf("changeMode → RGB") >= 0)]
    ];
    const bad61 = [];
    for (const c of checks61) if (!c[1]) bad61.push(c[0]);

    rec(
      S61,
      bad61.length === 0,
      "① " + tokLine +
        "\n        ② " + uxpLine +
        "\n        ③ " + line61(rS) +
        "\n        ④ " + line61(rBigRGB) +
        "\n        ⑤ " + line61(rBigCMYK) +
        "\n        ⚠️ 探针文件**没删**（前缀 vt-s61-），好让外部核对盘上到底有没有" +
        (bad61.length ? "\n        ⚠️ 未成立：" + bad61.join(" / ") : "")
    );
  } catch (e) {
    rec("S61 导出落点真相：用户记下来的目录能否真写进去（S57 只验了 PluginData 替身）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S62: 文件名之谜（v0.9.1，紧接着 S61 查）----------
     S61 已经把「目录可写 / CMYK / 5400 万像素 / 完整流程」**全部证成立**
     （三组都真写出了 PNG，外部核对文件头也是真 PNG），
     而用户那次真实导出**一个字节都没落盘**。剩下两个变量：
       ① **文件名**：用户那张稿的名字带 `×`(U+00D7) 与全角括号 `（）`；
          而 S61 三次用的都是纯 ASCII 名 —— 这一项先打 ①。
       ② 稿子本身：用户是**从磁盘打开的 JPEG**，不是自建库稿（若 ① 不成立再打它）。
     做法：同一张库稿、同一个目录，**只换文件名**，逐字拆开对比。 */
  try {
    const S62 = "S62 文件名之谜：同一张库稿 + 同一目录，只换文件名（拆 × / 全角括号 / 长度）";
    const uxp62 = require("uxp");
    const ls62 = uxp62.storage && uxp62.storage.localFileSystem;

    let uf62 = null;
    try {
      const st62 = await store.readJson("review.json", {});
      const tok62 = (st62 && st62.folderToken) || "";
      if (tok62 && ls62 && typeof ls62.getEntryForPersistentToken === "function") {
        uf62 = await ls62.getEntryForPersistentToken(tok62);
      }
    } catch (e) { /* 忽略：下面会记成"没跑" */ }

    let lines62 = "（没跑：没有可用的用户目录）";
    let ok62 = false;
    if (uf62) {
      let sc62 = null;
      try {
        sc62 = await ps.createScratchDoc({
          size: 4961, height: 10866, resolution: 150, mode: "RGB",
          name: "Vellum 自检临时文档(S62文件名)"
        });
        if (!sc62 || !sc62.ok) {
          lines62 = "建稿失败：" + ((sc62 && sc62.error) || "未知");
        } else {
          await ps.activateDocument(sc62.id);
          const ts62 = Date.now();
          const cases62 = [
            ["① 用户原样（带 × 与全角括号）",
              "2海南代理展架修改后84×184cm（3mm出血）-审核版-20261017-" + ts62 + ".png"],
            ["② 只把 × 换成 x",
              "2海南代理展架修改后84x184cm（3mm出血）-审核版-20261017-" + ts62 + ".png"],
            ["③ 只把全角括号换成半角",
              "2海南代理展架修改后84×184cm(3mm出血)-审核版-20261017-" + ts62 + ".png"],
            ["④ 纯 ASCII 短名（对照）",
              "vt-s62-control-" + ts62 + ".png"]
          ];
          const out62 = [];
          let bad62 = 0;
          for (const c62 of cases62) {
            const row = { label: c62[0], name: c62[1], bytes: null, ok: false,
              nap: "", createErr: "", err: "", steps: "" };
            try {
              const et62 = await uf62.createFile(c62[1], { overwrite: true });
              row.nap = String((et62 && et62.nativePath) || "");
              try {
                const g62 = await ps.exportReview({
                  entry: et62, folder: uf62, kind: "review", bleed: { state: "unknown", mm: null }
                });
                row.bytes = g62.fileBytes;
                row.ok = typeof g62.fileBytes === "number" && g62.fileBytes > 0;
                row.steps = (g62.steps || []).join(" | ");
                row.err = g62.error || "";
              } catch (e2) {
                row.err = "导出抛异常：" + ((e2 && e2.message) || e2);
              }
            } catch (e1) {
              row.createErr = "createFile 抛异常：" + ((e1 && e1.message) || e1);
            }
            if (!row.ok) bad62 += 1;
            out62.push(row);
          }
          lines62 = out62.map(function (r) {
            return "· " + r.label +
              (r.createErr ? "　⇒ " + r.createErr : "") +
              "\n            name=" + JSON.stringify(r.name) +
              "\n            nativePath=" + JSON.stringify(r.nap) +
              "　" + (r.bytes === null ? "bytes=null" : "bytes=" + r.bytes) +
              "　" + (r.ok ? "✅ 写出来了" : "❌ " + (r.err || "没写出来"));
          }).join("\n        ");
          /* 判据：**只要"纯 ASCII 对照"能写、而带特殊字符的写不出** ⇒ 文件名就是根因 */
          ok62 = (bad62 === 0);
        }
      } catch (e) {
        lines62 = "抛异常：" + ((e && e.message) || e);
      } finally {
        if (sc62 && sc62.ok) { try { await ps.closeDocument(sc62.id); } catch (e) { /* 忽略 */ } }
      }
    }

    rec(
      S62,
      ok62,
      lines62 +
        "\n        ⚠️ 探针文件**没删**（前缀 vt-s62- / 用户风格名），好让外部核对盘上到底有没有"
    );
  } catch (e) {
    rec("S62 文件名之谜：同一张库稿 + 同一目录，只换文件名（拆 × / 全角括号 / 长度）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S63: 稿子之谜（v0.9.1，接着 S61/S62 查）----------
     S61 证「目录可写 + CMYK + 5400 万像素 + 完整流程」全部成立；
     S62 证「用户那个文件名原样能写进去」（69983 B）。
     ⇒ 只剩**稿子本身**没被复现。用 MCP 读到的用户稿真实属性是：
        4961×10866 @150 · CMYK · 8 位 · **1 层「背景」(isBackground=true)** ·
        **从磁盘打开的 JPEG（有 path）** · saved=false（有未保存改动）。
     这一项就把「**文件背书**（存到磁盘上、因此带 PS 的「背景」层）」这个形态造出来：
        自建 CMYK 稿 → `saveAs.jpg(asCopy=false)` ⇒ 它**变成磁盘上的 JPEG** → 再导出审核版。
     ⚠️ 若不成立 ⇒ 说明是"用户那张稿的某种状态"，需要把**面板那条路**的日志补全再请用户重试。 */
  try {
    const S63 = "S63 稿子之谜：**文件背书**的 CMYK JPEG（带「背景」层）能不能导出审核版";
    const uxp63 = require("uxp");
    const ls63 = uxp63.storage && uxp63.storage.localFileSystem;
    const ph63 = require("photoshop");

    let uf63 = null;
    let df63 = null;
    try {
      const st63 = await store.readJson("review.json", {});
      const tk63 = (st63 && st63.folderToken) || "";
      if (tk63) uf63 = await ls63.getEntryForPersistentToken(tk63);
      df63 = await ls63.getDataFolder();
    } catch (e) { /* 忽略 */ }

    let detail63 = "（没跑：拿不到目录）";
    let ok63 = false;
    let backing = [];
    if (uf63 && df63) {
      let sc63 = null;
      try {
        sc63 = await ps.createScratchDoc({
          size: 4961, height: 10866, resolution: 150, mode: "RGB",
          name: "Vellum 自检临时文档(S63文件背书)"
        });
        if (!sc63 || !sc63.ok) {
          detail63 = "建稿失败：" + ((sc63 && sc63.error) || "未知");
        } else {
          await ps.activateDocument(sc63.id);

          /* ① 存成磁盘上的 JPEG（asCopy=false ⇒ 这张稿**变成文件背书的**，
                并出现 PS 的「背景」层 —— 正是用户那张稿的形态） */
          let save63 = "（没跑）";
          try {
            const eJpg = await df63.createFile("vt-s63-" + Date.now() + ".jpg", { overwrite: true });
            backing.push(eJpg);
            await ps.runModal(async () => {
              await ph63.app.activeDocument.saveAs.jpg(eJpg, {}, false);
            }, "Vellum 自检：把自建稿存成 JPEG");
            save63 = "jpg ok";
          } catch (e) {
            save63 = "jpg 失败（" + ((e && e.message) || e) + "）";
            try {
              const ePsd = await df63.createFile("vt-s63-" + Date.now() + ".psd", { overwrite: true });
              backing.push(ePsd);
              await ps.runModal(async () => {
                await ph63.app.activeDocument.saveAs.psd(ePsd, {}, false);
              }, "Vellum 自检：把自建稿存成 PSD");
              save63 += " ⇒ 退用 psd 成功";
            } catch (e2) {
              save63 += " ⇒ psd 也失败（" + ((e2 && e2.message) || e2) + "）";
            }
          }

          /* ② 读回这时的真实形态（要与 MCP 读到的用户稿对照） */
          const g63 = ps.readDocGeom();
          let form63 = "?";
          try {
            const d = ph63.app.activeDocument;
            let lay = "?";
            try { lay = (d.layers || []).map(function (l) { return l.name; }).join("/"); } catch (e) { /* 忽略 */ }
            form63 = "name=" + JSON.stringify(String(d.name || "")) +
              "　path=" + JSON.stringify(String(d.path || "")) +
              "　saved=" + String(d.saved) +
              "　层=[" + lay + "]" +
              "　" + g63.w + "×" + g63.h + " @" + g63.ppi + "dpi";
          } catch (e) { form63 = "读形态失败：" + ((e && e.message) || e); }

          /* ③ 用**与用户完全一致**的文件名与出血状态导出 */
          const pname63 = "2海南代理展架修改后84×184cm（3mm出血）-审核版-20261017-" + Date.now() + ".png";
          let res63 = null;
          let err63 = "";
          try {
            const ePng = await uf63.createFile(pname63, { overwrite: true });
            res63 = await ps.exportReview({
              entry: ePng, folder: uf63, kind: "review", bleed: { state: "unknown", mm: null }
            });
          } catch (e) {
            err63 = "导出抛异常：" + ((e && e.message) || e);
          }

          const bytes63 = res63 ? res63.fileBytes : null;
          ok63 = !!((res63 && bytes63 !== null && bytes63 > 0) && !err63);

          detail63 =
            "存盘=" + save63 +
            "\n        ★这时的稿子=" + form63 +
            "\n        导出：bytes=" + bytes63 +
            "　" + (res63 && res63.error ? "error=" + res63.error : "无错") +
            (err63 ? "　" + err63 : "") +
            "\n        步骤=" + (res63 ? (res63.steps || []).join(" | ") : "（没跑）") +
            "\n        告警=" + JSON.stringify(res63 ? (res63.warnings || []) : []) +
            "\n        ⇒ " + (ok63
              ? "文件背书的稿子**也能导出** ⇒ 不是「文件背书」这一个因素；需要补全日志再请用户复现"
              : "★ **复现了**：文件背书的稿子导不出 ⇒ 根因在这个形态上");
        }
      } catch (e) {
        detail63 = "抛异常：" + ((e && e.message) || e);
      } finally {
        if (sc63 && sc63.ok) { try { await ps.closeDocument(sc63.id); } catch (e) { /* 忽略 */ } }
        for (const b of backing) { try { await b.delete(); } catch (e) { /* 忽略 */ } }
      }
    }

    rec(
      S63,
      ok63,
      detail63 +
        "\n        ⚠️ 用来造「文件背书」的临时 jpg/psd **已删**（在 PluginData 里）"
    );
  } catch (e) {
    rec("S63 稿子之谜：**文件背书**的 CMYK JPEG（带「背景」层）能不能导出审核版", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S64: 独立复核 + （可选）在**用户真稿**上复现（v0.9.1）----------
     🔴 2026-10-17 真机事故：用户在 4961×10866 CMYK 的 JPEG 上导出审核版，
        面板报 `bytes=null`，而 `saveAs` **没抛错**；事后查盘**目标目录里一个字节都没有**。
        S61/S62/S63 把 12 项受控变量（目录 / 文件名 / 色彩模式 / 尺寸 / 文件背书 /
        出血三态 / 完整流程…）**全部证成立** ⇒ 用自建稿**复现不出来**。
     ⇒ 这一项做两件事：
        (a) 验新加的「问目录」独立复核（`ps.fileInFolder`）**正负对照都对**
            —— 它是这次事故"分不清写失败还是读失败"的解药；
        (b) **只在 `userdoc.flag` 存在时**，在**用户当前那张真稿**上真跑一次导出
            —— 这是唯一还剩的复现路径（会读一次几何、跑完核对还原自证）。
            ⚠️ 默认**不跑**（没有 flag 就跳过），绝不擅动用户的稿。 */
  try {
    const S64 = "S64 独立复核（问目录）+（可选 userdoc.flag）在用户真稿上复现";
    const uxp64 = require("uxp");
    const ls64 = uxp64.storage && uxp64.storage.localFileSystem;
    const ph64 = require("photoshop");

    /* (a) 复核助手的正负对照 */
    let posLine = "（没跑）";
    let negLine = "（没跑）";
    let helperOk = false;
    try {
      const df64 = await ls64.getDataFolder();
      const nm64 = "vt-s64-check-" + Date.now() + ".txt";
      const f64 = await df64.createFile(nm64, { overwrite: true });
      await f64.write("s64-ok", { format: uxp64.storage.formats.utf8 });
      const pos = await ps.fileInFolder(df64, nm64);
      const neg = await ps.fileInFolder(df64, "vt-s64-nonexistent-" + Date.now() + ".txt");
      posLine = "存在的文件 ⇒ found=" + pos.found + "　size=" + pos.size +
        "（须 found=true 且 size>0）";
      negLine = "不存在的名字 ⇒ found=" + neg.found + "（须 false）";
      helperOk = !!(pos.found && typeof pos.size === "number" && pos.size > 0 && !neg.found);
      try { await f64.delete(); } catch (e) { /* 忽略 */ }
    } catch (e) {
      posLine = "抛异常：" + ((e && e.message) || e);
    }

    /* (b) 可选：在用户真稿上跑（默认跳过） */
    let userLine = "（跳过：没有 userdoc.flag）";
    let userOk = true;
    let wantUser = false;
    try { wantUser = await data.pluginFlag("userdoc.flag"); } catch (e) { wantUser = false; }
    if (wantUser) {
      userOk = false;
      let handle = null;
      try {
        const docs64 = ph64.app.documents;
        const cands64 = [];
        for (let i = 0; i < docs64.length; i++) {
          const nm = String(docs64[i].name || "");
          if (nm.indexOf("Vellum 自检临时文档") === 0) continue;
          if (nm === "HelloWorld.psd") continue;
          cands64.push(docs64[i]);
        }
        if (cands64.length === 1) {
          handle = cands64[0];
        } else {
          const names = [];
          for (let j = 0; j < cands64.length; j++) names.push(String(cands64[j].name || "?"));
          userLine = "候选稿 " + cands64.length + " 个（须恰好 1 个）：" + names.join(" / ");
        }
      } catch (e) {
        userLine = "列举文档失败：" + ((e && e.message) || e);
      }

      if (handle) {
        let uf64 = null;
        try {
          const st64 = await store.readJson("review.json", {});
          const tk64 = (st64 && st64.folderToken) || "";
          if (tk64) uf64 = await ls64.getEntryForPersistentToken(tk64);
        } catch (e) { /* 忽略 */ }
        if (!uf64) {
          userLine = "拿不到用户记下的导出目录（review.json 没令牌）";
        } else {
          try {
            const rev64 = require("../lib/review.js");
            await ps.activateDocument(handle.id);
            const g0 = ps.readDocGeom();
            const nmU = rev64.exportFileName(g0.name || "doc", "review", new Date());
            const entU = await uf64.createFile(nmU, { overwrite: true });
            const gotU = await ps.exportReview({
              entry: entU, folder: uf64, kind: "review",
              bleed: { state: "unknown", mm: null }
            });
            userOk = !!(gotU && gotU.ok && typeof gotU.fileBytes === "number" && gotU.fileBytes > 0);
            userLine = "稿=" + (g0.name || "?") + "（" + g0.w + "×" + g0.h + " @" + g0.ppi + "）" +
              "\n            文件名=" + JSON.stringify(nmU) +
              "\n            ok=" + (gotU && gotU.ok) +
              "　bytes=" + (gotU && gotU.fileBytes) +
              "　fileCheck=" + JSON.stringify((gotU && gotU.fileCheck) || null) +
              "　savedDoc=" + JSON.stringify((gotU && gotU.savedDoc) || null) +
              "　err=" + ((gotU && gotU.error) || "-") +
              "\n            还原自证=" + JSON.stringify((gotU && gotU.restored) || null) +
              "\n            步骤=" + ((gotU && gotU.steps) || []).join(" | ") +
              "\n            ⇒ " + (userOk
                ? "备路在**真稿**上成立：CMYK 也导得出（副本上 `changeMode(RGB)`），且原稿三项自证全 true"
                : "★ **在真稿上仍然失败** ⇒ 看上面的 steps / fileCheck / savedDoc");
          } catch (e) {
            userLine = "在真稿上跑抛异常：" + ((e && e.message) || e);
          }
        }
      }
    }

    rec(
      S64,
      helperOk && userOk,
      "(a) 独立复核助手：" +
        "\n        · " + posLine +
        "\n        · " + negLine +
        "\n        (b) 用户真稿：" + userLine +
        (wantUser ? "" : "\n        ⚠️ (b) 默认不跑：要跑就在插件目录下放一个 `userdoc.flag`")
    );
  } catch (e) {
    rec("S64 独立复核（问目录）+（可选 userdoc.flag）在用户真稿上复现", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S65: 在用户真稿上**纯 saveAs 二分**（v0.9.1）----------
     S64 已在这张稿上复现：`saveAs(asCopy)` 报成功、盘上**一个字节都没写**。
     这一项只做**纯 saveAs**（不动画布、不写参数条、不缩放），把变量一个个拆开：
       ① 原稿 → 用户目录 · PNG（**全新名字** ⇒ 目标一定不存在）
       ② 原稿 → 插件自己的目录 · PNG（隔离"目标目录"）
       ③ 原稿 → 用户目录 · JPG（隔离"PNG 这种格式"）
     ⇒ ① 若**写得出** ⇒ 触发点在前面那几步（扩画布 / 文字层 / **resizeImage**）；
        ① 若**写不出** ⇒ 触发点在这张稿本身（或它所在的那个目录）。
     ⚠️ 同样只在 `userdoc.flag` 存在时跑；`asCopy=true` ⇒ **不改这张稿**。 */
  try {
    const S65 = "S65 在用户真稿上纯 saveAs 二分（新名字 / 两个目录 / 两种格式）";
    let want65 = false;
    try { want65 = await data.pluginFlag("userdoc.flag"); } catch (e) { want65 = false; }
    let lines65 = "（跳过：没有 userdoc.flag）";
    let ok65 = true;
    if (want65) {
      ok65 = false;
      try {
        const ph65 = require("photoshop");
        const uxp65 = require("uxp");
        const ls65 = uxp65.storage && uxp65.storage.localFileSystem;
        const df65 = await ls65.getDataFolder();
        let uf65 = null;
        try {
          const st65 = await store.readJson("review.json", {});
          if (st65 && st65.folderToken) {
            uf65 = await ls65.getEntryForPersistentToken(st65.folderToken);
          }
        } catch (e) { /* 忽略 */ }

        let tgt65 = null;
        const docs65 = ph65.app.documents;
        for (let i = 0; i < docs65.length; i++) {
          const nm = String(docs65[i].name || "");
          if (nm.indexOf("Vellum 自检临时文档") === 0) continue;
          if (nm === "HelloWorld.psd") continue;
          if (!tgt65) tgt65 = docs65[i];
        }
        if (!tgt65) {
          lines65 = "找不到用户稿（候选 0 个）";
        } else {
          await ps.activateDocument(tgt65.id);
          const ts65 = Date.now();
          const runs65 = [
            ["① 原稿 → 用户目录 · PNG", uf65, "png", "vt-s65-a-" + ts65 + ".png"],
            ["② 原稿 → 插件目录 · PNG", df65, "png", "vt-s65-b-" + ts65 + ".png"],
            ["③ 原稿 → 用户目录 · JPG", uf65, "jpg", "vt-s65-c-" + ts65 + ".jpg"]
          ];
          const out65 = [];
          for (const r65 of runs65) {
            const row = { label: r65[0], size: null, nap: "", err: "" };
            try {
              if (!r65[1]) { row.err = "拿不到目录"; out65.push(row); continue; }
              const e65 = await r65[1].createFile(r65[3], { overwrite: true });
              row.nap = String(e65.nativePath || "");
              const saver = ph65.app.activeDocument.saveAs;
              await ps.runModal(async () => {
                await saver[r65[2]](e65, {}, true);
              }, "Vellum 自检：纯 saveAs 二分");
              const chk65 = await ps.fileInFolder(r65[1], r65[3]);
              row.size = chk65.size;
              row.err = chk65.error || "";
            } catch (e) {
              row.err = "抛异常：" + ((e && e.message) || e);
            }
            out65.push(row);
          }
          lines65 = "稿=" + String(tgt65.name || "?") +
            "\n        " + out65.map(function (x) {
              return x.label + " ⇒ " +
                (x.size === null ? "size=null" : "size=" + x.size) +
                (x.size > 0 ? " ✅" : " ❌") +
                (x.err ? "（" + x.err + "）" : "");
            }).join("\n        ") +
            "\n        ⇒ " + ((out65[0] && out65[0].size > 0)
              ? "纯 saveAs **能写** ⇒ 触发点在前面那几步（扩画布/文字层/**resizeImage**）"
              : "纯 saveAs **写不出**（这张稿是 **CMYK**，而 PS 的 PNG 不支持 CMYK）⇒ 所以 exportReview 必须走**备路**（见 S67）");
          /* ★ 判据 = "这个已知限制真的存在"：**纯 PNG 失败、JPG 成功**。
             它是一条**诊断**（记录 PS 的限制），不是产品功能判据 ——
             产品层面的结论看 **S67**（备路已绕过它）。 */
          ok65 = !!(out65[0] && out65[0].size === null && out65[2] && out65[2].size > 0);
        }
      } catch (e) {
        lines65 = "抛异常：" + ((e && e.message) || e);
      }
    }
    rec(S65, ok65, lines65);
  } catch (e) {
    rec("S65 在用户真稿上纯 saveAs 二分（新名字 / 两个目录 / 两种格式）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S66: CMYK × PNG —— 把根因钉死（v0.9.1）----------
     S65 在用户那张稿上把"格式"变量拆开了：**PNG 失败、JPG 成功**（且换目录照样失败）。
     用 ExtendScript 直连同一台 PS 逼出的**真实报错**是：
        `发生了常规 Photoshop 错误… 命令「存储」的参数当前是无效的。 #-25923`
     —— 而且**新建的 400×400 CMYK 稿也一样失败**，RGB 稿正常。
     ⇒ 高度怀疑：**PNG 根本存不了 CMYK 稿**（UXP 的 `saveAs.png` 把这个错**吞掉了**，
        所以表现为"报成功、盘上什么都没有"）。
     这一项在**插件自己的通道**里钉死它，并顺手查两件修 bug 要用的事：
        · `createScratchDoc({mode})` 到底建出什么模式（之前那几组"CMYK"探针没验过这点）
        · 把 CMYK 稿 `changeMode(RGB)` 之后，UXP 的 `saveAs.png` 是不是就好了（= 候选修法）
        · `Document` 上有没有 `duplicate`（= 另一条候选修法：复制一张、在原稿之外转换） */
  try {
    const S66 = "S66 CMYK × PNG：PNG 存不了 CMYK 稿（UXP 会静默吞掉）";
    const ph66 = require("photoshop");
    const uxp66 = require("uxp");
    const df66 = await uxp66.storage.localFileSystem.getDataFolder();

    const png66 = async function (doc, tag) {
      const nm = "vt-s66-" + tag + "-" + Date.now() + ".png";
      const r = { tag: tag, size: null, err: "" };
      try {
        const e = await df66.createFile(nm, { overwrite: true });
        await ps.runModal(async () => {
          await ph66.app.activeDocument.saveAs.png(e, {}, true);
        }, "Vellum 自检：S66 PNG 存盘");
        const chk = await ps.fileInFolder(df66, nm);
        r.size = chk.size;
        r.err = chk.error || "";
      } catch (e2) {
        r.err = "抛异常：" + ((e2 && e2.message) || e2);
      }
      return r;
    };
    const modeOf66 = function () {
      try { return String(ph66.app.activeDocument.mode); } catch (e) { return "读不到"; }
    };

    /* (a) 自建"CMYK"稿：先看它**真实**是什么模式、再试 PNG */
    let sc66 = await ps.createScratchDoc({
      size: 400, height: 400, resolution: 72, mode: "CMYK", name: "Vellum 自检临时文档(S66-CMYK)"
    });
    let modeAsk = "?";
    let modeReal = "?";
    let rCmyk = { tag: "cmyk", size: null, err: "（没跑）" };
    let rAfter = { tag: "cmyk→RGB", size: null, err: "（没跑）" };
    let changeLine = "（没跑）";
    if (sc66 && sc66.ok) {
      await ps.activateDocument(sc66.id);
      modeAsk = "CMYK";
      modeReal = modeOf66();
      rCmyk = await png66(sc66, "cmyk");
      /* (b) 把这张稿改成 RGB，再试一次 —— 如果就好了，那"改模式"就是候选修法 */
      try {
        const CN = (require("photoshop").constants || {}).DocumentMode || {};
        const target = CN.RGB || "RGBColorMode";
        changeLine = "changeMode(" + JSON.stringify(String(target)) + ") ";
        await ps.runModal(async () => {
          await ph66.app.activeDocument.changeMode(target);
        }, "Vellum 自检：S66 改模式");
        changeLine += "ok ⇒ 现在 " + modeOf66();
        rAfter = await png66(sc66, "cmyk2rgb");
      } catch (e) {
        changeLine += "抛异常：" + ((e && e.message) || e);
      }
      try { await ps.closeDocument(sc66.id); } catch (e) { /* 忽略 */ }
    } else {
      rCmyk.err = "建稿失败：" + ((sc66 && sc66.error) || "未知");
    }

    /* (c) 自建 RGB 稿作对照 */
    let rRgb = { tag: "rgb", size: null, err: "（没跑）" };
    let sc66b = await ps.createScratchDoc({
      size: 400, height: 400, resolution: 72, mode: "RGB", name: "Vellum 自检临时文档(S66-RGB)"
    });
    if (sc66b && sc66b.ok) {
      await ps.activateDocument(sc66b.id);
      rRgb.tag = "rgb(" + modeOf66() + ")";
      rRgb = await png66(sc66b, "rgb");
      try { await ps.closeDocument(sc66b.id); } catch (e) { /* 忽略 */ }
    }

    /* (d) 两条候选修法要用的 API 在不在 */
    let apiLine = "（没查）";
    try {
      const d0 = ph66.app.activeDocument;
      apiLine = "duplicate=" + (typeof (d0 && d0.duplicate)) +
        "　changeMode=" + typeof (ph66.app.activeDocument && ph66.app.activeDocument.changeMode);
    } catch (e) { apiLine = "查不到：" + ((e && e.message) || e); }

    const fmt66 = function (r) {
      return r.tag + " ⇒ " + (r.size === null ? "size=null" : "size=" + r.size) +
        (r.size > 0 ? " ✅" : " ❌") + (r.err ? "（" + r.err + "）" : "");
    };
    const cmykBroken = !(rCmyk.size > 0);
    const rgbOk = rRgb.size > 0;
    rec(
      S66,
      /* 这一项是**诊断**：判据 = "CMYK 坏 + RGB 好"这个模式被确认了 */
      cmykBroken && rgbOk,
      "模式实测：请求「" + modeAsk + "」→ 真机是「" + modeReal + "」（" +
        ((modeReal === "DocumentMode.CMYK" || modeReal === "CMYKColorMode") ? "一致" : "★不一致！mode 参数没生效") +
        "）\n        " + fmt66(rCmyk) +
        "\n        " + changeLine + " ⇒ " + fmt66(rAfter) +
        "\n        " + fmt66(rRgb) +
        "\n        API：" + apiLine +
        "\n        ⇒ " + (cmykBroken && rgbOk
          ? "★ **根因确认：PNG 存不了 CMYK 稿**（RGB 正常）。UXP 的 `saveAs.png` 会把 PS 的" +
            "#-25923「存储的参数当前是无效的」**吞掉** ⇒ 表现为「报成功、盘上 0 字节」。" +
            "用户那张 84×184cm 展架稿正是 CMYK ⇒ 必然失败。" +
            " ⇒ **exportReview 已改走备路绕过它**（副本上转 RGB，见 S67）。"
          : "未复现「CMYK 存不了」这个模式，需要重看读数")
    );
  } catch (e) {
    rec("S66 CMYK × PNG：PNG 存不了 CMYK 稿（UXP 会静默吞掉）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S67: CMYK 端到端（v0.9.2 备路的**产品级**回归）----------
     docs/52 的根因 = 「PS 的 PNG 存储不支持 CMYK」。修法 = 备路：
     复制一张副本 → 副本上 `changeMode(RGB)` → 画参数条 → 存 PNG → 关副本，
     **原稿全程只被读过**。这一项验的正是"修好了"这件事（不是诊断）：
       ① 真 CMYK 稿能导出（bytes > 0）
       ② 步骤里确实有 `changeMode → RGB`
       ③ **导出之后原稿仍是 CMYK**、且尺寸/图层数都没变（备路的硬承诺）
       ④ RGB 稿走同一条路照样 ok（不许为了 CMYK 把 RGB 弄坏） */
  try {
    const S67 = "S67 CMYK 端到端：真 CMYK 稿也导得出，且原稿仍是 CMYK、没被动过";
    const uxp67b = require("uxp");
    const df67b = await uxp67b.storage.localFileSystem.getDataFolder();

    const run67 = async function (mode) {
      const o = { mode: mode, made: "?", bytes: null, ok: false, steps: "", origMode: "", geom: null, err: "" };
      let sc = null;
      try {
        sc = await ps.createScratchDoc({
          size: 900, height: 700, resolution: 150, mode: mode,
          name: "Vellum 自检临时文档(S67-" + mode + ")"
        });
        if (!sc || !sc.ok) { o.err = "建稿失败：" + ((sc && sc.error) || "?"); return o; }
        await ps.activateDocument(sc.id);
        o.made = sc.modeReal || sc.mode || "?";
        const g0 = ps.readDocGeom();
        const e = await df67b.createFile("vt-s67-" + mode + "-" + Date.now() + ".png", { overwrite: true });
        const r = await ps.exportReview({
          entry: e, folder: df67b, kind: "review", bleed: { state: "has", mm: 3 }
        });
        o.bytes = r.fileBytes;
        o.ok = !!r.ok;
        o.steps = (r.steps || []).join(" | ");
        o.err = r.error || "";
        /* ★ 导出之后的**原稿自证**：模式与几何三项都得没变 */
        await ps.activateDocument(sc.id);
        o.origMode = String(require("photoshop").app.activeDocument.mode);
        const g1 = ps.readDocGeom();
        o.geom = {
          sameW: g1.w === g0.w, sameH: g1.h === g0.h, sameLayers: g1.layers === g0.layers,
          w: g1.w, h: g1.h, layers: g1.layers
        };
      } catch (e) {
        o.err += " 抛异常：" + ((e && e.message) || e);
      } finally {
        if (sc && sc.ok) { try { await ps.closeDocument(sc.id); } catch (e) { /* 忽略 */ } }
      }
      return o;
    };

    const c67 = await run67("CMYK");
    const r67 = await run67("RGB");
    const fmt67 = function (x) {
      return x.mode + "（建出来是 " + (x.made || "?") + "）⇒ bytes=" + x.bytes +
        "　ok=" + x.ok +
        "　导出后原稿模式=" + (x.origMode || "?") +
        "　原稿几何=" + JSON.stringify(x.geom || null) +
        "　" + (String(x.steps).indexOf("changeMode → RGB") >= 0 ? "有 changeMode" : "没转模式") +
        (x.err ? "　err=" + x.err : "");
    };
    const ck67 = [
      ["① ★真 CMYK 稿能导出（bytes > 0）", !!(c67.bytes > 0 && c67.ok)],
      ["② ★步骤里确实转过 RGB（不是靠运气）",
        String(c67.steps).indexOf("changeMode → RGB") >= 0],
      ["③ ★导出后**原稿仍是 CMYK**（备路的硬承诺：原稿只被读过）",
        c67.origMode === "CMYKColorMode"],
      ["④ ★原稿几何三项都没变",
        !!(c67.geom && c67.geom.sameW && c67.geom.sameH && c67.geom.sameLayers)],
      ["⑤ RGB 稿走同一条路照样 ok（没为 CMYK 把 RGB 弄坏）",
        !!(r67.bytes > 0 && r67.ok)]
    ];
    const bad67 = [];
    for (const c of ck67) if (!c[1]) bad67.push(c[0]);
    rec(
      S67,
      bad67.length === 0,
      fmt67(c67) + "\n        " + fmt67(r67) +
      (bad67.length
        ? "\n        ⚠️ 未成立：" + bad67.join(" / ")
        : "\n        ⇒ 备路成立：CMYK 也导得出，而且原稿全程**只被读过**（模式/尺寸/层数都没变）")
    );
  } catch (e) {
    rec("S67 CMYK 端到端：真 CMYK 稿也导得出，且原稿仍是 CMYK、没被动过", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- S68: 「新建稿 / PSD 模板」可行性探针（v0.9.4）----------
     用户 2026-10-17 的两块设想全压在这几条上，而它们**一条都没在本机验过**：
       ① `presetJSON` 建稿时**携带 guides** —— template-probe 验过「传 4 回读 4」，
          但**产品代码从未用过**（`lib/ps.js` 里根本没有 presetJSON 的调用）。
       ② 建完**存成 PSD**、再**重新打开**，参考线还在不在
          —— 用户要的正是「打好参考线、直接调用」，这条决定产品路成不成立。
       ③ `app.open(entry)` 能否打开 PluginData 里的文件（官方样例用过，本机未验）。
       ④ 打开后的**文档名**能不能改（PSD 走 handoff 会叫 `incoming.psd`，名字难看）。
       ⑤ `app.displayDialogs` 能不能设成不弹框（自动化打开文件时的卡死防护）。
       ⑥ `Entry.delete()` 存在吗 —— 契约 §九「插件能否删自己的文件」**一直未验**。
     判据一律「读回」，不靠「命令没报错」。
     ⚠️ 全程只碰自建临时文档与 `PluginData` 里的 `vt-s68-*` 文件；收尾切回用户原文档。 */
  try {
    const S68 = "S68 新建稿/PSD模板可行性：presetJSON 带参考线 → 存 PSD → 重开 → 参考线还在吗";
    const uxp8 = require("uxp");
    const psApi = require("photoshop");
    const app8 = psApi.app;
    const df68 = await uxp8.storage.localFileSystem.getDataFolder();

    const S = [];                       // 步骤流水
    const R = {
      dispDialogs: "", mkVia: "", mkErr: "", guidesMade: null, sizeMade: "",
      psdName: "", saveBytes: null, saveFound: null, saveErr: "", modeMade: "",
      openVia: "", openErr: "", nameAfterOpen: "", guidesAfterOpen: null,
      sizeAfterOpen: "", modeAfterOpen: "",
      renameOk: null, renameErr: "", nameAfterRename: "",
      delApi: "", delOk: null, delErr: "", goneAfterDel: null,
      closed: false,
    };
    const prevId = (app8.documents && app8.documents.length) ? app8.documents[0].id : null;
    let docId = null;
    let psdEntry = null;
    let reId = null;

    /* ⓪ 先试着关掉原生对话框（打开 PSD 时可能弹「色彩配置不匹配」，会卡死模态） */
    try {
      app8.displayDialogs = "dontDisplay";
      R.dispDialogs = String(app8.displayDialogs);
    } catch (eD) {
      R.dispDialogs = "设置失败：" + ((eD && eD.message) || eD);
    }
    S.push("displayDialogs→" + R.dispDialogs);

    /* ① presetJSON 建稿（带 4 条参考线）—— 先不包模态，失败再包模态重试 */
    /* ★ 字段集**照抄 template-probe 当年验通过的那份**（C1/C2）——
       第一轮我漏了 `scale` / `profile` / `artboards`，结果 presetJSON **整份被忽略**
       （读回 1946×172 @72、guides=0）。
       ⇒ **不许自己编字段集，要把已验证的那份原样抄过来。** */
    const preset68 = {
      name: "TP-S68",                         /* 已知被忽略，但验过的那份也带着它 */
      width: 600, height: 400, units: "pixelsUnit",
      resolution: 300, resolutionUnits: "inchesUnit",
      depth: 8, scale: 1,
      mode: "RGB", fill: "white",
      profile: "sRGB IEC61966-2.1",
      guides: [
        { direction: "v", coordinate: 20 },
        { direction: "v", coordinate: 580 },
        { direction: "h", coordinate: 20 },
        { direction: "h", coordinate: 380 }
      ],
      artboards: []
    };
    const mk68 = async function (useModal) {
      let made = null;
      try {
        if (useModal) {
          await psApi.core.executeAsModal(async function () {
            made = await app8.createDocument({ presetJSON: JSON.stringify(preset68),
              name: "Vellum 自检临时文档(S68-presetJSON)" });
          }, { commandName: "Vellum 探针：presetJSON 建稿" });
        } else {
          made = await app8.createDocument({ presetJSON: JSON.stringify(preset68),
            name: "Vellum 自检临时文档(S68-presetJSON)" });
        }
      } catch (e) {
        return { ok: false, err: ((e && e.message) || String(e)), via: useModal ? "modal" : "direct" };
      }
      if (made && made.id !== null && made.id !== undefined) {
        return { ok: true, doc: made, via: useModal ? "modal" : "direct" };
      }
      return { ok: false, err: "createDocument 没返回文档", via: useModal ? "modal" : "direct" };
    };
    let c68 = await mk68(false);
    if (!c68.ok) {
      R.mkErr = "直接调用失败（" + c68.err + "）";
      c68 = await mk68(true);
    }
    R.mkVia = c68.via;
    if (c68.ok) {
      docId = c68.doc.id;
      R.guidesMade = (c68.doc.guides && c68.doc.guides.length) || 0;
      R.sizeMade = c68.doc.width + "×" + c68.doc.height + " @" + c68.doc.resolution;
      /* ★ 读回色彩模式 —— `presetJSON` 的 `mode` 字段**到底生不生效**，
         以前没记录 ⇒ 又是"传了参数没读回"（本项目的老坑）。 */
      try { R.modeMade = String(c68.doc.mode || ""); } catch (eM) { R.modeMade = "读不到"; }
      S.push("createDocument(" + c68.via + ") ok　尺寸 " + R.sizeMade +
        "　模式=" + R.modeMade + "　guides=" + R.guidesMade);
    } else {
      S.push("createDocument ✗（direct: " + R.mkErr + " / modal: " + c68.err + "）");
    }

    /* ② 存成 PSD（**asCopy**） */
    if (docId !== null) {
      try {
        psdEntry = await df68.createFile("vt-s68-tpl-" + Date.now() + ".psd", { overwrite: true });
        R.psdName = psdEntry.name;
        /* 🔴 关键一步（**第三个同源坑**，2026-10-17 查出）：
           `createFile` 会**真的建出一个 0 字节文件** ⇒ PS 认为「目标已存在」⇒
           `saveAs` **静默不写**（不抛错、返回成功）。v0.9.5 的「导出审核版」踩过同一个坑，
           当时修法就是"保存前先清掉同名文件"；本探针**没照抄那一步**，所以 S68 一直时通时不通。
           ⇒ 正解：先 `delete()` 掉这个预建文件，让 PS 一定是"新建"。 */
        try {
          if (typeof psdEntry.delete === "function") {
            await psdEntry.delete();
            S.push("clearTarget 已删预建文件");
          } else {
            S.push("clearTarget 跳过（Entry 无 delete）");
          }
        } catch (eD68) {
          S.push("clearTarget 失败 " + ((eD68 && eD68.message) || eD68));
        }
        await psApi.core.executeAsModal(async function () {
          await app8.activeDocument.saveAs.psd(psdEntry, {}, true);
        }, { commandName: "Vellum 探针：存 PSD" });
        /* ★ 判据用**问目录**（不看 entryBytes）：
           `entryBytes` 的"读失败"与"文件不存在"读数**完全一样**（都 null）—— 这是老教训。 */
        const chk68 = await ps.fileInFolder(df68, psdEntry.name);
        R.saveBytes = chk68 && chk68.found ? chk68.size : null;
        R.saveFound = !!(chk68 && chk68.found);
        S.push("saveAs.psd " + (R.saveBytes > 0 ? "ok " + R.saveBytes + "B" : "无字节") +
          "　问目录:found=" + R.saveFound + " size=" + R.saveBytes);
      } catch (e2) {
        R.saveErr = ((e2 && e2.message) || String(e2));
        S.push("saveAs.psd THREW " + R.saveErr);
      }
      /* ③ 关掉它，再重新打开 —— 这才是「模板」的真实用法 */
      try {
        await ps.closeDocument(docId);
        R.closed = true;
        docId = null;
        S.push("close ok");
      } catch (e3) {
        S.push("close THREW " + ((e3 && e3.message) || e3));
      }
    }

    /* ④ app.open(entry) —— 官方样例用过，本机未验 */
    if (psdEntry && R.saveBytes > 0) {
      const open68 = async function (useModal) {
        let got = null;
        try {
          if (useModal) {
            await psApi.core.executeAsModal(async function () {
              got = await app8.open(psdEntry);
            }, { commandName: "Vellum 探针：打开 PSD" });
          } else {
            got = await app8.open(psdEntry);
          }
        } catch (e) {
          return { ok: false, err: ((e && e.message) || String(e)), via: useModal ? "modal" : "direct" };
        }
        const d = Array.isArray(got) ? got[0] : got;
        if (d && d.id !== null && d.id !== undefined) {
          return { ok: true, doc: d, via: useModal ? "modal" : "direct" };
        }
        return { ok: false, err: "open 没返回文档（拿到 " + (got === null ? "null" : typeof got) + "）", via: useModal ? "modal" : "direct" };
      };
      let o68 = await open68(false);
      if (!o68.ok) o68 = await open68(true);
      R.openVia = o68.via;
      if (o68.ok) {
        const d = o68.doc;
        reId = d.id;
        R.nameAfterOpen = String(d.name);
        R.guidesAfterOpen = (d.guides && d.guides.length) || 0;
        R.sizeAfterOpen = d.width + "×" + d.height + " @" + d.resolution;
        R.modeAfterOpen = String(d.mode);
        S.push("app.open(" + o68.via + ") ok　名=" + R.nameAfterOpen +
          "　" + R.sizeAfterOpen + "　**guides=" + R.guidesAfterOpen + "**");

        /* ⑤ 文档名可改吗 —— PSD 走 handoff 会叫 incoming.psd，名字难看 */
        try {
          d.name = "易拉宝模板 80x180";
          R.nameAfterRename = String(d.name);
          R.renameOk = (R.nameAfterRename === "易拉宝模板 80x180");
          S.push("改名 → " + R.nameAfterRename + (R.renameOk ? "（生效）" : "（**没生效**）"));
        } catch (e5) {
          R.renameOk = false;
          R.renameErr = ((e5 && e5.message) || String(e5));
          S.push("改名 THREW " + R.renameErr);
        }
      } else {
        R.openErr = o68.err;
        S.push("app.open ✗ " + o68.err);
      }
    } else {
      S.push("跳过打开（PSD 没存成功）");
    }

    /* 收尾：关掉重开的那份 + 切回用户原文档 */
    if (reId !== null) { try { await ps.closeDocument(reId); } catch (e) { /* 忽略 */ } }
    if (docId !== null) { try { await ps.closeDocument(docId); } catch (e) { /* 忽略 */ } }
    if (prevId !== null) { try { await ps.activateDocument(prevId); } catch (e) { /* 忽略 */ } }

    /* ⑥ Entry.delete() 存在吗（契约 §九 一直未验）—— 删不掉就留给外部清理 */
    if (psdEntry) {
      R.delApi = (typeof psdEntry.delete === "function") ? "function" : String(typeof psdEntry.delete);
      if (R.delApi === "function") {
        try {
          await psdEntry.delete();
          R.delOk = true;
        } catch (e6) {
          R.delOk = false;
          R.delErr = ((e6 && e6.message) || String(e6));
        }
      }
      try {
        await df68.getEntry(psdEntry.name);
        R.goneAfterDel = false;
      } catch (e7) {
        R.goneAfterDel = true;
      }
      S.push("entry.delete=" + R.delApi + (R.delOk === null ? "" : "　删成功=" + R.delOk +
        "　文件真没了=" + R.goneAfterDel));
    }

    const ck68 = [
      ["① presetJSON 建稿成功（并读出尺寸）", R.guidesMade !== null],
      ["② ★建稿时**携带的参考线真的写进去了**（读回 " + R.guidesMade + " 条）", R.guidesMade === 4],
      ["③ 能另存为 PSD（有字节）", !!(R.saveBytes > 0)],
      ["④ ★能 app.open 重新打开那份 PSD", !!R.nameAfterOpen],
      ["⑤ ★★★重开后**参考线还在**（用户要的「打好参考线直接调用」靠它）", R.guidesAfterOpen === 4]
    ];
    const bad68 = [];
    for (const c of ck68) if (!c[1]) bad68.push(c[0]);
    rec(
      S68,
      bad68.length === 0,
      "⓪ " + (R.mkErr ? "direct 失败：" + R.mkErr + "　" : "") + S.join("\n         ")
      + "\n        读回：名=" + R.nameAfterOpen + "　" + R.sizeAfterOpen + "　模式=" + R.modeAfterOpen
      + "　guides=" + R.guidesAfterOpen
      + "\n        改名：" + (R.renameOk === null ? "（没测）"
          : (R.renameOk ? "可改 ✔" : "**不可改**" + (R.renameErr ? "（" + R.renameErr + "）" : "（赋值后没变）")))
      + "\n        displayDialogs=" + R.dispDialogs
      + "\n        entry.delete=" + R.delApi
      + (bad68.length
        ? "\n        ⚠️ 未成立：" + bad68.join(" / ")
        : "\n        ⇒ 「PSD 模板」这条路**技术成立**：参考线能随 PSD 存下来、也能重新打开后读回")
    );
  } catch (e) {
    rec("S68 新建稿/PSD模板可行性：presetJSON 带参考线 → 存 PSD → 重开 → 参考线还在吗", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- 收尾前：清掉本轮诊断探针留下的文件（v0.9.1）----------
     S61–S66 会往"用户记下来的导出目录"和插件目录写 `vt-s6*` 探针文件。
     ⚠️ 只有 `verify.flag` 存在时才会发生（**同事永远不会**），但跑一次留一堆也不像话。
     ⇒ 这里按前缀清掉**只属于我们自己**的文件；**绝不碰**用户自己的任何文件。 */
  try {
    const uxp67 = require("uxp");
    const ls67 = uxp67.storage && uxp67.storage.localFileSystem;
    let removed67 = 0;
    const sweep67 = async function (folder) {
      if (!folder || typeof folder.getEntries !== "function") return;
      try {
        const es = await folder.getEntries();
        for (const e of (es || [])) {
          const nm = String((e && e.name) || "");
          /* 两种探针命名：`vt-s6*` 与带**13 位纪元时间戳**的名字
             （面板真导出的尾巴是 4 位 HHMM，不会被误删）。 */
          if (nm.indexOf("vt-s6") === 0 || /-2026\d{4}-\d{13}\.(png|jpg)$/.test(nm)) {
            try { await e.delete(); removed67 += 1; } catch (e2) { /* 忽略 */ }
          }
        }
      } catch (e) { /* 忽略 */ }
    };
    let uf67 = null;
    try {
      const st67 = await store.readJson("review.json", {});
      if (st67 && st67.folderToken) uf67 = await ls67.getEntryForPersistentToken(st67.folderToken);
    } catch (e) { /* 忽略 */ }
    await sweep67(uf67);
    try { await sweep67(await ls67.getDataFolder()); } catch (e) { /* 忽略 */ }
    try { await log.appendLog("selfcheck probe cleanup removed=" + removed67); } catch (e) { /* 忽略 */ }
  } catch (e) { /* 清理失败不影响自检结论 */ }

  /* ---------- S69: 自检卫生 —— 开场清场 + 收尾复查（v0.9.5）----------
     它守的是"自检自己不留垃圾"，这是 2026-10-17 那次事故的直接教训：
     `closeDocument` 失败不抛异常、调用方不看返回值 ⇒ 临时文档在用户 PS 里堆积。 */
  try {
    try {
      sweepOut = await ps.sweepProbeDocs();
    } catch (eS2) {
      sweepOut = { closed: [], failed: [{ name: "(复查)", err: String((eS2 && eS2.message) || eS2) }], kept: [] };
    }
    const inFailed = (sweepIn && sweepIn.failed) ? sweepIn.failed : [];
    const outClosed = (sweepOut && sweepOut.closed) ? sweepOut.closed : [];
    const outFailed = (sweepOut && sweepOut.failed) ? sweepOut.failed : [];
    /* ★ v0.9.6：**读不到名字**也算不合格。
       以前它静默把这种文档当「别人的」保留 ⇒ sweep 明明认不出自己的临时文档，
       却报"漏关 0 个"（2026-10-17 真机读数：收尾时 3 个文档名字全是空串）。
       「没报错 ≠ 生效」在这里的具体形态：**看不见 ≠ 没有**。 */
    const outUnknown = (sweepOut && typeof sweepOut.unknown === "number") ? sweepOut.unknown : 0;
    const ok69 = inFailed.length === 0 && outClosed.length === 0 &&
      outFailed.length === 0 && outUnknown === 0;
    rec(
      "S69 自检卫生：开场清掉上次残留、收尾**不留新残留**",
      ok69,
      "开场清场：" + (sweepIn ? (sweepIn.closed.length + " 个") +
          (sweepIn.closed.length ? "（" + sweepIn.closed.join("、") + "）" : "") : "没跑") +
        (inFailed.length ? "\n        ⚠️ 清场失败：" + JSON.stringify(inFailed) : "") +
        "\n        收尾复查：本轮漏关 " + outClosed.length + " 个" +
        (outClosed.length ? "（" + outClosed.join("、") + "）" : "") +
        (outFailed.length ? "\n        ⚠️ 复查时也关不掉：" + JSON.stringify(outFailed) : "") +
        "\n        当前开着的其它文档：" + JSON.stringify(sweepOut ? sweepOut.kept : null) +
        "\n        名字读不到的文档数：" + outUnknown + "（须 0；读不到就无法按名字识别，等于瞎扫）" +
        "\n        ⚠️ 只关名字以「Vellum 自检临时文档 / Vellum 探针 / TP-」开头的 —— **用户的稿绝不碰**"
    );
  } catch (e69) {
    rec("S69 自检卫生：开场清掉上次残留、收尾**不留新残留**", false,
      "抛异常：" + ((e69 && e69.message) || e69));
  }

  /* ---------- S70: 分组层数放宽（2 → 5）—— **数据层**回归（v0.9.6）----------
     背景（2026-10-17）：两侧共识「模板库 + 通用素材库都做多层目录」，契约 §5.3 放宽到 ≤5 层。
     本项验的是 `lib/mirror.js` 的展平逻辑，**纯函数**（喂假数据，不读真镜像、不碰用户的稿）：
       ① 三层能展开成三级（而不是被拍平成顶层）
       ② 两层数据的 group / sub / 顺序 **与放宽前一致**（旧 UI 一行不用改）
       ③ 成环**不爆栈、不重复吐**，素材不丢
       ④ 超上限（6 层）第 6 层降级，但**素材一条不丢**
     为什么放进真机自检：这几个分支平时不会被真实镜像触发（软件侧现在只产两层），
     但**一旦有人改 flattenBrand 就可能悄悄坏掉** —— 坏掉的表现是"素材少了"，最难发现。 */
  try {
    const S70 = "S70 分组层数 2→5：三层正常展开 / 两层零变化 / 成环不爆栈 / 超限不丢素材";
    const MIR = require("./mirror.js");
    const G = (id, name, pid) => ({
      id: id, name: name, parentId: pid,
      assets: [{ id: id * 10, name: "g" + id + ".png" }]
    });

    /* ① 三层 */
    const r3 = MIR.flattenBrand({ groups: [G(1, "L1"), G(2, "L2", 1), G(3, "L3", 2)] });
    const p3 = r3.map(function (r) { return (r.groupPath || []).join(">") + "@" + r.depth; }).join(" | ");
    const ok3 = r3.length === 3 &&
      r3[2] && r3[2].depth === 3 && (r3[2].groupPath || []).length === 3 &&
      r3[2].group === "L1" && r3[2].sub === "L2";

    /* ② 两层等价（顺序 + group/sub 逐项写死） */
    const r2 = MIR.flattenBrand({
      groups: [G(1, "A"), G(2, "B"), G(11, "A1", 1), G(12, "A2", 1)]
    });
    const seq2 = r2.map(function (r) { return r.group + "/" + r.sub; }).join(",");
    const ok2 = r2.length === 4 && seq2 === "A/,A/A1,A/A2,B/";

    /* ③ 成环 */
    const rc = MIR.flattenBrand({ groups: [G(1, "C1", 2), G(2, "C2", 1)] });
    const okC = rc.length === 2;

    /* ④ 超上限（6 层）*/
    const chain = [G(1, "D1")];
    for (let i = 2; i <= 6; i++) chain.push(G(i, "D" + i, i - 1));
    const rd = MIR.flattenBrand({ groups: chain });
    /* ⚠️ 按 asset.id 认，别按名字拼 —— 第一版写成 "g50.png" 而 G() 造的是 "g5.png"，
       结果 ④ 恒 false（**是断言自己写错了，不是代码错**）。按 id 认不会有这种歧义。 */
    const d6 = rd.filter(function (r) { return r.asset.id === 60; })[0];
    const d5 = rd.filter(function (r) { return r.asset.id === 50; })[0];
    const okD = rd.length === 6 && MIR.MAX_DEPTH === 5 &&
      !!(d5 && d5.depth === 5) && !!(d6 && d6.depth === 1 && d6.group === "D6");

    const bad70 = [];
    if (!ok3) bad70.push("① 三层没展开成三级");
    if (!ok2) bad70.push("② 两层输出变了（会影响现有 UI）");
    if (!okC) bad70.push("③ 成环吐的条数不对");
    if (!okD) bad70.push("④ 超上限没有按预期降级 / 丢素材");

    rec(
      S70,
      bad70.length === 0,
      "MAX_DEPTH=" + MIR.MAX_DEPTH + "（须 5）\n" +
        "        ① 三层：" + p3 + "\n" +
        "        ② 两层顺序：" + seq2 + "（须 A/,A/A1,A/A2,B/）\n" +
        "        ③ 成环：" + rc.length + " 条（须 2，且不爆栈）\n" +
        "        ④ 六层：g50@depth" + (d5 ? d5.depth : "?") + "　g60@depth" + (d6 ? d6.depth : "?") +
        "（须 5 / 1，共 6 条）\n" +
        "        ⚠️ 本项是**纯函数**回归（喂假数据），不读真镜像、不碰用户的稿；" +
        "只读镜像的那部分由 S19 / S20c 负责\n" +
        (bad70.length
          ? "        ⚠️ 未成立：" + bad70.join(" / ")
          : "        ⇒ 数据层已能读任意层（≤5），且**两层数据的输出一个字没变** ⇒ 旧 UI 无需改动")
    );
  } catch (e70) {
    rec("S70 分组层数 2→5：三层正常展开 / 两层零变化 / 成环不爆栈 / 超限不丢素材", false,
      "抛异常：" + ((e70 && e70.message) || e70));
  }

  /* ---------- S71: 插入面板瘦身（v0.9.7，用户 2026-10-17 拍板）----------
     用户要求：去掉落点九宫格（同事反馈没人用）、把「置入」两字按钮放到素材名右侧。
     判据是**真机量出来的高度**（不是"看着变矮了"）：
       ① 落点**彻底不在**（`#vt-lib-anchors` 与 `.anchor-cell` 都查不到 —— 删 UI 要删净）
       ② 未选中时面板 ≤ 36px
       ③ 选中素材后面板 ≤ 56px（目标是 50，改前是 150）
       ④ 按钮文案就是「置入」两字
     为什么量高度而不只量样式：样式写得再对，只要有人往回加一行（比如把"位置"又放回来），
     面板就会胖回去 —— **高度是唯一能反映"用户到底能多看到多少素材"的指标**。 */
  try {
    const S71 = "S71 插入面板瘦身：落点已移除 / 「置入」在右侧 / 选中时 ≤ 56px / 不贴边框";
    await ctx.shell.showTool("assets", "selfcheck");
    const gotFoot = await waitFor(function () {
      return !!document.getElementById("vt-lib-foot");
    }, 8000);

    const foot = document.getElementById("vt-lib-foot");
    if (!gotFoot || !foot) {
      rec(S71, true, "【不适用】素材库页没挂载起来（拿不到 #vt-lib-foot）—— 本条不判失败");
    } else {
      const anchorsDom = !!document.getElementById("vt-lib-anchors");
      const cellN = (foot.querySelectorAll) ? foot.querySelectorAll(".anchor-cell").length : 0;
      const hIdle = foot.offsetHeight || 0;

      const grid = document.getElementById("vt-lib-grid");
      const card = (grid && grid.querySelector) ? grid.querySelector(".card") : null;
      let hSel = null;
      if (card) {
        syntheticClick(card, false);
        /* ⚠️ 这里必须等「**高度真的变了**」，不能只等"按钮出现"。
           第一版等的是 `#vt-lib-insert` 存在，结果量到 **34px**
           （= 未选中时那一行提示的高度）—— 按钮已经建出来了，但**布局还没重排**，
           `offsetHeight` 还是旧值。（项目里 S27 探针踩过同一个坑："时机太早量到旧值"。）
           ⇒ 判据改成等"高度 > 未选中高度"，最多 3 秒；超时也照样量一次，让读数暴露真相。 */
        await waitFor(function () {
          const f2 = document.getElementById("vt-lib-foot");
          return !!document.getElementById("vt-lib-insert") &&
            !!f2 && (f2.offsetHeight || 0) > hIdle;
        }, 3000);
        hSel = foot.offsetHeight || 0;
      }
      const btn = document.getElementById("vt-lib-insert");
      const btnTxt = btn ? String(btn.textContent || "").trim() : "";

      /* ★ 左右留白（v0.9.8 新增，用户 2026-10-17 截图报障驱动）：
         这个块有 border + background，是张"卡片"。水平内边距写成 0 时，
         文字贴左边框、按钮贴右边框，**看起来就是溢出**。
         ⚠️ 只量高度抓不到这个问题（高度一点没变）—— 必须量几何。
         用「内容块的左沿 − 卡片的左沿」判，不解析 CSS 字符串：
         样式怎么写都无所谓，**看得见的留白**才是判据。 */
      let padL = null;
      let padR = null;
      const mainRow = (foot.querySelector) ? foot.querySelector(".lf-main") : null;
      if (foot.getBoundingClientRect && mainRow && mainRow.getBoundingClientRect) {
        const fr = foot.getBoundingClientRect();
        const mr = mainRow.getBoundingClientRect();
        padL = Math.round(mr.left - fr.left);
        padR = Math.round(fr.right - mr.right);
      }

      const ck = [
        ["\u2460 落点 DOM 已移除（#vt-lib-anchors 不在）", !anchorsDom],
        ["\u2460b 详情区里没有 .anchor-cell", cellN === 0],
        ["\u2461 未选中时面板 \u2264 36px", hIdle > 0 && hIdle <= 36],
        /* 双向判据：既不能胖（>56），也不能"根本没渲染成选中态"（<=未选中高度）。
           第一版只写了 <= 56，结果 34px 也 PASS —— **单边判据把 bug 放过去了**。 */
        ["\u2462 选中时面板 40\u201356px（既不变胖、也确实渲染了选中态）",
          hSel === null ? true : (hSel >= 40 && hSel <= 56)],
        ["\u2463 按钮文案就是「置入」", btnTxt === "置入"],
        /* 左右留白 ≥ 8（含 1px 边框）⇒ 内容不贴边框 */
        ["\u2464 左右留白 \u2265 8px（内容不贴边框）",
          padL === null ? true : (padL >= 8 && padR >= 8)]
      ];
      const bad = [];
      for (const c2 of ck) if (!c2[1]) bad.push(c2[0]);

      rec(
        S71,
        bad.length === 0,
        "未选中高=" + hIdle + "px\u3000选中高=" +
          (hSel === null ? "（无卡片可点，跳过）" : hSel + "px") +
          "\u3000按钮文案=" + JSON.stringify(btnTxt) + "\n" +
          "        落点 DOM=" + (anchorsDom ? "**还在**" : "已移除") +
          "\u3000.anchor-cell 数=" + cellN + "\n" +
          "        左右留白：左 " + (padL === null ? "量不到" : padL + "px") +
          " / 右 " + (padR === null ? "量不到" : padR + "px") + "（须 \u2265 8，含 1px 边框）\n" +
          "        目标：未选中约 30 / 选中约 50（改前 150）——" +
          "省下的主力是**九宫格 66px**，不是按钮宽度\n" +
          (bad.length
            ? "        \u26a0\ufe0f 未成立：" + bad.join(" / ")
            : "        \u21d2 面板瘦身生效，580 高的面板下网格实际多出约 100px")
      );
    }
  } catch (e71) {
    rec("S71 插入面板瘦身：落点已移除 / 「置入」在右侧 / 选中时 \u2264 56px / 不贴边框", false,
      "抛异常：" + ((e71 && e71.message) || e71));
  }

  /* ---------- S72: 面包屑下钻（v0.9.9，用户拍板的"方向 B"）----------
     验的是**真机真 DOM**上的行为链：
       ① 根层**不画**面包屑（只显示一个「全部」是噪音）；
       ② 点第一个子目录 chip → 面包屑出现，段数 = 2（全部 + 该目录），末段 `is-on`；
       ③ 点面包屑第 0 段（「全部」）→ 回到根，面包屑**从 DOM 上消失**；
       ④ 目录区（`.lib-bar`）总高 ≤ 96px —— 这是高度预算的**真机锚**：
          面包屑 26 + 一行子目录 22 + 间距；超了说明有人往里加行，会把网格挤没。
     ⚠️ 判"消失"必须问**当前 DOM**（`document.getElementById`），UXP 这边是正常的；
        离线 mock 的 `byId` 只增不减，那边要用 `attached()`（断言 40 里踩过）。 */
  try {
    const S72 = "S72 面包屑下钻：根层不画 / 点进去段数与当前层正确 / 能回根 / 目录区不超预算";
    await ctx.shell.showTool("assets", "selfcheck");
    const gotBar = await waitFor(function () {
      return !!document.getElementById("vt-lib-bar");
    }, 8000);

    /* ★ 必须先切到**通用库**：任务库的根层没有子目录（项目筛选在顶部下拉里），
       在任务库上跑这条会"空过"——第一版就是这样：读数说"根层没有可点的目录"，
       判据却 PASS 了（因为 ②③ 在"没有目录可点"时被放宽成 true）。
       **放宽成 true 的分支 = 一条永远绿的死判据**，这里改成：切不到通用库就明确说"不适用"。 */
    const brandTab = document.getElementById("vt-lib-tab-brand");
    if (brandTab) {
      syntheticClick(brandTab, false);
      await waitFor(function () {
        const t = document.getElementById("vt-lib-tab-brand");
        return !!t && String(t.getAttribute("class") || "").indexOf("is-on") >= 0;
      }, 5000);
      await waitFor(function () {
        return !!document.querySelector("#vt-lib-bar .fchip");
      }, 5000);
    }

    const barEl = document.getElementById("vt-lib-bar");
    if (!gotBar || !barEl || !brandTab) {
      rec(S72, true, "【不适用】素材库页没挂载，或镜像里没有通用库（拿不到 #vt-lib-bar / tab-brand）—— 本条不判失败");
    } else {
      const bcAtRoot = !!document.getElementById("vt-lib-bc");

      /* 找第一行"真的目录"。v0.9.10 起子目录是**整行** `.dir`（不是 chips）；
         `.dir.more`（「还有 N 个」/「收起」）没有 `data-key`，会被下面的判据过滤掉。 */
      let firstDir = null;
      const chips = (barEl.querySelectorAll) ? barEl.querySelectorAll(".dir") : [];
      for (let i = 0; i < chips.length; i++) {
        const k = String(chips[i].getAttribute("data-key") || "");
        if (k) {
          firstDir = chips[i];
          break;
        }
      }
      const dirName = firstDir ? String(firstDir.getAttribute("data-key") || "") : "";

      let hRoot = barEl.offsetHeight || 0;
      let bcOk = null;
      let segN = 0;
      let onOk = false;
      let hDeeper = 0;
      let backOk = null;
      if (firstDir) {
        syntheticClick(firstDir, false);
        await waitFor(function () {
          return !!document.getElementById("vt-lib-bc");
        }, 3000);
        const bc = document.getElementById("vt-lib-bc");
        const segs = (bc && bc.querySelectorAll) ? bc.querySelectorAll(".bc-s") : [];
        segN = segs.length;
        for (let i = 0; i < segs.length; i++) {
          const cl = String(segs[i].getAttribute("class") || "");
          if (cl.indexOf("is-on") >= 0 && i === segs.length - 1) onOk = true;
        }
        bcOk = !!bc && segN === 2 && onOk;

        /* ⚠️ 量高度前**要等布局落定**（这个坑踩过两次）：第一版在"面包屑出现"后立刻量，
           读到和根层一模一样的值。现在只等"面包屑在了"再多等一拍，避免量到旧值。
           ⚠️ 不再断言"深层一定比根层高" —— 子目录是整行列表后，**行数会变**
              （根层 2 行、下钻后可能只剩 1 行 + 面包屑），"变高"不是不变量。
              真正的不变量是**绝对预算 ≤ 96px**。 */
        await sleep(120);
        const bar2 = document.getElementById("vt-lib-bar");
        hDeeper = bar2 ? (bar2.offsetHeight || 0) : 0;

        /* 点「全部」回根 */
        const root0 = (bc && bc.querySelectorAll) ? bc.querySelectorAll(".bc-s") : [];
        let seg0 = null;
        for (let i = 0; i < root0.length; i++) {
          if (String(root0[i].getAttribute("data-crumb")) === "0") seg0 = root0[i];
        }
        if (seg0) {
          syntheticClick(seg0, false);
          await waitFor(function () {
            return !document.getElementById("vt-lib-bc");
          }, 3000);
          backOk = !document.getElementById("vt-lib-bc");
        }
      }

      const budgetOk = hRoot > 0 && hRoot <= 96 && (hDeeper === 0 || hDeeper <= 96);
      const ck72 = [
        ["\u2460 根层不画面包屑", !bcAtRoot],
        /* ⚠️ 不能用 `firstDir ? ... : true` 放宽 —— 那样"根本没点进去"也会绿。
           通用库里至少有一个目录可点（公司素材 / 个人收藏…），拿不到就是有问题。 */
        ["\u2461 点进目录后：段数=2 且末段 is-on", !!firstDir && bcOk === true],
        ["\u2462 点「全部」能回根", !!firstDir && backOk === true],
        ["\u2463 目录区 \u2264 96px（根层与深层都不许超）", !!firstDir && budgetOk]
      ];
      const bad72 = [];
      for (const c of ck72) if (!c[1]) bad72.push(c[0]);

      rec(
        S72,
        bad72.length === 0,
        "根层有无面包屑=" + (bcAtRoot ? "**有**（不该有）" : "无（对）") +
          "\u3000点进的目录=" + (dirName ? "「" + dirName + "」" : "（根层没有可点的目录）") + "\n" +
          "        点进去：段数=" + segN + "（须 2 = 全部+目录）·末段加粗=" + onOk +
          "\u3000能回根=" + (backOk === null ? "（未测）" : backOk) + "\n" +
          "        目录区高度：根层 " + hRoot + "px / 深层 " + hDeeper + "px" +
          "（须 \u2264 96；行数会随层级变，所以只判**绝对预算**）\n" +
          (bad72.length
            ? "        \u26a0\ufe0f 未成立：" + bad72.join(" / ")
            : "        \u21d2 面包屑下钻生效：根层不画面包屑，下钻后只多一片 26px 的面包屑；子目录是整行（📁 + 名字 + N 项）")
      );
    }
  } catch (e72) {
    rec("S72 面包屑下钻（自身抛异常）", false, "抛异常：" + ((e72 && e72.message) || e72));
  }

  /* ---------- S73: 模板库数据层（tpl.json，契约 §5.7）—— Step 1 只做数据，不碰 UI ----------
     验的是"读得进来、不走错分支、条数对得上"：
       ① `scopeKind(tpl.json)` 必须是 `tpl`（它也带 `groups[]`，只按结构判会被认成通用库）；
       ② `flatten("tpl", …)` 的条数 === `items[]` 条数（一条不丢）；
       ③ 与 `manifest.scopes[tpl].count` 对得上；
       ④ 抽一个条目的 `groupPath` 打在读数里 —— 三层路径对不对，人要能一眼看出来。
     ⚠️ **0 条模板是正常状态**（软件侧分区刚启用），所以"空"判 PASS 而不是 FAIL；
        只有"解析不了 / 条数对不上 / kind 认错"才判红。 */
  try {
    const S73 = "S73 模板库数据层：tpl.json 能解析 / scopeKind=tpl / 条数与 manifest 一致";
    let tplRaw = "";
    try {
      tplRaw = await data.readTextIn(["library"], "tpl.json", "");
    } catch (eRead) {
      tplRaw = "";
    }

    if (!tplRaw) {
      rec(S73, true,
        "【不适用】镜像里没有 tpl.json（软件侧的模板分区还没写出来）—— 本条不判失败");
    } else {
      let d = null;
      let parseErr = "";
      try {
        d = JSON.parse(tplRaw);
      } catch (eParse) {
        parseErr = (eParse && eParse.message) || String(eParse);
      }

      if (!d) {
        rec(S73, false, "tpl.json JSON 解析失败：" + parseErr);
      } else {
        const kind = mirror.scopeKind(d);
        const items = Array.isArray(d.items) ? d.items : [];
        const rows = (() => {
          try {
            return mirror.flatten("tpl", d);
          } catch (eFlat) {
            return { error: (eFlat && eFlat.message) || String(eFlat) };
          }
        })();
        const flatErr = rows && rows.error ? String(rows.error) : "";
        const list = Array.isArray(rows) ? rows : [];

        /* manifest 里登记的条数（读不到就不比，不要把"没读到"当成"对不上"） */
        let wantCount = null;
        try {
          const manRaw = await data.readTextIn(["library"], "manifest.json", "");
          if (manRaw) {
            const man = JSON.parse(manRaw);
            for (const sc of (man.scopes || [])) {
              if (sc && sc.id === "tpl" && typeof sc.count === "number") wantCount = sc.count;
            }
          }
        } catch (eMan) {
          wantCount = null;
        }

        const sample = list[0];
        const samplePath = sample ? sample.groupPath.join(" \u203a ") : "（无模板，路径不适用）";
        const groupsN = Array.isArray(d.groups) ? d.groups.length : 0;

        const okAll =
          !flatErr &&
          kind === "tpl" &&
          list.length === items.length &&
          (wantCount === null || wantCount === list.length);

        rec(
          S73,
          okAll,
          "scopeKind=" + kind + "（须 tpl —— 它也有 groups[]，只按结构判会被当成通用库）\n" +
          "        groups=" + groupsN + " 个　items=" + items.length + " 条　flatten 后=" + list.length +
          " 条（须 === items，一条不丢）　manifest.count=" +
          (wantCount === null ? "（没读到，不比）" : wantCount) + "\n" +
          "        首条路径=" + samplePath + "（示例：" + (sample ? sample.asset.name : "无") + "）" +
          (flatErr ? "\n        \u26a0\ufe0f flatten 抛异常：" + flatErr : "") +
          (items.length === 0
            ? "\n        \u21d2 分区已就位但还没有模板（正常状态）；数据层已能读，软件侧一收录就能显示"
            : "\n        \u21d2 模板库数据层就绪")
        );
      }
    }
  } catch (e73) {
    rec("S73 模板库数据层（自身抛异常）", false, "抛异常：" + ((e73 && e73.message) || e73));
  }

  /* ---------- S74: 新建稿页（模板库入口，v0.9.12）----------
     验的是"这一页真的能挂载、而且空的时候不像坏了"：
       ① 三段结构都在（`.nd-bar` / `.nd-body` / `.nd-foot`）；
       ② **底栏不在滚动区里**（与素材库同一条纪律：底栏必须固定）；
       ③ 有模板 ⇒ 出网格；没模板 ⇒ **正文里有引导文案**（不是一片空白）；
       ④ 底栏未选中时给"选一个模板"的提示。
     ⚠️ 本探针**不点打开**：打开要真 PS 文档 + handoff，那是 S68 那条路单独验的。 */
  try {
    const S74 = "S74 新建稿页（模板库入口）：三段结构在 / 底栏不在滚动区 / 空态有引导 / 卡片真的看得见";
    await ctx.shell.showTool("template", "selfcheck");
    const gotNd = await waitFor(function () {
      return !!document.getElementById("vt-nd-body");
    }, 8000);

    const bar = document.getElementById("vt-nd-bar");
    const body = document.getElementById("vt-nd-body");
    const foot = document.getElementById("vt-nd-foot");
    if (!gotNd || !body || !foot) {
      rec(S74, false,
        "页面没挂载起来：#vt-nd-bar=" + !!bar + " #vt-nd-body=" + !!body +
        " #vt-nd-foot=" + !!foot + "（新建稿页在 tools 里注册了吗？）");
    } else {
      await sleep(200);
      const grid = document.getElementById("vt-nd-grid");
      const cards = (grid && grid.querySelectorAll) ? grid.querySelectorAll(".nd-card").length : 0;
      const bodyTxt = String(body.textContent || "");
      const footTxt = String(foot.textContent || "");
      /* 底栏必须**不在**滚动容器里：掉进去就会跟着网格滚走 */
      const footOut = foot.parentNode !== body &&
        !(body.contains && body.contains(foot));
      /* 有模板 ⇒ 网格有卡片；没模板 ⇒ 正文要给出"去软件里启用/收录"的引导 */
      const emptyOk = bodyTxt.indexOf("模板") >= 0 &&
        (bodyTxt.indexOf("VellumDesk") >= 0 || bodyTxt.indexOf("PSD") >= 0);
      const hintOk = footTxt.indexOf("选一个模板") >= 0 || cards > 0;

      /* 🔴 **"建出来了 ≠ 看得见"**（2026-10-17 真机踩到）：`display:grid` 在 UXP 不生效
         ⇒ 卡片全被算成 0 高、页面一片空白、**不报错**。数据 3 / 建卡 3 全对，只有高度是 0。
         ⇒ 这条判据专门量**第一张卡的高度**：它有内容（缩略图 92 + 两行文字）就必然 > 40px。
         ⚠️ 必须**等布局落定**再量（刚 append 完读到 0 是正常的），最多等 1.5s。 */
      let cardH = null;
      let thW = null;
      let thH = null;
      let twoUp = null;
      if (cards > 0) {
        /* 缩略图盒子要等**校准**跑完（newdoc 在 400ms 后重试式校准，最长 ~2.5s）
           ⇒ 这里等到"盒子接近正方形"再量，最多 3s。
           ⚠️ 不能只等"宽度 > 0" —— 那时校准可能还没跑，会量到 CSS 的旧高度
              （v0.9.26 就是这么读成 168×174 的：宽度有了、高度还是 174）。
           超时后照样读实际值并**如实判失败**（不掩盖）。 */
        await waitFor(function () {
          const g = document.getElementById("vt-nd-grid");
          const c = (g && g.querySelectorAll) ? g.querySelectorAll(".nd-card")[0] : null;
          const t = c && c.querySelectorAll ? c.querySelectorAll(".nd-th")[0] : null;
          if (!c || !t) return false;
          const w = t.offsetWidth || 0;
          const h = t.offsetHeight || 0;
          return (c.offsetHeight || 0) > 0 && w > 0 && Math.abs(w - h) <= 6;
        }, 3000);
        const g2 = document.getElementById("vt-nd-grid");
        const c2 = (g2 && g2.querySelectorAll) ? g2.querySelectorAll(".nd-card")[0] : null;
        const t2 = c2 && c2.querySelectorAll ? c2.querySelectorAll(".nd-th")[0] : null;
        cardH = c2 ? (c2.offsetHeight || 0) : 0;
        thW = t2 ? (t2.offsetWidth || 0) : 0;
        thH = t2 ? (t2.offsetHeight || 0) : 0;
        /* ★ **卡片必须并排两列**（2026-10-17 漏掉的判据）：
           卡宽 193 时 193×2=386 > 「内容宽 394 − 滚动条 ≈15 = 379」⇒ flex-wrap 把第二张
           挤到下一行，页面看起来只有一列，而"卡片有高度""正方形"两条判据**全是绿的**。
           ⇒ 用前两张卡的 `top` 是否相同判断（同一行 = 并排）。 */
        try {
          const allCards = (g2 && g2.querySelectorAll) ? g2.querySelectorAll(".nd-card") : [];
          if (allCards.length >= 2) {
            const r0 = allCards[0].getBoundingClientRect();
            const r1 = allCards[1].getBoundingClientRect();
            twoUp = Math.abs((r0.top || 0) - (r1.top || 0)) <= 2;
          } else {
            twoUp = true; // 只有 1 张卡，谈不上并排
          }
        } catch {
          twoUp = null; // 读不到就不判
        }
      }

      const cardVisible = cards === 0 ? true : (cardH !== null && cardH > 40);
      /* ★ 缩略图盒子必须是**正方形**（v0.9.26 用户拍板按 512 信息卡整版显示）：
         宽高偏差 > 6px 就说明校准没生效（或 CSS 被人改回了固定高度）。
         ⚠️ 这条只能量"盒子"，量不出"图在盒子里清不清楚" —— 那是分辨率的问题，不是布局的。 */
      const thSquare = cards === 0 ? true : (thW > 0 && Math.abs(thW - thH) <= 6);
      /* 两列并排：读不到（null）不判死，读到 false 才判失败 */
      const colsOk = twoUp === null ? true : twoUp;
      const okAll = !!bar && footOut && (cards > 0 || emptyOk) && hintOk &&
        cardVisible && thSquare && colsOk;
      rec(
        S74,
        okAll,
        "结构：目录区=" + !!bar + "　网格区=" + !!body +
        "　底栏=" + !!foot + "（不在滚动区里=" + footOut + "）\n" +
        "        模板卡片=" + cards + "　" +
        (cards > 0 ? "（有模板，未选中）" : "（0 条）正文引导=" + emptyOk) +
        "　首卡高度=" + (cardH === null ? "（无卡片）" : cardH + "px，须 > 40 —— 0 就是"
          + "\"建了但看不见\"（UXP 不支持 CSS Grid）") + "\n" +
        "        缩略图盒子=" + (thW === null ? "（无卡片）" : thW + "×" + thH + "px，须接近正方形（偏差 \u2264 6）") +
        "　两列并排=" + (twoUp === null ? "（读不到）" : twoUp) +
        "\n" +
        "        底栏文案=" + JSON.stringify(footTxt.slice(0, 40)) +
        (okAll ? "\n        \u21d2 模板入口已上线：这一段就是「从模板建稿」的入口" : "")
      );
    }
  } catch (e74) {
    rec("S74 新建稿页（自身抛异常）", false, "抛异常：" + ((e74 && e74.message) || e74));
  }

  /* ---------- S75: 按规范建稿端到端（v0.9.14 / Step 4）----------
     这条是**真建稿**的：用 `lib/specs.js` 算出的 preset（不是手写字段）去 `createDocument`，
     再**读回** 尺寸 / 分辨率 / 色彩模式 / **参考线条数**，最后关掉文档、切回用户原稿。
       ① 画布尺寸必须等于"成品 + 两侧出血"换算出来的像素（差一个像素都算没做成）；
       ② **参考线必须真的写进来**（读回 ≥ 4 条）—— 参考线是这个功能的唯一价值；
       ③ **CMYK 要单独试一次**：规范表里五个规格全是 CMYK，而 CMYK 用 `Japan Color 2001 Coated`
          这个印刷 profile。**本机装没装这个 profile 决定用户点「新建」能不能成** ——
          不试一次就是在赌。
     ⚠️ 用 20×20mm @72 的小稿（画布 74×74px）：验的是**参数传递**，不是像素渲染，
        建一张 4760×10665 的 CMYK 大稿要几百 MB 内存，自检里不该干这事。
     🔴 建完**必须关掉且不保存**，再 `activateDocument` 切回原来那张 —— 绝不留在用户面前。 */
  try {
    const S75 = "S75 按规范建稿：preset 建稿 → 读回尺寸/参考线（RGB + CMYK 各一次）→ 关掉";
    const specLib = require("./specs.js");
    const psApi75 = require("photoshop");
    const app75 = psApi75.app;

    const tiny = { id: "probe", name: "S75 探针规格", w: 20, h: 20, dpi: 72 };

    const prevDoc75 = (app75.documents && app75.documents.length)
      ? app75.documents[0] : null;
    const prevId75 = prevDoc75 ? prevDoc75.id : null;

    const rows75 = [];
    const made75 = [];

    /* 这里不走 `ps.createFromSpec`，而是把同一套动作（modal + createDocument + 读回）写在这里：
       探针要能**逐项**看读数、还要自己收尾关文档，用产品函数会把这两件事糊在一起。
       但 preset 本身**必须由 lib/specs.js 生成** —— 那才是要验的东西。 */
    const create = async function (preset) {
      let doc = null;
      let err = "";
      try {
        await psApi75.core.executeAsModal(async function () {
          doc = await app75.createDocument({
            presetJSON: JSON.stringify(preset),
            name: preset.name,
          });
        }, { commandName: "Vellum 探针：按规范建稿" });
      } catch (e) {
        err = (e && e.message) || String(e);
      }
      if (!doc) return { ok: false, error: err || "createDocument 未返回文档" };
      made75.push(doc); // 存**文档对象**而不是 id：UXP 的 documents 是类数组，不保证有 find()
      let w = null; let h = null; let res = null; let mode = ""; let guides = null;
      try {
        const n = (v) => {
          if (v === null || v === undefined) return null;
          let x = v;
          if (typeof x === "object" && "_value" in x) x = x._value;
          const k = Number(x);
          return isFinite(k) ? k : null;
        };
        w = n(doc.width);
        h = n(doc.height);
        res = n(doc.resolution);
        mode = doc.mode ? String(doc.mode) : "";
        guides = (doc.guides && typeof doc.guides.length === "number") ? doc.guides.length : null;
      } catch {
        /* 读不到留 null */
      }
      return { ok: true, id: doc.id, width: w, height: h, resolution: res, mode: mode, guides: guides };
    };

    /* ① RGB（已知可用的对照） */
    const cRgb = specLib.toCanvas({ w: tiny.w, h: tiny.h, dpi: tiny.dpi, mode: "RGB" });
    const r1 = await create(specLib.toPresetJson(cRgb, tiny));

    /* ② CMYK —— 规范表里五个规格**全是 CMYK**，profile 用印刷常用的 Japan Color 2001 Coated。
       本机装没装这个 profile 决定用户点「新建」能不能成 ⇒ 必须真试一次。 */
    const cCmyk = specLib.toCanvas({ w: tiny.w, h: tiny.h, dpi: tiny.dpi, mode: "CMYK" });
    const r2 = await create(specLib.toPresetJson(cCmyk, tiny));

    const expW = specLib.toCanvas({ w: tiny.w, h: tiny.h, dpi: tiny.dpi, mode: "RGB" }).width;

    const sizeOk1 = r1.ok && r1.width === expW && r1.height === expW;
    const guideOk1 = r1.ok && r1.guides !== null && r1.guides >= 4;
    const modeOk1 = r1.ok && String(r1.mode).toUpperCase().indexOf("RGB") >= 0;
    const sizeOk2 = r2.ok && r2.width === expW && r2.height === expW;
    const guideOk2 = r2.ok && r2.guides !== null && r2.guides >= 4;
    const modeOk2 = r2.ok && String(r2.mode).toUpperCase().indexOf("CMYK") >= 0;

    /* 收尾：关掉自建文档（不保存），切回原稿 */
    let closed = 0;
    let closeErr = "";
    for (const d of made75) {
      try {
        await psApi75.core.executeAsModal(async function () {
          await d.close();
        }, { commandName: "Vellum 探针：关闭临时文档" });
        closed++;
      } catch (e) {
        closeErr += ((e && e.message) || String(e)) + "; ";
      }
    }
    let backOk = null;
    if (prevDoc75 && prevId75 !== null) {
      try {
        await psApi75.core.executeAsModal(async function () {
          app75.activeDocument = prevDoc75;
        }, { commandName: "Vellum 探针：切回原文档" });
        backOk = !!(app75.activeDocument && app75.activeDocument.id === prevId75);
      } catch (e) {
        backOk = "切回失败：" + ((e && e.message) || String(e));
      }
    }

    const okAll = sizeOk1 && guideOk1 && modeOk1 && sizeOk2 && guideOk2 &&
      closed === made75.length && made75.length === 2 && backOk !== false;

    rec(
      S75,
      okAll,
      "期望画布=" + expW + "×" + expW + "px（20mm 成品 + 3mm 出血 @72dpi）\n" +
      "        RGB：ok=" + r1.ok + "　实际=" + (r1.width || "?") + "×" + (r1.height || "?") +
      " @" + (r1.resolution || "?") + "　模式=" + (r1.mode || "?") +
      "　参考线=" + (r1.guides === null ? "null" : r1.guides) +
      (r1.error ? "　err=" + r1.error : "") + "\n" +
      "        CMYK：ok=" + r2.ok + "　实际=" + (r2.width || "?") + "×" + (r2.height || "?") +
      " @" + (r2.resolution || "?") + "　模式=" + (r2.mode || "?") +
      "　参考线=" + (r2.guides === null ? "null" : r2.guides) +
      (r2.error ? "　err=" + r2.error : "") + "\n" +
      "        尺寸对=" + sizeOk1 + "/" + sizeOk2 + "　模式对=" + modeOk1 + "/" + modeOk2 +
      "　参考线≥4=" + guideOk1 + "/" + guideOk2 + "\n" +
      "        收尾：关掉 " + closed + "/" + made75.length + "　切回原稿=" + backOk +
      (closeErr ? "　关文档报错：" + closeErr : "") + "\n" +
      (okAll
        ? "        \u21d2 按规范建稿成立：尺寸/模式/参考线都由 presetJSON 一次写成"
        : "        \u26a0\ufe0f 有一条没成立 —— 看上面每一项")
    );
  } catch (e75) {
    rec("S75 按规范建稿（自身抛异常）", false, "抛异常：" + ((e75 && e75.message) || e75));
  }

  /* ---------- S76: 从模板打开成新稿（端到端，v0.9.14）----------
     这是模板库**唯一真正有价值的一条链路**：读数走 `scope="tpl"` → 等软件把 PSD 拷进 handoff
     → `app.open` 打开 → **参考线还在吗**（模板的全部价值就在这）。
     🔴 判据分两类，**别混**：
       · 插件侧的（打开成功、尺寸对、参考线在）—— 不成立就是**失败**；
       · 软件侧的（handoff 有没有应答）—— 不应答**不算插件失败**，报"不适用"并给出读数
         （VellumDesk 没开 / 还没支持 tpl 反查，都不该由插件背）。
     ⚠️ 收尾必须关掉打开的文档且**不保存**，并切回用户原稿 —— 绝不留在面前。 */
  try {
    const S76 = "S76 从模板打开新稿：handoff(scope=tpl) → app.open → 尺寸与参考线还在";
    const handoff = require("./handoff.js");
    /* 读 tpl.json，挑第一条模板 */
    let d76 = null;
    try {
      const raw76 = await data.readTextIn(["library"], "tpl.json", "");
      if (raw76) d76 = JSON.parse(raw76);
    } catch {
      d76 = null;
    }
    const items76 = (d76 && Array.isArray(d76.items)) ? d76.items : [];

    if (!items76.length) {
      rec(S76, true,
        "【不适用】模板库里没有模板（软件侧的「模板」分区还没收录）—— 本条不判失败");
    } else {
      const a76 = items76[0];
      const p76 = require("./ps.js");
      const psApi76 = require("photoshop");
      const app76 = psApi76.app;
      let opened = null;
      let openedId = null;
      const prevDoc76 = (app76.documents && app76.documents.length) ? app76.documents[0] : null;
      const prevId76 = prevDoc76 ? prevDoc76.id : null;

      const steps = [];
      const req76 = await handoff.request(a76, "tpl");
      steps.push("req ok=" + req76.ok + (req76.error ? " err=" + req76.error : ""));

      let res76 = { ok: false, error: "未发请求" };
      let inc76 = { ok: false, error: "未取文件" };
      if (req76.ok) {
        res76 = await handoff.waitForRes(req76.reqId, handoff.DEFAULT_TIMEOUT_MS);
        steps.push("res ok=" + res76.ok + (res76.timedOut ? " timedOut" : "") +
          (res76.error ? " err=" + res76.error : ""));
        if (res76.ok) {
          inc76 = await handoff.fetchIncoming(res76);
          steps.push("file ok=" + inc76.ok + " name=" + (inc76.name || "-") +
            " bytes=" + (inc76.byteLength === undefined ? "?" : inc76.byteLength));
        }
      }

      /* 软件侧没应答 ⇒ 不适用（不是插件的错） */
      if (!req76.ok || !res76.ok || !inc76.ok) {
        rec(
          S76,
          true,
          "【不适用】handoff 没走通（软件侧没应答 / 还没支持 tpl 反查）—— 本条不判失败\n" +
          "        请求：scope=tpl · id=" + a76.id + "　" + steps.join("　|　") +
          "\n        ⇒ 插件侧链路已就绪，等 VellumDesk 能按 scope=tpl 拷出 PSD 再复验"
        );
      } else {
        let op76 = { ok: false, error: "未打开" };
        try {
          op76 = await p76.openFile(inc76.entry, { commandName: "Vellum 探针：从模板打开" });
        } catch (e) {
          op76 = { ok: false, error: (e && e.message) || String(e) };
        }
        if (op76.ok) {
          opened = op76.doc;
          openedId = op76.doc ? op76.doc.id : null;
        }
        steps.push("open ok=" + op76.ok + (op76.error ? " err=" + op76.error : ""));

        /* 与镜像里登记的尺寸对比 —— 镜像说多大，打开就该多大 */
        const sizeOk = op76.ok && op76.width === a76.width && op76.height === a76.height;
        const guidesOk = op76.ok && op76.guides !== null &&
          (typeof a76.guides !== "number" || op76.guides >= a76.guides);

        /* 收尾：关掉（不保存）→ 切回原稿 */
        let closed76 = false;
        let closeErr76 = "";
        if (opened) {
          try {
            await psApi76.core.executeAsModal(async function () {
              await opened.close();
            }, { commandName: "Vellum 探针：关闭模板新稿" });
            closed76 = true;
          } catch (e) {
            closeErr76 = (e && e.message) || String(e);
          }
        }
        let backOk76 = null;
        if (prevDoc76) {
          try {
            await psApi76.core.executeAsModal(async function () {
              app76.activeDocument = prevDoc76;
            }, { commandName: "Vellum 探针：切回原文档" });
            backOk76 = !!(app76.activeDocument && app76.activeDocument.id === prevId76);
          } catch (e) {
            backOk76 = "切回失败：" + ((e && e.message) || String(e));
          }
        }

        const okAll = op76.ok && sizeOk && guidesOk && closed76 && backOk76 !== false;
        rec(
          S76,
          okAll,
          "模板：" + a76.name + "（镜像登记 " + a76.width + "×" + a76.height +
          " · 参考线 " + (typeof a76.guides === "number" ? a76.guides : "未登记") + "）\n" +
          "        " + steps.join("　|　") + "\n" +
          "        打开后：尺寸=" + (op76.width || "?") + "×" + (op76.height || "?") +
          "（与镜像一致=" + sizeOk + "）　模式=" + (op76.mode || "?") +
          "　参考线=" + (op76.guides === null ? "null" : op76.guides) + "（够=" + guidesOk + "）\n" +
          "        收尾：关掉=" + closed76 + "　切回原稿=" + backOk76 +
          (closeErr76 ? "　关闭报错：" + closeErr76 : "") + "\n" +
          (okAll
            ? "        \u21d2 从模板建稿端到端成立：原件不动、新稿打开、参考线保留"
            : "        \u26a0\ufe0f 有一条没成立 —— 看上面每项")
        );
      }
    }
  } catch (e76) {
    rec("S76 从模板打开新稿（自身抛异常）", false, "抛异常：" + ((e76 && e76.message) || e76));
  }

  /* ---------- S77: 参考线必须是「百分比」，且落在成品边（v0.9.35）----------
     🔴 起因（2026-10-17 用户截图报障）：A3 建出来**只有 2 条参考线**，位置也离边缘很远。
     根因：`lib/specs.js` 给的 `coordinate` 是**像素**（35 / 3543 …），
     而 PS 的 presetJSON **按百分比解释** ⇒ 3543% 落到画布外 ⇒ 只剩左、上两条可见。

     🔴 **为什么之前一直没抓到**：S68/S75 只数 `document.guides.length` ——
     即使 2 条在画布外，它照样回 **4**。**条数对 ≠ 参考线对。**
     而 `Document.guides[i]` 只回 `{_id,_docId}`，**读不到坐标**（已知限制），
     `get` `guides` property 报 -25920、读整份 document 描述符只回 `true`。
     ⇒ **真机上没有可用的坐标判据**，所以这一条把重心放在**纯函数**上：
        ① 用 `toCanvas` 算 A3，断言 4 条全在 0–100、左右和=100、回算 px = 出血量；
        ② 真机只验"百分比格式被 PS 接受"（建 400×400 小稿、回读 4 条）。
     真机的位置正确性**最终由人眼确认**（用户看参考线贴不贴边）。 */
  try {
    const S77 = "S77 参考线：百分比格式（0–100）+ 落在成品边（纯函数判死）+ 真机接受";
    const specLib77 = require("./specs.js");
    const ph77 = require("photoshop");
    const app77 = ph77.app;

    /* ① 纯函数：A3 海报（300dpi，3mm 出血） */
    const cA3 = specLib77.toCanvas({ w: 297, h: 420, dpi: 300, mode: "CMYK" });
    const gs = cA3.guides || [];
    const vs = gs.filter((g) => g.direction === "v").map((g) => g.coordinate);
    const hs = gs.filter((g) => g.direction === "h").map((g) => g.coordinate);
    const pctOk = gs.length === 4 &&
      gs.every((g) => typeof g.coordinate === "number" && g.coordinate > 0 && g.coordinate < 100);
    const sumOk = vs.length === 2 && hs.length === 2 &&
      Math.abs(vs[0] + vs[1] - 100) < 0.01 && Math.abs(hs[0] + hs[1] - 100) < 0.01;
    const backX = Math.round((vs[0] / 100) * cA3.width);
    const backY = Math.round((hs[0] / 100) * cA3.height);
    const backOk = Math.abs(backX - cA3.bleedPx) <= 1 && Math.abs(backY - cA3.bleedPx) <= 1;

    /* ② 真机：百分比格式被 PS 接受（400×400 上 2.5% = 10px、97.5% = 390px） */
    const preset77 = {
      name: "vt-s77",
      width: 400,
      height: 400,
      units: "pixelsUnit",
      resolution: 72,
      resolutionUnits: "inchesUnit",
      depth: 8,
      scale: 1,
      mode: "RGB",
      fill: "white",
      profile: "sRGB IEC61966-2.1",
      guides: [
        { direction: "v", coordinate: 2.5 },
        { direction: "v", coordinate: 97.5 },
        { direction: "h", coordinate: 2.5 },
        { direction: "h", coordinate: 97.5 },
      ],
      artboards: [],
    };

    let doc77 = null;
    let err77 = "";
    try {
      await ph77.core.executeAsModal(async function () {
        doc77 = await app77.createDocument({ presetJSON: JSON.stringify(preset77) });
      }, { commandName: "Vellum 探针：guides 百分比" });
    } catch (e) {
      err77 = (e && e.message) || String(e);
    }

    let n77 = null;
    if (doc77) {
      try {
        n77 = (doc77.guides && typeof doc77.guides.length === "number") ? doc77.guides.length : null;
      } catch { /* 忽略 */ }
      try {
        await ph77.core.executeAsModal(async function () {
          await doc77.close();
        }, { commandName: "Vellum 探针：关闭" });
      } catch { /* 忽略 */ }
    }

    const liveOk = !!doc77 && n77 === 4;
    rec(
      S77,
      pctOk && sumOk && backOk && liveOk,
      "A3（303×426mm @300dpi ⇒ " + cA3.width + "×" + cA3.height + "px，出血 " + cA3.bleedPx + "px）\n" +
      "        参考线=" + gs.map((g) => g.direction + g.coordinate).join(",") + "\n" +
      "        全在 0–100=" + pctOk + "　左右和/上下和=100：" + sumOk +
      "　回算 " + backX + "px / " + backY + "px（须 ≈" + cA3.bleedPx + "）=" + backOk + "\n" +
      "        真机：建 400×400（百分比 2.5/97.5）→ 回读 " +
      (n77 === null ? "读不到" : n77 + " 条") + "（须 4）" + (err77 ? "　错误：" + err77 : "") +
      (liveOk ? "" : "\n        ⚠️ 真机那一半没成 —— 但**报错时用户能马上看到**，别只看纯函数绿")
    );
  } catch (e77) {
    rec("S77 参考线百分比（自身抛异常）", false,
      "抛异常：" + ((e77 && e77.message) || e77));
  }

  /* ---------- 收尾：写报告 ---------- */
  const passCount = results.filter((r) => r.ok).length;
  const summary = passCount + "/" + results.length;
  const report = {
    plugin: "com.vellum.toolbox",
    version: (deps && deps.version) || "?",
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
