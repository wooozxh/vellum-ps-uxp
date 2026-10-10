# 进度台账

> **AI 每次收工都要更新这个文件。** 这是跨会话协作的接力棒 —— 下次开新会话，读完它就等于接上了。

---

## 当前状态

- 阶段：**M1 已完成 —— 外壳 + 调色板（验收 7 条全过，待下一次做 M2）**
- 完成度：环境调研 **100%**；工具链 **100%**；闭环打通 **100%**；档案与仓库 **100%**；
  最小插件样板 **100%**；产品形态 **100%（已定）**；联动路线 **100%（已定）**；跨项目契约 **100%**；
  多版本兼容性策略 **100%（已定稿）**；**M1 实现 100%（已完成并自证）**；
  **M2 实现 0%（未开工）**；**无阻塞**
- **M1 交付物**：`vellum-toolbox/`（id `com.vellum.toolbox`）—— 外壳（工具宫格 + 下钻）+ **调色板**
  （6 个占位品牌色 + 「我的颜色」持久化）；`dist/com.vellum.toolbox_PS.ccx`（38 KB）
- **M1 自证**：`verify.flag` 无痕自检 **10/10 PASS**（合成点击真面板 → 前景/背景色回读命中、
  `palette.json` 落盘并被下一次加载确认仍在）。证据：`PluginData\boot.log` + `selfcheck.json`
- 环境基线：`node tools/doctor.mjs` = **13/15 项**，其中「闭环关键项 **5/5**」（2026-10-10 M1 收工后复验一致）
- 闭环实证：`hello-uxp` 自检 **7/7**，`report.json` 可被外部脚本读回；`hello-world` 双入口 + `boot.log` 事件流水
- **形态已定**：**一个插件、两类入口** —— Panel（常驻工作台）+ Command（快捷动作）；**vanilla JS + Spectrum，零构建**
- **方案已定稿**：`docs/10-产品方案.md`（含里程碑 M1–M4、M1 验收标准、待实测清单）
- **联动已定**：路线 **② 镜像单写**（无服务、无网络权限）；数据契约 **`D:\vellum-link\LINK-CONTRACT.md`**
- **UI 方向已定**：**自写 CSS 为主 + 少量 `sp-*` 兜底**，主题**跟随 PS 自适应**（2026-10-10 拍板）；
  方案见 `docs/13-UI方案.md`（**草案，待确认后落地 S1–S4**）
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
- [x] 2026-10-10　开机复验闭环：`doctor` = 13/15、闭环 **5/5**；重启后「服务 → load → 写文件 → 外部读回」完整复现
- [x] 2026-10-10　**产品形态定案**：与用户聊定「一个插件、两类入口」（Panel 工作台 + Command 快捷动作），
      面向公司设计部门的工具箱合集；技术栈 **vanilla JS + UXP 内置 Spectrum，零构建**
- [x] 2026-10-10　**`docs/10-产品方案.md` 定稿**：需求与优先级、形态、注册表机制、各工具界面草案、
      边界情况、里程碑 M1–M4、M1 验收标准、待实测清单
- [x] 2026-10-10　**联动探针 `link-probe/`**：实测 UXP 联动能力 **6 项 5 过**
      （`fetch` 本地 HTTP / `<img>` 直连 HTTP / `blob`→`objectURL` / `WebSocket` 收推送 全过；`file://` 磁盘图片被拒）
- [x] 2026-10-10　**联动路线复评并定案**：用户质疑"都能读对方文件夹就不必 HTTP" → 复评成立，
      改为 **② 镜像单写**（VellumDesk 写进插件 PluginData，插件只读自己的目录；无服务、无网络权限）；③ 正式放弃
- [x] 2026-10-10　**镜像性能实测**：库总量 127 MB / 缩略图仅 48 KB；压测 3000 张小文件首次写入 ≈ 2.1 秒，
      轮询只 stat 一个 `manifest.json`（<1 ms）→ 性能非瓶颈
- [x] 2026-10-10　**核对 VellumDesk 数据模型**（读源码，非猜）：`projects`/`packs`/`pack_versions`/`assets`
      + `role` 四值 + `SUB_FOLDERS` 三组 + `_thumbs` 缩略图规格（320px webp）
- [x] 2026-10-10　**跨项目联动契约定稿**：`D:\vellum-link\LINK-CONTRACT.md`（版本 `vellum-link/1`），
      两个项目根各放指针文件；含镜像目录与常量、三份 JSON schema、handoff 握手、路径发现、
      **写者唯一性**、变更流程（加法不升版本 / 破坏性升版本）
- [x] 2026-10-10　**契约新增公告板并拆分**：**规格** `LINK-CONTRACT.md` 与**流水** `LINK-LOG.md` 分离；
      可写区条目须带 `[插件侧]/[软件侧]/[双方]` + 日期，**只追加**、禁整份覆盖
- [x] 2026-10-10　**多版本兼容性策略定稿** `docs/12-多版本兼容性策略.md`；用户四问拍板
      （minVersion `25.0.0` **暂定** / 「以机制换兼容」**采纳** / 借机器跑体检 **批准** / 补契约 **批准**）
- [x] 2026-10-10　**契约 §7.1「多 PS 版本共存」正式生效**：默认"**全部命中都写**"（每套镜像独立是**预期行为**）
      + "只同步指定 PS 大版本"可选优化 + 可选字段 `psMajor`；留痕见 `LINK-LOG.md`
- [x] 2026-10-10　**【新插件】`env-check` 环境体检**：panel + command 双入口，**加载即自动跑**，
      六组共 21 项探测；本机基线 **17/21**（4 个 FAIL 全部合理且预期）。
      面板显示全文 + 「另存报告…」（`localFileSystem: "request"`）
- [x] 2026-10-10　**【M1 地基实测通过】** 读/设**前景、背景色**的确切写法已拿到并落盘：
      读用 `[{_property}, {_ref:"application",…}]`、**设用 `[{_ref:"color", _property}]`**（两者**不对称**）；
      RGB 键名是 **`grain`** 不是 `green`；DOM 侧需 `SolidColor`（裸对象抛 `reading 'desc'`）
- [x] 2026-10-10　**`.ccx` 分发路径打通**：`uxp plugin package` 打出 `dist/com.wooozxh.envcheck_PS.ccx`（16 KB）；
      **不需要签名** → 同事双击安装；图标用**纯标准库 Python**自生成（无第三方依赖）

## 待办

- [ ] **【可开工 · 当前】M1：外壳 + 调色板** —— 方案见 `docs/10-产品方案.md`。
      ✅ **地基探针已跑完**（`env-check`；写法见 `DECISIONS.md` 2026-10-10 条与 `env-check/README.md` §六）→ **开工即可写界面**。
      动代码前待用户回填：插件名/id（拟 `com.wooozxh.vellumtoolbox`）、调色板交互（左键前景 / Shift 背景）、品牌色 HEX
- [ ] **【待用户】把 `env-check` 带到同事机器跑** —— 取回 PS 2024 / 2025 的真实数据。
      分发物 `dist/com.wooozxh.envcheck_PS.ccx`（双击安装）；用法与取回报告见 `env-check/README.md`
- [ ] **【待用户调查】** 同事里是否还有 **PS 2023 或更老** —— 若有，`minVersion: "25.0.0"` 需重算
- [ ] **【跨项目 · M2 前】** 联动：插件侧出 `docs/11-素材库联动方案.md`；
      VellumDesk 侧（`D:\proj_media`）**也要立它自己的方案**（含"通用/品牌库"这一新功能）
- [ ] **【待用户回填】** `hello-world` 在 PS 菜单里的**确切位置** —— `docs/03` 里写的是通用说法，
      请在 PS 里找一下「窗口」菜单与「插件 / 增效工具」菜单，回填实际路径
- [ ] （可选）给仓库加许可证 —— 当前**无 LICENSE**，公开仓库下他人不可合法复用
- [ ] （可选）探针插件用例从 7 项扩充（如 batchPlay 写属性、UXP 权限声明校验、面板 UI 交互）

## 下一步（下次开工从这里开始）

1. **环境已就绪，不必重新调研环境** —— 跑 `node tools/doctor.mjs` 应得 13/15、闭环 5/5；
   若不对，先看 `README.md` 第三节（两步准备工作）。
   ⚠️ **`tools\uxp.cmd` 在 Git Bash 里不可靠**（UTF-8 被按 GBK 读，中文注释行被当命令执行）；
   可靠做法：`node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js <子命令>`（详见 `NEXT.md` 第四节）
2. **直接开工 M1** —— 形态与方案均已定，唯一前置是用户回填三项小配置（见「待办」）
3. **M1 的第一件事是探针，不是写界面** —— 先在真机确认「设前景/背景色」的 batchPlay 写法
4. 每做完一个真插件，顺手做两件事：把 `boot.log` 的日志点补齐；给关键描述符加一次 `verify.flag` 式自检
5. **涉及插件 ↔ VellumDesk 联动时，先读 `D:\vellum-link\LINK-CONTRACT.md`**

## 已知问题与风险

| 项 | 说明 |
|---|---|
| **管理员闸门（已解除）** | `C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json` 非管理员不可写。**Adobe 有意为之**（防止任意脚本偷偷往 PS 塞插件），不是 bug，绕不过去。已于 2026-10-09 由用户以管理员身份写入；**换机器需重做**（`node tools\enable-devtools.mjs`）。 |
| PS 来自离线安装包 | PS 2026 是 `D:\安装包\Win版 PS 2026 v27.2.zip` 装的，**不是 CC 装的**。多数情况下 CLI 照常能连；若出现「加载后 PS 里看不到插件」，优先怀疑这一点。 |
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
| **UXP `display:none` 不加载图片** | 图片放进 `display:none` 容器，UXP **不加载**且报**超时**（不是 `onerror`）—— 极易误判为"网络被拒"。承载图片的 DOM 必须**可见**。实测于 2026-10-10，详见 `link-probe/README.md`。 |
| **UXP 读不了任意磁盘** | `file://` 直读磁盘图片被**明确拒绝**（`onerror`）。插件只能读自己的 PluginData —— 这正是「镜像」方案存在的原因。 |
| **联动契约在插件仓库之外** | 契约唯一权威源在 `D:\vellum-link\LINK-CONTRACT.md`（中立目录，**不在任何 git 里**）；配套**公告板** `LINK-LOG.md` 同目录。两侧仓库里的 `LINK-CONTRACT.md` 只是**指针**。改契约**规格**须**两侧同时知悉**。 |
| **联动契约已拆两份** | **规格** = `LINK-CONTRACT.md`（只读为主，改动要双方同意 + 走 §十）；**动态/公告** = `LINK-LOG.md`（两侧都可写，条目须带 `[插件侧]`/`[软件侧]`/`[双方]` **+ 日期**，**只追加**、不许整份覆盖）。**写进 LOG ≠ 生效** —— 要生效仍须改契约正文。 |
| **同事的 PS 版本不同（2024/2025/2026）** | 版本跨度 = **UXP 7.2 → 9.x**。真正的分界线是 **UXP 7.x ↔ 8/9.x**，**不是 PS 年份**（官方表：26.11→UXP 9.2.0，而 27.2→9.0.2）→ **别用年份推断能力，以插件自报 UXP 版本为准**。策略见 `docs/12-多版本兼容性策略.md`。M1 起 `minVersion` 统一为 **`25.0.0`**；有版本门槛的能力一律**探测 + 双路降级**。**本机只有 2026，2024/2025 无法本机实测**，需借同事机器跑体检插件。 |
| **`docs/10` 曾被格式化器吞过内容** | 宿主 markdown 格式化器会重排表格、偶发吞掉新增段落 —— 2026-10-10 发生过一次。→ **改完大文档要回读校验**，别只信 Edit 的 success。 |
| **batchPlay 读写参数不对称（设色）** | **读**前景/背景色用 `_target:[{_property}, {_ref:"application",_enum:"ordinal",_value:"targetEnum"}]`；**设**色却必须用 `_target:[{_ref:"color", _property}]`。**用错的一方静默失败、不报错**（看起来像"没反应"）。RGB 键名是 **`grain`**（不是 `green`），分量 0–255。详见 `env-check/README.md` §六。 |
| **`_target` 缺 `_ref` 会返回整份 application 对象** | 只写 `[{_property:"x"}]`（无 `_ref` 指代作用对象）时，PS 返回**整个 application 对象**，取 `res[0].x` 得 `undefined` → 看起来像"属性不存在"，实为**写法错**。 |
| **UXP 没有 `customElements`** | 不能用 `customElements.get(tag)` 判定 `sp-*` 是否注册。可靠判据：拿元素的 `String(constructor)` 与一个**绝对不存在的标签**比对（且必须用**完整串**，前缀都一样）。 |
| **`<input type="color">` 实现不完整** | `type` 保留 `"color"` 但 `value` 是 `null`（浏览器应为 `#000000`）→ **M1 调色板不要依赖它**，取色 UI 需另做。 |
| **`env-check` 会临时改前景/背景色** | D 组设测试色后**恢复并回读校验**，且**仅在能读到原值时才改**。即便有此保护，开发期因探针不完善，本机前景色一度被改过 → 在 PS 里按 **`D`** 即恢复默认黑/白。 |

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

