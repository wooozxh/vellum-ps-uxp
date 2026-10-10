# 20 · 打通 PS MCP 的排查记录

> 会话：2026-10-10（第 13 次会话及其后续）
> 触发：用户「我觉的可以再打通下 mcp，我记得之前会话打通过，这样之后你可以控制 PS 进行测试和排错」
> **状态：已打通**（2026-10-10 20:16 实测 `photoshop_ping` / `get_state` / `execute_script` 全通）
> ⚠️ 本文档 §一 记录了我自己在前两轮里的**三处错判**，保留痕迹，不删。

---

## 结论（先说）

| 项 | 结论 |
|---|---|
| 真实错误 | `Failed to connect to Photoshop - ActiveX 部件不能创建对象`（VBScript **错误 429**） |
| **机制** | Photoshop 的自动化类工厂只在 **`/Automation` 启动的那个实例**里注册。**PS 已经正常启动时**，COM 去拉第二个实例 → 老实例不接交棒 → 新实例约 3 秒退出 → **429** |
| **实测确认** | 现在能用的这个 PS，命令行是 `Photoshop.exe /Automation -Embedding` —— `-Embedding` 是 **COM 自己拉起服务端**时附加的旗标 ⇒ **它是被 COM 启动的** |
| **可行操作法** | **先把 Photoshop 完全退出**，再发一次 `photoshop_ping`（第一次可能要重试到成功）。见 §五 |
| 注册表 | **完全健康**，四视图全查过，三个 ProgID 全部解析到同一健康 CLSID、`LocalServer32` 的 exe 真实存在 |
| 配置 | **完全正确** —— 不是 `mcp.json` / 路径 / 磁盘 / 权限的问题 |
| 附带收获 | 用户仍保留着 10-04 那次会话产出的四份资料（已归档到 `references/photoshop-mcp/`），其中《接入手册》有一条归因与我的实测冲突，已在归档 README 里标出并定案 |

---

## §一 更正：我自己的三处错判

### 错判 ①：「没有 result 文件 ⇒ cscript 卡在 COM 里」

**错。这是采样精度不足造成的误判。**

`windows-executor.js` 的 `executeScript()` 有：

```js
finally {
  await unlink(vbsPath).catch(...);
  await unlink(tempScriptPath).catch(...);
  await unlink(resultPath).catch(...);   // ← 结果文件写完立刻被删
}
```

VBS 写 result 文件 → Node 读到 → `finally` 立刻 unlink，整个过程是**毫秒级**。
而我那两次观测的**实际采样间隔约 3.5 秒**（不是我以为的 1 秒 —— `ps -W` 本身要跑 2~3 秒），
用 3.5 s 的间隔去观测一个存在 <1 s 的文件，只能得出"它从没出现过"这个**确定但错误**的结论。

> 真正决定性的动作是**把超时从 30 s 放宽到 180 s** —— 让 VBS 跑完并交回**错误原文**。
> 那两次"盯着临时文件看"的实验，**根本没有决定性**。

### 错判 ②：「PS 里挂着上一轮的 ExtendScript，重启就好」

**错。** 用户重启 PS（19:17:15）后**第一次**调用依然失败；进程表里**只有一个** PS；
**没有任何脚本宿主残留**。我上一轮还把"连发 6 次 ping 把 PS 引擎占满"当主因并归责于自己 ——
该归因**不成立**。（但**连发确实是错误做法**，见 §七。）

### 错判 ③：「必须用 `tools/photoshop-with-automation.cmd` 手动带 `/Automation` 启动 PS」

**方向对，但操作法说错了。** 真正的机制是"**这个实例得让 COM 自己拉起来**"（见 §四），
所以最省事的做法是**先把 PS 完全退出、再让 COM 去启动它**，而不是手动加参数。
那个 `.cmd` 走的是"手动 `/Automation` 启动"这条路 —— **方向一致，但没有实测过**，
留作备选，**不要当成已验证的修法**。

---

## §二 逐环节验证（这些结论**仍然成立**）

