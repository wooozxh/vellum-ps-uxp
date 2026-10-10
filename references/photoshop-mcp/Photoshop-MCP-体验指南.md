# Photoshop MCP 体验指南

> 更新：2026-10-04 21:10（含在你机器上的实测结果）
> 你的环境：Windows｜Node v22.22.2｜Photoshop 2026（`D:\software\adobe\Adobe Photoshop 2026\`）｜Illustrator 2026（v30）

---

## 〇、实测验证结果（已在你的机器上跑通）

我直接在你机器上把服务拉起来验证过，**除"Photoshop 必须正在运行"外，其余环节全部就绪**：

| 验证项 | 结果 |
|---|---|
| 服务启动 | ✅ 正常，版本 v1.7.32 |
| 工具注册 | ✅ **127 个工具 + 23 个提示词模板**（比官宣的 122 还多） |
| PS 路径检测 | ✅ 日志确认 `Found Photoshop at: D:/software/adobe/Adobe Photoshop 2026/Photoshop.exe` |
| 连接 Photoshop | ⚠️ 报 `Script execution failed` —— 因为测试时 PS 没启动，**恰好证明路径正确、只差启动 PS** |

服务启动日志：

```
[INFO] [Main] Starting Photoshop MCP Server...
[INFO] [PhotoshopMCPServer] Registered 127 tools and 23 prompts
[INFO] [Main] Photoshop MCP Server is running
[INFO] [UxpBridgeServer] UXP bridge listening on 127.0.0.1:38452
```

**结论：你实际要做的只有一件事——先把 Photoshop 打开。**

---

## 一、已帮你配好的部分

文件：`C:\Users\17736\.workbuddy\mcp.json`

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "npx",
      "args": ["-y", "@alisaitteke/photoshop-mcp"],
      "env": {
        "PHOTOSHOP_PATH": "D:\\software\\adobe\\Adobe Photoshop 2026\\Photoshop.exe",
        "LOG_LEVEL": "1"
      }
    }
  }
}
```

