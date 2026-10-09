#!/usr/bin/env node
/**
 * report.mjs —— 读取插件自己写出来的自检报告
 * ---------------------------------------------------------------------------
 * 为什么需要它：UXP 插件跑在 Photoshop 进程里，它的 console.log 只会出现在
 * UDT 的调试窗口里，脚本拿不到。所以「能被我读到的反馈」必须落到磁盘上。
 *
 * 约定：插件用 uxp.storage.localFileSystem.getDataFolder() 拿到自己的数据目录，
 * 在里面写一个 report.json。本脚本去 PluginsStorage 下把它捞出来并打印。
 *
 * 数据目录通常在：
 *   %APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<PS大版本>\[Developer\]\<插件ID>\
 * 不同 UXP 版本层级会变，所以这里用递归查找，不写死路径。
 *
 * 用法：
 *   node tools/report.mjs            # 找出最新的报告并打印
 *   node tools/report.mjs --path     # 只打印报告文件路径
 *   node tools/report.mjs --raw      # 原样输出 JSON
 *   node tools/report.mjs --all      # 列出所有找到的报告
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const ONLY_PATH = args.includes("--path");
const RAW = args.includes("--raw");
const ALL = args.includes("--all");

const appData = process.env.APPDATA;
if (!appData) {
  console.error("找不到 %APPDATA%，本脚本只在 Windows 下有效。");
  process.exit(1);
}

const roots = [
  path.join(appData, "Adobe", "UXP", "PluginsStorage"),
  path.join(appData, "Adobe", "UXP"),
];

const TARGET = "report.json";
const MAX_DEPTH = 6;

async function walk(dir, depth, out) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(full, depth + 1, out);
    } else if (ent.name.toLowerCase() === TARGET) {
      try {
        const st = await fs.stat(full);
        out.push({ file: full, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* 忽略读取失败的条目 */
      }
    }
  }
}

function fmt(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes()) +
    ":" +
    p(d.getSeconds())
  );
}

async function main() {
  const found = [];
  for (const r of roots) await walk(r, 0, found);

  if (found.length === 0) {
    console.log("没有找到任何 report.json。");
    console.log("");
    console.log("可能原因：");
    console.log("  1. 插件还没在 Photoshop 里加载过（报告由插件运行时写出）");
    console.log("  2. 插件里的自检没被触发（放一个 autorun.flag 到插件目录可自动触发）");
    console.log("  3. 插件的自检代码抛错，没走到写文件那一步");
    console.log("");
    console.log("查找范围：");
    for (const r of roots) console.log("  " + r);
    process.exitCode = 2;
    return;
  }

  found.sort((a, b) => b.mtime - a.mtime);

  if (ALL) {
    console.log("共找到 " + found.length + " 份报告（按时间倒序）：");
    for (const f of found) {
      console.log("  " + fmt(f.mtime) + "  " + f.size + "B  " + f.file);
    }
    return;
  }

  const newest = found[0];

  if (ONLY_PATH) {
    console.log(newest.file);
    return;
  }

  console.log("报告文件：" + newest.file);
  console.log("写入时间：" + fmt(newest.mtime));
  console.log("-".repeat(64));

  const raw = await fs.readFile(newest.file, "utf8");

  if (RAW) {
    console.log(raw);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.log("(JSON 解析失败，原样输出)");
    console.log(raw);
    return;
  }

  // 通用渲染：尽量把 { ok, results:[{name, ok, detail}] } 这类结构打好读
  const okAll =
    typeof data.ok === "boolean"
      ? data.ok
      : Array.isArray(data.results)
        ? data.results.every((r) => r && r.ok)
        : undefined;

  if (data.plugin || data.version || data.at) {
    console.log(
      "插件：" +
        (data.plugin || "?") +
        (data.version ? " v" + data.version : "") +
        (data.at ? "   于 " + data.at : "")
    );
    console.log("");
  }

  if (Array.isArray(data.results)) {
    for (const r of data.results) {
      const mark = r.ok ? "[PASS]" : "[FAIL]";
      console.log(mark + " " + (r.name || "未命名"));
      if (r.detail) {
        String(r.detail)
          .split("\n")
          .forEach((l) => console.log("        " + l));
      }
      if (r.ok === false && r.error) console.log("        错误：" + r.error);
    }
    console.log("");
    const pass = data.results.filter((r) => r && r.ok).length;
    console.log("小计：" + pass + "/" + data.results.length + " 通过");
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  if (okAll === true) console.log("总判定：全部通过 OK");
  else if (okAll === false) console.log("总判定：存在失败 FAIL");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