| 环节 | 读数 | 结论 |
|---|---|---|
| `mcp.json` 配置 | `PHOTOSHOP_PATH` = `D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe`，`LOG_LEVEL: 1` | ✅ 正确 |
| PS 可执行文件 | 真实存在 | ✅ |
| **COM 注册（四视图全查）** | **64 位 HKLM 有；32 位 HKLM / 32 位 HKCU / 64 位 HKCU 全空** | ✅ 与 64 位脚本宿主匹配，**不是位数问题** |
| CLSID 子键完整性 | `LocalServer32, ProgID, Programmable, TypeLib, VersionIndependentProgID` | ✅ 完整 |
| `LocalServer32` 值 | `D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe /Automation` | ✅ 指向正在跑的那个 PS |
| 该 exe 是否存在 | `True` | ✅ |
| **三个 ProgID 对比** | `Photoshop.Application` / `.200` / `.200.1` **全部解析到同一健康 CLSID** | ✅ **排除"多版本别名"坑**（Adobe 社区那个同款 429 案例的解法是改用带版本号的 ProgID，**在本机无效**） |
| 已安装的 PS 版本数 | **只有 1 个** | ✅ 排除多版本冲突 |
| 磁盘 | C: 剩 50 G / D: 剩 181 G | ✅ 不是 `scratch_disk_full` |
| 脚本宿主残留 | 无 | ✅ |

**这一栏的价值**：把"注册坏了 / 位数不匹配 / 多版本别名 / 磁盘满 / 有残留进程"
**全部排除**。剩下唯一能解释 429 的，只有**运行时行为**。

---

## §三 观测实验：第二个 Photoshop 进程

**方法**：后台轮询「Photoshop 进程 PID + 脚本文件 + 结果文件」，同时发**一次**
`photoshop_execute_script`。

```
19:25:33  pids=4198760                    jsx=0  result=0
19:25:39  pids=4198760,4209200            jsx=1  result=0   ← 第二个 Photoshop 出现
19:25:42  pids=4198760                    jsx=1  result=0   ← 3 秒后自行退出
19:26:09  pids=4198760                    jsx=0  result=0   ← 整条链结束 ≈30 s → 429
```

⚠️ **精度必须如实说明**：我一开始打算按 0.1 s 采样，但**实际间隔约 3.5 s**
（`ps -W` 每次要跑 2~3 秒）。所以准确表述是：

- 第二个 PS 进程在 **19:25:39 那次采样时存在**、**19:25:42 那次已不在** ⇒
  **寿命 ≲ 3 秒**（正常启动 Photoshop 要 15~40 秒）；
- 老实例（4198760）**全程未受影响**。

**这个寿命就是关键读数**：3 秒只够干一件事 ——
**检测到已有实例 → 交棒 → 退出**。它根本不是"启动了一个新 PS"，而是"交棒失败后自己退了"。

### ⚠️ 这个观测本身有一个方法缺陷（必须写明）

我判定"第二个 Photoshop"用的是 `ps -W | grep -i photoshop` —— **匹配的是完整路径里的
`photoshop` 子串，不是进程名**。而 Photoshop 目录下还有一堆 helper
（如 `Required\CEPHtmlEngine.exe`）**也会被匹配到**。

> 事后核对：**PS 正常运行时这个计数可以到 7 条**（本次收尾时实测）。所以
> **我没有验证那个闪现的 PID 4209200 一定是 `Photoshop.exe` 本身**。

⇒ 因此 §三 只能支持到："**在 COM 激活窗口内，多了一个与 Photoshop 相关的进程，
约 3 秒后消失**"，**不能**单独用来断言"那就是第二个 Photoshop.exe"。

**但这不影响 §四 的机制结论** —— 因为定案靠的是 §四 那条**直接读数**
（现用实例命令行带 `/Automation -Embedding`），它是无歧义的。
§三 只作旁证。

---

## §四 机制（三方交叉，已定案）

```
Photoshop.Application
   └─ CLSID {2682BB05-0A88-430F-8614-EE4E60E6D916}
        └─ LocalServer32 = "…\Photoshop.exe /Automation"
```