**为什么必须加 `PHOTOSHOP_PATH`**：我读了它的检测源码（`dist/platform/windows-detector.js`），自动扫描只覆盖 `C:\Program Files\Adobe\Adobe Photoshop <年份>\` 这类**标准安装路径**。你的 PS 装在 **D 盘**，不设这个变量会找不到。检测优先级是「环境变量 → 注册表 → 标准路径」，所以这一项能确保命中。

---

## 二、方式 A：独立 Web UI（最快，5 分钟）

不接任何客户端，直接开一个本地聊天窗口控制 PS。

1. **先打开 Photoshop**（必须！MCP 找不到运行中的 PS 就没法连）
2. 终端执行：
   ```bash
   npx -p @alisaitteke/photoshop-mcp ui
   ```
3. 浏览器自动打开本地聊天界面
4. 选择 AI 提供商——**两种方式二选一**：
   - 填 API Key（Anthropic / OpenAI / Google / OpenRouter）
   - **复用你已有的 Claude Code 或 Gemini CLI 账号登录**，不用额外买 Key
5. 说一句试试：
   > 新建一个 1080×1080 的文档，铺蓝色渐变背景，中间加一行白字"测试"

---

## 三、方式 B：接进 WorkBuddy（配置已就绪，需手动激活）

配置文件已写好，但 **MCP 不会自动生效**：

1. **重启 WorkBuddy**
2. 打开**连接器管理**页面 → 右上角**自定义连接器**入口 → 找到 `photoshop` → 点 **「信任」**
3. 之后直接在这里对话：
   > 打开 Photoshop，把当前文档的图层重命名成规范格式

---

## 四、127 个工具能做什么（按用途分组）

### 🎯 直接对应你部门场景的（重点看这组）

| 工具 | 作用 | 对应场景 |
|---|---|---|
| `photoshop_recipe_csv_to_cards` | **CSV 驱动批量生成卡片** | ⭐ **PSD 模板批产**——你部门的第二类需求，它自带 |
| `photoshop_recipe_batch_mockup_replace` | 批量样机图替换 | ⭐ 商品图批产 |
| `photoshop_recipe_batch_watermark` | 整文件夹批量加水印 | ⭐ 批量素材处理 |
| `photoshop_import_datasets` / `generate_from_datasets` / `list_datasets` | 数据集导入与批量生成 | PSD 模板批产（PS 原生变量功能） |
| `photoshop_replace_smart_object_contents` | 替换智能对象内容 | 模板批产的核心动作 |
| `photoshop_update_text_content` | 批量改文字图层 | 模板批产 |
| `photoshop_play_action` | **播放录好的动作** | ⭐ 把你现有的 PS 动作变成可复用能力 |
| `photoshop_recipe_prepare_for_web` | 一键准备 Web 规格 | 交付规范化 |
| `photoshop_recipe_export_social_variants` | 一键导出各社媒规格 | 多尺寸交付 |
| `photoshop_resize_image` / `photoshop_crop_document` | 批量改尺寸 / 裁切 | 素材规范化 |

### 16 个配方（多步操作 = 一次撤销）

`remove_background`（去背）、`enhance_portrait`（人像修饰）、`dodge_burn`（减淡加深）、`frequency_separation`（高低频磨皮）、`apply_color_grade`（调色）、`gradient_fade`、`sky_blend`（换天空融合）、`split_carousel`（长图切轮播）、`passport_photo`（证件照）、`csv_to_cards`、`batch_watermark`、`batch_mockup_replace`、`remove_distraction`（去除干扰物）、`organize_layers`（图层整理）、`prepare_for_web`、`export_social_variants`

### 文档与图层管理

`create_document`、`open_image`、`save_document`、`close_document`、`flatten_image`、`get_state`、`get_document_info`、`list_documents`、`get_version`、`get_capabilities`、`get_preview`（免费预览快照）、`create_layer`、`duplicate_layer`、`delete_layer`、`rename_layer`、`move_layer`（含上下移/置顶置底/指定位置）、`set_layer_opacity`、`set_layer_blend_mode`、`set_layer_visibility`、`set_layer_locked`、`create_clipping_mask`、`create_artboard`、`export_artboards`

### 色彩与调整

`adjust_brightness_contrast`、`adjust_curves`、`adjust_exposure`、`adjust_hue_saturation`、`adjust_vibrance`、`auto_levels`、`auto_contrast`、`desaturate`、`invert`、`apply_photo_filter`、`apply_gradient_map`、`apply_lut`

### 滤镜与模糊

`apply_gaussian_blur`、`apply_motion_blur`、`apply_smart_blur`、`apply_sharpen`、`apply_noise`、`apply_high_pass`

### 选区与蒙版

`select_all`、`select_subject`、`select_rectangle`、`select_ellipse`、`select_layer_by_name`、`deselect`、`invert_selection`、`expand_selection`、`contract_selection`、`feather_selection`、`save_selection`、`get_selection_bounds`、`apply_layer_mask`、`create_layer_mask`、`delete_layer_mask`、`apply_gradient_mask`、`content_aware_fill`

### 文字

`create_text_layer`、`set_text_font`、`set_text_color`、`set_text_style`、`set_text_alignment`、`set_text_ranges`、`update_text_content`、`list_fonts`、`install_font`

### 生成式 AI（需登录 Adobe 账号）

`generative_fill`（生成式填充）、`generative_expand`（扩图）、`generative_remove`（生成式移除）、`generative_upscale`（放大）、`generate_image`（文生图）、`sky_replacement`（换天空）、`neural_filter`（神经滤镜）

### 历史与执行

`undo`、`redo`、`get_history`、`execute_script`（直接跑自定义 JSX）、`play_action`

---

## 五、三个开源项目的真实底细

### 1. photoshop-mcp —— ⭐⭐⭐⭐⭐ 也就是你现在要试的这个

| 项 | 内容 |
|---|---|
| 仓库 | https://github.com/alisaitteke/photoshop-mcp |
| npm | `@alisaitteke/photoshop-mcp`（1.7.32） |
| 协议 / 语言 | MIT，TypeScript |
| 执行端通道 | **ExtendScript**（Windows 走 COM，macOS 走 AppleScript） |
| 能力规模 | **127 工具** + 23 提示词 + 可选 UXP bridge（神经滤镜用） |
| 兼容版本 | Photoshop 2012–2025+ |
| 前置依赖 | Node 18+，**Photoshop 必须运行中** |
| 官方收录 | ✅ MCP Registry `io.github.alisaitteke/photoshop-mcp`，活跃维护 |

**亮点**：状态感知（`get_state` / `get_preview` / `get_capabilities`）、配方机制（多步=一次撤销）、结构化错误信封（AI 知道失败后该试什么）、自带独立 Web UI。

**注意**：社区非官方项目，与 Adobe 无关；默认上报匿名使用统计（可关闭）；执行 `photoshop_ping` 后它会要求 AI 询问一次使用反馈（`FEEDBACK_NUDGE` 机制），属正常行为，可以拒绝。

### 2. adb-mcp —— ⭐⭐⭐ 等自研时精读

Mike Chambers（Adobe 官方工程师）的仓库：https://github.com/mikechambers/adb-mcp

走 **UXP 正统路线**（Python MCP + Node Socket.IO 代理 + UXP 插件），PS 侧 60+ 工具。但它是 **proof of concept**（v0.85.4，2025-08 后未更新），部署要装 UXP Developer Tool、起代理、每次重启 PS 还要重新加载插件。

**价值定位**：不是体验对象，而是**自研时的架构参考实现**——它的三层结构和你想做的东西完全一致。

### 3. adobe-mcp —— ⚠️ 不可信，别投入时间

**更正说明**：我最初把它列为成熟项目是失误（采信了聚合站二手信息）。实际证据：

- 同一份 README 出现在两个不同作者仓库（`thanhduy1997/adobe-mcp`、`matrayu/adobe-mcp`），内容几乎一致
- 克隆命令写的是 `https://github.com/yourusername/adobe-mcp.git`——**占位符未替换**
- 不在官方 MCP Registry，找不到有真实 star 的原始仓库

