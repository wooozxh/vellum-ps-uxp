/*
 * lib/csv.js —— CSV 读入：**自己解码 + 自己解析**（v0.4.0，M3 表格生成）
 * ===========================================================================
 * 为什么什么都得自己来（都是 v0.3.9 的真机读数，不是猜的）：
 *   · UXP **没有 `TextDecoder` / `TextEncoder`**（global / window / globalThis 三处都查过）
 *   · 宿主**文本模式 `read()` 是 UTF-8 语义**：GBK 字节 `D6 D0 CE C4 2C 41` 会变成 `"����,A"`
 *     （四个字节全被换成 U+FFFD，数据已经毁了，救不回来）
 *   · 而**二进制读是逐字节精确的** ⇒ 一律 `read({format:binary})` 拿字节，自己解码。
 *
 * 解码顺序（`decodeBytes`）：
 *   UTF-16 BOM → 明确拒绝（说人话，给出下一步）
 *   UTF-8 BOM  → 剥 BOM，自己解 UTF-8
 *   否则       → 先试**严格** UTF-8；不合法再按 **GBK** 解（表见 lib/gbk-table.js）
 *
 * ⚠️ 读文件时**多读一份文本模式**没意义 —— 文本模式那一侧已经是有损的。
 * ===========================================================================
 */

const GBK_TABLE = require("./gbk-table.js");

const GBK_LEAD_MIN = 0x81;
const GBK_LEAD_MAX = 0xFE;
const GBK_TRAIL_MIN = 0x40;
const GBK_TRAIL_MAX = 0xFE;
const GBK_TRAIL_HOLE = 0x7f;
/** 金字节数 × 尾字节数（尾字节跳过 0x7F）= 190 */
const GBK_STRIDE = 190;

function hex2(v) {
  return ("0" + (v & 0xff).toString(16)).slice(-2).toUpperCase();
}

/** 字节数组 → 十六进制串（只用于读数与报错） */
function toHex(u8, max) {
  const n = Math.min(u8.length, max === undefined ? 16 : max);
  const out = [];
  for (let i = 0; i < n; i++) out.push(hex2(u8[i]));
  return out.join(" ") + (u8.length > n ? " …(" + u8.length + "B)" : "");
}

/* ---------------------------------------------------------------------------
 * UTF-8 解码（严格：非法就失败，**不做有损降级**）
 * 为什么不用替换字符凑合：一旦悄悄降级，用户看到的是一堆问号而**不知道为什么**。
 * ------------------------------------------------------------------------- */
function decodeUtf8(u8) {
  let out = "";
  let i = 0;
  const n = u8.length;
  while (i < n) {
    const c = u8[i];
    if (c < 0x80) {
      out += String.fromCharCode(c);
      i++;
      continue;
    }
    let need;
    let cp;
    if (c >= 0xc2 && c <= 0xdf) {
      need = 1;
      cp = c & 0x1f;
    } else if (c >= 0xe0 && c <= 0xef) {
      need = 2;
      cp = c & 0x0f;
    } else if (c >= 0xf0 && c <= 0xf4) {
      need = 3;
      cp = c & 0x07;
    } else {
      return { ok: false, error: "非法 UTF-8 起始字节 0x" + hex2(c) + " @" + i };
    }
    if (i + need >= n) return { ok: false, error: "UTF-8 序列被截断 @" + i };
    for (let k = 1; k <= need; k++) {
      const cc = u8[i + k];
      if (cc < 0x80 || cc > 0xbf) {
        return { ok: false, error: "非法 UTF-8 续字节 0x" + hex2(cc) + " @" + (i + k) };
      }
      cp = (cp << 6) | (cc & 0x3f);
    }
    if (need === 2 && cp < 0x800) return { ok: false, error: "过短编码（overlong）@" + i };
    if (need === 3 && cp < 0x10000) return { ok: false, error: "过短编码（overlong）@" + i };
    if (cp > 0x10ffff) return { ok: false, error: "码点超出 U+10FFFF @" + i };
    if (cp >= 0xd800 && cp <= 0xdfff) return { ok: false, error: "代理区码点非法 @" + i };
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
    i += need + 1;
  }
  return { ok: true, text: out };
}

/**
 * 文本 → UTF-8 字节（**UXP 里没有 TextEncoder**，所以自己写）。
 * 用途：写测试用的 CSV、以及"把内容交给 PS"这类需要字节的场合。
 */
