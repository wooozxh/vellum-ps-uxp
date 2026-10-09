/*
 * Hello UXP —— 环境冒烟测试 + 自检报告
 * ===========================================================================
 * 这个插件有双重身份：
 *   1. 给人看：面板上几个按钮，点一下就知道哪条链路通。
 *   2. 给 AI 看：把自检结果写成 report.json 落到插件自己的数据目录，
 *      外部脚本（tools/report.mjs）读这个文件就能拿到结论。
 *
 * 为什么非要落盘？因为 UXP 跑在 Photoshop 进程里，console.log 只会进
 * UDT 的调试窗口，外部的脚本/CI 拿不到。文件是唯一稳定、可断言的反馈通道。
 *
 * 自动触发（关键设计）：
 *   插件目录下若存在文件 `autorun.flag`，则插件的 entrypoint 注册完成后
 *   自动跑一遍全量自检并写报告。于是「重载插件」= 「跑一次测试」，
 *   全程不需要点面板。想关掉就删掉那个 flag 文件。
 *   控制开关放文件而不是代码，是为了让外部工具（我）能一键切换。
 *
 * UXP 硬约束提醒（写给以后改这份代码的人/模型）：
 *   - 不是浏览器、也不是 Node：引宿主模块必须 require()，不能 import。
 *   - 改文档的操作必须包在 core.executeAsModal() 里，否则报"模态被占用"。
 *   - DOM API 覆盖不到的动作，走 action.batchPlay() 发 ActionDescriptor。
 */

const photoshop = require("photoshop");
const uxp = require("uxp");

const { app, core, action } = photoshop;
const { entrypoints, storage } = uxp;
const lfs = storage.localFileSystem;

// ⚠️ 必须与 manifest.json 的 id 保持一致（两者任一改动都要同步另一处）
const PLUGIN_ID = "com.wooozxh.hellouxp";
const PLUGIN_VERSION = "1.0.0";
const REPORT_NAME = "report.json";
const FLAG_NAME = "autorun.flag";

/* ==================================================================== 工具 */

function setStatus(text) {
  const el = document.getElementById("log");
  if (el) el.textContent = String(text);
  console.log("[HelloUXP]", text);
}

/** 修改文档必须走模态作用域。 */
function runModal(fn, commandName) {
  return core.executeAsModal(fn, { commandName: commandName });
}

