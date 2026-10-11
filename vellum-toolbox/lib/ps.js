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
    // v0.3.0：补**画布宽高** —— 「九宫格落点」算 offset 要用它（见本文件「落点」一节）。
    // ⚠️ 取的是 UXP DOM 的 `document.width/height`（像素文档里就是 px）。
    //    真机上由自检 S24/S25 把它和实际 bounds 对照，取不到就是 null（不猜、不默认 1）。
    const num = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && "_value" in v) v = v._value;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    return {
      docId: d.id,
      docName: d.name,
      mode: d.mode,
      docW: num(d.width),
      docH: num(d.height),
      resolution: num(d.resolution),
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

/* ------------------------------------------------- 落点（v0.3.0 新增） */

/*
 * ════════════════════════════════════════════════════════════════════════
 * ★ `placeEvent` 的落点规律 —— 2026-10-11 真机实测（MCP，临时文档 400×400、素材 320×240）
 * ════════════════════════════════════════════════════════════════════════
 *   默认（offset 0,0）  → 图层 bounds = 40, 80, 360, 320   ⇒ **画布居中、且不缩放**
 *   offset (64, 48)     → 图层 bounds = 104, 128, 424, 368 ⇒ Δ **正好 +64 / +48**
 *
 * ⇒ 两条结论：
 *   ① 默认落点是"**画布居中**"（不是左上、不是视图中心）；
 *   ② `offset` 与图层位移 **1:1 精确**，是像素级的定位参数。
 *
 * 于是"把素材放到画布上的 (x, y)"就是一道简单算术：
 *     offset = (x − (画布宽 − 素材宽) / 2,  y − (画布高 − 素材高) / 2)
 * 而这两个尺寸插件都有：画布来自 `docInfo()`，素材宽高来自镜像的
 * `asset.width / asset.height`（契约 §5.4 必填）—— **零新能力**。
 *
 * ⚠️ 它**只管位置、不管尺寸**（素材不会被缩放）。"置入后按矩形缩放"未验，不许当成已有。
 */

/*
 * ════════════════════════════════════════════════════════════════════════
 * ★ 默认落点的完整规律 —— 2026-10-11 插件侧自检 S24 真机实测（补齐）
 * ════════════════════════════════════════════════════════════════════════
 * S24 在临时文档（400×400）上量到：
 *   ① **没有选区**：置入 bounds = `40, 80, 360, 320` ⇒ 素材**居中于画布**
 *   ② **有选区** `120,140,320,300`（中心 220,220）：置入 bounds = `60, 100, 380, 340`
 *      ⇒ 素材中心正好在 (220,220) ⇒ **居中于选区**（仍然不缩放）
 *
 * ⇒ 统一规则：**默认落点 = "当前选区的中心"；没有选区时 = "画布中心"**。
 *
 * ⚠️ 这条规则有一个**必须处理的连带后果**：
 *    我们的 `offset` 是**相对默认落点**的位移 ⇒ 有选区时它是叠在**选区中心**上的。
 *    所以"九宫格锚点"绝不能拿画布中心当基准去算 offset，否则用户在有选区时选「左上」，
 *    素材会跑偏 —— 必须在**同一个基准**上做减法（见 `anchorOffset()` 的 `base` 参数）。
 */

/** 当前选区的 bounds（UXP DOM）。没有选区 / 读不到 → `null`（**不当作 0,0**）。 */
function readSelectionBounds() {
  try {
    const d = app.activeDocument;
    if (!d || !d.selection) return null;
    const b = d.selection.bounds;
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
}

/**
 * 置入的**默认落点中心** —— 有选区就是选区中心，没选区就是画布中心（见上面实测）。
 * @returns {{ok:true, cx:number, cy:number, from:"selection"|"canvas", sel?:object}
 *          |{ok:false, error:string}}
 */
function placeBaseCenter() {
  const info = docInfo() || {};
  const dW = info.docW;
  const dH = info.docH;
  if (!(dW > 0) || !(dH > 0)) return { ok: false, error: "读不到画布尺寸（docW/docH）" };
  const sel = readSelectionBounds();
  if (sel) {
    return {
      ok: true,
      cx: (sel.left + sel.right) / 2,
      cy: (sel.top + sel.bottom) / 2,
      from: "selection",
      sel: sel,
    };
  }
  return { ok: true, cx: dW / 2, cy: dH / 2, from: "canvas" };
}

/** 九宫格锚点（左上→右下）。UI 与自检都按这个顺序排。 */
const ANCHORS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
const ANCHOR_LABELS = {
  tl: "左上", tc: "上中", tr: "右上",
  ml: "左中", mc: "居中", mr: "右中",
  bl: "左下", bc: "下中", br: "右下",
};

/** 锚点的中文名（未收录的值原样返回，不猜）。 */
function anchorLabel(a) {
  return a ? ANCHOR_LABELS[a] || String(a) : "";
}

/**
 * 锚点 → `placeEvent` 的 offset。**纯函数**（可离线断言，不碰 PS）。
 *
 * @param {string} anchor 九宫格锚点，见 ANCHORS
 * @param {number} docW 画布宽（px）  @param {number} docH 画布高（px）
 * @param {number} imgW 素材宽（px）  @param {number} imgH 素材高（px）
 * @param {{cx:number,cy:number}} [base] **默认落点中心**（`placeBaseCenter()` 的结果）。
 *   省略 = 画布中心。⚠️ 有选区时**必须传**，否则 offset 会算歪（见本节顶部实测说明）。
 * @returns {{ok:true, x:number, y:number, offsetX:number, offsetY:number, base:object}
 *          |{ok:false, error:string}}
 *   `x`/`y` 是这个锚点想让**素材左上角**落在的文档坐标；offset 是相对"默认落点"的位移。
 */
function anchorOffset(anchor, docW, docH, imgW, imgH, base) {
  const dW = Number(docW), dH = Number(docH), iW = Number(imgW), iH = Number(imgH);
  if (![dW, dH, iW, iH].every((n) => isFinite(n) && n > 0)) {
    return { ok: false, error: "尺寸不合法（画布宽高与素材宽高都要是正数）" };
  }
  const key = String(anchor || "mc");
  if (ANCHORS.indexOf(key) < 0) {
    return { ok: false, error: "未知锚点：" + key };
  }
  const bcx = base && isFinite(base.cx) ? Number(base.cx) : dW / 2;
  const bcy = base && isFinite(base.cy) ? Number(base.cy) : dH / 2;
  // 以默认落点为准，素材左上角现在落在哪
  const baseLeft = bcx - iW / 2;
  const baseTop = bcy - iH / 2;
  // 素材左上角的三条候选位置：贴左 / 居中 / 贴右（上下同理）
  const cols = { l: 0, c: (dW - iW) / 2, r: dW - iW };
  const rows = { t: 0, m: (dH - iH) / 2, b: dH - iH };
  const x = cols[key[1]];
  const y = rows[key[0]];
  // 素材比画布大时，上面三条候选会得到负值 —— 那是**正常**的（居中就该两边都溢出），
  // 不做特判：公式本身在这个情形下依然是对的意思（贴左就是把左边缘对齐画布左边缘）。
  return {
    ok: true,
    x: Math.round(x),
    y: Math.round(y),
    offsetX: Math.round(x - baseLeft),
    offsetY: Math.round(y - baseTop),
    base: {
      cx: Math.round(bcx),
      cy: Math.round(bcy),
      left: Math.round(baseLeft),
      top: Math.round(baseTop),
    },
  };
}

/**
 * 建一个**矩形选区**（v0.3.0）。
 * ⚠️ 写法是**真机试出来的**：2026-10-11 自检 S24 在同一台机器上试了四种：
 *     · `DOM.selection.select([[x1,y1],[x2,y2]])`   ✗ 失败
 *     · `DOM.selection.select([x1,y1,x2,y2])`       ✗ 失败
 *     · `DOM.selection.selectAll()`                 ✗ 失败（saveDocumentSelection may modify…）
 *     · **`setd` + `Chnl/fsel` + `Rctn` 描述符**     ✅ **成功**（S24 建出 120,140,320,300）
 *   同一件事在 **ExtendScript** 上是**反过来的**（`selectAll` 行、区域写法全不行）——
 *   两条 DOM 的可用性不能互相推断，这也是当时坚持要单独测一遍的原因。
 * @param {{left:number,top:number,right:number,bottom:number}} rect
 */
async function setSelectionRect(rect) {
  if (!rect || ![rect.left, rect.top, rect.right, rect.bottom].every((n) => isFinite(Number(n)))) {
    return { ok: false, error: "rect 不合法（要四个数字）" };
  }
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  try {
    await runModal(async () => {
      await batchPlay([
        {
          _obj: "set",
          _target: [{ _property: "selection", _ref: "channel" }],
          to: {
            _obj: "rectangle",
            top: { _unit: "pixelsUnit", _value: Number(rect.top) },
            left: { _unit: "pixelsUnit", _value: Number(rect.left) },
            bottom: { _unit: "pixelsUnit", _value: Number(rect.bottom) },
            right: { _unit: "pixelsUnit", _value: Number(rect.right) },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], {});
    }, "Vellum 工具箱：建立选区");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  const got = readSelectionBounds();
  return { ok: !!got, sel: got, error: got ? null : "命令执行了但读不回选区 bounds" };
}

/** 置入后读回活动图层的 bounds（用来**校验落点真的生效了**，不是"命令没报错"）。 */function readActiveLayerBounds() {
  try {
    const d = app.activeDocument;
    const l = d && d.activeLayers && d.activeLayers[0];
    if (!l || !l.bounds) return { ok: false, error: "拿不到活动图层的 bounds" };
    const b = l.bounds;
    const num = (v) => (v && typeof v === "object" && "_value" in v ? v._value : v);
    const out = {
      left: Number(num(b.left)),
      top: Number(num(b.top)),
      right: Number(num(b.right)),
      bottom: Number(num(b.bottom)),
    };
    if (![out.left, out.top, out.right, out.bottom].every((n) => isFinite(n))) {
      return { ok: false, error: "bounds 不是四个数字：" + JSON.stringify(b) };
    }
    return { ok: true, bounds: out, layer: { id: l.id, name: l.name } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.3.3：把置入进来的图层**精确做成一个目标矩形**（尺寸 + 位置一起校正）
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 为什么必须有这一步 —— 2026-10-11 真机事故（用户报「置入尺寸不对」）
 *
 *   现象：素材 1500×1500 px 置入到 1920×1080 画布后，**变成 360×360**。
 *   证据（同一批日志）：
 *     expect=210,-210,1710,1290（按素材 1500×1500 算的期望）
 *     landed=693,360,1053,720  ⇒ 实际只有 **360×360**
 *   归因（两条独立读数交叉验证）：
 *     · 源图 `图一(1).jpg` 的 Exif `XResolution = 300`（本机解析）
 *     · 比值 360 / 1500 = **0.24 = 72 / 300**
 *   ⇒ **PS 的「置入嵌入对象」是按「物理尺寸」放的**：源图 5 英寸 × 72 ppi 画布
 *     = 360 px。它**不是** 1:1 拷像素。
 *
 *   ⇒ 于是 `offset` 这套"像素级位移"的定位方式**建立在一个错的尺寸假设上**：
 *     插件以为素材是 1500 px 宽、按 1500 算锚点，而画布上实际只有 360 px。
 *     位置和尺寸一起错。
 *
 * 🔴 修法：**不猜 PPI，改成自校正**（置入 → 量实际 → 缩放 → 平移 → 再量）。
 *   这样与"源图多少 ppi / 画布多少 ppi"完全无关，也不需要在契约里加字段。
 *
 * 用到的两个 API 是**官方文档化**的 DOM 方法（不是手拼的 batchPlay 描述符）——
 *   `Layer.scale(widthPercent, heightPercent)`  Adobe ps_reference/classes/layer
 *   `Layer.translate(horizontalPx, verticalPx)` 同上（论坛实例同为 scale + translate 组合）
 * ⚠️ `scale()` 的**锚点未在文档里写明**，所以这里**不假设它**：
 *   缩放后**重新读一次 bounds**，再按"中心对齐目标中心"算 translate 的差值。
 *   ⇒ 锚点是什么都不影响结果（这也是不用 batchPlay `transform` 的原因：
 *     那个描述符的 `_target` 形状我们没有真机证据，属于"禁止猜"的范围）。
 */
async function applyLayerRect(rect) {
  const want = {
    left: Number(rect && rect.left),
    top: Number(rect && rect.top),
    right: Number(rect && rect.right),
    bottom: Number(rect && rect.bottom),
  };
  if (![want.left, want.top, want.right, want.bottom].every(isFinite)) {
    return { ok: false, error: "目标矩形不合法（要四个数字）" };
  }
  const wantW = want.right - want.left;
  const wantH = want.bottom - want.top;
  if (!(wantW > 0) || !(wantH > 0)) {
    return { ok: false, error: "目标矩形的宽高必须为正" };
  }
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };

  const b0 = readActiveLayerBounds();
  if (!b0.ok) return { ok: false, error: "量不到置入后的图层：" + b0.error };
  const w0 = b0.bounds.right - b0.bounds.left;
  const h0 = b0.bounds.bottom - b0.bounds.top;
  if (!(w0 > 0) || !(h0 > 0)) {
    return { ok: false, error: "置入后的图层宽高为 0（可能整幅透明）", before: b0.bounds };
  }

  const steps = [];
  const needScale = Math.abs(w0 - wantW) > 1 || Math.abs(h0 - wantH) > 1;
  if (needScale) {
    const pctW = (wantW / w0) * 100;
    const pctH = (wantH / h0) * 100;
    try {
      await runModal(async () => {
        const l = app.activeDocument.activeLayers[0];
        if (!l || typeof l.scale !== "function") {
          throw new Error("活动图层没有 scale()（该 UXP 版本未暴露）");
        }
        await l.scale(pctW, pctH);
      }, "Vellum 工具箱：校正置入尺寸");
      steps.push("scale=" + pctW.toFixed(2) + "%, " + pctH.toFixed(2) + "%");
    } catch (e) {
      return {
        ok: false, scaled: false, before: b0.bounds, steps: steps,
        error: "缩放失败：" + msg(e),
      };
    }
  }

  const b1 = readActiveLayerBounds();
  if (!b1.ok) return { ok: false, error: "缩放后量不到 bounds：" + b1.error, steps: steps };
  const dx = (want.left + want.right) / 2 - (b1.bounds.left + b1.bounds.right) / 2;
  const dy = (want.top + want.bottom) / 2 - (b1.bounds.top + b1.bounds.bottom) / 2;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    try {
      await runModal(async () => {
        const l = app.activeDocument.activeLayers[0];
        if (!l || typeof l.translate !== "function") {
          throw new Error("活动图层没有 translate()（该 UXP 版本未暴露）");
        }
        await l.translate(dx, dy);
      }, "Vellum 工具箱：校正置入位置");
      steps.push("translate=" + dx.toFixed(1) + ", " + dy.toFixed(1));
    } catch (e) {
      return {
        ok: false, scaled: needScale, bounds: b1.bounds, steps: steps,
        error: "位移失败：" + msg(e),
      };
    }
  }

  const b2 = readActiveLayerBounds();
  if (!b2.ok) return { ok: false, error: "校正后量不到 bounds：" + b2.error, steps: steps };
  const hit =
    Math.abs(b2.bounds.left - want.left) <= 1 &&
    Math.abs(b2.bounds.top - want.top) <= 1 &&
    Math.abs(b2.bounds.right - want.right) <= 1 &&
    Math.abs(b2.bounds.bottom - want.bottom) <= 1;

  return {
    ok: true,
    hit: hit,
    scaled: needScale,
    steps: steps,
    before: b0.bounds,
    after: b2.bounds,
    w: Math.round(b2.bounds.right - b2.bounds.left),
    h: Math.round(b2.bounds.bottom - b2.bounds.top),
    error: hit ? null : "校正后仍与目标差 >1px",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.3.6：置入进来的图层**按素材名命名**
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要这一步：PS 置入时拿"**被置入的那个文件的名字**"当图层名，
 * 而契约 §六 规定交接文件是**固定名** `incoming.<ext>`（每次覆盖 ⇒ 好清理、防竞态）
 * ⇒ 每个新图层都叫 `incoming`，图层面板里分不清谁是谁。
 *
 * 修法：置入后自己改名，名字取自**镜像里的 `asset.name`**（用户在设计软件里看到的名字）
 * ⇒ **不需要任何文件命名规范**，也不需要动契约。
 *
 * ⚠️ **改不掉的那部分**（要如实告知用户）：智能对象内部记录的**链接源文件名**仍然是
 *    `incoming.<ext>`。图层面板显示的是我们设的名字 ✓，但"编辑智能对象内容 / 链接面板"
 *    里露出来的还是 incoming。要连那个也改，只能让软件侧用**原文件名**交接
 *    —— 那要动契约（固定名是为了清理与防竞态），代价明显更大，暂不做。
 *
 * ⚠️ 命名规则（用户 2026-10-11 拍板）：
 *    ① **不带扩展名**（与 PS 原生置入一致：`t112.png` 置入后本来就叫 `t112`）
 *    ② 同名的加 **` (n)`** 区分，n 从 2 开始试到不重复为止
 */

/** PS 对图层名的长度上限（保守取 255；超长会被它自己截断/报错，不如我们先截）。 */
const LAYER_NAME_LIMIT = 255;

/**
 * 图层基名 = `asset.name` **去掉已知的 `asset.ext`**。
 * ⚠️ 只认 `asset.ext` 那个后缀，不用正则去砍"最后一个点" ——
 *    否则 `v1.2 终稿` 会被砍成 `v1`（名字里带点很常见，那不是扩展名）。
 */
function layerBaseName(asset) {
  const raw = String((asset && asset.name) || "").trim();
  if (!raw) return "";
  const ext = String((asset && asset.ext) || "").trim().toLowerCase();
  if (ext) {
    const tail = "." + ext;
    if (raw.toLowerCase().endsWith(tail) && raw.length > tail.length) {
      // ⚠️ 去完扩展名可能留个**尾空格**（`报告 .png`）—— 图层名不该带着它，顺手 trim 掉
      return raw.slice(0, raw.length - tail.length).trim();
    }
  }
  return raw;
}

/** 按后缀拼名字，并把总长压进上限（先截基名、再拼后缀，避免截掉后缀本身）。 */
function fitName(base, suffix, limit) {
  const lim = limit || LAYER_NAME_LIMIT;
  const room = lim - String(suffix).length;
  const b = String(base);
  return (b.length > room ? b.slice(0, Math.max(1, room)) : b) + String(suffix);
}

/** 在"已被占用的名字"里取一个可用的：原名 → `原名 (2)` → `原名 (3)` → … */
function uniqueLayerName(base, taken) {
  const used = taken || {};
  const b = String(base || "").trim() || "素材";
  if (!used[b]) return fitName(b, "", LAYER_NAME_LIMIT);
  for (let n = 2; n < 10000; n++) {
    const cand = fitName(b, " (" + n + ")", LAYER_NAME_LIMIT);
    if (!used[cand]) return cand;
  }
  return fitName(b, " (" + Date.now() + ")", LAYER_NAME_LIMIT);
}

/** 当前文档里所有图层的名字（**递归进组**）—— 用来判重名。 */
function activeLayerNames() {
  const set = {};
  try {
    const doc = app.activeDocument;
    if (!doc) return { ok: false, error: "没有打开的文档", names: set };
    const walk = (layers) => {
      const arr = layers || [];
      for (let i = 0; i < arr.length; i++) {
        const l = arr[i];
        set[String(l.name || "")] = true;
        if (l.layers && l.layers.length) walk(l.layers);
      }
    };
    walk(doc.layers);
    return { ok: true, names: set };
  } catch (e) {
    return { ok: false, error: msg(e), names: set };
  }
}

/** 读回活动图层的名字（判据不许只看"命令没报错"）。 */
function readActiveLayerName() {
  try {
    const doc = app.activeDocument;
    const l = doc && doc.activeLayers && doc.activeLayers[0];
    return { ok: !!l, name: l ? String(l.name || "") : null };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * 给**刚置入进来的活动图层**命名：去重 → 改名 → **读回验证**。
 * @param {object} asset 契约 §5.4 的 asset（用 name / ext）
 * @returns {Promise<{ok:boolean, want?:string, base?:string, got?:string, ambiguous?:boolean, error?:string}>}
 *   `ambiguous:true` 表示"读回的名字对不上，但文档里**确实存在**这个名字的图层" ——
 *   多半是 PS 给同名图层自动加了副本后缀，不算硬失败（自检按这个区分报告）。
 */
async function renameInsertedLayer(asset) {
  const base = layerBaseName(asset);
  const names = activeLayerNames();
  if (!names.ok) return { ok: false, error: "读不到图层列表：" + names.error };
  const want = uniqueLayerName(base || "素材", names.names);

  try {
    await runModal(async () => {
      const doc = app.activeDocument;
      const l = doc && doc.activeLayers && doc.activeLayers[0];
      if (!l) throw new Error("没有活动图层");
      l.name = want; // UXP 的 Layer.name 是同步属性（赋值仍需在 modal 里）
    }, "Vellum 工具箱：按素材名命名图层");
  } catch (e) {
    return { ok: false, base: base, want: want, error: "改名失败：" + msg(e) };
  }

  const after = readActiveLayerName();
  const got = after.ok ? after.name : "";
  return {
    ok: got === want,
    base: base,
    want: want,
    got: got,
    ambiguous: got !== want && !!names.names[got],
    error: got === want ? null : "读回的名字是「" + got + "」，期望「" + want + "」",
  };
}

function placeDesc(pathOrToken, offset) {
  return {
    _obj: "placeEvent",
    null: { _path: String(pathOrToken), _kind: "local" },
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: offset && isFinite(offset.x) ? Number(offset.x) : 0 },
      vertical: { _unit: "pixelsUnit", _value: offset && isFinite(offset.y) ? Number(offset.y) : 0 },
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

  // v0.3.0：「九宫格落点」—— opts.offset 给出相对"画布居中"的像素位移（见本文件「落点」一节）
  // v0.3.3：`opts.targetRect` 一旦给出就**不再用 offset** ——
  //   改成"先按默认落点置入，再 scale + translate 精确做成那个矩形"。
  //   原因见 `applyLayerRect()` 顶部的真机事故：`offset` 的前提
  //   （"素材在画布上就是它的像素宽高"）在**源图 ppi ≠ 画布 ppi** 时不成立
  //   （实测 1500 px @300ppi 置入 72ppi 画布 → 只有 360 px）。
  const wantRect = o.targetRect || null;
  const wantOffset =
    !wantRect && o.offset && (isFinite(o.offset.x) || isFinite(o.offset.y))
      ? { x: Number(o.offset.x) || 0, y: Number(o.offset.y) || 0 }
      : null;

  try {
    await runModal(async () => {
      await batchPlay([placeDesc(tok.token, wantOffset)], {});
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

  /* ---- v0.3.3：精确落点（尺寸 + 位置一次做准）----
     ⚠️ 只在"图层真的多出来了"（changed）时才动它 —— 万一置入失败，
        校正会把用户**原有的**图层缩放/挪走，那是不可逆的破坏。 */
  let fix = null;
  if (changed && wantRect) {
    fix = await applyLayerRect(wantRect);
  } else if (changed && o.anchorPlace) {
    /* ---- v0.3.5：素材**缺 `width`/`height`** 时的兜底（契约 §5.4：这两个字段可能为 null）----
       拿不到像素尺寸 ⇒ 不知道"它本该多大" ⇒ 既**不猜**、也**不整个放弃**：
       把 PS 给的实际尺寸**当成目标尺寸**，只做**定位**（尺寸保持原样）。
       收益：落点九宫格照样生效；代价：尺寸由 PS 决定（本来也无从校正）。
       ⚠️ 对照：没有这条兜底时 `anchorInfo()` 会返回"算不出来"，调用方于是**什么都不传**
          ⇒ 退回最原始的置入（画布居中）——用户选的格子被**静默忽略**。 */
    const b0 = readActiveLayerBounds();
    if (!b0.ok) {
      fix = { ok: false, error: "量不到置入后的尺寸：" + b0.error, steps: [] };
    } else {
      const aw = b0.bounds.right - b0.bounds.left;
      const ah = b0.bounds.bottom - b0.bounds.top;
      const ap = o.anchorPlace || {};
      const r = anchorOffset(ap.anchor, ap.docW, ap.docH, aw, ah);
      if (!r.ok || !(aw > 0) || !(ah > 0)) {
        fix = { ok: false, error: "算锚点失败：" + (r.error || "实际尺寸为 0"), steps: [] };
      } else {
        fix = await applyLayerRect({
          left: r.x,
          top: r.y,
          right: r.x + aw,
          bottom: r.y + ah,
        });
        if (fix) {
          fix.byActualSize = true; // 告诉调用方：这次是"只定位、没改尺寸"
          fix.anchor = ap.anchor;
        }
      }
    }
  }

  // 落点校验：读回真实 bounds。**判据是"落在期望矩形上"**，不是"命令没报错"。
  // v0.3.3：给了 targetRect 时以**校正后**的 bounds 为准。
  const rb = readActiveLayerBounds();
  let hitRect = null;
  if (rb.ok) {
    const b = fix && fix.ok && fix.after ? fix.after : rb.bounds;
    const actualW = Math.round(b.right - b.left);
    const actualH = Math.round(b.bottom - b.top);
    hitRect = {
      bounds: b,
      w: actualW,
      h: actualH,
      left: Math.round(b.left),
      top: Math.round(b.top),
    };
    if (o.expectRect) {
      const e = o.expectRect;
      // 允许 1px 的抗锯齿/取整误差
      hitRect.hit =
        Math.abs(b.left - e.left) <= 1 &&
        Math.abs(b.top - e.top) <= 1 &&
        Math.abs(b.right - e.right) <= 1 &&
        Math.abs(b.bottom - e.bottom) <= 1;
      hitRect.expectRect = e;
    }
  }

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
    docW: after.docW,
    docH: after.docH,
    requestedOffset: wantOffset,
    requestedRect: wantRect,
    fix: fix,
    rect: hitRect,
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

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.3.8：M3「表格生成」地基 —— ① 矢量线条（矩形形状图层）
 * ═══════════════════════════════════════════════════════════════════════════
 * 表格框线要「矢量 + 可继续编辑」⇒ 不能用像素图层画线（那是烘焙）。
 *
 * 描述符来源（**不是手拼**）：Adobe 社区一份 **ScriptListener 录制输出** ——
 *   「How do I automatically create a shape frame around an image?」
 *   community.adobe.com/t5/photoshop-ecosystem-discussions/how-do-i-automatically-create-a-shape-frame-around-an-image/m-p/14158701
 * 录制原文（ExtendScript）→ actionJSON 的逐项对应：
 *   executeAction(cTID('Mk '), desc)                     → _obj:"make"
 *   desc.putReference(cTID('null'), ref{contentLayer})   → _target:[{_ref:"contentLayer"}]
 *   desc.putObject(cTID('Usng'), cTID('contentLayer'), d) → using:{_obj:"contentLayer", …}
 *        d.type  = { solidColorLayer: { color: RGBColor } }
 *        d.shape = { rectangle: { unitValueQuadVersion:1,
 *                                 top/left/bottom/right + 四角 topRight/topLeft/bottomLeft/bottomRight } }
 *        d.strokeStyle = { strokeStyleVersion:2, strokeEnabled, fillEnabled,
 *                          strokeStyleLineWidth, strokeStyleLineDashOffset,
 *                          strokeStyleMiterLimit,
 *                          strokeStyleLineCapType(枚举 strokeStyleButtCap),
 *                          strokeStyleLineJoinType(枚举 strokeStyleMiterJoin) }
 *
 * ⚠️ 录制里还有 `strokeStyleLineAlignment`，但**它的枚举值原文没露出来** ⇒
 *    这里刻意**不写**那一项（宁可少一项，也不猜一个枚举值）。
 * ⚠️ 一条**细矩形**就是一条表格线；四角圆角半径也能给（表格可做圆角）。
 *    形状图层的 `kind` 是 `solidColor`（内容图层 = 矢量），**不是 pixel** ⇒
 *    这正是"可继续编辑"的判据（见 v0.2.3 那张 kind 表）。
 */

/**
 * 建「矩形形状图层」的描述符（**纯函数**，可离线断言命令形状）。
 * @param {{left:number,top:number,right:number,bottom:number}} rect
 * @param {{r:number,g:number,b:number}} rgb
 * @param {object} [opts] { radius:number|{tl,tr,bl,br}, stroke:boolean, strokeWidth:number, name:string }
 * @returns {object} ActionDescriptor
 */
function rectShapeMakeDesc(rect, rgb, opts) {
  const o = opts || {};
  const px = (v) => ({ _unit: "pixelsUnit", _value: Number(v) || 0 });
  const r = o.radius;
  let radii = { tl: 0, tr: 0, bl: 0, br: 0 };
  if (typeof r === "number") {
    radii = { tl: r, tr: r, bl: r, br: r };
  } else if (r && typeof r === "object") {
    radii = {
      tl: Number(r.tl) || 0, tr: Number(r.tr) || 0,
      bl: Number(r.bl) || 0, br: Number(r.br) || 0,
    };
  }

  const using = {
    _obj: "contentLayer",
    type: {
      _obj: "solidColorLayer",
      color: {
        _obj: "RGBColor",
        red: clamp255(rgb.r), grain: clamp255(rgb.g), blue: clamp255(rgb.b),
      },
    },
    shape: {
      _obj: "rectangle",
      unitValueQuadVersion: 1,
      top: px(rect.top),
      left: px(rect.left),
      bottom: px(rect.bottom),
      right: px(rect.right),
      topRight: px(radii.tr),
      topLeft: px(radii.tl),
      bottomLeft: px(radii.bl),
      bottomRight: px(radii.br),
    },
  };
  if (o.name) using.name = String(o.name);

  // 描边那一段是"有则更完整、无则退回填充"的**候选**：两条都由录制输出支持，
  // 由调用方按序试并如实记录哪一条被接受（见 makeRectShapeLayer）。
  if (o.__noStrokeStyle !== true) {
    using.strokeStyle = {
      _obj: "strokeStyle",
      strokeStyleVersion: 2,
      strokeEnabled: !!o.stroke,
      fillEnabled: true,
      strokeStyleLineWidth: px(o.strokeWidth || 2),
      strokeStyleLineDashOffset: { _unit: "pointsUnit", _value: 0 },
      strokeStyleMiterLimit: 100,
      strokeStyleLineCapType: { _enum: "strokeStyleLineCapType", _value: "strokeStyleButtCap" },
      strokeStyleLineJoinType: { _enum: "strokeStyleLineJoinType", _value: "strokeStyleMiterJoin" },
    };
  }

  return {
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: using,
    _options: { dialogOptions: "dontDisplay" },
  };
}

/**
 * 建一个**矩形形状图层**（矢量）—— 表格框线的画法。
 * @returns {Promise<{ok:boolean, via?:string, attempts?:string[], layer?:object, error?:string}>}
 */
async function makeRectShapeLayer(rect, rgb, opts) {
  const o = opts || {};
  if (!rect || ![rect.left, rect.top, rect.right, rect.bottom].every((n) => isFinite(Number(n)))) {
    return { ok: false, error: "rect 不合法（要四个数字）" };
  }
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };

  const before = countLayers();
  const attempts = [];
  // 两条候选：① 带 strokeStyle（录制原样） ② 不带（更保守）
  const variants = [
    { via: "withStrokeStyle", o: o },
    { via: "noStrokeStyle", o: Object.assign({}, o, { __noStrokeStyle: true }) },
  ];
  for (const v of variants) {
    const desc = rectShapeMakeDesc(rect, rgb, v.o);
    try {
      await runModal(async () => {
        await batchPlay([desc], {});
      }, "Vellum 工具箱：新建矩形形状图层");
      const after = countLayers();
      const added = before >= 0 && after >= 0 && after > before;
      attempts.push(v.via + "=已执行/图层" + (added ? "+1" : "未增加"));
      if (added) {
        const li = layerInfo();
        return {
          ok: true, via: v.via, attempts: attempts,
          layer: li.ok ? { id: li.id, name: li.name, kind: li.kind } : null,
          rect: {
            left: Number(rect.left), top: Number(rect.top),
            right: Number(rect.right), bottom: Number(rect.bottom),
          },
        };
      }
    } catch (e) {
      attempts.push(v.via + "=失败(" + msg(e) + ")");
    }
  }
  return { ok: false, attempts: attempts, error: "两条写法都没能建出图层" };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.3.8：M3 地基 —— ② 文字图层的精细参数
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ UXP 里**没有**"新建文字图层"的 DOM API ⇒ 建层必须走 batchPlay。
 *    描述符来源：**Adobe 官方样例** `layer-creation-js-sample/index.js`
 *    （official-samples/，与 docs/04 的记录一致）：
 *      using.textKey          文字内容
 *      using.textShape[0]     { char:{_enum:"char",_value:"box"}, bounds:{rectangle} }
 *                             ⇒ **框文本**（表格每格要用这个，不是点文本）
 *      using.textStyleRange[] { from, to, textStyle:{ fontName, fontStyleName,
 *                               size:{pointsUnit}, color:{RGBColor} } }
 *    ⚠️ 官方样例里 `char` 是 `box` + `bounds` 矩形 —— 这正是"每格一个文字框"要的。
 *
 * 建完之后，**字体/对齐/行距/颜色**优先走 **UXP DOM 的 `layer.textItem`**
 * （比手写 AM 描述符安全得多，且是官方文档化接口）。可写性与读回由自检 S32 钉死。
 */

/**
 * 建「框文本」文字图层的描述符（纯函数，可离线断言）。
 * @param {object} opts
 *   text, box:{left,top,right,bottom}, sizePt, rgb,
 *   fontName, fontStyleName
 */
function textLayerBoxDesc(opts) {
  const o = opts || {};
  const text = o.text === undefined || o.text === null ? "" : String(o.text);
  const px = (v) => ({ _unit: "pixelsUnit", _value: Number(v) || 0 });
  const b = o.box || { left: 0, top: 0, right: 200, bottom: 100 };
  const style = { _obj: "textStyle" };
  if (o.fontName) style.fontName = String(o.fontName);
  if (o.fontStyleName) style.fontStyleName = String(o.fontStyleName);
  style.size = { _unit: "pointsUnit", _value: Number(o.sizePt) || 12 };
  const rgb = o.rgb || { r: 0, g: 0, b: 0 };
  style.color = {
    _obj: "RGBColor",
    red: clamp255(rgb.r), grain: clamp255(rgb.g), blue: clamp255(rgb.b),
  };
  return {
    _obj: "make",
    _target: [{ _ref: "textLayer" }],
    using: {
      _obj: "textLayer",
      textKey: text,
      textShape: [
        {
          _obj: "textShape",
          char: { _enum: "char", _value: "box" },
          bounds: {
            _obj: "rectangle",
            top: px(b.top), left: px(b.left), bottom: px(b.bottom), right: px(b.right),
          },
        },
      ],
      textStyleRange: [
        {
          _obj: "textStyleRange",
          from: 0,
          to: text.length,
          textStyle: style,
        },
      ],
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 建一个框文本文字图层。 */
async function makeTextLayerBox(opts) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  const before = countLayers();
  try {
    await runModal(async () => {
      await batchPlay([textLayerBoxDesc(opts)], {});
    }, "Vellum 工具箱：新建文字图层（框文本）");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  const after = countLayers();
  const li = layerInfo();
  return {
    ok: before >= 0 && after > before,
    added: after - before,
    layer: li.ok ? { id: li.id, name: li.name, kind: li.kind } : null,
  };
}

/**
 * 活动图层是不是「文字图层」，且**它的 `textItem` 在不在**。
 * 用来把 Q2 的两半分开问：① 建得出来吗（batchPlay）② 精细参数归谁管（DOM）。
 * ⚠️ 配一个**一定不存在**的对照属性名，避免"读到自己设的输入"式假阳性。
 * @returns {object} 一组读数，不做判断
 */
function textItemProbe() {
  const out = {
    hasDoc: hasDocument(),
    kind: null,
    textItemExists: false,
    notARealThing: null,
    keys: [],
    values: {},
    errors: {},
  };
  try {
    const doc = app.activeDocument;
    const l = doc && doc.activeLayers && doc.activeLayers[0];
    if (!l) return out;
    const safe = (fn) => {
      try {
        return fn();
      } catch (e) {
        return undefined;
      }
    };
    out.kind = safe(() => l.kind) || null;
    const ti = safe(() => l.textItem);
    out.textItemExists = !!ti;
    out.notARealThing = safe(() => l.__vellumNotARealThing) === undefined ? "undefined" : "有值";
    if (!ti) return out;
    const props = ["contents", "font", "fontSize", "justification", "leading", "tracking", "color", "autoKerning"];
    for (const p of props) {
      const v = safe(() => ti[p]);
      if (v === undefined) {
        out.errors[p] = "读不到";
      } else {
        out.keys.push(p);
        out.values[p] = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      }
    }
  } catch (e) {
    out.errors.top = msg(e);
  }
  return out;
}

/** DOM 可写的 textItem 属性名（自检 S32 会逐个试写并读回）。 */
const TEXT_ITEM_WRITABLE = ["contents", "fontSize", "justification", "leading", "tracking", "color"];

/**
 * 试写活动文字图层的 `textItem[prop]` 并**读回**。
 * @returns {Promise<{prop:string, ok:boolean, set?:any, got?:any, error?:string}>}
 */
async function trySetTextItem(prop, value) {
  if (TEXT_ITEM_WRITABLE.indexOf(prop) < 0) {
    return { prop: prop, ok: false, error: "不在白名单（不拿面板去试任意属性）" };
  }
  try {
    await runModal(async () => {
      const doc = app.activeDocument;
      const l = doc && doc.activeLayers && doc.activeLayers[0];
      if (!l) throw new Error("没有活动图层");
      const ti = l.textItem;
      if (!ti) throw new Error("该图层没有 textItem（不是文字图层？）");
      ti[prop] = value;
    }, "Vellum 工具箱：改文字属性 " + prop);
  } catch (e) {
    return { prop: prop, ok: false, error: msg(e) };
  }
  let got = null;
  try {
    const doc = app.activeDocument;
    const ti = doc.activeLayers[0].textItem;
    got = ti[prop];
  } catch (e) {
    return { prop: prop, ok: false, error: "写完了但读不回：" + msg(e) };
  }
  const flat = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v);
  const a = flat(value);
  const b = flat(got);
  return { prop: prop, ok: String(a) === String(b), set: a, got: b };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.3.8：M3 地基 —— ③ 图层组（批量出稿要按行成组 / 复制）
 * ═══════════════════════════════════════════════════════════════════════════
 * 描述符来源：Adobe 社区同一类**录制输出**（见上面 v0.2.3 引用的那份
 * 「create adjustment layer without mask」帖子里的 `make layerSection` 写法）：
 *   { _obj:"make", _target:[{_ref:"layerSection"}], using:{ _obj:"layerSection", name } }
 * 复制走 **UXP DOM 的 `Layer.duplicate()`**（官方文档化），不用手写 transform 描述符。
 */
function groupMakeDesc(name) {
  return {
    _obj: "make",
    _target: [{ _ref: "layerSection" }],
    using: { _obj: "layerSection", name: String(name || "组") },
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 建一个图层组（新建后它就是活动图层，随后新建的图层会落进组里）。 */
async function makeGroup(name) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  const before = countLayers();
  try {
    await runModal(async () => {
      await batchPlay([groupMakeDesc(name)], {});
    }, "Vellum 工具箱：新建图层组");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  const li = layerInfo();
  const after = countLayers();
  return {
    ok: after > before || (after === before && !!li.ok), // 组会占一层，图层数不变也算成功
    added: after - before,
    layer: li.ok ? { id: li.id, name: li.name, kind: li.kind } : null,
  };
}

/** 复制活动图层（DOM 官方接口），并读回新图层。 */
async function duplicateActiveLayer(name) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  const before = countLayers();
  try {
    await runModal(async () => {
      const doc = app.activeDocument;
      const l = doc && doc.activeLayers && doc.activeLayers[0];
      if (!l) throw new Error("没有活动图层");
      if (typeof l.duplicate !== "function") throw new Error("该 UXP 版本没有 Layer.duplicate()");
      await l.duplicate();
    }, "Vellum 工具箱：复制图层");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  const after = countLayers();
  const li = layerInfo();
  return {
    ok: after > before,
    added: after - before,
    layer: li.ok ? { id: li.id, name: li.name, kind: li.kind } : null,
    wantName: name || null,
  };
}

/**
 * 在**整个文档**里递归找名字含 key 的第一个文字图层，并返回它的 `contents`。
 * 用途：验证"复制出来的组里文字真的被换掉了"（读回，不看"命令没报错"）。
 */
function findTextLayerContents(key) {
  try {
    const doc = app.activeDocument;
    if (!doc) return { ok: false, error: "没有打开的文档" };
    let hit = null;
    const walk = (layers) => {
      const arr = layers || [];
      for (let i = 0; i < arr.length && !hit; i++) {
        const l = arr[i];
        if (String(l.name || "").indexOf(key) >= 0) {
          let c = null;
          try {
            c = l.textItem ? l.textItem.contents : null;
          } catch {
            c = null;
          }
          if (c !== null && c !== undefined) hit = { name: l.name, contents: String(c) };
        }
        if (!hit && l.layers && l.layers.length) walk(l.layers);
      }
    };
    walk(doc.layers);
    return hit ? { ok: true, hit: hit } : { ok: false, error: "没找到名字含「" + key + "」的文字图层" };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.3.8：M3 地基 —— ④ 取指定矩形的平均色（像素凭证）
 * ═══════════════════════════════════════════════════════════════════════════
 * `readLayerAvgColor()` 是"整层缩到 1×1"。对一条**细线**它会被大面积透明稀释，
 * 判据就没有区分度 ⇒ 需要"只采这一小块的色"。
 * 走 `imaging.getPixels({ sourceRect, targetSize:{1,1} })`：
 * sourceRect 内重采样到 1×1 = 该区域的**平均色**。
 */
async function sampleRectAvgColor(rect) {
  try {
    if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
    if (!imaging || typeof imaging.getPixels !== "function") {
      return { ok: false, error: "imaging.getPixels 不可用" };
    }
    const d = app.activeDocument;
    const l = d.activeLayers && d.activeLayers[0];
    const req = {
      documentID: d.id,
      sourceRect: {
        left: Math.round(rect.left), top: Math.round(rect.top),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      },
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
        rgb = { r: clamp255(bytes[0]), g: clamp255(bytes[1]), b: clamp255(bytes[2]) };
      } catch (e) {
        rawErr = msg(e);
      }
    }, "Vellum 工具箱：采样矩形平均色");
    if (rawErr) return { ok: false, error: rawErr };
    if (!rgb) return { ok: false, error: "未取到像素" };
    return { ok: true, rgb: rgb, hex: rgbToHex(rgb) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
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
  /* v0.3.0 新增：九宫格落点 + 落点校验 */
  ANCHORS,
  ANCHOR_LABELS,
  anchorLabel,
  anchorOffset,
  readActiveLayerBounds,
  readSelectionBounds,
  placeBaseCenter,
  setSelectionRect,
  /* v0.3.3 新增：置入后精确校正（尺寸 + 位置一次做准） */
  applyLayerRect,
  /* v0.3.6 新增：置入的图层按素材名命名（去重 + 读回验证） */
  layerBaseName,
  uniqueLayerName,
  fitName,
  activeLayerNames,
  renameInsertedLayer,
  LAYER_NAME_LIMIT,
  RASTER_KINDS,
  CONTENT_KINDS,
  KIND_CN,
  /* v0.3.8 新增（M3 表格生成 · 地基）：矢量线条 / 文字精细参数 / 图层组 / 定点取色 */
  rectShapeMakeDesc,
  makeRectShapeLayer,
  textLayerBoxDesc,
  makeTextLayerBox,
  textItemProbe,
  trySetTextItem,
  TEXT_ITEM_WRITABLE,
  groupMakeDesc,
  makeGroup,
  duplicateActiveLayer,
  findTextLayerContents,
  sampleRectAvgColor,
};
