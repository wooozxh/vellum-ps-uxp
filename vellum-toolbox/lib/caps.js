/*
 * lib/caps.js —— 能力探测 + 降级（横切约束）
 * ===========================================================================
 * 来源：docs/12-多版本兼容性策略.md。共识是「**以机制换兼容**」——
 *   首版保守用老 API，且**任何有版本门槛的能力都不裸调**：先探测，能降级就降级。
 *
 * 为什么需要它：本项目已经中过一次「装上了但跑错」的**静默错误**
 * （docs/04：PS 2026 下 batchPlay 建不出文本图层，名字却对，自检假阳性）。
 * 静默错误比「装不上」危险得多 —— 所以判定必须是「名字 + 类型」双条件，
 * 宁可报错，不可假装成功。
 *
 * M1 用它做两件事：
 *   ① 报出运行环境（PS / UXP / 平台 / PS 大版本号），写进 boot.log 与面板
 *   ② 探测「读/设前景背景色」在本机是否可用（面板据此决定是否置灰）
 */

const photoshop = require("photoshop");
const ps = require("./ps.js");
const log = require("./log.js");

/** 缓存，避免每次 mount 都重探。 */
let state = null;

function uxpVersion() {
  try {
    const uxp = require("uxp");
    return (uxp.versions && uxp.versions.uxp) || "未暴露";
  } catch {
    return "?";
  }
}

function pluginRuntime() {
  try {
    const uxp = require("uxp");
    return (uxp.versions && uxp.versions.plugin) || "未暴露";
  } catch {
    return "?";
  }
}

function hostName() {
  try {
    return (require("uxp").host && require("uxp").host.name) || "?";
  } catch {
    return "?";
  }
}

/**
 * 宿主（Photoshop）版本。
 * ⚠️ docs/04 记载：PS 2026 下 DOM 侧 app.version 读不到。
 * 所以优先用 uxp.host.version，DOM 侧只作为兜底。
 */
function hostVersion() {
  try {
    const v = require("uxp").host && require("uxp").host.version;
    if (typeof v === "string" && v) return v;
  } catch {
    /* 落到兜底 */
  }
  try {
    const v = photoshop.app.version;
    if (typeof v === "string" && v) return v;
  } catch {
    /* 读不到 */
  }
  return "未暴露";
}

function platform() {
  try {
    return navigator.platform || "?";
  } catch {
    return "?";
  }
}

/**
 * 从 PluginData 路径里检出 PS 大版本号（PHSP\27\）。
 * 联动契约 §7.1 关心的就是这个数 —— 它决定镜像写到哪个目录。
 * @returns {Promise<string|null>}
 */
async function psMajorFromSandbox() {
  try {
    const p = await require("./data.js").dataFolderPath();
    const m = /[\\/]PHSP[\\/](\d+)[\\/]/i.exec(String(p));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * 探测「读色」能力（不改任何状态，随时可调）。
 * @returns {Promise<{ok:boolean, foreground:object, background:object}>}
 */
async function probeRead() {
  const fg = await ps.readColor("foreground");
  const bg = await ps.readColor("background");
  return { ok: fg.ok && bg.ok, foreground: fg, background: bg };
}

/**
 * 探测「设色」能力。
 * ⚠️ 会**临时改变**用户的前景/背景色 —— 因此只在能读到原值（=可恢复）时才执行，
 *    测完立刻恢复并回读校验。读不到原值就直接跳过，绝不让用户颜色被改坏。
 *
 * @param {(line:string)=>Promise<any>} [logger] 可选：把过程写进 boot.log
 */
async function probeWrite(logger) {
  const say = logger || (async () => {});
  const before = await probeRead();
  if (!before.ok) {
    return {
      ok: false,
      skipped: true,
      reason: "读不到前景/背景色原值，无法安全恢复 → 跳过设色探测（不污染用户颜色）",
    };
  }

  // 测试色故意选「几乎不可能与当前色重合」的值，配合 setColor 里的 changed 判据
  const fgTest = { r: 17, g: 137, b: 211 };
  const bgTest = { r: 211, g: 17, b: 137 };

  const fgRes = await ps.setColor("foreground", fgTest);
  await say("probe  设前景色  ok=" + fgRes.ok + "  hex=" + fgRes.hex + "  回读=" + fgRes.readbackHex);

  const bgRes = await ps.setColor("background", bgTest);
  await say("probe  设背景色  ok=" + bgRes.ok + "  hex=" + bgRes.hex + "  回读=" + bgRes.readbackHex);

  const fgBack = await ps.restoreColor("foreground", before.foreground.raw);
  const bgBack = await ps.restoreColor("background", before.background.raw);
  await say(
    "probe  恢复原色  fg=" + (fgBack.ok ? "ok:" + ps.rgbToHex(fgBack.readback) : "FAILED:" + fgBack.error) +
    "  bg=" + (bgBack.ok ? "ok:" + ps.rgbToHex(bgBack.readback) : "FAILED:" + bgBack.error)
  );

  return {
    ok: fgRes.ok && bgRes.ok && fgBack.ok && bgBack.ok,
    skipped: false,
    foreground: fgRes,
    background: bgRes,
    restored: { foreground: fgBack.ok, background: bgBack.ok },
  };
}

/** 读环境（带缓存）。 */
async function env() {
  const major = await psMajorFromSandbox();
  return {
    plugin: "com.vellum.toolbox",
    pluginVersion: "0.1.0",
    host: hostName(),
    hostVersion: hostVersion(),
    uxp: uxpVersion(),
    pluginRuntime: pluginRuntime(),
    platform: platform(),
    psMajor: major,
    locale: (() => {
      try {
        return require("uxp").host.uiLocale || "?";
      } catch {
        return "?";
      }
    })(),
  };
}

/**
 * 完整体检状态（带缓存）。首次调用会探测读/设色能力。
 * @param {{probeWrite?:boolean, logger?:Function}} [opts]
 */
async function detect(opts) {
  const o = opts || {};
  if (state && !o.force) return state;

  const e = await env();
  const rd = await probeRead();
  let wr = { ok: false, skipped: true, reason: "未探测" };
  if (o.probeWrite) {
    wr = await probeWrite(o.logger);
  }

  state = {
    env: e,
    canReadColor: rd.ok,
    canWriteColor: o.probeWrite ? !!wr.ok : null,
    readDetail: rd,
    writeDetail: wr,
  };

  await log.appendLog(
    "caps   host=" + e.host + "/" + e.hostVersion + "  uxp=" + e.uxp +
    "  psMajor=" + (e.psMajor || "?") + "  读色=" + (rd.ok ? "OK" : "FAIL")
  );
  return state;
}

function cached() {
  return state;
}

module.exports = { env, detect, cached, probeRead, probeWrite, psMajorFromSandbox };
