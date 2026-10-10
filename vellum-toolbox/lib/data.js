/*
 * lib/data.js —— PluginData 文件底座
 * ===========================================================================
 * 职责单一：把「读写插件自己的数据目录」这件事收在一处。
 *   - 插件目录（getPluginFolder）是**只读**的，用来放开关文件（verify.flag 等）。
 *   - 数据目录（getDataFolder）是**可写**的，落在
 *     %APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<PS大版本>\Developer\<插件id>\PluginData\
 *
 * 为什么要有这一层：log.js（日志）和 store.js（JSON）都要摸文件，
 * 若各写一份 getDataFolder，将来目录逻辑一变就要改两处。
 *
 * UXP 硬约束：引宿主模块只能 require()，不能 import。
 */

const { storage } = require("uxp");

/** 缓存目录句柄，避免每次都 await 一遍。 */
let dataFolderCache = null;
let pluginFolderCache = null;

async function getDataFolder() {
  if (!dataFolderCache) {
    dataFolderCache = await storage.localFileSystem.getDataFolder();
  }
  return dataFolderCache;
}

async function getPluginFolder() {
  if (!pluginFolderCache) {
    pluginFolderCache = await storage.localFileSystem.getPluginFolder();
  }
  return pluginFolderCache;
}

/** 读文本；失败时返回 fallback（默认 ""），绝不抛。 */
async function readText(name, fallback) {
  const fb = fallback === undefined ? "" : fallback;
  try {
    const folder = await getDataFolder();
    const entry = await folder.getEntry(name);
    const text = await entry.read();
    return typeof text === "string" ? text : String(text);
  } catch {
    return fb;
  }
}

/** 写文本（不存在就创建）。失败会抛 —— 调用方决定怎么处理。 */
async function writeText(name, text) {
  const folder = await getDataFolder();
  let entry;
  try {
    entry = await folder.getEntry(name);
  } catch {
    entry = await folder.createFile(name, { overwrite: true });
  }
  await entry.write(String(text));
  return entry;
}

/* ---------- v0.2.5（M2 素材库）新增：子目录 + 二进制 ---------- */

/**
 * 逐级进入子目录。names = ["library", "thumb"]。
 * UXP 的 getEntry 一次只下一层，所以要逐级走。
 * @param {string[]} names
 * @param {boolean} [create] 不存在时是否创建目录
 * @returns {Promise<object|null>} 拿不到返回 null（调用方决定怎么降级）
 */
async function subfolder(names, create) {
  let cur = await getDataFolder();
  for (const n of names) {
    let e = null;
    try {
      e = await cur.getEntry(n);
    } catch {
      e = null;
    }
    if (!e) {
      if (!create) return null;
      try {
        e = await cur.createFolder(n);
      } catch {
        return null;
      }
    }
    cur = e;
  }
  return cur;
}

/** 读子目录里的文本。拿不到返回 fallback。 */
async function readTextIn(names, file, fallback) {
  const fb = fallback === undefined ? "" : fallback;
  try {
    const folder = await subfolder(names, false);
    if (!folder) return fb;
    const entry = await folder.getEntry(file);
    const text = await entry.read();
    return typeof text === "string" ? text : String(text);
  } catch {
    return fb;
  }
}

/**
 * 读子目录里的**二进制**。
 * ⚠️ UXP 的 `File.read()` 默认按文本读 —— 对 webp/png 这类二进制**必须显式给 format**，
 *    否则拿到的是被按文本解码的垃圾（这一步正是 docs/10 §10.5 标注「尚未单独实测」的环）。
 * @returns {Promise<{ok:boolean, buffer?:ArrayBuffer, byteLength?:number, error?:string}>}
 */
