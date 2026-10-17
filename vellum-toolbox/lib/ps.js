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

/* v0.6.0：批量操作的「整批撤销」（docs/49 §五 第 3 步）。
   ⚠️ 依赖方向是**单向**的：ps.js → history.js。history.js **不**回头 require ps.js
      （它自己数图层，就为了避开循环依赖）。别把它改成双向的。 */
const undoHistory = require("./history.js");

/* v0.8.0：「导出审核版」要用的两份只读/纯函数库。
   依赖方向仍是**单向**：ps.js → review.js → inspect.js。
   inspect.js 只 require("photoshop")、review.js 只 require inspect.js，都不回头 require ps.js
   ⇒ 不会成环。别把 review.js 改成去 require ps.js。 */
const inspectLib = require("./inspect.js");
const reviewLib = require("./review.js");

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
    /* ⚠️ v0.4.5 这里**不能**引用 `o`：`readLayerAvgColor()` 没有 opts 参数。
       上一版我用"字符串替换"去加 composite 开关，替换命中的是**这一处**（而不是
       `sampleRectAvgColor` 里那处长得一模一样的行）⇒ 每次调用都 `ReferenceError: o is not defined`
       ⇒ S16/S17/S18 集体报"像素回读未命中"。**"看起来一样的两处"永远不要用替换去改。** */
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
  /* v0.8.0 追加（可选，**不改变既有调用行为**）：`height` / `resolution`。
     为什么要它：导出审核版的字号是**按 ppi 把像素换算成点**的，
     要端到端验这条换算，就必须能建出**非 72dpi** 的稿 —— 否则那段逻辑从没被真机跑过。 */
  const height = o.height || size;
  const res = o.resolution || 72;
  /* v0.9.1 追加（可选，**不改变既有调用行为**）：`mode`。
     为什么要它：用户真机上导出失败的那张稿是 **CMYK** 的 ——
     要把「色彩模式」这个变量**单独隔离出来**，就得能建 CMYK 的稿（S61 用）。 */
  const mode = o.mode || "RGB";
  const name = o.name || "Vellum 自检临时文档";

  /* ★ v0.9.1 修正：`mode` 以前直接塞进 `documents.add({mode:"CMYKColorMode"})`，
     而真机**静默忽略**了它（S66 实测：请求 CMYK、建出来的却是 `RGBColorMode`）。
     ⇒ 后果很严重：所有标着"CMYK"的探针其实都在验 RGB，**整个 CMYK 分支从没被测过**
       （而用户那张 84×184cm 展架稿正是 CMYK —— 这就是那次事故查不下去的一半原因）。
     ⇒ 现在：枚举值走 `constants.DocumentMode`，建完**读回**，不对就 `changeMode` 纠正，
        还不对就在返回值里标 `modeMismatch`（**绝不假装成功**）。 */
  const modeKeyOf = function (s) {
    const t = String(s || "").toUpperCase();
    if (t.indexOf("CMYK") >= 0) return "CMYK";
    if (t.indexOf("RGB") >= 0) return "RGB";
    if (t.indexOf("GRA") >= 0) return "GRAY";
    if (t.indexOf("LAB") >= 0) return "LAB";
    return t;
  };
  const modeConstant = function (key) {
    try {
      const CN = (constants && constants.DocumentMode) || null;
      const name2 = key === "GRAY" ? "GRAYSCALE" : key;
      if (CN && CN[name2]) return CN[name2];
    } catch (e) { /* 忽略 */ }
    return key === "CMYK" ? "CMYKColorMode"
      : key === "GRAY" ? "GrayscaleMode"
      : key === "LAB" ? "LabColorMode"
      : "RGBColorMode";
  };
  const wantKey = modeKeyOf(mode);
  const modeVal = modeConstant(wantKey);

  const variants = [
    { width: size, height: height, resolution: res, mode: modeVal, initialFill: "white", name: name },
    { width: size, height: height, resolution: res, mode: modeVal, name: name },
    { width: size, height: height, resolution: res, mode: modeVal },
    { width: size, height: height, resolution: res, initialFill: "white", name: name },
    { width: size, height: height, resolution: res },
  ];
  const errs = [];
  for (const v of variants) {
    try {
      let made = null;
      await runModal(async () => {
        made = await app.documents.add(v);
      }, "Vellum 工具箱：建临时文档");
      if (made && made.id !== undefined && made.id !== null) {
        let real = "";
        try { real = String(app.activeDocument.mode); } catch (e) { real = ""; }
        let fixed = false;
        if (real && modeKeyOf(real) !== wantKey) {
          try {
            await runModal(async () => {
              await app.activeDocument.changeMode(modeVal);
            }, "Vellum 工具箱：纠正临时文档色彩模式");
            fixed = true;
          } catch (e2) {
            errs.push("changeMode(" + wantKey + ")：" + msg(e2));
          }
          try { real = String(app.activeDocument.mode); } catch (e3) { /* 忽略 */ }
        }
        return {
          ok: true, id: made.id, name: made.name, mode: made.mode,
          modeRequested: wantKey, modeReal: real, modeKeyReal: modeKeyOf(real),
          modeFixed: fixed, modeMismatch: !!real && modeKeyOf(real) !== wantKey,
          params: Object.keys(v), errors: errs
        };
      }
      errs.push("add(" + Object.keys(v).join(",") + ") 没返回文档");
    } catch (e) {
      errs.push("add(" + Object.keys(v).join(",") + ")：" + msg(e));
    }
  }
  return { ok: false, error: errs.join("；"), errors: errs };
}

/**
 * 把指定 id 的文档设为**活动文档**（并读回自证）。
 *
 * 为什么需要它：所有"读像素"的探针都隐含一个假设 —— **我们建的那个临时文档一直是活动的**。
 * 但这个假设在真机上**会被打破**：用户在自检跑的几十秒里点一下自己的文档、或者切个窗口，
 * 活动文档就变了，于是取样读到的全是别的东西（表现为"像素回读未命中"、几条横带亮度完全一样）。
 * 与其把这种环境干扰误诊成"产品有 bug"，不如**每次取样前把文档要回来，并记下回来的 id**。
 */