**Adobe 官方文档原话**（*Adobe Photoshop OLE Automation Programming Guide*）：

> Photoshop's automation class factory is a **single use object** that can only be used
> by one automation controller at a time. You'll get a message that **the Photoshop
> object can't be created if it is already in use by another application.**

**拼起来的机制**：

| PS 当前状态 | `CreateObject` 的结果 |
|---|---|
| **已在运行，且不是 `/Automation` 起的** | COM 按注册表去拉第二个 `Photoshop.exe /Automation` → 它发现已有实例 → **交棒（想请老实例当自动化服务器）** → **老实例没开自动化，接不了** → 新实例约 3 秒退出 → COM 激活超时 → **429** |
| **完全没在跑** | `CreateObject` 直接把 PS 拉起来（命令行带 `/Automation -Embedding`）→ 它自己就是自动化服务器 → **一路可用** |

**这是一次"实测落地"的确认，不是推测**：

```
（读 Photoshop.exe 进程命令行）
PID 41136  CMDLINE: "D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe" /Automation -Embedding
```

`-Embedding` 是 **OLE 服务端进程被 COM 拉起时**才会附加的旗标 ⇒
现在这个能用的实例，**是 `CreateObject` 自己启动的**。

> 官方那句 "already in use by another application" 容易读歪：
> 它说的不是"被别的程序占用了"，而是**"在跑的那个实例不可被自动化"**。

---

## §五 现在怎么用（实测过的操作法）

### 正常态（当前就是）：什么都不用做

只要 PS 是以 `/Automation` 起的（当前即如此），**MCP 随调随用**，不需要额外动作。

### 如果哪天又全线 429：按这个顺序

1. **存图 → 完全退出 Photoshop**（确认任务管理器里没有 `Photoshop.exe`）；
2. 让 AI **发一次 `photoshop_ping`**。**第一次很可能超时**（PS 正在冷启动），
   **继续 ping 到成功为止** —— 不要在这中间去调 `get_state` / `get_layers`（会一起失败且不给新信息）；
3. 成功后 `get_state` 认文档，再干活。

> 备选（**未实测**）：`tools/photoshop-with-automation.cmd` —— 手动带 `/Automation` 启动 PS。
> 方向与机制一致，但没有真机验证过，所以**不要当成首选**。

### 超时相关的参数（源码确认）

- 默认脚本超时 **30 s**：`script-timeout.js` 的 `DEFAULT_SCRIPT_TIMEOUT_MS = 30_000`；
- 环境变量 **`PHOTOSHOP_SCRIPT_TIMEOUT`**（毫秒，上限 `600_000`）；
- `photoshop_execute_script` 也可按调用传 `timeout_ms`（上限 600000）；
- 长任务用 recipe（recipe 自身用 600 s 预算）。

---

## §六 备选方案（现在**不必**了，留作退路）

原先评估过两条不碰 COM 的路：**B1 `adb-mcp`**（UXP 通道，代价：每次重启 PS 要人工 Load + Connect）、
**B2 自建 dev 门控「文件桥」**（插件轮询 `devcmd.json` → 跑 batchPlay → 写 `devresult.json`，零安装）。

**结论：MCP 已通，两条都暂不需要。** 但 B2 有一个仍然成立的优势值得记着 ——
**我们的插件随 PS 启动自动加载**（`boot.log` 里 19:17、20:15 两次自检都是它自己跑的），
所以"让插件干活"这条通道不需要任何人工介入。

---

## §七 方法学教训：这是第四次"工具骗人"

前三次分别是**量法错**（拿同步 `getBoundingClientRect` 量异步布局）、
**判据错**（探针基座把"首次 append 需要 >2 帧"误报成"几何不可信"）、
**判据可靠性**（"让固定 2 帧就够"本身是赌注）。

**这一次是「观测精度」骗了我**：

> **"没观测到" ≠ "没发生"。**
> 采样频率必须与被观测事件的**时长量级**匹配。
> 用 1 Hz（何况我实际只有 0.3 Hz）去观测一个存在 <1 s 的文件，
> 只会得出一个**确定但错误**的结论。

