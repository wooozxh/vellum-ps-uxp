#!/usr/bin/env node
/*
 * linkprobe/server.mjs —— 本地「联动服务」探针（零依赖，纯 Node）
 * ===========================================================================
 * 目的：在真正给 VellumDesk 加联动服务之前，先证明 **UXP 插件这一侧** 到底能做什么。
 * 它模拟未来 VellumDesk 联动服务的最小形态：
 *   GET /api/list      → 一段 JSON（模拟素材列表）
 *   GET /img/test.png  → 一张真实 PNG（模拟缩略图，走 HTTP 传图）
 *   WS  /ws            → 连上后主动推送若干条文本事件（模拟"库变更实时推送"）
 *
 * 另外，启动时会把同一张 PNG 落到 link-probe/sample/disk-test.png，
 * 供插件的「本地磁盘图片能否显示」测试使用。
 *
 * 用法：node tools/linkprobe/server.mjs [port]     默认端口 8799
 * 只监听 127.0.0.1，不对外。Ctrl+C 结束。
 *
 * 只读探针，不改动项目任何文件（除了自己生成的 sample/ 测试图）。
 */

import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.argv[2] || process.env.LINKPROBE_PORT || 8799);
const HOST = "127.0.0.1";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/* ------------------------------------------------------------ PNG 生成器 */
/* 手写最小 PNG 编码器（真彩色 RGB），只依赖 zlib.deflateSync。 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 生成 w×h 的渐变 PNG，纯色底色 + 对角渐变，肉眼一看就知道是图。 */
function makePng(w, h, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3;
      raw[p] = (r + Math.floor((x / w) * 120)) & 0xff;
      raw[p + 1] = (g + Math.floor((y / h) * 120)) & 0xff;
      raw[p + 2] = b & 0xff;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const TEST_PNG = makePng(96, 96, [30, 120, 200]);

/* --------------------------------------------------- 把测试图落到磁盘（供本地图测试） */

const HERE = import.meta.dirname;
const SAMPLE_DIR = path.resolve(HERE, "..", "..", "link-probe", "sample");
const SAMPLE_FILE = path.join(SAMPLE_DIR, "disk-test.png");
try {
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });
  fs.writeFileSync(SAMPLE_FILE, TEST_PNG);
} catch (e) {
  console.error("[warn] 写 sample/disk-test.png 失败:", e && e.message);
}

/* ------------------------------------------------------------ 假素材数据 */

const ITEMS = [
  { id: "a1", name: "品牌主视觉-横版.png", w: 1920, h: 1080, tag: "成品" },
  { id: "a2", name: "招生海报-2026秋.png", w: 1242, h: 2208, tag: "成品" },
  { id: "a3", name: "样机-mockup-01.png", w: 2000, h: 1500, tag: "样机" }
];

function json(res, obj, code = 200) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "access-control-allow-origin": "*"
  });
  res.end(body);
}

/* ------------------------------------------------------------------- HTTP */

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/api/list")) {
    return json(res, { ok: true, source: "linkprobe", items: ITEMS });
  }
  if (url.startsWith("/img/test.png")) {
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": TEST_PNG.length,
      "access-control-allow-origin": "*"
    });
    return res.end(TEST_PNG);
  }
  if (url === "/" || url.startsWith("/index")) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(
      "linkprobe server alive\n" +
        "  GET /api/list\n" +
        "  GET /img/test.png\n" +
        "  WS  /ws\n"
    );
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found: " + url);
});

/* -------------------------------------------------- WebSocket（手写，零依赖） */

function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** 组装一个 server→client 的文本帧（不掩码）。 */
function wsFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

let wsSeq = 0;

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " +
      wsAccept(key) +
      "\r\n\r\n"
  );
  log("WS 客户端已连接：" + (req.socket.remoteAddress || "?"));

  // 连上就先推一条，之后每秒推一条，共 5 条 —— 模拟"库变更实时推送"。
  // 计数用**本连接局部**变量，避免多连接互相干扰（曾因全局计数 + TDZ 崩过一次）。
  let n = 0;
  let timer = null;
  const push = () => {
    n++;
    wsSeq++;
    const msg = JSON.stringify({
      type: "library-changed",
      seq: n,
      total: wsSeq,
      at: new Date().toISOString(),
      msg: "VellumDesk → 插件 实时推送 #" + n
    });
    try {
      socket.write(wsFrame(msg));
    } catch (e) {
      /* 客户端可能已关 */
    }
    if (n >= 5 && timer) clearInterval(timer);
  };
  push();
  timer = setInterval(push, 1000);

  const stop = () => {
    if (timer) clearInterval(timer);
  };
  socket.on("close", stop);
  socket.on("error", stop);
});

/* ------------------------------------------------------------------ 启动 */

function log(msg) {
  console.log("[linkprobe] " + msg);
}

server.on("error", (e) => {
  console.error("[linkprobe] 服务启动失败:", e && e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log("联动探针服务已启动 → http://" + HOST + ":" + PORT);
  log("  · GET  /api/list        （JSON）");
  log("  · GET  /img/test.png    （PNG，" + TEST_PNG.length + " 字节）");
  log("  · WS   /ws             （连上即推送）");
  log("  · 测试图已落盘 → " + SAMPLE_FILE);
});
