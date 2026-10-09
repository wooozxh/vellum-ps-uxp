#!/usr/bin/env node
/*
 * doctor.mjs — Photoshop UXP 开发环境自检（vibecoding 版）
 * ---------------------------------------------------------------------------
 * 用法：node tools/doctor.mjs
 *
 * 与上一版的区别：上一版按「人类开发者」检查（要不要装 CC、要不要装 UDT GUI）。
 * 这一版按「AI 代写代码、需要自动化反馈闭环」来检查：
 *   - 关键不是有没有可视化工具，而是「能不能由脚本 load / reload 插件、
 *     能不能把插件运行结果读回来」。
 *   - 满足这两点的最小集合是：Photoshop + 开发者工作流开关 + UXP CLI + 报告通道。
 *
 * 只读检测，不改动任何文件或设置。
 */

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

const results = [];
function record(name, ok, detail, hint) {
  results.push({ name, ok, detail, hint });
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
function listDirs(p) {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
function firstExisting(paths) {
  return paths.find((p) => exists(p)) || null;
}
function resolveOnPath(names) {
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    const hasExt = /\.[a-z0-9]+$/i.test(name);
    for (const dir of dirs) {
      if (hasExt) {
        const p = path.join(dir, name);
        if (exists(p)) return p;
        continue;
      }
      for (const ext of exts) {
        const p = path.join(dir, name + ext.toLowerCase());
        if (exists(p)) return p;
      }
    }
  }
  return null;
}
/** 只有 .exe 能直接 spawn（.cmd/.bat 需要 shell，受限环境下不可用） */
function versionOf(exePath, args = ["--version"]) {
  if (!exePath || !/\.exe$/i.test(exePath)) return null;
  try {
    return execFileSync(exePath, args, {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true
    })
      .trim()
      .split("\n")[0];
  } catch {
    return null;
  }
}
function portOpen(port, host = "127.0.0.1", timeout = 700) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}
function psRunning() {
  const tl = resolveOnPath(["tasklist.exe"]);
  if (!tl) return null;
  try {
    const out = execFileSync(
      tl,
      ["/FI", "IMAGENAME eq Photoshop.exe", "/NH"],
      { encoding: "utf8", timeout: 8000, windowsHide: true }
    );
    return /photoshop\.exe/i.test(out);
  } catch {
    return null;
  }
}

/* ===================================================== 1. 宿主 Photoshop */

const psRoots = [
  "D:\\software\\adobe",
  "C:\\Program Files\\Adobe",
  "C:\\Program Files (x86)\\Adobe",
  "D:\\Program Files\\Adobe"
];
let psPath = null;
for (const root of psRoots) {
  for (const d of listDirs(root)) {
    if (/photoshop/i.test(d)) {
      const c = path.join(root, d, "Photoshop.exe");
      if (exists(c)) psPath = c;
    }
  }
}
if (psPath) {
  const ver = path.basename(path.dirname(psPath));
  const uxpRuntime = path.join(path.dirname(psPath), "Required", "UXP");
  record("Photoshop 宿主", true, ver + "\n         " + psPath);
  record(
    "PS 内置 UXP 运行时",
    exists(uxpRuntime),
    exists(uxpRuntime) ? "存在（Required\\UXP）" : "未找到"
  );
} else {
  record("Photoshop 宿主", false, "未找到 Photoshop.exe", "先装 Photoshop（≥ 22.0）");
}

/* ============================================ 2. 开发者工作流开关（关键闸门） */

const devDir = path.join(
  process.env.CommonProgramFiles || "C:\\Program Files\\Common Files",
  "Adobe",
  "UXP",
  "Developer"
);
const devSettings = path.join(devDir, "settings.json");
let devMode = false;
let devRaw = null;
if (exists(devSettings)) {
  try {
    devRaw = fs.readFileSync(devSettings, "utf8").trim();
    devMode = JSON.parse(devRaw).developer === true;
  } catch {
    devMode = false;
  }
}
record(
  "开发者工作流开关 ★关键闸门",
  devMode,
  devMode ? devSettings + "\n         " + devRaw : "未启用（" + devSettings + " 不存在或 developer != true）",
  "以【管理员身份】运行： node tools/enable-devtools.mjs"
);

/* ======================================================= 3. UXP CLI 与桥接 */

const cliEntry = path.join(
  ROOT,
  "node_modules",
  "@adobe-fixed-uxp",
  "uxp-devtools-cli",
  "dist",
  "uxp.js"
);
record(
  "UXP Developer CLI ★自动化入口",
  exists(cliEntry),
  exists(cliEntry)
    ? "已安装\n         " + path.relative(ROOT, cliEntry)
    : "未安装",
  "在工作区根目录执行： npm install @adobe-fixed-uxp/uxp-devtools-cli"
);

const helperBin = path.join(
  ROOT,
  "node_modules",
  "@adobe-fixed-uxp",
  "uxp-devtools-helper",
  "build",
  "Release",
  "node-napi.node"
);
record(
  "devtools 原生桥接（Vulcan/AID）",
  exists(helperBin),
  exists(helperBin)
    ? "已随 CLI 安装（含 AID.dll / VulcanControl.dll）"
    : "未找到",
  "重装 @adobe-fixed-uxp/uxp-devtools-cli"
);

