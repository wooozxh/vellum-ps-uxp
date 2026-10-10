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

  /* ---------- S19: 镜像读取层（M2 素材库地基） ----------
     v0.2.5 首版验的是「到底能不能读」；这一版改为验**契约读取层本身** ——
     因为 `lib/mirror.js` 要按契约 `vellum-link/1` 解析三个 JSON（manifest/task/brand），
     而之前的假镜像是我自拟的简化结构，两者必须对齐才测得准。

     判据：
       ① `readManifest()` 成功且 `contract === "vellum-link/1"`（不认识要**降级**，不能崩）
       ② `readScope("task")` + `flatten` 出 2 条素材；`brand` 出 3 条
       ③ 缩略图经 `thumbUrl()` → objectURL → `<img>`，**容器可见**，naturalWidth > 0
       ④ **webp 防御**：读到 `.webp` 必须给**可读错误**（UXP 不解码 webp，别让 UI 出一堆空白格）

     ⚠️ 本项**不碰 PS 文档**，纯 UXP storage + DOM，所以没有临时文档要收尾。
     假镜像由 `tools/fake-vellumdesk.cjs`（契约 §11 要求的插件侧桩）生成。 */
  const S19 = "S19 镜像读取层 —— manifest/task/brand 解析 + 缩略图渲染（契约 vellum-link/1）";
  let s19Holder = null;
  try {
    // ① 总索引
    const m = await mirror.readManifest();

    // ② 两个 scope 的解析 + 展平
    let taskRows = 0;
    let brandRows = 0;
    let taskRev = null;
    let firstRow = null;
    let taskErr = null;
    let brandErr = null;
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

      const bs = m.scopes.filter((s) => s.id === "brand")[0];
      if (bs) {
        const r = await mirror.readScope(bs);
        if (r.ok) brandRows = mirror.flatten("brand", r.data).length;
        else brandErr = r.error;
      } else brandErr = "总索引里没有 brand scope";
    }

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

    rec(
      S19,
      m.ok && taskRows === 2 && brandRows === 3 && renderOk && !!guard.webp,
      "契约=" + (m.ok ? m.manifest.contract + " ✓" : "✗ " + m.error) +
      "　scopes=[" + (m.scopes || []).map((s) => s.id + ":rev" + s.revision).join(" ") + "]" +
      "　任务库=" + taskRows + " 条" + (taskErr ? " ✗ " + taskErr : "") +
      "　通用库=" + brandRows + " 条" + (brandErr ? " ✗ " + brandErr : "") +
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

    // 独立数一遍：递归找「asset 形状」的对象（有 id + name + ext），不依赖 mirror.js
    const countAssetsDeep = (node) => {
      let n = 0;
      const walk = (x) => {
        if (!x || typeof x !== "object") return;
        if (Array.isArray(x)) {
          for (const it of x) walk(it);
          return;
        }
        if (
          typeof x.id === "number" &&
          typeof x.name === "string" &&
          typeof x.ext === "string"
        ) {
          n++;
          return; // asset 内部不再往下找
        }
        for (const k of Object.keys(x)) walk(x[k]);
      };
      walk(node);
      return n;
    };

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
      await waitFor(() => {
        const g = document.getElementById("vt-lib-grid");
        if (!g) return null;
        const imgs = collectImgs(g, []);
        if (!imgs.length) return null;
        for (const im of imgs) {
          if (!im.naturalWidth) return null;
        }
        return imgs;
      }, 8000, 250);

      const grid = document.getElementById("vt-lib-grid");
      const cards = grid ? grid.children.length : 0;
      const imgs = grid ? collectImgs(grid, []) : [];
      let loaded = 0;
      for (const im of imgs) if (im.naturalWidth > 0) loaded++;

      // 点第一张卡 → 详情行必须出现这个文件
      let detailOk = false;
      let firstName = "";
      if (grid && grid.children.length) {
        const c0 = grid.children[0];
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
        "　筛选行元素=" + (barEl ? barEl.children.length : 0) +
        "　卡片=" + cards + "（自数期望 " + expect + "）" +
        "　缩略图 " + loaded + "/" + imgs.length + " 解出尺寸" +
        "　详情行含「" + firstName + "」=" + detailOk
      );

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
          const g2 = await waitFor(() => {
            const onChip = document.getElementById("vt-lib-tab-" + other.id);
            const cls = onChip ? String(onChip.getAttribute("class") || "") : "";
            if (cls.indexOf("is-on") < 0) return null;
            const el = document.getElementById("vt-lib-grid");
            if (!el || el.children.length !== expect2) return null;
            return el;
          }, 6000, 200);
          const c2 = g2 ? g2.children.length : 0;
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

  /* ---------- S21: 置入（placeEvent + 会话令牌）（v0.2.7 新增） ----------
     本项目第一次用 `placeEvent`。判据是**图层数增加**，不是"命令没报错"。
     ⚠️ 第一版（21:32）传的是**裸路径** → `Error: invalid file token used`
        ⇒ Photoshop 的 AM 层要的是 UXP **授权过的文件令牌**，不是路径。
        这条直接判了「按 absPath 直连置入」死刑，handoff 搬运是必需的（见 docs/23）。
     ⚠️ 只作用在自建的临时文档上，跑完不保存关掉。 */
  try {
    const S21 = "S21 置入（placeEvent + 会话令牌）—— 临时文档上图层数必须增加";
    const srcEntry = await data.entryIn(["library", "thumb"], "401.png");
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
          "　测试文件=401.png（沙箱内 Entry）" +
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
       ① file:///…\PluginData\library\thumb\401.png   ← 沙箱内，基准
       ② file:///D:/ps-uxp-dev/PROGRESS.md            ← 沙箱外（本机固定路径）
     判据定为"两头都给出了明确答案"—— 若 ① 成功而 ② 被拒，那就是权限边界，不是用法问题。 */
  try {
    const insidePath = await data.nativePathIn(["library", "thumb"], "401.png");
    const insideUrl = insidePath ? "file:///" + String(insidePath).replace(/\\/g, "/") : null;
    const outsideUrl = "file:///D:/ps-uxp-dev/PROGRESS.md";

    const a = insideUrl ? await ps.canEntryFromUrl(insideUrl) : { ok: false, error: "拿不到沙箱内测试路径" };
    const b = await ps.canEntryFromUrl(outsideUrl);
    const definite = (r) => !!(r && (r.got === true || r.error));
    const fmt = (r, tag) =>
      tag + "=" + (r && r.got ? "拿到 entry（" + r.name + "）" : "未拿到（" + ((r && r.error) || "无错误信息") + "）");

    // 🔴 判据的关键在这里：**基准没成功时，这个实验没有结论**，不能拿它去证明"沙箱外不可读"。
    //    首轮（v0.2.7 21:37）的读数就是这种情况 —— 连我们自己沙箱里的 401.png 都没读到，
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
      fmt(a, "基准·沙箱内 401.png") + "　" + fmt(b, "沙箱外 PROGRESS.md") + "　⇒ " + conclusion
    );
  } catch (e) {
    rec("S22 直连置入可行性探针（getEntryWithUrl 能否读沙箱外路径）", false,
      "抛异常：" + ((e && e.message) || e));
  }

  /* ---------- 收尾：写报告 ---------- */
  const passCount = results.filter((r) => r.ok).length;
  const summary = passCount + "/" + results.length;
  const report = {
    plugin: "com.vellum.toolbox",
    version: "0.2.7",
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