async function readBinaryIn(names, file) {
  try {
    const folder = await subfolder(names, false);
    if (!folder) return { ok: false, error: "子目录不存在：" + names.join("/") };
    let entry;
    try {
      entry = await folder.getEntry(file);
    } catch (e) {
      return { ok: false, error: "文件不存在：" + file };
    }
    const formats = ((require("uxp").storage || {}).formats) || {};
    if (!formats.binary) {
      return { ok: false, error: "uxp.storage.formats.binary 不存在（该 UXP 版本不支持二进制读）" };
    }
    const buf = await entry.read({ format: formats.binary });
    if (!buf) return { ok: false, error: "read({format:binary}) 返回空" };
    const n = buf.byteLength !== undefined ? buf.byteLength : (buf.length || 0);
    return { ok: true, buffer: buf, byteLength: n };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 写子目录里的文本（不存在就创建文件）。
 * ⚠️ 契约 §八：镜像里插件唯一可写的是 `library/handoff/req.json`。
 *    本函数只提供能力，**在哪写由调用方负责** —— 别拿它去写镜像内容。
 * @param {object} [opts] { create:boolean=true } 目录不存在时是否尝试 createFolder
 *   （UXP 能否 createFolder **尚未验证** —— 契约 §六 的规避方案是由软件侧预建目录，
 *     所以这里把"建目录失败"当成可降级的正常情况，如实返回而不是抛）
 * @returns {Promise<{ok:boolean, path?:string, created?:boolean, error?:string}>}
 */
async function writeTextIn(names, file, text, opts) {
  const create = !(opts && opts.create === false);
  try {
    const folder = await subfolder(names, create);
    if (!folder) return { ok: false, error: "子目录不存在且无法创建：" + names.join("/") };
    let entry;
    let created = false;
    try {
      entry = await folder.getEntry(file);
    } catch {
      entry = await folder.createFile(file, { overwrite: true });
      created = true;
    }
    await entry.write(String(text));
    return { ok: true, path: entry.nativePath || null, created: created };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 取子目录里某个文件的 **Entry 对象本身**（不是内容）。
 * 用途：UXP 要把文件交给 `batchPlay` 时，需要的是**会话令牌**，
 *       而令牌只能由 Entry 换出来（`localFileSystem.createSessionToken(entry)`）。
 *       字符串路径**不行** —— 真机实测报 `invalid file token used`（见 lib/ps.js placeFile）。
 * @returns {Promise<object|null>}
 */
async function entryIn(names, file) {
  try {
    const folder = await subfolder(names, false);
    if (!folder) return null;
    return await folder.getEntry(file);
  } catch {
    return null;
  }
}

/**
 * 取子目录里某个文件的**绝对路径**（nativePath）。
 * 用途：UXP 自己读不了沙箱外的文件，但**可以把绝对路径交给 Photoshop** ——
 *       PS 的 `placeEvent` 描述符里就是一条 `_path`，由 PS 自己解析（详见 lib/ps.js placeFile）。
 * @returns {Promise<string|null>}
 */
async function nativePathIn(names, file) {
  try {
    const folder = await subfolder(names, false);
    if (!folder) return null;
    const entry = await folder.getEntry(file);
    return entry.nativePath || null;
  } catch {
    return null;
  }
}

/** 文件是否存在。 */
async function exists(name) {
  try {
    const folder = await getDataFolder();
    await folder.getEntry(name);
    return true;
  } catch {
    return false;
  }
}

/** 删除文件（不存在算成功）。 */
async function remove(name) {
  try {
    const folder = await getDataFolder();
    const entry = await folder.getEntry(name);
    await entry.delete();
    return true;
  } catch {
    return false;
  }
}

/**
 * 插件目录下是否存在某个「开关文件」（如 verify.flag）。
 * 开自检、开探针都靠它 —— 默认关闭，删文件即关。
 */
async function pluginFlag(name) {
  try {
    const folder = await getPluginFolder();
    await folder.getEntry(name);
    return true;
  } catch {
    return false;
  }
}

/** 插件数据目录的绝对路径（写进日志便于人肉定位）。 */
async function dataFolderPath() {
  try {
    const folder = await getDataFolder();
    return folder.nativePath || "?";
  } catch {
    return "?";
  }
}

module.exports = {
  getDataFolder,
  getPluginFolder,
  readText,
  writeText,
  exists,
  remove,
  pluginFlag,
  dataFolderPath,
  /* v0.2.5（M2 素材库）新增：子目录 + 二进制 */
  subfolder,
  readTextIn,
  readBinaryIn,
  /* v0.2.7（M2 素材库 UI）新增：写子目录 + 取绝对路径 + 取 Entry */
  writeTextIn,
  nativePathIn,
  entryIn,
};
