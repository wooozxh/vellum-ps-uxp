#!/usr/bin/env node
/**
 * enable-devtools.mjs —— 启用 / 关闭 UXP 开发者工作流
 * ---------------------------------------------------------------------------
 * 这是 Photoshop 加载「本地开发版 UXP 插件」的总开关，等同于 UXP Developer
 * Tool 首次启动时点的那下 "Enable"。它做的事只有一件：
 *
 *   把 {"developer":true,"hostAppPluginWorkspace":true}
 *   写进 <CommonProgramFiles>\Adobe\UXP\Developer\settings.json
 *
 * 在 Windows 上该目录位于 C:\Program Files\Common Files\Adobe\UXP\Developer，
 * 所以本脚本需要管理员权限。这属于 Adobe 官方设计：目的是防止任意脚本在
 * 用户不知情的情况下往 Photoshop 里塞插件。
 *
 * 用法（在「以管理员身份运行」的终端里执行）：
 *
 *   node tools/enable-devtools.mjs           # 启用
 *   node tools/enable-devtools.mjs --off     # 关闭（恢复原状）
 *   node tools/enable-devtools.mjs --check   # 只查看当前状态，不写入
 *
 * 关闭时若原文件不存在，会把开关置为 false 而不是删除目录，便于随时复启。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const MODE_CHECK = args.includes("--check");
const MODE_OFF = args.includes("--off");

const base =
  process.env.CommonProgramFiles || "C:\\Program Files\\Common Files";
const devDir = path.join(base, "Adobe", "UXP", "Developer");
const settingsFile = path.join(devDir, "settings.json");

const desired = {
  developer: !MODE_OFF,
  hostAppPluginWorkspace: !MODE_OFF,
};

function line() {
  console.log("-".repeat(64));
}

async function readCurrent() {
  try {
    const raw = await fs.readFile(settingsFile, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    return { __parseError: e.message, __raw: String(e) };
  }
}

async function main() {
  line();
  console.log("UXP 开发者工作流开关");
  console.log("目标文件：" + settingsFile);
  line();

  const current = await readCurrent();

  if (current === null) {
    console.log("当前状态：文件不存在 → 开发者工作流【未启用】");
  } else if (current.__parseError) {
    console.log("当前状态：文件存在但解析失败 —— " + current.__parseError);
  } else {
    console.log("当前状态：" + JSON.stringify(current));
  }

  if (MODE_CHECK) {
    line();
    console.log(
      current && current.developer === true
        ? "结论：已启用 ✓"
        : "结论：未启用 ✗ —— 需要以管理员身份运行本脚本（不带 --check）"
    );
    return;
  }

  line();
  try {
    await fs.mkdir(devDir, { recursive: true });
    await fs.writeFile(
      settingsFile,
      JSON.stringify(desired, null, 2) + "\n",
      "utf8"
    );
  } catch (e) {
    console.log("✗ 写入失败：" + e.code + " " + e.message);
    console.log("");
    console.log("这几乎总是因为当前终端没有管理员权限。请这样做：");
    console.log("  1. 按 Win 键，输入 “终端” 或 “PowerShell”");
    console.log("  2. 右键 → “以管理员身份运行”");
    console.log("  3. cd 到本工作区，重新执行本脚本");
    console.log("");
    console.log("也可以手工完成（等价操作）：");
    console.log("  管理员 PowerShell 里粘贴：");
    console.log(
      `  New-Item -ItemType Directory -Force "${devDir}" | Out-Null`
    );
    console.log(
      `  '{"developer":true,"hostAppPluginWorkspace":true}' | Set-Content "${settingsFile}" -Encoding utf8`
    );
    process.exitCode = 1;
    return;
  }

  const back = await readCurrent();
  console.log("写入完成，回读：" + JSON.stringify(back));
  line();
  if (back && back.developer === true) {
    console.log("✓ 开发者工作流已启用。");
    console.log("");
    console.log("下一步：");
    console.log("  1. 打开 Photoshop（保持运行）");
    console.log("  2. 在另一个终端跑：  tools\\uxp.cmd service start");
    console.log("  3. 再开一个终端跑：  tools\\uxp.cmd apps list");
    console.log("     能看到 PS 就说明桥接通了。");
  } else {
    console.log("✗ 回读校验未通过，请检查文件内容。");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("未预期的错误：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
