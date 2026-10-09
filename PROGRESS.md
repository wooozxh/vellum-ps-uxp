# 进度台账

> **AI 每次收工都要更新这个文件。** 这是跨会话协作的接力棒 —— 下次开新会话，读完它就等于接上了。

---

## 当前状态

- 阶段：**环境与闭环全部就绪，等待产品形态立项**
- 完成度：环境调研 **100%**；工具链 **100%**；**闭环打通 100%**；档案与仓库 **100%**；
  **最小插件样板 100%**；**无阻塞**；产品形态 **0%（未定）**
- 环境基线：`node tools/doctor.mjs` = **13/15 项**，其中「闭环关键项 **5/5**」
- 闭环实证：`hello-uxp` 探针插件加载后自检 **7/7 全通过**，`report.json` 落盘并被外部脚本读回
- 样板实证：`hello-world` 插件（Panel + Command 双入口）加载成功，`boot.log` 落盘；
  **面板按钮已被用户实际点击，并确认为真正的「文本图层」**
  （只读快照：`active=HelloWorld.psd 总数=2 顶层=[Hello World:text, 图层 0:pixel]`）
- 仓库：**已上线** → https://github.com/wooozxh/vellum-ps-uxp （Public）

## 已完成

- [x] 2026-10-09　资料库建立：官方文档地图 + 教程资源 + 工具链全景 + 本机环境体检（`docs/` 两份）
- [x] 2026-10-09　本机环境体检：PS 2026 v27.2 已装、Node 22、npm、git、Python 就位；**VS Code 已装**
- [x] 2026-10-09　工作区成型并从 C 盘迁到 `D:\ps-uxp-dev`（迁移后自检结果与搬迁前完全一致）
- [x] 2026-10-09　工具链：UXP CLI 装好并跑通（187 个依赖，无原生编译报错）
- [x] 2026-10-09　官方示例仓库浅克隆（27 个示例，13 MB）→ `official-samples/`
- [x] 2026-10-09　闭环脚本：`doctor.mjs`（15 项自检）/ `report.mjs`（读插件报告）/
      `enable-devtools.mjs`（管理员开关）/ `uxp.cmd` + `uxp`（CLI 包装器）
- [x] 2026-10-09　自检探针插件 `hello-uxp`（manifest v5，7 个用例，自检即报告）
- [x] 2026-10-09　档案四件套建立（`PROJECT` / `PROGRESS` / `DECISIONS` / `NEXT`）
- [x] 2026-10-09　`docs/` 编号制度建立（现有资料纳入 `NN-xxx.md` 体系）
- [x] 2026-10-09　GitHub 仓库准备：`.gitignore` / `.gitattributes` 写好、`git init`、首次提交
- [x] 2026-10-09　**GitHub 仓库上线**：公开仓库 `wooozxh/vellum-ps-uxp`；
      提交身份改用 GitHub noreply 邮箱（提交可归到账号）；`tools/push_via_api.py` 兜底通道
- [x] 2026-10-09　**【闭环打通】** 用户完成两步准备工作（管理员开关 + PS 开发者模式）
- [x] 2026-10-09　**【闭环打通】** `uxp service start` 起服务，`apps list` 认出 Photoshop 27.2.0；
      PS 主动连上 `127.0.0.1:14001`（由此反证「PS 开发者模式」确实生效）
- [x] 2026-10-09　**【闭环打通】** `hello-uxp` 首次加载成功，自检 **7/7**，`report.json` 被读回
- [x] 2026-10-09　**【闭环打通】** 完整验证过一次「改代码 → load → 读报告 → 复验」循环
      （修掉探针 `app.name` 误报：该属性在 PS 27.2 / UXP 9.0.2 下返回 `undefined`）
- [x] 2026-10-09　实测并校正 README 命令：`plugin load` 幂等可作主力；`reload` 不接受 `--manifest`
      且实测失败；`watch --path` / `validate --manifest` 均可用
- [x] 2026-10-09　**第一个真插件 `hello-world`**：Panel + Command 双入口，manifest v5，
      零依赖零构建。加载成功；**面板按钮被用户实际点击并成功插入文字图层**
- [x] 2026-10-09　**事件日志通道 `boot.log`** 建立 —— 插件把「加载 / 执行 / 失败」追加写入
      自己的数据目录。于是「用户点了什么 → AI 能读到」这条通道成立
- [x] 2026-10-09　**开发期自检 `verify.flag`** 建立 —— 无痕演练（建临时文档 → 插文图 → 验 → 关掉），
      首次运行即通过：`selfverify ok=true layers=["Hello World","背景"] cleaned=yes`