**推论（值得固化）**：

1. 观测一个**有生命周期**的目标前，先估它的**时长量级**，再定采样频率；
   **并且实测一下你自己那套采样的真实间隔**（我这次就是被 `ps -W` 的耗时坑了）。
2. 只要还有「**放宽超时 / 换个参数就能拿到真实错误**」这种更便宜的路，**就别先做观测实验**。
3. **别把工具给的"分类"当成"事实"** —— 我读到的 `extendscript_timeout` 是
   `refineTimeoutEnvelope()` **按正则拼上去的固定文案**，后面那句
   "Photoshop is still running a previous script" 更是**模板句**。
   真正的错误原文（429）一直在 `envelope.message` 里，只是我之前没逼它出来。

---

## §八 本轮实测补充（MCP 可用性 + 两个新坑）

**实测通过**：

| 调用 | 结果 |
|---|---|
| `photoshop_ping` | `Successfully connected to Photoshop` |
| `photoshop_get_state` | 正常返回 `HelloWorld.psd`（id 60，1920×1080，RGB，72 dpi，1 层） |
| `photoshop_execute_script` | 可 `app.documents.add()` / `executeAction()` / `doc.close(SaveOptions.DONOTSAVECHANGES)` —— **能建能关临时文档**（跑完已关闭，未保存，**没碰用户的 `HelloWorld.psd`**） |

**两个新踩到的坑（清单里没有）：**

1. **`Document.histogram` 只有 256 项（亮度），不是 RGB 三分量。**
   （实测 `doc.histogram.length === 256`，白底文档读回 `[255]`。）
   ⇒ 想拿它当"像素回读"**只能判断亮度变没变**，拿不到 RGB。
   要真正的 RGB 回读得走别的路 —— **本项目插件侧的 UXP `imaging.getPixels` 就是可用的那条**。
2. **ExtendScript 的 DOM 不能创建/转换内容图层。**
   `layer.kind = LayerKind.SOLIDFILL` 被直接拒绝：
   ```
   错误: 您只能将图层的类型更改为文本或正常。
   ```
   ⇒ 形状 / 纯色填充图层**只能走 ActionManager**。
   而**手工猜 AM 描述符不可行** —— 我拼的 `Mk contentLayer` 描述符报了
   `发生了常规 Photoshop 错误。该功能可能无法在这个版本的 Photoshop 中使用。`
   **正确做法：用 ScriptListener / Alchemist 录真实描述符再照抄。**

**这条对 `docs/18` 直接有用**：S17「内容图层改色」卡住，就是因为两条描述符是**猜的**。
现在 MCP 通了 ⇒ 可以走"录制真实描述符 → 真机试 → 读像素验证"这条正路，
不用再靠推测堆候选。**这是打通 MCP 最实际的收益。**

---

## §九 本轮未自证 / 待确认

- ⏳ **手动用 `/Automation` 启动 PS 是否也够**（`tools/photoshop-with-automation.cmd` 这条路）
  —— 未实测。当前可用状态走的是"COM 自己启动"那条。
- ⏳ **19:17 那个失败的 PS 实例，当时命令行到底有没有 `/Automation`** —— 我没抓到。
  结论是从"第二个进程闪现 3 秒 + 429"这个签名 + 现用实例带有 `-Embedding` 推出的，
  **推断很强，但缺那一份直接读数**。
- ⏳ 为什么整条链第一次调用要跑满约 30 秒（PS 那次只占 3 秒）——
  疑似 DCOM 激活超时或端点安全软件扫描 `cscript` + 新写的 `.vbs`，未查明。
- ⏳ `LOG_LEVEL=1` 只把日志写 **stderr**（`utils/logger.js` 明确 *never stdout* 以免污染
  JSON-RPC），**没有日志文件**，所以拿不到历史调用记录。
- ⏳ 旧归档 `references/photoshop-mcp/` 里《接入手册》对 429 的归因（"受限环境伪影"）与
  本会话实测不一致 —— 已在归档 README 里写明定案与理由，但**没有去找那份文档的作者会话对质**。