### 2026-10-10（第 5–6 次会话）— 形态定案 · 联动定案 · 跨项目契约定稿

- **做了什么**：
  1. 开机三件事 + 复验闭环（`doctor` 13/15、闭环 5/5）—— 关机重启后闭环完整复现
  2. 与用户聊定**产品形态**（一个插件、两类入口）；三问拍板：vanilla JS / 先做外壳+调色板 / 表格走「文字+矢量可编辑」
  3. 产出并定稿 **`docs/10-产品方案.md`**
  4. 用户提出**与 VellumDesk 联动** → 摸清对方（Electron/React/SQLite，**无任何对外接口**）
  5. 写插件侧**能力探针 `link-probe/`** 并实测 → 一度判定走路线 C
  6. 用户质疑「都能读对方文件夹就不必 HTTP」→ **复评推翻**，改走 **② 镜像单写**
  7. 实测镜像性能（体量比 + 小文件压测）→ 确认非瓶颈
  8. 核对 VellumDesk 数据模型（表结构 / `role` / 缩略图规格 / 目录布局）
  9. 产出**跨项目联动契约** `D:\vellum-link\LINK-CONTRACT.md` + 两个项目根的指针文件
- **关键结论**：
  - 形态：**Panel 工作台 + Command 快捷动作**；vanilla JS + Spectrum，零构建
  - 联动：**② 镜像单写**（无服务、无网络权限）；只镜像「清单 + 缩略图」，**原图不搬**
  - **读盘能力不对称**（决定"能不能读"的是**程序**而不是文件夹）→ 反转写入方即可绕开 UXP 沙箱
  - 契约版本 `vellum-link/1`；**镜像内每个文件只允许一个写者**
- **新增文件**：`link-probe/`（4 个）、`tools/linkprobe/server.mjs`、
  **`D:\vellum-link\LINK-CONTRACT.md`（中立目录）**、`D:\ps-uxp-dev\LINK-CONTRACT.md`（指针）、
  `D:\proj_media\LINK-CONTRACT.md`（指针）
- **改了哪些文件**：`docs/10-产品方案.md`（新增第十节，含 §10.1–§10.7）、`DECISIONS.md`（多条新决策）、
  `PROJECT.md`（形态定案 → 重写身份段 + 协作规则加"联动先读契约"）、`.gitignore`、本 `PROGRESS.md`
- **遗留**：M1 未开工（**可随时开工**）；M2 联动两侧均未立方案

### 2026-10-10（第 7 次会话）— 兼容性拍板 · 体检插件 · M1 地基实测

- **做了什么**：
  1. 用户回答兼容性四问 → `docs/12` **定稿**（§八 改为「已拍板」，新增 §九 描述 `env-check`）
  2. 走契约变更流程：**§7.1「多 PS 版本共存」正式生效**，并在 `LINK-LOG.md` 追加 `[双方]` 留痕
  3. 新建 **`env-check` 体检插件**（六组 21 项），本机实跑 **17/21**
  4. **打成 `.ccx`** → `dist/com.wooozxh.envcheck_PS.ccx`（不需签名，同事双击即装）
  5. 途中修掉**探针自身 3 处假阳性**，并挖出 M1 调色板地基的确切写法
- **关键结论（M1 可直接照抄）**：
  - **读**前景/背景色：`_target:[{_property:"foregroundColor"}, {_ref:"application",_enum:"ordinal",_value:"targetEnum"}]`
  - **设**前景/背景色：`_target:[{_ref:"color", _property:"foregroundColor"}]` + `to:{_obj:"RGBColor", red, grain, blue}`
  - **GET 与 SET 的 `_target` 不对称** —— 用错的一方**静默失败、不报错**
  - DOM 侧需 `SolidColor`（`const c = app.foregroundColor; c.rgb.red=..; app.foregroundColor = c`）
- **探针自身的教训（都已写进代码注释与风险表）**：
  - `_target` 缺 `_ref` → PS 返回整份 application 对象 → 假"属性不存在"
  - "设色命中"判据若只看"回读 == 目标色"，会在"测试色恰好等于当前色"时**假阳性** →
    必须**同时要求"值确实变了"**
  - `<input type=color>` 的 `value` 是 `null`；`sp-*` 不能用 `customElements` 判定（UXP 没有它）
  - **恢复**必须用"**生效过的** target"，不能用"读"的 target（否则恢复静默失败）
- **新增文件**：`env-check/`（manifest / index.html / index.js / README.md / icons×6）、`dist/com.wooozxh.envcheck_PS.ccx`
- **改了哪些文件**：`docs/12`（§八、§九 及 9.1/9.2）、`DECISIONS.md`（3 条新决策）、
  `LINK-CONTRACT.md`（§5.1 补 `psMajor`、新增 §7.1）、`LINK-LOG.md`（1 条 `[双方]`）、本 `PROGRESS.md`
- **遗留**：M1 未开工（**地基已就绪，可立即开工**）；`env-check` 待带同事机器跑；
  同事是否有 PS 2023 或更老待调查

### 2026-10-10（第 8 次会话）— **M1 落地：外壳 + 调色板**

- **用户拍板**：插件名 `vellum_toolbox`、id **`com.vellum.toolbox`**（`plugin validate` 已验合法）；
  调色板交互「按你推荐」（左键前景 / Shift+左键背景 / 右上角 ✕ 或右键删除）；品牌 HEX **暂缺 → 先用 6 个占位色**。
- **做了什么**：
  1. 按 `docs/10` §2.3 的**注册表架构**搭好外壳：读注册表 → 渲染首页宫格 → mount / unmount（下钻式导航）
  2. 落 7 个 lib 底座：`data` / `log` / `store` / `dom` / `ps` / `caps` / `selfcheck`
  3. 实现**调色板**：品牌色 6 块 + 「我的颜色」（`palette.json` 持久化）+ 顶部**当前前景/背景色读数**
  4. 2 条 Command（品牌主色 → 前景色 / 背景色），**纯动作、不依赖面板**
  5. 生成插件图标（纯 Python + zlib，无 PIL）→ 6 个 PNG
  6. 写**无痕自检** `lib/selfcheck.js`：**合成点击真面板**，走真实处理器
  7. 修掉自检抓出的 **2 个真 bug**，跑到 **10/10**
  8. 打包 `dist/com.vellum.toolbox_PS.ccx`（38 KB）；写 `vellum-toolbox/README.md`
- **抓出并修掉的真 bug（都是自检发现的，不是事后）**：
  1. **品牌色网格从未渲染** —— `build()` 只建容器、漏调 `rerender()`，面板里两个网格都是空的
  2. **落盘判据假阳性** —— 只按颜色值匹配会等到上一轮遗留的旧条目，于是"点击没生效"也判 PASS
     → 改为必须匹配**本次新增的 id**
- **三条新实测结论**：
  - UXP 的 `new MouseEvent("click",{shiftKey:true})` **不报错但会丢掉 `shiftKey`** → 合成点击静默退化成普通点击；
    `createEvent("MouseEvents")` 直接抛错。**正解**：造普通 `Event` 再把 `shiftKey` 当**自有属性**挂上去。
  - **Command 无法唤起面板**（UXP 无此 API）→ 命令一律走纯动作，这是安全设计。
  - `executeAsModal` 与轮询回读可并存（自检设色后每 150ms 轮询，无模态争用）。
- **跨重载持久化怎么证的**：`verify-keep.flag` 让自检色留在磁盘 → **下一次插件加载**时被 S2 认出
  → 「它活过了一次真实重载」。
- **新增文件**：`vellum-toolbox/`（`manifest.json` / `index.html` / `index.js` / `README.md` /
  `lib/`×7 / `tools/`×2 / `icons/`×6）、`dist/com.vellum.toolbox_PS.ccx`
- **改了哪些文件**：`docs/10`（§2.2 目录结构、§5.2 实测状态、§八 验收结果、§九 已定项）、
  `DECISIONS.md`（一条长决策）、`LINK-CONTRACT.md`（§2.1 身份 / §2.3 进度 / §7.2 `PLUGIN_ID`）、
  `LINK-LOG.md`（`[双方]` 条目：**软件侧须按新 id 写**）、`.gitignore`（加本地开关文件）、本 `PROGRESS.md`
- **遗留**：
  - ⏳ **品牌 HEX 未定**（唯一未决项）→ 给了就改 `tools/palette.js` 的 `DEFAULT_BRAND`，**一处改完**
  - ⏳ **面板视觉呈现只能人工看一眼**（`窗口 > 插件 > Vellum 工具箱`）—— AI 点不了 PS 菜单
  - ⏳ `env-check` 待带同事机器跑；同事是否有 PS 2023 或更老待调查
  - ⏳ **M2（素材库 / 联动）未开工** —— 两侧都要立方案；软件侧还含「通用/品牌库」这一新功能

### 2026-10-10（第 9 次会话）— **UI 定方向：自写 CSS + 跟随 PS 主题**

- **用户两问**：① 插件是不是只能用 Adobe 那种灰底蓝钮的 UI，能不能改成现代一点的？
  ② 后续功能「一屏装不下」，面板能不能做上下滚动条？
- **查证结论（官方来源，非推测）**：
  - **不强制 Spectrum** —— 官方原话 *"You are free to use your own visual language in UXP plugins"*，
    提交 CC 市场也不强制，只「建议」。UI 有三条路可混用（标准 HTML+自写 CSS / `sp-*` 内置控件 /
    Spectrum Web Components）+ 进阶的 WebView UI。
  - **真约束是「UXP 的 CSS 是浏览器子集」**：✅ flexbox(含 gap)/盒模型/overflow/CSS 变量/`calc()`；
    ⚠️ `box-shadow`、`transform` 需开 `featureFlags.CSSNextSupport`（**不开静默忽略**）；
    ❌ **Grid / `transition` / `animation`·`@keyframes` / `float` / `sticky` / `text-transform` /
    `font` 简写 / `@font-face` / 自绘滚动条**。→ **拿不到平滑过渡**，这是「现代感」最大限制。
  - 另有：`devicePixelRatio` 恒为 1（→ 图标改用内联 SVG）；UXP 26.1 起有 `ResizeObserver` /
    `IntersectionObserver`（→ 长列表懒加载）。
  - **滚动**：能做，且 `index.html` **已具备**（`#vt-body { overflow-y:auto }` + 高度链条 + 纵向 flex）；
    只差一个 `min-height: 0` 的防御性加固。滚动条本身不可自绘。
- **用户拍板**：**路线 = ① 自写 CSS 为主 + 少量 `sp-*` 兜底**（不引 npm / 不破坏零构建）；
  **主题 = 跟随 PS 自适应**（用 `--uxp-host-*` 变量）。
- **产出**：`docs/13-UI方案.md` —— **草案，待确认**（含设计令牌、组件规格、无动效状态表达、
  三段式滚动骨架、6 条验收标准、S1–S4 落地步骤）。
- **新增文件**：`docs/13-UI方案.md`
- **改了哪些文件**：`docs/README.md`（补齐 04 / 10 / 12 / 13 索引）、`DECISIONS.md`、本 `PROGRESS.md`
- **待定**：
  - ⏳ **品牌 HEX 仍未给**（唯一阻塞项）
  - ⏳ `CSSNextSupport` 开不开 —— 我的建议是**暂不开**（门槛 25.x 上不存在，与 `minVersion: 25.0.0` 冲突）
  - ⏳ 面板默认尺寸是否调整（停靠 300×520）
  - ⚠️ **待实测**：`<link rel="stylesheet">` 加载外部 CSS 是否可行（不行则退回内联 `<style>`）
- **遗留**：UI 落地 S1–S4 **待方案确认后执行**；面板视觉（验收第 5 条）**只能你人工看一眼**

### 2026-10-10（第 10 次会话）— **方向 B 落地：外壳 + 调色板 视觉重做**

- **用户拍板**（回应 `docs/14` 的三个决策点）
  ① 配色 = **令牌化深浅两套、跟随 PS 主题**（不是固定深色）；
  ② 中文字号 = **整体上调 1px**（「不接受糊」）；
  ③ 面板基准尺寸 = 由我定。
  补充要求：**技术硬约束就尽量往效果上靠，不必一模一样**；**先只深入 B 方案**。
