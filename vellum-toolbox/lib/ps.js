/*
 * lib/ps.js —— Photoshop 操作薄封装
 * ===========================================================================
 * 只放「要被多个工具共用」的 PS 动作。M1 只有调色板会用到前景/背景色，
 * 但这一层是给 M2（置入文件）/ M3（建文字层、矢量）预留的底座。
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★★★ 读色 / 设色 的 target 写法**不一样**，写错会静默失败 ★★★
 * ════════════════════════════════════════════════════════════════════════
 * 2026-10-10 在真机（PS 2026 v27.2 / UXP 9.0.2）用 env-check 探针实测：
 *
 *   读 foregroundColor / backgroundColor（有效）：
 *     { _obj:"get", _target:[ { _property:"foregroundColor" },
 *                             { _ref:"application", _enum:"ordinal", _value:"targetEnum" } ] }
 *     取值：res[0].foregroundColor  →  { _obj:"RGBColor", red, grain, blue }
 *
 *   设 foregroundColor / backgroundColor（有效）：
 *     { _obj:"set", _target:[ { _ref:"color", _property:"foregroundColor" } ],
 *                   to:{ _obj:"RGBColor", red, grain, blue } }
 *
 * 三个坑（都踩过，别再踩）：
 *   ① **set 用读的 target = 静默失败** —— 不报错，颜色也不变。只看「没反应」会误判成功能不支持。
 *   ② **绿色分量的键名是 `grain`**，不是 `green`（ActionDescriptor 的历史遗留）。
 *   ③ 判据必须是「回读值命中 **且** 与设置前不同」—— 否则测试色恰好等于原值时会出现假阳性
 *      （env-check 第一版就这么被骗过一次）。
 *
 * 证据：env-check/README.md §六 · DECISIONS.md「M1 调色板地基已实测」
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★★★ v0.2.3：`fill` 不是万能的 —— 内容图层必须换命令 ★★★
 * ════════════════════════════════════════════════════════════════════════
 * 2026-10-10 用户报「填充不能用」（PS 弹 `命令"填充"当前不可用。`）。真机日志：
 *   图层「矩形 1」→ attempts=[fillColor=已执行/像素无变化 fgFallback=已执行/像素无变化]
 *   → **batchPlay 没抛异常，像素也一个没变，PS 自己弹了个错误框。**
 *
 * 归因：形状图层在 UXP 里 `kind === "solidColor"`（Adobe 论坛官方人员原话：
 * "Vector layers are actually solid color layers (with vector masks)"），
 * 和纯色填充 / 渐变 / 图案一起属于**内容图层**——像素由参数算出来，
 * PS 菜单的「填充」对它们本来就不可用。
 *
 * 结论（写进代码的四条）：
 *   ① 先判 `layer.kind`，按族分派命令：像素族用 `fill`，内容族用 `set` 改内容色，
 *      **文字族用 `set` 改 textStyle.color**（v0.2.4 补，非破坏性）。
 *   ② **内容族与文字族都绝不退到 `fill`** —— 那只会换来一个 PS 错误框 + 静默无变化。
 *   ③ 前置拒绝（锁定 / 调整层 / 组）要在**发命令之前**做完。
 *   ④ 文字族那条描述符**必须照抄官方文档**，不能自己发挥（`_target` 两级、颜色在
 *      `to.textStyle.color` 里）—— 我猜的两版都是"不报错、像素也不变"。
 */

const photoshop = require("photoshop");
const uxpNS = require("uxp"); // v0.2.7：置入要用 uxp.storage 的会话令牌
const { app, core, action } = photoshop;
const batchPlay = action.batchPlay;

/* ⚠️ imaging 与 constants 在**部分版本**上可能没暴露，所以不做解构断言，
   统一在用到的地方判空降级（解构 undefined 属性本身不报错，但别指望它一定在）。 */
const imaging = photoshop.imaging || null;
const constants = photoshop.constants || null;

/** 颜色槽 → ActionDescriptor 里的属性名。 */
const COLOR_PROP = {
  foreground: "foregroundColor",
  background: "backgroundColor",
};

const COLOR_LABEL = {
  foreground: "前景色",
  background: "背景色",
};

function msg(e) {
  return e && e.message ? e.message : String(e);
}

function propOf(kind) {
  const p = COLOR_PROP[kind];
  if (!p) throw new Error("未知颜色槽：" + kind + "（仅支持 foreground / background）");
  return p;
}

function labelOf(kind) {
  return COLOR_LABEL[kind] || kind;
}

/** 标准「当前 application」目标。 */
function appRef() {
  return { _ref: "application", _enum: "ordinal", _value: "targetEnum" };
}

/** 读色 target（有效写法）。 */
function readTarget(prop) {
  return [{ _property: prop }, appRef()];
}

/** 设色 target（有效写法）—— 注意与读**不同**。 */
function writeTarget(prop) {
  return [{ _ref: "color", _property: prop }];
}

/** 所有会改状态的操作都必须包在模态作用域里，否则报「模态被占用」。 */
function runModal(fn, commandName) {
  return core.executeAsModal(fn, { commandName: commandName || "Vellum 工具箱" });
}

/* ------------------------------------------------------------- 颜色工具 */

/** 从 ActionDescriptor 形态的颜色对象里取出 {r,g,b}；不认识就返回 null。 */
function extractRGB(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw.red;
  // ⚠️ 绿色分量键名是 grain（历史遗留），兼容 green 以防某些版本换名
  const g = raw.grain !== undefined && raw.grain !== null ? raw.grain : raw.green;
  const b = raw.blue;
  if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }
  return null;
}

