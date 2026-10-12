/*
 * lib/inspect.js —— 出图体检 · 只读内核（v0.6.0 新增，方案见 docs/49）
 * ===========================================================================
 * 是什么：把「当前文档到底是个什么稿」读成一份**结构化快照**，再按**规范**判成
 *         若干条 finding。**全程只读 —— 不改一个像素、不建层、不动选区、不进模态。**
 *
 * 为什么单独一个模块：docs/49 §3.0 —— 体检数据**只算一次**，喂三个出口
 *   （常驻状态条 / 导出参数条 / 交付规格单）。三处共用同一份 finding，
 *   才不会出现「状态条说未转曲 3 个、参数条说 2 个」这种自相矛盾。
 *
 * 【本模块的三条纪律】
 *   ① **纯函数与采集分离**。`judge(snap, spec)` 是**纯函数**（离线可测，见
 *      tools/offline-smoke.cjs）；只有 `collect()` 碰 Photoshop。
 *      规则改动因此不必每次上真机。
 *   ② **允许「无结论」**。severity 专门有 `unknown` 一档 —— 判不出来就老实说判不出来。
 *      本项目既有纪律：「诊断项允许'无结论'，但不许把'无结论'写成结论」。
 *   ③ **判"对错"必须带依据**。凡依赖「用途」的判定，都要在 `basis` 里写清按哪套标准判的，
 *      不偷偷判。
 *
 * 【实测来源（docs/49 §二 / template-probe 真机 7 通过 0 失败 1 无结论）】
 *   · doc.mode             → "RGBColorMode" / "CMYKColorMode"（枚举字符串）
 *   · doc.bitsPerChannel   → "bitDepth8"
 *   · doc.colorProfileType → "workingSpaceCode"
 *   · doc.colorProfileName → 普通字符串
 *   · doc.saved            → 布尔
 *   · 文字层字体名          → `layer.textItem.characterStyle.font`（**PostScript 名**）
 *   · 本机字体清单          → `app.fonts` **本身就是集合**（本机 `length=583`）；
 *      ⚠️ **没有 `getFontList()`** —— 探针第一版在这里报过 `not a function`。
 *      每项形态 `{_family,_name,_postScriptName,_style,_parent}`。
 *   · doc.guides           → **可读长度**，但 `guides[i]` 只回 `{_id,_docId}`，
 *      **读不到 direction / coordinate** ⇒ **判不出出血量距边缘多少**（C2 留下的缺口）。
 *
 * ⚠️ 已知精度风险：**「缺字体」靠名字比对**，而 `characterStyle.font` 给的是 PostScript 名，
 *    字体清单里却同时有 family / name / postScriptName 三种写法。
 *    所以这里先按 postScriptName 匹配、再退化到 family/name；**仍可能有误报**。
 *    ⇒ 因此 v1 把「缺字体」定为 `warn`（标红不拦），**不给定 `fatal`**。
 *      等真机跑一段时间、误报率看清了，再决定要不要升级成拦截项。
 */

const photoshop = require("photoshop");
const { app } = photoshop;

function msgOf(e) {
  if (!e) return String(e);
  return e.message || String(e);
}

/** 读一个可能抛异常的值；抛了就返回兜底值。只读，无副作用。 */
function safe(fn, dflt) {
  try {
    const v = fn();
    return v === undefined ? dflt : v;
  } catch (e) {
    return dflt;
  }
}

/* ===========================================================================
 * 一、规范（v1 内置出厂版）
 * ===========================================================================
 * 将来由 spec.json 覆盖（docs/49 §3.3 的两层结构：meta / ps）。
 * ------------------------------------------------------------------------- */

/**
 * ★ 为什么 `usage` 默认是 "print"：
 *   印刷稿错了代价最大（要重印），屏幕稿错了顶多重导。
 *   所以默认按**最严**的一侧审 —— 宁可对屏幕稿误报「未转曲」，不可对印刷稿漏报。
 *   每一处依赖它的判定都会带 `basis` 把"按什么判的"写出来，**不偷偷判**。
 */