- **落地范围**：**仅 2 屏**（外壳 + 调色板）。素材库 / 表格 / MCP 不入本轮。
- **做了什么**
  - `index.html` 重写：深浅两套设计令牌 + 全部组件 CSS + 新骨架（顶栏 / 滚动区 / 状态条）
  - `index.js` 重写外壳：顶栏（返回·标题·副标题·环境 chip·详情）+ 首页原生列表 + 主题探测
  - `tools/palette.js` 重做：fgbg 卡片 / 3 列品牌色 / 4 列我的颜色 / hover 浮层 / 操作提示条
  - **新增 `lib/icons.js`**：17 个内联 SVG 图标，用 `createElementNS` 构建（不押注 `innerHTML` 解析 SVG）
  - **新增 `lib/cssprobe.js`**：12 项 CSS / 渲染能力真机探针
  - `lib/selfcheck.js`：新增 S9–S12（CSS 探针 / 图标 / 首页 / hover 浮层）
  - `manifest.json`：v0.2.0；面板 停靠 **340×580** / 浮动 **420×680** / 最小 **260×320**
  - **新增 `tools/offline-smoke.cjs`**：离线结构回归（最小 DOM mock，**不需要 Photoshop**）
- **与设计稿的刻意差异**（详记于 `docs/15` §四）
  - 交互不照搬：设计稿是「右键弹菜单设背景 + X 键删除」，本项目沿用「Shift+左键设背景 / 右键或 ✕ 删除」
    —— 既定交互已被自检覆盖，本轮只定视觉（用户原话「以本会话需求为准」）
  - **全自绘，不再用 `sp-*`**（返回键 / 存色键都改为自绘）→ 主题跟随自己用令牌实现
- **自证**：① 离线结构回归 **14/14**（含「自检选择器一致性」这一项——挡的就是「自检一堆 FAIL 其实只是 id 改名」）；
  ② 真机自检 S1–S12 ⏳ 待装载；③ 视觉呈现 ⏳ 只能人工看
- **关键设计决定**
  - 色块 hover 反馈**不用 `box-shadow`**（最低版本拿不到）→ 改真实描边元素 `.sw-ring`
  - 结构类伪元素、`:first-of-type` / `:last-child` **全部消除**（支持度不确定）→ 用 flex `gap` + JS 挂 `.is-first`
  - 浮层定位**不用 `transform`** → JS 手算 `left` 并 clamp
- **新增文件**：`lib/icons.js`、`lib/cssprobe.js`、`tools/offline-smoke.cjs`、`docs/15-方向B落地记录.md`
- **改了哪些文件**：`index.html`、`index.js`、`tools/palette.js`、`lib/selfcheck.js`、`manifest.json`、
  `docs/README.md`、`docs/13-UI方案.md`（加状态标注）、`DECISIONS.md`、本 `PROGRESS.md`
- **待定 / 遗留**
  - ⏳ **品牌 HEX 仍未给**（唯一阻塞项）；给了只改 `tools/palette.js` 的 `DEFAULT_BRAND`
  - ⏳ 真机装载后看 **12 项 CSS 探针**结论（关键依赖仅 3 条：CSS 变量 / SVG / flex gap）
  - ⏳ 面板默认尺寸 340×580 是估值，真机看过再定
  - ⏳ 仓库自第 5 次会话起未提交

### 2026-10-10（第 11 次会话）— **v0.2.1：UI 缺陷修复 + 探针自我纠错**

- **触发**：用户装载 v0.2.0 后回报 **8 条 UI 缺陷**（外壳 4 条 + 调色板 2 条，见 `docs/16` §一）。
- **前置拍板**（承上轮不变）：令牌化深浅两套跟随 PS 主题 / 字号整体 +1px（「不接受糊」）/ 面板尺寸由 AI 定；
  补充「技术硬约束尽量往效果上靠，不必一模一样」「设计稿主要展示视觉，**以本会话需求为准**」。
- **做了什么 —— 8 条归并成 4 个根因**（这一步的价值最大，避免写出 8 处局部补丁）
  | 根因 | 中招条目 | 修法 |
  |---|---|---|
  | **UXP 的 SVG 不做 `fill`/`stroke` 继承** | 2.1 的 ✕ / 2.2 的返回箭头 / 1.4 的四项 icon / 1.1·1.3 的 hero 黑块 | `icons.js` 新增 `applyPaint()`，**对根节点和每个子元素逐元素写死绘制属性** |
  | **`<button>` 在 UXP 不吃 `display:flex` 且强制居中** | 1.4 文字居中、1.1 返回键空位 | 全改 `div[role="button"]`；`.back.is-off{display:none}` 不留位 |
  | **`inline-flex` 不可靠 + flex `gap` 不生效** | 1.2 圆点与文字重叠、未对齐 | `.bar-chip` 改 `flex` + `.led{margin-right:6px}`；`.navitem` 改**纯绝对定位** |
  | 纯 CSS 数值 | 2.1 行距 | `.hints p{line-height:1.7}` |
- **1.1 / 1.3 logo**：用户两次强调「记得扣掉白色」→ 新建 `tools/make-logo.py`，
  **从四边泛洪抠白**（只抠与边界连通的白，**保留 logo 内部白洞**）+ 两档边缘去白边；自动切出图形标。
  产物 `icons/logo-mark.png`（256×164）/ `logo-full.png`（512×295），已深/浅底合成核对无白边。
  首页 hero 从「内联 SVG」改「位图 `<img>`」—— 顺带绕开 SVG 继承问题。
- **1.4 四项入口**：注册表 `planned` 扩到 3 条（素材库 / 表格生成 / **AI-MCP**，badge M4）；
  每行 = icon(26×26) + 名称 + 描述 ｜ 号位 chip + 箭头。
  ⚠️ **号位「↑1…↑4」是视觉占位** —— `manifest v5` 的 `shortcut` 必须含 Ctrl、只支持字母/数字，
  且**只对 `command` 生效，面板内的导航项绑不了**。
- **顺带修掉一个真 bug（不在用户报的 8 条里）**：点「当前已激活的颜色」被判失败并弹「✗ 设前景色失败」。
  根因 `lib/ps.js` 的 `ok = hit && changed` → 改为 **`ok = hit`**，`changed` 仅作信息。
  这是风险表里「设色判据必须要求值确实变了」那条规则的**过度应用**（那条只约束自检测试色，不约束用户点击）。
- **🩸 本轮最值钱的发现：探针自己是错的**
  - 现象：`width:100px` 的块量出来是 `0px`；而上一轮据此报过「CSS 变量 / letter-spacing / transform 不支持」。
    先归因「离屏容器被裁剪」→ 改成 visible-but-clipped → **仍然是 0**。
  - **判别实验**：同轮 `computed` 类探针（outline / box-shadow / gradient）返回的**正确值** → 说明 style 生效了，
    问题在「量不到几何」。而自检 `S13` 能量到真实几何，差别只有一个：**S13 隔了若干 `await`，探针是同步量的**。
  - **结论：UXP 的布局是异步的**。同步 `appendChild` 后立即 `getBoundingClientRect()` 拿到的是「尚未参与布局」的 0。
  - **修**：新增 `settle()`（连让两帧）+ `cssprobe.run()` 改 **async**（`selfcheck S9` 改 `await`）；
    并新增 **⓪「测量基座自证」探针**（同元素量两次：同步 vs 让帧后），
    **基座失效时所有几何结论自动标注「⚠️ 不可信」** —— 防再犯。
  - **修正后真机能力 = 9/14**（原 4/13）。**推翻三条半旧结论**：
    ① CSS 变量 ✅（实测宽 137px）② `letter-spacing` ✅（差出 +100px）
    ③ `transform` ✅（+30px）④ 附带「`offsetWidth` 恒为 0」也是假的（真机 =100，两套 API 都可用）
  - **真正没被推翻的三条，恰好就是这批 UI bug 的根因**：flex gap 不生效 / SVG 不继承 / `matchMedia` 不存在。
  - 教训写进 `lib/cssprobe.js` 头部注释：**探针报「不支持」时，先怀疑量法，再怀疑特性。**
- **自证（两通道全绿）**
  - ① 真机自检 **15/15 PASS**（`17:35:51  v=0.2.1  theme=dark  themeVia=hostBg亮度=0.33  dur=792ms`）；
    新增 **S13 布局几何诊断**（行高/图标/左内缩/圆点间距与垂直偏差，全用 `getBoundingClientRect`）与
    **S14 图标逐元素自带 fill/stroke**；S11 改判据（4 行 + 号位=4 + hero 是 `IMG` + 顶栏标）。
    真机数字：`行高=54　图标=26x26　文字左内缩=48px　圆点↔文字间距=6px　圆点垂直偏差=1px　缺属性 0`
  - ② 离线结构回归 **18/18**（新增断言 1b/2b/3b/3c）。⚠️ 其中 3c 曾 FAIL，**根因是 `offline-smoke.cjs` 的 DOM 桩
    没跟着改**（不是产品代码）→ **改外壳结构必须同步改桩**，否则制造假 FAIL。
- **新增文件**：`docs/16-UI修复记录.md`、`tools/make-logo.py`、`vellum-toolbox/icons/logo-mark.png` / `logo-full.png`
- **改了哪些文件**：`lib/icons.js`、`lib/cssprobe.js`、`lib/selfcheck.js`、`lib/ps.js`、`tools/palette.js`、
  `tools/index.js`、`index.html`、`index.js`、`manifest.json`、`tools/offline-smoke.cjs`、
  `docs/README.md`、`docs/15-方向B落地记录.md`（加「上表已被真机修正」更正段）、`DECISIONS.md`、本 `PROGRESS.md`
- **遗留 / 待办**
  - ⏳ **品牌 HEX 仍是唯一阻塞项** → 给了只改 `tools/palette.js` 的 `DEFAULT_BRAND`
  - ⏳ **面板视觉只能人工验收**（`窗口 › 增效工具 › Vellum 工具箱`）；打开前可双击 `reload.cmd` 重载
  - ⏳ 号位 chip `↑1…↑4` 要不要保留，待用户定
  - ⚠️ **`dist/com.vellum.toolbox_PS.ccx` 已过期**（14:51 打的，早于 v0.2.0 / v0.2.1）→ 要分发需重新 `plugin package`
  - ⚠️ 仓库自第 5 次会话起未提交

### 2026-10-10（第 12 次会话）— **v0.2.2：悬停闪烁修复 + 新增填充能力**

- **触发**：用户装载 v0.2.1 后回报 2 条（1 个 bug + 1 个新需求，详见 `docs/17` §一）。
  1. 「鼠标在调色板色块上移动时**色值标签疯狂刷新闪烁**」
  2. 「可不可以**通过其他快捷键**直接给目前激活的对象/图层进行填充？」
- **做了什么**

  **① 悬停闪烁 —— 归因到「振荡回路」（不是"重绘慢"，是设计缺陷）**
  旧版每个色块各自 `mouseover` 显示 / `mouseout` 隐藏，两处叠加才"疯狂"：
  - 伤①：`mouseover/mouseout` 在指针跨过「色块 ↔ 它的子元素（`.sw-ring` 描边环 / `.sw-del` 删除叉）」
    时会**成对触发** → show/hide 高频交替；
  - 伤②：浮层纵向 `top = max(0, 色块top - 浮层高 - 5)`，**第一行色块的浮层被 clamp 到 0
    → 正好压在色块自己身上** → 指针落到浮层上 → 色块失焦 → 浮层消失 → 色块复得焦点 →
    浮层又出现 —— **稳定态不是"显示"或"隐藏"，而是以帧率抖动**。
  - 修：`tools/palette.js` 头部写成**四条纪律** ——
    ① 单一活动源（只有 mouseover 能改状态；**色块自己不绑 mouseout**，隐藏由面板根节点
    正着判"指针还在不在活动色块内部"）；② 幂等（活动色块没变就一个字节都不写）；
    ③ **浮层永不覆盖色块**（纵向一律落在 `.sw-grid` 之外）；④ 让帧后量（估算先摆位 + 令牌校正）。
    另加"延时 90ms 可取消"的隐藏 —— 对"宿主是否提供 `relatedTarget`"这种不确定性免疫。
    顺带删掉色块的 `title`（自绘浮层之外再挂宿主原生 tooltip = 两个标签叠加，且重绘时机不受控）。

  **② 填充能力（新功能）—— `Alt+左键` + 命令入口**
  - 交互：`左键=前景色 / Shift+左键=背景色 / **Alt+左键=填充当前图层·选区**（不改前/背景色）/
    右键·✕=删除`，优先级 **Alt > Shift > 无**。选 Alt 是因为 **PS 自己的 Alt+Backspace 就是"用前景色填充"**。
  - `lib/ps.js` 新增 `fillLayer()`：路径① `fillContents:"color"`（**不动用户的前景色**）→
    失败自动回退路径② `foregroundColor`（官方原样，用后**还原**前景色）。
    **不加 `_target`** —— 论坛实例显示加了反而失效。
  - 判据三档 `verify: pixel|change|none`，**用户路径用 change（像素得有变化）**，
    因为路径①的枚举值官方文档没写、最坏情况是**静默忽略**："命令没报错"完全不能当成功。
  - 新增 `readLayerAvgColor()`（`imaging.getPixels` 1×1 = 整层平均色）、
    `createScratchDoc()` / `closeDocument()`（自检专用**临时文档**）。
  - **真机结论**：`fillContents:"color"` 在 PS 27.2 上**有效** ——
    `before=#FFFFFF → readback=#E60012`（精确命中），**回退路径不需要**。
  - **快捷键的现实（更正 v0.2.1 的说法）**：`manifest v5` 的 `shortcut` 语法合规且真机 Validate 通过，
    但那是 Premiere/InDesign/XD 的文档；Adobe 论坛到 **2024** 仍是 "Not yet possible"，
    Adobe 员工明确说 **UXP 核心 API 不支持键盘快捷键**（替代方案：录成动作绑 F 键）。
    → 本项目那条 `Ctrl+Alt+F` 是 **best-effort，很可能被 PS 忽略**；**能自证的是 `Alt+左键`**。

  **③ 顺带修掉：探针基座判据自己写错了（第三次"工具骗人"）**
  - 现象：5 条**本来正确**的几何结论被盖章「⚠️ 此结论不可信」（基座报 `容器宽=0px`），
    同一个容器在别的探针里却能量到 137px / 100px → 说明量到的是**"首次 append 需要超过 2 帧"**。
  - 修完又抓到更狠的：**同一份 `CSS 变量` 探针在相邻两次运行里分别量到 137px 与 0px，代码一个字没改**
    → **"让 2 帧就够"是赌注**，取决于元素挂进去时处在帧的哪个相位。
  - 修：基座先给容器**预热** + 新增 `settleUntil()` **轮询到为止**（记录用了几帧/耗时，真机 =1 帧 36ms）
    + 几何探针全部改 `waitLaidOut()`。修后**连跑三次稳定**，S9 从误报的 8/14 回到 **9/14**。
  - 教训：**上次是"量法错"，这次是"判据错"**。判据错会把自己的可信度一起抹掉 ——
    「不可信」这种标注一旦误报，人就会开始忽略它。**标注的可信度和数据一样要自证。**