function clamp255(n) {
  const v = Math.round(Number(n));
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function rgbToHex(rgb) {
  const h = (n) => clamp255(n).toString(16).padStart(2, "0");
  return "#" + (h(rgb.r) + h(rgb.g) + h(rgb.b)).toUpperCase();
}

/** "#RRGGBB" / "RRGGBB" / "#RGB" → {r,g,b}；不合法返回 null。 */
function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/* ------------------------------------------------------------- 读写颜色 */

/**
 * 读当前前景色 / 背景色。
 * @returns {Promise<{ok:boolean, kind:string, raw:object|null, rgb:{r,g,b}|null, hex?:string, error?:string}>}
 */
async function readColor(kind) {
  const prop = propOf(kind);
  try {
    let raw = null;
    await runModal(async () => {
      const res = await batchPlay(
        [
          {
            _obj: "get",
            _target: readTarget(prop),
            _options: { dialogOptions: "dontDisplay" },
          },
        ],
        {}
      );
      raw = res && res[0] ? res[0][prop] : null;
    }, "Vellum 工具箱：读" + labelOf(kind));

    const rgb = extractRGB(raw);
    if (!rgb) {
      return {
        ok: false,
        kind,
        raw: raw,
        rgb: null,
        error: "回读结构不符合预期：" + JSON.stringify(raw),
      };
    }
    return { ok: true, kind, raw: raw, rgb: rgb, hex: rgbToHex(rgb) };
  } catch (e) {
    return { ok: false, kind, raw: null, rgb: null, error: msg(e) };
  }
}

/**
 * 设前景色 / 背景色，并**回读自证**。
 *
 * 判据分两层（v0.2.1 修正）：
 *   hit     = 回读命中目标值          → **这才是"设置成功"的定义**
 *   changed = 回读与设置前不同        → 只用来识别"本来就等于目标色"
 *
 * ⚠️ 旧版把 ok 写成 `hit && changed`，导致用户点一个**当前已激活**的色块时
 *    （before == 目标）被判为失败、面板弹出「✗ 设前景色失败」。真机日志：
 *    `palette set=foreground hex=#FFFFFF ... ok=false before=#FFFFFF readback=#FFFFFF`
 *    changed 这条判据是为「测试色恰好等于原值」的假阳性设的，属于**自检视角**，
 *    不该外溢成生产语义。要防假阳性的调用方（如自检）自己看 changed。
 *
 * @returns {Promise<object>} ok / hit / changed / readback / readbackHex / before / hex / error
 */
async function setColor(kind, rgb) {
  const prop = propOf(kind);
  const r = clamp255(rgb.r);
  const g = clamp255(rgb.g);
  const b = clamp255(rgb.b);
  const target = { r: r, g: g, b: b };
  const targetHex = rgbToHex(target);

  const before = await readColor(kind);
  const beforeRgb = before.ok ? before.rgb : null;

  try {
    await runModal(async () => {
      await batchPlay(
        [
          {
            _obj: "set",
            _target: writeTarget(prop),
            to: { _obj: "RGBColor", red: r, grain: g, blue: b },
          },
        ],
        {}
      );
    }, "Vellum 工具箱：设" + labelOf(kind));
  } catch (e) {
    return {
      ok: false, kind, hex: targetHex, rgb: target, before: beforeRgb,
      readback: null, hit: false, changed: false,
      error: "设置抛异常：" + msg(e),
    };
  }

  const after = await readColor(kind);
  const hit =
    after.ok && after.rgb.r === r && after.rgb.g === g && after.rgb.b === b;
  const changed = !(
    beforeRgb && after.ok &&
    beforeRgb.r === after.rgb.r && beforeRgb.g === after.rgb.g && beforeRgb.b === after.rgb.b
  );

  return {
    ok: hit, // ← v0.2.1：成功 = 回读命中（不再要求「必须变过」）
    kind,
    hex: targetHex,
    rgb: target,
    before: beforeRgb,
    readback: after.rgb || null,
    readbackHex: after.hex || null,
    hit,
    changed,
    error: hit ? null : after.ok ? "回读=" + after.hex + "，与目标不符" : "设置后回读失败：" + after.error,
  };
}

/** setColor 的 HEX 糖。 */
async function setColorHex(kind, hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return { ok: false, kind, hex, error: "HEX 不合法：" + hex, hit: false, changed: false };
  }
  return setColor(kind, rgb);
}