const DEFAULT_SPEC = {
  specName: "Vellum 出图规范",
  specVersion: 1,
  effectiveFrom: "2026-10-12",
  usage: "print",              // print | screen | social
  printMode: "CMYKColorMode",
  screenMode: "RGBColorMode",
  minPpiForPrint: 300,
  /**
   * 「元素超出画布」的提醒阈值（毫米）。超过它才升为 warn，否则只当事实报出。
   * 为什么用毫米而不是像素：同一个"超出 60px"在 72dpi 和 300dpi 下含义差 4 倍。
   */
  overflowWarnMm: 5,
  bleedMm: 3,                  // v1 只用于"规范要求是几毫米"，**不参与判定**（坐标读不到）
  fontWhitelist: null          // null = 不查白名单，只查"在不在本机"
};

const USAGE_CN = { print: "印刷", screen: "屏幕", social: "社媒" };

/* ===========================================================================
 * 二、纯函数区（离线可测 —— 改动规则时先在这里加断言，再上真机）
 * =========================================================================== */

/** 像素 → 毫米。ppi 或 px 无效时返回 null（**不猜、不默认 72**）。
 *
 *  ★ 2026-10-12 离线负对照抓到的真 bug：最初写成
 *      `const p = Number(px); if (!isFinite(p)) return null;`
 *    而 **`Number(null) === 0`**（`Number("") === 0` 同理）——
 *    于是"读不到宽度"会被静默换算成 **0 mm**，而不是 null。
 *    0 和 null 在下游是两件事：0 是"就是 0 毫米"，null 是"我不知道"。
 *    所以这里**先显式判空**，再转数字。 */
function pxToMm(px, ppi) {
  if (px === null || px === undefined || px === "") return null;
  if (ppi === null || ppi === undefined || ppi === "") return null;
  const p = Number(px);
  const r = Number(ppi);
  if (!isFinite(p) || !isFinite(r) || r <= 0 || p <= 0) return null;
  return (p / r) * 25.4;
}

/** 字体名归一化：小写 + 去掉空格/连字符/下划线（三种写法才能对上）。 */
function normFont(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[\s\-_]/g, "");
}