function nowIso() {
  const d = new Date();
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

/* ============================================================== 自检用例 */

/**
 * 每个用例返回 { ok, detail?, error? }。
 * 用例之间相互独立，单个失败不影响其它用例继续跑。
 */
const CHECKS = [
  {
    name: "宿主连接（photoshop 模块）",
    async run() {
      const name = app.name;
      const version = app.version;
      if (!name) throw new Error("app.name 为空");
      return {
        detail:
          "宿主：" + name + "\n" + "版本：" + version
      };
    }
  },
  {
    name: "UXP 运行时版本",
    async run() {
      let v = "未知";
      try {
        v = (uxp.versions && uxp.versions.uxp) || "未暴露";
      } catch (e) {
        v = "读取失败：" + e.message;
      }
      let host = "未知";
      try {
        host = (uxp.versions && uxp.versions.plugin) || "未暴露";
      } catch (e) {
        /* 忽略 */
      }
      return { detail: "UXP：" + v + "\n插件运行时：" + host };
    }
  },
  {
    name: "executeAsModal（模态作用域）",
    async run() {
      let executed = false;
      await runModal(async () => {
        executed = true;
      }, "Hello UXP 自检：模态");
      if (!executed) throw new Error("回调未被执行");
      return { detail: "模态事务可正常开启与提交" };
    }
  },
  {
    name: "文件系统 getDataFolder（报告通道）",
    async run() {
      const folder = await lfs.getDataFolder();
      if (!folder) throw new Error("getDataFolder() 返回空");
      return { detail: "数据目录：" + folder.nativePath };
    }
  },
  {
    name: "读取插件自身目录（localFileSystem: plugin 权限）",
    async run() {
      const folder = await lfs.getPluginFolder();
      if (!folder) throw new Error("getPluginFolder() 返回空");
      const entries = await folder.getEntries();
      return {
        detail:
          "插件目录：" +
          folder.nativePath +
          "\n" +
          "条目数：" +
          entries.length +
          "（" +
          entries
            .slice(0, 6)
            .map((e) => e.name)
            .join(", ") +
          "）"
      };
    }
  },
  {
    name: "autoRun 开关文件（autorun.flag）",
    async run() {
      const folder = await lfs.getPluginFolder();
      let present = false;
      try {
        await folder.getEntry(FLAG_NAME);
        present = true;
      } catch {
        present = false;
      }
      return {
        detail: present
          ? "存在 → 插件每次加载都会自动跑自检"
          : "不存在 → 只在手动点按钮时跑（想自动跑就新建一个 " + FLAG_NAME + "）"
      };
    }
  },
  {
    name: "DOM API + batchPlay + 文档读写（端到端）",
    async run() {
      const created = !app.activeDocument;
      let doc = app.activeDocument;

      // 1) 没有文档就建一个临时文档，跑完再关掉，避免污染用户的工作区
      if (created) {
        await runModal(async () => {
          doc = await app.createDocument({
            width: 512,
            height: 512,
            resolution: 72,
            name: "HelloUXP-smoketest"
          });
        }, "Hello UXP 自检：新建临时文档");
      }

      // 2) batchPlay 读一下图层数（只读，无副作用）
      const layersBefore = doc.layers.length;
      let viaBatchPlay = null;
      await runModal(async () => {
        const res = await action.batchPlay(
          [
            {
              _obj: "get",
              _target: [
                { _property: "numberOfLayers" },
                { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
              ]
            }
          ],
          {}
        );
        viaBatchPlay = res && res[0] ? res[0].numberOfLayers : null;
      }, "Hello UXP 自检：batchPlay");

      // 3) 建一个图层，验证写操作
      await runModal(async () => {
        await action.batchPlay(
          [
            {
              _obj: "make",
              _target: [{ _ref: "layer" }],
              using: { _obj: "layer", name: "HelloUXP-test-layer" }
            }
          ],
          {}
        );
      }, "Hello UXP 自检：新建图层");

      const layersAfter = app.activeDocument.layers.length;
      if (layersAfter !== layersBefore + 1) {
        throw new Error(
          "图层数未按预期增加：" + layersBefore + " → " + layersAfter
        );
      }

      // 4) 收尾：临时文档关掉，不留痕迹
      let cleanup = "沿用了你已打开的文档（未做清理）";
      if (created) {
        await runModal(async () => {
          await app.activeDocument.closeWithoutSaving();
        }, "Hello UXP 自检：关闭临时文档");
        cleanup = "临时文档已关闭，未留痕迹";
      }

      return {
        detail:
          "文档：" +
          (created ? "临时创建 512×512" : "沿用当前打开的文档") +
          "\n" +
          "图层数：" +
          layersBefore +
          " → " +
          layersAfter +
          "（DOM API 读到）\n" +
          "batchPlay 读到 numberOfLayers = " +
          viaBatchPlay +
          "\n" +
          cleanup
      };
    }
  }
];

/* ============================================================ 跑自检 */

async function runSelfTest(trigger) {
  setStatus("正在跑自检（" + trigger + "）…");
  const started = Date.now();
  const results = [];

  for (const check of CHECKS) {
    const t0 = Date.now();
    try {
      const out = (await check.run()) || {};
      results.push({
        name: check.name,
        ok: true,
        ms: Date.now() - t0,
        detail: out.detail || ""
      });
    } catch (e) {
      results.push({
        name: check.name,
        ok: false,
        ms: Date.now() - t0,
        detail: "",
        error: (e && e.message ? e.message : String(e)) + ""
      });
    }
  }

  const pass = results.filter((r) => r.ok).length;

  let hostInfo = {};
  try {
    hostInfo = { name: app.name, version: app.version };
  } catch {
    /* 忽略 */
  }
  let uxpVersion = null;
  try {
    uxpVersion = (uxp.versions && uxp.versions.uxp) || null;
  } catch {
    /* 忽略 */
  }
  let dataPath = null;
  try {
    dataPath = (await lfs.getDataFolder()).nativePath;
  } catch {
    /* 忽略 */
  }

  const report = {
    plugin: PLUGIN_ID,
    version: PLUGIN_VERSION,
    at: nowIso(),
    trigger: trigger,
    host: hostInfo,
    uxp: uxpVersion,
    dataFolder: dataPath,
    durationMs: Date.now() - started,
    ok: pass === results.length,
    summary: pass + "/" + results.length + " 通过",
    results: results
  };

  // ---- 落盘：这是给外部脚本读的唯一交付物 ----
  let reportPath = null;
  let writeError = null;
  try {
    const folder = await lfs.getDataFolder();
    const file = await folder.createFile(REPORT_NAME, { overwrite: true });
    await file.write(JSON.stringify(report, null, 2));
    reportPath = file.nativePath;
  } catch (e) {
    writeError = e && e.message ? e.message : String(e);
  }

  // ---- 给人看的输出 ----
  const lines = [
    report.summary + "    " + (report.ok ? "OK" : "FAIL"),
    ""
  ];
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    const head = mark + " " + r.name + "  (" + r.ms + "ms)";
    lines.push(head);
    if (r.detail) {
      r.detail.split("\n").forEach((l) => lines.push("    " + l));
    }
    if (!r.ok && r.error) lines.push("    ⚠ " + r.error);
  }
  lines.push("");
  lines.push(
    reportPath
      ? "报告已写入：\n" + reportPath
      : "报告写入失败：" + writeError
  );
  setStatus(lines.join("\n"));

  // 顺便把结论也打到 console，方便 UDT Debug 控制台看
  console.log(
    "[HelloUXP] 自检完成 " + report.summary + (report.ok ? " OK" : " FAIL")
  );

  return report;
}

/* ================================================================ UI */

let uiBound = false;

function bindUI() {
  if (uiBound) return;
  const map = {
    btnDoc: async () => {
      try {
        await runModal(async () => {
          const doc = await app.createDocument({
            width: 1200,
            height: 1200,
            resolution: 72
          });
          setStatus(
            "✓ 已新建文档\n名称：" +
              doc.name +
              "\n尺寸：" +
              Math.round(doc.width) +
              " × " +
              Math.round(doc.height) +
              " px"
          );
        }, "Hello UXP：新建文档");
      } catch (e) {
        setStatus("✗ 新建文档失败：" + e.message);
      }
    },
    btnInfo: () => {
      try {
        const doc = app.activeDocument;
        if (!doc) {
          setStatus("当前没有打开的文档，先点「新建文档」。");
          return;
        }
        setStatus(
          "✓ 当前文档\n名称：" +
            doc.name +
            "\n尺寸：" +
            Math.round(doc.width) +
            " × " +
            Math.round(doc.height) +
            " px\n图层数：" +
            doc.layers.length
        );
      } catch (e) {
        setStatus("✗ 读取失败：" + e.message);
      }
    },
    btnSelftest: () => runSelfTest("button"),
    btnReload: async () => {
      const folder = await lfs.getPluginFolder();
      let present = false;
      try {
        await folder.getEntry(FLAG_NAME);
        present = true;
      } catch {
        present = false;
      }
      setStatus(
        present
          ? "autorun.flag 已存在 —— 每次加载插件都会自动跑自检。\n删掉这个文件即可关闭。\n\n文件位置：\n" +
              folder.nativePath +
              "\\" +
              FLAG_NAME
          : "autorun.flag 不存在 —— 只在点按钮时跑。\n想改为自动跑，就在插件目录下新建一个空文件：\n" +
              folder.nativePath +
              "\\" +
              FLAG_NAME
      );
    }
  };

  let found = 0;
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", map[id]);
      found++;
    }
  });
  if (found > 0) uiBound = true;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}

/* ============================================================ 入口点 */

entrypoints.setup({
  plugin: {
    async create() {
      setStatus("插件已加载 ✓\n正在检查是否开启了自动自检…");
      try {
        const folder = await lfs.getPluginFolder();
        let auto = false;
        try {
          await folder.getEntry(FLAG_NAME);
          auto = true;
        } catch {
          auto = false;
        }
        if (auto) {
          await runSelfTest("autorun");
        } else {
          setStatus(
            "插件已加载 ✓\n\n未开启自动自检（插件目录下没有 " +
              FLAG_NAME +
              "）。\n点「运行自检并写报告」手动跑一次。"
          );
        }
      } catch (e) {
        setStatus("加载后自检失败：" + (e && e.message ? e.message : e));
      }
    }
  },
  panels: {
    helloPanel: {
      create() {
        bindUI();
      },
      show() {
        bindUI();
      }
    }
  },
  commands: {
    helloCommand: {
      async run() {
        await runSelfTest("command");
      }
    }
  }
});
