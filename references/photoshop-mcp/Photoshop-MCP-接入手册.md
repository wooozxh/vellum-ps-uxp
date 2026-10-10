# photoshop-mcp 接入手册

> **本文档的读者是 AI 助手。** 如果你正在读这份文件，说明你的使用者想让你接入并驱动本机的 Adobe Photoshop。
> 请按本文档操作或指导使用者操作。所有事实均来自本机实测，不是二手转述。
> 文档版本对应服务端 `@alisaitteke/photoshop-mcp@1.7.34`，实测时间 2026-10-10。

---

## 0. 先读这一段（关键认知）

在你尝试任何"连接"动作之前，必须理解这条**硬约束**：

**Photoshop 是一个封闭的 GUI 应用，它没有对外监听通用命令的网络接口。**
任何 AI 想要控制 PS，都只能通过 **PS 自带的脚本引擎**（ExtendScript / AppleScript / COM）。
因此本 MCP 的工作方式是：

```
AI 客户端  ──stdio(JSON-RPC)──>  photoshop-mcp 进程  ──COM/AppleScript──>  ExtendScript  ──>  Photoshop
```

推论，请务必记住：

1. **Photoshop 必须处于运行状态。** 本 MCP 不会替你启动 PS，也不会在没有 PS 时报错退出——它只会返回失败。
2. **不需要在 Photoshop 里装任何插件**（这是它比 Pr/AE 方案省事的原因）。
3. **AI 与 PS 的每一次交互都要经过脚本队列，是串行的。** 上一条脚本没跑完，下一条会超时。
4. 你（AI）**不需要也不应该**尝试写原生 COM 调用或自己实现协议——直接调用本 MCP 暴露的工具即可。

---

## 1. 事实卡

```yaml
package: "@alisaitteke/photoshop-mcp"
version_tested: "1.7.34"
install: "无需安装（npx 按需拉取）"
runtime_required: "Node.js >= 18"
backend_required: "Photoshop 桌面版（Windows 或 macOS，2012+ 任意版本），且必须正在运行"
transport: "stdio (MCP JSON-RPC 2.0)"
tools_total: 127        # 111 原子 + 16 配方
prompts_total: 23
readonly_tools: 10      # 可安全随机调用
destructive_tools: 43   # 会改像素/删图层/写磁盘
default_export_dir: "~/.photoshop-mcp/exports"
license: "MIT"
registry: "官方 MCP Registry 已收录"
repo: "https://github.com/alisaitteke/photoshop-mcp"
```

**能力定位**：它不是"用嘴操作 Photoshop"，它是一条**可编程的、可批量化的 PS 自动化通道**。最强的部分是把多步操作打包成"一次撤销"的 **recipe（配方）**，以及复用设计师已录好的 Action。

---

## 2. 本机实测环境（2026-10-10 复核）

```yaml
machine: "Windows"
node: "v22.22.2"
photoshop:
  product: "Adobe Photoshop 2026"
  exe: "D:\\software\\adobe\\Adobe Photoshop 2026\\Photoshop.exe"
  note: "安装在 D 盘，非默认路径 —— 这点很关键，见第 3.3 节"
workbuddy_mcp_config: "C:\\Users\\17736\\.workbuddy\\mcp.json"
```

**实测结论**：
- 服务端能正常启动，并能正确定位到 D 盘的 PS：
  `[INFO] [WindowsDetector] Found Photoshop at: D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe`
- 工具调用链路已验证可用（历史上成功执行过建文档、渐变填充、文字层、参考线、导出预览等操作）。
- **2026-10-10 20:07 复核通过**：`photoshop_ping` 返回 `Successfully connected to Photoshop`，
  紧接着 `photoshop_get_state` 正常返回结构化文档状态 → **全链路确认可用**。

本机另有一项值得记录的环境事实（实测）：

```yaml
photoshop_process:
  IsElevated: true        # PS 当前以【管理员权限】运行
com_probe:
  clsid_from_progid: "Photoshop.Application -> {2682BB05-0A88-430F-8614-EE4E60E6D916}"
  LocalServer32: 'D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe /Automation'
  CoCreateInstance: "S_OK"
  note: "在上述状态下 COM 通路仍可用，说明【以管理员运行】本身不会阻断本 MCP。"
```

