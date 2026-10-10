/*
 * tools/fake-vellumdesk.cjs —— 「假 VellumDesk」桩（契约 §11 要求的插件侧测试桩）
 * ===========================================================================
 * 作用：在**没有 VellumDesk** 的情况下，往插件的 PluginData\library\ 写一份
 *      **契约合规**的镜像，让插件侧的「读镜像」逻辑可以独立开发与验收。
 *
 * 用法：
 *   node tools/fake-vellumdesk.cjs                  写默认镜像（task rev 87 / brand rev 3）
 *   node tools/fake-vellumdesk.cjs --task-rev 88    只改 task 的 revision（用来测轮询"变了"）
 *   node tools/fake-vellumdesk.cjs --brand-rev 4    只改 brand 的 revision
 *   node tools/fake-vellumdesk.cjs --clean          清掉镜像目录
 *   node tools/fake-vellumdesk.cjs --dir <path>     指定 PluginData 目录
 *   node tools/fake-vellumdesk.cjs --major 26       指定 PS 大版本（默认 27）
 *   node tools/fake-vellumdesk.cjs --force          **强行覆盖非 fixture 的镜像**（见下）
 *
 * 🔴 **安全闸（2026-10-11 加）：本桩拒绝对"真软件写的镜像"落笔。**
 *    真 VellumDesk 上线后，真镜像与假镜像躺在**同一个目录**里，
 *    一句随手命令就会把用户的真项目/真素材换成 fixture，而且**看起来是成功的**。
 *    识别方式：本桩写的 manifest 带 `generator.fixture = true`，真软件的不带 ⇒ 直接 `exit 3`。
 *    要覆盖必须显式 `--force`。**`--clean` 同样受这道闸保护。**
 *
 * ⚠️ 契约要点（改这里务必对照 `D:\vellum-link\LINK-CONTRACT.md`，唯一权威源）
 *   1. **缩略图必须 png/jpg，不得 webp** —— UXP 的 `<img>` 不解码 webp（插件侧 S19 实测）。
 *      缩略图格式与**原文件格式无关**（`asset.thumb` 是镜像内相对路径）。
 *   2. JSON 一律 UTF-8 无 BOM；字段名严格照契约 §5.1 / §5.2 / §5.3 / §5.4。
 *   3. `handoff/` 由**软件侧（= 本桩）预建** —— 插件不负责建目录。
 *   4. 三个文件的写入者**只有软件侧**；插件只读（契约 §八）。
 *
 * ── 2026-10-10 跟进软件侧的三处加法（契约 §十「加法」，不升版本）
 *   · §5.5 缩略图命名带**命名空间**：任务库 `t<id>.png`、通用库 `b<id>.png`
 *     （两库 `asset.id` **各自从 1 起**，共享 `thumb\` 会同名覆盖）。
 *     本桩刻意**让通用库 id 从 1 起**，好让"两库同 id"这个真实情形在真机上出现。
 *   · §5.4 通用库 asset 带可选 `source`（`company` / `user`）。
 *   · §5.3 通用库分组**两层**：子组用 `parentId` 指父组，顶层省略。
 *     ⚠️ 本桩刻意做出**三种情形**，让插件侧的容错分支都能被验到：
 *        (a) 顶层组**自己直接挂素材**（`公司素材` 挂 2 张）；
 *        (b) 顶层组**只当容器、素材在子组里**（`节日素材` 是 `公司素材` 的子组）；
 *        (c) 两种来源**混在同一个库里**（company 3 张 / user 1 张）→ 插件该给出「来源」筛选。
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CONTRACT = "vellum-link/1";
const MIRROR_DIR = "library";
const PLUGIN_ID = "com.vellum.toolbox";

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
function argVal(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const CLEAN = argv.includes("--clean");
const FORCE = argv.includes("--force");
const PS_MAJOR = argVal("--major", "27");
const TASK_REV = Number(argVal("--task-rev", "87"));
const BRAND_REV = Number(argVal("--brand-rev", "3"));

function defaultPluginData() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
  return path.join(appData, "Adobe", "UXP", "PluginsStorage", "PHSP", PS_MAJOR, "Developer", PLUGIN_ID, "PluginData");
}
const PLUGIN_DATA = path.resolve(argVal("--dir", defaultPluginData()));
const LIB = path.join(PLUGIN_DATA, MIRROR_DIR);

/* ---------- 极简 PNG 编码器（纯色块，够做缩略图桩） ---------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 生成 w×h 的纯色 PNG（RGB，8bit，无 alpha）。 */
function solidPng(w, h, rgb) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    let o = y * stride;
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw[o++] = rgb[0];
      raw[o++] = rgb[1];
      raw[o++] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hex2rgb(hex) {
  const s = String(hex).replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/* ---------- 镜像内容（严格照契约 §5.1~§5.4） ---------- */

/** 契约 §五：时间一律 ISO 8601 **带时区**。⚠️ 不能拿 toISOString() 换后缀 ——
 *  它给的是 UTC，直接改 "+08:00" 会让时间差 8 小时。 */
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) +
    sign + p(Math.floor(a / 60)) + ":" + p(a % 60)
  );
}
const NOW = isoLocal(new Date());
const WS = "D:\\vellum_workspace";

