/*
 * lib/specs.js —— 部门出图规范表（「按规范建稿」的数据源）
 * ===========================================================================
 * 依据：`docs/49 §3.3` 的 `spec.json` 两层结构（`meta` 给插件自己看 / `ps` 原样喂 PS）。
 *
 * 🔴 为什么规范表**放在插件里**，不去读写 PS 的新文档预设目录：
 *   · PS 预设目录要 `fullAccess` 权限、路径带版本号（2025/2026 各一份）、还有竞态；
 *   · 而 `presetJSON` 可以直接**传一份 JSON 建稿**（S68 已实测：参考线随建稿写入、存 PSD 后重开仍在）。
 *   ⇒ 规范由我们自己的数据说了算，PS 只负责执行。
 *
 * 🔴 这张表是**唯一真相**（v1）。将来软件侧下发 `spec.json` 时，
 *    把 `fromSpecJson()` 接上即可，**不要在别处再写第二份尺寸表** ——
 *    两份尺寸表一定会分叉（一边改了另一边不知道），这类"看起来能跑、数值不对"最难查。
 *
 * ⚠️ 单位一律用 **mm** 描述成品尺寸，**画布像素由 `toCanvas()` 算**：
 *    成品 + 两侧出血 = 画布。别在表里直接写像素 —— 那样改 dpi 就要重算全表。
 */

/** 规范默认值（与 docs/49 §3.3 的 meta 对齐）。 */
const BLEED_MM = 3; // 出血：四边各 3mm（部门规范 v3）
const SAFE_MM = 5; // 安全区：距成品边 5mm
const LAYER_STRUCTURE = ["背景", "主视觉", "文案", "装饰", "参考"];

/**
 * 常用规格表。
 * `w` / `h` 是**成品**尺寸（mm）；`dpi` 与 `mode` 决定画布像素与色彩模式。
 * `profile` 跟着 mode 走 —— CMYK 用 Japan Color 2001 Coated（印厂常用），RGB 用 sRGB。
 */
const SPECS = [
  {
    id: "rollup-80x180",
    name: "易拉宝 80×180",
    note: "展架 / 易拉宝",
    w: 800, h: 1800, dpi: 150, mode: "CMYK",
  },
  {
    id: "banner-60x160",
    name: "展架 60×160",
    note: "小型展架",
    w: 600, h: 1600, dpi: 150, mode: "CMYK",
  },
  {
    id: "poster-a3",
    name: "海报 A3",
    note: "297×420mm",
    w: 297, h: 420, dpi: 300, mode: "CMYK",
  },
  {
    id: "poster-a4",
    name: "海报 A4",
    note: "210×297mm",
    w: 210, h: 297, dpi: 300, mode: "CMYK",
  },
  {
    id: "card-90x54",
    name: "名片 90×54",
    note: "含出血后 96×60mm",
    w: 90, h: 54, dpi: 300, mode: "CMYK",
  },
];

/** mm → px（四舍五入到整数像素；PS 的画布坐标就是整数）。 */
function mmToPx(mm, dpi) {
  return Math.round((Number(mm) / 25.4) * Number(dpi));
}

/**
 * 由成品尺寸算出**建稿参数**（画布 px + 参考线坐标）。
 *
 * 成品 800×1800mm、出血 3mm ⇒ 画布 806×1806mm ⇒ @150dpi 是 4760×10666px。
 * 参考线落在**成品边**上（画布内缩 3mm），四条：左右各一条竖线、上下各一条横线。
 *
 * @param {object} spec 规格（`w` / `h` 单位 mm）
 * @param {object} [opts] `{bleedMm, dpi}`
 * @returns {object} `{ok, width, height, guides[], bleedPx, ...}`；参数不合法返回 `{ok:false, error}`
 */