### 2.1 本次故障复盘（2026-10-10，AI 必读）

有一段时期本 MCP 在本机**所有调用都超时**，排查过程得出过好几个错误结论。把真相记在这里，避免后续 AI 重走弯路：

| 曾经的错误判断 | 实际情况 |
|---|---|
| "Photoshop 的 COM 注册损坏了" | ❌ 注册完好，`CLSIDFromProgID` 与 `CoCreateInstance` 均返回 `S_OK` |
| "PS 脚本队列卡死了" | ❌ PS 进程实测 4 秒内 CPU 增量为 0，处于空闲等待 |
| "位数不匹配（32/64 位）" | ❌ Node 与 cscript 均为 x64，注册视图一致 |
| 从临时文件挖到 `ActiveX 部件不能创建对象` | ⚠️ **这是伪证据**——该报错是在**受限/沙箱环境**里调用本 MCP 时产生的，不是 PS 侧的真实缺陷 |

**最终结论**：

1. **本 MCP 在 Windows 上靠生成临时 VBScript + `cscript` 执行 COM 调用。** 在受限执行环境（沙箱、被安全软件限制的命令行、缺权限的宿主进程）中运行它，会稳定地产出 `ActiveX 部件不能创建对象` 或直接超时——**这是环境问题，不是配置问题**。
2. **诊断时不要用受限环境去调用本 MCP 并据此下结论。** 正确的独立验证方式是：用一条不受限的普通进程直接做 COM 探测（`CLSIDFromProgID` + `CoCreateInstance`），或在 Photoshop 里手动 `文件 > 脚本 > 浏览` 跑一段 jsx。
3. 本次恢复正常的主要动作是**重启 Photoshop**。若再次出现全线超时，按第 6 节 `extendscript_timeout` 的流程处理即可。

> **附带一个真实踩到的编码坑**（写诊断脚本时会遇到）：用 UTF-8 保存含中文注释的 `.vbs`，Windows 脚本宿主按 GBK 解析，会把行尾的 CR 吞掉导致**多行粘连**，报 `未结束的字符串常量 (800A0409)`。**给脚本宿主用的 .vbs 要么全用 ASCII，要么存成 ANSI/GBK 编码。**

---

## 3. 接入方式（四种，按省事程度排序）

### 3.1 方式 A —— 内置聊天窗（零配置，最快看到效果）

不需要任何 MCP 客户端，包自带一个浏览器聊天界面：

```bash
npx -p @alisaitteke/photoshop-mcp ui
```

浏览器会打开一个聊天窗口。选 AI 提供商时，可以用 API Key，也可以**直接复用已有的 Claude Code / Gemini CLI 账号登录**（不需要额外买 Key）。

**适用场景**：给使用者演示、单次验证、不想动配置文件时。

### 3.2 方式 B —— 接入 MCP 客户端（Claude Desktop / Cursor / VS Code 等）

