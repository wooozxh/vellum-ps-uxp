/*
 * lib/log.js —— boot.log 反馈通道
 * ===========================================================================
 * UXP 跑在 Photoshop 进程里，console.log 只有调试窗口能看到，外部脚本读不到。
 * 所以把「关键事件」追加写到 PluginData/boot.log，于是：
 *     用户点了什么 → 插件干了什么 → 成没成 / 失败原因
 * 这条链就能被外部脚本读回来。这是本项目 vibecoding 的命脉（docs/10 §六）。
 *
 * 纪律：日志写失败绝不能打断功能，所以 appendLog 全程吞异常。
 */

const data = require("./data.js");

const LOG_NAME = "boot.log";

function pad(n) {
  return String(n).padStart(2, "0");
}

/** 本地时间 "YYYY-MM-DD HH:MM:SS"。 */
function timestamp(d) {
  const t = d || new Date();
  return (
    t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()) +
    " " + pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds())
  );
}

/** 追加一行。返回 true/false 表示是否写成功（不抛）。 */
async function appendLog(line) {
  try {
    const prev = await data.readText(LOG_NAME, "");
    await data.writeText(LOG_NAME, prev + timestamp() + "  " + line + "\n");
    return true;
  } catch {
    return false;
  }
}

/** 只读日志全文（面板里显示、外部脚本读回都用它）。 */
function readLog() {
  return data.readText(LOG_NAME, "");
}

/** 清空日志（开发用；不删文件，避免句柄失效）。 */
function clearLog() {
  return data.writeText(LOG_NAME, "");
}

module.exports = { appendLog, readLog, clearLog, timestamp, LOG_NAME };
