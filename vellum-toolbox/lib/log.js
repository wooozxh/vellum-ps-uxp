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

/* -------------------------------------------------------------------------
 * 🔴 v0.2.7 修的并发缺陷：日志写必须**串行化**
 * -------------------------------------------------------------------------
 * 真机实测（2026-10-10 21:32 那次自检）：多条 `appendLog` 并发时，
 * "读全文 → 拼一行 → 写回" 这个读改写会互相覆盖 —— 日志里出现了
 * `task:87|brand:3 thread=vellum-link/1` 这种**被拦腰截断**的行，
 * 而完整的那一行整个消失。自检本身就是并发写日志的（多项交替），
 * 所以这不是理论问题，它已经让我在排查时看丢过一条关键记录。
 *
 * 做法两条：① 内存缓存最新全文（省掉每次读盘）；② 所有 append 排进同一条 Promise 链。
 */
let chain = Promise.resolve();
let cache = null;

/** 追加一行。返回 true/false 表示是否写成功（不抛）。并发安全。 */
function appendLog(line) {
  chain = chain.then(async () => {
    try {
      if (cache === null) cache = await data.readText(LOG_NAME, "");
      const next = cache + timestamp() + "  " + line + "\n";
      await data.writeText(LOG_NAME, next);
      cache = next;
      return true;
    } catch {
      cache = null; // 写失败就让下一次重新读盘，别拿着过期缓存继续写
      return false;
    }
  });
  return chain;
}

/** 只读日志全文（面板里显示、外部脚本读回都用它）。 */
async function readLog() {
  const text = await data.readText(LOG_NAME, "");
  cache = text;
  return text;
}

/** 清空日志（开发用；不删文件，避免句柄失效）。 */
async function clearLog() {
  cache = "";
  return data.writeText(LOG_NAME, "");
}

module.exports = { appendLog, readLog, clearLog, timestamp, LOG_NAME };