/** 把颜色还原回原值（自检收尾用）。raw 是读回来的 ActionDescriptor 颜色对象。 */
async function restoreColor(kind, raw) {
  if (!raw) return { ok: false, error: "没有可恢复的原值" };
  const prop = propOf(kind);
  try {
    await runModal(async () => {
      await batchPlay([{ _obj: "set", _target: writeTarget(prop), to: raw }], {});
    }, "Vellum 工具箱：恢复" + labelOf(kind));
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  const back = await readColor(kind);
  const same =
    back.ok && extractRGB(raw) &&
    back.rgb.r === extractRGB(raw).r &&
    back.rgb.g === extractRGB(raw).g &&
    back.rgb.b === extractRGB(raw).b;
  return { ok: !!same, readback: back.rgb || null, error: same ? null : "恢复后回读与原值不符" };
}

/* --------------------------------------------------------------- 填充

   ⚠️ 描述符来自**官方文档原样**（不是猜的）：
     Adobe「UXP Scripting in Photoshop」示例与 Adobe UXP wiki 都用这一条：
        { _obj:"fill", using:{ _enum:"fillContents", _value:"foregroundColor" },
          opacity:{ _unit:"percentUnit", _value:100 },
          mode:{ _enum:"blendMode", _value:"normal" } }
     它等价于 PS 的「编辑 › 填充」/ Alt+Backspace（用前景色填充）。

   ⚠️ **不要加 `_target`**：Adobe 论坛有实例显示给 fill 加 _target 后反而失效
     （forums.creativeclouddeveloper.com/t/batchplay-does-not-behave-as-expeted/6310）。
     不加 = 作用于「当前文档的活动图层 + 当前选区」，正是我们要的语义。

   两条路径：
     ① fillColor   —— using.fillContents = "color" + 显式 color 描述符。
                      好处：**不动用户的前景/背景色**。风险：这条枚举值官方文档没写，
                      PS 可能静默忽略（不报错但什么也没发生）→ 所以必须有验证。
     ② fgFallback  —— 官方那条：设前景色 → 用 foregroundColor 填充 → **把前景色还原**。
                      最后一步是刻意的：Alt+左键=填充 的卖点就是"不改我的前景色"。
*/

/** 路径 ① 的描述符：直接指定颜色。 */
function fillDescColor(rgb) {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: "color" },
    color: { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 路径 ② 的描述符：用当前前景色（官方示例原样）。 */
function fillDescForeground() {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: "foregroundColor" },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/* ---------------------------------------------------------------------------
 * v0.2.3：内容图层（形状 / 纯色填充 / 渐变 / 图案）改色的两条描述符
 * ---------------------------------------------------------------------------
 * 这两个是**形状图层唯一可行的路**：`fill` 对内容图层不可用（见上方长注释）。
 *
 * 为什么写两条 —— 因为"形状图层的填色到底存在哪"有两派说法，两边都有实物证据：
 *   变体 A（gisthub CS4 时代的经典写法）：填色在 contentLayer 的 `color` 上
 *     to: { _obj:"solidColorLayer", color:{ RGBColor } }
 *   变体 B（2024 年 Adobe 社区用来做"形状填充/描边互换"的写法）：填色在
 *     shapeStyle 的 fillContents 里
 *     to: { _obj:"shapeStyle", fillContents:{ _obj:"solidColorLayer", color:{ RGBColor } } }
 *
 * 我没有真机证据判断 PS 27.2 认哪一条（形状图层无法在自检里凭空造），
 * 所以**两条按序试 + 像素回读判据**：哪条真把颜色改了，日志就会记下哪条。
 * 这比赌一条要诚实，也不会出现"命令没报错就当成功"的假阳性。
 * ------------------------------------------------------------------------- */

/** 变体 A：contentLayer 直接给 solidColorLayer.color。 */
function contentColorDescA(rgb) {
  return {
    _obj: "set",
    _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: {
      _obj: "solidColorLayer",
      color: { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b },
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 变体 B：形状图层的填色在 shapeStyle.fillContents 里。 */
function contentColorDescB(rgb) {
  return {
    _obj: "set",
    _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: {
      _obj: "shapeStyle",
      fillContents: {
        _obj: "solidColorLayer",
        color: { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b },
      },
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/* ---------------------------------------------------------------------------
 * v0.2.4：文字图层改色
 * ---------------------------------------------------------------------------
 * 文字图层**不能**用 `fill` —— PS 会给「命令"<未知的>"当前不可用」。
 * 也不能用 `layer.kind = SOLIDFILL` 那套 DOM（UXP 没有 DOM，而且 PS 明确拒绝
 * 「您只能将图层的类型更改为文本或正常」）。
 *
 * 正确写法来自 **Adobe 官方开发者文档**（Photoshop API v2 · Text Layer Operations）：
 *   { _obj:"set",
 *     _target:[ { _property:"textStyle", _ref:"property" },
 *               { _enum:"ordinal", _ref:"textLayer", _value:"targetEnum" } ],
 *     to:{ _obj:"textStyle", color:{ _obj:"RGBColor", red, green, blue } } }
 *
 * ⚠️ 两个**必须照抄、不能自己发挥**的点（我两条都猜错过）：
 *   1. `_target` 是**两级**的：第一级是 `textStyle` **属性**，第二级才是 textLayer；
 *      写成一级 `[{_ref:"textLayer",...}]` → 静默无效（不报错、像素也不变）。
 *   2. 颜色放在 `to.textStyle.color` 里，**不是**套在 `to.textLayer.color` 里。
 *
 * ⚠️ 顺序也是硬的：JSX 侧 `putProperty` 必须**先**于 `putEnumerated`，
 *    颠倒会报「命令"设置"当前不可用」。
 *
 * 真机自证（PS 27.2，MCP 实测）：黑字 → 目标 #E60012，
 *   合成直方图最低亮度 0 → 71（= #E60012 的亮度），
 *   且 `layer.kind` 仍是 `LayerKind.TEXT` —— **非破坏性，文字保持可编辑**。
 * ------------------------------------------------------------------------- */

/** 文字图层改色（唯一一条；真机已验证）。 */
function textColorDesc(rgb) {
  return {
    _obj: "set",
    _target: [
      { _ref: "property", _property: "textStyle" },
      { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" },
    ],
    to: {
      _obj: "textStyle",
      color: { _obj: "RGBColor", red: rgb.r, grain: rgb.g, blue: rgb.b },
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/**
 * 新建一个**文字图层** —— 只给自检用（造一个文字图层来验证改色路径）。
 *
 * ⚠️ 两个真机上换来的细节（不这么写自检会"看起来没生效"）：
 *   1. `make textLayer` 造出来的点文字，**锚点在基线上**，字是往上长的 →
 *      300pt 的字在 400×400 画布里**完全落在画布外**，合成直方图全白（读不到任何像素）；
 *      必须**再 `move` 一次**把它挪进画布（实测偏移 (30,330) 后 bounds = 48,100,274,330）。
 *   2. 字号用 `#Pnt`（pointsUnit），颜色走 `textStyleRange → textStyle → color`。
 */
async function makeTextLayer(contents, sizePt, dx, dy) {
  const text = contents === undefined || contents === null ? "M" : String(contents);
  const size = typeof sizePt === "number" ? sizePt : 300;
  const ox = typeof dx === "number" ? dx : 30;
  const oy = typeof dy === "number" ? dy : 330;
  await runModal(async () => {
    await batchPlay(
      [
        {
          _obj: "make",
          _target: [{ _ref: "textLayer" }],
          using: {
            _obj: "textLayer",
            textKey: text,
            textStyleRange: [
              {
                _obj: "textStyleRange",
                from: 0,
                to: text.length,
                textStyle: {
                  _obj: "textStyle",
                  size: { _unit: "pointsUnit", _value: size },
                  color: { _obj: "RGBColor", red: 0, grain: 0, blue: 0 },
                },
              },
            ],
          },
          _options: { dialogOptions: "dontDisplay" },
        },
        {
          _obj: "move",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: ox },
            vertical: { _unit: "pixelsUnit", _value: oy },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      {}
    );
  }, "Vellum 工具箱：新建文字图层（自检）");
  return { ok: true };
}

/**
 * 新建一个「纯色填充图层」—— 只给自检用（造一个**内容图层**来验证改色路径）。
 * 形状图层和纯色填充图层是同一内容类型（solidColorLayer），
 * 所以这条路径能验证"内容族改色"能不能通。
 */
async function makeSolidColorLayer(rgb) {
  const c = { _obj: "RGBColor", red: clamp255(rgb.r), grain: clamp255(rgb.g), blue: clamp255(rgb.b) };
  await runModal(async () => {
    await batchPlay(
      [
        {
          _obj: "make",
          _target: [{ _ref: "contentLayer" }],
          using: { _obj: "contentLayer", type: { _obj: "solidColorLayer", color: c } },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      {}
    );
  }, "Vellum 工具箱：新建纯色填充图层（自检）");
  return { ok: true };
}

function samePixel(a, b) {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

/** 当前文档 / 活动图层的信息（拿不到就返回 null，不抛）。 */
function docInfo() {
  try {
    if (!app.documents || !app.documents.length) return null;
    const d = app.activeDocument;
    const l = d.activeLayers && d.activeLayers[0];
    return {
      docId: d.id,
      docName: d.name,
      mode: d.mode,
      layer: l ? { id: l.id, name: l.name, kind: l.kind } : null,
    };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** 当前是否有选区（拿不到就返回 null = 未知，不当作"没有"）。 */
function hasSelection() {
  try {
    const d = app.activeDocument;
    if (!d || !d.selection) return false;
    return !!d.selection.bounds;
  } catch {
    return null;
  }
}

/* ===========================================================================
 * 图层类型判定（v0.2.3 新增）
 * ===========================================================================
 * ★★★ 为什么必须判类型：PS 的「填充」命令对**内容图层**根本不可用 ★★★
 *
 * 2026-10-10 真机事故（用户报「填充不能用」+ PS 弹 `命令"填充"当前不可用。`）：
 *   在「矩形 1」（形状图层）上 Alt+左键 → batchPlay 的 `_obj:"fill"` 返回**没有报错**，
 *   但像素一个都没变，同时 PS 自己弹了一个错误框。
 *   日志：`attempts=[fillColor=已执行/像素无变化 fgFallback=已执行/像素无变化]`
 *
 * 归因（两条外部事实交叉验证）：
 *   ① Adobe 论坛官方人员原话：「**Vector layers are actually solid color layers
 *      (with vector masks)**」—— 形状图层在 UXP 里的 `kind` 就是 `solidColor`，
 *      和「纯色填充图层」是同一个内容类型。
 *   ② 形状 / 纯色填充 / 渐变 / 图案 都是**内容图层**（contentLayer），
 *      像素数据由参数算出来，PS 菜单里的「填充」对它们不可用 → 于是既不改像素、
 *      又弹「命令当前不可用」。
 *
 * 所以正确做法不是"换个写法再 fill 一次"，而是**按图层类型换一条命令**：
 *   像素族（pixel / background / smartObject）→ `fill`（尊重选区）
 *   内容族（solidColor / gradientFill / patternFill）→ `set` 内容图层的颜色
 *   其余（调整图层 / 组 / 文字 / 3D / 视频）→ 明确拒绝，并说清为什么
 * ------------------------------------------------------------------------- */

/** kind → 中文名。日志和给用户看的报错都用它。 */
const KIND_CN = {
  pixel: "普通像素图层",
  background: "背景图层",
  smartObject: "智能对象",
  solidColor: "形状 / 纯色填充图层",
  gradientFill: "渐变填充图层",
  patternFill: "图案填充图层",
  text: "文字图层",
  group: "图层组",
  threeD: "3D 图层",
  video: "视频图层",
  levels: "色阶调整图层",
  curves: "曲线调整图层",
  hueSaturation: "色相/饱和度调整图层",
  colorBalance: "色彩平衡调整图层",
  blackAndWhite: "黑白调整图层",
  brightnessContrast: "亮度/对比度调整图层",
  exposure: "曝光度调整图层",
  photoFilter: "照片滤镜调整图层",
  channelMixer: "通道混合器调整图层",
  colorLookup: "颜色查找调整图层",
  gradientMap: "渐变映射调整图层",
  inversion: "反相调整图层",
  posterize: "色调分离调整图层",
  threshold: "阈值调整图层",
  selectiveColor: "可选颜色调整图层",
  vibrance: "自然饱和度调整图层",
};

function kindCN(kind) {
  if (!kind) return "未知类型图层";
  return KIND_CN[kind] || ("图层（kind=" + kind + "）");
}

/** 能直接 `fill` 的像素族。 */
const RASTER_KINDS = ["pixel", "background", "smartObject"];
/** 需要改「内容图层颜色」的内容族。 */
const CONTENT_KINDS = ["solidColor", "gradientFill", "patternFill"];

/**
 * 读活动图层的关键属性。**任何一项读不到都不算失败**（个别新调整图层会整层抛错），
 * 逐项 try 掉，返回 ok:false 只在"根本没有文档 / 没有活动图层"时。
 *
 * ⚠️ `layer.kind` 在 Clarity / Grain 这类新调整图层上会**抛异常**
 *    （Adobe 论坛已知问题，UXP DOM 还没收录这两个值）→ 必须逐项 try。
 */
function layerInfo() {
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  try {
    if (!app.documents || !app.documents.length) {
      return { ok: false, error: "没有打开的文档" };
    }
    const d = app.activeDocument;
    const l = d.activeLayers && d.activeLayers[0];
    if (!l) return { ok: false, error: "没有选中的图层（图层被隐藏或未激活？）" };

    const kind = safe(() => l.kind);
    return {
      ok: true,
      id: safe(() => l.id),
      name: safe(() => l.name) || "(未命名图层)",
      kind: kind === undefined ? null : kind,
      kindKnown: kind !== undefined,
      visible: safe(() => !!l.visible),
      allLocked: safe(() => !!l.allLocked),
      pixelsLocked: safe(() => !!l.pixelsLocked),
      positionLocked: safe(() => !!l.positionLocked),
      transparentPixelsLocked: safe(() => !!l.transparentPixelsLocked),
      isBackground: safe(() => !!l.isBackgroundLayer),
      docId: safe(() => d.id),
      docName: safe(() => d.name),
      docMode: safe(() => d.mode),
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * 把图层归到一条填充策略上。
 * @returns {"raster"|"content"|"text"|"unsupported"|"unknown"}
 */
function classifyLayer(li) {
  if (!li || !li.ok) return "unknown";
  // kind 是**权威口径**（UXP 的 LayerKind 字符串）
  if (!li.kindKnown || !li.kind) {
    // kind 读不出来时（已知：Clarity / Grain 这类 UXP DOM 还没收录的新调整图层，
    // 读 layer.kind 会直接抛异常）用一个**独立且无歧义**的 API 兜底：
    // 背景图层定义上就是像素族，不能因为 kind 读不到就不给它填充。
    // 其余一律按 unknown 处理 —— 宁可明确报"识别不出类型"，也不拿 fill 去赌一个 PS 弹框。
    return li.isBackground ? "raster" : "unknown";
  }
  const k = li.kind;
  if (RASTER_KINDS.indexOf(k) >= 0) return "raster";
  if (CONTENT_KINDS.indexOf(k) >= 0) return "content";
  if (k === "text") return "text";
  return "unsupported";
}

/**
 * 前置检查（**在发任何 PS 命令之前**）。
 * 为什么要有它：`_obj:"fill"` 在内容图层上会让 PS 弹一个错误框（见上方长注释）。
 * 能在本地判掉的，就不要交给 PS 去弹框。
 *
 * @returns {null|string} null = 放行；字符串 = 给用户看的原因
 */
function fillPreflight(li, family) {
  if (!li || !li.ok) {
    return li && li.error ? li.error : "读不到当前图层";
  }
  if (li.allLocked) {
    return "「" + li.name + "」被完全锁定 —— 请点图层缩览图上方的小锁，取消「锁定全部」再试";
  }
  if (li.pixelsLocked) {
    return "「" + li.name + "」锁定了图像像素 —— 请取消「锁定图像像素」再试";
  }
  // v0.2.4：文字图层**不再拒绝** —— 走 `textColorDesc()`（改 textStyle 的颜色，
  // 非破坏性，文字保持可编辑）。真机已验证，见上方 textColorDesc 的长注释。
  if (family === "unsupported") {
    return "「" + li.name + "」是" + kindCN(li.kind) +
      "，PS 本身不支持对它填充。请在图层组里选中具体的像素/形状图层再试";
  }
  return null;
}

/**
 * 读**活动图层**的 1×1 平均色（像素级回读凭证）。
 *
 * 为什么是"整层平均缩到 1×1"而不是"取某个像素"：
 *   imaging.getPixels 的 targetSize 会把源区域重采样到目标尺寸 ——
 *   传 {width:1,height:1} 就是**整层的平均色**。对一个**纯色填充**过的图层，
 *   平均色恰好等于填充色，这就是我们要的像素凭证；
 *   而对普通图层，平均值没有"等于某个色"的语义 —— 所以这个函数只在
 *   「填充后校验」与「自检」里用，别拿它当通用的取色器。
 *
 * ⚠️ imaging API 在各版本间有差异（getData 有时返回 Promise、有时直接返回数据），
 *    这里全部按最保守的写法处理，任何一步不认识就降级成 {ok:false, error}。
 */
async function readLayerAvgColor() {
  try {
    if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
    if (typeof imaging === "undefined" || !imaging || typeof imaging.getPixels !== "function") {
      return { ok: false, error: "imaging.getPixels 不可用（该版本未暴露）" };
    }
    const d = app.activeDocument;
    const l = d.activeLayers && d.activeLayers[0];
    const req = {
      documentID: d.id,
      targetSize: { width: 1, height: 1 },
      componentSize: 8,
      colorSpace: "RGB",
      applyAlpha: false,
    };
    if (l && l.id !== undefined) req.layerID = l.id;

    let rgb = null;
    let rawErr = null;
    await runModal(async () => {
      try {
        const res = await imaging.getPixels(req);
        const img = res && res.imageData;
        if (!img) throw new Error("getPixels 未返回 imageData");
        let data = typeof img.getData === "function" ? img.getData({}) : null;
        if (data && typeof data.then === "function") data = await data;
        const bytes = data && data.data ? data.data : data;
        if (!bytes || bytes.length < 3) throw new Error("像素数据结构不符合预期");
        rgb = {
          r: clamp255(bytes[0]),
          g: clamp255(bytes[1]),
          b: clamp255(bytes[2]),
        };
        if (typeof img.dispose === "function") {
          try {
            img.dispose();
          } catch {
            /* 忽略 */
          }
        }
      } catch (e) {
        rawErr = msg(e);
      }
    }, "Vellum 工具箱：读图层像素");

    if (rawErr) return { ok: false, error: rawErr };
    if (!rgb) return { ok: false, error: "未取到像素" };
    return { ok: true, rgb: rgb, hex: rgbToHex(rgb) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * 用指定颜色**填充当前图层 / 当前选区**。
 *
 * 语义按图层类型分派（v0.2.3 建框架，v0.2.4 补文字族）：
 *   像素族   → PS 的 `fill`（= 编辑 › 填充，尊重选区）
 *   内容族   → `set` 内容图层的颜色（形状图层的"填充"就是这个意思）
 *   文字族   → `set` textStyle 的颜色（**非破坏性**，文字保持可编辑）
 *   调整层/组 → 前置拒绝，不发任何 PS 命令（避免 PS 弹框）
 *
 * ⚠️ 三条"绝不乱退"的铁律（每条都是真机事故换来的）：
 *   - 内容族**绝不退到 `fill`**（PS 会弹「命令"填充"当前不可用」，且不报错不改像素）；
 *   - 文字族**同样绝不退到 `fill`**（真机实测：`命令"<未知的>"当前不可用`）；
 *   - 能在本地判掉的（锁定 / 调整层 / 组）**必须在发命令之前**判掉。
 *
 * @param {string|{r,g,b}} hexOrRgb
 * @param {object} [opts]
 *   verify: "pixel"   —— 要求像素回读**等于目标色**（自检用，必须跑在纯色文档上）
 *           "change"  —— 只要求像素**有变化**（默认；用户路径用，能识破静默失效）
 *           "none"    —— 不做像素校验，命令执行成功即算成功
 *   fallback: false  —— 禁用「先设前景色」那条回退
 * @returns {Promise<object>} ok / hex / via / verified / family / layer / attempts / error
 */
async function fillLayer(hexOrRgb, opts) {
  const o = opts || {};
  const mode = o.verify || "change";
  let rgb = null;
  if (typeof hexOrRgb === "string") rgb = hexToRgb(hexOrRgb);
  else if (hexOrRgb && typeof hexOrRgb === "object") {
    rgb = { r: hexOrRgb.r, g: hexOrRgb.g, b: hexOrRgb.b };
  }
  if (!rgb) return { ok: false, error: "颜色不合法：" + String(hexOrRgb), verified: "none", attempts: [] };

  const target = { r: clamp255(rgb.r), g: clamp255(rgb.g), b: clamp255(rgb.b) };
  const targetHex = rgbToHex(target);

  if (!hasDocument()) {
    return {
      ok: false, hex: targetHex, verified: "none", noDocument: true, attempts: [],
      error: "没有打开的文档（填充需要先打开一个文档并选中图层）",
    };
  }

  const info = docInfo() || {};
  const li = layerInfo();
  const family = classifyLayer(li);

  // 前置拒绝：能在本地判掉的就别交给 PS 去弹框
  const blocked = fillPreflight(li, family);
  if (blocked) {
    return {
      ok: false, hex: targetHex, verified: "none", via: null, blocked: true,
      family: family,
      layer: li.ok ? { id: li.id, name: li.name, kind: li.kind } : null,
      layerKind: li.ok ? li.kind : null,
      docName: info.docName || null,
      docMode: info.mode || null,
      attempts: ["preflight=拒绝(family=" + family + ", kind=" + (li && li.kind) + ")"],
      error: blocked,
    };
  }

  const sel = hasSelection();
  const before = mode === "none" ? null : await readLayerAvgColor();

  /** 把一条描述符扔进模态作用域，只回报「有没有抛」。 */
  const exec = async (desc, cmdName) => {
    try {
      await runModal(async () => {
        await batchPlay([desc], {});
      }, cmdName);
      return { executed: true, error: null };
    } catch (e) {
      return { executed: false, error: msg(e) };
    }
  };

  /** 像素族路径 ①：显式颜色 —— 不碰用户的前景/背景色。 */
  const attemptFillColor = () => exec(fillDescColor(target), "Vellum 工具箱：填充当前图层");

  /** 像素族路径 ②：官方的前景色语义 —— 先设前景色，填完**还原**。 */
  const attemptForeground = async () => {
    const beforeFg = await readColor("foreground");
    const setRes = await setColor("foreground", target);
    if (!setRes.ok) {
      return { executed: false, error: "回退路径设前景色失败：" + (setRes.error || "未知") };
    }
    const ex = await exec(fillDescForeground(), "Vellum 工具箱：填充当前图层");
    // 无论成败都把前景色还原 —— "填充不改我的前景色"是这个功能的卖点
    let fgRestored = false;
    if (beforeFg.ok && beforeFg.raw) {
      const r = await restoreColor("foreground", beforeFg.raw);
      fgRestored = !!r.ok;
    }
    return { executed: ex.executed, error: ex.error, fgRestored: fgRestored };
  };

  /** 内容族路径 A / B：改内容图层的颜色（形状图层唯一可行的路）。 */
  const attemptContentA = () => exec(contentColorDescA(target), "Vellum 工具箱：改图形颜色");
  const attemptContentB = () => exec(contentColorDescB(target), "Vellum 工具箱：改图形颜色");

  /** 文字族：改 textStyle 的颜色（非破坏性，文字保持可编辑）。 */
  const attemptText = () => exec(textColorDesc(target), "Vellum 工具箱：改文字颜色");

  /* 按类型排路径。
     ⚠️ 内容族**绝不**退到 `fill` —— 那正是用户这次踩到的坑：
        PS 会对内容图层弹「命令"填充"当前不可用」，而且**不报错、也不改像素**。
     ⚠️ family="unknown"（kind 读不出来，多半是新调整图层）也只走内容族：
        宁可明确报"识别不出类型"，也不要拿 fill 去赌一个 PS 弹框。 */
  const paths = [];
  if (family === "content" || family === "unknown") {
    paths.push({ via: "contentColorA", run: attemptContentA });
    paths.push({ via: "contentColorB", run: attemptContentB });
  }
  if (family === "raster") {
    paths.push({ via: "fillColor", run: attemptFillColor });
    if (o.fallback !== false) paths.push({ via: "fgFallback", run: attemptForeground });
  }
  // 文字族：只走 textStyle 一条。**绝不退到 `fill`** —— PS 对文字图层会给
  // 「命令"<未知的>"当前不可用」（真机实测），那正是用户最初看到的那种失败。
  if (family === "text") {
    paths.push({ via: "textColor", run: attemptText });
  }
  if (!paths.length) {
    return {
      ok: false, hex: targetHex, verified: "none", via: null, blocked: true,
      family: family,
      layer: { id: li.id, name: li.name, kind: li.kind }, layerKind: li.kind,
      docName: info.docName || null,
      attempts: ["noPath=没有适用的填充策略(family=" + family + ")"],
      error: "「" + li.name + "」是" + kindCN(li.kind) + "，没有可用的填充策略",
    };
  }

  const attempts = [];
  let chosen = null;
  let after = null;
  let matched = false;
  let changed = false;

  for (const p of paths) {
    const r = await p.run();
    after = mode === "none" ? null : await readLayerAvgColor();
    const canTell = !!(after && after.ok);
    matched = canTell && samePixel(after.rgb, target);
    changed = canTell && !!(before && before.ok) && !samePixel(after.rgb, before.rgb);

    attempts.push(p.via + "=" + (r.executed ? "已执行" : "失败") +
      (canTell ? "/像素" + (matched ? "命中" : changed ? "有变化" : "无变化") : "/像素不可读") +
      (r.error ? "(" + r.error + ")" : ""));

    chosen = { via: p.via, executed: r.executed, error: r.error, fgRestored: r.fgRestored };

    // 判定：命令执行了，且（能验证时）像素达到了该模式要求的效果
    const ok =
      r.executed &&
      (!canTell ||
        (mode === "pixel" ? matched : mode === "change" ? changed || matched : true));
    if (ok) break;
  }

  const canTell = !!(after && after.ok);
  const ok =
    !!chosen && chosen.executed &&
    (!canTell || (mode === "pixel" ? matched : changed || matched));

  let error = null;
  if (!ok) {
    if (chosen && !chosen.executed) {
      error = chosen.error || "填充命令执行失败";
    } else if (family === "text") {
      error = "「" + li.name + "」的文字颜色没能改成 " + targetHex + "。" +
        (canTell && !changed && !matched
          ? "像素没有变化 —— 文字可能本来就是该颜色，或该文字图层不含可见像素（空文字/全透明）。"
          : "") +
        "请把这一行日志发我：attempts=" + attempts.join(" ");
    } else if (family === "content") {
      error = "「" + li.name + "」是" + kindCN(li.kind) +
        "，两种改色写法都没能让画面变化。" +
        "（⚠️ 已知限制：PS 的「纯色填充图层」目前改不了色；**形状图层是正常的**，" +
        "见 docs/18 §八。）请把这一行日志发我：attempts=" + attempts.join(" ");
    } else if (canTell) {
      error = "命令已执行，但像素没变化 —— 图层可能被蒙版/剪贴蒙版挡住、被别的图层遮住，" +
        "或「" + li.name + "」本来就是该颜色";
    } else {
      error = "命令已执行，但读不到像素 —— 「" + li.name + "」可能不含可见像素（全透明/空图层）";
    }
  }

  return {
    ok: ok,
    hex: targetHex,
    via: chosen ? chosen.via : null,
    family: family,
    layerKind: li.kind,
    verified: canTell ? (mode === "pixel" ? "pixel" : "change") : "none",
    readbackHex: after && after.ok ? after.hex : null,
    matched: matched,
    changed: changed,
    beforeHex: before && before.ok ? before.hex : null,
    layer: li.ok ? { id: li.id, name: li.name, kind: li.kind } : (info.layer || null),
    locked: li.ok ? { all: li.allLocked, pixels: li.pixelsLocked } : null,
    docName: info.docName || null,
    docMode: info.mode || null,
    hasSelection: sel,
    fgRestored: chosen ? chosen.fgRestored : undefined,
    attempts: attempts,
    error: error,
  };
}

/* ------------------------------------------------------ 置入素材（M2） */

/*
 * ════════════════════════════════════════════════════════════════════════
 * ★★★ 置入的**唯一可行**路线：Entry → 会话令牌 → `placeEvent` ★★★
 * ════════════════════════════════════════════════════════════════════════
 * 2026-10-10 真机（PS 27.2 / UXP 9.0.2）自检 S21 实测：
 *
 *   · 把**裸路径**（`D:\…\401.png`）放进 `placeEvent` 的 `_path` →
 *     `Error: invalid file token used`
 *     → Photoshop 的 AM 层要的**不是路径，而是 UXP 授权过的「文件令牌」**。
 *   · 令牌只能由 **Entry 对象**换出来（`localFileSystem.createSessionToken(entry)`）。
 *     而能拿到 Entry 的途径只有两条：
 *       ① 插件自己的 PluginData（沙箱内）；
 *       ② 用户经**文件选择器**显式授权。
 *   · 用户的 `asset.absPath`（`D:\vellum_workspace\…`）两者都不是。
 *
 * ⇒ **「按 absPath 直连置入」在 UXP 架构上不成立** —— 这不是偏好问题。
 *   所以契约 §六 的 handoff 搬运（软件侧把原图拷进我们的 `handoff/`）**是必需的**，
 *   而且恰好把文件送进了我们**能拿到 Entry** 的目录 —— 契约的设计比它自己写的理由更硬。
 *
 * 描述符本身的形状照抄 @alisaitteke/photoshop-mcp 的工作实现（`dist/api/extendscript.js`
 * 的 `placeImage()`，逐句翻成 ActionJSON）：
 *   executeAction(cTID('Plc '), desc)        →  _obj:"placeEvent"
 *   desc.putPath(cTID('null'), imageFile)    →  null:{_path, _kind:"local"}
 *   desc.putEnumerated('FTcs','QCSt','Qcsa') →  freeTransformCenterState:{quadCenterState, QCSAverage}
 *   desc.putObject('Ofst','Ofst', offset)    →  offset:{_obj:"offset", horizontal/vertical}
 * 唯一改动：把 `_path` 的值从路径换成**令牌**。
 */

function placeDesc(pathOrToken) {
  return {
    _obj: "placeEvent",
    null: { _path: String(pathOrToken), _kind: "local" },
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: 0 },
      vertical: { _unit: "pixelsUnit", _value: 0 },
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/**
 * 把一个 UXP File entry 换成 batchPlay 能认的会话令牌。
 * ⚠️ `createSessionToken` 是 UXP 7.1+ 的 API，取不到就如实降级（不当成"能用"）。
 * @returns {Promise<{ok:boolean, token?:string, error?:string}>}
 */
async function sessionTokenFor(entry) {
  if (!entry) return { ok: false, error: "没有 Entry 对象" };
  let lfs = null;
  try {
    lfs = uxpNS && uxpNS.storage && uxpNS.storage.localFileSystem;
  } catch {
    lfs = null;
  }
  if (!lfs || typeof lfs.createSessionToken !== "function") {
    return { ok: false, error: "uxp.storage.localFileSystem.createSessionToken 不存在（UXP < 7.1？）" };
  }
  try {
    const token = await lfs.createSessionToken(entry);
    if (!token) return { ok: false, error: "createSessionToken 返回空" };
    return { ok: true, token: String(token) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** 当前文档的图层数；拿不到返回 -1（"未知"≠"0"）。 */
function countLayers() {
  try {
    const d = app.activeDocument;
    if (!d || !d.layers) return -1;
    return d.layers.length;
  } catch {
    return -1;
  }
}

/**
 * 置入一个文件到当前文档（= PS 菜单「文件 › 置入嵌入的对象」）。
 * @param {object|string} source **必须是 UXP File entry**（或已换好的会话令牌字符串）。
 *   传裸路径会**立即**返回可读错误 —— 那条路真机实测过，不通（见本节顶部长注释）。
 * @param {object} [opts] { verify:"change"|"none" }
 */
async function placeFile(source, opts) {
  const o = opts || {};
  const mode = o.verify || "change";

  if (!source) return { ok: false, verified: "none", error: "没有给文件（需要 UXP File entry）" };
  if (typeof source === "string") {
    return {
      ok: false,
      verified: "none",
      noToken: true,
      error: "batchPlay 不接受裸路径 —— 真机实测报 `invalid file token used`；" +
        "必须先用 data.entryIn()/文件选择器拿到 Entry，再 sessionTokenFor() 换令牌",
    };
  }

  if (!hasDocument()) {
    return {
      ok: false, verified: "none", noDocument: true, noToken: false,
      error: "没有打开的文档 —— 置入需要先有一个目标文档",
    };
  }

  const tok = await sessionTokenFor(source);
  const label = (function () {
    try {
      return source.name || source.nativePath || "(entry)";
    } catch {
      return "(entry)";
    }
  })();

  if (!tok.ok) {
    return { ok: false, verified: "none", file: label, error: "换会话令牌失败：" + tok.error };
  }

  const before = docInfo() || {};
  const layersBefore = countLayers();

  try {
    await runModal(async () => {
      await batchPlay([placeDesc(tok.token)], {});
    }, "Vellum 工具箱：置入素材");
  } catch (e) {
    return {
      ok: false, file: label, via: "placeEvent", verified: "none",
      layersBefore: layersBefore, error: msg(e),
    };
  }

  const after = docInfo() || {};
  const layersAfter = countLayers();
  const changed = layersBefore >= 0 && layersAfter >= 0 && layersAfter > layersBefore;

  return {
    ok: mode === "none" ? true : changed || layersAfter < 0, // 读不到图层数时不判死
    file: label,
    via: "placeEvent",
    verified: layersAfter >= 0 ? "change" : "none",
    layersBefore: layersBefore,
    layersAfter: layersAfter,
    changed: changed,
    token: tok.token.slice(0, 18) + "…",
    layer: after.layer || null,
    docName: after.docName || null,
  };
}

/**
 * 判断某个**绝对路径**能不能变成 Entry（= 直连置入是否可行）。
 * 只读探测，不改任何文档 —— 用来把"平台给不给这个能力"这件事问清楚，
 * 而不是靠猜。结果由自检 S22 记录。
 * @returns {Promise<{ok:boolean, got?:boolean, name?:string, error?:string}>}
 */
async function canEntryFromUrl(url) {
  let lfs = null;
  try {
    lfs = uxpNS && uxpNS.storage && uxpNS.storage.localFileSystem;
  } catch {
    lfs = null;
  }
  if (!lfs || typeof lfs.getEntryWithUrl !== "function") {
    return { ok: false, error: "getEntryWithUrl 不存在" };
  }
  try {
    const e = await lfs.getEntryWithUrl(url);
    return { ok: true, got: !!e, name: e ? e.name : null };
  } catch (e) {
    return { ok: true, got: false, error: msg(e) };
  }
}

/* ------------------------------------------------- 临时文档（自检专用） */

/**
 * 建一个临时文档 —— 只给自检用，跑完必须 closeDocument 掉。
 * 为什么要有它：填充是**破坏性**的，绝不能拿用户的图去验证。
 * 在一个我们完全掌控的纯白小文档上填色 + 像素回读，才敢说"这个确实能填"。
 *
 * ⚠️ `documents.add` 的参数在各版本间有差异（mode 取值、"RGB" vs "RGBColor"），
 *    所以按「最详尽 → 最简」依次试，第一次成功就收工。
 */
async function createScratchDoc(opts) {
  const o = opts || {};
  const size = o.size || 32;
  const name = o.name || "Vellum 自检临时文档";
  const variants = [
    { width: size, height: size, resolution: 72, mode: "RGB", initialFill: "white", name: name },
    { width: size, height: size, resolution: 72, mode: "RGB", name: name },
    { width: size, height: size, resolution: 72, initialFill: "white" },
    { width: size, height: size },
  ];
  const errs = [];
  for (const v of variants) {
    try {
      let made = null;
      await runModal(async () => {
        made = await app.documents.add(v);
      }, "Vellum 工具箱：建临时文档");
      if (made && made.id !== undefined && made.id !== null) {
        return { ok: true, id: made.id, name: made.name, mode: made.mode, params: Object.keys(v), errors: errs };
      }
      errs.push("add(" + Object.keys(v).join(",") + ") 没返回文档");
    } catch (e) {
      errs.push("add(" + Object.keys(v).join(",") + ")：" + msg(e));
    }
  }
  return { ok: false, error: errs.join("；"), errors: errs };
}

/** 关文档（默认不保存）。自检收尾用，失败也要如实返回。 */
async function closeDocument(id, opts) {
  const o = opts || {};
  const docId = id;
  const errs = [];
  // SaveOptions 的两种写法都试：常量对象 / 字符串。绝不落到"弹保存对话框"那条路
  // （那会把自检卡死在模态里）。
  const candidates = [];
  try {
    if (constants && constants.SaveOptions && constants.SaveOptions.DONOTSAVECHANGES) {
      candidates.push(constants.SaveOptions.DONOTSAVECHANGES);
    }
  } catch {
    /* 忽略 */
  }
  candidates.push("saveOptions.dontSaveChanges");

  for (const save of candidates) {
    try {
      let found = null;
      await runModal(async () => {
        const docs = app.documents;
        for (let i = 0; i < docs.length; i++) {
          if (docs[i].id === docId) found = docs[i];
        }
        if (!found) throw new Error("找不到文档 id=" + docId);
        await found.close(save);
      }, "Vellum 工具箱：关闭临时文档");
      return { ok: true, save: String(save), errors: errs };
    } catch (e) {
      errs.push(String(save) + "：" + msg(e));
    }
  }
  if (o.keep) return { ok: false, keep: true, errors: errs };
  return { ok: false, error: errs.join("；"), errors: errs };
}

/* --------------------------------------------------------------- 其他 */

/** 当前是否打开了文档（调色板不依赖它，但别的工具要）。 */
function hasDocument() {
  try {
    return !!(app.documents && app.documents.length > 0);
  } catch {
    return false;
  }
}

module.exports = {
  app,
  core,
  action,
  batchPlay,
  runModal,
  readColor,
  setColor,
  setColorHex,
  restoreColor,
  extractRGB,
  rgbToHex,
  hexToRgb,
  clamp255,
  hasDocument,
  /* v0.2.2 新增 */
  fillLayer,
  fillDescColor,
  fillDescForeground,
  readLayerAvgColor,
  docInfo,
  hasSelection,
  createScratchDoc,
  closeDocument,
  /* v0.2.3 新增：图层类型判定 + 内容图层改色 */
  layerInfo,
  classifyLayer,
  kindCN,
  fillPreflight,
  contentColorDescA,
  contentColorDescB,
  makeSolidColorLayer,
  /* v0.2.4 新增：文字图层改色 */
  textColorDesc,
  makeTextLayer,
  /* v0.2.7 新增：置入素材（M2 素材库） */
  placeFile,
  placeDesc,
  sessionTokenFor,
  canEntryFromUrl,
  countLayers,
  RASTER_KINDS,
  CONTENT_KINDS,
  KIND_CN,
};
