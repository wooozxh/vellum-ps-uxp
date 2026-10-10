/*
 * lib/store.js —— PluginData 里的 JSON 存储
 * ===========================================================================
 * 位置：PluginData（getDataFolder），**不是**插件目录 —— 插件目录只读，
 * 写不进去（见 DECISIONS.md）。落在这里的文件：
 *   palette.json  调色板：品牌色覆盖 + 「我的颜色」数组
 *   （M2 之后还会出现 library/ 镜像目录，那是另一套，不放这里）
 *
 * 纪律：读失败 / 文件不存在 → 用默认值，**不报错、不打断**。
 * 用户数据永远不该因为一次解析失败就把面板打挂。
 */

const data = require("./data.js");

/** 读 JSON；文件不存在或内容坏了都返回 fallback。 */
async function readJson(name, fallback) {
  const fb = fallback === undefined ? null : fallback;
  const text = await data.readText(name, "");
  if (!text || !text.trim()) return fb;
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return fb;
    return parsed;
  } catch {
    return fb;
  }
}

/** 写 JSON（缩进 2，便于人肉查看）。失败会抛，调用方决定是否吞。 */
async function writeJson(name, obj) {
  await data.writeText(name, JSON.stringify(obj, null, 2));
  return obj;
}

/**
 * 读 → 改 → 写。patch 收到当前对象（或 fallback），返回新对象。
 * 用来避免「忘了先读就把旧数据覆盖掉」。
 */
async function patchJson(name, fallback, patch) {
  const current = await readJson(name, fallback);
  const next = patch(current);
  await writeJson(name, next);
  return next;
}

/** 备份一份（覆盖式，用于自检前保护用户数据）。 */
async function backup(name) {
  const text = await data.readText(name, "");
  if (!text) return null;
  const bak = name.replace(/\.json$/i, "") + ".backup.json";
  await data.writeText(bak, text);
  return bak;
}

/** 从备份恢复。 */
async function restoreBackup(name) {
  const bak = name.replace(/\.json$/i, "") + ".backup.json";
  const text = await data.readText(bak, "");
  if (!text) return false;
  await data.writeText(name, text);
  return true;
}

module.exports = { readJson, writeJson, patchJson, backup, restoreBackup };