function toCanvas(spec, opts) {
  const o = opts || {};
  if (!spec || !spec.w || !spec.h) return { ok: false, error: "规格缺少 w / h" };
  const dpi = Number(o.dpi || spec.dpi || 150);
  if (!isFinite(dpi) || dpi <= 0) return { ok: false, error: "dpi 不合法：" + dpi };
  const bleedMm = typeof o.bleedMm === "number" ? o.bleedMm : BLEED_MM;

  const width = mmToPx(spec.w + bleedMm * 2, dpi);
  const height = mmToPx(spec.h + bleedMm * 2, dpi);
  if (width < 1 || height < 1) return { ok: false, error: "算出来的画布尺寸不合法：" + width + "×" + height };
  /* PS 的像素上限（300000）与常见内存上限：超了别硬建，直接说清楚 */
  if (width > 300000 || height > 300000) {
    return { ok: false, error: "画布超过 PS 上限（300000px）：" + width + "×" + height };
  }

  const bleedPx = mmToPx(bleedMm, dpi);

  /* 🔴 **参考线坐标是「百分比（0–100）」，不是像素！**
     2026-10-17 用户截图报障：A3 建出来只有 2 条参考线、位置也不对。
     根因就是这里原本写的是**像素**（35 / 3543 / 35 / 4996），PS 却按**百分比**解释
     ⇒ 3543% 和 4996% 落到画布外 ⇒ **只剩左、上两条可见**（`doc.guides.length` 仍是 4，
     所以"数条数"的判据一直是绿的 —— 这是本轮最贵的一个假绿）。

     权威依据：PS 自带预设 `New Doc Sizes.json` 里 HDTV 1080p 的写法是
     `{direction:"h", coordinate:5}, {…10}, {…90}, {…95}` —— 明显是百分比。
     （社区资料也明确："You can specify guides by percentage of width and height."）

     ⇒ 四条 = 左右各 pct、上下各 pct，其中 pct = 出血px ÷ 画布尺寸 × 100。
     A3（303mm 宽 @300dpi）的 3mm 出血 ⇒ 0.990%。 */
  const pctX = (bleedPx / width) * 100;
  const pctY = (bleedPx / height) * 100;
  const r3 = (v) => Math.round(v * 1000) / 1000; // 3 位小数 ⇒ 误差 < 0.02px
  const guides = [
    { direction: "v", coordinate: r3(pctX) },
    { direction: "v", coordinate: r3(100 - pctX) },
    { direction: "h", coordinate: r3(pctY) },
    { direction: "h", coordinate: r3(100 - pctY) },
  ];

  return {
    ok: true,
    width: width,
    height: height,
    dpi: dpi,
    bleedMm: bleedMm,
    bleedPx: bleedPx,
    safeMm: SAFE_MM,
    guides: guides,
    /* 成品尺寸（mm）—— 只用于给用户看，不参与建稿 */
    trimMm: { w: spec.w, h: spec.h },
    mode: spec.mode || "CMYK",
    profile: String(spec.mode || "CMYK").toUpperCase().indexOf("RGB") >= 0
      ? "sRGB IEC61966-2.1"
      : "Japan Color 2001 Coated",
  };
}

/**
 * 组装成 `presetJSON`（字段集**照抄 S68 验通过的那一份**）。
 *
 * 🔴 不许自己编字段集：C1/C2 那次漏了 `scale` / `profile` / `artboards`，
 *    结果 **整份 presetJSON 被静默忽略**（读回 1946×172 @72、guides=0）——
 *    不报错、只是建了个默认稿，这正是本机最危险的一类失败。
 *
 * @param {object} c `toCanvas()` 的返回值
 * @param {object} [spec] 规格（取 name 用）
 * @returns {object} 可直接 `JSON.stringify` 后喂 `createDocument({presetJSON})`
 */
function toPresetJson(c, spec) {
  return {
    name: (spec && spec.name) || "Vellum 新建稿", // 已知被忽略，但验过的那份也带着它
    width: c.width,
    height: c.height,
    units: "pixelsUnit",
    resolution: c.dpi,
    resolutionUnits: "inchesUnit",
    depth: 8,
    scale: 1,
    mode: c.mode,
    fill: "white",
    profile: c.profile,
    guides: c.guides,
    artboards: [],
  };
}

/** 按 id 找规格（找不到返回 null）。 */
function byId(id) {
  for (const s of SPECS) if (s.id === id) return s;
  return null;
}

module.exports = {
  BLEED_MM,
  SAFE_MM,
  LAYER_STRUCTURE,
  SPECS,
  mmToPx,
  toCanvas,
  toPresetJson,
  byId,
};
