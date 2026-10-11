/*
 * tools/build-ccx.cjs —— 把 vellum-toolbox 打成可安装的 .ccx
 * ===========================================================================
 * 为什么要有它：`.ccx` 本质就是一个 zip（根目录放 manifest.json），
 * 以前靠 UXP Developer Tool 的 Package 按钮出。问题是——
 *   ① UDT 每次都要人工点，容易忘 → 上一份 ccx 停在 14:51，早于 v0.2.0~0.2.3；
 *   ② 忘了就会拿一份**过期产物**去分发/安装，排查时白走一大圈。
 * 所以改成可复现的命令：`node tools/build-ccx.cjs`。
 *
 * 硬约束（都踩过）：
 *   ⚠️ **manifest.json 必须在 zip 根**，不能套一层 `vellum-toolbox/` 目录
 *      —— UPIA 找不到 manifest 就报"不是有效的插件包"。
 *   ⚠️ **必须排除开发态文件**：`verify.flag`（自检开关）、`.uxprc`（UDT 会话文件）、
 *      任何点开头的文件。带上 verify.flag 会让每个装了它的人一开 PS 就跑自检、
 *      闪一个临时文档。
 *   ⚠️ 自己写 zip 是因为本机没有 UDT CLI / UPIA，PowerShell 的输出在这个环境下
 *      拿不到（静默失败过一次）→ 不要再用 Compress-Archive 出产物。
 *
 * 用法：
 *   node tools/build-ccx.cjs                  # 打包
 *   node tools/build-ccx.cjs --check          # 只校验已有 ccx（列条目）
 *   node tools/build-ccx.cjs --src <目录> --out <文件>
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const DEFAULT_SRC = path.join(ROOT, "vellum-toolbox");
const DEFAULT_OUT = path.join(ROOT, "dist", "com.vellum.toolbox_PS.ccx");

/** 不允许进包的文件（开发态专用）。 */
const EXCLUDE_NAMES = [".uxprc", "verify.flag", "verify-keep.flag"];
/** 不允许进包的目录名。 */
const EXCLUDE_DIRS = [".git", "node_modules"];

/* ---------------------------------------------------------------- CRC32 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ zip */
function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/** 递归收集要打包的文件（相对路径用正斜杠，符合 zip 规范）。 */
function collect(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE_NAMES.indexOf(name) >= 0) continue;
    if (EXCLUDE_DIRS.indexOf(name) >= 0) continue;
    if (name.startsWith(".")) continue; // .uxprc / .DS_Store / .gitignore 之类
    const abs = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) collect(abs, rel, out);
    else out.push({ abs, rel });
  }
  return out;
}

function build(srcDir, outFile) {
  const files = collect(srcDir, "", []).sort((a, b) => (a.rel < b.rel ? -1 : 1));

  if (!files.some((f) => f.rel === "manifest.json")) {
    throw new Error("源目录里没有 manifest.json（它必须在包根）");
  }

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    let raw = fs.readFileSync(f.abs);
    /* 🔴 v0.3.7：**发布包的 `host` 必须是单个对象**（数组只在**开发态**允许 ——
       Adobe "Package a Plugin" 明文："the `host` property ... must be a single object"）。
       UDT 的 `plugin package` 会自动把数组转成第一个对象，我们自己搓 zip 就必须自己做。
       这里只在**包内**转换；源 `manifest.json` 保持数组（开发态加载要用）。 */
    if (f.rel === "manifest.json") {
      const m = JSON.parse(raw.toString("utf8"));
      if (Array.isArray(m.host) && m.host.length) {
        m.host = m.host[0];
        raw = Buffer.from(JSON.stringify(m, null, 2) + "\n", "utf8");
        console.log("  manifest.host：数组 → 单个对象　" + JSON.stringify(m.host));
      }
    }
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const { time, date } = dosTime(fs.statSync(f.abs).mtime);
    const nameBuf = Buffer.from(f.rel, "utf8");

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // method = deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len

    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8); // flags
    ch.writeUInt16LE(8, 10); // method
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk start
    ch.writeUInt16LE(0, 36); // internal attr
    ch.writeUInt32LE(0, 38); // external attr
    ch.writeUInt32LE(offset, 42); // local header offset

    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...locals, cd, eocd]));

  return { files, bytes: fs.statSync(outFile).size, outFile };
}

/** 读回 ccx 的中央目录，列出条目（用来验收产物，不是"写完就当成功"）。 */
function list(outFile) {
  const b = fs.readFileSync(outFile);
  const eocdAt = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdAt < 0) throw new Error("不是合法的 zip（找不到 EOCD）");
  const n = b.readUInt16LE(eocdAt + 10);
  let off = b.readUInt32LE(eocdAt + 16);
  const entries = [];
  for (let i = 0; i < n; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) throw new Error("中央目录第 " + i + " 条签名不对");
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    entries.push({
      name: b.slice(off + 46, off + 46 + nameLen).toString("utf8"),
      size: b.readUInt32LE(off + 24),
      crc: b.readUInt32LE(off + 16).toString(16),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ------------------------------------------------------------------ CLI */
function main() {
  const argv = process.argv.slice(2);
  const arg = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const src = path.resolve(arg("--src", DEFAULT_SRC));
  const out = path.resolve(arg("--out", DEFAULT_OUT));

  if (argv.indexOf("--check") >= 0) {
    const entries = list(out);
    const size = fs.statSync(out).size;
    console.log("检查 " + out + "  （" + size + " 字节，" + entries.length + " 个条目）");
    for (const e of entries) console.log("  " + e.name + "  " + e.size);
    return;
  }

  const r = build(src, out);
  console.log("打包完成：" + r.outFile);
  console.log("  源目录 " + src);
  console.log("  体积   " + r.bytes + " 字节");
  console.log("  条目   " + r.files.length + " 个");
  console.log("  已排除 " + EXCLUDE_NAMES.join(" / ") + " 以及所有点开头的文件/目录");

  const entries = list(out);
  if (entries.length !== r.files.length) {
    throw new Error("回读条目数(" + entries.length + ") 与写入数(" + r.files.length + ") 不一致");
  }
  if (!entries.some((e) => e.name === "manifest.json")) {
    throw new Error("回读发现 manifest.json 不在包根 —— UPIA 会认不出这是插件包");
  }
  console.log("  回读校验：OK（条目数一致，manifest.json 在包根）");
  const ver = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8")).version;
  console.log("  版本   " + ver);
}

main();