/** 数字四舍五入到 1 位小数；null 原样返回。 */
function r1(n) {
  if (n === null || n === undefined || !isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/** severity 排序权（越大越"要紧"）。状态条取 worst 用。 */
const SEV_RANK = { fatal: 4, warn: 3, unknown: 2, ok: 1, info: 0 };

function worstOf(findings) {
  let worst = "ok";
  for (const f of findings || []) {
    if ((SEV_RANK[f.severity] || 0) > (SEV_RANK[worst] || 0)) worst = f.severity;
  }
  return worst;
}

/**
 * 判定：**快照 + 规范 → findings**。纯函数，不碰 PS。
 *
 * severity 词表：
 *   fatal   必须拦（v1 暂无 —— 唯一候选"缺字体"因误报风险先降为 warn）
 *   warn    标红但不拦
 *   unknown **判不出来**（不是"没问题"，也不是"有问题"）
 *   ok      合格
 *   info    纯事实，无对错
 */
function judge(snap, spec) {
  const s = Object.assign({}, DEFAULT_SPEC, spec || {});
  const out = [];
  const F = function (key, label, value, severity, note, basis) {
    out.push({
      key: key, label: label, value: value, severity: severity,
      note: note || "", basis: basis || ""
    });
  };

  const info = (snap && snap.info) || {};
  const layers = (snap && snap.layers) || { textCount: 0, hidden: 0, fonts: [] };
  const isPrint = s.usage === "print";
  const usageBasis =
    "按「" + (USAGE_CN[s.usage] || s.usage) + "」标准 · " + s.specName + " v" + s.specVersion;
  const mmW = pxToMm(info.pxW, info.ppi);
  const mmH = pxToMm(info.pxH, info.ppi);
  const phys = mmW !== null && mmH !== null ? r1(mmW) + " × " + r1(mmH) + " mm" : "无法换算";

  /* ① 文档身份（纯事实） */
  F("doc", "文档", info.docName || "未命名", "info",
    info.saved === false ? "有未保存的改动" : "已保存");

  /* ② 色彩模式 —— 按用途判 */
  const expectMode = isPrint ? s.printMode : s.screenMode;
  F("mode", "色彩模式",
    info.mode || "读不到",
    !info.mode ? "unknown" : (info.mode === expectMode ? "ok" : "warn"),
    !info.mode ? "读不到文档色彩模式"
      : (info.mode === expectMode ? "" : "期望 " + expectMode),
    usageBasis);

  /* ③ 分辨率 —— 只有印刷侧有下限（屏幕稿 72dpi 是正常的，不能无条件报警） */
  if (!isPrint) {
    F("ppi", "分辨率", info.ppi ? info.ppi + " dpi" : "读不到", "info",
      "屏幕/社媒稿不设分辨率下限", usageBasis);
  } else if (!info.ppi) {
    F("ppi", "分辨率", "读不到", "unknown", "读不到文档分辨率", usageBasis);
  } else {
    F("ppi", "分辨率", info.ppi + " dpi",
      info.ppi >= s.minPpiForPrint ? "ok" : "warn",
      info.ppi >= s.minPpiForPrint ? "" : "低于 " + s.minPpiForPrint + " dpi",
      usageBasis);
  }

  /* ④ 像素尺寸（纯事实） */
  F("px", "像素尺寸",
    info.pxW !== null && info.pxH !== null ? r1(info.pxW) + " × " + r1(info.pxH) + " px" : "读不到",
    "info");

  /* ⑤ 物理尺寸（纯事实；ppi 无效时是 unknown，不是 0） */
  F("phys", "物理尺寸", phys,
    mmW !== null ? "info" : "unknown",
    mmW !== null ? "" : "分辨率读不到，无法换算物理尺寸");

  /* ⑥ 位深（纯事实） */
  F("bits", "位深", info.bits || "读不到", "info");

  /* ⑦ 颜色配置文件（纯事实） */
  F("profile", "颜色配置文件", info.profileName || "无", "info", info.profileType || "");

  /* ⑧ 未转曲文字层 —— 按用途判（印刷前要转曲；屏幕稿不用） */
  const tc = layers.textCount || 0;
  if (tc === 0) {
    F("text", "文字图层", "0 个", "ok", "没有未转曲文字层", usageBasis);
  } else if (isPrint) {
    F("text", "文字图层", tc + " 个未转曲", "warn",
      "印刷前通常要转曲（或随稿提供字体）", usageBasis);
  } else {
    F("text", "文字图层", tc + " 个（可编辑）", "info",
      "屏幕/社媒稿不需要转曲", usageBasis);
  }

  /* ⑨ 缺失字体 —— 唯一"不管什么用途都是问题"的一项，但 v1 只 warn（见文件头） */
  const psSet = {};
  const looseSet = {};
  const fn = (snap && snap.fontNames) || { ps: [], loose: [] };
  for (const n of fn.ps || []) psSet[n] = 1;
  for (const n of fn.loose || []) looseSet[n] = 1;

  const missing = [];
  const used = layers.fonts || [];
  if (!fn.count) {
    F("font", "字体", "读不到本机字体清单", "unknown",
      "缺少本机字体清单，无法判断字体是否缺失");
  } else if (!used.length) {
    F("font", "字体", "本稿没有文字层", "info", "无字体可查");
  } else {
    for (const u of used) {
      const k = normFont(u.font);
      if (!k) continue;
      if (psSet[k] || looseSet[k]) continue;
      if (missing.indexOf(u.font) < 0) missing.push(u.font);
    }
    if (missing.length) {
      F("font", "字体", missing.length + " 个字体本机没有", "warn",
        "缺失：" + missing.join("、") +
        "（按名字比对，可能有误报 —— 请人工确认一次）");
    } else {
      F("font", "字体", used.length + " 处文字层字体都在本机", "ok");
    }
  }

  /* ⑩ 隐藏图层（纯事实；v1 不判对错，因为隐藏层常常是刻意的） */
  F("hidden", "隐藏图层", (layers.hidden || 0) + " 个", "info");

  /* ⑪ 元素超出画布 —— ⚠️ **这是"文字溢出检测"的降级替代，不是它本身**：
     它只知道"某图层的实际范围超出了画布"，**分不清**是刻意的出血 / 阴影 / 裁切，还是真的溢出。
     真要判"文字超出文本框"，得能建段落文字并读到文本框 bounds ——
     探针 C7 已证 UXP DOM 建不出段落文字，所以那条路暂时走不通（docs/49 §四）。
     因此这里只报事实 + 一个宽松阈值，并在 note 里**明确说自己不精确**。 */
  const oc = layers.overflowCount || 0;
  const oMax = layers.overflowMaxPx || 0;
  const scanned = (layers.total || 0) <= BOUNDS_SCAN_LIMIT;
  const ppiOK = info.ppi !== null && isFinite(info.ppi) && info.ppi > 0;
  const warnPx = ppiOK ? (s.overflowWarnMm / 25.4) * info.ppi : s.overflowWarnMm * 4;
  const scanNote = scanned ? "" : "（图层数超过 " + BOUNDS_SCAN_LIMIT + "，未全量扫描 bounds）";
  if (!info.pxW || !info.pxH) {
    F("overflow", "元素超出画布", "无法判断", "unknown", "画布尺寸读不到");
  } else if (oc === 0) {
    F("overflow", "元素超出画布", "0 个", "ok", scanNote);
  } else {
    F(
      "overflow",
      "元素超出画布",
      oc + " 个图层超出，最大 " + Math.round(oMax) + " px" +
        (layers.overflowWorst ? "（" + layers.overflowWorst + "）" : ""),
      oMax > warnPx ? "warn" : "info",
      "⚠️ 启发式、不是精确检测：可能是刻意的出血 / 阴影 / 裁切，也可能是元素真的溢出。" +
        "超过 " + s.overflowWarnMm + " mm（≈" + Math.round(warnPx) + " px）才升级为提醒。" + scanNote
    );
  }

  /* ⑪ 出血 —— 探测已知的最大缺口：**坐标读不到**，所以只出三态、不出毫米数 */
  const gc = snap ? snap.guideCount : null;
  if (gc === null || gc === undefined) {
    F("bleed", "出血", "无法判断", "unknown", "读不到参考线");
  } else if (gc === 0) {
    F("bleed", "出血", "无法判断", "unknown",
      "没有参考线标记；本版读不到参考线坐标，判不出出血量（规范要求 " + s.bleedMm + " mm）");
  } else {
    F("bleed", "出血", "疑似有（" + gc + " 条参考线）", "unknown",
      "读到参考线但**读不到它的坐标**，无法确认是否是出血线、也判不出距边缘多少（规范要求 " +
      s.bleedMm + " mm）");
  }

  return out;
}

/* ===========================================================================
 * 三、采集区（唯一碰 Photoshop 的部分，仍然**只读**）
 * =========================================================================== */

/** 图层的 bounds 归一化：UXP 真机给的是 `{_left,_top,_right,_bottom}`（探针实测）。
 *
 *  ⚠️ 与 `pxToMm` 同族的坑：**先显式判空再转数字**。
 *     `Number(null) === 0` —— 直接 `Number(b["_left"])` 会把"读不到"变成 0 坐标，
 *     于是"缺字段"被当成"左上角在原点"，溢出统计就悄悄错了。
 *     （这条是离线断言 M5-11 抓出来的，与 M5-1 是同一类错误。） */
function normBounds(b) {
  if (!b) return null;
  const pick = (a, c) => {
    let v = b[a] !== undefined ? b[a] : b[c];
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "object" && "_value" in v) v = v._value;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };
  const l = pick("_left", "left");
  const t = pick("_top", "top");
  const r = pick("_right", "right");
  const bo = pick("_bottom", "bottom");
  if (l === null || t === null || r === null || bo === null) return null;
  return { left: l, top: t, right: r, bottom: bo };
}

/** 该图层超出画布的最大像素数（四边取最大）；不超出返回 0。 */
function overflowPx(bd, cw, ch) {
  if (!bd || !cw || !ch) return 0;
  return Math.max(0, -bd.left, -bd.top, bd.right - cw, bd.bottom - ch);
}

/** 单次体检最多扫多少个图层的 bounds（防大稿把面板拖慢）。 */
const BOUNDS_SCAN_LIMIT = 400;

/** 递归遍历图层树：数总数/文字层/隐藏层/组，收文字层字体名，并统计"超出画布"。 */
function walkLayers(list, acc, depth, canvas) {
  if (!list || depth > 8) return;
  let n = 0;
  try {
    n = list.length;
  } catch (e) {
    return;
  }
  if (typeof n !== "number") return;

  for (let i = 0; i < n; i++) {
    let L = null;
    try {
      L = list[i];
    } catch (e) {
      continue;
    }
    if (!L) continue;

    acc.total++;
    const kind = safe(function () { return L.kind; }, null);
    const visible = safe(function () { return L.visible; }, null);
    const nm = safe(function () { return L.name; }, "");
    if (visible === false) acc.hidden++;

    /* 超出画布统计（只读）。⚠️ 这是**启发式**，不是"文字溢出检测" ——
       它只知道"这个图层的实际范围超出了画布"，分不清是刻意的出血/阴影还是真的溢出。
       真要判"文字超出文本框"，得能建段落文字并读到文本框 bounds —— 探针 C7 已证 DOM 做不到。 */
    if (canvas && canvas.w && canvas.h && acc.total <= BOUNDS_SCAN_LIMIT) {
      const bd = normBounds(safe(function () { return L.bounds; }, null));
      const ov = overflowPx(bd, canvas.w, canvas.h);
      if (ov > 0) {
        acc.overflowCount++;
        if (ov > acc.overflowMaxPx) {
          acc.overflowMaxPx = ov;
          acc.overflowWorst = nm || "?";
        }
      }
    }

    if (kind === "group") {
      acc.groups++;
      walkLayers(safe(function () { return L.layers; }, null), acc, depth + 1, canvas);
    } else if (kind === "text") {
      acc.textCount++;
      // ★ 字体名走 DOM 的 characterStyle.font —— 探针 C6 实测这条路可读
      const f = safe(function () {
        return L.textItem && L.textItem.characterStyle ? L.textItem.characterStyle.font : null;
      }, null);
      if (f) acc.fonts.push({ layer: nm, font: f });
    }
  }
}

/**
 * 读本机字体清单，拍平成两个"可命中的名字数组"。
 * ⚠️ `app.fonts` **本身就是集合**（不是带 getFontList() 的对象）。
 *
 * ★ 为什么要缓存：状态条会以秒级节奏重算体检，而这里要读 583 条 × 3 个字段
 *   （≈1700 次属性访问）。本机字体在一次 Photoshop 会话里基本不变，
 *   所以缓存下来，只在显式 `fresh` 时重读。
 */
let _fontCache = null;

function readFontNames(force) {
  if (_fontCache && !force) return _fontCache;

  const ps = [];
  const loose = [];
  const fonts = safe(function () { return app.fonts; }, null);
  if (!fonts) return { ps: ps, loose: loose, count: 0, error: "读不到 app.fonts" };

  const n = safe(function () { return fonts.length; }, null);
  if (typeof n !== "number") {
    return { ps: ps, loose: loose, count: 0, error: "app.fonts 没有 length（不是集合形态）" };
  }
  for (let i = 0; i < n; i++) {
    const it = safe(function () { return fonts[i]; }, null);
    if (!it) continue;
    const pick = function (k) {
      const v = safe(function () { return it[k]; }, null);
      return typeof v === "string" ? v : null;
    };
    const a = pick("_postScriptName");
    if (a) ps.push(normFont(a));
    const b = pick("_name");
    if (b) loose.push(normFont(b));
    const c = pick("_family");
    if (c) loose.push(normFont(c));
  }
  _fontCache = { ps: ps, loose: loose, count: n };
  return _fontCache;
}

/**
 * 采集当前活动文档的只读快照。**不改任何东西、不进模态。**
 * 拿不到就返回 `{ error }`，不抛。
 */
function collect(opts) {
  const o = opts || {};
  try {
    if (!app.documents || !app.documents.length) return { error: "没有打开的文档" };
    const d = app.activeDocument;
    if (!d) return { error: "没有活动文档" };

    const num = function (v) {
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && "_value" in v) v = v._value;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };

    const info = {
      docId: safe(function () { return d.id; }, null),
      docName: safe(function () { return d.name; }, ""),
      saved: safe(function () { return d.saved; }, null),
      mode: safe(function () { return d.mode; }, null),
      bits: safe(function () { return d.bitsPerChannel; }, null),
      profileName: safe(function () { return d.colorProfileName; }, null),
      profileType: safe(function () { return d.colorProfileType; }, null),
      pxW: num(safe(function () { return d.width; }, null)),
      pxH: num(safe(function () { return d.height; }, null)),
      ppi: num(safe(function () { return d.resolution; }, null))
    };

    const layers = {
      total: 0, textCount: 0, hidden: 0, groups: 0, fonts: [],
      overflowCount: 0, overflowMaxPx: 0, overflowWorst: ""
    };
    walkLayers(
      safe(function () { return d.layers; }, null),
      layers,
      0,
      { w: info.pxW, h: info.pxH }
    );

    const g = safe(function () { return d.guides; }, null);
    let guideCount = null;
    if (g) {
      const gn = safe(function () { return g.length; }, null);
      if (typeof gn === "number") guideCount = gn;
    }

    const fontNames = readFontNames(o.fresh);

    return { info: info, layers: layers, guideCount: guideCount, fontNames: fontNames };
  } catch (e) {
    return { error: msgOf(e) };
  }
}

