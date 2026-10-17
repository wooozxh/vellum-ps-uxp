/*
 * tools/index.js —— 工具注册表（架构核心）
 * ===========================================================================
 * 外壳只认这张表。加第 5、6 个工具 = 新增一个模块文件 + 在下面数组里加一行，
 * **外壳零改动**（docs/10 §2.3）。
 *
 * 工具模块必须导出统一描述符：
 *   {
 *     id:       "palette",              // 唯一，外壳用它做路由
 *     title:    "调色板",                // 首页行标题
 *     subtitle: "品牌色 / 我的颜色",       // 首页行副标题
 *     badge:    "M1",                    // 可选：角落标记
 *     ready:    true,                    // false = 首页显示为「未上」的灰行
 *     mount(container, ctx) {},          // 把自己的界面画进 container
 *     unmount() {}                       // 解绑事件、停计时器（必须实现）
 *   }
 *
 * 首页各项的顺序即下面 tools + planned 的拼接顺序，外壳按顺序发「↑1…↑N」号位。
 */

const palette = require("./palette.js");
const library = require("./library.js");
const table = require("./table.js");
const inspect = require("./inspect.js");
const review = require("./review.js");
const newdoc = require("./newdoc.js");

/** 已实现的工具（首页可点）。 */
const tools = [palette, library, table, inspect, review, newdoc];

/**
 * 规划中的工具（首页显示为灰行，点了给提示）。
 * 注意：这里**不放实现**，只是占位。
 *
 * ⚠️ 顺序即首页号位 ↑1…↑N，**由外壳按 tools + planned 的拼接顺序发**。
 *    `planned` 里加/删行不会影响任何自检：S11 的期望行数是**动态取** allRows().length 的。
 */
const planned = [
  {
    id: "mcp",
    title: "AI-MCP",
    subtitle: "AI 驱动 PS（方向待定案）",
    badge: "M4",
    note: "M4（待排期，**方向待定案**）。候选方向 = 「**AI 驱动 PS**」（AI 客户端经 MCP 操作 PS）。" +
      "⚠️ 本条 note 原写「把**插件的动作**暴露成 MCP 工具」—— 与上述方向**相反**，" +
      "已于 2026-10-17 更正留痕（见 docs/49 §3.4）。两条硬事实：**MCP ≠ AI**" +
      "（MCP 只是工具服务器，智能在客户端）；**MCP 代码搬不进插件**（走 ExtendScript/COM，" +
      "与 UXP 是两套宿主接口，只能重写不能搬运）。**定案前不要按任何一方实现。**",
  },
];

function byId(id) {
  for (const t of tools) if (t.id === id) return t;
  return null;
}

/** 首页渲染顺序（已实现 + 规划中），外壳用它发号位。 */
function allRows() {
  return tools.concat(planned);
}

module.exports = { tools, planned, byId, allRows };