async function activateDocument(id) {
  try {
    if (!app.documents || !app.documents.length) return { ok: false, error: "没有打开的文档" };
    if (app.activeDocument && app.activeDocument.id === id) return { ok: true, already: true, docId: id };
    let target = null;
    for (const d of app.documents) {
      if (d && d.id === id) { target = d; break; }
    }
    if (!target) return { ok: false, error: "找不到文档 id=" + id };
    await runModal(async () => {
      app.activeDocument = target;
    }, "Vellum 工具箱：切到临时文档");
    const now = app.activeDocument;
    return { ok: !!(now && now.id === id), docId: now ? now.id : null, error: now && now.id === id ? null : "切过去了但读回不是它" };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
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
 * 扫一遍打开的文档，把**属于我们探针/自检的**那些关掉。
 *
 * 🔴 为什么要有它（2026-10-17 真机事故）：
 *   `closeDocument` 在"找不到文档 / 关不掉"时**返回 `{ok:false}` 而不抛异常**，
 *   而自检里 20+ 处调用都写成 `await ps.closeDocument(id)` **不检查返回值**
 *   ⇒ 关闭失败被无声吞掉，临时文档就在**用户的 PS 里堆积**
 *   （实测到 `Vellum 自检临时文档(S51-A)`、`(S60缩放)`、`未标题-1` 三个残留）。
 *   更糟的是**堆积会反过来把后续自检搞乱**（活动文档不对、建稿尺寸异常）⇒ 一批**假失败**。
 *   ⇒ 开场先扫一遍清场，收尾再扫一遍确认没漏关，**两边都把结果记进报告**。
 *
 * ⚠️ **只关名字匹配前缀的** —— 绝不按"某个非活动文档"之类模糊条件关，
 *   用户自己的稿一根汗毛都不能碰。
 *
 * @param {string[]} [prefixes] 名字前缀；默认是自检/探针用过的几种
 * @returns {Promise<{closed:string[], failed:{name:string,err:string}[], kept:string[]}>}
 */
async function sweepProbeDocs(prefixes) {
  const list = (Array.isArray(prefixes) && prefixes.length)
    ? prefixes
    : ["Vellum 自检临时文档", "Vellum 探针", "TP-"];
  const out = { closed: [], failed: [], kept: [], unknown: 0 };

  /* 🔴 **先快照（id + name），再动手关** —— 2026-10-17 实测：
     边遍历边关会让 `app.documents` 的元素**失效**（`d.name` 读成空串），
     结果 sweep **认不出自己的临时文档**（真机读数：收尾时 3 个文档名字全是 ""）。
     ⇒ 先一次性取完 id/name，再按 id 关，互不干扰。 */
  const snap = [];
  try {
    const n = app.documents.length;
    for (let i = 0; i < n; i++) {
      let d = null;
      try { d = app.documents[i]; } catch (eA) { d = null; }
      if (!d) { out.unknown++; continue; }
      let nm = "";
      let id = null;
      try { nm = String(d.name || ""); } catch (eB) { nm = ""; }
      try { id = d.id; } catch (eC) { id = null; }
      if (!nm) out.unknown++;          // ★ 读不到名字要**能被发现**（以前静默当"别人的"）
      snap.push({ id: id, name: nm });
    }
  } catch (e0) {
    out.failed.push({ name: "(列举文档)", err: msg(e0) });
    return out;
  }

  for (const it of snap) {
    let hit = false;
    for (const pfx of list) {
      if (it.name && it.name.indexOf(pfx) === 0) { hit = true; break; }
    }
    if (!hit) { out.kept.push(it.name); continue; }
    if (it.id === null || it.id === undefined) {
      out.failed.push({ name: it.name, err: "拿不到文档 id" });
      continue;
    }
    const r = await closeDocument(it.id);
    if (r && r.ok) out.closed.push(it.name);
    else out.failed.push({ name: it.name, err: (r && r.error) || "?" });
  }
  return out;
}


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
      // v0.4.0：外框要"只描边不填充"（表格外框就是一整圈线）⇒ 允许关掉填充
      fillEnabled: o.fill !== false,
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
  const using = {
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
  };

  /* v0.4.0：建层时就带上图层名。
     ⚠️ `make textLayer` 里 `name` 是否被接受**由 S40 钉死**（录制样例里 `make contentLayer`
     是有 `name` 的，textLayer 这一路没有官方样例）⇒ 不生效的话图层面板里会是一串
     "文字图层 n"，那时得换命名策略。 */
  if (o.name) using.name = String(o.name);

  /* v0.4.0：**建层时就带上段落对齐**（表格每格的居中/右对齐）。
     依据：`align` 这个字段名与枚举族 `alignmentType` 都是 v0.3.8/v0.3.9
     从 `readTextKeyDesc()` **读回来的**（不是猜的），见 docs/35 S32 与 docs/37。
     能不能在建层这一发里就生效由 S40 钉死；不生效则退回"建完再 select + set"（buildTable 的 post 模式）。 */
  if (o.align && o.align.value) {
    using.paragraphStyleRange = [
      {
        _obj: "paragraphStyleRange",
        from: 0,
        to: text.length,
        paragraphStyle: {
          _obj: "paragraphStyle",
          align: { _enum: o.align.cls || "alignmentType", _value: String(o.align.value) },
        },
      },
    ];
  }

  return {
    _obj: "make",
    _target: [{ _ref: "textLayer" }],
    using: using,
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
const TEXT_ITEM_WRITABLE = ["contents", "fontSize", "font", "justification", "leading", "tracking", "color"];

/**
 * 试写活动文字图层的 `textItem[prop]` 并**读回**。
 *
 * ⚠️ 两条自我防守（第一版就是被这两个洞骗过，读数"看着通过"其实什么都没验证）：
 *   ① **原值读不到就不试** —— 第一版拿 `undefined` 去往返，`undefined === undefined`
 *      直接算通过（"读到自己设的输入"式假阳性）。
 *   ② **读回不含 undefined** —— 写进一个不存在访问器的属性不会抛错，只会静默
 *      在**那个临时包装对象**上挂个 JS 属性；重新取 `textItem` 又是一张新包装 ⇒
 *      读回 undefined。所以"写成功 + 读回 undefined"必须判失败，不能判通过。
 * @returns {Promise<{prop:string, ok:boolean, set?:any, got?:any, error?:string}>}
 */
async function trySetTextItem(prop, value) {
  if (TEXT_ITEM_WRITABLE.indexOf(prop) < 0) {
    return { prop: prop, ok: false, error: "不在白名单（不拿面板去试任意属性）" };
  }
  if (value === undefined || value === null) {
    return { prop: prop, ok: false, error: "原值读不到 ⇒ 没试（不许拿 undefined 往返当成功）" };
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
  let got;
  try {
    const doc = app.activeDocument;
    const ti = doc.activeLayers[0].textItem;
    got = ti[prop];
  } catch (e) {
    return { prop: prop, ok: false, error: "写完了但读不回：" + msg(e) };
  }
  if (got === undefined || got === null) {
    return { prop: prop, ok: false, set: String(value), got: "undefined", error: "写进去了但读回 undefined ⇒ 这个属性没接上（静默无效）" };
  }
  const flat = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
  const a = flat(value);
  const b = flat(got);
  return { prop: prop, ok: a === b, set: a, got: b, error: a === b ? null : "读回与写入不一致" };
}

/* ---------------------------------------------------------------------------
 * 文字样式：**建层时给**（官方样例的 textStyle） vs **建完再改**（AM `set textStyle`）
 * ---------------------------------------------------------------------------
 * S32 第一轮实测：PS 27.2 / UXP 9.0.2 的 `layer.textItem` **只有 `contents` 接上了**
 * （fontSize / font / justification / leading / tracking 读回全是 undefined）⇒
 * 「字体/字号/对齐/行距」不能指望 DOM，得走 AM。
 *
 * AM 那条路的**模板是已验证过的** `textColorDesc()`（v0.2.4，真机 18/19 通过）：
 *   { _obj:"set",
 *     _target:[ {_ref:"property", _property:"textStyle"},
 *               {_ref:"textLayer", _enum:"ordinal", _value:"targetEnum"} ],
 *     to:{ _obj:"textStyle", color:{RGBColor} } }
 * 这里把它**泛化**成"能塞任意 textStyle 字段"，字段本身由调用方给
 * —— ⚠️ 枚举值（如 justification）**不在这里猜**，由探针读回后按读到的枚举族名传进来。
 */

/**
 * 把一组 textStyle 字段包成 `set` 描述符（纯函数，可离线断言）。
 * @param {object} style { color?:{r,g,b}, sizePt?:number, fontName?:string,
 *                         tracking?:number, leadingPt?:number, justification?:{cls,value} }
 */
function textStyleDesc(style) {
  const s = style || {};
  const to = { _obj: "textStyle" };
  if (s.color) {
    to.color = {
      _obj: "RGBColor",
      red: clamp255(s.color.r), grain: clamp255(s.color.g), blue: clamp255(s.color.b),
    };
  }
  if (s.sizePt !== undefined && s.sizePt !== null) {
    to.size = { _unit: "pointsUnit", _value: Number(s.sizePt) };
  }
  if (s.fontName) to.fontName = String(s.fontName);
  if (s.tracking !== undefined && s.tracking !== null) to.tracking = Number(s.tracking);
  if (s.leadingPt !== undefined && s.leadingPt !== null) {
    to.leading = { _unit: "pointsUnit", _value: Number(s.leadingPt) };
  }
  if (s.justification && s.justification.cls && s.justification.value) {
    to.justification = { _enum: String(s.justification.cls), _value: String(s.justification.value) };
  }
  return {
    _obj: "set",
    _target: [
      { _ref: "property", _property: "textStyle" },
      { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" },
    ],
    to: to,
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 给活动文字图层套一组样式（非破坏性：改完仍是文字图层）。 */
async function applyTextStyle(style) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  try {
    await runModal(async () => {
      await batchPlay([textStyleDesc(style)], {});
    }, "Vellum 工具箱：改文字样式");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  return { ok: true };
}

/**
 * 段落样式（`paragraphStyle`）的 `set` —— 框文本的**对齐**在这一层。
 * 🔴 依据（真机读回来的，不是猜的）：`textKey` 里 `textStyle` **没有** justification，
 *    对齐字段叫 **`align`**、枚举族 **`alignmentType`**、默认值 `left`，
 *    它位于 `paragraphStyleRange[].paragraphStyle` 里。
 *    属性名 `paragraphStyle` 与已验证的 `textStyle`（v0.2.4）同一套 `_property` 写法。
 */
function paragraphStyleDesc(style) {
  const s = style || {};
  const to = { _obj: "paragraphStyle" };
  if (s.align && s.align.cls && s.align.value) {
    to.align = { _enum: String(s.align.cls), _value: String(s.align.value) };
  }
  return {
    _obj: "set",
    _target: [
      { _ref: "property", _property: "paragraphStyle" },
      { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" },
    ],
    to: to,
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 给活动文字图层套段落样式（对齐）。 */
async function applyParagraphStyle(style) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  try {
    await runModal(async () => {
      await batchPlay([paragraphStyleDesc(style)], {});
    }, "Vellum 工具箱：改段落样式");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  return { ok: true };
}

/**
 * 把**从文本图层读回来的 `textKey` 描述符**改一处再写回去。
 *
 * 为什么这么写（而不是自己拼一个 set 描述符）：
 *   段落级的对齐/行距（`paragraphStyle`）**没有官方样例可抄**，手拼属于本项目铁律里的
 *   "禁止猜"。而 PS 自己 `get textKey` 吐出来的结构就是**权威的命令形状** ——
 *   在它上面改一个字段再送回，等于"照抄录制"，不引入任何我编的键名。
 * @param {object} tkDesc `readTextKeyDesc()` 拿到的 `raw`（含 textKey 那一层）
 */
function textLayerSetDesc(tkDesc) {
  return {
    _obj: "set",
    _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: tkDesc,
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 把改过的 textKey 描述符写回活动文字图层。 */
async function applyTextLayerDesc(tkDesc) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  if (!tkDesc) return { ok: false, error: "没有描述符" };
  try {
    await runModal(async () => {
      await batchPlay([textLayerSetDesc(tkDesc)], {});
    }, "Vellum 工具箱：写回文字图层描述符");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  return { ok: true };
}

/**
 * 读回活动文字图层的 `textKey` 描述符（AM `get`）。
 * 用途有两个，都很关键：
 *   ① **钉死命令形状** —— 先把 PS 自己吐出来的键名/枚举族名看清楚，再决定怎么写；
 *   ② 判据 —— "字号/颜色/对齐到底生效没有"必须**读回**验证，不能只看"命令没报错"。
 * @returns {Promise<{ok:boolean, raw?:object, error?:string, bytes?:number}>}
 */
async function readTextKeyDesc() {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  let raw = null;
  let err = null;
  try {
    await runModal(async () => {
      try {
        const res = await batchPlay(
          [
            {
              _obj: "get",
              _target: [
                { _property: "textKey" },
                { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
              ],
              _options: { dialogOptions: "dontDisplay" },
            },
          ],
          {}
        );
        raw = res && res[0] ? res[0] : null;
      } catch (e) {
        err = msg(e);
      }
    }, "Vellum 工具箱：读文字图层描述符");
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  if (err) return { ok: false, error: err };
  if (!raw) return { ok: false, error: "batchPlay 没返回东西" };
  let bytes = 0;
  try {
    bytes = JSON.stringify(raw).length;
  } catch {
    bytes = -1;
  }
  return { ok: true, raw: raw, bytes: bytes };
}

/**
 * 从 `textKey` 描述符里抽出我们关心的那几项（**只读、不猜**）。
 * 键名拿不到就如实返回 null，让调用方知道"这一项没读到"，而不是编一个默认值。
 */
function summarizeTextKey(raw) {
  const out = {
    keys: [], styleKeys: [], contents: null, size: null, color: null,
    justification: null, leading: null, font: null, shapeChar: null,
    paragraphStyleKeys: [], paragraphJustification: null, paragraphAlign: null,
    paragraphLeadingType: null, paragraphDump: null,
  };
  try {
    const tk = raw && raw.textKey ? raw.textKey : raw;
    if (!tk) return out;
    out.keys = Object.keys(tk);
    out.contents = typeof tk.textKey === "string" ? tk.textKey : null;
    const ranges = tk.textStyleRange || [];
    const r0 = ranges[0];
    if (r0 && r0.textStyle) {
      const st = r0.textStyle;
      out.styleKeys = Object.keys(st);
      out.size = st.size && st.size._value !== undefined ? st.size._value : null;
      out.color = st.color ? ps_color(st.color) : null;
      out.justification = st.justification
        ? { cls: st.justification._enum || null, value: st.justification._value || null }
        : null;
      out.leading = st.leading && st.leading._value !== undefined ? st.leading._value : null;
      out.font = st.fontName || null;
    }
    const shapes = tk.textShape || [];
    if (shapes[0]) {
      const sh = shapes[0];
      out.shapeChar = sh.char && sh.char._value ? sh.char._value : null;
      if (sh.bounds) {
        out.shapeBounds = {
          left: sh.bounds.left, top: sh.bounds.top,
          right: sh.bounds.right, bottom: sh.bounds.bottom,
        };
      }
    }
    /* 段落级属性（**框文本的对齐/行距就在这一层**）——
       S32 第二轮读回来的 `textStyle` 里**没有 justification、也没有 leading**
       （只有 autoLeading / baselineShift）⇒ 说明它们不在字符样式里。
       这里把段落样式整个列出来，用"读到的键名"决定下一步怎么写，不猜。 */
    const pr = tk.paragraphStyleRange || [];
    out.paragraphRanges = pr.length;
    if (pr[0] && pr[0].paragraphStyle) {
      const ps = pr[0].paragraphStyle;
      out.paragraphStyleKeys = Object.keys(ps);
      out.paragraphJustification = ps.justification
        ? { cls: ps.justification._enum || null, value: ps.justification._value || null }
        : null;
      /* 🔴 第三轮真机读数：`justification` 在段落样式里**并不存在**，真正的对齐字段叫
         **`align`**（同层还有 firstLineIndent / startIndent / endIndent / leadingType …）。
         这条是"读回来的"，不是猜的 —— 也正是"先钉死命令形状再动手"的价值。 */
      out.paragraphAlign = ps.align
        ? { cls: ps.align._enum || null, value: ps.align._value || null }
        : null;
      out.paragraphLeadingType = ps.leadingType
        ? { cls: ps.leadingType._enum || null, value: ps.leadingType._value || null }
        : null;
      try {
        out.paragraphDump = JSON.stringify(ps).slice(0, 700);
      } catch {
        out.paragraphDump = "(序列化失败)";
      }
    }
  } catch {
    /* 结构不认识就返回已抽到的部分 */
  }
  return out;
}

/** 内部小工具：RGBColor 描述符 → {r,g,b}（grain/green 两种键名都认）。 */
function ps_color(c) {
  if (!c) return null;
  const g = c.grain !== undefined ? c.grain : c.green;
  if (typeof c.red !== "number" || typeof g !== "number" || typeof c.blue !== "number") return null;
  return { r: Math.round(c.red), g: Math.round(g), b: Math.round(c.blue) };
}

/** 文档里**递归**数图层总数（顶层 `doc.layers.length` 数不到组里的子层）。 */
function countLayersDeep() {
  let n = 0;
  try {
    const walk = (arr) => {
      for (const l of arr || []) {
        n++;
        if (l.layers && l.layers.length) walk(l.layers);
      }
    };
    walk(app.activeDocument.layers);
    return n;
  } catch {
    return -1;
  }
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
/**
 * 取一个矩形的**平均色**。
 * @param {{left,top,right,bottom}} rect
 * @param {{composite?:boolean}} [opts] `composite:true` = 取**文档合成**（不传 `layerID`），
 *        而不是"当前图层"。⚠️ v0.4.4：默认那条是"当前图层"——S31 验线色时正合适
 *        （取样矩形全在线上），但**验文字纵向位置时必须用合成**：文字层在字形之外是透明的，
 *        读当前图层只会得到一片恒定值（S43 第一版就是这么白跑一轮的）。
 */
/* ------------------------------------------------------------ 取色（imaging.getPixels）

   🔴 2026-10-17 实测 + **官方文档**（developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/）确认：
   · 源区域字段名**只有 `sourceBounds`**（不是 `sourceRect`）。写错时 PS **静默忽略**它，
     返回**整幅**的平均色 —— 真机表现是"四个不同位置的采样点返回完全相同的值"
     （`整条=#ABA9A9 条顶=#ABA9A9 条底=#ABA9A9 图区=#ABA9A9`）。
   · ⚠️ **`targetSize` 小于请求区域时，PS 会用「金字塔缓存层」**（偏好设置 *Performance Cache Levels*），
     返回的 `sourceBounds` 也随之变成**缓存层坐标**（不是文档坐标）——实测拿到 `{0,0,150,113}`
     而请求的是 `{0,226,300,298}`（正好一半）。
     🔴 后果很严重：**刚画上去的内容可能还没进缓存** ⇒ 读到的像素是**旧的**。
     ⇒ 所以"参数条刚画完就验底色"这种场景**必须避开缓存层**：
     本函数发现 `level > 0` 时会**再取一次（不传 targetSize，强制全分辨率）**。
   · 请求区域会被 PS **裁剪到「真正含像素数据的部分」**，回读的 `sourceBounds` 是裁剪后的
     ⇒ 判据只能是「**回读区域落在请求区域内**」，**不能要求相等**。 */
async function rawSample(rect, composite, layerId, noScale) {
  const d = app.activeDocument;
  const req = {
    documentID: d.id,
    componentSize: 8,
    colorSpace: "RGB",
    applyAlpha: false,
    sourceBounds: {
      left: Math.round(rect.left), top: Math.round(rect.top),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
    },
  };
  /* noScale = 不传 targetSize ⇒ 返回原尺寸 ⇒ 逼 PS 用 level 0（全分辨率） */
  if (!noScale) req.targetSize = { width: 1, height: 1 };
  if (!composite && layerId !== null && layerId !== undefined) req.layerID = layerId;

  let out = null;
  let err = null;
  await runModal(async () => {
    try {
      const res = await imaging.getPixels(req);
      const img = res && res.imageData;
      if (!img) throw new Error("getPixels 未返回 imageData");
      let data = typeof img.getData === "function" ? img.getData({}) : null;
      if (data && typeof data.then === "function") data = await data;
      const bytes = data && data.data ? data.data : data;
      if (!bytes || bytes.length < 3) throw new Error("像素数据结构不符合预期");
      const comps = (img.components === 4 || bytes.length === 4) ? 4 : 3;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let n = 0;
      for (let p2 = 0; p2 + comps - 1 < bytes.length; p2 += comps) {
        rr += bytes[p2];
        gg += bytes[p2 + 1];
        bb += bytes[p2 + 2];
        n++;
      }
      if (!n) throw new Error("没有读到像素");
      const sb = res && res.sourceBounds;
      out = {
        rgb: { r: clamp255(rr / n), g: clamp255(gg / n), b: clamp255(bb / n) },
        n: n,
        level: (typeof res.level === "number") ? res.level : null,
        got: sb ? { left: sb.left, top: sb.top, right: sb.right, bottom: sb.bottom } : null,
      };
    } catch (e) {
      err = msg(e);
    }
  }, "Vellum 工具箱：采样矩形平均色");

  if (err) return { ok: false, error: err };
  if (!out) return { ok: false, error: "未取到像素" };
  out.ok = true;
  return out;
}

/**
 * 取某个矩形的平均色（**只读**，不进历史）。
 *
 * @param {{left,top,right,bottom}} rect 文档坐标
 * @param {{composite?:boolean}} [opts] `composite:true` = 取**文档合成**（不传 layerID）
 * @returns {Promise<{ok:boolean, rgb?:object, hex?:string, n?:number, level?:number,
 *                    got?:object, fieldOk?:boolean, note?:string, error?:string}>}
 */
async function sampleRectAvgColor(rect, opts) {
  const o = opts || {};
  try {
    if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
    if (!imaging || typeof imaging.getPixels !== "function") {
      return { ok: false, error: "imaging.getPixels 不可用" };
    }
    const d = app.activeDocument;
    const l = d.activeLayers && d.activeLayers[0];
    const layerId = (l && l.id !== undefined) ? l.id : null;
    const want = {
      left: Math.round(rect.left), top: Math.round(rect.top),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
    };

    let r = await rawSample(want, o.composite, layerId, false);
    let note = "";
    /* ★ level > 0 = PS 用了金字塔缓存层 ⇒ 可能读不到"刚画上去"的内容
       ⇒ 再取一次：不传 targetSize（强制全分辨率，level 应为 0）。 */
    if (r.ok && r.level !== null && r.level > 0) {
      const r2 = await rawSample(want, o.composite, layerId, true);
      if (r2.ok) {
        note = "首次落在 level=" + r.level + " 缓存层，已用全分辨率重取";
        r = r2;
      }
    }
    if (!r.ok) return { ok: false, error: r.error };

    /* 判据：level 0 时，回读区域必须**落在请求区域内**
       （PS 会把请求裁剪到"含像素数据的部分"；字段被忽略时它会返回整幅，几乎必然越界） */
    let fieldOk = true;
    if (r.level === 0 && r.got) {
      fieldOk = r.got.left >= want.left - 2 && r.got.top >= want.top - 2 &&
        r.got.right <= want.right + 2 && r.got.bottom <= want.bottom + 2;
    }
    return {
      ok: true, rgb: r.rgb, hex: rgbToHex(r.rgb), n: r.n,
      level: r.level, got: r.got, fieldOk: fieldOk,
      note: fieldOk ? note : (note + " ⚠ 回读区域越出请求范围（疑似 sourceBounds 未被接受）"),
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ★ v0.4.0：M3「表格生成」—— 把 lib/table.js 算好的计划落到文档里
 * ═══════════════════════════════════════════════════════════════════════════
 * 一次 `batchPlay` 发完（v0.3.8 实测：批量 37.5ms/层 vs 逐条 267ms/层，差 7.8 倍
 * —— 模态进出才是大头）⇒ **绝不逐条发**。
 *
 * 建层顺序 = 最终 z 序（PS 新建的层在上）：
 *   背景（最下）→ 线条 → 外框 → 文字（最上）
 *
 * 全部落在**一个图层组**里，组内每层都带**有意义的名字**（「线 · 横 3」「文字 R2C1 秋季提高班」）
 * —— "可继续编辑"这条需求的灵魂就在这：用户打开图层面板要看得懂，而不是一堆"文字图层 12"。
 */

/** 按**图层名**选中（AM 的 `_target` 支持 `_name`；post 模式的对齐就靠它回头逐个改）。 */
function selectLayerByNameDesc(name) {
  return {
    _obj: "select",
    _target: [{ _ref: "layer", _name: String(name) }],
    _options: { dialogOptions: "dontDisplay" },
  };
}

/** 递归找一个图层（按名字 / 可选按 kind）。找不到返回 null。 */
function findLayerDeep(name, kind) {
  let hit = null;
  try {
    const walk = (arr) => {
      for (const l of arr || []) {
        if (hit) return;
        if (String(l.name) === String(name) && (!kind || l.kind === kind)) {
          hit = l;
          return;
        }
        if (l.layers && l.layers.length) walk(l.layers);
      }
    };
    walk(app.activeDocument.layers);
  } catch {
    return null;
  }
  return hit;
}

/** 表头/单元格的图层名（截断到安全长度，图层名有上限） */
function tableCellName(cell) {
  const head = cell.role === "header" ? "表头 C" + (cell.col + 1) : "文字 R" + cell.row + "C" + (cell.col + 1);
  let t = String(cell.text).replace(/[\r\n]+/g, " ");
  if (t.length > 18) t = t.slice(0, 18) + "…";
  return t ? head + " " + t : head;
}

/**
 * 尽力而为的日志（**绝不能影响主流程**）。
 *
 * 为什么底层模块也要写日志：v0.4.0 那次真机事故里，自检卡在 `buildTable` 里面，
 * 而日志只留到"上一个探针"就断了 —— 没人知道卡在"发命令"还是"逐格改名"。
 * 有了这几行，卡死时日志的最后一条就是**分野线**。
 */
function note(line) {
  try {
    require("./log.js").appendLog(String(line));
  } catch {
    /* 日志失败永远不该影响业务 */
  }
}

/**
 * 把计划落进当前文档。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 v0.4.1 **返工记录**（一轮真机事故换来的，务必别再犯）
 * ════════════════════════════════════════════════════════════════════════════
 * v0.4.0 的写法是"把 `name` 与 `paragraphStyleRange` 直接塞进 `make textLayer`
 * 描述符、48 条命令一次发完"。真机一跑：**自检卡死、PS 进模态再也回不来**，
 * 连 UXP 的加载命令都超时（`Check the host application ... busy or in a modal state`）。
 * 那两项都是**没有官方样例、只有我推理**的加法 —— 一旦其中一条让 PS 弹框，
 * `executeAsModal` 就永远等不到返回，**整个插件陪葬**。
 *
 * ⇒ 现在的纪律：**只用已经真机验过的原语**，而且**新加法一次只验一条、单条发**。
 *    · 建层：`make contentLayer/shape:rectangle`（S31 验）、`make textLayer` 的
 *      `textShape`+`textStyleRange`（S32 验）—— **不塞 name、不塞 paragraphStyleRange**
 *    · 改名：DOM `layer.name = …`（**S29 验过可写**）
 *    · 选层：DOM `doc.activeLayers = [layer]`（S33 验过）
 *    · 对齐：AM `set _property:"paragraphStyle"`（S37 验过 left/center/right 三档）
 *    · 组名：`make layerSection` 的 `name`（S33 的 `makeGroup` 就靠它按名字找回来）
 *
 * `alignMode:"inline"` 那条快路**保留但不做默认**，等有了一份"单条小探针"的证据再启用。
 */
async function buildTable(plan, opts) {
  const o = opts || {};
  if (!plan || !plan.ok) return { ok: false, error: (plan && plan.error) || "没有可用的计划" };
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };

  const before = countLayersDeep();
  const groupName = o.name || "表格";
  /* v0.4.7 两条默认走法（都有真机单条验证，见 docs/44 的 S45/S46）：
     · 对齐 → **内联进建层描述符**（`paragraphStyleRange`，读回命中 alignmentType）
     · 改名 → **一次 batchPlay 按 _id set name**（不碰 UXP DOM）
     `alignMode:"dom"` / `nameMode:"dom"` 是**退回路径**，保留可跑，用来对照耗
     —— 真机上它就是"13.6s / 35 格"那一条（O(格数 × 文档层数)）。 */
  const inline = o.alignMode !== "dom";
  const useDom = !inline || o.nameMode === "dom";
  const cmds = [groupMakeDesc(groupName)];

  for (const b of plan.bg) {
    cmds.push(rectShapeMakeDesc(b.rect, b.color, { fill: true, stroke: false }));
  }
  /* 线：**外框 4 条也在 plan.lines 里**（见 lib/table.js）⇒ 这里一个循环发完，
     每条都走 S31 验过的那个形状（fill:true / stroke:false），没有例外。
     ⚠️ 刻意**不再**发"只描边不填充"的矩形：`fillEnabled:false` + `strokeEnabled:true`
     这个组合没有真机证据，正是 v0.4.0 卡死宿主的那一类加法。 */
  for (const l of plan.lines) {
    cmds.push(rectShapeMakeDesc(l.rect, l.color || plan.style.lineColor, { fill: true, stroke: false }));
  }
  for (const c of plan.cells) {
    cmds.push(textLayerBoxDesc({
      text: c.text, box: c.box, sizePt: c.sizePt, rgb: c.color,
      fontName: plan.style.fontName,
      /* ⚠️ `name` **不放这里**：S45 真机实测 `make textLayer` 会**忽略**它
         （层名变成文字内容）。命名走第②批的 `set name`（S46 已验证）。 */
      name: null,
      align: inline ? { value: c.align } : null,
    }));
  }

  const out = {
    ok: false, group: groupName, expected: plan.layers,
    commands: cmds.length, alignMode: inline ? "inline" : "dom",
    renamed: 0, aligned: 0, phase2Error: null,
  };

  note("m3 build 开始　组=" + groupName + "　命令 " + cmds.length + " 条（1 组 + 线 " +
    plan.lines.length + "（外框 " + (plan.outer ? plan.outer.bars : "?") + "）+ 背景 " + plan.bg.length +
    " + 文字 " + plan.cells.length + "）　模式=" + (inline ? "inline" : "dom"));

  try {
    await runModal(async () => {
      /* ① 建层（一次 batchPlay；描述符只用验过的形状） */
      await batchPlay(cmds, {});
      note("m3 build 第①批发完（" + cmds.length + " 条命令已提交）");
      /* ② 命名（+ 对齐兜底）—— v0.4.7 起**不再逐格碰 UXP DOM**
         为什么重写：真机分段计时（docs/44）阶段二 = 13.6s / 35 格 / 51 层，拆开是
           · 选择 `doc.activeLayers=[layer]`  6845ms（196ms/格）
           · 改名 `layer.name=`              5920ms（169ms/格）
           · 对齐 `batchPlay(set …)`          815ms（ 23ms/格，**线性、便宜**）
         前两项的单次代价随**文档层数**涨（3 层时 11ms/格 → 51 层时 196ms/格）
         ⇒ 开销在 UXP **DOM**，不在 AM。两条都改成走 AM（AM 能合批）：
           · 对齐 → 第①批**内联**进建层描述符（S45 已验证：读回 alignmentType ✓）
           · 改名 → **一次 batchPlay**，按 `_id` set name（S46 已验证 ✓；
             而 `make textLayer`/`make contentLayer` 里的 `name` 都是**被忽略**的 —— S45/S46 实测）
         📌 纪律：**UXP DOM 的写操作别放进"按格循环"** —— 文档一大就变成 O(文档大小)。
         `useDom` 是退回路径，保留可跑（真机上它是 13.6s），用来对照新路径到底快多少。 */
      const doc = app.activeDocument;
      note("m3 build 第②批开始（模式=" + (useDom ? "退回·逐格 DOM" : "内联对齐 + 合批改名") + "）");
      let grp = null;
      const walk = (arr) => {
        for (const l of arr || []) {
          if (grp) return;
          if (l.kind === "group" && String(l.name) === groupName) { grp = l; return; }
          if (l.layers && l.layers.length) walk(l.layers);
        }
      };
      walk(doc.layers);
      if (!grp) throw new Error("建完找不到组「" + groupName + "」");

      /* 组内顺序是"从下往上"（PS 每建一层都放在组内最上面）⇒ 反转 = **建层顺序**。
         建层顺序 = 背景 → 线 → 文字，与上面 `cmds` 的 push 顺序一一对应。 */
      const ordered = (grp.layers || []).slice().reverse();
      const creation = [];
      for (const b of plan.bg) {
        creation.push({ text: false, name: b.role === "header" ? "背景 · 表头" : "背景 · 第 " + b.row + " 行" });
      }
      let hN = 0;
      let vN = 0;
      for (const l of plan.lines) {
        if (l.outer) {
          const side = { top: "上", bottom: "下", left: "左", right: "右" }[l.edge] || "";
          creation.push({ text: false, name: "外框" + (side ? " · " + side : "") });
        } else if (l.kind === "h") {
          hN++;
          creation.push({ text: false, name: "线 · 横 " + hN });
        } else {
          vN++;
          creation.push({ text: false, name: "线 · 竖 " + vN });
        }
      }
      for (const c of plan.cells) creation.push({ text: true, name: tableCellName(c) });

      out.kids = ordered.length;
      out.structure = ordered.length + "/" + creation.length;
      const t2 = Date.now();

      if (useDom) {
        /* ---- 退回路径：逐格 UXP DOM。真机 = O(格数 × 文档层数)，35 格 / 51 层 ≈ 13.6s ---- */
        const kids = ordered.filter((l) => l.kind === "text");
        const n = Math.min(kids.length, plan.cells.length);
        out.selected = 0;
        let selBad = 0;
        let nameBad = 0;
        let alignBad = 0;
        let tSel = 0;
        let tRen = 0;
        let tAli = 0;
        for (let i = 0; i < n; i++) {
          const layer = kids[i];
          const cell = plan.cells[i];
          let t = Date.now();
          try {
            doc.activeLayers = [layer];
            out.selected++;
          } catch (e) {
            selBad++;
            if (!out.firstSelectError) out.firstSelectError = "第 " + i + " 格：" + msg(e);
          }
          tSel += Date.now() - t;
          t = Date.now();
          try {
            layer.name = tableCellName(cell);
            out.renamed++;
          } catch (e) {
            nameBad++;
            if (!out.firstNameError) out.firstNameError = "第 " + i + " 格：" + msg(e);
          }
          tRen += Date.now() - t;
          t = Date.now();
          try {
            await batchPlay([paragraphStyleDesc({ align: { cls: "alignmentType", value: cell.align } })], {});
            out.aligned++;
          } catch (e) {
            alignBad++;
            if (!out.firstAlignError) out.firstAlignError = "第 " + i + " 格：" + msg(e);
          }
          tAli += Date.now() - t;
        }
        out.selectBad = selBad;
        out.nameBad = nameBad;
        out.alignBad = alignBad;
        out.phase2Parts = { sel: tSel, ren: tRen, ali: tAli };
        out.alignMode = "dom";
        out.nameMode = "dom";
        note("m3 phase2(退回路径)　格数 " + n + "　选择 " + tSel + "ms　改名 " + tRen + "ms　对齐 " + tAli + "ms" +
          "　选中 " + out.selected + "/" + n + "　改名 " + out.renamed + "/" + n + "　对齐 " + out.aligned + "/" + n);
      } else {
        /* ---- 新路径：**只读** DOM（拿 id）+ **一次 batchPlay**（改名）---- */
        let mapOk = ordered.length === creation.length;
        let mismatch = null;
        const cmds2 = [];
        if (mapOk) {
          for (let i = 0; i < ordered.length; i++) {
            const isText = ordered[i].kind === "text";
            if (isText !== creation[i].text) {
              mapOk = false;
              mismatch = "第 " + i + " 个 DOM是" + ordered[i].kind + "、计划是" + (creation[i].text ? "文字" : "形状");
              break;
            }
            cmds2.push({
              _obj: "set",
              _target: [{ _ref: "layer", _id: ordered[i].id }],
              to: { name: creation[i].name },
            });
          }
        }
        out.alignMode = "inline";
        if (!mapOk) {
          /* 层序对不上**就不改名** —— 宁可不命名，也不能把名字安到错层上（错名比无名难查） */
          out.nameMode = "skipped";
          out.nameMapError = mismatch || ("层数不符：DOM " + ordered.length + "、计划 " + creation.length);
          note("m3 phase2 跳过改名（层序对不上）：" + out.nameMapError);
        } else {
          const t3 = Date.now();
          try {
            await batchPlay(cmds2, {});
            out.renamed = cmds2.length;
            out.nameMode = "am";
          } catch (e) {
            out.nameMode = "failed";
            out.nameBad = cmds2.length;
            out.firstNameError = msg(e);
          }
          out.renameMs = Date.now() - t3;
        }
      }
      out.phase2Ms = Date.now() - t2;
      note("m3 phase2 结束　模式=对齐" + out.alignMode + " / 改名" + out.nameMode +
        "　层序 " + out.structure +
        "　改名 " + out.renamed + (out.nameBad ? "（失败 " + out.nameBad + "）" : "") +
        (out.renameMs === undefined ? "" : "　改名批次 " + out.renameMs + "ms") +
        (out.selected === undefined ? "" : "　（退回路径：选中 " + out.selected + " 失败 " + out.selectBad +
          "　对齐 " + out.aligned + " 失败 " + out.alignBad + "）") +
        "　耗时 " + out.phase2Ms + "ms" +
        (out.firstNameError ? "　首个改名错误=" + out.firstNameError : "") +
        (out.firstAlignError ? "　首个对齐错误=" + out.firstAlignError : ""));
    }, "Vellum 工具箱：生成表格（" + plan.layers + " 个图层）");
  } catch (e) {
    note("m3 build 失败　" + msg(e));
    out.error = "生成失败：" + msg(e);
    out.added = countLayersDeep() - before;
    return out;
  }

  note("m3 build 完成　新增 " + (countLayersDeep() - before) + " 层　改名 " +
    out.renamed + "　对齐 " + out.aligned);

  out.added = countLayersDeep() - before;
  out.ok = out.added > 0;
  if (!inline && out.aligned !== plan.cells.length) {
    out.phase2Error = "对齐设上了 " + out.aligned + "/" + plan.cells.length + " 个";
  }
  out.lastCell = plan.cells.length ? plan.cells[plan.cells.length - 1] : null;
  out.cells = plan.cells.length;
  out.lines = plan.lines.length;
  out.bg = plan.bg.length;
  return out;
}

/* =============================================================== M3b 批量出稿
 * 「按行批量出稿」= 把模板组复制 N 份 + 把每一行的值写进副本里的对应文字层。
 *
 * 这里的形状全部由真机实测决定（S47，见 docs/45 §一）：
 *   · 复制走 **AM `duplicate` 按 `_id`**（17–19ms/份，一次 batchPlay 全发）；
 *     DOM 那套（选中 → `Layer.duplicate()`）要 95ms/份、每份还要 3 个模态边界。
 *   · 写文字只能走 DOM `textItem.contents`（≈60ms/次）—— **M3b 的大头**（预估耗时要显示给用户）。
 *   · 🔴 **`duplicate` 之后必须跨一个模态边界才读得到副本的子层**：同一个模态里读
 *     `copy.layers` 得到**空数组**（S47 第一版就因此"改文字 0 次"）。
 *   · 副本名由 `duplicate` 的 `name` 参数直接给（S47 实测**生效**；DOM 那条路才需要额外改名）。
 */

/** 只读：把一个图层对象整理成"模板候选"读本（只有组才有 textLayers）。 */
function layerBrief(l) {
  if (!l) return null;
  const out = {
    id: l.id, name: String(l.name || ""), kind: String(l.kind || ""),
    isGroup: l.kind === "group", textLayers: [], rect: null,
  };
  if (out.isGroup) {
    const walk = (arr) => {
      for (const k of arr || []) {
        if (k.kind === "text") {
          let c = "";
          try { c = String(k.textItem.contents); } catch { c = ""; }
          out.textLayers.push({ id: k.id, name: String(k.name || ""), contents: c });
        }
        if (k.layers && k.layers.length) walk(k.layers);
      }
    };
    try { walk(l.layers); } catch { /* 忽略 */ }
  }
  try {
    const b = l.bounds;
    if (b) out.rect = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  } catch { /* 忽略 */ }
  return out;
}

/** 只读：当前**选中的**图层 —— 模板的默认来源。不是组就如实说（不硬猜）。 */
function activeLayerBrief() {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  try {
    const doc = app.activeDocument;
    const l = doc.activeLayers && doc.activeLayers[0];
    if (!l) return { ok: false, error: "没有选中的图层" };
    const b = layerBrief(l);
    if (!b.isGroup) {
      return { ok: false, brief: b, error: "选中的是「" + b.name + "」（" + b.kind + "），不是图层组" };
    }
    return { ok: true, tpl: b };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** 只读：按名字找一个图层组（下拉选模板时用） */
function groupBriefByName(name) {
  if (!hasDocument()) return { ok: false, error: "没有打开的文档" };
  let hit = null;
  const walk = (arr) => {
    for (const l of arr || []) {
      if (hit) return;
      if (l.kind === "group" && String(l.name) === String(name)) { hit = l; return; }
      if (l.layers && l.layers.length) walk(l.layers);
    }
  };
  try {
    walk(app.activeDocument.layers);
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  if (!hit) return { ok: false, error: "找不到图层组「" + name + "」" };
  return { ok: true, tpl: layerBrief(hit) };
}

/** 只读：文档里所有图层组（给"模板"下拉用） */
function listGroups() {
  const out = [];
  try {
    const walk = (arr, depth) => {
      for (const l of arr || []) {
        if (l.kind === "group") {
          const b = layerBrief(l);
          out.push({ id: b.id, name: b.name, textCount: b.textLayers.length, depth: depth });
          walk(l.layers, depth + 1);
        } else if (l.layers && l.layers.length) {
          walk(l.layers, depth);
        }
      }
    };
    walk(app.activeDocument.layers, 0);
    return { ok: true, groups: out };
  } catch (e) {
    return { ok: false, error: msg(e), groups: [] };
  }
}

/** 只读：文档里最大的图层 id —— 复制之后**只认新层**（否则重跑会抓到上一次的副本，名字撞车） */
function maxLayerId() {
  let mx = 0;
  try {
    const walk = (arr) => {
      for (const l of arr || []) {
        if (typeof l.id === "number" && l.id > mx) mx = l.id;
        if (l.layers && l.layers.length) walk(l.layers);
      }
    };
    walk(app.activeDocument.layers);
  } catch { /* 忽略 */ }
  return mx;
}

/**
 * `move` 命令：把图层按**偏移**移动（AM，可合批）。
 * 🔴 为什么不用 DOM `Layer.translate()`：S48 实测**在这个组上没生效** —— `translate()` 调用
 * 不抛错、`moved` 计数也在涨，但**副本 bounds 一动不动**（位移实测 [0,0]）。
 * 又一次「没报错 ≠ 生效」⇒ 改成走 AM 的 `move`（并且能跟复制一样合批）。
 * ⚠️ 形状按纪律**单条验过**（S48 先单独发一条、读回 bounds 位移对上了才用）。
 */
function moveByIdCmd(id, dx, dy) {
  return {
    _obj: "move",
    _target: [{ _ref: "layer", _id: id }],
    to: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: Math.round(dx) || 0 },
      vertical: { _unit: "pixelsUnit", _value: Math.round(dy) || 0 },
    },
  };
}

/** `duplicate` 命令（按 `_id`；`name` 实测生效） */
function dupLayerByIdCmd(id, name) {
  const c = {
    _obj: "duplicate",
    _target: [{ _ref: "layer", _id: id }],
    _options: { dialogOptions: "dontDisplay" },
  };
  if (name) c.name = String(name);
  return c;
}

/**
 * 出稿：**两步**（都是已验原语）。
 *   ① 一次 `batchPlay`：AM duplicate × N（副本名一次给好）
 *   ② **跨一个模态**：只认"复制前最大 id 之上"的新层 → 逐处写文字 → 网格位移
 * @param {object} plan `lib/batch.js` planExport 的结果
 * @param {object} opts `{ tplId }`
 */
async function exportByRows(plan, opts) {
  const o = opts || {};
  /* 位移走哪条路：`am`（一批 move 命令）/ `dom`（逐叶层 `translate()`）。
     S48 会**两个都单条验**再决定（AM move 拿组当 target 只动一个子层，所以这里是逐叶层发）。 */
  const moveVia = o.moveVia === "am" ? "am" : "dom";   // 默认走"选中+translate"（AM move 不认目标）
  const out = {
    ok: false, dupMs: 0, dupCount: 0, step2Ms: 0, walkMs: 0, writesMs: 0, moveMs: 0,
    copies: 0, newLayers: 0, writes: 0, writesWant: 0, moved: 0, leafMoves: 0, moves: null,
    missing: [], firstError: null, error: null,
  };
  if (!plan || !plan.ok) { out.error = (plan && plan.error) || "没有可用的计划"; return out; }
  if (!hasDocument()) { out.error = "没有打开的文档"; return out; }
  if (!o.tplId) { out.error = "没有模板组 id（先在画布上选中一个图层组）"; return out; }

  out.writesWant = plan.writeCount;
  const moves = [];
  out.moves = moves;

  /* ★ v0.6.0（docs/49 §五 第 3 步）：**动手之前**先记一个撤销标记。
     为什么自动记、而不是让用户点一下"开始前先记标记"：
       用户要的是"事后能退"，不是"事前记得点"。要人记住的防护等于没有防护。
     代价：一次模态 + 几个只读。相对这次出稿（几十上百步）可以忽略。
     ⚠️ 记标记失败**不拦路** —— 记不上标记不该让出稿整个失败；
        但原因要原样带进返回值，让 UI 说清楚"这次没法一键撤"。
     ⚠️ 顺序：必须在 `maxLayerId()` / 复制**之前** —— 标记的是"还没动手"的那个状态。 */
  out.undo = null;
  try {
    const mk = await undoHistory.mark("批量出稿 " + plan.n + " 份");
    out.undo = mk.ok
      ? (function () { const p = undoHistory.peek(); p.superseded = mk.superseded || null; return p; })()
      : { has: false, error: mk.error || "记标记失败" };
  } catch (e) {
    out.undo = { has: false, error: msg(e) };
  }

  const idBefore = maxLayerId();

  /* ① 复制：**一次** batchPlay（N 条命令） */
  const cmds = plan.copies.map((cp) => dupLayerByIdCmd(o.tplId, cp.name));
  out.dupCount = cmds.length;
  const t0 = Date.now();
  try {
    await runModal(async () => {
      await batchPlay(cmds, {});
    }, "Vellum 工具箱：复制 " + plan.n + " 份（" + cmds.length + " 条命令）");
  } catch (e) {
    out.dupMs = Date.now() - t0;
    out.error = "复制失败：" + msg(e);
    return out;
  }
  out.dupMs = Date.now() - t0;

  /* ② **新的模态**里读副本 + 写文字。
     ⚠️ 位移在 **③**，**不在 `step2Ms` 里** —— `step2Ms` 只包住"遍历图层树 + 写文字"这一段。 */
  let tWrite = 0;
  let tWalk = 0;
  const t1 = Date.now();
  try {
    await runModal(async () => {
      const doc = app.activeDocument;
      const amMoveCmds = [];
      const fresh = {};           // 名字 → 图层（**只要新层**：id > idBefore）
      const parents = {};         // 名字 → 它在哪个组（失败时好指认）
      const walkNew = (arr, owner) => {
        for (const l of arr || []) {
          const nm = String(l.name || "");
          if (typeof l.id === "number" && l.id > idBefore && fresh[nm] === undefined) {
            fresh[nm] = l;
            parents[nm] = owner;
          }
          if (l.layers && l.layers.length) walkNew(l.layers, nm);
        }
      };
      const tw0 = Date.now();
      walkNew(doc.layers, "(顶层)");
      tWalk += Date.now() - tw0;
      out.newLayers = Object.keys(fresh).length;

      for (const cp of plan.copies) {
        const g = fresh[cp.name];
        if (!g) {
          out.missing.push("副本「" + cp.name + "」（复制完没找到新层）");
          continue;
        }
        out.copies++;
        /* 副本内部的文字层 —— 按**顺序**收集。
           🔴 为什么不用名字：真机上 `duplicate` 会把副本子层改名（`标题` → `标题 拷贝`），
           按名字配对会**一处都写不上**（S48 第一轮实测 0/6）。副本的子层顺序与模板一致 ⇒ 用序号。 */
        const inner = [];
        const collect = (arr) => {
          for (const k of arr || []) {
            if (k.kind === "text") inner.push(k);
            if (k.layers && k.layers.length) collect(k.layers);
          }
        };
        const tc0 = Date.now();
        collect(g.layers);
        tWalk += Date.now() - tc0;
        for (let i = 0; i < plan.writes.length; i++) {
          const wr = plan.writes[i];
          if (wr.copy !== cp.index) continue;
          const target = inner[wr.layerIndex];
          if (!target) {
            out.missing.push("副本 " + cp.index + " 的第 " + wr.layerIndex + " 个文字层（" + wr.layerName + "）");
            continue;
          }
          const tw = Date.now();
          try {
            target.textItem.contents = wr.value;
            out.writes++;
          } catch (e) {
            if (!out.firstError) out.firstError = "写「" + wr.layerName + "」：" + msg(e);
          }
          tWrite += Date.now() - tw;
        }
        if (cp.dx !== 0 || cp.dy !== 0) moves.push({ id: g.id, name: cp.name, dx: cp.dx, dy: cp.dy });
        out.moved++;
      }
    }, "Vellum 工具箱：写 " + plan.n + " 份的文字（" + plan.writeCount + " 处）");
  } catch (e) {
    out.error = "写文字失败：" + msg(e);
  }
  out.step2Ms = Date.now() - t1;

  /* ③ 网格排开：**逐份"选中 → translate"**。
     🔴 S48 实测（带对照组的单条探针）：**两个位移原语都只作用于"当前活动图层"** ——
       AM `move` 按 `_id` 不认目标、DOM `translate()` 对**非活动**的对象也不起作用
       （第一轮那条"AM move ✓"是**无效读数**：靶层恰好就是活动层，没有对照组）。
     ⇒ 只能"先选中它、再移它"。DOM 写的代价随文档大小涨（v0.4.7 的教训）⇒ 一份只花 2 次写，可接受。 */
  if (moves.length) {
    const t3 = Date.now();
    for (const mv of moves) {
      try {
        let layer = null;
        await runModal(async () => {
          const doc = app.activeDocument;
          const w = (arr) => {
            for (const l of arr || []) {
              if (layer) return;
              if (l.id === mv.id) { layer = l; return; }
              if (l.layers && l.layers.length) w(l.layers);
            }
          };
          w(doc.layers);
          if (!layer) throw new Error("找不到副本 " + mv.name);
          doc.activeLayers = [layer];
        }, "Vellum 工具箱：选中 " + mv.name);
        await runModal(async () => {
          if (typeof layer.translate === "function") layer.translate(mv.dx, mv.dy);
          else throw new Error("这个 UXP 版本的图层没有 translate()");
        }, "Vellum 工具箱：移动 " + mv.name);
      } catch (e) {
        if (!out.firstError) out.firstError = "移动 " + mv.name + "：" + msg(e);
      }
    }
    out.moveMs = Date.now() - t3;
  }
  /* 旧的逐叶层 AM move 路子留作**备用**（moveVia==="am"）—— 但如上，它不认目标，默认不用。 */
  if (moveVia === "am" && amMoveCmds.length) {
    const tm0 = Date.now();
    try {
      await runModal(async () => {
        await batchPlay(amMoveCmds, {});
      }, "Vellum 工具箱：批量位移（备用路）");
    } catch (e) {
      if (!out.firstError) out.firstError = "批量位移：" + msg(e);
    }
    out.moveMs += Date.now() - tm0;
  }
  out.writesMs = tWrite;
  out.walkMs = tWalk;
  if (!out.error) {
    out.ok = out.copies === plan.n && out.writes === plan.writeCount;
    if (!out.ok) {
      out.error = "有 " + (plan.n - out.copies) + " 份副本没找到、" +
        (plan.writeCount - out.writes) + " 处文字没写成功";
    }
  }
  return out;
}

/* ===========================================================================
 * 导出审核版（M5 第 4 步；方案 docs/50，缺陷与改法见 docs/52）
 * ===========================================================================
 * ★ v0.9.2 起走**备路**（用户 2026-10-17 拍板，理由见 docs/52 §四 修法 1）：
 *      0 体检 → 1 版式/文字/主题（**都在原稿上，只读**）→
 *      ① 复制一张**副本** → ①b 副本若非 RGB 先 `changeMode(RGB)`（PNG 只支持 RGB）→
 *      ② 临时把背景色设成**本条的主题底色**（白条就靠它，黑条同理）→
 *      ③ 扩画布（下方加条位）→ ④ 写参数条（正文 / 角标 / 右下依据块 + logo）→
 *      ④c 大稿按长边上限缩放（探到有 API 才做）→ ⑤ asCopy 导出（含**独立复核**）→
 *      ⑥ 还原背景色 → ⑦ 读副本的飞行读数 → **关掉副本（不保存）** →
 *      ⑧ 切回原稿，读回自证「**三项都没变**」
 *
 * 🔴 为什么从"主路"改成"备路"：
 *   PS 的 PNG 存储**不支持 CMYK 稿**（真实报错 `#-25923`，而 UXP **会把这个错吞掉**
 *   ⇒ 表现为"报成功、盘上什么都没有"）—— 用户那张 84×184cm 展架稿正是 CMYK。详见 docs/52。
 *   备路还顺带把"**临时改用户的稿 + 靠历史状态还原**"那一整类风险**整块消掉**：
 *   原稿从头到尾**只被读过**，没有"中间那几秒被改过"这回事。
 *
 * 四条硬约束（**全部来自 review-probe 的真机实测**，别凭印象改）：
 *   🔴 `resizeCanvas` 的锚点**必须用 `photoshop.constants.AnchorPosition` 枚举** ——
 *      传字符串会被**静默忽略**（不报错，但新空间上下各半）—— R7 / R11。
 *   🔴 导出**必须** `asCopy`：`saveAs.png(entry, {}, true)`。不带第 3 参会把**文档改名**
 *      成导出文件名，而改名是**文件级属性，`activeHistoryState` 救不回来** —— R8。
 *   🔴 「白条」不是去"填白"：`resizeCanvas` 的新区域用的是**背景色**填充（R4 像素实测）。
 *      所以必须**临时**把背景色设成纯白、**用完还原**。
 *   🔴 `set` 类必须包在模态里；`get` 不用。`readColor` / `setColor` / `restoreColor`
 *      内部各自 `runModal`，所以这里**不再套第二层模态**。
 *
 * ★ 收尾的「读回自证」**不是可选项**：本项目铁律「**没报错 ≠ 生效**」。
 *   必须读回「画布尺寸 / 图层数 / 背景色」三项都在原位才算成功；
 *   没回到位就**如实报出来**（并提示按 Ctrl+Z），**不装作没事**。
 * ========================================================================= */

/** 本地数字转换（null / "" / 对象壳 → null，**不猜 0**）。 */
function pnum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && "_value" in v) v = v._value;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** 只读：活动文档的三个几何量 + 图层数（deep）。不抛。 */
function readDocGeom() {
  const out = { w: null, h: null, ppi: null, layers: null, name: "" };
  try {
    const d = app.activeDocument;
    if (!d) return out;
    out.w = pnum(d.width);
    out.h = pnum(d.height);
    out.ppi = pnum(d.resolution);
    out.name = String(d.name || "");
  } catch (e) {
    /* 读不到就留 null —— 不许拿 0 冒充 */
  }
  out.layers = undoHistory.currentLayers();
  return out;
}

/** 读回一个 Entry 的字节数（**真读盘**，本项目判据要求读回而不是"没报错"）。 */
async function entryBytes(entry) {
  if (!entry) return null;
  try {
    const formats = uxpNS && uxpNS.storage && uxpNS.storage.formats;
    if (!formats) return null;
    const buf = await entry.read({ format: formats.binary });
    const n = buf && (buf.byteLength !== undefined ? buf.byteLength : buf.length);
    return typeof n === "number" ? n : null;
  } catch (e) {
    return null;
  }
}

/**
 * 在一个目录里按名字找文件 —— **独立于 `entry.read()`**。
 *
 * 🔴 为什么要有它（2026-10-17 真机事故的直接产物）：用户那张 4961×10866 CMYK 的稿
 *   点「导出审核版」，面板报 `bytes=null`，而 `saveAs` **没抛错**。事后查盘：
 *   **目标目录里连一个字节都没有**。但旧代码里"读失败"与"文件不存在"**读数一模一样**
 *   （都是 `entryBytes` 返回 null）⇒ 根本分不清是"**写失败**"还是"**读失败**"，
 *   这就是那次事故查不下去的原因。
 *   ⇒ 现在一律**问目录**：这个文件名在不在、多大。这条路不依赖 `read()`。
 *
 * @param {object} folder 目录 Entry（拿不到就返回 found=false + error）
 * @param {string} name   文件名
 * @returns {Promise<{found:boolean,size:number|null,count:number|null,via:string,error:string}>}
 */
async function fileInFolder(folder, name) {
  const r = { found: false, size: null, count: null, via: "getEntries", error: "" };
  if (!folder || typeof folder.getEntries !== "function") {
    r.error = "拿不到目录句柄（调用方没传 folder）";
    return r;
  }
  try {
    const es = await folder.getEntries();
    r.count = es ? es.length : 0;
    for (const e of (es || [])) {
      if (String(e.name) === String(name)) {
        r.found = true;
        try {
          const b = await e.read({ format: uxpNS.storage.formats.binary });
          r.size = (b && b.byteLength !== undefined) ? b.byteLength : (b ? b.length : null);
        } catch (e2) {
          r.size = null;
          r.error = "目录里找到了它、但读不出字节：" + msg(e2);
        }
        break;
      }
    }
  } catch (e) {
    r.error = "列举目录失败：" + msg(e);
  }
  return r;
}

/**
 * 复制当前文档（**备路的地基**，docs/52 §四 修法 1）。
 *
 * 🔴 为什么要有它：PS 的 PNG 存储**不支持 CMYK**（真报错 `#-25923`，见 docs/52），
 *   而 UXP 会把那个错**吞掉** ⇒ 表现为「命令报成功、盘上什么都没有」。
 *   ⇒ 正解不是"临时把用户的稿改成 RGB 再赌能还原"，而是
 *     **复制一张副本、在副本上折腾**：副本转 RGB、扩画布、画参数条、缩放、存 PNG，
 *     然后**关掉副本（不保存）**。**原稿一根汗毛都不动** ——
 *     连"临时改稿 + 靠历史状态还原"那套风险**整块消失**。
 *
 * ⚠️ `duplicate` 的签名各版本不一（要不要 name）⇒ 逐个试，**不猜**。
 * @returns {Promise<{ok:boolean,id:number|null,name:string,mode:string,error:string,tries:string[]}>}
 */
async function duplicateActive(name) {
  const tries = [];
  const forms = [
    { label: "duplicate(name)", run: async (d) => d.duplicate(name) },
    { label: "duplicate()", run: async (d) => d.duplicate() },
  ];
  for (const f of forms) {
    try {
      let made = null;
      await runModal(async () => {
        made = await f.run(app.activeDocument);
      }, "Vellum 工具箱：复制一张稿（备路）");
      if (made && made.id !== undefined && made.id !== null) {
        return {
          ok: true, id: made.id, name: String(made.name || ""),
          mode: String(made.mode || ""), error: "", tries: tries
        };
      }
      tries.push(f.label + " 没返回文档");
    } catch (e) {
      tries.push(f.label + "：" + msg(e));
    }
  }
  return { ok: false, id: null, name: "", mode: "", error: tries.join("；"), tries: tries };
}

/**
 * 把**当前文档**改成 RGB —— PNG 存储只认 RGB（docs/52）。
 * ⚠️ **只允许在副本上调用**，绝不能对用户的稿做这件事。
 * @returns {Promise<boolean>} 是否（本来就是 / 已成功改成）RGB
 */
async function ensureRGBDoc(out) {
  let before = "";
  try { before = String(app.activeDocument.mode); } catch (e) { before = ""; }
  if (before && before.indexOf("RGB") >= 0) {
    out.steps.push("mode 已是 RGB（无需转）");
    return true;
  }
  try {
    const CN = (constants && constants.DocumentMode) || null;
    const target = (CN && CN.RGB) || "RGBColorMode";
    await runModal(async () => {
      await app.activeDocument.changeMode(target);
    }, "Vellum 工具箱：把副本转成 RGB（PNG 只支持 RGB）");
    let after = "";
    try { after = String(app.activeDocument.mode); } catch (e) { after = ""; }
    out.steps.push("changeMode → " + after);
    const okNow = !!after && after.indexOf("RGB") >= 0;
    if (!okNow) out.warnings.push("副本转 RGB 后读回仍是 " + after + " ⇒ PNG 很可能还是存不出来");
    return okNow;
  } catch (e) {
    out.steps.push("changeMode THREW");
    out.warnings.push("副本转 RGB 失败（" + msg(e) + "）⇒ PNG 存不出来（PS 的 PNG 只支持 RGB）");
    return false;
  }
}

/**
 * 保存 PNG + **独立复核**（问目录）+ 必要时重试。审核版与成品图共用。
 * **不提前 return**（成败记在 `out` 里），由调用方统一收尾。
 */
async function savePngWithCheck(out, opt, tag) {
  if (!opt.entry) {
    out.steps.push("saveAs 跳过（没给 entry）");
    return;
  }
  const doSave = async function () {
    await runModal(async () => {
      await app.activeDocument.saveAs.png(opt.entry, {}, true);
    }, "Vellum 工具箱：" + tag);
  };
  out.file = { name: safeStr(opt.entry.name), path: safeStr(opt.entry.nativePath) };
  const haveFolder = !!(opt.folder && typeof opt.folder.getEntries === "function");

  /* ① 保存前**确保目标不存在**。
     ⚠️ 反面教训：曾用"预写 0 字节让 entry 落地"来对付 `createFile` 的惰性，
        结果目标变成"已存在"，PS 那次保存**一个字节都没写**。正解是反过来的：先清掉。 */
  const clearTarget = async function (tag2) {
    if (!haveFolder) return;
    try {
      const pre = await fileInFolder(opt.folder, opt.entry.name);
      if (pre.found) {
        try { await opt.entry.delete(); out.steps.push(tag2 + " 已清掉同名旧文件"); }
        catch (eD) { out.steps.push(tag2 + " 清旧文件失败(" + msg(eD) + ")"); }
      }
    } catch (e) { out.steps.push(tag2 + " 预检异常(" + msg(e) + ")"); }
  };
  await clearTarget("saveAs前");

  /* ② 记下"保存时到底是哪个文档" —— 万一存错稿，这条就是证据 */
  try {
    const d0 = app.activeDocument;
    out.savedDoc = {
      name: String(d0.name || ""), w: pnum(d0.width), h: pnum(d0.height),
      mode: String(d0.mode || "")
    };
  } catch (eD) { out.savedDoc = { name: "读不到：" + msg(eD) }; }

  /* ③ 保存 */
  try {
    await doSave();
    out.steps.push("saveAs(asCopy) ok");
  } catch (e) {
    out.steps.push("saveAs THREW");
    out.error = "导出失败：" + msg(e);
    return;
  }

  /* ④ 独立复核：**问目录**这个文件名在不在（不看 saveAs 有没有报错） */
  if (haveFolder) {
    out.fileCheck = await fileInFolder(opt.folder, opt.entry.name);
    if (!out.fileCheck.found) {
      out.steps.push("复核①目录里没找到 ⇒ 重试保存一次");
      await new Promise(function (res) { setTimeout(res, 400); });
      await clearTarget("重试前");
      try {
        await doSave();
        out.steps.push("saveAs 重试 ok");
      } catch (eR) {
        out.steps.push("saveAs 重试 THREW");
        out.warnings.push("重试保存也失败：" + msg(eR));
      }
      await new Promise(function (res) { setTimeout(res, 400); });
      out.fileCheck = await fileInFolder(opt.folder, opt.entry.name);
    }
  } else {
    out.fileCheck = {
      found: null, size: null, count: null, via: "退化(entryBytes)",
      error: "调用方没传 folder ⇒ 只能用老判据"
    };
    out.steps.push("复核跳过（没给 folder）");
  }
  out.fileBytes = await entryBytes(opt.entry);

  /* ⑤ 命令说 ok、盘上却没有 ⇒ **这才是真相**，如实报出来（不写"没报错就算成功"） */
  if (haveFolder && !out.fileCheck.found) {
    let modeNote = "";
    try {
      out.docMode = String(app.activeDocument.mode);
      if (out.docMode.indexOf("CMYK") >= 0) {
        modeNote = "　⚠ 成因：这张稿是 " + out.docMode +
          " —— PS 的 PNG 存储不支持 CMYK（真实报错 #-25923「命令「存储」的参数当前是无效的」），" +
          "而 UXP 会把这个错吞掉。见 docs/52。";
      }
    } catch (eM) { /* 忽略 */ }
    out.error = "PS 报告保存成功，但目标目录里查不到这个文件（已自动重试 1 次）。"
      + "文件名=" + safeStr(opt.entry.name)
      + "　目录=" + (safeStr(opt.folder && opt.folder.nativePath) || "（拿不到路径）")
      + (out.fileCheck.error ? "　复核错误=" + out.fileCheck.error : "")
      + modeNote;
  }
}

/** 关掉一张**副本**（不保存）。失败只记 steps，不抛。 */
async function closeQuietly(out, id, tag) {
  if (id === null || id === undefined) return false;
  try {
    const r = await closeDocument(id);
    out.steps.push((tag || "close") + " " + (r && r.ok ? "ok" : "fail"));
    return !!(r && r.ok);
  } catch (e) {
    out.steps.push((tag || "close") + " THREW");
    return false;
  }
}

/** 切回某张文档（失败只记 steps，不抛）。 */
async function activateQuietly(out, id, tag) {
  if (id === null || id === undefined) return false;
  try {
    await activateDocument(id);
    out.steps.push((tag || "activate") + " ok");
    return true;
  } catch (e) {
    out.steps.push((tag || "activate") + " THREW");
    return false;
  }
}

/**
 * 导出审核版 / 成品图。
 *
 * @param {object} o
 *   `o.entry`  目标文件 Entry（**必须已存在**；由调用方用目录 + createFile 拿到）。
 *              传 null = 只改稿不导出（诊断用）。
 *   `o.kind`   `"review"`（默认，含参数条）| `"final"`（只 asCopy 导出，**完全不动稿**）
 *   `o.bleed`  `{ state:"none"|"has"|"unknown", mm:number|null }`
 *   `o.when`   Date 或时间戳（导出时间，参数条上要印）
 *   `o.insp`   可选：`docInspect()` 的结果。**不传就在动手之前自己取一份** ——
 *              参数条的字段只认这一份来源（docs/49 §3.0）。
 *   `o.text`   false = 扩画布但不写参数条（诊断用）
 * @returns {Promise<object>} 一份**带读数**的结果（`before` / `after` / `restored` / `lines`…）
 */
async function exportReview(o) {
  const opt = o || {};
  const kind = opt.kind === "final" ? "final" : "review";
  const when = opt.when || new Date();
  const wantText = opt.text !== false;
  const t0 = Date.now();

  const out = {
    ok: false,
    kind: kind,
    when: when,
    file: null, fileBytes: null,
    before: null, after: null,
    restored: null,
    resizeReadback: null, bgWhite: null, bgRect: null, bgPixels: null, bgPixelsHit: null,
    bgProbeReads: null,
    textReadback: null, tagReadback: null,
    /* v0.9.0（docs/51）：主题判定 / 缩放计划 / 依据块与 logo 的读回 */
    theme: null, scale: null, scaleApplied: null,
    basisReadback: null, logoReadback: null, textInk: null,
    /* v0.9.1：导出落点的**独立复核**（盘上到底有没有）+ 保存时到底是哪个文档 */
    fileCheck: null, savedDoc: null, docMode: null,
    /* v0.9.2（docs/52 修法 1 · 备路）：副本 + 原稿 + 副本上的飞行读数 */
    dup: null, origId: null, dupHit: null, hitCanvas: null, hitLayers: null,
    metrics: null, lines: null, bleed: opt.bleed || { state: "unknown", mm: null },
    /* ⚠️ `undo` / `undoRevert`：v0.9.2 起备路**不再需要还原**（原稿全程没被写过），
       保留字段只为兼容旧读数与界面。 */
    undo: null, undoRevert: null, bgRestore: null,
    steps: [],
    ms: 0, error: null, warnings: [],
  };

  if (!hasDocument()) {
    out.error = "没有打开的文档";
    out.ms = Date.now() - t0;
    return out;
  }

  /* ---- 0. 体检（只读、不进模态）----
     ★ 必须在**动手之前**取，否则参数条会把"自己刚加的那两层"也算进去
       （未转曲文字层数会 +1、图层数变化），那是自欺。 */
  let insp = opt.insp || null;
  if (!insp) {
    try {
      insp = inspectLib.docInspect();
    } catch (e) {
      insp = { ok: false, error: msg(e) };
    }
  }
  if (kind === "review" && (!insp || !insp.ok)) {
    out.error = "体检失败（参数条没有数据来源）：" + ((insp && insp.error) || "未知");
    out.ms = Date.now() - t0;
    return out;
  }

  /* ---- 1. 几何 + 参数条文字（全是纯函数）---- */
  const geom0 = readDocGeom();
  out.before = geom0;
  if (geom0.w === null || geom0.h === null || geom0.w <= 0 || geom0.h <= 0) {
    out.error = "读不到文档尺寸（宽/高），无法算参数条";
    out.ms = Date.now() - t0;
    return out;
  }

  /* ---- 1. 缩放计划 + 参数条文字 + 版式（全是纯函数）---- */
  const plan = reviewLib.planScale(geom0.w, geom0.h);
  out.scale = plan;

  const strip = reviewLib.stripLines(insp, { bleed: out.bleed, when: when, scale: plan });
  if (kind === "review" && !strip.ok) {
    out.error = "参数条内容算不出来：" + strip.error;
    out.ms = Date.now() - t0;
    return out;
  }
  const met = reviewLib.stripMetrics(
    geom0.w, geom0.h, geom0.ppi, strip.lines, strip.tag, strip.basis
  );
  out.metrics = met;
  out.lines = { ok: strip.ok, lines: strip.lines, tag: strip.tag, basis: strip.basis };

  const bgRaw0 = await readColor("background");
  out.before.bg = bgRaw0.ok ? bgRaw0.hex : null;

  /* ---- 1b. 主题判定（**只读**：取图片底部横带的平均色）----
     ★ 用 `imaging.getPixels` 在 1×1 上取平均（`composite:true` = 文档合成）——
       **只读、不动文档、不进历史**，所以可以放心地放在"记标记"之前。
     ★ 取不到就退回浅条并标明 `from:"fallback"`，**不假装判过**（docs/51 §3.1）。 */
  if (kind === "review") {
    const band = reviewLib.sampleBandRect(geom0.w, geom0.h, met.baseStripH);
    const sample = await sampleRectAvgColor(band, { composite: true });
    const ti = reviewLib.pickTheme(sample);
    ti.band = band;
    out.theme = ti;
    out.steps.push("theme " + ti.theme.id + "(" + ti.from + ")");
  }

  /* ---- 成品图：**也走备路**（PNG 存不了 CMYK；这样原稿一定不动）---- */
  if (kind === "final") {
    let origF = null;
    try { origF = app.activeDocument.id; } catch (e) { origF = null; }
    out.origId = origF;

    const dupF = await duplicateActive(geom0.name + " · 成品图工作副本");
    out.dup = { ok: dupF.ok, id: dupF.id, name: dupF.name, mode: dupF.mode, error: dupF.error };
    out.steps.push("duplicate " + (dupF.ok ? "ok" : "FAILED"));
    if (!dupF.ok) {
      out.error = "复制工作副本失败（成品图走的是备路）：" + (dupF.error || "未知") +
        "　⚠ 你的稿**没有被改动过**。";
      out.ms = Date.now() - t0;
      return out;
    }
    await ensureRGBDoc(out);
    await savePngWithCheck(out, opt, "导出成品图（asCopy）");

    out.dupHit = readDocGeom();     // 副本的原始状态（成品图不该动它）
    out.hitCanvas = false;
    out.hitLayers = false;
    await closeQuietly(out, dupF.id, "close 副本");
    await activateQuietly(out, origF, "切回原稿");

    out.after = readDocGeom();
    out.after.bg = (await readColor("background")).hex || null;
    out.restored = {
      w: out.after.w === out.before.w,
      h: out.after.h === out.before.h,
      layers: out.after.layers === out.before.layers,
      bg: out.after.bg === out.before.bg,
    };
    /* 成品图不该动稿 ⇒ 三项都必须"没变"（备路下这是"从头到尾没碰过"） */
    const untouchedF = !!(out.restored.w && out.restored.h &&
      out.restored.layers && out.restored.bg);
    const fileOkF = opt.entry ? (out.fileBytes !== null && out.fileBytes > 0) : true;
    out.ok = !!(untouchedF && fileOkF && !out.error);
    if (!out.ok && !out.error) {
      out.error = !untouchedF
        ? "成品图导出了，但原稿被动过（**不该发生**：备路只在副本上作业）：" +
          JSON.stringify(out.restored)
        : "导出文件读回是空/读不到（bytes=" + out.fileBytes + "）";
    }
    out.ms = Date.now() - t0;
    return out;
  }

  /* ---- ① 复制一张副本（**备路**：此后所有改动都打在副本上，原稿只被读过）----
     🔴 为什么必须复制：PS 的 PNG 存储**不支持 CMYK**（docs/52），
        而"临时把用户的稿改成 RGB、再赌历史状态能还原"是**拿用户的稿在冒险**。
        副本是**逐像素副本** ⇒「审核版必须真实反映原稿」照样成立。 */
  let origId = null;
  try { origId = app.activeDocument.id; } catch (e) { origId = null; }
  out.origId = origId;

  const dup = await duplicateActive(geom0.name + " · 审核版工作副本");
  out.dup = { ok: dup.ok, id: dup.id, name: dup.name, mode: dup.mode, error: dup.error };
  out.steps.push("duplicate " + (dup.ok ? "ok" : "FAILED"));
  if (!dup.ok) {
    out.error = "复制工作副本失败（备路必须先复制一张）：" + (dup.error || "未知") +
      "　⚠ 你的稿**没有被改动过**。";
    out.ms = Date.now() - t0;
    return out;
  }

  /* ---- ①b 副本若不是 RGB 先转 RGB（PNG 存储只认 RGB；见 docs/52）---- */
  await ensureRGBDoc(out);

  /* ⚠️ 从这里开始 `app.activeDocument` 是**副本**。
        原稿只在最后被切回去读一次，**全程不做任何写操作**。 */

  /* ---- ② 参数条底色：**不再靠「背景色 + 扩画布填充」**（v0.9.5 改）----
     🔴 根因（用户 2026-10-17 真机报障「参数条背景无填充」）：
     `resizeCanvas` 扩出来的新区域**恒为白色**，与当前「背景色」无关 —— 实测：
       · `setColor("background", #111111)` 的**真读回**就是 `#111111`（`ok` 判据 = 回读命中）；
       · 而扩画布后该区域像素仍是 `(255,255,255)`（不是透明 —— 透明转 RGB 会是黑）。
     ⚠️ 更早 `review-probe` 的 R4 结论「新区域 = 背景色填充」**是错的** ——
       当时背景色恰好是白，实验**无法区分**「填背景色」与「恒填白」（**缺负对照**）。
     ⇒ 正解：扩画布后，在那个位置**放一个填充矩形层**（`makeRectShapeLayer`，M3a 已验证）。
     ⇒ 顺带**不再需要「设背景色 / 还原背景色」**那两步（少碰一次 app 级设置、少一个出错点）。 */
  const theme = out.theme ? out.theme.theme : reviewLib.THEME_LIGHT;

  /* ---- ③ 扩画布：锚点**必须**用枚举（字符串会被静默忽略）---- */
  try {
    await runModal(async () => {
      const d = app.activeDocument;
      const AN = constants && constants.AnchorPosition ? constants.AnchorPosition.TOPCENTER : null;
      if (!AN) throw new Error("photoshop.constants.AnchorPosition 不可用（无法保证新空间落在下方）");
      await d.resizeCanvas(out.metrics.imgW, out.metrics.imgH + out.metrics.stripH, AN);
      /* ★ 飞行中读回：证明画布**真的变高了**（而不是"命令没报错就算数"）。
         它不仅当读数，也是负对照 —— 自检拿它和 stripH 对账。 */
      out.resizeReadback = { w: pnum(d.width), h: pnum(d.height) };
    }, "Vellum 工具箱：为参数条加高画布");
    out.steps.push("resizeCanvas ok (+" + out.metrics.stripH + "px)");
  } catch (e) {
    out.error = "扩画布失败：" + msg(e) + "　⚠ 你的稿**没有被改动过**（备路只在副本上作业）。";
    /* 失败就收摊：把副本关掉，原稿本来就是干净的 */
    await closeQuietly(out, dup.id, "close 副本(失败收摊)");
    await activateQuietly(out, origId, "切回原稿");
    out.ms = Date.now() - t0;
    return out;
  }

  /* ---- ③b 参数条底色：**填充矩形层**（v0.9.5；替代原来的「背景色 + 扩画布填充」）----
     判据不靠"命令没报错"：`makeRectShapeLayer` 自己**读回图层数**才算成功。 */
  try {
    const st = out.metrics.strip;
    const rc = await makeRectShapeLayer(
      { left: st.left, top: st.top, right: st.right, bottom: st.bottom },
      theme.bg,
      { name: "参数条底色", fill: true, stroke: false }
    );
    out.bgRect = {
      ok: !!rc.ok, via: rc.via || "", attempts: rc.attempts || [],
      wantHex: theme.bgHex, rect: rc.rect || null, error: rc.error || ""
    };
    out.steps.push("bgRect " + (rc.ok ? "ok(" + theme.bgHex + ")" : "fail(" + (rc.error || "?") + ")"));
    if (!rc.ok) {
      out.warnings.push("参数条底色矩形没建出来（" + (rc.error || "") + "）⇒ 底色会是白的（深条会看不清字）");
    }
  } catch (eB) {
    out.steps.push("bgRect THREW");
    out.warnings.push("建参数条底色矩形抛异常：" + msg(eB));
  }

  /* ---- ④ 写参数条 ---- */
  if (wantText) {
    /* ★ v0.9.3：整块文字要**垂直居中** ⇒ 先定一个"整块下移量"，
       角标与依据块共用它（三者相对位置不变）。原因见下面读回正文外框那段。 */
    let textDy = 0;
    try {
      /* 🔴 段落分隔符必须是 **`\r`**，不是 `\n` —— 真机样张实测（v0.8.0 第一轮）：
         用 `\n` 时 PS **不换行**，三行被拼成一行、右侧超出画布被裁掉（连角标都被盖住）。
         ActionDescriptor 里的文本引擎用 CR 作段落分隔，这是 PS 的老约定。 */
      const mainText = strip.lines.join("\r");
      const main = await makeTextLayerBox({
        text: mainText,
        box: out.metrics.text,
        sizePt: out.metrics.fontPt,
        rgb: theme.fg,
        name: "审核参数条",
      });
      out.steps.push("text(main) " + (main.ok ? "ok" : "fail"));
      out.mainLayer = main.layer || null;
      if (!main.ok) out.warnings.push("参数条正文没建出来：" + (main.error || "图层数没增加"));

      /* ★ 读回：把那层的 `textItem.contents` 读出来（本项目铁律：没报错 ≠ 生效）。
         它同时当"换行真的生效了"的判据 —— 拼接成一行的写法在这里会现形。
         ⚠️ 找层**不能用我们给的名字**：真机实测 `make textLayer` 的 `name` 不生效
         （层名会变成「文字图层 n」，这正是 `textLayerBoxDesc` 里 S40 那条警告）。
         所以一律用 `layerInfo()` 回报的**真实层名**。 */
      try {
        const d = app.activeDocument;
        const nm = main.layer && main.layer.name;
        const L = (nm ? findLayerDeep(nm, "text") : null) || ((d.activeLayers || [])[0] || null);
        out.textReadback = (L && L.textItem) ? String(L.textItem.contents || "") : null;
      } catch (e) {
        out.textReadback = null;
      }

      /* ★ v0.9.3（用户报"文字整体有些靠上"）：**按真实墨迹边界垂直居中**。
         为什么必须读回再平移：`makeTextLayerBox` 只设了**字号**、没设行距
         ⇒ PS 用**自动行距**，实际行距 ≠ 我们算的 `lineH`
         ⇒ 按"行数 × lineH"当块高去居中**必然偏上**（真机量过：上留白 13px / 下留白 37px）。
         ⇒ 量正文层的**真实外框**，整块挪到上下留白相等。 */
      try {
        const mb = readActiveLayerBounds();
        if (mb.ok && out.metrics && out.metrics.strip) {
          const inkH = mb.bounds.bottom - mb.bounds.top;
          const targetTop = out.metrics.strip.top + (out.metrics.stripH - inkH) / 2;
          textDy = Math.round(targetTop - mb.bounds.top);
          out.textInk = {
            before: { top: mb.bounds.top, bottom: mb.bounds.bottom },
            h: inkH, dy: textDy, after: null
          };
          if (textDy !== 0) {
            await applyLayerRect({
              left: mb.bounds.left, top: mb.bounds.top + textDy,
              right: mb.bounds.right, bottom: mb.bounds.bottom + textDy,
            });
          }
          const mb2 = readActiveLayerBounds();
          if (mb2.ok) out.textInk.after = { top: mb2.bounds.top, bottom: mb2.bounds.bottom };
          out.steps.push("text 垂直居中 dy=" + textDy);
        } else {
          out.warnings.push("量不到正文层外框，没法按墨迹居中：" + (mb.error || "未知"));
        }
      } catch (eC) {
        out.warnings.push("正文层居中抛异常：" + msg(eC));
      }
    } catch (e) {
      out.steps.push("text(main) THREW");
      out.warnings.push("参数条正文抛异常：" + msg(e));
    }
    try {
      /* 右上角标。
         🔴 **不要传 `align`（段落右对齐）** —— v0.8.0 第二轮真机读回：给角标一个
            "整宽 + 右对齐"的盒子，PS 把它排到了 x=6403..6548，**整块跑到画布外**，
            导出图上根本看不见（而建层命令报的是成功）。
            ⇒ 改成：盒子的位置与宽度**由 review.js 算好**，这里用默认（左）对齐。 */
      const tag = await makeTextLayerBox({
        text: strip.tag,
        /* ★ v0.9.3：跟正文一起下来（**同一个 dy**）⇒ 角标与正文第 1 行的相对位置不变 */
        box: {
          left: out.metrics.tag.left, top: out.metrics.tag.top + textDy,
          right: out.metrics.tag.right, bottom: out.metrics.tag.bottom + textDy
        },
        /* ★ v0.9.3：角标用**自己的**字号（比正文大）—— 用户：
           「审核用·非成品」要稍大些，怕真被当成成品。 */
        sizePt: out.metrics.tagFontPt || out.metrics.fontPt,
        rgb: theme.tag,
        name: "审核角标",
      });
      out.steps.push("text(tag) " + (tag.ok ? "ok" : "fail"));
      out.tagLayer = tag.layer || null;
      if (!tag.ok) out.warnings.push("角标没建出来：" + (tag.error || "图层数没增加"));

      /* ★ 角标读回：第一轮真机样张里角标**根本没出现在导出图上**，
         而"建层命令没报错"。所以这里把它的可见性 / 文字 / 外框都读回来，
         好在自检读数里直接看出是"没建"、"不可见"、还是"位置跑到画布外"。 */
      try {
        const nmT = tag.layer && tag.layer.name;
        const TL = nmT ? findLayerDeep(nmT, "text") : null;
        if (TL) {
          const bd = TL.bounds || null;
          out.tagReadback = {
            name: String(TL.name || ""),
            visible: TL.visible === undefined ? null : !!TL.visible,
            contents: (TL.textItem ? String(TL.textItem.contents || "") : null),
            bounds: bd
              ? [pnum(bd._left !== undefined ? bd._left : bd.left),
                 pnum(bd._top !== undefined ? bd._top : bd.top),
                 pnum(bd._right !== undefined ? bd._right : bd.right),
                 pnum(bd._bottom !== undefined ? bd._bottom : bd.bottom)]
              : null
          };
        }
      } catch (e) {
        out.tagReadback = { error: msg(e) };
      }
    } catch (e) {
      out.steps.push("text(tag) THREW");
      out.warnings.push("角标抛异常：" + msg(e));
    }

    /* ---- ④b 右下「依据」块：文字 + 前面的 logo（v0.9.0 / docs/51 §3.3）----
       ★ **右对齐不用段落对齐枚举**（v0.8.0 实测：整宽 + align:right 会被排到画布外）。
         做法：先按估算位置建层 → 读回 `bounds` → 按"右边界差多少"精确平移 → **再读回自证**。 */
    if (strip.basis) {
      try {
        const bk = await makeTextLayerBox({
          text: strip.basis,
          /* ★ v0.9.3：同一个 dy */
          box: {
            left: out.metrics.basis.text.left, top: out.metrics.basis.text.top + textDy,
            right: out.metrics.basis.text.right, bottom: out.metrics.basis.text.bottom + textDy
          },
          sizePt: out.metrics.fontPt,
          rgb: theme.fg,
          name: "审核依据",
        });
        out.steps.push("text(basis) " + (bk.ok ? "ok" : "fail"));
        if (!bk.ok) out.warnings.push("依据块没建出来：" + (bk.error || "图层数没增加"));

        const b1 = readActiveLayerBounds();
        if (b1.ok) {
          const dx = out.metrics.basis.text.right - b1.bounds.right;
          const dy = out.metrics.basis.text.top - b1.bounds.top;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            await applyLayerRect({
              left: b1.bounds.left + dx, top: b1.bounds.top + dy,
              right: b1.bounds.right + dx, bottom: b1.bounds.bottom + dy,
            });
            out.steps.push("basis 平移 dx=" + Math.round(dx) + " dy=" + Math.round(dy));
          } else {
            out.steps.push("basis 位置已准（无需平移）");
          }
        } else {
          out.warnings.push("量不到依据层的外框：" + b1.error);
        }
        const b2 = readActiveLayerBounds();
        out.basisReadback = b2.ok ? b2.bounds : { error: b2.error };
      } catch (e) {
        out.steps.push("text(basis) THREW");
        out.warnings.push("依据块抛异常：" + msg(e));
      }

      /* logo：置入插件自带的品牌 mark，再按算好的矩形精确定位。
         ⚠️ logo 是**彩色**的（蓝绿 + 米色）⇒ 白条黑条上都看得见，不用做两版。 */
      try {
        const lfsL = uxpNS && uxpNS.storage ? uxpNS.storage.localFileSystem : null;
        let logoEntry = null;
        if (lfsL && typeof lfsL.getPluginFolder === "function") {
          const pf = await lfsL.getPluginFolder();
          const dir = pf ? await pf.getEntry("icons") : null;
          if (dir) logoEntry = await dir.getEntry("logo-mark.png");
        }
        if (!logoEntry) throw new Error("取不到插件里的 icons/logo-mark.png");

        const placed = await placeFile(logoEntry);
        if (!placed || !placed.ok) {
          throw new Error("置入失败：" + ((placed && placed.error) || "未知"));
        }
        /* ★ v0.9.3（用户报"logo 位置偏了"）：logo 的 x **按依据文字的真实外框**算，
           **不再用估算宽度** —— 真机量过：估算偏大 ⇒ logo 与文字之间多出
           **整整一个 logo 宽**的空隙（54px）。
           判据：logo 右边界 = 依据文字左边界 − gap（且不许压到正文）。 */
        let logoRect = {
          left: out.metrics.basis.logo.left,
          top: out.metrics.basis.logo.top + textDy,
          right: out.metrics.basis.logo.right,
          bottom: out.metrics.basis.logo.bottom + textDy
        };
        try {
          if (out.basisReadback && out.basisReadback.left !== undefined) {
            const bt = out.basisReadback;
            const logoW = out.metrics.basis.logoW;
            const logoH = out.metrics.basis.logoH;
            const gp = out.metrics.basis.gap;
            const minRight = out.metrics.text.right + gp + logoW;   // 不许压到正文
            const right = Math.max(minRight, bt.left - gp);
            /* ★ **垂直也对齐到依据文字的真实外框**（取它的中心线）。
               真机量过：只对齐 x 的话 logo 会偏下约 7.5px（因为行位是算出来的，
               而 PS 的真实行距不等于我们算的 lineH）。 */
            const cy = (bt.top + bt.bottom) / 2;
            logoRect = {
              left: right - logoW, top: cy - logoH / 2,
              right: right, bottom: cy + logoH / 2
            };
            out.steps.push("logo x 按真实外框 " + Math.round(logoRect.left) +
              ".." + Math.round(right));
          }
        } catch (eL) { /* 用回估算值 */ }
        const ar = await applyLayerRect(logoRect);
        out.steps.push("logo " + (ar.ok ? "ok" : "fail"));
        if (!ar.ok) out.warnings.push("logo 定位没成功：" + (ar.error || "未知"));

        const lb = readActiveLayerBounds();
        out.logoReadback = lb.ok ? lb.bounds : { error: lb.error };
      } catch (e) {
        out.steps.push("logo THREW");
        out.warnings.push("logo 置入/定位抛异常：" + msg(e));
      }
    }
  }

  /* ---- ④c 像素自证：参数条的**真实底色**（v0.9.5 新增）----
     ⚠️ 为什么必须验像素：本次事故正是「层都在、命令全 ok，唯独底色是白的」。
     ⚠️ 为什么判据用「**整条**参数条的平均**亮度**」而不是「角落一小块」：
        第一版用左上角 10×10 取样，读到 `#EAEAEA`（该组期望 `#111111`），
        而**导出的 PNG 上明明是 (17,17,17)**（离线量过）⇒ 小区域的取整/边界不可靠。
        整条平均亮度这个判据很稳：底色对与不对差 0.6 以上（文字只占小面积，翻不了黑白）。
     ⇒ 同时把 4 个采样点（整条／条顶／条底／图区）如实打进 steps，便于下次定位坐标问题。 */
  try {
    const st = out.metrics.strip;
    const cx = Math.round(out.metrics.imgW / 2);
    const midY = Math.round(out.metrics.imgH / 2);
    const pts = [
      { k: "整条", r: { left: st.left, top: st.top, right: st.right, bottom: st.bottom }, main: true },
      { k: "条顶", r: { left: cx - 5, top: st.top + 2, right: cx + 5, bottom: st.top + 12 } },
      { k: "条底", r: { left: cx - 5, top: st.bottom - 12, right: cx + 5, bottom: st.bottom - 2 } },
      { k: "图区", r: { left: cx - 5, top: midY - 5, right: cx + 5, bottom: midY + 5 } }
    ];
    const reads = [];
    let main = null;
    for (const pt of pts) {
      const s1 = await sampleRectAvgColor(pt.r, { composite: true });
      if (s1 && s1.ok) {
        const lum = (0.299 * s1.rgb.r + 0.587 * s1.rgb.g + 0.114 * s1.rgb.b) / 255;
        reads.push(pt.k + "=" + s1.hex + "(" + lum.toFixed(2) + ")");
        if (pt.main) main = { hex: s1.hex, rgb: s1.rgb, lum: lum };
      } else {
        reads.push(pt.k + "=取不到");
      }
    }
    out.bgPixels = main;
    out.bgProbeReads = reads.slice();
    const wantDarkBg = String(theme.id) === "dark";
    const hit = !!main && (wantDarkBg ? main.lum < 0.5 : main.lum > 0.5);
    out.bgPixelsHit = hit;
    out.steps.push("bgPixels[" + reads.join(" ") + "]" + (hit ? " ok" : " MISMATCH"));
    if (!hit) {
      out.warnings.push("参数条底色不对：整条平均 " +
        (main ? main.hex + "（亮度 " + main.lum.toFixed(2) + "）" : "取不到") +
        "，期望" + (wantDarkBg ? "偏暗" : "偏亮") + "（" + theme.bgHex + "）");
    }
  } catch (eP) {
    out.steps.push("bgPixels THREW");
    out.warnings.push("参数条底色取像素抛异常：" + msg(eP));
  }

  /* ---- ④d 大稿缩放（v0.9.0 / docs/51 §四 路线 D）----
     ⚠️ 「**怎么缩**」在动手前**没有验过**：官方样例与本仓库都没有 `imageSize` 描述符，
        `Document.resizeImage` 在不在也要实测。所以这里**先探能力再动手** ——
        有 API 才缩；没有就**如实记「没缩」**，**绝不猜一个描述符**（项目铁律）。
     ⚠️ 顺序：必须放在**写完参数条之后** —— 参数条要跟着整张图一起缩下去，
        所以先按原尺寸排好版，再整体缩（比例因此天然保持）。 */
  if (wantText && out.scale && out.scale.applied) {
    out.scaleApplied = { applied: false, hasApi: null, reason: "未执行" };
    try {
      let hasApi = false;
      try { hasApi = typeof app.activeDocument.resizeImage === "function"; } catch (e) { hasApi = false; }
      out.scaleApplied.hasApi = hasApi;

      if (!hasApi) {
        out.scaleApplied.reason = "本机 Document 上没有 resizeImage ⇒ 没有缩";
        out.steps.push("resizeImage API 缺失 ⇒ 跳过缩放");
        out.warnings.push(
          "这张稿按计划该缩（" + out.scale.reason + "），但本机 UXP 没有 `Document.resizeImage` ⇒ " +
          "**导出的是原尺寸**。参数条上印的「已缩至 …」是**计划值**，与实际不符 —— 请按 Ctrl+Z 重来或改 spec。"
        );
      } else {
        await runModal(async () => {
          await app.activeDocument.resizeImage(out.scale.w, out.scale.h);
        }, "Vellum 工具箱：按长边上限缩放");
        const rb = readDocGeom();
        out.scaleApplied = {
          applied: true, hasApi: true, w: rb.w, h: rb.h, reason: out.scale.reason
        };
        out.steps.push("resizeImage → " + rb.w + "×" + rb.h);
      }
    } catch (e) {
      out.scaleApplied = {
        applied: false, hasApi: out.scaleApplied.hasApi,
        reason: "缩放抛异常：" + msg(e)
      };
      out.steps.push("resizeImage THREW");
      out.warnings.push("缩放失败（" + msg(e) + "）⇒ 导出的是原尺寸（参数条上的「已缩至 …」是计划值）");
    }
  }

  /* ---- ⑤ 导出（**必须 asCopy** + 独立复核 + 重试）---- */
  await savePngWithCheck(out, opt, "导出审核版（asCopy）");

  /* ---- ⑦ 读**副本**的飞行读数（关掉前读）—— 反向证明前面几步不是空转 ---- */
  out.dupHit = readDocGeom();
  out.dupHit.bg = (await readColor("background")).hex || null;
  out.hitCanvas = !!(out.before.h !== null && out.dupHit.h !== null &&
    out.dupHit.h !== out.before.h);
  out.hitLayers = !!(out.before.layers !== null && out.dupHit.layers !== null &&
    out.dupHit.layers !== out.before.layers);
  out.steps.push("副本飞行读数 " + out.dupHit.w + "×" + out.dupHit.h +
    " / " + out.dupHit.layers + " 层");

  /* ---- ⑦b 关掉副本（**不保存**）—— 它彻底消失，用户看不到任何残留 ---- */
  await closeQuietly(out, dup.id, "close 副本");

  /* ---- ⑧ 切回原稿 + 读回自证：三项都必须“没变”（**这才是判据**）----
     ★ 备路的判据比主路**更强**：主路是“改过又还回去”，备路是“**从头到尾没碰过**”。 */
  await activateQuietly(out, origId, "切回原稿");
  out.after = readDocGeom();
  out.after.bg = (await readColor("background")).hex || null;
  out.restored = {
    w: out.after.w === out.before.w,
    h: out.after.h === out.before.h,
    layers: out.after.layers === out.before.layers,
    bg: out.after.bg === out.before.bg,
  };

  const untouched = !!(out.restored.w && out.restored.h &&
    out.restored.layers && out.restored.bg);
  const dupDidWork = !!(out.hitCanvas || out.hitLayers);
  const fileOk = opt.entry ? (out.fileBytes !== null && out.fileBytes > 0) : true;
  out.ok = !!(untouched && fileOk && !out.error);
  if (!out.ok && !out.error) {
    out.error = !untouched
      ? "导出完成了，但**原稿被动过**（不该发生：备路只在副本上作业）：" +
        JSON.stringify(out.restored)
      : "导出文件读回是空/读不到（bytes=" + out.fileBytes + "）";
  }
  if (!dupDidWork) {
    out.warnings.push("副本上没读到画布/图层的任何变化 —— 第③④步可能是空转，请复核");
  }
  out.ms = Date.now() - t0;
  return out;
}

function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

/** 还原背景色（失败不抛，记进 warnings）。 */
async function safeRestoreBg(out, bgRaw0) {
  if (!bgRaw0 || !bgRaw0.ok || !bgRaw0.raw) {
    out.warnings.push("没记到原来的背景色（读失败）⇒ 没有还原");
    return;
  }
  try {
    const r = await restoreColor("background", bgRaw0.raw);
    out.bgRestore = r;
    out.steps.push("bg restore " + (r.ok ? "ok" : "fail"));
    if (!r.ok) out.warnings.push("背景色还原没成功：" + (r.error || "回读不符"));
  } catch (e) {
    out.steps.push("bg restore THREW");
    out.warnings.push("背景色还原抛异常：" + msg(e));
  }
}

/** 一步退回（失败不抛，记进 warnings —— 但**绝不谎报成功**）。 */
/**
 * 赋回历史状态（**v0.9.2 起 exportReview 已不再使用**：备路全程只读原稿，无需还原）。
 * 保留它是因为「批量前记标记、批量后退回」这条能力本身仍然有用（`lib/history.js`）。
 */
async function safeRevert(out) {
  try {
    const rv = await undoHistory.revert({ via: "state" });
    out.undoRevert = rv;
    out.steps.push("revert " + (rv.ok ? "ok(" + rv.via + ")" : "FAILED:" + (rv.error || "?")));
    if (!rv.ok) {
      out.warnings.push("一步还原没成功：" + (rv.error || "未知") + " ⇒ 请按 Ctrl+Z");
    }
  } catch (e) {
    out.steps.push("revert THREW");
    out.warnings.push("一步还原抛异常：" + msg(e) + " ⇒ 请按 Ctrl+Z");
  }
}

/* --------------------------------------------------------------- 其他 */

/** 当前是否打开了文档（调色板不依赖它，但别的工具要）。 */
/**
 * 打开一个文件成**新文档**（`app.open(entry)`）。
 *
 * 用途：模板库「从模板建稿」—— 打开参考线已经打好的 PSD，用户接着改。
 *
 * ⚠️ 三件必须知道的事：
 *   1. **必须给 Entry，不能给路径字符串** —— 与 `placeFile` 同源的限制（真机实测
 *      `invalid file token used`）。Entry 由 `handoff.fetchIncoming()` 给出。
 *   2. **`app.open` 要包在模态里**（它改文档集合）。S68 已实测：600×400 的 PSD
 *      打开后 **`guides=4` 还在** —— 这正是模板的价值所在。
 *   3. **打开的是 handoff 拷来的副本**（`incoming.psd`），不是模板原件 ⇒ 模板绝不会被改坏；
 *      但用户按 Ctrl+S 会**存回插件缓存目录**。这句话必须由调用方告诉用户（本函数不弹框）。
 *
 * @param {object} entry  UXP Entry（来自 handoff）
 * @param {object} [opts] `{commandName}`
 * @returns {Promise<object>} `{ok, doc, name, width, height, resolution, mode, guides, error}`
 */
async function openFile(entry, opts) {
  const o = opts || {};
  if (!entry) return { ok: false, error: "没有文件句柄（Entry），无法打开" };
  let doc = null;
  let err = "";
  /* 🔴 **打开 PSD 前必须先关掉原生对话框**（S68 验过、我第一次实现时漏了）：
     模板是 CMYK，PS 会弹「配置文件不匹配 / 嵌入配置文件」——那个框在模态里**会卡住**，
     真机表现就是各种看不懂的宿主错误（这次拿到的是
     `The 文档 with an id of undefined does not exist.`）。
     `displayDialogs` 的旧值要还原，别把用户后面的交互也一起静音了。 */
  let prevDialogs = null;
  try {
    prevDialogs = app.displayDialogs;
    app.displayDialogs = "dontDisplay";
  } catch {
    prevDialogs = null;
  }
  try {
    await runModal(async () => {
      doc = await app.open(entry);
    }, o.commandName || "Vellum 工具箱：打开文件");
  } catch (e) {
    /* 打开失败最常见两种：文件不是 PS 能识别的格式 / 文件正在被别的程序占用。
       把原始 message 带回去，别翻译成"打开失败"这种没用的话。 */
    err = (e && e.message) || String(e);
  }
  /* 还原对话框设置（无论成败） */
  if (prevDialogs !== null && prevDialogs !== undefined) {
    try { app.displayDialogs = prevDialogs; } catch { /* 忽略 */ }
  }
  /* ⚠️ 有些版本 `app.open` 会 resolve 出一个"壳"（`id` 都取不到）。
     真机的可靠做法是**问 activeDocument**：打开文件后它就是新的前台文档。 */
  if (!doc || doc.id === undefined || doc.id === null) {
    try {
      const ad = app.activeDocument;
      if (ad && ad.id !== undefined && ad.id !== null) doc = ad;
    } catch {
      /* 取不到就保持原样，下面报错 */
    }
  }
  if (!doc) return { ok: false, error: err || "app.open 没有返回文档" };

  const num = (v) => {
    if (v === null || v === undefined) return null;
    let x = v;
    if (typeof x === "object" && "_value" in x) x = x._value;
    const n = Number(x);
    return isFinite(n) ? n : null;
  };
  let info = { width: null, height: null, resolution: null, mode: "", guides: null };
  try {
    info.width = num(doc.width);
    info.height = num(doc.height);
    info.resolution = num(doc.resolution);
    info.mode = doc.mode ? String(doc.mode) : "";
    /* 参考线条数：模板的核心卖点就是"参考线已经打好了"，所以**读回来说给用户听**。
       ⚠️ `doc.guides` 读不到就当 null（"未探到"），**不写 0** —— 0 是"确认没有参考线"，
          两者差别很大（和契约 §5.7 的 `guides` 字段同一口径）。 */
    if (doc.guides && typeof doc.guides.length === "number") info.guides = doc.guides.length;
  } catch {
    /* 读不到就保持 null */
  }

  return {
    ok: true,
    doc: doc,
    name: (doc && doc.title) || o.name || "",
    width: info.width,
    height: info.height,
    resolution: info.resolution,
    mode: info.mode,
    guides: info.guides,
  };
}

/**
 * 按 `presetJSON` 建稿（「按规范建稿」的执行端）。
 *
 * 🔴 这个函数只负责"把 preset 递进去 + 读回真实结果"，**不做单位换算、不编字段**
 *    （换算在 `lib/specs.js`，字段集是 S68 验通过的那一份）。
 *
 * ⚠️ 三条纪律，全部来自真机踩坑：
 *   1. **字段集不能缺**：C1/C2 漏了 `scale`/`profile`/`artboards` ⇒ presetJSON **整份被静默忽略**，
 *      不报错、建出一张默认稿（读回 1946×172 @72、guides=0）。
 *   2. **`mode` 要读回**：`documents.add({mode})` 曾被静默忽略（S66），`presetJSON` 的
 *      `mode` 到底生不生效**必须以读回为准**，返回 `modeOk` 让调用方判断。
 *   3. **参考线条数要读回**：参考线是这个功能唯一的价值，读回 0 就等于没做成。
 *
 * @param {object} preset `lib/specs.js::toPresetJson()` 的产物
 * @param {object} [opts] `{commandName}`
 * @returns {Promise<object>} `{ok, doc, width, height, resolution, mode, guides, modeOk, error}`
 */
async function createFromSpec(preset, opts) {
  const o = opts || {};
  if (!preset || !preset.width || !preset.height) {
    return { ok: false, error: "preset 缺少 width / height" };
  }
  const json = typeof preset === "string" ? preset : JSON.stringify(preset);

  let doc = null;
  let err = "";
  try {
    await runModal(async () => {
      doc = await app.createDocument({
        presetJSON: json,
        name: o.name || preset.name || "Vellum 新建稿",
      });
    }, o.commandName || "Vellum 工具箱：按规范建稿");
  } catch (e) {
    err = (e && e.message) || String(e);
  }
  if (!doc) return { ok: false, error: err || "createDocument 没有返回文档" };

  const num = (v) => {
    if (v === null || v === undefined) return null;
    let x = v;
    if (typeof x === "object" && "_value" in x) x = x._value;
    const n = Number(x);
    return isFinite(n) ? n : null;
  };
  let width = null;
  let height = null;
  let resolution = null;
  let mode = "";
  let guides = null;
  try {
    width = num(doc.width);
    height = num(doc.height);
    resolution = num(doc.resolution);
    mode = doc.mode ? String(doc.mode) : "";
    if (doc.guides && typeof doc.guides.length === "number") guides = doc.guides.length;
  } catch {
    /* 读不到就保持 null */
  }

  /* 模式是否真的生效：只比"大类"（CMYK / RGB / GRAY / LAB），
     因为读回的是 `CMYKColorMode` 这种常量名，而我们要的是"是不是 CMYK"。 */
  const keyOf = (v) => {
    const t = String(v || "").toUpperCase();
    if (t.indexOf("CMYK") >= 0) return "CMYK";
    if (t.indexOf("RGB") >= 0) return "RGB";
    if (t.indexOf("GRAY") >= 0) return "GRAY";
    if (t.indexOf("LAB") >= 0) return "LAB";
    return t;
  };
  const wantKey = keyOf(preset.mode);
  const modeOk = wantKey ? keyOf(mode) === wantKey : null;

  return {
    ok: true,
    doc: doc,
    name: (doc && doc.title) || o.name || "",
    width: width,
    height: height,
    resolution: resolution,
    mode: mode,
    modeOk: modeOk,
    guides: guides,
  };
}

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
  /* v0.9.12 新增：打开文件（模板库「从模板建稿」） */
  openFile,
  /* v0.9.14 新增：按 presetJSON 建稿（「按规范建稿」） */
  createFromSpec,
  /* v0.2.2 新增 */
  fillLayer,
  fillDescColor,
  fillDescForeground,
  readLayerAvgColor,
  docInfo,
  hasSelection,
  createScratchDoc,
  closeDocument,
  sweepProbeDocs,
  activateDocument,
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
  readSelectionBounds,
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
  /* v0.3.8 追加：文字样式的 AM 路径（DOM 只接了 contents）+ 读回 textKey + 递归计数 */
  textStyleDesc,
  applyTextStyle,
  textLayerSetDesc,
  applyTextLayerDesc,
  paragraphStyleDesc,
  applyParagraphStyle,
  /* v0.4.0 追加：M3 表格生成落地 */
  selectLayerByNameDesc,
  tableCellName,
  buildTable,
  readTextKeyDesc,
  summarizeTextKey,
  countLayersDeep,
  /* v0.5.0 追加：M3b 批量出稿 */
  layerBrief,
  activeLayerBrief,
  groupBriefByName,
  listGroups,
  maxLayerId,
  dupLayerByIdCmd,
  moveByIdCmd,
  exportByRows,
  groupMakeDesc,
  makeGroup,
  duplicateActiveLayer,
  findTextLayerContents,
  sampleRectAvgColor,
  findLayerDeep,
  /* v0.8.0 追加：M5 第 4 步「导出审核版 / 成品图」（docs/50 主路） */
  exportReview,
  readDocGeom,
  entryBytes,
  fileInFolder,
};
