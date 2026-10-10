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
 * 首页四项的顺序即下面 tools + planned 的拼接顺序，外壳按顺序发「↑1…↑4」号位。
 */

const palette = require("./palette.js");

/** 已实现的工具（首页可点）。 */
const tools = [palette];

/**
 * 规划中的工具（首页显示为灰行，点了给提示）。
 * 注意：这里**不放实现**，只是占位。
 * 名称与副标题按用户 2026-10-10 的指定（「表格生成」「AI-MCP」）。
 */
const planned = [
  {
    id: "assets",
    title: "素材库",
    subtitle: "本地与云端素材，可筛选后批量置入",
    badge: "M2",
    note: "M2 开工。路线已定：VellumDesk 把镜像写进插件数据目录，插件只读自己的目录。",
  },
  {
    id: "table",
    title: "表格生成",
    subtitle: "表格绑定图层，批量出稿",
    badge: "M3",
    note: "M3 开工。重绘形态已定：每格一个文字图层 + 矢量线条，插入后可继续编辑。",
  },
  {
    id: "mcp",
    title: "AI-MCP",
    subtitle: "把面板能力开放给 AI 客户端",
    badge: "M4",
    note: "M4（待排期）。目标：把插件的动作暴露成 MCP 工具，让 AI 客户端能直接调用。",
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
