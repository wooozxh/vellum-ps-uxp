# references / photoshop-mcp

**这里放的是「外部会话产出、但对本项目有长期价值」的资料 —— 不是本项目的产出。**

来源目录：`C:\Users\17736\WorkBuddy\2026-10-04-20-46-52\`
归档时间：2026-10-10
归档原因：用户明确要求「这些文件是别的会话生成的，可能对开发有帮助，存一下」

| 文件 | 原文时间 | 内容 |
|---|---|---|
| `Photoshop-MCP-工具能力清单.md` | 2026-10-04 21:42 | 直接读服务端 `tools/list` 解析出的 **127 工具 / 23 模板**全清单，含破坏性标注（43 个）与只读标注（10 个） |
| `Photoshop-MCP-接入手册.md` | 2026-10-10 20:10 | 面向 AI 的接入手册：事实卡、四种接入方式、调用约定、错误码表、能力边界、故障排查表 |
| `Photoshop-MCP-体验指南.md` | 2026-10-04 21:11 | 面向使用者的体验指南 + 三个同类开源项目（photoshop-mcp / adb-mcp / adobe-mcp）的底细评估 |
| `ps-com-check.vbs` | 2026-10-10 20:10 | 独立的 COM 连通性自检脚本（双击即跑，只读，会写 `ps-com-check-result.txt`） |

---

## ⚠️ 归档时必须带上的三条更正 / 注意事项

### 1. `ps-com-check.vbs` 是 **ANSI/GBK** 编码，不是 UTF-8

用 UTF-8 视图打开会看到乱码，**这是正常的**。
它自己的注释里就写着（《接入手册》§2.1 附带坑）：

> 用 UTF-8 保存含中文注释的 `.vbs`，Windows 脚本宿主按 GBK 解析，会把行尾的 CR 吞掉导致
> 多行粘连，报 `未结束的字符串常量 (800A0409)`。**给脚本宿主用的 .vbs 要么全用 ASCII，
> 要么存成 ANSI/GBK 编码。**

⇒ **不要"顺手把它转成 UTF-8"**，那会直接弄坏它。

### 2. ⚠️ 《接入手册》§2.1 对 `ActiveX 部件不能创建对象` 的归因，与本项目 2026-10-10 下午的实测**不一致**

《接入手册》的主张：

> 从临时文件挖到 `ActiveX 部件不能创建对象` → **这是伪证据** …… 该报错是在
> **受限/沙箱环境**里调用本 MCP 时产生的，不是 PS 侧的真实缺陷。

本项目的实测（同日 19:19 / 19:25，**都是通过 WorkBuddy 宿主自己拉起的 MCP 进程**，
不是从沙箱里的命令行跑 MCP）同样拿到 429，并且用 **0.1 s 间隔的进程采样**看到
**第二个 `Photoshop.exe` 在调用期间出现、约 3 秒后自行退出**。

⇒ 至少在本机、本会话的观测下，**"429 只是沙箱伪影"这个解释不足以覆盖全部现象**。
**2026-10-10 20:20 已用直接证据把机制定下来**：

```
当前正在运行的 Photoshop（20:08:30 启动）命令行：
"D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe" /Automation -Embedding
```

`-Embedding` 是 **COM/OLE 拉起服务端进程时**才会附加的旗标 ⇒
**这个 PS 是 `CreateObject` 自己启动的**，它天然就是自动化服务器。

⇒ 修正后的结论（两边都能自洽）：

| 状态 | 结果 |
|---|---|
| PS **已在运行，且不是 `/Automation` 起的** | `CreateObject` 去拉第二个实例 → 老实例不接交棒 → 新实例约 3 秒退出 → **429** |
| PS **完全没在跑**，由 `CreateObject` 自己拉起来 | 拿到的实例带 `/Automation -Embedding` → **此后 COM 一路可用**（当前就是这个状态） |
| 手动用 `/Automation` 启动 PS | **未验证**（`tools/photoshop-with-automation.cmd` 走的是这条，方向一致但没实测过） |

**最省事的操作法**：想让 AI 控制 PS 时，**先把 Photoshop 完全退出**，
再让 AI 发一次 `photoshop_ping`（第一次可能要重试到成功 —— PS 正在启动时同样会超时）。

⚠️ 《接入手册》那句"429 是受限环境伪影"**不能照抄**：本会话两次 429 都是通过
**WorkBuddy 宿主自己拉起的 MCP 进程**发出的（不是从沙箱命令行跑 MCP），
而现在同一条通道可用 —— 差别在 PS 侧，不在调用环境。
（它记录的"重启 PS 就好了"这个观察本身没错，只是**漏掉了为什么**。）

### 3. 《接入手册》里最值钱的两条"别硬试"结论

- **不要在受限环境里用本 MCP 做诊断** —— 会拿到假故障，然后花大量时间排查一个不存在的问题。
  要独立验证就用 `ps-com-check.vbs`（普通权限双击）或在 PS 里手动跑 jsx。
- **`extendscript_timeout` 的正确处理顺序**：先 **反复 ping 到成功**（ping 走同一条队列，
  它成功 = PS 腾出来了）；**在 ping 成功前不要调 `get_state` / `get_layers`**
  （一起失败且不给新信息）；`execute_script` 可带 `timeout_ms` 重试一次。
  ⚠️ 本会话补一条：**别把 `extendscript_timeout` 这个"分类"当成观测事实** ——
  它是 MCP 按正则拼出来的，后面那句 "still running a previous script" 是**模板句**。

---

## 本会话（2026-10-10 20:16）实测补充：这套 MCP **当前可用**

- `photoshop_ping` → `Successfully connected to Photoshop`
- `photoshop_get_state` → 正常返回结构化文档状态（`HelloWorld.psd`，id 60，1920×1080）
- `photoshop_execute_script` → 可以 `app.documents.add()` / `executeAction()` /
  `doc.close(SaveOptions.DONOTSAVECHANGES)`，**能建能关临时文档**（跑完已关闭，未保存）

两条**新踩到的坑**（清单里没有，值得回填上游或记在项目里）：

1. **`Document.histogram` 只有 256 项（亮度），不是 RGB 三分量。**
   想用它做"像素回读"只能判断**亮度是否变化**，拿不到 RGB。
   要做真正的 RGB 回读，得走别的路（本项目插件侧的 `imaging.getPixels` 就是可用的那条）。
2. **ExtendScript 的 DOM 不能创建/转换内容图层。**
   `layer.kind = LayerKind.SOLIDFILL` 直接被拒：
   `错误: 您只能将图层的类型更改为文本或正常。`
   ⇒ 形状 / 纯色填充图层**只能走 ActionManager（AM）**创建与改色。
   而**猜 AM 描述符是不可行的** —— 本会话手工拼的 `Mk contentLayer` 描述符就报了
   `发生了常规 Photoshop 错误`。**正确做法是用 ScriptListener / Alchemist 录制真实描述符再照抄。**