function encodeUtf8(str) {
  const s = String(str === undefined || str === null ? "" : str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

/* ---------------------------------------------------------------------------
 * GBK 解码（查表，零依赖）
 * 索引 = (lead - 0x81) * 190 + (trail < 0x7F ? trail - 0x40 : trail - 0x41)
 * ⚠️ 步长是 **190 不是 191** —— 尾字节空间在 0x7F 处有个空档。
 *    v0.3.9 原型里就写错过这一处，整表全解错（`中文` → `譯蟂`）。
 * ------------------------------------------------------------------------- */
function decodeGbk(u8) {
  let out = "";
  let i = 0;
  let unmapped = 0;
  const n = u8.length;
  while (i < n) {
    const b = u8[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    if (i + 1 >= n) {
      unmapped++;
      out += "\uFFFD";
      i++;
      continue;
    }
    const lead = b;
    const trail = u8[i + 1];
    if (
      lead < GBK_LEAD_MIN || lead > GBK_LEAD_MAX ||
      trail < GBK_TRAIL_MIN || trail > GBK_TRAIL_MAX || trail === GBK_TRAIL_HOLE
    ) {
      unmapped++;
      out += "\uFFFD";
      i++;
      continue;
    }
    const t = trail < GBK_TRAIL_HOLE ? trail - GBK_TRAIL_MIN : trail - GBK_TRAIL_MIN - 1;
    const ch = GBK_TABLE.charAt((lead - GBK_LEAD_MIN) * GBK_STRIDE + t);
    if (!ch) {
      unmapped++;
      out += "\uFFFD";
    } else {
      out += ch;
    }
    i += 2;
  }
  return { text: out, unmapped: unmapped };
}

/* ---------------------------------------------------------------------------
 * 字节 → 文本（对外主入口）
 * @returns {{ok:boolean, text?:string, encoding?:string, bom?:boolean,
 *            unmapped?:number, utf8Error?:string, note?:string, error?:string, hex?:string}}
 * ------------------------------------------------------------------------- */
function decodeBytes(u8) {
  if (!u8 || !u8.length) {
    return { ok: true, text: "", encoding: "空文件", bom: false, note: "文件是 0 字节" };
  }
  // UTF-16 两种 BOM：**明确拒绝**，并给出下一步（不静默乱码）
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return {
      ok: false, hex: toHex(u8, 8),
      error: "这是 UTF-16 LE 文件（BOM 是 FF FE），读不了。请用 Excel「另存为 → CSV UTF-8」再导入。",
    };
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return {
      ok: false, hex: toHex(u8, 8),
      error: "这是 UTF-16 BE 文件（BOM 是 FE FF），读不了。请用 Excel「另存为 → CSV UTF-8」再导入。",
    };
  }
  let off = 0;
  let bom = false;
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    off = 3;
    bom = true;
  }
  const body = off ? u8.slice(off) : u8;

  const utf = decodeUtf8(body);
  if (utf.ok) {
    return { ok: true, text: utf.text, encoding: bom ? "UTF-8（含 BOM）" : "UTF-8", bom: bom };
  }
  const gbk = decodeGbk(body);
  return {
    ok: true, text: gbk.text, encoding: "GBK", bom: false,
    unmapped: gbk.unmapped, utf8Error: utf.error,
    note: "不是合法 UTF-8（" + utf.error + "）⇒ 按 GBK 解" +
      (gbk.unmapped ? "；其中 " + gbk.unmapped + " 处没有对应字，已标成 \uFFFD" : ""),
  };
}

/* ---------------------------------------------------------------------------
 * 解析：纯 JS 状态机（引号 / 双引号转义 / 字段内逗号与换行 / CRLF / CR / LF）
 * 不依赖任何库 —— 也依赖不了，UXP 里没有现成的。
 * ------------------------------------------------------------------------- */
const DELIMS = [",", "\t", ";"];

/** 用第一行非空内容猜分隔符（CSV / TSV / 分号表）。并列时按 DELIMS 顺序取。 */
function sniffDelimiter(text) {
  const lines = String(text).split(/\r\n|\n|\r/);
  let line = "";
  for (let i = 0; i < lines.length && i < 5; i++) {
    if (lines[i].trim() !== "") {
      line = lines[i];
      break;
    }
  }
  let best = ",";
  let bestN = 0;
  for (const d of DELIMS) {
    let cnt = 0;
    for (let i = 0; i < line.length; i++) if (line[i] === d) cnt++;
    if (cnt > bestN) {
      bestN = cnt;
      best = d;
    }
  }
  return best;
}

/**
 * 解析文本 → 二维数组。
 * @param {string} text
 * @param {{delimiter?:string, maxRows?:number}} [opts]
 * @returns {{ok:boolean, rows:string[][], delimiter:string, warnings:string[], error?:string}}
 */
function parseCsv(text, opts) {
  const o = opts || {};
  const src = String(text === undefined || text === null ? "" : text);
  const delim = o.delimiter || sniffDelimiter(src);
  const rows = [];
  const warnings = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoteOpened = false;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      quoteOpened = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      quoteOpened = false;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);

  if (inQuotes) warnings.push("有一个引号没有闭合（文件可能被截断）");
  if (quoteOpened) warnings.push("检测到带引号的字段（已按双引号转义规则解析）");

  // 去掉尾部完全空白的行（Excel 常留一行）
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  // 兜底再剥一次 BOM（万一解码路径没处理）
  if (rows.length && rows[0].length && rows[0][0].charCodeAt(0) === 0xfeff) {
    rows[0][0] = rows[0][0].slice(1);
  }

  const maxRows = o.maxRows || 5000;
  if (rows.length > maxRows) {
    warnings.push("行数超过 " + maxRows + "，只保留前 " + maxRows + " 行");
    rows.length = maxRows;
  }
  return { ok: rows.length > 0, rows: rows, delimiter: delim, warnings: warnings };
}

/** 一步到位：字节 → 编码判定 → 解析。**这是面板应该调用的那个。** */
function readBytes(u8, opts) {
  const dec = decodeBytes(u8);
  if (!dec.ok) return { ok: false, error: dec.error, hex: dec.hex, encoding: null };
  const p = parseCsv(dec.text, opts);
  if (!p.ok) {
    return { ok: false, error: "解析后没有任何内容", encoding: dec.encoding, text: dec.text };
  }
  return {
    ok: true,
    rows: p.rows,
    delimiter: p.delimiter,
    encoding: dec.encoding,
    bom: dec.bom,
    unmapped: dec.unmapped || 0,
    note: dec.note || null,
    warnings: p.warnings,
    utf8Error: dec.utf8Error || null,
  };
}

module.exports = {
  decodeBytes, decodeUtf8, decodeGbk, encodeUtf8,
  sniffDelimiter, parseCsv, readBytes,
  toHex,
  GBK_STRIDE, GBK_SLOTS: GBK_TABLE.length,
};