/* ================================================= 4. 服务与 Photoshop 状态 */

const port = Number(process.env.UXP_CLI_PORT || 14001);
const listening = await portOpen(port);
record(
  "开发者服务（端口 " + port + "）",
  listening,
  listening
    ? "正在监听 —— 可执行 plugin load / watch / logs"
    : "未运行（正常：需要时再启动）",
  "运行： tools\\uxp.cmd service start"
);

const ps = psRunning();
record(
  "Photoshop 当前运行",
  ps === true,
  ps === null
    ? "无法探测（tasklist 不可用）"
    : ps
      ? "正在运行"
      : "未运行 —— 加载插件前必须先打开 PS",
  "手动打开 Photoshop"
);

/* ==================================================== 5. 报告通道 */
{
  const storageRoot = path.join(
    process.env.APPDATA || "",
    "Adobe",
    "UXP",
    "PluginsStorage",
    "PHSP"
  );
  const versions = listDirs(storageRoot);
  let newestReport = null;
  const stack = [storageRoot];
  let depthGuard = 0;
  while (stack.length && depthGuard++ < 500) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.toLowerCase() === "report.json") {
        try {
          const st = fs.statSync(full);
          if (!newestReport || st.mtimeMs > newestReport.mtimeMs)
            newestReport = { file: full, mtimeMs: st.mtimeMs };
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  record(
    "插件存储 PHSP",
    versions.length > 0,
    versions.length
      ? "已存在 PS 版本目录：" + versions.join(", ")
      : "尚未生成（首次加载插件后出现）"
  );
  record(
    "自检报告通道 ★反馈回路",
    Boolean(newestReport),
    newestReport
      ? "最近报告：" +
          new Date(newestReport.mtimeMs).toLocaleString() +
          "\n         " +
          newestReport.file
      : "还没有 report.json（插件尚未成功跑过一次）",
    "用 tools\\uxp.cmd 加载 hello-uxp 后运行： node tools/report.mjs"
  );
}

/* ============================================================ 6. 工具链 */

const node = process.version;
const major = Number(node.replace("v", "").split(".")[0]);
record(
  "Node.js",
  major >= 18,
  node + (major % 2 === 0 ? "（偶数版 ✓）" : "（建议用 LTS 偶数版）")
);

const npmPath = resolveOnPath(["npm.cmd", "npm"]);
record(
  "npm",
  Boolean(npmPath),
  npmPath ? (versionOf(npmPath) || "已安装") + "  " + npmPath : "未找到"
);

const gitPath = resolveOnPath(["git.exe", "git"]);
record(
  "git",
  Boolean(gitPath),
  gitPath
    ? (versionOf(gitPath) || "已安装") + "  " + gitPath
    : "未找到（克隆官方示例需要）"
);

const pythonPath = resolveOnPath(["python.exe", "python3", "python"]);
record(
  "Python",
  Boolean(pythonPath),
  pythonPath
    ? (versionOf(pythonPath) || "已安装") + "  " + pythonPath
    : "未找到（仅 MCP 桥需要，可后补）"
);

const codePath =
  resolveOnPath(["code.cmd", "code.exe", "code"]) ||
  firstExisting([
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe")
  ]);
record(
  "VS Code",
  Boolean(codePath),
  codePath ? (versionOf(codePath) || "已安装") + "  " + codePath : "未找到（可选，方便你自己看代码）"
);

const cc = firstExisting([
  "C:\\Program Files\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Adobe Creative Cloud", "Creative Cloud.exe")
]);
record(
  "Creative Cloud 桌面端（可选）",
  Boolean(cc),
  cc
    ? cc
    : "未安装 —— 不再是必需项；仅当想用 UDT 图形界面时再装"
);

/* =============================================================== 输出 */

const REQUIRED = [
  "Photoshop 宿主",
  "开发者工作流开关 ★关键闸门",
  "UXP Developer CLI ★自动化入口",
  "devtools 原生桥接（Vulcan/AID）",
  "自检报告通道 ★反馈回路"
];

const okCount = results.filter((r) => r.ok).length;
const gateOpen = results.filter(
  (r) => REQUIRED.includes(r.name) && r.ok
).length;

console.log("");
console.log("  Photoshop UXP 开发环境自检（vibecoding 版）");
console.log("  " + "=".repeat(62));
console.log("");

for (const r of results) {
  console.log("  " + (r.ok ? "[ ✓ ]" : "[ ✗ ]") + " " + r.name);
  console.log("         " + r.detail);
  if (!r.ok && r.hint) console.log("         → " + r.hint);
  console.log("");
}

console.log("  " + "-".repeat(62));
console.log(
  "  通过 " + okCount + " / " + results.length + "    闭环关键项 " + gateOpen + " / " + REQUIRED.length
);
if (gateOpen === REQUIRED.length) {
  console.log("  闭环已就绪：可以由脚本完成「改代码 → 重载 → 读结果」。");
} else {
  console.log("  闭环尚未打通，按上面 → 的提示补齐。");
  console.log("  提示：缺的通常只有一项 —— 那个需要管理员权限的开发者开关。");
}
console.log("");