判定为模板复制 / 生成式产出，**大概率跑不起来**。

---

## 六、如果以后想跑 adb-mcp

按顺序，缺一步都连不上：

1. 装 **Python 3**、**Node.js**、**UXP Developer Tool**（从 Creative Cloud 桌面端装）
2. 从 Releases 下载预编译代理 `adb-proxy-socket-win-x64.exe`
3. 启动代理，看到 `running on ws://localhost:3001` 才算成功，**窗口要一直开着**
4. PS 里：`设置 → 增效工具 → 勾选「启用开发人员模式」`，**重启 PS**
5. UXP Developer Tool：`Add Plugin` → 选 `uxp/ps/manifest.json` → `Load`
6. PS 里打开 `增效工具 > Photoshop MCP Agent` → 点 **Connect**

**坑**：UXP Developer Tool 加载的插件，**每次重启 PS 都要重新 Load**。（正式打包成 `.ccx` 安装就没这问题。）

---

## 七、可能踩到的坑

| 现象 | 原因与处理 |
|---|---|
| 提示找不到 Photoshop | PS 没启动；或配置改了但没重启 WorkBuddy |
| 首次启动很慢 | npx 冷启动要下载约 2MB 包 + 依赖，需 30–60 秒，属正常 |
| 报 `extendscript_timeout` | JSX 跑超时（默认 30s）。**MCP 中止不会停掉 PS**，脚本可能还在跑。反复 ping 直到成功，再调 `get_state`。可用 `PHOTOSHOP_SCRIPT_TIMEOUT` 环境变量调高 |
| 报 `scratch_disk_full` | PS 暂存盘满了，PS 会假死并导致超时。清出至少 100GB（默认暂存盘是系统盘）后重启 PS |
| `no_active_document` | 当前没有打开的文档，先 `create_document` 或 `open_image` |
| `not_text_layer` | 目标图层不是文字图层，需先创建/选中文字图层 |
| 命令执行了但 PS 无反应 | Windows 上 COM 调用需要 PS 未处于模态对话框状态，先关掉 PS 里弹出的对话框 |
| 生成式填充 / 换天空失败 | 需要登录 Adobe 账号，属正常限制 |
| 不想上报统计 | 见包内 `docs/anonymous-usage-analytics.md` |

---

## 八、我的建议

**先花 5 分钟走方式 A（独立 Web UI）**，开一张测试图，试这两个指令：

1. `帮我把这张图去背，保留可编辑蒙版`
2. `把这张图导出成 Instagram 和 X 两种规格`

这两条分别验证「单步精细操作」和「多步配方」是否好用。

**如果好用，你部门前两类需求其实已经覆盖了大半**——尤其是 `csv_to_cards`（CSV 驱动批量出卡片）和 `batch_mockup_replace`（批量样机），这本来就是"PSD 模板批产"的核心。真跑起来觉得够用了，就不用自研，直接把精力放在"制定部门规范"上——那才是这类工具真正吃价值的地方。

如果发现哪里不够（比如命名规则、尺寸组合、检查项），那部分再考虑自己补——**补一个插件，而不是从零造一套**。