/* ===========================================================================
 * 四、对外：docInspect()
 * =========================================================================== */

/**
 * 体检入口。**只读**。
 * @param {object} [opts] `{ spec, fresh }` —— `spec` 覆盖内置规范；`fresh:true` 强制重读字体清单
 * @returns {{ok:boolean, spec:object, snapshot:object, findings:Array, worst:string, error?:string}}
 */
function docInspect(opts) {
  const o = opts || {};
  const spec = Object.assign({}, DEFAULT_SPEC, o.spec || {});
  const snap = collect(o);
  if (snap.error) return { ok: false, error: snap.error, spec: spec };
  const findings = judge(snap, spec);
  return {
    ok: true,
    spec: spec,
    snapshot: snap,
    findings: findings,
    worst: worstOf(findings)
  };
}

/** 给状态条用的单行摘要。 */
function summaryLine(insp) {
  if (!insp || !insp.ok) return "体检不可用：无文档";
  const g = function (k) {
    for (const f of insp.findings) if (f.key === k) return f.value;
    return "?";
  };
  return (
    g("mode") + " · " + g("ppi") + " · " + g("px") +
    " · " + g("phys") + " · 出血 " + g("bleed")
  );
}

/** 状态条 chip 用的紧凑文本 + 该配什么色。 */
function chipText(insp) {
  if (!insp || !insp.ok) {
    return { text: "体检：没有打开的文档", sev: "unknown", title: "点开可看详情" };
  }
  const g = function (k) {
    for (const f of insp.findings) if (f.key === k) return f;
    return null;
  };
  const mode = g("mode");
  const ppi = g("ppi");
  const px = g("px");
  const warnN = insp.findings.filter(function (f) { return f.severity === "warn"; }).length;
  const fatalN = insp.findings.filter(function (f) { return f.severity === "fatal"; }).length;

  const head = (mode ? mode.value : "?") + " · " + (ppi ? ppi.value : "?") + " · " + (px ? px.value : "?");
  let tail = "";
  if (fatalN) tail = "　⛔ " + fatalN + " 项必须处理";
  else if (warnN) tail = "　⚠ " + warnN + " 项提醒";

  return {
    text: "体检：" + head + tail,
    sev: insp.worst,
    title: "点击查看出图体检详情（依据 " + insp.spec.specName + " v" + insp.spec.specVersion + "）"
  };
}

module.exports = {
  docInspect: docInspect,
  summaryLine: summaryLine,
  chipText: chipText,
  judge: judge,
  pxToMm: pxToMm,
  normFont: normFont,
  normBounds: normBounds,
  overflowPx: overflowPx,
  worstOf: worstOf,
  walkLayers: walkLayers,
  DEFAULT_SPEC: DEFAULT_SPEC,
  USAGE_CN: USAGE_CN,
  SEV_RANK: SEV_RANK,
  BOUNDS_SCAN_LIMIT: BOUNDS_SCAN_LIMIT
};