- **自证（双通道全绿）**
  - ① 真机自检 **17/17 PASS**，连跑三次稳定（`18:25:47　v=0.2.2　dur=3240ms`）。
    新增 **S15 悬停浮层几何**：`同步量=0x0　让帧后=155x25　相交色块=0　落在网格外=true/true`
    —— 把"不闪"变成一条**几何不变量**（浮层不覆盖色块 → 指针永远不会落到浮层上）。
    新增 **S16 填充端到端**：建临时文档 → 合成 **Alt+点击** → `alt 生效=true` →
    **像素回读=#E60012**（目标 #E60012）→ 前景/背景**未变** → 关文档不保存（**绝不动用户的图**）。
  - ② 离线结构回归 **21/21**：断言 12 改 4 行；新增 15（源码里**不允许**再出现 `binder.on(sw,"mouseout"`）、
    16（无文档时**可读拒绝**且不改前景色）、17（有文档时发出 `fill` 且**不带 `_target`**）。
    另把 mock 的 `batchPlay` 扩到能记 `fill`，并加了假文档集合。
- **新增文件**：`docs/17-悬停修复与填充能力.md`
- **改了哪些文件**：`tools/palette.js`、`lib/ps.js`、`lib/dom.js`(加共享 `settle`)、`lib/cssprobe.js`、
  `lib/selfcheck.js`、`index.js`、`index.html`（纪律加到三条 + 按实测校正能力表）、`manifest.json`（0.2.2 + 第三条命令）、
  `tools/offline-smoke.cjs`、`docs/README.md`、`docs/16-UI修复记录.md`(加 v0.2.2 更正段)、
  `DECISIONS.md`、本 `PROGRESS.md`
- **遗留 / 待办**
  - ⏳ **品牌 HEX 仍是占位色**（`tools/palette.js` 的 `DEFAULT_BRAND`，一处即可换）
  - ⏳ **人工验收两件事**：① 面板里真实划动确认不闪 ② 按一次 `Ctrl+Alt+F` 看 PS 认不认
  - ⏳ 号位 chip `↑1…↑4` 去留待定（**视觉占位**）
  - ⚠️ **未自证的诚实清单见 `docs/17` §五**：真实指针序列、快捷键、浮层是否被滚动容器裁剪、
    填充在文字/智能对象/锁定图层上的表现、品牌色
  - ⚠️ `dist/com.vellum.toolbox_PS.ccx` 仍是 14:51 打的（早于 v0.2.0/0.2.1/0.2.2）→ 分发需重新 `plugin package`
  - ⚠️ 仓库自第 5 次会话起未提交

---

## 2026-10-10　v0.2.3 —— 「填充不能用」：`fill` 只对像素族有效（第 13 次会话）

- **用户原话**：「填充不能用」+ 截图 `Adobe Photoshop / vellum_toolbox: 命令"填充"当前不可用。`
- **先读日志，不猜**（`…PluginsStorage\PHSP\27\Developer\com.vellum.toolbox\PluginData\boot.log`）：
  - 三次失败全在**同一个图层**上：`layer="矩形 1" doc="未标题-1" sel=false`
    `attempts=[fillColor=已执行/像素无变化 fgFallback=已执行/像素无变化] before=readback=#D71619`
  - **batchPlay 没抛异常**（两条路径都记"已执行"），**像素一个没变**，PS 另外弹了个框。
  - 对照 S16 在自检临时文档上的成功：`layer="背景"`（像素图层）→ `fillColor=已执行/像素命中`。
  - 时间线吻合：截图 18:35:25，最后一次 Alt+左键 18:35:12；日志里**没有** `via=command`
    → 用户走的是 `Alt+左键`，那个 PS 弹框就是我们的 `fill` 命令引发的。
- **归因（两条外部事实交叉验证）**
  - Adobe 论坛官方人员原话：「**Vector layers are actually solid color layers (with vector masks)**」
    → **形状图层在 UXP 里的 `kind` 就是 `solidColor`**，与「纯色填充图层」同为 `solidColorLayer`。
  - 形状 / 纯色填充 / 渐变 / 图案都属于**内容图层**（像素由参数算出来）→
    PS 菜单的「填充」对它们本来就**不可用** → 既不改像素，又弹「命令当前不可用」。
- **修法（`lib/ps.js` 重写 `fillLayer()`）**
  - **按 `layer.kind` 分派**：`pixel/background/smartObject` → `fill`；
    `solidColor/gradientFill/patternFill` → `set` 改内容图层的颜色；
    `text` / 调整层 / 组 → **前置拒绝**；`kind` 读不出来 → 只走内容族，**不拿 `fill` 去赌**。
  - **铁律：内容族绝不退到 `fill`** —— 那正是弹框来源，而且"不报错 + 不改像素"比直接失败更难查。
  - 内容改色写了**两条描述符按序试**（`contentColorA` 直接给 `solidColorLayer.color`；
    `contentColorB` 走 `shapeStyle.fillContents`）—— 两派写法都有实物出处，
    **形状图层无法在自检里凭空造**，所以让真机告诉我们哪条生效（日志 `via=contentColorA/B`）。
  - **前置拒绝在发命令之前做完**（锁定/文字/调整层/组）：一条 PS 命令都不发 → 自然不会有 PS 弹框。
- **顺带修掉 v0.2.2 的反馈缺陷**
  - v0.2.2 的 `verify:"change"` 像素判据**判对了**（`ok=false`、`attempts` 写了"像素无变化"），
    但**失败原因只写进 boot.log**，面板给的是含糊文案，用户只看到 PS 的框。
  - 修：失败原因做成**面板上的可操作文案**（如「被完全锁定 —— 取消『锁定全部』再试」）；
    成功时按族换措辞（内容族说「已把「矩形 1」的**颜色改为** #XXX」，因为那确实不是刷像素）。
  - 教训：**判据正确 ≠ 反馈正确。判据对了但结果没送到用户眼前，等于没有判据。**
- **自证**
  - ① 离线结构回归 **24/24**：新增 18（内容图层 → **0 条 `fill`**，改发 `set contentLayer`，验 `to._obj=solidColorLayer`）、
    19（锁定图层 → **0 条命令** + 面板含"锁定"）、20（文字图层 → **0 条命令** + 面板含"文字图层"）。
    mock 扩了 `sentCalls`（记全部命令），并修掉 mock 的 `set` 污染 `colorState` 的问题。
  - ② 新增真机自检 **S17**：临时文档里建**纯色填充图层**（与形状图层同为内容族）→
    验 `kind === "solidColor"`、验改色命中哪条描述符、验像素回读命中。
  - ③ `verify.flag` 已建（一次性），下次加载自动跑一次自检（含 S17），跑完由我删除。
- **改了哪些文件**：`lib/ps.js`、`tools/palette.js`、`lib/selfcheck.js`、`index.js`（0.2.3）、
  `manifest.json`（0.2.3）、`tools/offline-smoke.cjs`、`docs/18-*.md`（新建）、
  `docs/17`（加 v0.2.3 更正段）、`docs/README.md`、`DECISIONS.md`、本 `PROGRESS.md`
- **遗留 / 待办**
  - ⏳ **形状图层本身没真机验证** —— S17 建的是**纯色填充图层**（同族不同物），
    形状图层要用户重载后**点一次**才知道（`kind` 是不是 `solidColor`、哪条描述符生效）
  - ⏳ 文字图层的**改色**未实现（当前是明确拒绝 + 给出替代做法）
  - ⏳ 渐变 / 图案填充图层归到内容族但未实测
  - ⏳ `Ctrl+Alt+F` 是否被 PS 认（v0.2.2 遗留）
  - ⏳ 品牌 HEX（唯一阻塞项）、号位 chip 去留、仓库未提交
  - ✅ ~~`dist/*.ccx` 需重新打包~~ → 本轮已做（见下）

### v0.2.3 追加：面板停靠排查 + 打包可复现（同一轮，用户中途报的"新 BUG"）