核心就是往 MCP 客户端的配置里加一段：

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "npx",
      "args": ["-y", "@alisaitteke/photoshop-mcp"],
      "env": {
        "PHOTOSHOP_PATH": "<你的 Photoshop.exe 绝对路径>"
      }
    }
  }
}
```

各客户端配置文件位置（Windows）：

| 客户端 | 配置文件路径 | 备注 |
|---|---|---|
| WorkBuddy | `C:\Users\<用户>\.workbuddy\mcp.json` | 写完后需在「连接器管理 → 自定义连接器」点**信任** |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | 改完重启客户端 |
| Claude Code | — | 用命令：`claude mcp add photoshop -- npx -y @alisaitteke/photoshop-mcp` |
| Cursor | `~/.cursor/mcp.json`（全局）或项目内 `.cursor/mcp.json` | 也可从 Customize → Plugins 安装 |
| VS Code | `.vscode/mcp.json` | 或用官方 Install-in-VS-Code 深链 |

> **`env` 不是必须的**——只有当 PS 不在默认安装路径时才需要（见 3.3）。但**写上更保险**，代价为零。

### 3.3 方式 C —— 非默认安装路径的正确处理（本机就是这种情况）

MCP 的自动检测逻辑**只扫描 `C:\Program Files\Adobe\...` 这个标准路径**。
本机 PS 装在 D 盘，所以**必须显式指定路径**，否则会报"找不到 Photoshop"。

正确写法（WorkBuddy 本机实际配置）：

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

`PHOTOSHOP_PATH` 的取值规则：**接受 `.exe` 全路径，也接受安装目录**，代码里它优先级最高，会覆盖自动检测。

> **JSON 转义提醒**：Windows 路径里的反斜杠在 JSON 中必须写成 `\\`。写成 `D:\software\...` 是无效 JSON。

### 3.4 方式 D —— 环境变量速查

| 变量 | 作用 | 默认 |
|---|---|---|
| `PHOTOSHOP_PATH` | 指定 PS 可执行文件/目录，优先级最高 | 自动检测 |
| `LOG_LEVEL` | 日志级别，`0` 最安静 | `1` |
| `PSMCP_FEEDBACK` | 设为 `0` 关闭使用反馈询问 | 开启 |
| `PSMCP_UPDATE_CHECK` | 设为 `0` 关闭版本更新提示 | 开启 |
| `PHOTOSHOP_SCRIPT_TIMEOUT` | 提高单次脚本超时上限（毫秒） | `30000` |

---

## 4. 连通性验证（AI 可自行执行）

配置写完后，**不要立刻调用业务工具**。按这个顺序验证：

### 第 1 步：确认 Photoshop 在运行

```bash
tasklist | grep -i photoshop
```

Windows 下应看到 `Photoshop.exe`。**没有则先让使用者打开 PS。**

### 第 2 步：调用 `photoshop_ping`

这是唯一的握手工具。

- 成功 → 返回 `"Successfully connected to Photoshop"`
- 失败 → 返回结构化错误信封 `{ ok: false, code, message, suggested_next_tool }`

**`photoshop_ping` 每个会话只调一次。** 成功后改用 `photoshop_get_state` 获取文档上下文，不要反复 ping。

### 第 3 步（可选）：命令行独立验证

如果怀疑是客户端配置问题，可以绕开客户端直接用 MCP 协议打一次：

```bash
export PHOTOSHOP_PATH="D:\\software\\adobe\\Adobe Photoshop 2026\\Photoshop.exe"
export LOG_LEVEL=0
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
  sleep 4
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  sleep 1
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"photoshop_ping","arguments":{}}}'
  sleep 20
} | npx -y @alisaitteke/photoshop-mcp 2>&1 | grep -i -E "Found Photoshop|Successfully|timeout"
```

若这里能打印出 `Found Photoshop at: ...`，说明**服务端与 PS 路径识别都正常**，问题只可能在客户端配置或 PS 运行状态。

---

## 5. 调用约定（AI 必须遵守）

这套工具的行为有几条硬性约定，违反会导致失败或返工：

### 5.1 单位与格式

- **所有坐标、宽高、边界都是像素。** 服务端会在每次脚本前后强制切换为像素单位。**不要把 mm/cm/inch/百分比传进去。**
- **字号是点（pt）。** 颜色是 **0–255 的 RGB 三元组**（`red`/`green`/`blue` 三个字段）。
- 导出文件默认落在 `~/.photoshop-mcp/exports`。只有使用者明确要求时才传绝对路径。

### 5.2 面向中文用户的必知事项

- **创建中文文字层时必须显式指定中文字体**（如 `fontName: "MicrosoftYaHei"`）。默认字体没有中文字形，中文会渲染成空白或方块。**实测踩过这个坑。**
- 字体名传错会返回 `font_not_found`，用 `photoshop_list_fonts` 查列表，或 `photoshop_install_font` 加载本地字体文件。

### 5.3 操作前先读状态

- 任何需要"活动文档/活动图层"的工具，**调用前先 `photoshop_get_state`**，以它返回的 `document.id` 为准，后续所有变更类工具都带上 `document_id`。
- `document_id` 传 `null` 或 `0` 表示"当前活动文档"。
- 当 `openDocumentCount > 1` 时，先用 `photoshop_list_documents` 确认目标，**不要假设最前面那个标签页就是使用者想改的文件**（PS 的活动标签可能被使用者手切换）。

### 5.4 优先用 recipe，不要堆原子调用

- 当一个请求能匹配到现成的 `photoshop_recipe_*` 工具时，**直接调 recipe，不要自己拼 5 个以上的原子调用**。recipe 的价值是**整条链在 PS 里只占一步撤销**。
- 只有对"没有 recipe 覆盖的单点精确修改"才用原子工具。

### 5.5 坐标系陷阱

**不要相信你输入的坐标，要相信返回的 `bounds`。**
实测：按要求传入的 y 坐标，渲染后的实际竖直中心会偏移（曾出现输入 y=470 而实际中心落在 428 的情况）。做法是**读取工具返回的图层 bounds 反推偏差，再用 `photoshop_move_layer` 校正**。

居中更可靠的做法：把段落文本框宽度设为占满画布 + `alignment: CENTER`，而不是手算坐标。

---

## 6. 错误码与恢复（返回信封格式）

失败时返回：

```json
{ "ok": false, "code": "...", "message": "...", "suggested_next_tool": "...", "suggested_args": {...}, "context": {...} }
```

同时 MCP 层会带 `isError: true`。**看到 `suggested_next_tool` 就照做，不要盲猜或盲目重试。**

| code | 含义与处理 |
|---|---|
| `no_active_document` | 没有打开的文档 → 先 `photoshop_open_image` 或 `photoshop_create_document` |
| `document_not_found` | 传的 `document_id` 不存在 → `photoshop_list_documents` 后换新 id |
| `no_active_layer` / `layer_not_found` | 先 `photoshop_get_layers`，再按名字操作 |
| `selection_required` | 先建立选区再复用刚才失败的工具 |
| `not_text_layer` | 目标不是文字层 → 先 `photoshop_create_text_layer` 或选对图层 |
| `font_not_found` | 字体名不在 PS 字体表里 → `photoshop_list_fonts` 取 `postScriptName` |
| `artboard_not_found` | `photoshop_list_artboards` 或 `photoshop_create_artboard` |
| `extendscript_timeout` | **脚本超时（默认 30s）。重点：MCP 中止 ≠ PS 停止，上一条脚本可能还在跑。** 处理见下 |
| `scratch_disk_full` | PS 暂存盘满了 → 让使用者清理系统盘（至少 100GB）并**重启 Photoshop** |

### `extendscript_timeout` 的专门处理（最容易踩的坑）

1. **反复调用 `photoshop_ping`，直到它成功为止。** ping 跑的是一段极短脚本，走同一条队列，它成功即代表 PS 已腾出。
2. **在 ping 成功之前，绝对不要调用 `photoshop_get_state` 或 `photoshop_get_layers`** —— 它们会一起失败，且不提供新信息。
3. 如果失败的是 `photoshop_execute_script`，可以**带 `timeout_ms` 重试一次**（如 `180000`，上限 `600000`），或用 recipe 代替（recipe 自身已用 600s）。
4. **如果连续多次 ping 仍然超时**（本机复核时就出现过这种情况），**先判断调用环境是否受限**（沙箱 / 无权限的宿主进程 / 被安全软件限制的命令行）—— 受限环境下本 MCP 会稳定失败，此时任何重试都没意义。排除环境因素后，再按下面的方式处理：
   - 切到 Photoshop 窗口，检查是否有**模态对话框**（脚本错误提示、保存询问、启动欢迎屏等）挡在那里 —— 关掉它；
   - 若没有对话框，**重启 Photoshop**（先保存未存盘的文档）。本次故障最终就是靠重启 PS 解决的。

---

## 7. 能力边界（别承诺做不到的事）

### 有工具覆盖的

文档与画布、图层与智能对象、选区与蒙版、调整与调色、文字排版、变换与画板、AI 生成式（生成式填充/移除/扩图/放大、换天空）、滤镜、播放 Action、执行任意脚本、撤销栈、状态读取、预览导出、数据集批量出图。

### 16 个配方（最值得用的部分）

`recipe_remove_background`（抠图去背）、`recipe_enhance_portrait`（人像润饰）、`recipe_prepare_for_web`、`recipe_export_social_variants`（多平台尺寸）、`recipe_split_carousel`（长图切轮播）、`recipe_batch_watermark`（批量水印）、`recipe_csv_to_cards`（CSV 批量出卡）、`recipe_batch_mockup_replace`（批量套样机）、`recipe_passport_photo`（证件照）、`recipe_organize_layers`（图层规范化）等。

### **没有**工具覆盖的（真实现状，别硬试）

- **参考线 / 标尺操作** —— 需自己写脚本（注：本机实测 `Units.MILLIMETERS` 在这版 PS 上报"无效枚举值 (1320)"，要改用 `Units.MM`）
- **色彩模式转换（RGB→CMYK）** —— 没有现成工具，要写脚本
- **画布大小调整** —— 只有重采样和裁切，没有改画布尺寸的工具
- **导出带裁切标记的印刷 PDF** —— 不支持
- **导出 PSD 之外的印刷级输出** —— 能力有限

对这类缺口，正确的做法是走 **`photoshop_execute_script` 逃生舱**自己写 ExtendScript，而不是反复尝试不存在的工具。

---

## 8. 故障排查速查表

| 现象 | 原因 | 处理 |
|---|---|---|
| 报"找不到 Photoshop" | PS 装在非默认路径 | 设置 `PHOTOSHOP_PATH` |
| `Photoshop not running` / 连接失败 | PS 没开 | 打开 PS 再 ping |
| 一切工具都 `extendscript_timeout` | PS 脚本队列被占 | 反复 ping；不行则查 PS 对话框或重启 PS |
| 全部工具超时、且报 `ActiveX 部件不能创建对象` | **调用方处于受限环境**（沙箱/无权限宿主/被安全软件限制） | 不要在受限环境调用本 MCP；换成普通进程或直接让使用者在 PS 里手动跑脚本 |
| 中文显示成方块/空白 | 未指定中文字体 | 传 `fontName: "MicrosoftYaHei"` 等 |
| 首次调用很慢（30–60s） | npx 冷启动下载 | 正常现象，第二次走缓存 |
| 元素位置偏了 | 坐标不精确 | 读 bounds 再用 move 校正 |
| `scratch_disk_full` | 暂存盘满 | 清系统盘 + 重启 PS |
| 自己写的 .vbs 报 `未结束的字符串常量` | UTF-8 存的中文注释被按 GBK 解析，行尾 CR 被吞 | .vbs 用 ASCII 内容，或另存为 ANSI/GBK |

---

## 9. 安全须知（给使用者看的部分）

- **43 个工具带"破坏性"标记**（改像素、删图层、写磁盘），能安全随意调用的只读工具只有 10 个。**它没有"改坏也不出事"的内置护栏。**
- 涉及真实业务文件时，**必须先复制副本再操作**，不要让 AI 直接动源文件。
- 建议对改文档的操作加一道"**预览 → 确认**"流程：用 `photoshop_get_preview` 出图给使用者确认后再继续。
- 它默认会上报匿名使用统计，可用 `PSMCP_FEEDBACK=0` 关闭。
- `photoshop_ping` 成功后可能附带一个 **FEEDBACK_NUDGE** 块，要求 AI 用使用者当前的语言问一次使用反馈 —— 这是内置机制，不是故障关键词，可婉拒。

---

## 10. 一句话总结（给 AI 的话）

> 你不需要"安装"任何东西。你只需要：**确认 PS 在运行** → **确认配置文件里的 `PHOTOSHOP_PATH` 指向正确的 exe** → **`photoshop_ping` 一次** → **`photoshop_get_state` 认文档** → 然后优先挑 `recipe_*` 工具干活。遇到失败看 `code` 和 `suggested_next_tool`，遇到超时先 ping，ping 不通就请使用者重启 Photoshop。
>
> **最后一条忠告**：如果你（AI）自己运行在一个受限环境里（沙箱、无权限的宿主、被安全软件限制的命令行），**不要用它来诊断本 MCP** —— 你会得到 `ActiveX 部件不能创建对象` 这类假故障，然后花大量时间排查一个根本不存在的问题。诊断只在普通用户权限的进程里做，或干脆交给使用者手动验证。