- [x] 2026-10-09　`docs/03-HelloWorld与插件形态.md`：Panel vs Command 形态对比 + 反馈通道说明
- [x] 2026-10-09　**【修 bug】** 用户报「插入文字」弹错框 + 只建出普通图层 → 定位并修复。
  根因：PS 2026 v27.2 下 `batchPlay` 的 `make`+`textKey` **不再生成文本图层**；
  随后对非文本层 `set` 又触发 PS 原生模态框卡死。改走 DOM `createTextLayer` 后通过
- [x] 2026-10-09　**【修 bug】** 修掉自检的**假阳性**：判据从「只比图层名」改为「名字 + 类型」双条件
  （本次 bug 能显示 `ok=true` 正是因为它只看名字）
- [x] 2026-10-09　**【新工具】** `hello-world/probe-text.js` 写法矩阵探针：
  真实 PS 里逐个跑候选写法、读回 `layerKind` 定论；`tools/win_dialog.py` 定位/关闭 PS 原生模态框
- [x] 2026-10-09　**【新通道】** `boot.log` 增加 `newLayer=名字/类型` 与 `docs` 只读快照 ——
  以后每次点击都能自证「建出来的层是什么类型」
- [x] 2026-10-09　`docs/04-文本图层正确写法.md`：完整实测矩阵（A1–A4 / B 轮）+ 四个坑 + 环境硬约束速查

## 待办

- [ ] **【当前唯一待办 · 需用户拍板】产品形态**（Command / Panel、是否上框架）
      → 拍板后产出 `docs/10-产品方案.md`，用户确认后才动代码
- [ ] **【待用户回填】** `hello-world` 在 PS 菜单里的**确切位置** —— `docs/03` 里写的是通用说法，
      请在 PS 里找一下「窗口」菜单与「插件 / 增效工具」菜单，回填实际路径
- [ ] （可选）给仓库加许可证 —— 当前**无 LICENSE**，公开仓库下他人不可合法复用
- [ ] （可选）探针插件用例从 7 项扩充（如 batchPlay 写属性、UXP 权限声明校验、面板 UI 交互）

## 下一步（下次开工从这里开始）

1. **环境已就绪，不必重新调研环境** —— 跑 `node tools/doctor.mjs` 应得 13/15、闭环 5/5；
   若不对，先看 `README.md` 第三节（两步准备工作）
2. **直接进入产品形态立项**（唯一未决项）—— 与用户敲定 Command / Panel、是否上框架。
   参考物已备好：`hello-world` 两个入口都能跑，`docs/03` 有形态对比表
3. 形态定了 → 写 `docs/10-产品方案.md` → 用户确认 → 才开始写业务代码
4. 每做完一个真插件，顺手做两件事：把 `boot.log` 的日志点补齐；给新插件的关键描述符
   加一次 `verify.flag` 式自检（batchPlay 描述符与 PS 版本强相关，只能实测）

## 已知问题与风险