/** 缩略图桩：长边 ≤ 320（契约 §5.5），命名带命名空间（任务 t / 通用 b） */
const THUMBS = [
  { file: "t401.png", w: 320, h: 240, color: "#2F8FE0" },
  { file: "t402.png", w: 320, h: 240, color: "#23AEC1" },
  { file: "t403.png", w: 300, h: 300, color: "#C86A2B" },
  { file: "b1.png", w: 160, h: 160, color: "#0F8F63" },
  { file: "b2.png", w: 240, h: 320, color: "#3FCB7B" },
  { file: "b3.png", w: 320, h: 200, color: "#E6D6A8" },
  { file: "b4.png", w: 200, h: 200, color: "#3A3D42" },
];

function manifestJson() {
  return {
    contract: CONTRACT,
    generatedAt: NOW,
    generator: { app: "VellumDesk", version: "1.9.6", layoutVersion: "3", fixture: true },
    workspaceRoot: WS,
    psMajor: PS_MAJOR,
    scopes: [
      { id: "task", label: "任务库", file: "task.json", revision: TASK_REV, count: 3 },
      { id: "brand", label: "通用库", file: "brand.json", revision: BRAND_REV, count: 4 },
    ],
  };
}

function taskJson() {
  return {
    contract: CONTRACT,
    scope: "task",
    revision: TASK_REV,
    generatedAt: NOW,
    projects: [
      {
        id: 1,
        name: "海南升学集训营",
        color: "#2F8FE0",
        sortOrder: 0,
        archived: false,
        packs: [
          {
            id: 12,
            name: "开营海报-2026秋季",
            category: "海报",
            channel: "朋友圈",
            folderPath: WS + "\\海南升学集训营\\开营海报-2026秋季",
            versions: [{ id: 30, seq: 1, isCurrent: true, note: "", folderName: "V1" }],
            assets: [
              {
                id: 401,
                name: "开营主视觉.psd",
                ext: "psd",
                kind: "psd",
                role: "工程",
                size: 5120000,
                width: 2480,
                height: 3508,
                versionId: 30,
                thumb: "thumb/t401.png",
                missing: false,
                modifiedAt: "2026-10-08T10:00:00+08:00",
                absPath: WS + "\\海南升学集训营\\开营海报-2026秋季\\V1\\03-工程\\开营主视觉.psd",
                tags: ["主视觉", "竖版"],
              },
              {
                id: 402,
                name: "开营海报.jpg",
                ext: "jpg",
                kind: "image",
                role: "成品",
                size: 880000,
                width: 2480,
                height: 3508,
                versionId: 30,
                thumb: "thumb/t402.png",
                missing: false,
                modifiedAt: "2026-10-08T12:30:00+08:00",
                absPath: WS + "\\海南升学集训营\\开营海报-2026秋季\\V1\\01-成品\\开营海报.jpg",
                tags: ["海报"],
              },
            ],
          },
        ],
      },
      /* 第二个项目：单靠一个项目**验不出项目筛选**（下拉只有一个选项时它就不构成筛选） */
      {
        id: 2,
        name: "秋季招生宣讲",
        color: "#C86A2B",
        sortOrder: 1,
        archived: false,
        packs: [
          {
            id: 21,
            name: "宣讲主KV-2026",
            category: "主视觉",
            channel: "官网",
            folderPath: WS + "\\秋季招生宣讲\\宣讲主KV-2026",
            versions: [{ id: 40, seq: 1, isCurrent: true, note: "", folderName: "V1" }],
            assets: [
              {
                id: 403,
                name: "宣讲主KV.png",
                ext: "png",
                kind: "image",
                role: "成品",
                size: 1320000,
                width: 3000,
                height: 3000,
                versionId: 40,
                thumb: "thumb/t403.png",
                missing: false,
                modifiedAt: "2026-10-09T09:15:00+08:00",
                absPath: WS + "\\秋季招生宣讲\\宣讲主KV-2026\\V1\\01-成品\\宣讲主KV.png",
                tags: ["KV"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function brandJson() {
  return {
    contract: CONTRACT,
    scope: "brand",
    revision: BRAND_REV,
    generatedAt: NOW,
    // 契约 §5.3 补注：通用库 = 公司通用素材 + 用户自积累素材
    // 契约 §5.3 加法 ③：两层分组（子组用 parentId 指父组；顶层省略）
    //     · 公司素材（顶层，**自己直接挂 2 张**）+ 它的子组 节日素材（挂 1 张）
    //     · 我的收藏（顶层，挂 1 张）
    // 契约 §5.4 加法 ②：asset.source（company / user）
    // 契约 §5.5 加法 ①：缩略图命名 b<assetId>.png（通用库），id 刻意**从 1 起**
    groups: [
      {
        id: 1,
        name: "公司素材",
        sortOrder: 0,
        assets: [
          {
            id: 1,
            name: "品牌标识.png",
            ext: "png",
            kind: "image",
            role: "素材",
            size: 24000,
            width: 1024,
            height: 1024,
            versionId: null,
            thumb: "thumb/b1.png",
            missing: false,
            modifiedAt: "2026-09-01T09:00:00+08:00",
            absPath: "D:\\vellum_brand\\品牌标识.png",
            tags: ["Logo"],
            source: "company",
          },
          {
            id: 2,
            name: "竖版海报模板.png",
            ext: "png",
            kind: "image",
            role: "素材",
            size: 180000,
            width: 1080,
            height: 1440,
            versionId: null,
            thumb: "thumb/b2.png",
            missing: false,
            modifiedAt: "2026-09-02T09:00:00+08:00",
            absPath: "D:\\vellum_brand\\竖版海报模板.png",
            tags: ["模板"],
            source: "company",
          },
        ],
      },
      {
        id: 2,
        name: "我的收藏",
        sortOrder: 1,
        assets: [
          {
            id: 3,
            name: "收集-纸张纹理.png",
            ext: "png",
            kind: "image",
            role: "未归属",
            size: 62000,
            width: 1920,
            height: 1200,
            versionId: null,
            thumb: "thumb/b3.png",
            missing: false,
            modifiedAt: "2026-10-01T15:00:00+08:00",
            absPath: "D:\\vellum_brand\\收集\\纸张纹理.png",
            tags: ["纹理"],
            source: "user",
          },
        ],
      },
      {
        id: 11,
        name: "节日素材",
        sortOrder: 0,
        parentId: 1, // ← 加法 ③：这是「公司素材」的**子组**
        assets: [
          {
            id: 4,
            name: "中秋主视觉.png",
            ext: "png",
            kind: "image",
            role: "素材",
            size: 264000,
            width: 2480,
            height: 3508,
            versionId: null,
            thumb: "thumb/b4.png",
            missing: false,
            modifiedAt: "2026-09-20T09:00:00+08:00",
            absPath: "D:\\vellum_brand\\节日\\中秋主视觉.png",
            tags: ["节日", "中秋"],
            source: "company",
          },
        ],
      },
    ],
  };
}

/**
 * **纯函数**：给定 manifest 路径与自身身份，判断"能不能写"。
 * 抽成纯函数是为了**能被测**（本环境起不了子进程：`spawnSync` 报 EBUSY），
 * 于是"拒绝覆盖"这件事靠两个东西守住：① 这个函数的单测；② 源码级确认两条写路径都调了它。
 * @returns {{ok:true, reason?:string} | {ok:false, reason:"foreign", prev:object|null}}
 */
function canWrite(manifestPath, force) {
  if (force) return { ok: true, reason: "forced" };
  if (!fs.existsSync(manifestPath)) return { ok: true, reason: "fresh" };
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    prev = null; // 解析不了（可能正被真软件写着）→ 按"不是我们的"处理，更安全
  }
  const ours = !!(prev && prev.generator && prev.generator.fixture === true);
  if (ours) return { ok: true, reason: "ours" };
  return { ok: false, reason: "foreign", prev: prev };
}

/* ---------- 安全闸：绝不覆盖"真软件"写出来的镜像 ----------
 * 为什么必须有这道闸（2026-10-11 加）：真 VellumDesk 已经上线写镜像了，
 * 而这台机器上**真镜像和假镜像躺在同一个目录**。以前本桩是"随手一跑"，
 * 现在同一句命令会**把用户的真镜像（真项目/真素材/真缩略图）整个换成 fixture**——
 * 而且它看起来"成功"了，最难发现。
 * 识别方式：本桩写出的 manifest 带 `generator.fixture = true`；真软件的不带。
 * 要强行覆盖必须显式 `--force`（`--clean` 同样受此闸保护）。 */
function assertNotClobbering() {
  const man = path.join(LIB, "manifest.json");
  const v = canWrite(man, FORCE);
  if (v.ok) return;
  console.error("");
  console.error("✗ 拒绝覆盖：现有 manifest.json 不是本桩写的（缺 generator.fixture=true）。");
  console.error("  那意味着 **VellumDesk 真软件**已经往这里写过镜像了：");
  console.error("  " + man);
  console.error("  （generator=" + JSON.stringify(v.prev && v.prev.generator ? v.prev.generator : null) + "）");
  console.error("");
  console.error("  本桩会把整个 library/ 换成 fixture —— 真项目/真素材会一起没。");
  console.error("  真要覆盖：node tools/fake-vellumdesk.cjs --force");
  console.error("  只想清空：node tools/fake-vellumdesk.cjs --clean   （⚠️ 同样会删掉真镜像，所以也要 --force）");
  process.exit(3);
}

/* ---------- 落盘 ---------- */
function writeJson(file, obj) {
  fs.writeFileSync(path.join(LIB, file), JSON.stringify(obj, null, 2) + "\n", { encoding: "utf8" });
}

function main() {
  if (CLEAN) {
    assertNotClobbering();
    fs.rmSync(LIB, { recursive: true, force: true });
    console.log("已清掉镜像目录：" + LIB);
    return;
  }

  assertNotClobbering();

  fs.mkdirSync(path.join(LIB, "thumb"), { recursive: true });
  fs.mkdirSync(path.join(LIB, "handoff"), { recursive: true }); // 契约 §六：软件侧预建

  // 清掉上一版遗留的缩略图（本桩换过命名空间：401.png → t401.png）。
  // ⚠️ 只动 `thumb/` 下、且看起来就是缩略图的文件 —— 别的目录一律不碰。
  const keep = {};
  for (const t of THUMBS) keep[t.file] = true;
  for (const name of fs.readdirSync(path.join(LIB, "thumb"))) {
    if (keep[name]) continue;
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    fs.rmSync(path.join(LIB, "thumb", name), { force: true });
    console.log("  （清掉遗留缩略图 " + name + "）");
  }

  for (const t of THUMBS) {
    fs.writeFileSync(path.join(LIB, "thumb", t.file), solidPng(t.w, t.h, hex2rgb(t.color)));
  }

  writeJson("manifest.json", manifestJson());
  writeJson("task.json", taskJson());
  writeJson("brand.json", brandJson());

  const total = THUMBS.reduce((s, t) => s + fs.statSync(path.join(LIB, "thumb", t.file)).size, 0);
  console.log("假 VellumDesk 镜像已写入（契约合规）：");
  console.log("  " + LIB);
  console.log("  manifest.json   scopes: task(rev " + TASK_REV + ") / brand(rev " + BRAND_REV + ")  psMajor=" + PS_MAJOR);
  console.log("  task.json       2 个项目 / 2 个任务包 / 各 V1 / 3 个素材（id 401/402/403）");
  console.log("  brand.json      两级分组：公司素材(2) › 节日素材(1) ／ 我的收藏(1)　来源 company 3 / user 1");
  console.log("  thumb/          " + THUMBS.length + " 张 PNG 命名空间命名（共 " + total + " 字节）");
  console.log("  handoff/        已预建（req.json 由插件写，本桩不碰）");
}

// ⚠️ 只有**被直接执行**时才跑 main —— 被 `require`（离线回归要测 `canWrite`）时不跑。
//    否则 require 一次就会真的把镜像写掉。
if (require.main === module) main();

module.exports = { canWrite, main };