- **用户原话**：「插件窗口无法吸附在主界面内」
- **查证结论：不是我们的 bug，manifest 里也没有可改的字段。**（详见 `docs/19`）
  - Adobe 官方：UXP 面板**可以**停靠（"can be resized, **docked**, opened and closed
    just like native Photoshop panels"）。
  - 但**插件无权声明停靠位置** —— Adobe（PS 团队）原话：「There is currently no mechanism
    to specify where you'd like to be docked; **the user has full control over this**」。
  - **官方 manifest v5 字段表里没有 `location` / `dockConfig`**（panel 类只有
    `type/id/label/minimumSize/maximumSize/preferredDockedSize/preferredFloatingSize/icons`，v5 另加 `title`）
    → 社区那套写法 PS 直接忽略。
  - **本机结构性发现**：插件**一直是 UDT 开发态加载**，从未正式安装 ——
    证据：`vellum-toolbox/.uxprc`（UDT 会话文件，18:54 刚写）+ `Developer/settings.json {developer:true}`
    + `PluginsStorage\PHSP\27\` 只有 `Developer/Internal/Shared`（**无 `External`**）
    + `Common Files\Adobe\UXP\Plugins\` 不存在 + **UPIA 不存在**。
    Adobe 工程师原话：「This only works on startup with a **packaged/installed** plugin;
    in the case of a plugin loaded with the **UDT** one would need to reset the workspace」
    → **开发态下面板位置不进工作区**，能解释"吸上也留不住"。
- **决策**：**不改 manifest**。凭感觉调小 `minimumSize` 属无据改动，只会埋坑；
  "查无实据"本身就是一个结论，如实说出，不用一次改动冒充进展。
- **实际做的事（顺手清掉一个真阻塞项）**：新增 **`tools/build-ccx.cjs`**（自己写 zip，
  不依赖 UDT 的 Package 按钮）→ 重新打包 `dist/com.vellum.toolbox_PS.ccx`：
  **v0.2.3 / 237,291 字节 / 23 个条目 / manifest.json 在包根 / 回读校验通过 / 无开发态文件**。
  旧 ccx（14:51，早于 v0.2.0~v0.2.3）作废。
  - 三条硬约束：manifest 必须在包根；排除 `verify.flag`、`.uxprc` 与所有点开头文件；
    写完必须回读中央目录验收。
  - ⚠️ 踩坑记录：本环境**拿不到 PowerShell 的 stdout**，第一次用 `Compress-Archive`
    **静默失败**（退出码 0、文件没生成）→ 改自己写 zip。
- **新增文件**：`docs/19-面板停靠问题.md`、`tools/build-ccx.cjs`
- **遗留 / 待确认**
  - ⏳ 拖拽的**真实症状**（三选一）：① 完全没有停靠落点提示 ② 能吸上但留不住 ③ 想要一打开就自动停靠
  - ⏳ `.ccx` 未真机安装验证（本机缺 UPIA / CC 桌面端）→ 装 .ccx 的正规命令已记进 `docs/19` §五
  - ⏳ `hostAppPluginWorkspace` 的确切语义没查到官方说明（**不要凭字面猜**）

### 追加：打通 PS MCP 的排查（`docs/20`）

- **用户原话**：「我觉的可以再打通下 mcp，我记得之前会话打通过，这样之后你可以控制 PS 进行测试和排错」
- **⚠️ 先更正**：上一轮（10-04）**从未真正连通**。那份《Photoshop-MCP 体验指南》自己写着
  「连接 Photoshop ⚠️ 报 `Script execution failed` —— 因为测试时 PS 没启动」——
  只完成了"配置 + 服务能起"，**没有任何一次成功的 PS 往返**。
  ⇒ 别把"从没通"当成"通了又坏"，那会把排查方向带偏。
- **逐环节验证（全部通过）**
  - MCP 配置：`npx -y @alisaitteke/photoshop-mcp`，`PHOTOSHOP_PATH` → `D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe`（真实存在）
  - Photoshop：正在运行
  - **COM 注册健康**：`HKCR\Photoshop.Application` → CLSID `{2682BB05-…}`，
    `LocalServer32` = **`D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe /Automation`**
    → **指向的正是正在运行的那个 PS，没有版本错配**
  - 磁盘：C: 剩 50 GB / D: 剩 181 GB → 不是 `scratch_disk_full`
  - 进程：**没有** cscript/wscript 残留
- **决定性实验（本轮核心方法）**：读源码确认 Windows 链路是
  `Node → 写 .jsx + .vbs → exec(cscript, 35s 硬超时, SIGKILL) → VBS: CreateObject +
  DoJavaScript($.evalFile) → 写 result.txt`；于是**后台每秒扫 `%TEMP%`、同时发一次 ping**：
  - `.jsx`(2322B) 与 `.vbs`(1696B) **确实写出来了** → 服务走到了"调 PS"这一步
  - **17 秒内始终没有 `photoshop-result-*.txt`** → 而该 VBS **成功与失败分支都会写 result**
    ⇒ **cscript 卡在 COM 里，从没走出来** ⇒ **PS 侧没响应自动化调用**
- **最可能的两个原因**
  - ① **PS 里挂着没跑完的 ExtendScript**（主因）。上一轮指南自己写过「MCP 中止不会停掉 PS，
    脚本可能还在跑」—— 这句话要**反过来读**：**每次超时都会在 PS 里再留一个脚本**，
    所以"再 ping 一次"可能不是恢复手段而是**加重手段**。我这一轮先后 ping 了 6 次以上，
    **这部分责任在我**。PS 的 ExtendScript 是单线的，前一个不结束后面全排队。
  - ② **PS 里有模态对话框**（18:35 那个「命令"填充"当前不可用」就是模态框，时间点在所有 ping 失败之前）。
- **怎么办**：① 看 PS 有没有对话框，关掉；② **重启 Photoshop**（清卡住脚本的唯一可靠办法，
  先存图）；③ 重启后**只发一次** ping，成功再调 `get_state`；④ 若只是慢，加
  `"PHOTOSHOP_SCRIPT_TIMEOUT": "120000"`。
- **备选方案（若重启也救不回，即属"通道级"不通）**：换 **adb-mcp** ——
  `AI ↔ MCP(Python) ↔ 代理(Node, ws://localhost:3001) ↔ UXP 插件 ↔ PS`，
  **完全不碰 cscript/COM**，走 **UXP 通道**（而 UXP 在这台机器上是**已验证可用**的：
  我们自己的插件就跑在上面）。代价：POC（v0.85.4，2025-08 后未更新）、工具少（60+ vs 127）、
  **每次重启 PS 都要在 UDT 里重新 Load 插件再点 Connect**。
- **本轮未自证**
  - ⏳ **重启 PS 后 ping 能否成功** —— 唯一判决点，必须真机跑
  - ⏳ PS 当时到底有没有模态框/卡住脚本 —— 文件系统看不到，只能靠"重启后是否恢复"反推
  - ⏳ **我没能直接验证 COM 调用**：环境安全策略禁止 `New-Object -ComObject`
    （理由 "COM object instantiation can run arbitrary code"）→ "PS 不响应"是
    **从"result 文件没出现"推断**的，不是直接观测到。⚠️ 但推断很强：VBS 的错误分支也会写 result

---

## 2026-10-10　PS MCP 排查第二轮 —— 病灶定位到单点（⚠️ 含对本节上方那段的更正）

> ⚠️ **本节上方那段（第一轮）的结论已被推翻**，保留作痕迹。以下为更正后的结论。

- **用户原话**：「不用了这个bug解决了，应该是我操作的问题。我觉的可以再打通下 mcp，
  我记得之前会话打通过，这样之后你可以控制 PS 进行测试和排错」
- **更正 ①（我上一轮错判）**：「17 秒内没有 `result.txt` ⇒ 卡在 COM 里」**错**。
  `windows-executor.js` 的 `executeScript()` 有 `finally { unlink(resultPath) }` ——
  **结果文件写完立刻被删**。我上一轮用 **1 Hz** 采样去观测一个**存在 <1 s** 的文件，
  只能得出"从没出现过"这个**确定但错误**的结论。
  → 真正决定性的是**把超时从 30 s 放宽到 180 s**，VBS 才跑完并交回**错误原文**。
- **更正 ②（我上一轮错判）**：「PS 里挂着上一轮的 ExtendScript」**已被证伪** ——
  用户重启 PS 后**第一次**调用依然失败；进程表**只有一个** PS；**无脚本宿主残留**。
  上一轮我还把"我连发 6 次 ping 把 PS 引擎占满"当主因并归责于自己 —— 该归因不成立。
  （但**连发确实是错误做法**，见下「方法学教训」。）
- **真实错误**：`Failed to connect to Photoshop - ActiveX 部件不能创建对象`
  = VBScript **错误 429**，来自 `CreateObject("Photoshop.Application")`。
- **逐环节排除（全部健康）**
  - `mcp.json`：`PHOTOSHOP_PATH` 正确、exe 存在；`LOG_LEVEL=1`（日志只走 stderr，无日志文件）
  - COM 注册**四视图全查**：**64 位 HKLM 有；32 位 HKLM / 32 位 HKCU / 64 位 HKCU 全空**
    → 与 64 位脚本宿主**匹配**，**不是位数问题**
  - CLSID 子键完整（`LocalServer32 / ProgID / Programmable / TypeLib / VersionIndependentProgID`）
  - `LocalServer32 = D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe /Automation`，**exe 真实存在**
  - **三个 ProgID（`Photoshop.Application` / `.200` / `.200.1`）全部解析到同一健康 CLSID**
    → **排除"多版本别名"坑**（Adobe 社区那个 429 案例的解法是改用带版本号的 ProgID，我们这里无效）
  - **本机只装了 1 个 Photoshop** → 排除多版本冲突；磁盘 C: 50 G / D: 181 G
- **决定性实验（0.1 s 精度进程采样 + 一次 120 s 超时调用）**
  ```
  19:25:33  pids=4198760                    jsx=0  result=0
  19:25:39  pids=4198760,4209200            jsx=1  result=0   ← 第二个 Photoshop 出现
  19:25:42  pids=4198760                    jsx=1  result=0   ← 3 秒后自行退出
  19:26:09  pids=4198760                    jsx=0  result=0   ← 整条链结束 ≈30 s → 429
  ```
  - 第二个 PS 被拉起 ⇒ COM 激活请求**发出去了、注册表好使**；
  - 它**只活 3 秒**（正常启动 15~40 s）⇒ 只够「检测到已有实例 → 交棒 → 退出」；
  - 老实例**全程未受影响**。
  - 📌 上一轮每秒采样，**这个只活 3 秒的进程几乎必然被漏掉** —— 这是为什么上一轮完全没看到。
- **归因**：**正在运行的 Photoshop 不是以 `/Automation` 启动的**，不注册自动化类工厂。
  Adobe 官方文档原话（*Photoshop OLE Automation Programming Guide*）：
  > Photoshop's automation class factory is a **single use object** … You'll get a message that
  > **the Photoshop object can't be created if it is already in use by another application.**
  机制：`LocalServer32` 是 `Photoshop.exe /Automation`；**只有 `/Automation` 启动的实例才注册类工厂**
  → 正常启动的实例接不了交棒 → 新实例退出 → COM 激活超时 → **429**。
  （那句 "already in use" 容易读歪：不是"被别的程序占了"，是"在跑的实例不可被自动化"。）
- **修法**：新增 **`tools/photoshop-with-automation.cmd`** ——
  完全退出 PS 后双击它（内部 `start "" "<exe>" /Automation`）。
  ⚠️ **以后每次要让 MCP 干活都得用它开 PS**；PS 界面 / 面板 / UXP 插件都不受影响。
- **方法学教训（第四次"工具骗人"）**：前三次是**量法错 / 判据错 / 判据可靠性**，
  这次是**观测精度** —— **"没观测到" ≠ "没发生"**，采样频率必须与被观测事件的**时长量级**匹配。
  推论两条：① 只要还有「放宽超时就能拿到错误原文」这种更便宜的路，**就别先做观测实验**；
  ② **别把工具给我的"分类"当成"事实"** —— 上一轮我读到的
  `extendscript_timeout` 是 `refineTimeoutEnvelope()` **按正则拼上去的固定文案**，
  后面那句 "Photoshop is still running a previous script" 更是**模板句**，不是观测。
- **备选方案（若 `/Automation` 也不行）**
  - **B1 `adb-mcp`**：走 UXP 通道（`AI ↔ Python MCP ↔ Node 代理 3001 ↔ UXP 插件 ↔ PS`），
    完全不碰 COM；代价是每次重启 PS 要在 UDT 里 Load 插件 + 点 Connect。
  - **B2 自建「文件桥」**（推荐）：给插件加 **dev 门控**的轮询桥，读
    `…\PluginData\devcmd.json` → 跑 `batchPlay` → 写 `devresult.json`。
    **零安装**、随插件自动加载、我从 bash 就能读写那个目录。⚠️ 必须 dev 门控 +
    `tools/build-ccx.cjs` 打包时排除，**绝不随 `.ccx` 发给用户**。
- **新增文件**：`tools/photoshop-with-automation.cmd`；`docs/20` 整篇重写
- **遗留 / 待确认**
  - ⏳ **用 `/Automation` 启动 PS 后 MCP 能否连通** —— 唯一判决点，必须真机跑
  - ⏳ 为什么整条链要跑满 ~30 s（PS 那次只占 3 s）—— 疑似 DCOM 激活超时或端点安全扫描，未查明
  - ⏳ 本会话环境**无法直接验证 COM**（`New-Object -ComObject` 被安全策略拦、注册表命令行工具在程序黑名单里）
    ⇒ 归因是**进程读数 + 注册表读数 + Adobe 官方文档**三方交叉推出的，**仍是推断**
  - ⏳ B1/B2 均未实际部署验证

---

## 2026-10-10　PS MCP **已打通** + 归档外部会话资料（同日第三段）

- **用户**：「mcp通了，你可以测一下，然后（四份外部会话产出的资料）存一下」
- **判定：确实通了。** 实测 `photoshop_ping` → `Successfully connected to Photoshop`；
  `photoshop_get_state` → 正常返回 `HelloWorld.psd`（id 60，1920×1080，RGB，72 dpi，1 层）；
  `photoshop_execute_script` → 能 `documents.add()` / `executeAction()` /
  `doc.close(SaveOptions.DONOTSAVECHANGES)`（建了临时文档跑完关掉，**没碰用户的文件**）。
- **机制定案（拿到直接读数，不再是推断）**：读 Photoshop 进程命令行得到
  ```
  "D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe" /Automation -Embedding
  ```
  `-Embedding` 是 **OLE 服务端被 COM 拉起**时才有的旗标 ⇒ **这个 PS 是 `CreateObject` 自己启动的**。
  ⇒ 机制：**PS 已正常启动时**，`CreateObject` 去拉第二个实例 → 老实例不接交棒 →
  新实例约 3 秒退出 → **429**；**PS 完全没在跑时**，`CreateObject` 直接把它拉起来，
  它天然就是自动化服务器 → 一路可用。
- ⚠️ **更正我上一轮的"修法"**：不是"必须手动双击 `photoshop-with-automation.cmd`"，
  而是「**先把 PS 完全退出，再让 COM 去启动它**」。那个 `.cmd`（手动 `/Automation`）
  **方向一致但未实测**，降级为备选。详见 `docs/20` §一 错判 ③ / §五。
- ⚠️ **`docs/20` 三处自我更正**（都记在 §一，保留痕迹）
  1. 「没有 result 文件 ⇒ 卡在 COM 里」**错** —— `executeScript()` 的 `finally` 会删三个临时文件，
     而我的**实际采样间隔约 3.5 s**（`ps -W` 每次要跑 2~3 秒，不是我以为的 1 s）→
     **又一次被"观测精度"骗了**；
  2. 「PS 里挂着旧 ExtendScript」**已证伪**（重启后第一次调用依然失败、只有 1 个 PS、无残留）；
  3. 「必须手动带 `/Automation` 启动」**操作法说错了**（见上）。
- **本轮新踩的两个坑（清单里没有，已写进 `references/photoshop-mcp/README.md`）**
  1. **`Document.histogram` 只有 256 项（亮度），不是 RGB** —— 实测 `length===256`、白底读回 `[255]`。
     拿它做"像素回读"**只能判断亮度变没变**；真 RGB 回读要用插件侧的 UXP `imaging.getPixels`。
  2. **ExtendScript DOM 不能创建/转换内容图层** —— `layer.kind = LayerKind.SOLIDFILL` 被拒：
     `您只能将图层的类型更改为文本或正常。` ⇒ 形状/纯色填充**只能走 ActionManager**，
     而**猜 AM 描述符不可行**（我拼的 `Mk contentLayer` 报 `发生了常规 Photoshop 错误`）。
     **正路：用 ScriptListener / Alchemist 录真实描述符再照抄。**
- **这条对 `docs/18` 是直接解药**：S17「内容图层改色」卡住就是因为描述符是猜的；
  现在 MCP 通了 ⇒ 可以「录制 → 真机试 → 读像素验证」正路推进，不用再堆候选猜测。
  （顺带：20:15 插件重载后又跑了一次自检，**仍是 17/18，S17 FAIL** —— 结论没变。）
- **归档（用户要求）**：把 10-04 那次会话的四份资料收进仓库
  **`D:/ps-uxp-dev/references/photoshop-mcp/`**，并新写一份 `README.md` 索引：
  - `Photoshop-MCP-工具能力清单.md`（127 工具全清单）
  - `Photoshop-MCP-接入手册.md`（面向 AI 的接入手册）
  - `Photoshop-MCP-体验指南.md`（含三个同类开源项目底细）
  - `ps-com-check.vbs`（独立 COM 自检脚本）
  - ⚠️ README 里记了三件事：① `.vbs` 是 **ANSI/GBK**，**不要顺手转 UTF-8**（会弄坏它）；
    ② 《接入手册》把 429 归因为"受限环境伪影"，**与本会话实测不符**——
    我那两次 429 都是通过**宿主自己拉起的 MCP**发出的，而现在同一条通道可用，
    **差别在 PS 侧不在调用环境**；已在 README 里写明定案与理由；
    ③ 保留了它两条最值钱的"别硬试"结论（别在受限环境诊断、`extendscript_timeout` 的处理顺序）。
- **遗留 / 待确认**
  - ⏳ 手动 `/Automation` 启动 PS 是否也够（`tools/photoshop-with-automation.cmd` 未实测）
  - ⏳ **19:17 那个失败实例当时命令行有没有 `/Automation`** —— 没抓到，结论是推出来的（但很强）
  - ⏳ 第一次调用为何要跑满约 30 s（PS 只占 3 s）—— 疑似 DCOM 激活超时或端点安全扫描，未查明

---

## 2026-10-10　v0.2.4 —— 文字图层改色（第 14 次会话）

- **用户原话**：「刚才试了一下啊，形状图层已经可以用插件填充（alt+click），但文字图层还是不行」
- **先读日志（现场）**：`boot.log` 显示
  - `20:25:07 layer="矩形 1" family=content path=contentColorA 像素有变化` → **形状图层成功**
  - `20:25:31 layer="1234" family=text attempts=[preflight=拒绝(family=text)]` →
    **文字图层是 v0.2.3 主动拒绝的**，不是失败
- **澄清一个易混点**：**形状图层一直是好的**，S17 一直 FAIL 的是**纯色填充图层**
  （S17 用 `make contentLayer` 程序造的那种）。**同为 `family=content` 但子类型不同、AM 结构不同。**
  两者不矛盾 —— 顺手把 S17 标题加上 `⚠️ 已知限制` 措辞，避免以后被读成回归。
- **文字图层为什么不能用 `fill`（真机实测）**：
  用 v0.2.3 的像素族描述符打文字图层 → `命令"<未知的>"当前不可用`（`kind` 仍是 TEXT）
  ⇒ **当初那条前置拒绝的判断是对的**，至少没让 PS 弹框。
- **正确描述符 = 照抄 Adobe 官方文档**（*Photoshop API v2 · Text Layer Operations*）：
  ```json
  { "_obj":"set",
    "_target":[ {"_property":"textStyle","_ref":"property"},
                {"_enum":"ordinal","_ref":"textLayer","_value":"targetEnum"} ],
    "to":{ "_obj":"textStyle", "color":{"_obj":"RGBColor","red":..,"green":..,"blue":..} } }
  ```
  - **我猜的两版全败**（都是"不报错、像素也不变"）：`_target` 写成一级 + 把颜色套进
    `to.textLayer.color`（或 `to.textLayer.textStyle.color`）。
  - **三个硬点**：① `_target` **两级**，第一级是 `textStyle` **属性**；
    ② 颜色在 `to.textStyle.color`；③ JSX 侧 `putProperty` 必须**先**于 `putEnumerated`
    （颠倒会直接报 `命令"设置"当前不可用` —— 这条错得响，不像前两条静默）。
  - **真机判别实验**（黑字白底 400×400，判据取合成直方图的最低占用亮度）：
    `base=[0,255,17]` → 改色后 `[71,255,17]`（0→71 = #E60012 的亮度 ✓）；
    **`kind` 全程 `LayerKind.TEXT`** ⇒ **非破坏性，文字保持可编辑**。
- **实现（v0.2.4）**
  - `lib/ps.js`：新增 `textColorDesc()` 与 `makeTextLayer()`（自检专用）；
    `fillPreflight()` **移除文字拒绝**；`fillLayer()` 新增 `textColor` 路径 + 文字族错误文案；
    文件头"三条结论"扩成四条；导出两个新函数
  - `tools/palette.js`：成功文案按族分叉（文字族说「已把 X 的**文字颜色**改为 #XXX（文字仍可编辑）」；
    **有选区时补「文字颜色是整层属性，未按选区裁剪」**）
  - `lib/selfcheck.js`：**新增 S18**（真机钉三件：`kind=text` / **像素真的变了** / **改完仍是文字图层**）；
    S17 标题加「已知限制」；version → 0.2.4
  - `index.js` / `manifest.json`：version → `0.2.4`
  - `tools/offline-smoke.cjs`：**断言 20 重写**（从"0 条命令"改成"发 `set` + 两级 `_target`
    + 颜色在 `to.textStyle` + **0 条 `fill`**"）；顺带修 mock 一个污染 bug
    （原来"只要带 `_property` 就写 `colorState`"，文字命令的 `_property:"textStyle"`
    会被当成颜色槽 → 改成只认 `foregroundColor`/`backgroundColor`）
  - `docs/21-文字图层改色.md` 新建
- **自证**
  - **真机自检 18/19**（新增 **S18 PASS**）：
    ``` 
    S18 PASS :: 建层 kind=text　family=text　路径=textColor
                改前=#000000 → 改后=#91000B　目标=#E60012
                改完 kind=text　attempts=[textColor=已执行/像素有变化]
    ```
    📌 `改后=#91000B ≠ #E60012` **正常** —— 像素回读是**整层平均色**，文字只占图层一部分
    （含大量透明像素），必然是混合色 ⇒ S18 判据用「**有变化**」而非「等于目标色」。
  - **离线结构回归 25/25**（断言 20 把命令形状钉死：`_target` 级数=2、t0/t1 内容、`to._obj=textStyle`、0 条 fill）
  - 语法 / JSON 检查全过
  - **重载是我自己驱动的**：`node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin load --manifest vellum-toolbox/manifest.json --apps PS` → `Plugin Load Successful`（不用麻烦用户）
- **两个真机坑（写进 `makeTextLayer()` 注释）**
  1. 点文字的**锚点在基线上、字往上长** —— 300pt 的字在 400×400 画布里**完全在画布外**，
     不 `move` 一次像素回读只会拿到空白 → **会误报成"改色无效"**（我第一版就是这样）；
  2. 字号单位必须用 `pointsUnit`。
- **遗留 / 已知限制（诚实清单，见 `docs/21` §七）**
  - ⏳ **「纯色填充图层」改色仍未解决**（S17 的 FAIL 是**已知限制，非回归**）——
    要解决得上 ScriptListener / Alchemist 录真实描述符（PS 2026 没随装 ScriptListener，
    见 `docs/20` 末段；**现在 MCP 通了，这条路可走了**）
  - ⏳ 文字的**选区语义**：整层属性，不按选区裁剪（面板会明说）
  - ⏳ 文字的**层内混排**（不同片段不同色）未做（需 `textStyleRange` 的 from/to 区间）
  - ⏳ **未测**：中文文字、段落文字、多字体混排、带图层样式/变形的文字

---

## 2026-10-10　M2 素材库开工第一步 —— 地基探针 S19（第 14 次会话）

- **用户原话**：「成功！接下来做什么？」→ 选定「开下一屏功能」→ 按里程碑进 **M2 素材库**
- **先探地基，不先写 UI**：`docs/10` §10.5 把路线 ②（镜像单写）押在一个**尚未单独实测**
  的环上 ——「插件读自身 PluginData 的图片文件并渲染」。它不成立，整条路线都要改。
- **做法**：在 PluginData 下造**假镜像**（真数据取自 `D:/vellum_workspace/_thumbs` 的
  webp + 手写 `manifest.json`），加真机自检 **S19** 读它、渲染它。
- **结果（S19 PASS，但内含一条平台约束）**
  - ✅ 清单读得出 + JSON.parse（2 条项目文件 / 1 条品牌）
  - ✅ 二进制读到 **4814B（与磁盘一致）**、文件头魔数 **`RIFF`**
    （= 拿到的是真二进制；不传 `format` 会按文本解码 —— 只比"有没有内容"会被骗过去）
  - 🔴 **渲染：webp 全败、png/jpg 全成**
    ```
    webp-alpha (VP8X 带 alpha)    dataURL ✗  blobURL ✗
    webp-plain (VP8 有损无 alpha)  dataURL ✗  blobURL ✗
    png                           dataURL ✓  blobURL ✓
    jpg                           dataURL ✓  blobURL ✓
    ```
- **结论：UXP 的 `<img>` 不解码 webp（平台约束）** ⇒ `docs/10` §10.6
  「缩略图直接复用 `_thumbs`（webp），不重新生成」**被推翻**。
  ⇒ 修正：**`_thumbs` 不动**（VellumDesk 自用，它自己渲染支持 webp），
  **只在写镜像那一步转码成 png/jpg**。带透明 → PNG；无透明 → JPEG。
  ⇒ `docs/10` §10.6 的体积预算（webp 4.2 KB/张 → 3000 张 23.4 MB）**要重算**。
- **方法学教训（第五次踩这类坑，已存进档案）**：**多嫌疑并存时，先造一个"必定成功"的
  基准把变量分开。** 首版探针只测 webp、容器用 `opacity:0.02` —— 两个嫌疑（格式 / 可见度）
  同时存在，"渲染失败"根本无法归因；第二版补上 **PNG 基准**才发现 png 是成功的，
  于是"容器不透明"被排除，只剩格式。**否则会把平台约束误判成自己的 bug，或反之。**
- **顺带拿到的事实**
  - `getDataFolder()` → `getEntry` 逐级进子目录 → `read({format: formats.binary})` → ArrayBuffer
    **整条链可用**（`lib/data.js` 新增 `subfolder` / `readTextIn` / `readBinaryIn`）
  - `ArrayBuffer → data URL` 与 `→ Blob → objectURL` **两条路都通**（体积上 blobURL 更省 33%）
  - 容器**必须可见**：`display:none` 里 UXP 不加载图片（表现为"超时"，§10.2 已知）
  - `_thumbs` 的真实缩略图**带 alpha**（f1 是 VP8X flags=0x10）⇒ JPEG 会丢透明，**PNG 是保底解**
- **新增/改动文件**：`lib/data.js`（+3 函数）、`lib/selfcheck.js`（+S19）、
  `index.js` / `manifest.json`（0.2.5）、`docs/11-素材库联动方案.md`（新建）、
  `docs/10`（§10.5/§10.6 实测更正）、`docs/README.md`、`DECISIONS.md`、本文件
- **遗留 / 待办**
  - ⏳ PNG/JPEG **真实体积量级未实测**（本机工作区无现成 jpg；p2.jpg 是 PS 导的纯色，不具代表性）
  - ⏳ 插件侧「镜像读取层 + 网格 UI + 插入」未开工
  - ⏳ **VellumDesk 侧须单独立方案**（写镜像 + 缩略图转码 + 动态定位 PluginData 路径）
  - ⏳ 假镜像留在 PluginData 里（不进 git），供 M2 开发期继续用

---

## 2026-10-10　M2 第二步：契约同步 + 镜像读取层落地（第 15 次会话）

- **用户拍板**：「先冻结契约 → 两边并行，插件侧先跑通」；并明确**通用库的内容范围** =
  **公司通用素材 + 用户自积累素材**（跨任务包的公司/个人素材池），不只是"品牌识别素材"。
- **开工前先读权威契约**（`D:/vellum-link/LINK-CONTRACT.md`，`vellum-link/1`）——
  **发现一处实测冲突**：契约 **§5.5 写着缩略图用 `webp`**（"直接复用 `_thumbs` 产物"），
  而本项目 S19 已证明 **UXP 不解码 webp**。→ 必须先改契约。
- **契约同步 5 处**（按 §十 流程；已在 `LINK-LOG.md` 发 `[插件侧]` 公告，**待软件侧确认**）
  - §5.5 缩略图格式 `webp` → **`png`（默认，保透明）/ `jpg`**；命名 `<assetId>.<ext>`
  - §9.1 新增第 7 条（`<img>` 不解码 webp）、第 8 条（**能**读子目录与二进制）
  - §六 「前置待实测」→ 已验过一半；§2.3 进度表 → 🔷 地基已实测通过
  - §5.3 补注通用库的内容范围
  - **不升契约版本**（仍 `vellum-link/1`）：改的是**文件格式约定**，`asset.thumb` 仍是路径字符串，
    扩展名自带格式信息，协议结构未变
- **新增 `tools/fake-vellumdesk.cjs`**（契约 §11 要求的**假软件桩**）：产出**契约合规**镜像
  （manifest + task + brand + 5 张 PNG + handoff/），纯 JS 编码 PNG（不依赖图像库），
  支持 `--task-rev` 模拟变更、`--clean`、`--dir`、`--major`。
  ⚠️ 自查出并修掉一个 bug：`generatedAt` 曾用 `toISOString()` 换后缀 → **UTC 配东八区，差 8 小时**。
- **新增 `lib/mirror.js`**（**只读**镜像，契约 §八 写者唯一性）
  - `readManifest()`（**先校验 contract，不认识就降级**，不崩不猜）/ `readScope()`
  - `flatten()` 树→扁平列表 + **面包屑**；`thumbUrl()`（**换 revision 统一 revoke**，防泄漏）
  - `insertPlan()` 按 kind/ext 分派；`watch()` 每 3 秒比对 `scopes[].revision`
  - **webp 防御**：读到 `.webp` 直接给可读错误，不让 UI 出一堆空白格
- **S19 重做**：从"能力探针"改为"**契约读取层回归**"（旧的测自拟结构，目录已被 `--clean` 清）
  ```
  S19 PASS :: 契约=vellum-link/1 ✓　scopes=[task:rev87 brand:rev3]
              任务库=2 条　通用库=3 条　缩略图=320x240 / 584B
              webp 防御=已拦截 ✓　首条面包屑=海南升学集训营 › 开营海报-2026秋季 › V1
  ```
- **自证**：真机自检 **19/20**（dur=12850ms；唯一 FAIL = 已知 S17）、离线回归 **25/25**、版本 **0.2.6**
- **新增/改动**：`lib/mirror.js`（新）、`tools/fake-vellumdesk.cjs`（新）、`lib/data.js`、
  `lib/selfcheck.js`（S19 重做 + 清单 + 版本）、`index.js` / `manifest.json`（0.2.6）、
  `docs/22`（新）、`docs/11`（§三 改指针 + §四 进度）、`docs/README.md`、`DECISIONS.md`、
  **`D:/vellum-link/LINK-CONTRACT.md`（5 处）+ `LINK-LOG.md`（3 条公告）**
- **遗留 / 待办**
  - ⏳ **素材库 UI 未做**（本轮只到读取层）—— 下一步；⚠️ 必须绕开 UXP CSS 子集（**不用 Grid / 不用 gap**）
  - ⏳ 「插入」只做了分派逻辑，**真插入依赖软件侧的 handoff 握手**
  - ⏳ `watch()` 轮询未真机验证；契约 §六 的「能否 createFolder / 删自身文件」仍未验
  - ⏳ **待用户去软件侧会话同步契约变更**（`LINK-LOG.md` 已公告）

---

## 2026-10-10　M2 第三步：素材库界面 + 置入链路（第 16 次会话，v0.2.7）

- **用户原话**：「做吧」（接上轮「先冻结契约 → 两边并行，插件侧先跑通」）
- **交付**：`tools/library.js`（新）—— 库切换 chips（**由 `manifest.scopes[]` 动态生成**）/ 分组筛选 /
  缩略图网格（3 列，flex-wrap + 百分比）/ 选中详情 / 每 3 秒对 revision 自动刷新 / 置入；
  `lib/handoff.js`（新）—— 契约 §六 的取图握手。
- 🔴 **本轮最重要的实测：`placeEvent` 的 `_path` 不接受裸路径**
  - 我原本设计了"策略①：把 `asset.absPath` 直接交给 PS，省掉整条搬运"。
    真机 S21 第一版直接打掉：`err=Error: invalid file token used`。
  - 正路（已实测）：**沙箱内 Entry → `createSessionToken` → 令牌 → `_path`**。
    真机两次一致：`图层数 1 → 2　changed=true　新图层=「401」`。
  - ⇒ 能拿到 Entry 的只有 ① 插件自身 PluginData ② 用户经文件选择器授权；
    用户的 `absPath` 两者都不是 ⇒ **直连置入在架构上不成立**，
    契约 §六 的 handoff **从"设计选择"升级为"平台约束"**（软件侧必做，不是可选优化）。
  - 已按契约 §十 流程改权威源：**§9.1 新增第 9/10 条**、§六 前置待实测改"已验过"、§2.3 进度表；
    `LINK-LOG.md` 发 3 条 `[插件侧]` 公告（**待软件侧确认**）。
- **S22 探针主动标为「无结论」**（自己抓到自己的一处不严谨）
  - 问的是"能不能直读沙箱外的绝对路径"，做法是用**沙箱内路径当基准**对照。
  - 首版读数：基准也失败（`Could not find an entry of 'file:///…'`）——
    而我把结论写成了「沙箱外不可读 ⇒ 直连不可行」，**这是错的**：基准失败 ⇒ 分不清权限边界还是用法不对。
  - 改法：结论**分三档**（基准失败 = 无结论），契约 §9.1 第 10 条如实记"待查"，**没有**据此改架构。
    这是本项目第五次踩同一类坑（**没有基准的失败实验 = 没做实验**），已写进 docs/23 §三。
- **顺带修掉的真缺陷：`lib/log.js` 并发写日志互相覆盖**
  - 真机日志里出现过**被拦腰截断**的行 `task:87|brand:3 thread=vellum-link/1`，
    完整的那行整个消失 —— 自检本身并发写日志，所以它已经让我**看丢过一条关键记录**。
  - 修：内存缓存全文 + 所有 append 排进**同一条 Promise 链**（串行化）。
- **另一处自己坑自己：S20b 量到了上一个库的数据**
  - 判据写成"网格里有东西"，而**旧网格还在 DOM 里** → 第一轮就命中 → 切到通用库却量到 2 张（任务库的数）。
  - 改成"等**新的**库渲染完"（active chip + 卡片数等于期望）→ PASS。
  - 同时把 S20 的**期望值改成从原始 JSON 自己数**（递归找 asset 形状的对象），不复用 `mirror.js` 的展平结果
    —— 否则是"拿自己的输出验自己"。
- **自证**
  - 真机自检 **23/24**，连跑两次一致（`21:37:53 dur=13710ms` / `21:39:23 dur=13760ms`；唯一 FAIL = 已知 S17）
    ```
    S20  库 chips=2/2　筛选行=3　卡片=3（自数期望 3）　缩略图 3/3 解出尺寸　详情行含「品牌标识.png」=true
    S20b 切到 task → 卡片=2（自数期望 2）
    S21  令牌=session-token/20…　图层数 1 → 2　changed=true　新图层=「401」
    ```
  - 离线结构回归 **32/32**（新增 22~28：注册表上线 / 空态降级 / 不碰禁用特性 /
    handoff 请求形状与 reqId 唯一 / placeEvent 形状 / 裸路径必须拒绝 / Entry→令牌→place）
- **改动文件**：`tools/library.js`（新）、`lib/handoff.js`（新）、`lib/ps.js`、`lib/data.js`、
  `lib/log.js`、`lib/selfcheck.js`、`index.html`、`tools/index.js`、`index.js`、`manifest.json`、
  `tools/offline-smoke.cjs`、`docs/23`（新）、`docs/README.md`、`docs/11`、
  `D:/vellum-link/LINK-CONTRACT.md` + `LINK-LOG.md`、`DECISIONS.md`
- **遗留 / 待办**
  - ⏳ **端到端置入未跑完** —— 只验到"插件侧链路通"，真正走一次要等软件侧实现 `res.json`
  - ⏳ `dblclick` 置入未验；`object-fit` 是否真生效（图形显示出来但**有没变形**没看）
  - ⏳ **revision 真的变了**时的自动刷新未验（`tools/fake-vellumdesk.cjs --task-rev 88` 就是为此准备的）
  - ⏳ 窄面板（`minimumSize.width=260`）下的换行/字号未验
  - ⏳ S17（纯色填充图层改色）、品牌 HEX、号位 chip 去留 —— 三项老遗留不变

---

## 2026-10-10（跨零点）　软件侧三处加法的确认与落地（第 17 次会话，v0.2.8）

- **用户原话**：「软件侧按 §十 提了这三处加法，请它确认（②/③ 若要用于筛选/建树则实现；
  用不到就按"忽略未知字段"处理即可）。」
- **先读权威源**（`LINK-LOG.md` 末尾 + 契约 §5.3/§5.4/§5.5）：软件侧已按 §十 改完正文，
  三处都是**加法**（不升版本）：① 缩略图命名空间（`t<b>`）② `asset.source` ③ `groups[].parentId`。
- **结论：三处全部接受；②③ 都实现**（不是"忽略未知字段"）
  - **③ 必须做**：不做两级，筛选行会把**父组与子组平铺成同级 chip**（父组点了没素材、子组却并列）
    —— 那是**错的 UI**，不只是缺功能。展平时解析成 `group`(顶层)/`sub`(子组)，
    按 `sortOrder` 排且**父组在前、子组紧随**；容错一律"当顶层、**绝不丢素材**"
    （缺失/null/空串/指向不存在的组/三层以上都有对应处理）。
  - **② 做，但只在"能起区分作用"时出现**：「来源」行仅在**当前分组内**真有 ≥2 种来源时画；
    卡片角标同一套规则；详情行始终显示。⚠️ 取值必须基于"只按分组筛过"的集合算，
    否则一点「我的」，可见集合只剩一种来源，那一行会自己消失。
  - **① 零改动**：`asset.thumb` 一直是不透明路径，插件从不解析文件名。
- 🔴 **① 暴露了插件侧一个真实缺陷（本轮最有价值的一条）**
  - `lib/mirror.js` 的**缩略图缓存键原来用 `asset.id`**，而**两库 id 各自从 1 起** ⇒ 同 key；
    唯一的保护"revision 变了就 `clearThumbs()`"**兜不住"两库 revision 恰好相等"**
    （首次同步后 `task rev=1` / `brand rev=1` 正是这种情形）⇒ **切库后显示上一个库的缩略图**
    （不报错、不空白，只是图不对）。
  - 修：键改为 **`asset.thumb`**（自带命名空间）；离线断言 32 用"同 id、同 revision、只差 thumb"
    的两个 asset 钉死。⚠️ **未真机复现**（需要两库 revision 相等）。
- **顺带修掉自检自身的竞态 —— 同一族缺陷的第二次**
  - 现象：**同一份代码连跑两次结果不同**（00:22 `25/26` / 00:24 `23/26`）。
  - 归因：`tools/library.js` 的 `switchScope()` 是异步的，而 S20b 结尾"切回原库"那次点击
    **没有被等待**；S20c 紧接着操作筛选行，而它等的条件「tab 高亮 + 网格里有卡片」
    **会被上一个库留下的旧网格满足** ⇒ 量到的是旧库的筛选行。
    第一轮碰巧过关（旧网格属于同一个库），第二轮显形。
  - 修：网格加 **`data-scope` / `data-rev`**，自检的等待条件**点名是哪个库**。
  - **做法确立：改完自检要连跑两次，且两次起始状态要不同** —— 这条缺陷就是这么抓出来的。
    （教训一句话：**判据要描述"我等的那个东西"，不是"看起来像的东西"。**）
- **自证**
  - 真机自检 **25/26，连跑两次一致**（两次起始库都是"通用库"= 上一轮失败的那个状态）；
    唯一 FAIL = 已知 S17
    ```
    S19  通用库=4 条　两级分组=子组 1 条　来源=company:3|user:1　缩略图=320x240/584B
    S20  筛选区行数=2　卡片=4（自数期望 4）　缩略图 4/4 解出尺寸
    S20c 顶层就出现子组 chip？false ✓　父组「公司素材」count=3 → 卡片=3（期望 3）　子组「节日素材」→1
    S20d 来源={"company":3,"user":1}　取「user」→1（期望 1）　切单来源父组后 chip 消失=true ✓
    S21  测试文件=t401.png（命名空间命名）　图层数 1→2
    ```
  - 离线结构回归 **36/36**（新增 29~32：两级解析 / 三层与坏 parentId 当顶层不丢素材 /
    `source` 可选与顺序 / 缩略图缓存键不串库）。mock 补了 `read({format})` 与 `formats.binary`。
- **改动文件**：`lib/mirror.js`、`tools/library.js`、`index.html`、`lib/selfcheck.js`、
  `tools/fake-vellumdesk.cjs`（命名空间缩略图 + 两级分组 + source，并清理上一版遗留缩略图）、
  `tools/offline-smoke.cjs`、`index.js` / `manifest.json`（0.2.8）、`docs/24`（新）、
  `docs/23`、`docs/README.md`、`DECISIONS.md`、本文件；跨项目 `LINK-LOG.md` + `LINK-CONTRACT.md §2.3`
- **遗留 / 待办**
  - ⏳ 串图缺陷未真机复现；两级分组**只验到两层**（三层走"当顶层"兜底，无真机样本）
  - ⏳ 来源筛选只验 `company`/`user` 两种取值
  - ⏳ 老遗留不变：S17（纯色填充图层改色）、品牌 HEX、号位 chip、端到端置入（等软件侧 `res.json`）、
    窄面板适配、`dblclick`、`object-fit` 是否真生效、revision 真变时的自动刷新

---

## 2026-10-11　两个界面需求的可行性评估（第 18 次会话，v0.2.9）

- **用户原话**：「插件中筛选通用库内素材现在用的是 2 层按钮，UI 表现有些臃肿，我觉得可以这样：
  一层目录（公司素材、我的收藏）仍保持按钮；二层目录在按钮下方设计一个**下拉选择控件**（样式沿用目前风格）。
  另外，是否可以实现**素材拖动到画布指定位置**？以上两个需求可以先评估一下。」
- **本轮只评估、不动业务代码**；新增诊断项 **S23**（`lib/selfcheck.js`）把能力问清楚。
- **外部证据（决定性）**：Adobe Asset Link UXP 官方文档明写「**UXP 框架不支持从面板拖放资产到当前文档，
  请改用置入副本**」；官方 *Known UXP Issues* 也写「Drag and Drop is not currently supported」。
  论坛 2026-06 有 Adobe 员工称修复**已合入、待发版** ⇒ 将来可能可用，**本机现在不可用**。
- **真机实测（S23，PS 27.2.0 / UXP 9.0.2）**
  - **① 原生 `<select>`：能用，但读值要绕道**
    `setAttribute("value","festival")` 后 `.value` = **`"undefined"`**（官方 known-issues 的坑，真实存在）；
    改走 `option[1].selected = true` 后 → `selected=true` / `selectedIndex=1` / `.value="festival"` ✅
    ⇒ **纪律：设选中态只能用 `option.selected`**。
  - **② Spectrum `sp-picker` / `sp-dropdown`：不可用**
    与**伪造标签名** `sp-not-a-real-thing-xyz` 的三项读数**逐项相同**（未注册 / 无 shadowRoot / display=block）；
    而 `customElements.define/get/whenDefined` **都是 function**（注册表真实存在）⇒ "未注册"是可信读数。
    ⚠️ **我第一版判错了**：用"设了宽高后几何=120x24"当"渲染出来了"的证据 —— 伪造标签名同样 120x24。
    （同族错误**第六次**：判据描述的是"看起来像的东西"，不是"我等的那个东西"。）
  - **③ 标准拖放不可用**：`draggable` 属性会被记住，但 **`DataTransfer = undefined`**
    ⇒ 拖放**没有数据通道**。与官方两条口径一致。
  - **④ 鼠标事件有实物基准**（调色板 hover/click/dblclick 在生产里跑着）；
    `setPointerCapture`/`releasePointerCapture` 都是 function；`on*` 反射属性为 false（**不影响 addEventListener**）。
- **需求 B 的技术半边 —— 已验到像素级（MCP 真机，临时文档 400×400，素材 320×240）**
  ```
  默认(offset 0,0) → 图层 bounds = 40,80,360,320      ⇒ 画布居中、不缩放
  offset (64,48)   → 图层 bounds = 104,128,424,368    ⇒ Δ 正好 +64/+48，1:1 精确
  ```
  ⇒ **`offset` 是像素级精确的定位参数**。插件要"放到 (x,y)"只需
  `offset = (x − (画布宽−素材宽)/2, y − (画布高−素材高)/2)` —— 画布尺寸来自 `docInfo()`、
  素材宽高来自镜像 `asset.width/height`（契约 §5.4 必填）⇒ **不需要任何新能力**。
- **未验（如实标注）**
  - `<select>` 的**下拉弹层**能否正常打开（要真点击；本轮只验了"能建、能读值"）
  - **选区当落点**：ExtendScript 侧带区域的 `select()` 五种写法全失败、`deselect()` 也失败，
    **但基准 `selectAll()` 成功** ⇒ 只能说明"那几种区域写法不行"，**不能**说"选区不可用"；
    且失败的是 **legacy ExtendScript DOM**，插件走 **UXP/AM 是另一条路** ⇒ 记为**待单独探针（S24）**
  - 置入后**按目标矩形缩放**（`offset` 只管位置、不管尺寸）
  - 自绘拖拽的**真鼠标触发**（合成事件不算）
- **评估建议（详见 `docs/25`）**
  1. 需求 A → **自绘下拉**（原生 select 样式改不动、sp-picker 实测死掉；自绘的唯一真风险已有纪律：
     浮层不得覆盖触发条 —— 调色板振荡回路那次）
  2. 需求 B → 先做**九宫格落点**（零新能力依赖），再做 **(c) 选区落点**（最贴近"指定位置"，但要先验）
  3. **真拖放不做**，在 docs 里留"等 Adobe 修"的观察点
- **改动**：`lib/selfcheck.js`（+S23 诊断项）、`index.js` / `manifest.json`（0.2.9）、
  `docs/25-两个界面需求的可行性评估.md`（新）、`docs/README.md`；ccx 重打

---

## 2026-10-11　两个界面需求落地：自绘下拉 + 九宫格落点（第 19 次会话，v0.3.0）

- **用户原话**：「欧克，按你规划的推进吧」→ 按 `docs/25` 的建议执行：
  **A 二层筛选改自绘下拉** + **B 九宫格落点**，并**并行验 S24 选区落点**。
- **A 自绘下拉**（`tools/library.js` + `index.html`）
  - 触发条「当前子类 + 计数 + ▾」→ 点开是浮层列表（「全部子类」+ 各子组 + 计数）；一层仍是按钮。
  - 纪律：**浮层不覆盖触发条**（下方 +6px 间隙）/ 关层由**容器根节点正着判**、不绑 `mouseout` / 展开态幂等。
  - 🔴 **新增一条可测不变量**：`.scroll` 有 `overflow-y:auto` ⇒ **浮层越界会被裁掉**
    （用户只会看到"点开了但里面是空的"）。S20c 里变成硬判据，真机读数
    `浮层 24,161,110,214　滚动容器 0,34,420,647　完全在容器内=true`。
- **B 九宫格落点**
  - `lib/ps.js`：`docInfo()` 补画布宽高；新增 `anchorOffset()`（纯函数）/ `readActiveLayerBounds()`；
    `placeDesc(path, offset)`；`placeFile()` 支持 `opts.offset` + `opts.expectRect`
    并**读回真实图层 bounds 逐边比对**（容差 1px）—— 不是"命令没报错就算成功"。
  - 详情区 3×3 落点格（左上→右下、居中在中间），锚点记进 `library-pref.json`。
- 🔴 **S24 探针的两个发现（其中一个改了设计）**
  1. **插件侧能建选区，且写法与 ExtendScript 恰好相反**：
     `DOM.select(...)` 两种写法 ✗、`DOM.selectAll()` ✗、
     **`AM.setd(Chnl/fsel + Rctn)` ✓**（建出 120,140,320,300）。
     而 ExtendScript 侧是 `selectAll` **行**、区域写法 **全不行** ⇒ **两条 DOM 不能互相推断**
     （这正是当时坚持"结论不许迁移"的价值）。可用写法已收进 `setSelectionRect()`。
  2. **默认落点 = 选区中心；无选区 = 画布中心**（都不缩放）：
     无选区 → bounds `40,80,360,320`；有选区 `120,140,320,300`（中心 220,220）→ `60,100,380,340`。
     ⇒ **改了设计**：`offset` 是**相对默认落点**的位移，所以九宫格基准**绝不能用画布中心**
     ⇒ 新增 `placeBaseCenter()`，`anchorOffset()` 加 `base` 参数。
     附带事实：**这次置入会把选区吃掉**（S25 读数 `【置入后选区=无】`）
     ⇒ "框哪儿放哪儿"是**每次插入前框一次**，已写进界面提示。
- **S25 落点组合回归项**：四步逐边比对 —— ①无选区·左上→0,0 ②基准报 selection(220,220)
  ③有选区·居中→仍居中于画布 40,80 ④**有选区·左上→0,0**（只有 offset 叠在选区中心上才会是 0,0）。
  - ⚠️ **④ 第一次是 FAIL 的**（落到 −20,−20 = 画布中心+offset）。③过④不过 ⇒
    **任何单一规律都无法同时解释两步** ⇒ 说明两步之间选区没了。
    **没改判据去迁就它**，而是加"选区存活读数" → 一跑就看到 `【置入后选区=无】`
    ⇒ 给 ④ 补"重建选区"这个**必要前置**，并把这件事当事实记下来。
- **⚠️ 一次未复现的失败（如实记录）**：v0.3.0 第二轮（01:48:28）S20c FAIL，
  读数 `触发条存在=true·点开=true　浮层几何始终为 0`、子组选项找不到；
  **同一份代码前一轮与之后连续三轮都 PASS**。那条读数**分不清三种可能** ⇒ 没猜，而是补了两个
  能把原因区分开的读数：`libBarSig()`（筛选区结构签名）+ `libPopInsideScroll()` 失败分支同时报
  **展开态现在是什么** 与 computed display（明确区分"状态还在、是没进布局"与"展开态没了"）。
  **现状：加插桩后连跑三次均 PASS，该失败未复现 —— 不宣称已解决，也不宣称不是问题。**
- **自证**
  - 真机自检 **28/29，连跑三次稳定**（01:51:56 / 01:53:40 / 01:54:47；唯一 FAIL = 已知 S17）
    ```
    S20c 顶层平铺的子组按钮=0　触发条存在？false　父组「公司素材」→ 卡片=3
         触发条出现=true·点开=true　浮层不越界=true　子组选项「节日素材」→ 卡片=1
         选完自动收起=true　筛选区签名=frow{chip:"",chip:"公司素材",chip:"我的收藏"}|frow.mid{wrap{open=false},trig,pop,opt:"",opt:"节日素材"}
    S24  插件侧建选区=AM.setd ✓120,140,320,300（DOM 三种写法全 ✗）　有选区置入=60,100 ⇒ 居中于选区
    S25  ①无选区·左上 offset=-40,-80 → 0,0 ✓　②基准=selection(220,220) ✓
         ③有选区·居中 offset=-20,-20 → 40,80 ✓　【置入后选区=无】
         ④有选区·左上 offset=-60,-100 → 0,0 ✓　【置入后选区=无】
    ```
  - 离线结构回归 **40/40**（新增 33~36：九宫格换算 / 边界与非法输入 / placeDesc 的 offset 形状 /
    界面不碰原生 `select` 与 `sp-*`）
- **改动**：`lib/ps.js`、`tools/library.js`、`index.html`、`lib/selfcheck.js`（S20c 改版 + S24 + S25）、
  `tools/offline-smoke.cjs`、`index.js` / `manifest.json`（0.3.0）、`docs/26`（新）、`docs/README.md`
- **遗留 / 待办**
  - ⏳ **S20c 那次失败未复现、未找到根因**（插桩已就位）
  - ⏳ **置入后按目标矩形缩放**未做 —— `offset` 只管位置、不管尺寸（素材不会填满选区）
  - ⏳ 自绘下拉的**键盘操作**未做；**真鼠标拖拽**未验
  - ⏳ 老遗留不变：S17、品牌 HEX、端到端置入（等软件侧 `res.json`）、窄面板适配