| 项 | 说明 |
|---|---|
| **管理员闸门（已解除）** | `C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json` 非管理员不可写。**Adobe 有意为之**（防止任意脚本偷偷往 PS 塞插件），不是 bug，绕不过去。已于 2026-10-09 由用户以管理员身份写入；**换机器需重做**（`node tools\enable-devtools.mjs`）。 |
| PS 来自离线安装包 | PS 2026 是 `D:\安装包\Win版 PS 2026 v27.2.zip` 装的，**不是 CC 装的**。多数情况下 CLI 照常能连；若出现「加载后 PS 里看不到插件」，优先怀疑这一点。 |
| **产品形态未定** | 最大风险 = 在形态未明时写大量代码，白做。所以铁律第一条就是「先出方案再动代码」。 |
| 官方示例仓库不入库 | 它是独立 git 仓库 + 第三方代码。换机器需重新克隆（命令在 `README.md`）。 |
| 沙箱三条限制 | 本会话环境里 `spawn cmd.exe` → ENOENT、Node spawn 任何 `.exe` → **EBUSY**、COM 实例化被拦、`reg.exe` 被禁。写脚本时**别走 shell**；Node 里干脆别指望 spawn 外部命令（Python 的 subprocess 反而可用）。详见 `NEXT.md` 第四节。 |
| **`github.com:443` 间歇被封** | 实测同一时刻 `api.github.com` 200、`codeload.github.com` 301，只有 `github.com` 连不上（代理则 502）。`git push` 会失败但**远端没坏**。兜底：`python tools/push_via_api.py`。 |
| Git 凭据读取不稳定 | `git credential fill` 实测 3 次里会有 1 次返回空。脚本里务必**重试**（`push_via_api.py` 内置 6 次）。 |
| **`plugin reload` 不可靠** | 实测：不接受 `--manifest`，且在插件实例状态失效时报 `Command execution failed in all connected applications`。**改用 `plugin load --manifest`**（幂等：重复 load = 重新加载 + 重跑自检）。 |
| **`app.name` / `app.version` 在本机读不到** | PS 27.2 / UXP 9.0.2 下这两个 getter 返回 `undefined`，batchPlay 取 `application.version` 也拿不到。探针已改用 `app.documents.length` 作「宿主连接」判据。写新插件别依赖这两个属性。 |
| **`plugin test` 需要额外安装** | 它要 `-s/--setup` 装 UXP Automation Framework（jest 风格，端口 4797），是**另一条**测试路线；本工作区用的是 `report.json` 落盘方案，两者可并存但别混淆。 |
| **PS 原生错误框会「无声」卡死模态** | `batchPlay` 失败时 PS 可能弹**原生模态框**，它**不等于** JS Promise reject：插件侧 `await` 永不返回，外部侧日志停在某行再也不动，用户只看到弹窗。排障：`python tools/win_dialog.py` 列窗口 → `--close PSDialogBox` 关掉它。典型诱因：在非文本层上 `set` 带 `textKey` 的 `textLayer`。 |
| **插件目录是只读存储** | `getPluginFolder()` 既不能建文件也删不掉文件（`The file uses a storage provider that is read-only.`），且 UXP 的 `Folder` **没有** `deleteEntry`。故 `*.flag` 开关只能由外部创建/删除；插件自己产出的文件一律写 `getDataFolder()`（PluginData）。 |
| **文本图层只能走 DOM** | PS 2026 v27.2 下 `batchPlay` 的 `make`+`textKey`（含显式 `layerKind:{_enum:"layerKind",_value:"textLayer"}`）**只生成普通图层**；必须用 `app.activeDocument.createTextLayer({contents})`。字号在 `textItem.characterStyle.size`，**不是** `textItem.fontSize`（后者不存在）。详见 `docs/04-文本图层正确写法.md`。 |
| **判据要照抄数据形态** | 同一属性两条通道两种形态：`layerKind` 经 batchPlay 是数字 `1`/`3`、经 DOM 是字符串 `"pixel"`/`"text"`；`size` 回读是多层对象 `{"_unit":"pointsUnit","_value":72}`。本次两次因判据凭想象写，把**正确答案判成失败**。 |

## 会话日志

### 2026-10-09（第 1 次会话）
- **做了什么**：环境调研（资料库 / 本机体检 / 工具链 / 闭环设计）；工作区从 C 盘迁到 D 盘；
  建立档案四件套；准备 GitHub 仓库。
- **改了哪些文件**：全部为新建（新工程）。核心是 `PROJECT.md` / `PROGRESS.md` / `DECISIONS.md` / `NEXT.md`
  + `tools/` 四个脚本 + `hello-uxp/` 三个文件 + `.gitignore`。
- **遗留**：管理员开关未启用（唯一阻塞）；产品形态未定。

### 2026-10-09（第 2 次会话）— 闭环打通
- **做了什么**：用户完成两步准备工作 → 实测验证闭环全链路 → 修掉探针的一处误报 → 校正文档命令
- **关键结论**：**闭环成立**。`service start` → `apps list` 认出 PS 27.2.0 → `plugin load` 成功 →
  探针自检 **7/7** → `report.json` 落盘 → `report.mjs` 读回；并完整走过一次「改码 → 重载 → 复验」
- **反证技巧**：PS 开启开发者模式后，会主动连上 `127.0.0.1:14001`（netstat 里能看到来自
  Photoshop PID 的 ESTABLISHED 连接）。这比翻设置界面更能证明该开关生效。
- **改了哪些文件**：`hello-uxp/index.js`（宿主连接用例改用 DOM API 判定）、`README.md`（状态与命令校正）
- **遗留**：产品形态未定（当前唯一待办）

### 2026-10-09（第 3 次会话）— 第一个真插件与「双向」闭环
- **做了什么**：写并跑通 `hello-world`（Panel + Command 双入口）；建立事件日志通道与开发期自检机制
- **关键结论**：
  - `hello-world` 加载成功；**用户亲手点面板按钮的那次被执行日志记录下来**
    （`insert  via=panel  doc=晋升公告.psd  layers=11`）→ 「用户操作 → AI 可读」通道成立
  - ⚠️ ~~文字图层的 batchPlay 描述符经无痕自检验证通过~~ —— **此结论后经复查为「假阳性」**：
    当时的自检只比对图层**名字**，而 PS 2026 建出来的其实是同名**普通图层**。
    详见第 4 次会话与 `docs/04-文本图层正确写法.md`
  - `entrypoints.setup({ plugin, panels, commands })` 是 v5 标准写法；command 回调写在 `commands[id].run()`
  - 官方文档确认：entrypoint 只有 `panel` / `command` 两种 type，对应「插件面板」与「插件菜单」
- **踩的坑**：
  - **截图路线在本环境不可用** —— `windows-app-screenshot` 的脚本跑不出 PNG，且 PowerShell 输出常被吞。
    → 改用 `boot.log`，**反而得到比截图更强的验证能力**（能证明用户操作是否成功）
  - `rm` 对 `$APPDATA` 展开出的 `C:\...` 路径会被安全层拒绝
    （`[safe-delete][SAFE_DELETE_INVALID_PATH] embedded drive prefix is not allowed`）
- **改了哪些文件**：新建 `hello-world/`（3 个文件）、`docs/03-HelloWorld与插件形态.md`；
  更新 `README.md` / `PROGRESS.md` / `DECISIONS.md` / `.gitignore`
- **遗留**：产品形态未定（当前唯一待办）

### 2026-10-09（第 4 次会话）— 修「插入文字」的 bug

- **触发**：用户报 bug —— 点「在当前文档插入 "Hello World" 文字」后弹出 PS 原生错框
  「命令"设置"当前不可用。」，并且只建出一个**普通图层**，不是文本图层（其余功能正常）。
- **怎么定位的**：不猜，写 `probe-text.js` 让插件当探针，在真实 PS 里逐个跑候选写法、
  读回 `layerKind` 定论。第一轮 4 种 batchPlay 写法全部 `layerKind=1`，只有 DOM 的
  `createTextLayer` 得到 `3`。中途被 PS 原生错误框卡死一次 → 顺手做出 `tools/win_dialog.py` 把它点掉。
- **根因**：
  1. PS 2026 v27.2 下 `batchPlay` 的 `make`+`textKey` **不再生成文本图层**（图层名却依然正确）
  2. 紧接着对非文本层 `set` 带 `textKey` 的 `textLayer`，PS 弹**原生模态框**并**阻塞**整个模态作用域
  3. 而自检**只比对图层名**，于是把这次失败记成了 `ok=true`（假阳性）—— 这解释了「日志说成功、用户看到失败」
- **踩的坑（两条判据都凭想象写，把正确答案判成了失败）**：
  - `layerKind` 经 batchPlay 是**数字** `1/3`、经 DOM 是**字符串** `"pixel"/"text"` → 第一版按字符串匹配，A4 被误判 FAIL
  - `size` 从 PS 回读是 `{"_unit":"pointsUnit","_value":72}` 不是数字 `72` → 第二版正则又误判 FAIL
- **改了哪些文件**：
  - `hello-world/index.js`：`makeTextLayer()` 改走 DOM；`readActiveLayer()` 增读 DOM `kind`；
    新增 `isTextLayer()` 统一双形态判定；`selfVerify` 判据加「类型」；日志增 `newLayer=名字/类型`；
    插件加载时写一份**只读**文档快照（`docs` 行）
  - 新建 `hello-world/probe-text.js`（写法矩阵探针）、`tools/win_dialog.py`（PS 模态框排障）
  - 新建 `docs/04-文本图层正确写法.md`
- **验证（三重，全部落盘可查）**：
  1. 探针：`A 轮可用写法 = A4 DOM：document.createTextLayer({contents})`；`probe B PASS ... "sizeApplied":true`
  2. 无痕自检：`selfverify ok=true layers=["Hello World","背景"] kind=text/3 cleaned=yes`
  3. **用户真实点击 + 只读快照**：`insert via=panel doc=HelloWorld.psd layers=2`
     → `docs active=HelloWorld.psd 总数=2 顶层=[Hello World:text, 图层 0:pixel]`
- **顺带挖到的环境硬约束**：插件目录是**只读**存储（不能建文件、也删不掉文件）；
  UXP 的 `Folder` 没有 `deleteEntry` → 文件开关只能由外部管。
- **遗留**：产品形态仍未定（唯一待办）；
  `hello-world` 两个入口在中文版 PS 菜单里的确切译名，仍待用户回填。
