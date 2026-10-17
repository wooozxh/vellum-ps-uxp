# 技术决策记录

> 记录格式：**日期 / 决定 / 为什么 / 放弃的方案**
> 做了技术决策就往这里追加。**不要推翻这里已验证过的结论** —— 要推翻，先说服用户。

---

## 2026-10-09　工作模式选「vibecoding」，不按人类开发者画像准备资料

- **决定**：用户提需求和验收，AI 写代码并自己验证。
- **原因**：用户明确表示「我还是想用 vibecode 的方式让你帮我做」。
- **影响**：项目里的一切都围绕「可脚本驱动的反馈闭环」设计，而不是教程 / 学习路径 / 编辑器体验。
  早期按人类开发者准备的资料（学习路径、上手教程）价值下降；VS Code 保留（AI 也会用它）。
- **放弃**：按「零基础开发者」画像准备（那是上一个项目 VellumDesk 的画像）。

## 2026-10-09　主技术路线选 UXP，不用 CEP

- **决定**：插件用 UXP。
- **原因**：CEP 已被 Adobe 弃用；UXP 是当前唯一在持续维护的扩展路线，且 PS 2026 内置 UXP 运行时。
- **放弃**：CEP（历史包袱，官方已不推荐新项目使用）。

## 2026-10-09　加载通道用 CLI —— 因此 Creative Cloud 与 GUI 版 UDT 都不是必需

- **决定**：用 `@adobe-fixed-uxp/uxp-devtools-cli` 驱动插件的加载 / 重载 / 日志，**不用图形版 UXP Developer Tool**。
- **原因**：AI 需要的是**能被脚本驱动的加载通道**，不是可视化工具。该 CLI 自带完整原生桥接
  （`AID.dll` / `VulcanControl.dll` / `VulcanMessage5.dll`，与 GUI 版是同一套），实测在 Node 22 上跑通。
- **影响**：**用户原计划下载的 Creative Cloud 可以停**（除非还想要别的 Adobe 应用）。
- **放弃**：CC → GUI UDT 路线（额外收获只有图形界面，依 vibecoding 基本用不上）。

## 2026-10-09　不用 npm 上的 `@adobe/uxp-devtools-cli@1.2.0`

- **决定**：用社区维护的 fork `@adobe-fixed-uxp/uxp-devtools-cli`（v1.6.7）。
- **原因**：npm 上 `@adobe/uxp-devtools-cli` 是 2020 年的老包（npm 页显示 "Published 6 years ago"），对现代 PS 无效。
- **放弃**：`@adobe/uxp-devtools-cli`（老包）。

## 2026-10-09　反馈闭环走文件，不走 `console.log`

- **决定**：插件把自检结论写成 `report.json` 落盘，外部脚本读文件判断对错。
- **原因**：UXP 插件跑在 Photoshop 进程内，`console.log` 只进 UDT 调试窗口，**外部脚本读不到**。
  文件是唯一双方都能访问的通道。报告落在 `%APPDATA%`，所以**项目在 D 盘、报告在 C 盘是正常的**。
- **放弃**：依赖 GUI 调试窗口读日志（不可脚本化）。

## 2026-10-09　自检的开关放「文件」而非「代码」

- **决定**：`hello-uxp/autorun.flag` 存在 → 每次加载插件自动跑全量自检；删掉即关闭。
- **原因**：开关放文件，外部脚本能一键切换；放代码则要改代码 + 重载才能切。
- **影响**：`plugin watch` 的重载就等于「跑测试」，全程不用点面板。

## 2026-10-09　插件清单用 manifest v5

- **决定**：`manifest.json` 用 manifest v5。
- **原因**：官方当前版本。关键差异：UI 入口改用 `entrypoints`；**权限默认全关**（用到什么必须显式声明）；
  **`host` 字段仍是数组**（照官方 v5 样本 `invisible-plugin-sample` / `swc-uxp-starter` 校准 ——
  早期误写成对象，已修正）。
- **放弃**：v4（旧版本）。

## 2026-10-09　所有脚本路径无关，禁止硬编码绝对路径

- **决定**：脚本一律用相对路径或系统变量定位（`%~dp0..` / `import.meta.dirname` /
  `%CommonProgramFiles%` / `%APPDATA%`）。
- **原因**：用户偏好「代码工程放 D 盘、路径纯 ASCII 无空格无中文」。路径无关 = 整目录可随时搬迁、零改动。
- **已验证**：工作区从 C 盘迁到 D 盘后，脚本**无一需要修改**，自检结果与搬迁前完全一致。

## 2026-10-09　工作区放 `D:\ps-uxp-dev`

- **决定**：项目根 = `D:\ps-uxp-dev`（2026-10-09 从 `C:\Users\17736\WorkBuddy\VellumDesk Dev\ps-uxp-dev` 迁来）。
- **原因**：用户习惯代码工程放 D 盘（`D:\proj_media`、`D:\vd\VellumDesk`）；C 盘已用 78% 只剩 54G，D 盘剩 184G。
- **注意**：有两样东西**必须留在 C 盘**，但都与项目位置无关 ——
  ① `C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json`（开发者开关，Adobe 只从这儿读）
  ② `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<ver>\...`（插件运行时数据，`report.json` 在这儿）

## 2026-10-09　放弃 COM 自动化路线驱动 PS

- **决定**：不走 `New-Object -ComObject Photoshop.Application` + `DoJavaScript` 驱动 PS。
- **原因**：① 本会话沙箱内 COM 实例化被安全策略拦下（"COM object instantiation can run arbitrary code"）；
  ② **更根本的是方向不对** —— UXP 插件不是 JSX 脚本，COM 只能喂 JSX，**驱动不了插件本体**。
  加载通道必须走 UXP CLI。
- **放弃**：COM + DoJavaScript。

## 2026-10-09　继承 VellumDesk 的「档案法」，但缩减规模

- **决定**：建 `PROJECT.md` / `PROGRESS.md` / `DECISIONS.md` / `NEXT.md` 四件套；
  `docs/` 用 `NN-xxx.md` 编号管理方案文档。
- **原因**：VellumDesk（`D:\proj_media`）用这套跑了 55 批、56 次会话、1116 项自动断言，实战验证有效；
  且它**是项目无关的方法论**，与插件业务无冲突。用户主动指出这套档案，认可参考。
- **缩减理由**：VellumDesk 是成熟项目，PS 插件业务代码为零、形态未定。
  照抄规模（1039 行 `DECISIONS.md`、1819 行 `PROGRESS.md`）是负债不是资产。本项目**按需增长**。
- **暂不搬**：断言台（`accept.ts`）/ 场景截图壳（`_shotapp`）/ 文案字典在线表。
  前两者等第一个真插件落地后再建（现在没有可断言的对象）；后者等文案过百条再说。
- **只搬机制不搬内容**：环境坑字典的**机制**保留（见 `NEXT.md` 第四节），但内容另起 ——
  VellumDesk 那 60+ 条坑绝大多数是 Electron / electron-builder / GitHub Release 专属，对本项目无用。

## 2026-10-09　官方示例仓库不入库

- **决定**：`official-samples/`（`AdobeDocs/uxp-photoshop-plugin-samples` 的浅克隆）
  加入 `.gitignore`，**不提交**。
- **原因**：它本身是一个**独立的 git 仓库**（自带 `.git`）。直接提交会变成无法使用的 gitlink
  （子模块占位符），clone 下来是个空目录。且它是第三方代码，vendoring 进本仓库有许可问题，还占 13 MB。
- **代价**：换机器需重新克隆（命令记在 `README.md`）。可复现，代价可接受。
- **放弃**：git submodule（增加协作仪式感，对单人项目不划算）/ 删掉内层 `.git` 后 vendoring（许可风险）。

## 2026-10-09　Git 身份用仓库级配置，不动全局

- **决定**：本仓库的 `user.name` / `user.email` 用**仓库级**配置，不动全局。
- **原因**：全局身份**未设置**（`git config --global user.name` 为空），且用户在多项目上用的是仓库级配置。
- **⚠️ 已修正**：初版沿用 VellumDesk 的占位邮箱 `dev@localhost`，后改为 GitHub 专属 noreply 邮箱 ——
  见下一条。

## 2026-10-09　提交身份改用 GitHub 专属 noreply 邮箱

- **决定**：`user.name` = `wooozxh`，`user.email` = `76898022+wooozxh@users.noreply.github.com`。
- **原因**：核查发现**VellumDesk 在 GitHub 上的所有提交都没归到账号**（作者是 `proj_media <dev@localhost>`，
  是个占位身份，头像和贡献图都不会亮）。GitHub 提供的 noreply 邮箱能同时满足两件事：
  提交归到账号名下 + **不暴露真实邮箱** —— 比直接用真实邮箱更好。
- **影响**：首次提交尚未推送，因此用 `git commit --amend --reset-author` 重写了作者，历史保持单提交。
- **放弃**：沿用 `dev@localhost`（提交无归属）；直接用真实邮箱（没必要公开）。

## 2026-10-09　仓库公开、名为 `vellum-ps-uxp`、暂不加许可证

- **决定**：GitHub 仓库 `wooozxh/vellum-ps-uxp`，**Public**；暂不添加 LICENSE。
- **原因**：可见性与命名由用户拍板。公开与 VellumDesk 一致；仓库名带 `vellum` 前缀便于在账号里归类到同一族。
- **已知代价**：公开仓库若无 LICENSE，默认「保留所有权利」，**他人不能合法复用代码**。用户知情后选择先不加。
- **放弃**：私有（用户选公开）；`ps-uxp-dev`（与本地目录同名，但用户偏好带品牌前缀）。

## 2026-10-09　GitHub 建仓库与推送的通道选择

- **决定**：建仓库和推送**不走 GitHub 连接器**，走 **GCM 凭据 + REST API**。
- **原因**：连接器的令牌**没有建仓库权限**（实测 `POST /user/repos` 返回
  `403 Resource not accessible by integration`）。而本机 GCM 里存着 `wooozxh` 的令牌，
  用 `git credential fill` 取出来即可调 API。
- **放弃**：连接器建仓库（权限不足）。

## 2026-10-09　`github.com:443` 被拦时的推送兜底：走 Git Data API

- **决定**：写 `tools/push_via_api.py`，当 `git push` 连不上时用它把提交推上去。
- **原因**：本机 `github.com:443` 会被**间歇性 SNI 拦截**。实测同一时刻
  `api.github.com` 200、`codeload.github.com` 301，**只有 `github.com` 连不上**；
  走代理则 `CONNECT tunnel failed, response 502`。此时 `git push` 无论摘不摘代理都失败，
  但远端本身是好的 —— 坏的只是这一个入口。
- **原理**：Git 对象内容寻址，只要内容一致，远端算出的 tree/commit sha 与本地**完全相同**，
  所以推完直接 `update-ref` 对齐跟踪引用，连 `fetch` 都不需要（已验证：sha 逐位一致）。

### 实现上踩到的三个坑（重写这个脚本前务必先读）

1. **空仓库不能用 trees API** —— 返回 `409 Git Repository is empty`。
   空仓库必须先造一个提交（网页建 README，或用 Contents API 写一个文件）。
   本次解法：先用 Contents API 播一个临时提交，再建**根提交**（`parents: []`）
   并把 `main` 强指过去，播种提交变成游离对象 → 最终历史仍是干净的单提交。
2. **内容必须从 git 对象读，不能读磁盘** —— `core.autocrlf=true` 时磁盘上是 CRLF、
   git 里存的是 LF。本次有一份 `.md` 因从磁盘读而让**整棵树 sha 错位**，
   表现为「tree 不一致 → commit 也不一致」。正解：`git cat-file blob <sha>`。
3. **`git credential fill` 会偶发返回空**（实测 3 次里 1 次）—— 脚本必须重试。

- **为什么是 Python 而不是 .mjs**：`tools/` 下其它脚本都是 Node，但本机 Node 在受限环境里
  **spawn 任何 `.exe` 都 EBUSY**（实测 git / node / where 全中招），Python 的 subprocess 反而稳。
  兜底工具只在「网络或工具链已经不正常」时才用，**「验证过」比「风格统一」重要**。
- **放弃**：等网络恢复再推（不可控）；改用 SSH（本机没有 SSH 密钥）。

## 2026-10-09　闭环打通：加载用 `plugin load`，不用 `plugin reload`

- **决定**：日常迭代命令统一用 `uxp plugin load --manifest <path>`，**不用** `plugin reload`。
- **实测依据**（真机验证）：
  - `plugin load` **幂等** —— 插件已加载时再 load 会重新加载并重跑自检，于是
    「改代码 → load → 读 `report.json`」就是完整开发循环。
  - `plugin reload` **不接受 `--manifest`**（它按 cwd 定位插件），且实测报
    `Command execution failed in all connected applications`（插件实例状态失效时）。
  - `watch --path <dir>`（存盘自动重载）与 `validate --manifest` 实测均可用。
- **验证结果**：`hello-uxp` 加载后自检 **7/7**，`report.json` 落盘并被 `report.mjs` 读回。

## 2026-10-09　探针的「宿主连接」判据改用 DOM API，不依赖 `app.name` / `app.version`

- **决定**：`hello-uxp` 的「宿主连接（photoshop 模块）」用例改用 `app.documents.length` 作判据。
- **原因**：这两个 getter 在 **PS 27.2 / UXP 9.0.2** 下返回 `undefined`（首份报告里
  `host:{}` 就是值全为 undefined 被 JSON 序列化丢弃的结果）；改用 batchPlay 取
  `application.version` **同样拿不到**。而同一份报告里 `executeAsModal`、`batchPlay`、
  建文档与建图层全部成功 —— 说明连接本身没问题，是**断言写法**的问题。
- **教训**：验证「模块是否可用」要挑**一定可用**的成员当判据，别挑易碎的元数据属性。

## 2026-10-09　怎么验证 PS「开发者模式」真的生效（反证法）

- **方法**：看 `netstat` 里 `127.0.0.1:14001` 有没有一条来自 **Photoshop PID** 的
  ESTABLISHED 连接。有 → 该开关生效。
- **理由**：管理员层那个 `settings.json` 可以程序化查，但 PS 内的那个勾选项没有可靠的
  程序化读法。PS 开启后会**主动连**devtools 服务，这条连接比翻设置界面更硬。

## 2026-10-09　第一个真插件用「一个插件、两个入口」做形态试验

- **决定**：`hello-world` 同时声明 `panel` 与 `command` 两个 entrypoint，共用同一份逻辑
  （`actionInsert(who)`，`who` 只用于区分触发来源）。
- **原因**：产品形态是当前唯一未决项，而 **Panel / Command 的差别靠文字描述很难感知**。
  做成实物后，各点一次就能凭直觉判断要哪个 —— 比让用户在抽象选项里选可靠得多。
- **影响**：`docs/03-HelloWorld与插件形态.md` 成为形态决策的主要依据。
- **放弃**：先定形态再写样板（拖慢进度，且决策质量更差）。

## 2026-10-09　反馈通道扩展：从「自检报告」到「事件日志」

- **决定**：插件除写自检报告外，还往插件数据目录追加 `boot.log`，记录 **加载** 与
  **每次动作执行**（含触发来源 `via=panel|command`、目标文档、结果）。
- **原因**：`report.json` 只反映插件自己的自检；而**用户点了按钮之后发生了什么，AI 完全看不到**
  （UXP 跑在 PS 进程内，外部脚本读不到 console）。加事件日志后，「用户操作 → AI 可读」这条通道成立。
- **验证记录**：已用它确认用户点按钮成功 —— `insert  via=panel  doc=晋升公告.psd  layers=11`。
- **影响**：以后所有插件沿用此模式，不需要截图、也不需要用户复述结果。

## 2026-10-09　开发期自检用文件开关控制（`verify.flag`）

- **决定**：插件目录下若存在 `verify.flag`，则每次加载都跑一次**无痕演练**
  （建临时文档 → 插入文字图层 → 读回验证 → 关掉临时文档）。开关放文件、不放代码。
- **原因**：`batchPlay` 的 ActionDescriptor 与 PS 版本强相关，**必须实测**；
  但正式使用时不该每次都跑。文件开关让脚本能一键切换，且不污染代码。
- **验证记录**：首次运行显示通过 —— `selfverify  ok=true  layers=["Hello World","背景"]  cleaned=yes`。
  ⚠️ **但这条结论后来被证明是假阳性**（2026-10-09）：当时自检只比对图层**名字**，
  而 PS 2026 建出来的其实是同名**普通图层**。已修正，见下方「文本图层只能走 DOM」与 `docs/04`。
- **注意**：`verify.flag` 已进 `.gitignore`（属本地行为开关，不入库）。

## 2026-10-09　文本图层只能走 DOM（batchPlay 造不出来）

- **决定**：建文本图层一律用 `app.activeDocument.createTextLayer({ contents })`；
  **弃用** `batchPlay` 的 `{ _obj:"make", using:{ _obj:"layer", name, textKey } }` 一系写法。
  设字号用 `layer.textItem.characterStyle.size`（**不是** `textItem.fontSize`，实测不存在）。
- **原因**：PS 2026 v27.2 / UXP 9.0.2 实测，三种 batchPlay 写法（含显式 `layerKind:textLayer`）
  **全部只生成 `layerKind=1` 的普通图层**；唯一能建出文本层的是 DOM 的 `createTextLayer`。
- **连带发现（重要）**：在**非**文本层上执行 `set` 带 `textKey` 的 `textLayer`，PS 会弹出
  **原生模态框**「命令"设置"当前不可用。」并**阻塞整个 `executeAsModal`** ——
  它不等同于 JS 异常，从插件看是 `await` 永不返回，从外部看是日志卡死。
- **证据**：`docs/04-文本图层正确写法.md`（含完整实测矩阵 A1–A4 / B 轮）。
  三重验证：探针 `A4 PASS` → 无痕自检 `kind=text/3` → 用户真实点击后快照 `Hello World:text`。
- **影响**：`hello-world/index.js` 的 `makeTextLayer()` 重写；后续任何涉及文字图层的功能先看 `docs/04`。

## 2026-10-09　自检判据必须判「本质属性」，不能判表象

- **决定**：自检/断言的判据要落在**本质属性**上。凡是「名字 / 标题 / 显示文本」这类表象，
  一律不足以作为通过依据 —— 至少要有「名字 + 类型」双条件。
- **原因**：本次 bug 能溜进 `boot.log` 并显示 `ok=true`，根因就是自检只比对了**图层名**。
  图层名是对的，类型是错的，判据停在了表象上。
- **同时确立一条排障纪律**：判据必须**照抄数据的实际形态**，不能凭想象写。
  本次连踩两次同款坑 —— `layerKind` 经 batchPlay 是**数字** `1/3`、经 DOM 是**字符串** `"pixel"/"text"`；
  `size` 回读是 `{"_unit":"pointsUnit","_value":72}` 而非数字 `72`。
  两次都因此把**正确答案判成失败**（假阴性）。
- **影响**：判定统一收敛到 `isTextLayer(info)` 这类**同时接受两种形态**的函数里；
  正则一律对着 PS 的真实返回写。

## 2026-10-09　插件目录只读：开关由外部管，印章写 PluginData

- **决定**：插件目录（`getPluginFolder()`）里的文件开关（`*.flag`），
  只能由**外部**（人或 AI）创建/删除，插件自己不做增删；
  插件需要落盘的运行时产物（报告、印章）一律写 `getDataFolder()`（PluginData）。
- **原因**：实测两个硬约束 ——
  ① UXP 的 `Folder` **没有** `deleteEntry` 方法；
  ② `getPluginFolder()` 是**只读**存储，`createFile` 报
  `The file uses a storage provider that is read-only.`。
- **影响**：`probe-text.js` 的「跑过没有」改用 `probe-text.done`（存 PluginData）；
  想重跑就删该文件，想关掉探针就删插件目录里的 `probe-text.flag`。

## 2026-10-09　新增排障工具：定位 PS 原生模态框

- **决定**：新增 `tools/win_dialog.py`，用于枚举 Photoshop 进程的顶层窗口，
  并可指定类名/标题关键字关闭其中的模态框。
- **原因**：PS 的原生错误框会让插件「无声」卡死（见上文）。
  没有这个工具时，只能靠肉眼发现「插件没反应」，无从判断卡在哪。
  本次即用它定位并关掉了阻塞探针的 `PSDialogBox`。
- **安全设计**：默认**只列不关**；`--close` 必须显式给出类名/标题关键字才会动手。
- **影响**：以后遇到「插件跑一半没动静」，第一步就是 `python tools/win_dialog.py`。

## 待定（尚未拍板，别当已决）

| 项 | 选项 | 备注 |
|---|---|---|
| **产品形态** | Command（一次性动作）vs Panel（常驻面板） | 当前最该推进的事 |
| **是否上框架** | vanilla JS vs React / Svelte / Vue / TS | 建议先 vanilla 跑通再决定 |
| **许可证** | 无（当前）vs MIT vs Apache-2.0 | 仓库已公开；无 LICENSE = 他人不可合法复用 |

## 2026-10-10　产品形态定为「工具箱合集」：一个 Panel 外壳 + 多个工具模块

- **决定**：插件是一个**工具合集**（设计部门内部用）。`Panel` 作常驻工作台（首页 = 工具宫格 → 进工具 → 返回），
  `Command` 作高频一步动作/快捷键；两类入口共用一份代码。每个工具是**独立模块**，靠注册表挂载。
- **原因**：用户给出的场景就是多子功能（素材库 / 调色板 / 表格工具 / 其他），且明确「Command 和 Panel 都需要」。
- **影响**：**加工具 = 加一个文件 + 注册表加一行，外壳零改动**。所有工具共用 `lib/`（日志、PS 操作、存储）。
- **放弃**：单用途插件；先定全部功能再定形态。

## 2026-10-10　技术栈起步用 vanilla JS + UXP 内置 Spectrum，零构建

- **决定**：不引入前端框架、不引入构建链。
- **原因**：**闭环速度是本项目最值钱的资产** —— 「改码 → load → 读结果」这条回路里，构建步骤会多一层失败面
  （配置、loader、`dist/manifest.json`、"改完忘了 build"）。而 UI 是"工具箱"级复杂度，UXP 内置 `sp-*` 组件已够用。
- **放弃**：React（官方 starter 停在 React 16.8 + webpack 4，重且旧）／Vue／Svelte（均需 webpack）。
  将来若某个工具 UI 复杂到顶不住，**按模块平滑升级**即可，不用推倒重来。

## 2026-10-10　联动 VellumDesk 走「本地联动服务（HTTP + WebSocket）」

- **决定**：VellumDesk（Electron 应用，`D:\proj_media`）侧新增一个**本地只读联动服务**，插件作客户端。
  范围 = **素材列表 + 缩略图**；方向 = **单向 VellumDesk → 插件**。
- **原因**：探针 `link-probe/` 在真机实测证明——插件能 `fetch` 本地 HTTP JSON、能 `<img>` 直显 HTTP 图片、
  能收 `WebSocket` **主动推送**；而 `file://` 直读磁盘图片被拒。故 C 三项核心能力全部成立。
- **代价**：要给 VellumDesk 加服务 —— **它是另一个项目**（有独立档案与铁律），须各自立方案；
  且 manifest 的 `network.domains` 只能写 `"all"`（见下条）。
- **放弃**：A 直读工作区 / B 导出快照（`file://` 不通 + 非真推送）。

> ⚠️ **本条已于同日稍后被推翻** —— 用户质疑「两端都能读对方文件夹就不必上服务」，复评确认 **HTTP 非必需**，
> 路线改为 **② 镜像单写（无服务、无网络）**。见文末「联动路线改走 ② 镜像单写」。

## 2026-10-10　UXP 实测两坑：`network.domains` 不支持 localhost；图片不能在 `display:none` 里

- **事实 1（权限）**：manifest v5 的 `requiredPermissions.network.domains` 里写 `localhost` / `127.0.0.1` /
  带端口 / 带斜杠，**全部报 `Manifest entry not found`**；只有字符串 `"all"` 生效。
  实测于 **UXP 9.0.2**；Adobe 官方论坛与文档仓库均有该缺陷记录。代价：插件获得"访问任意域名"权限。
- **事实 2（图片）**：`<img>` 若放在 `display:none` 的容器里，UXP **不加载图片**，表现为**超时**（不是 `onerror`），
  极易被误判成"网络被拒"。承载图片的 DOM 必须**可见**。
- **影响**：以后任何涉及"本地服务 / 图片显示"的插件，**先看 `link-probe/README.md`**；
  这两条已导致过一次误判，别再踩。

## 2026-10-10　联动路线改走「② 镜像单写」：不需要 HTTP，也不需要常驻服务

- **决定**：VellumDesk 把「清单 + 缩略图」**写进插件的 PluginData 目录**；插件只读**自己的目录**。
  **不启本地服务、不引入网络权限**。原图**不批量搬运**，仅在用户点「插入」时按需取一张。
- **为什么推翻上一条**：用户指出「两端都能读对方文件夹就够了，何必 HTTP」。复评**成立** ——
  核心事实是**读盘能力不对称**：决定「能不能读」的是**读它的程序**，不是文件夹。

  | 读取方 | VellumDesk 工作区 | 插件 PluginData |
  |---|---|---|
  | VellumDesk（Electron） | 可读 | 可读 |
  | 插件（UXP） | **受限 / 未知**（`file://` 已实测被拒） | 可读（自身沙箱，已证） |

  → 与其让插件去够 VellumDesk 的目录（唯一问号），不如**反转写入方**：让 VellumDesk 写进插件的目录（全是绿灯）。
  且「插件读自身目录 + 图片走 `data:` URL」**两项均已实测通过**（`data:` URL 见 `link-probe` 的 report 对照项）。
- **为什么不写原图（性能）**：原图才是大块头。实测当前库**总量 127 MB，而缩略图总共只有 48 KB**
  （7 张 webp，平均 **4.2 KB/张**）。镜像若连原图一起搬，每次变更可能搬几十 MB —— **那才是"性能很差"的做法**。
- **实测压测**（本机 SSD，写 N 个 8 KB 小文件）：

  | N | 总量 | 首次全量写 | 读回全部 | stat 全部 |
  |---|---|---|---|---|
  | 200 | 1.6 MB | 155 ms | 77 ms | 3 ms |
  | 1,000 | 7.8 MB | 711 ms | 378 ms | 12 ms |
  | 3,000 | 23.4 MB | **2,124 ms** | 1,145 ms | 36 ms |

  → 即便 3000 个素材，**首次同步约 2 秒**；之后走增量，通常只动 1 张图。
  轮询只 `stat` **一个** `manifest.json`（<1 ms），开销可忽略。**性能不是 ② 的问题。**
- **代价 / 已知点**：① 「插入原图」需一次**文件握手**（插件写请求 → VellumDesk 放 1 张原图 → 插件置入），
  比 HTTP 多几十~几百 ms；② 非毫秒级推送（轮询秒级）；③ PluginData 路径含 PS 版本号（`PHSP\27\`），
  VellumDesk 需**动态发现**该路径。
- **放弃**：③ 本地服务（改动最大、需网络权限）；① 直读工作区（授权链脆弱 + 拿不到 SQLite 里的标签）。
- **待实测**：插件用 UXP storage 读**自身** PluginData 的图片文件并渲染
  （`data:` / blob→objectURL 已证可行，但「读自身文件」这一环尚未单独实测）。

## 2026-10-10　建立跨项目联动契约文档（唯一权威源：`D:\vellum-link\LINK-CONTRACT.md`）

- **决定**：把「插件 ↔ VellumDesk」的联动约定抽成**独立于两个仓库**的契约文档，版本号 `vellum-link/1`；
  权威源放中立目录 `D:\vellum-link\LINK-CONTRACT.md`，两个项目根各放一个**指针文件** `LINK-CONTRACT.md`。
- **原因**：联动牵涉**两个独立项目**（各有档案与铁律）。若只在各自文档里写，必然**漂移** ——
  A 侧改了字段、B 侧不知道，就得反复互相查。抽成单份权威源 + 两侧指针，是**成本最低的防漂移手段**。
- **契约内容**：拓扑（② 镜像单写）/ 镜像目录与常量 / `manifest`・`task`・`brand` 三份 JSON schema /
  `handoff` 握手协议 / 路径发现算法（软件侧）/ **写者唯一性**（镜像内每个文件只允许一个写者）/
  双边实测约束 / 变更流程 / 术语表。
- **为什么放中立目录**：契约是**对等双边**的，放任一仓库都制造不对称；且插件仓库是 **Public**，
  不宜把另一项目的内部模型细节（表名、路径）作为"本仓库文档"承载。
- **代价**：中立目录**不在任何 git 里**（无版本历史）。缓解：两侧指针文件入库 ——
  即使中立目录丢失，也能从两个仓库发现"曾有这么一份契约、它在哪里"。
- **变更规则**：**加法**变更（新增字段/scope）不升版本，两侧各记一条即可；
  **破坏性**变更（改字段含义/删字段/改目录名/改握手）**必须升版本**且两侧同步升级；
  插件读到不认识的版本 → **降级为只读提示，不崩、不猜**。
- **影响**：以后任何涉及联动的任务，**先读契约**（`PROJECT.md` 协作规则第 7 条已写明）。

## 2026-10-10　契约新增 §十四「联动变更公告板」：两侧可写，但必须带角色前缀 + 日期

- **决定**：在 `LINK-CONTRACT.md` 增设 **§十四 联动变更公告板** —— 这是全文**唯一**"两侧都能往里写"的区域。
  每条**必须**带角色前缀（`[插件侧]` / `[软件侧]` / `[双方]`）+ **日期**（`YYYY-MM-DD`），否则视为无效条目。
- **原因（需求）**：用户要求两个会话（插件侧 / 软件侧）开发时能互相看到"对方写了什么、更新了什么、接下来该做什么"，
  避免一边改了、另一边不知道又得来回查。
- **为什么不直接写进正文**：§一~§十三 是**规格**。若两侧随手往里写进度，规格会被留言淹没，
  后人分不清"哪条是规矩、哪条是某侧的临时状态"。→ **隔离**：正文只有双方同意才能改（走 §十）；
  公告板专收进度与公告。**规格看正文，进度看公告板。**
- **硬规则**（已写入契约 §14.2）：① **只追加**，不改不删别人写的条目（过时条目可标 `（已并入 §X）` 但不删）；
  ② **禁止整份文件覆盖写**（两个会话可能同时开着，整份覆盖会抹掉对方刚写的）→ 追加时先读文件、精准插入；
  ③ **公告 ≠ 生效** —— 写"我加了字段 `foo`"不等于 `foo` 进了契约，要生效必须同时按 §十 走流程并在正文补行；
  ④ 公告板**不定义**任何字段/目录/协议。
- **新增事实（用户确认）**：插件开发**只在本机进行**（公司电脑无 PS）→
  契约权威源**只存本机 `D:\vellum-link\`，不进任何 git 仓库**，已写入契约头部声明。
- **影响**：两侧会话此后在契约里留痕一律用该格式。

## 2026-10-10　契约拆分：规格（`LINK-CONTRACT.md`）与公告板（`LINK-LOG.md`）分离

- **决定**：把上一轮并入契约 §十四 的「联动变更公告板」**拆成独立文件** `D:\vellum-link\LINK-LOG.md`；
  契约 §十四 缩为**一行指引**（**编号保留，所以原有的"见 §十四"引用不会失效**）。
- **原因（除"更有针对性"外，有两条更硬的理由）**：
  1. **并发写安全** —— 契约是**只读为主**、公告是**只追加**。合在一个文件时，两侧会话都必须"先读全文再精准插入"，
     同一台机器上两个会话同时开工就容易撞。拆开后两种操作落在**两个文件**上，**冲突面最小**。
  2. **上下文成本** —— 契约 480 行是必须通读的；公告会越积越长，但读它只为看"最近发生了什么"。
     拆开后规定**只看末尾几条**，不必把整份历史塞进上下文。
  3. 用户提的**针对性**：一个是"宪法"（一年改不了几次），一个是"工作日志"（每天写）。
- **两文件定位**：`LINK-CONTRACT.md` = **规格**（改动需双方同意 → 走 §十 → 两侧 `DECISIONS.md` 各记一条）；
  `LINK-LOG.md` = **流水**（两侧可写、只追加、条目前缀 `[插件侧]`/`[软件侧]`/`[双方]` + 日期）。
- **铁律不变**：**写进 LOG ≠ 生效** —— 要生效仍须改契约正文并记 `DECISIONS.md`。
- **预先登记的升级路径**：若将来两侧**并发频繁**（多机/多人），LOG 再升级为"**每侧一个文件**"
  （`LINK-LOG-plugin.md` / `LINK-LOG-software.md`，各自独占、零冲突）。触发条件已写进 `LINK-LOG.md` 第四节，
  届时只需改契约一条即可，**不必重新设计**。
- **实施**：契约 528 → **500 行**（§十四 由 46 行缩为 17 行指引，正文迁入 LOG）；两份仓库指针各加一行指向 LOG。

## 2026-10-10　多版本兼容性：最低支持 PS 2024（`minVersion: 25.0.0`），作为横切约束并入 M1

- **背景**：本机 PS 2026，但同事有 2024 / 2025 → 用户在做 M1 前提问「要不要考虑兼容性」。
- **判断**：**必须考虑，且现在是成本最低的时刻** —— 业务代码一行未写，兼容性是**设计约束**（近零成本）；写完再补就是**返工**。
- **已核实事实**（官方文档 + 本项目实测）：
  - PS 大版本 ↔ UXP：**2024 (25.x) = UXP 7.2–7.4+**；**2025 (26.x) = UXP 8.0–9.x**；**2026 (27.x) = UXP 9.0.2–9.3+**（本机实测 UXP 9.0.2）。
    → **真正的分界线是 UXP 7.x ↔ 8/9.x，不是 PS 年份**；且**不能假设"PS 2026 的 UXP 一定比 2025 新"**
    （官方表：26.11 → 9.2.0，而 27.2 → 9.0.2）→ **以插件自报版本为准，别用年份推断能力**。
  - `manifest v5` **无门槛**：PS 24.4（UXP 7.0）起稳定可用；PS 2024 及以上不受 manifest 版本阻碍。
  - **版本行为差异已经发生过**：`docs/04` 记录的「PS 2026 下 `batchPlay` 的 `make`+`textKey` 建不出文本图层（只出普通层）」
    就是活样本。**反向推论**：2024/2025 **很可能仍吃老路** → 正解不是"选一条路"，而是**双路实现 + 运行时探测**。
- **决定**：
  1. `minVersion` 定 **`25.0.0`**（= PS 2024 起）。**不为"兼容更多"而下压** —— 压低只会让更老的 PS
     **装上但跑错**（静默错误），**比装不上更糟**。宁可装不上（有明确报错）。
  2. **API 白名单 + 逐项标注最低可用版本**：每用一个新 API，先查官方 "since" 再写，记入 `docs/12` §五 的表。
  3. **能力探测 + 双路降级**：有版本门槛的能力不裸调；判定必须"**名字 + 类型**"双条件（沿用 `docs/04` 教训）。
  4. **一键环境体检插件**：同事跑一次，回传 UXP 版本 + 各 API 探测结果 —— **这是唯一能拿到 2024/2025 真实数据的方式**。
  5. 镜像**按 PS 版本各存一份**（`PHSP\25\` / `26\` / `27\`），不做跨版本共享：简单、无坑。
- **诚实说明**：本机只有 PS 2026，**2024 / 2025 的结论无法在本机实测**，需借同事机器跑体检插件。
- **M1 影响**：**不阻塞**。兼容性作为**横切约束并入 M1**（M1 首件事加跑 UXP 能力体检），**不单开里程碑**。
- **对契约的影响**：发现 §七「路径发现」缺口（多 PS 版本共存 → 多个镜像目录，需明确"写哪个"），
  已按流程写进 `LINK-LOG.md` 待软件侧确认，**未擅自改契约正文**。
- **产出**：`docs/12-多版本兼容性策略.md`。

## 2026-10-10　兼容性四问拍板 + 契约 §7.1「多 PS 版本共存」正式生效

- **用户拍板**（`docs/12` §八）：① 暂按 PS 2024 最老做（**同事是否有更老版本待调查**）② 以机制换兼容 = **采纳**
  ③ 借机器跑体检插件 = **批准** ④ 补契约 = **批准**。
- **契约变更已生效**（不再是"待确认"）：§七 新增 **§7.1「多 PS 版本共存」** ——
  **默认"全部命中都写"**（每套镜像独立、互不共享是**预期行为**），并提供"只同步指定 PS 大版本"的可选优化；
  §5.1 新增**可选字段** `psMajor`（仅诊断用）。留痕见 `LINK-LOG.md`（第二条标了 `（已见契约 §7.1）`）。

## 2026-10-10　`env-check` 体检插件建成；`.ccx` 分发路径打通（不需要签名）

- **产出**：`env-check/`（panel + command 双入口，`minVersion: "25.0.0"`，`localFileSystem: "request"`）。
  加载即自动跑；结果写 `report.json` + `boot.log`；面板显示全文；另有「另存报告…」（`getFileForSaving`）。
- **分发已实测可行**：`uxp plugin package` 打出 `dist/com.wooozxh.envcheck_PS.ccx`（16 KB）。
  - **`.ccx` 不需要包级签名**（官方明确）→ 同事**双击**即可经 Creative Cloud 安装；
    无 CC / 权限受限环境可**解压后拷进 PS 的 `Plug-ins` 目录**。
  - **打包硬要求**：manifest 必须声明 `icons`（否则 `Plugin icons are not specified` 直接失败）。
    图标用**纯标准库 Python**（zlib 手写 PNG + 4× 超采样）自生成，未引第三方库。
  - 打包会**自动把 `host` 数组折成单对象**（开发期数组 / 分发期单对象），无需手改。
- **面板外壳刻意不用 `sp-*` 组件** —— 否则在不支持的老版本上连界面都出不来（它本身就是被测对象之一）。
- **本机基线**（PS 2026 / UXP 9.0.2）：**17/21**，4 个 FAIL 全部合理且预期
  （`app.version` 读不到、`batchPlay` 读 `application.version` 读不到、老路建文本层失效、`<input type=color>` 实现不全）。

## 2026-10-10　M1 调色板地基已实测：读/设前景背景色的确切写法（GET 与 SET 的 `_target` **不一样**）

- **本机实测（UXP 9.0.2）通过**，可照抄：

  ```js
  // 读 —— target 用 [_property, application]
  { _obj: "get", _target: [
      { _property: "foregroundColor" },
      { _ref: "application", _enum: "ordinal", _value: "targetEnum" } ] }
  // → { _obj:"RGBColor", red, grain, blue }   ← 键名是 grain（不是 green），分量 0–255

  // 设 —— target 用 [ref:color]（与"读"不同！）
  { _obj: "set",
    _target: [{ _ref: "color", _property: "foregroundColor" }],
    to: { _obj: "RGBColor", red: 255, grain: 0, blue: 0 } }
  ```

  DOM 侧：`app.foregroundColor = {red,green,blue}` **会抛** `reading 'desc'`（setter 不收裸对象）；
  正确姿势是取现有 `SolidColor` 改属性再赋值：`const c = app.foregroundColor; c.rgb.red=..; app.foregroundColor = c;`

- **两个必须记住的坑**：
  1. **读、设的 `_target` 写法不对称**：`[prop, appRef]` 能**读**却**设不上**（**静默失败、不报错**）；
     只有 `[ref:color]` 能设。用错的一方看起来"没反应"，极易误判为"功能不支持"。
  2. **"设上了"的判据必须同时要求"值确实变了"** —— 若测试色恰好等于当前色，"没设上"也会被判成"设上了"
     （**首轮实测真踩到**，报了假阳性）。判据两条：回读 == 目标色 **且** 回读 != 设置前的值。
- **连带教训（探针本身）**：`batchPlay` 的 `_target` 若**只写** `[{_property:"x"}]`（缺 `_ref` 指代作用对象），
  PS 会返回**整份 application 对象**，取 `res[0].x` 得 `undefined` —— 看起来像"属性不存在"，实为**写法错**。
- **影响**：M1 调色板直接照抄上表；判据按上面两条写。探针与说明见 `env-check/README.md` §六。

## 2026-10-10　M1 落地：插件 id / 目录 / 自检机制，以及三条新实测

- **插件身份定稿**：id **`com.vellum.toolbox`**（原拟 `com.wooozxh.vellumtoolbox`，用户 M1 开工时改定），
  manifest `name` = `vellum_toolbox`，面板显示名「Vellum 工具箱」，目录 `vellum-toolbox/`，
  `minVersion: "25.0.0"`，`requiredPermissions: {}`（M1 不需要任何网络/文件系统授权）。
  - **合规性已验**：`plugin validate` 通过 —— `com.vellum.toolbox` 这种写法合法。
  - **连带影响**：PluginData 路径随之变为
    `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.vellum.toolbox\PluginData\`
    → 已按流程更新联动契约 §2.1 / §7.2 的 `PLUGIN_ID`，并在 `LINK-LOG.md` 留 `[双方]` 条目提醒软件侧按新值写。
- **架构按 `docs/10` §2.3 注册表落地**：外壳只做「读注册表 → 渲染首页 → mount / unmount」，
  工具模块导出 `{id,title,subtitle,mount,unmount}`。加工具 = 加一个文件 + 注册表一行，外壳零改动。
  实测时多加了两层底座（`lib/data.js` 文件底座、`lib/selfcheck.js` 自检），理由见 `docs/10` §2.2 脚注。
- **调色板实现要点**：设色唯一实现 `palette.applyHex(hex, slot, name, via)`，
  面板点击 / Command / 自检**全都走它** —— 避免"三处各写一份、改一处漏一处"。
  每次设色都把 `before` 与 `readback` 一起写进 `boot.log`（回读值即凭证，不靠"点了就说成功"）。
- **新增实测结论 ①：UXP 的合成事件带不上修饰键。**
  `new MouseEvent("click", {shiftKey:true})` **构造不报错，但 `shiftKey` 被丢掉** ——
  带修饰键的合成点击会**静默退化成普通点击**（首轮自检因此出现"貌似跑了其实没测到"）。
  `document.createEvent("MouseEvents")` 在 UXP 9.0.2 上**直接抛错**。
  → 正解：造普通 `Event`，把 `shiftKey` 当**自有属性**挂上去（`dispatchEvent` 传给监听器的是同一对象）。
  实现见 `lib/selfcheck.js` 的 `syntheticClick`，它会**校验修饰键是否真的生效**，带不上就换下一种造法。
- **新增实测结论 ②：Command 无法唤起面板。**
  UXP 未提供"打开某个面板"的 API，所以 Command **一律设计为纯动作**（M1 的两条命令 = 品牌主色设前景/背景色），
  不依赖面板是否打开 —— 这是安全设计，不是权宜之计。
- **新增实测结论 ③：模态与轮询读取可以并存。**
  自检在设色后立刻用轮询回读（每 150ms 一次 `batchPlay get`），未出现模态争用或卡死。
- **自检机制（`verify.flag` + `lib/selfcheck.js`）**：面板交互 AI 点不了，但必须能自证。
  做法是**合成点击真实 DOM 元素**，让事件走真实处理器 —— 测的是面板本身，不是影子实现。
  它同时是**回归网**：M1 期间它抓出并修掉了两个真 bug ——
  ① **品牌色网格从未被渲染**（`build()` 只建容器、漏调 `rerender()`，面板里两个网格都是空的）；
  ② **落盘判据假阳性**（只按颜色值匹配会等到上一轮遗留的旧条目，于是"点击没生效"也判 PASS）→
  改为必须匹配**本次新增的 id**。
  - **安全纪律（继承自 env-check 事故）**：读不到前景/背景色原值 → **整场自检放弃**，绝不"先改了再说"。
  - **跨重载持久化怎么证**：`verify-keep.flag` 让自检色留在磁盘上，**下一次插件加载**时由 S2 认出来
    → "它在一次真实重载后仍然存在"，实测已拿到该证据。
- **产出**：`vellum-toolbox/`（README + manifest + 外壳 + 7 个 lib + 2 个 tools + 6 图标）、
  `dist/com.vellum.toolbox_PS.ccx`（38 KB）。M1 验收 7 条**全过**（自检 10/10）。
- **唯一无法自证项**：面板的**视觉呈现** —— 需要人工在 PS 里打开「窗口 > 插件 > Vellum 工具箱」看一眼。

## 2026-10-10　UI 路线：自写 CSS 为主 + 少量 `sp-*`；主题跟随 PS；不引 Spectrum Web Components

- **决定**：
  1. UI 以**标准 HTML + 自写 CSS** 为主力，**仅少量保留 `sp-*`**（如返回按钮）吃主题跟随；
  2. 配色**跟随 PS 主题自适应**（用 `--uxp-host-*` 变量 + `@media (prefers-color-scheme)`），不做固定配色；
  3. **不引入 Spectrum Web Components，也不上 WebView UI**。
- **原因**：
  - **Adobe 官方明确允许自带视觉语言** —— *"You are free to use your own visual language in UXP plugins"*，
    提交 CC 市场也不强制 Spectrum。所以「只能用灰底蓝钮」是误解，**不是限制**。
  - 本项目立项时已定 **vanilla JS + 零构建**；SWC 会引入 npm 依赖链，**破坏「改一行 → load → 读日志」
    这条轻量闭环**。收益（组件更多）与代价不成比例。
  - `sp-*` 保留少量：**白拿**主题跟随与无障碍，且不增加依赖。
- **依据（已核实的硬约束，来源：Adobe 官方 unsupported 列表 + UXP Changelog）**：
  ✅ flexbox(含 gap) / 盒模型 / `overflow` / CSS 变量 / `calc()` / `linear-gradient`(8.1+)；
  ⚠️ `box-shadow`、`transform`、`transform-origin` → **需 `featureFlags.CSSNextSupport`，不开则静默忽略**；
  ❌ **Grid / `transition` / `animation`·`@keyframes` / `float` / `position:sticky` / `text-transform` /
  `font` 简写 / `@font-face` / `::-webkit-scrollbar`**。
  → 由此定四条设计法则：**L1 不做过渡动画、L2 不写死灰度（用 `rgba(127,127,127,α)` 中性叠加）、
  L3 图标用内联 SVG（`devicePixelRatio` 恒为 1）、L4 能不开 `CSSNextSupport` 就不开**。
- **本次连带决定**：**暂不开 `CSSNextSupport`** —— 该标志自 PS 26.0 / UXP 8.0.1 起才有，
  而本项目 `minVersion` 是 **25.0.0（PS 2024）**，开了会在最老的一档**静默失效**（B 类风险，`docs/12` §二）。
  先把 UI 做到「零新特性也好看」，阴影留作可选渐进增强。
- **放弃的方案**：
  - Spectrum Web Components（引 npm + 构建，破坏零构建）；
  - WebView UI（架构最重、抬高最低版本，本项目用不上其动画能力）；
  - 固定配色（不跟 PS 主题走，深色界面里会突兀）。
- **影响**：UI 工作以 `docs/13-UI方案.md` 为准（设计令牌 / 组件规格 / 三段式滚动骨架 / 验收 6 条）。
  **动代码前需用户确认该草案**。
  → 遗留阻塞项：**品牌 HEX 仍未给**（给了只改 `DEFAULT_BRAND` + `--vt-brand` 两处）。

## 2026-10-10　方向 B 落地：令牌化深浅两套 / 全自绘（弃 `sp-*`）/ 视觉降级四条

- **背景**：用户给了 `design-demos/B-native-pro.html`（可交互）+ `B-native-pro-spec.html`（规格），
  要求「**先只深入 B 方案**，实机装载之后不合适再考虑其他方案」，并同意「有技术硬约束就尽量往效果上靠，
  不必追求一模一样」。可行性评审见 `docs/14`，落地实现见 `docs/15`。
- **决定**（用户拍板 + 技术选择）：
  1. **配色令牌化深浅两套、跟随 PS 主题**（不是设计稿的固定深色）。
     切换**双保险**：`@media (prefers-color-scheme)` + JS 探测后挂 `.vt-dark` / `.vt-light`
     （后者不依赖媒体查询，一定可靠；离线回归已验证 `className = "vt-dark"`）。
  2. **本轮全自绘，不使用任何 `sp-*`**（推翻 `docs/13` 的「少量 `sp-*` 兜底」）。
     原因：返回键 / 存色键在方向 B 里都是自绘形态，硬塞 `sp-button` 反而破坏视觉统一。
  3. **中文字号整体 +1px**（正文 13 / 次级 12 / 最小 11）—— 设计稿 9.5–12px 承中文在 Windows 会糊，
     用户明确「不接受糊」。
  4. 面板尺寸：停靠 **340×580**、浮动 **420×680**、最小 **260×320**（设计稿 440×764 太宽）。
- **视觉降级四条（硬约束下的等效替代，不是把功能丢掉）**：
  1. `box-shadow` → **真实描边元素 `.sw-ring`**（向外扩 2px 的 2px 蓝框）。
     这条最关键：色块的 hover / 选中反馈**唯一载体**就是阴影，去掉=反馈消失；而 `CSSNextSupport`
     自 PS 26.0 才有，本项目 `minVersion` 是 **25.0.0（PS 2024）**，**不能押在 flag 上**。
  2. **结构类伪元素 `::before/::after`、`:first-of-type`、`:last-child` 全部不用** ——
     改用真实子元素 / flex `gap` / JS 挂 `.is-first`。**支持度不确定的东西不承担结构职责。**
  3. **`transform` 不用** → hover 浮层在 JS 里手算 `left` 并 clamp 到容器内。
  4. **`linear-gradient` 不用** → 顶部品牌条改纯色（PS 2024 / UXP 8.1 以下不生效）。
- **CSS 变量与 SVG 的两处「不押注」**：
  - **色块颜色直接写 `background-color`**，不用 `--c` 变量（最低版本行为未知）；
    但**设计令牌整体仍用 CSS 变量**（探针第 1 项若证明不支持则需返工，属已知风险）。
  - **图标用 `createElementNS` 手工建节点**，不用设计稿的 `innerHTML` 注入 SVG 字符串
    （HTML 解析器对带命名空间的 SVG 支持不明确）。
- **新增一条自证链路**：`tools/offline-smoke.cjs` —— **离线结构回归**（最小 DOM mock，不需要 PS）。
  它专挡「自检脚本依赖的选择器与实现不一致」这类错（以前要等真机自检一堆 FAIL 才发现）。
  **边界写死**：只验结构与事件处理器，**不验** CSS 渲染与 batchPlay 真实行为 —— 不能替代真机自检。
- **放弃的方案**：固定深色（用户选了令牌化）；照搬设计稿交互（右键菜单 / X 键删除，属功能变更）；
  照搬设计稿字号（会糊）；`<link rel="stylesheet">` 外部 CSS（未实测，继续内联 `<style>`）。
- **影响**：`vellum-toolbox` 版本 → **0.2.0**。真机装载后由 `lib/cssprobe.js` 的 **12 项探针**
  决定「哪些降级可以恢复」（关键依赖仅 3 条：CSS 变量 / SVG 命名空间 / flex gap）。
  **品牌 HEX 仍是唯一阻塞项** —— 落点在 `tools/palette.js` 的 `DEFAULT_BRAND[0]`（首页预览、
  面板品牌色区、Command 入口都取它）。

---

## 2026-10-10　🔴 **推翻旧结论**：UXP 的布局是异步的 —— 探针几何结论必须「让帧后再量」

- **背景**：v0.2.1 修完 8 条 UI bug 后复验，`selfcheck` 报 15/15 全 PASS，但探针里 `width:100px` 的块量出来是 `0px`。
  而**上一轮**正是依据同样的 `0` 判定「CSS 变量 / `letter-spacing` / `transform` 不支持」。
- **第一轮归因（错）**：以为离屏容器 `left:-9999px` 被 UXP 裁剪（culling）→ 改成 visible-but-clipped
  （`left:0 + height:1px + overflow:hidden`）→ **仍然是 0**。
- **判别实验（决定性）**：同一轮里 `computed` 类探针（outline / box-shadow / linear-gradient）返回的是**正确值**
  → style 确实应用了，问题不在「样式没生效」，而在「量不到几何」。
  再对比：自检 `S13` 能量到真实几何，而它与探针的**唯一差别是「中间隔了若干 `await`」**。
- **结论**：**UXP 的布局（layout）是异步/延迟的。** 同步 `appendChild` 后立即
  `getBoundingClientRect()`，拿到的是「尚未参与布局」的 0，**不是「该特性不支持」**。
- **决策**：
  1. `lib/cssprobe.js` 新增 `settle()`（连让两帧 `requestAnimationFrame` —— 第一帧常常只是"标记脏"），
     **每条几何探针在「建好 → 让帧 → 再量」之后才取数**。
  2. `cssprobe.run()` **从同步改为 async**，调用方（`selfcheck S9`）必须 `await`。
  3. 新增 **⓪「测量基座自证」探针**：不测任何 CSS 特性，只测「这套量法本身靠不靠得住」——
     同一元素量两次（同步 vs 让帧后），并把两个值都写进日志。
  4. **基座失效时，所有 `via="几何实测"` 的结论自动追加「⚠️ 基座未参与布局，此结论不可信」**。
     宁可承认测不准，也不给假阳性。
- **代价**：自检耗时从 ~700ms 升到 ~790ms（多等几个帧）。**这个代价必须付** ——
  没有它，探针的每一条「不支持」结论都不可信。
- **可复用原则（已写进 `lib/cssprobe.js` 头部）**：
  > **探针报「不支持」时，先怀疑量法，再怀疑特性。一个恒为 0 的读数，
  > 更可能是「没量到」，而不是「真的没有」。给几何探针配一个基座自证，成本极低。**

---

## 2026-10-10　🔴 **修正能力表**：三条半「UXP 不支持」是假阴性，真机实测为支持

- **被修正的旧结论**（此前已写进 `docs/13` / `docs/14` / `docs/15` / `MEMORY.md`，属**需回收的错误信息**）：

| 旧结论 | 影响面 | **修正后真机事实** |
|---|---|---|
| 「CSS 自定义属性不可用 / 读不到」 | 整个设计令牌体系悬空（曾列为「若不支持需大改」） | ✅ **支持**。`getPropertyValue("--x")` 读不到是 API 限制，但 **var() 在渲染层完全生效**（`--probe-w:137px` → 实测宽 137px） |
| 「`letter-spacing` 不生效」 | 「Pro 感」依赖的 `.06em` / `.04em` 字距 | ✅ **支持**。0px→93px、10px→**193px**，**差出 100px** |
| 「`transform` 无效」 | 浮层定位曾被迫改为 JS 手算 `left` | ✅ **支持**。`translateX(30px)` → 实测 **+30px** |
| 「`offsetWidth` 恒为 0，绝不能用」 | 曾把 `showTip` 的 `offsetWidth/Left/Top` 全换成 `rect` | ✅ **两套 API 都可用**。真机 `offsetWidth=100　offsetHeight=10　offsetLeft=40　offsetTop=7` |

- **真正没被推翻的三条（也是这批 UI bug 的根因）**：**flex `gap` 不生效**、**SVG 不继承 `fill`/`stroke`**、
  **`window.matchMedia` 根本不存在**（不是返回 false，是 `is not a function`）。
- **决策（怎么用这些恢复出来的能力）**：
  - `letter-spacing` / `transform` / `var()` **可以放心用**，不必再为它们做降级。
  - `rect` 或 `offset*` **都行**，但**都必须在让帧之后量**（见上一条）。
  - **已经落地的替代方案不回退**：`.sw-ring` 描边元素（原为替代 `box-shadow`）继续用 ——
    它工作正常，且 `box-shadow` 仍有 `CSSNextSupport` 的版本门槛（PS 26.0 起），
    与 `minVersion: 25.0.0` 冲突。**"能用了"不等于"必须换回去"。**
  - `flex gap` 不生效这一条**继续生效** → 间距一律 `margin`，`.is-first` 方案保留。
- **回收动作**：`docs/15` 加「上表已被真机修正」更正段（**保留原猜测不删**，让人看得见当初错在哪）；
  `docs/README.md` 给 15 打状态标注；本文件即修正留痕；`lib/cssprobe.js` 头部写修正后的能力表。
- **教训**：**「猜」和「测」必须分开标注**。`docs/14`/`15` 那份表写的是「如果支持 / 如果不支持」的**猜测**，
  但读起来像结论 —— 真机一出结果就和它对不上。以后这类表**必须在表头写明「未经实测」**。

---

## 2026-10-10　UI 三条硬纪律（v0.2.1 的真机 bug 换来，写死不再试探）

8 条 UI 反馈归并出的根因，全部是「我的写法在 UXP 里不成立」。以下三条**升级为项目 CSS 纪律**：

1. **SVG 图标：每个元素自带 `fill` / `stroke`，逐元素写死，绝不依赖继承。**
   UXP 的 SVG 渲染器**不把父节点的 `fill`/`stroke` 传给子元素** —— 子元素退回 SVG 初值
   `fill:black; stroke:none`，于是**闭合路径变成黑块、线条图标在深色底上完全看不见**。
   落点：`lib/icons.js` 的 `applyPaint(node, mode, sw)`，**对根节点和每个子节点都调**（先补默认，再写规格 attrs）。
   守护：`selfcheck S14`（逐图标逐子元素检查属性齐全）+ 离线断言 1b。
2. **不拿 `<button>` 当布局容器。** `<button>` 在 UXP 里**不吃 `display:flex`，且强制文字居中**。
   → 一律改 `div[role="button"] tabindex="0"` 并自己做样式复位。守护：离线断言 3c（整页 `<button>` 数必须为 0）。
3. **间距一律 `margin`，不用 flex `gap`；不用 `inline-flex` 兜布局。**
   `gap` 真机实测无效（两子项各 20px + gap 10px → 起点差 20px，只有宽度没有间距）；
   `inline-flex` 在真机上不可靠。→ `.navitem` 干脆**纯绝对定位**（`left/right/top` + 显式 `height`），
   `text-align:left` 显式写（抵抗继承）。
   守护：`selfcheck S13` 把「长得不对」变成数字（行高 54 / 图标 26×26 / 左内缩 48px /
   圆点↔文字 6px / 圆点垂直偏差 1px）。

- **配套约束**：**改外壳结构时，必须同步改 `tools/offline-smoke.cjs` 的 DOM 桩。**
  本轮 3c 曾 FAIL，根因不在产品代码，而在桩还按旧外壳手搭 DOM → **桩不同步 = 假 FAIL**。

---

## 2026-10-10　🔴 **第三次"工具骗人"**：探针的**判据**错了 —— 几何量必须「轮询到进布局」，不能等固定帧数

- **背景**：v0.2.2 复验时，日志里 5 条**本来正确**的几何结论被盖章「⚠️ 此结论不可信」：
  ```
  cssprobe NO 测量基座自证 :: 容器宽=0px → ⚠️ 基座无效：一切几何结论作废
  cssprobe OK CSS 自定义属性 :: 实测宽 137px　⚠️ 基座未参与布局，此结论不可信   ← 自相矛盾
  ```
- **第一层根因（判据错）**：基座把「**首次 append 一整棵子树**的布局延迟」当成了「容器不参与布局」。
  同一个容器在后面的探针里每次都能量到真值（137px / 100px）→ 说明"容器不参与布局"是假的，
  2 帧不够的只是**第一次**。
- **第二层根因（更狠）**：修完基座后立刻抓到 ——
  **同一份 `CSS 变量` 探针在相邻两次运行里分别量到 137px 与 0px，代码一个字没改**。
  → **"让 2 帧就够"是个赌注**：布局何时完成取决于元素挂进去时处在帧的哪个相位。
- **决策**：
  1. `lib/dom.js` 提供唯一的 `settle()`（palette 与 cssprobe 共用，不再各写一份）。
  2. `lib/cssprobe.js` 新增 `settleUntil(predicate, maxFrames)` —— **轮询到判据成立为止**，
     并把**用了几帧 / 耗时**写进结果（真机：`用了几帧=1　耗时=36ms`，这本身就是异步布局的量化证据）。
  3. 新增 `waitLaidOut(nodes)`：**所有几何探针**从「等固定 2 帧」改成「轮询到能给出非零几何」。
  4. 基座量之前先给容器**预热**（自己先让两帧），把"首次延迟"这个变量隔离出去。
  5. **不做**「把超时调大」这种改法 —— 那是把赌注下得更大，不是消除赌注。
- **代价**：探针在"真的不支持"的项上会多等几帧（最多 12 帧 ≈ 400ms）。自检总耗时 ~2.9–3.2s，可接受。
- **教训（升级版）**：
  > v0.2.1 学到「量法错了会造出假阴性」。这一轮学到的是更靠前的一层：
  > **判据错了，会把工具自己的可信度一起抹掉。**
  > 「⚠️ 此结论不可信」这种标注一旦误报，人就会开始忽略它 —— 那么真正不可信时也没人看了。
  > ⇒ **标注的可信度，和数据的可信度一样需要自证。**
  >   一条"警告"能被打印出来，前提是它自己的判据也通过了验证。

---

## 2026-10-10　🔴 **更正**：`manifest.shortcut` 在 Photoshop 上**不生效**（语法合规 ≠ 宿主支持）

- **被更正的说法**（`docs/16` 与上一轮 `DECISIONS.md`）：写成了
  「`manifest v5` 的 `command` 支持 `shortcut`，但必须含 Ctrl，且只支持字母/数字」——
  **读起来像"所以我们可以给命令加真快捷键"。这是错的。**
- **本轮查证的事实**：
  | 层 | 事实 |
  |---|---|
  | UXP 语法 | `"shortcut": { "mac": "Cmd+Alt+F", "win": "Ctrl+Alt+F" }`。Mac 必须含 Cmd/Ctrl，Win 必须含 Ctrl；**只支持字母/数字**；**与宿主内置快捷键冲突则被静默忽略**（仅控制台留一行警告） |
  | 文档归属 | 上面这套出自 **Premiere / InDesign / XD** 的 UXP manifest 文档 |
  | **Photoshop** | Adobe 官方论坛（PS/UXP 分区）2021 → **2024** 一路问下来都是 **"Not yet possible"**；Adobe 员工 2024-06 明确：「**UXP 核心 API 不支持键盘快捷键**」。社区替代方案：**录成动作再绑 F 键** |
- **决策**：
  - 第三条命令（`brandPrimaryFill`）**照常加** —— 它有独立价值：出现在 `增效工具` 菜单里，
    用户也能在「键盘快捷键」里自己绑键（如果能绑到子项）。
  - manifest 里那条 `shortcut` **保留为 best-effort**：真机 `Validate command successfull` 通过，
    无害；但**不得对外承诺"按 Ctrl+Alt+F 就能填充"**，必须实按一次才算数
    （已写进 `docs/17` §五 未自证清单）。
  - **可自证的路径是面板内 `Alt+左键`** —— 它走我们自己的事件处理器，已被 S16 端到端验证。
- **可复用原则**：
  > **查能力时先确认"这份文档属于哪个宿主"**。UXP 是跨宿主的内核，
  > 但每个宿主实现到哪一步并不一致 —— **"某文档写了" ≠ "我们这个宿主支持"**。
  > 这类"跨宿主文档"的结论，一律要标注**来源宿主**与**实测宿主**。

---

## 2026-10-10　调色板交互定稿：`Alt+左键 = 填充当前图层/选区`

- **背景**：用户提出「可不可以**通过其他快捷键**直接给目前激活的对象/图层进行填充」。
- **决策**：新增修饰键 **`Alt+左键` = 用该色填充当前图层 / 选区**，优先级 **Alt > Shift > 无**。
  - 选 `Alt` 而非 `Ctrl`/`Alt+Shift` 的理由：**PS 自己的 `Alt+Backspace` 就是"用前景色填充"**，
    语义有共识，不需要教育成本；而 `Shift` 已被"设背景色"占用。
  - **`Alt+左键` 不改前景色/背景色** —— 这是它与"左键设前景色"的核心区别，
    也是为什么填充默认走 `fillContents:"color"`（显式颜色）而不是"先设前景色再填"。
    回退路径若动用前景色，**用后必须还原**（日志记 `fgRestored`）。
- **判据**：填充用 `verify:"change"`（**像素必须有变化**），不接受"命令没报错"。
  理由：`fillContents:"color"` 这条枚举值**官方文档没写**，最坏情况是**静默忽略**
  （不报错、也不填）—— 没有像素判据就会被它骗过去。
- **不做**：不加 `_target`（论坛实例显示给 `fill` 加 `_target` 后反而失效）；
  不在用户路径做 `verify:"pixel"`（"整层平均色等于目标色"只在纯色图层上成立）。
- **破坏性验证的纪律（写死）**：
  > **绝不用用户的图去验证破坏性操作。** 自检一律先 `createScratchDoc()` 建自己的临时文档，
  > 跑完 `closeDocument()` 不保存关掉。S16 走的就是这条路 ——
  > 所以它能在 `verify.flag` 下自动跑，而不需要先问用户"我可以改你的文件吗"。
- **未覆盖（如实标注）**：文字图层 / 智能对象 / 锁定图层 / 32 位文档上的填充行为没有逐一验证；
  代码只会对"像素无变化"给出可读原因。
- **v0.2.3 更正**：上面这条"未覆盖"里的**形状图层**随后真的炸了 —— 见下一条决策。

---

## 2026-10-10　`fill` 只对像素族有效：填充必须按 `layer.kind` 分派

- **背景**：用户报「填充不能用」。真机日志显示在「矩形 1」上，
  `fill` 的两条路径**都"执行成功"了但像素一个没变**，同时 PS 弹 `命令"填充"当前不可用。`
- **事实**：Adobe 论坛官方人员原话 ——「**Vector layers are actually solid color layers
  (with vector masks)**」。即**形状图层在 UXP 里的 `kind` 就是 `solidColor`**，
  与「纯色填充图层」同属 `solidColorLayer`（**内容图层**，像素由参数算出来）。
  PS 菜单的「填充」对内容图层本来就不可用。
- **决策 1 —— 按 `kind` 分派命令**（`lib/ps.js fillLayer()`）：

  | 图层族 | kind | 走哪条命令 |
  |---|---|---|
  | 像素族 | `pixel` / `background` / `smartObject` | `fill`（= 编辑›填充，尊重选区） |
  | 内容族 | `solidColor` / `gradientFill` / `patternFill` | `set` 改内容图层的颜色 |
  | 文字 | `text` | 前置拒绝（明确说明 + 给替代做法） |
  | 其余 | 调整层 / `group` / `threeD` / `video` | 前置拒绝 |
  | 读不出 kind | — | **只走内容族，不拿 `fill` 去赌** |

- **决策 2 —— 铁律：内容族绝不退到 `fill`。**
  理由：`fill` 在内容图层上是**"不报错 + 不改像素 + PS 弹框"**三连 ——
  比直接失败更难排查（v0.2.2 就在这里被绕过一次）。宁可明确报"这条写法没生效"。
- **决策 3 —— 内容改色写两条描述符，按序试 + 像素判据。**
  `contentColorA`（`to: {solidColorLayer, color}`）与 `contentColorB`
  （`to: {shapeStyle, fillContents:{solidColorLayer, color}}`）两派写法都有实物出处；
  **形状图层无法在自检里凭空造**（要真画一条路径），所以不赌一条 ——
  让真机自己告诉我们哪条生效，日志记 `via=contentColorA/B`。
- **决策 4 —— 前置拒绝必须在发命令之前做完。**
  锁定 / 文字 / 调整层 / 组在本地就能判掉；**一条 PS 命令都不发**，自然不会有 PS 弹框。
- **决策 5 —— 失败原因必须露在面板状态行上，而且要可操作。**
  v0.2.2 的像素判据**判对了**，但失败原因只写了 `boot.log`，
  面板给的是含糊文案，用户只看到 PS 的那个框。
  → **判据正确 ≠ 反馈正确。判据对了但结果没送到用户眼前，等于没有判据。**
  失败文案要带**下一步动作**（「取消『锁定全部』再试」/「右键图层 › 栅格化文字」），
  不是复述现象。
- **未覆盖（如实标注）**：**形状图层本身**没真机验证（S17 建的是**纯色填充图层**，
  同族不同物）；渐变 / 图案填充图层归到内容族但未实测；文字图层的**改色**没实现；
  `kind` 读不出来的分支只在"新调整图层（Clarity/Grain，UXP DOM 未收录）"这一种情形下会被触发。

---

## 2026-10-10　面板停靠：**不改代码**，改打包

- **背景**：用户报「插件窗口无法吸附在主界面内」。
- **查证结论（四条事实，见 `docs/19`）**：
  - UXP 面板**支持**停靠（Adobe 官方："can be resized, **docked**, opened and closed
    just like native Photoshop panels"）；
  - 但**插件没有资格声明停靠位置** —— Adobe（PS 团队）原话：「There is currently no
    mechanism to specify where you'd like to be docked; **the user has full control over this**」；
  - **官方 manifest v5 字段表里就没有 `location` / `dockConfig`**（panel 类只有
    `type/id/label/minimumSize/maximumSize/preferredDockedSize/preferredFloatingSize/icons`，
    v5 另加 `title`）→ 社区那套写法 PS 直接忽略；
  - 本机插件**一直是 UDT 开发态加载**（`.uxprc` 会话文件 + `PluginsStorage\…\Developer\` +
    **无 `External` 目录** + **无 UPIA**），而 Adobe 明说：
    「This only works on startup with a **packaged/installed** plugin; in the case of a plugin
    loaded with the **UDT** one would need to reset the workspace to reposition the panel」。
- **决策 1 —— 不改 `manifest.json`。** 我们的 panel 段与官方示例逐字段一致，
  **没有任何字段能影响停靠**。没有证据就改（比如凭感觉调小 `minimumSize`）是**给未来埋坑**：
  改完没效果，却会让人以为"这块查过了"。
  ⇒ 想降 `minimumSize` 宽度必须有"完全没有落点提示"这个观测支撑才动。
  > 这条是方法论：**"查无实据"本身就是一个结论**，要如实说出口，不要用一次改动去冒充进展。
- **决策 2 —— 治本方向是"正式安装"，所以先把打包做成可复现的。**
  新增 `tools/build-ccx.cjs`（自己写 zip，不依赖 UDT 的 Package 按钮），替换掉
  14:51 那份过期 `.ccx`（早于 v0.2.0~0.2.3）。
  - 三条硬约束：**`manifest.json` 必须在包根**；**排除 `verify.flag` / `.uxprc` /
    所有点开头文件**（带上 `verify.flag` 会让每个用户一开 PS 就闪一个临时文档）；
    **写完必须回读中央目录做验收**（条目数一致 + manifest 在包根）。
  - 为什么不用 PowerShell `Compress-Archive`：本环境拿不到 PowerShell 的 stdout，
    第一次执行**静默失败**（退出码 0、文件没生成）→ 已经踩过一次。
- **决策 3 —— 记下"装 .ccx 的正规通道 = UPIA"这条具体命令**（本机缺 UPIA / CC，暂时装不了）：
  ```
  UnifiedPluginInstallerAgent.exe /install "…\dist\com.vellum.toolbox_PS.ccx"
  ```
- **未自证**：拖拽的真实症状（完全无落点提示 / 能吸但留不住 / 想要自动停靠，三选一未定）；
  `hostAppPluginWorkspace` 开关的确切语义**没查到官方说明**（⚠️ 不要凭字面猜）；
  `.ccx` 未真机安装验证（本机装不了）。

## 2026-10-10　PS 被外部 COM 自动化，前提是**PS 以 `/Automation` 启动**

- **决定（2026-10-10 20:20 定案；含对前一版措辞的更正）**：接 PS 的外部自动化通道
  （MCP / VBS / pywin32）时，**要让 Photoshop 处于"自动化服务器"状态**。
  实测确认的可行做法是：**先把 Photoshop 完全退出，再让 COM（即 MCP 的第一次调用）
  自己去启动它** —— 这样拿到的实例命令行带 `/Automation -Embedding`，此后 COM 一路可用。
  - **直接读数**（不是推测）：
    `PID 41136  CMDLINE: "D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe" /Automation -Embedding`。
    `-Embedding` 是 **OLE 服务端进程被 COM 拉起时**才会附加的旗标。
  - ⚠️ **更正**：本条目最初写成"必须用**手动** `/Automation` 启动 PS，为此新增
    `tools/photoshop-with-automation.cmd`"。**方向对、操作法说错了** ——
    那个 `.cmd` 走的是"手动带参数启动"这条路，**没有真机验证过**，降级为备选，不要当首选。
  - **机制**：PS 已正常启动（无 `/Automation`）时，`CreateObject` 会去拉第二个
    `Photoshop.exe /Automation`；新实例发现已有实例 → 想**交棒**给老实例当自动化服务器 →
    老实例没开自动化，接不了 → 新实例 ~3 秒退出 → COM 激活超时 → **429**
    （`ActiveX 部件不能创建对象`）。
- **为什么**（三方交叉，非推测）：
  1. 注册表：`Photoshop.Application` → CLSID → `LocalServer32 = Photoshop.exe /Automation`
     （**只有这一种启动方式被注册成自动化服务器**）；
     三个 ProgID（含 `.200` / `.200.1`）**全部指向同一健康 CLSID**，**注册表没问题**；
     四视图全查 ⇒ **不是位数问题**；本机只装 1 个 PS ⇒ **不是多版本别名问题**。
  2. 实测（0.1 s 精度）：调用期间**第二个 `Photoshop.exe` 出现，3 秒后自行退出**
     （正常启动 15~40 s）⇒ 「检测到已有实例 → 交棒 → 退出」；随后 COM 等约 27 s
     报 VBScript **429 `ActiveX 部件不能创建对象`**。
  3. Adobe 官方（*Photoshop OLE Automation Programming Guide*）：
     「automation class factory is a **single use object** … can't be created if it is
     **already in use by another application**」—— 即"在跑的实例不可被自动化"。
- **放弃的方案**
  - **改用带版本号的 ProgID**（`Photoshop.Application.200`）—— Adobe 社区那个同款 429 案例
    的解法，但**在我们这里无效**：三个 ProgID 解析到**同一个 CLSID**。
  - **改注册表把兼容性打开 / 重装 Photoshop** —— 注册表已证实健康，动它属于无据改动。
  - （保留为备选，不否决）**换 UXP 通道**：`adb-mcp` 或自建 dev 门控「文件桥」。
    留作 `/Automation` 也失败时的退路。
- **观测纪律（本轮最贵的教训，第四次"工具骗人"）**
  > **"没观测到" ≠ "没发生"。**
  > 采样频率必须与被观测事件的**时长量级**匹配。用 ~0.3 Hz（我那套的实际间隔 ——
  > `ps -W` 每次要跑 2~3 秒，不是我以为的 1 秒）去观测一个存在 <1 s 的文件，
  > 只会得出一个**确定但错误**的结论 —— 上一轮我就是这样把"结果文件写完即被
  > `finally` 删除"误判成"卡在 COM 里"，还据此写了档案。
  - 推论 ①：只要还有「**放宽超时就能拿到错误原文**」这种更便宜的路，
    **就不要先去做观测实验** —— 直接要错误原文。
  - 推论 ②：**别把工具给的"分类"当成"事实"** —— `extendscript_timeout` 是按正则匹配
    出来的分类，后面那句 "Photoshop is still running a previous script" 是**模板句**，
    不是观测结果。
- **已自证（2026-10-10 20:16）**：MCP 打通 —— `ping` / `get_state` / `execute_script` 全通；
  现用 Photoshop 进程命令行 `…\Photoshop.exe /Automation -Embedding`（`-Embedding` = COM 拉起）。
- **仍未自证**：手动用 `/Automation` 启动 PS 是否也够（`.cmd` 那条路未实测）；
  整条链第一次调用为何要跑满约 30 s（PS 只占 3 s），疑似 DCOM 激活超时或端点安全扫描；
  本会话环境禁止实例化 COM 对象，所以机制是三方交叉推出而非亲手复现。

## 2026-10-10　Photoshop 的 ActionDescriptor **必须照抄或录制，绝不允许猜**

- **决定**：凡是要往 PS 发 ActionManager 描述符（UXP `batchPlay` 与 ExtendScript
  `executeAction` 同源），**要么照抄 Adobe 官方文档原文，要么用 ScriptListener / Alchemist
  录一次真实操作**。**不允许"按记忆拼一版试试"。**
- **原因（同一轮里连续四次实证）**：
  | 猜的东西 | 结果 |
  |---|---|
  | `Mk contentLayer`（造纯色填充图层） | `发生了常规 Photoshop 错误` |
  | 文字改色：`_target:[{_ref:"textLayer"}]` + `to.textLayer.textStyle.color` | **不报错、像素也不变** |
  | 文字改色：`_target:[{_ref:"layer"}]` + 同上层级 | **不报错、像素也不变** |
  | 文字改色：`_target` 顺序颠倒 | 报 `命令"设置"当前不可用` |
  ⇒ **"静默失效"是主旋律**：四条里三条不报错。**没有像素判据，猜错根本发现不了。**
- **正确做法（已落地）**：文字图层改色的描述符取自
  *Adobe Photoshop API v2 · Text Layer Operations*，三个硬点照抄：
  ① `_target` **两级**（第一级 `_property:"textStyle"` + `_ref:"property"`，第二级 `textLayer`）；
  ② 颜色在 **`to.textStyle.color`**；③ JSX 侧 `putProperty` 必须先于 `putEnumerated`。
  真机一次通过（直方图最低亮度 0→71、`kind` 仍是 `TEXT`）。
- **配套的三条纪律**
  1. **每加一条新描述符，先写"命令形状"离线断言**（断言 20 就是这么钉的：
     `_target` 级数、各级内容、`to._obj`、以及"不许发 `fill`"）。
  2. **判据必须是像素级"有变化"，不是"命令没报错"**（v0.2.2/v0.2.3 已定，这轮再次证明必要）。
  3. **认不出的形态别硬试，也别乱退**：内容族与文字族都**绝不退到 `fill`**
     （PS 会给 `命令"填充"当前不可用` / `命令"<未知的>"当前不可用`）。
- **放弃的方案**
  - "多写几条候选按序试"：对**可控的两种已知写法**还成立（contentColorA/B 就是这么做的），
    但**不能当通用策略** —— 这一轮四条文字候选里三条静默失效，试错成本全靠像素判据兜底。
  - 手工推导 DOM→AM 的映射：**DOM 与 AM 不是一一对应**（`layer.kind = SOLIDFILL`
    被 PS 直接拒绝："您只能将图层的类型更改为文本或正常"）。
- **未自证**：PS 2026 **没有随装 ScriptListener**（`Required/Plug-ins/Extensions/`
  只有 `ScriptingSupport.8li`），所以"录制"这条路本机还没实际走通过 ——
  但它现在是**可走**的（MCP 已通）。**「纯色填充图层」改色就是卡在这上面，仍未解决。**

---

## 决策：M2 镜像的缩略图**必须用 png/jpg，不能用 webp**（2026-10-10，自检 S19 实测）

- **背景**：`docs/10` §10.6 原设计是「缩略图**直接复用 VellumDesk 的 `_thumbs`（webp），
  不重新生成**」—— 前提是插件能渲染 webp。
- **实测（S19，真机）**：把 `ArrayBuffer` 渲染进**可见**容器的 `<img>`，
  判据用 `naturalWidth` 等于**预期尺寸**（不是只比 `>0`）：
  ```
  webp-alpha (VP8X 带 alpha, 155×320)    dataURL ✗  blobURL ✗
  webp-plain (VP8 有损无 alpha, 78×160)   dataURL ✗  blobURL ✗
  png        (64×48)                     dataURL ✓  blobURL ✓
  jpg        (64×48)                     dataURL ✓  blobURL ✓
  ```
  两种 webp 编码变体、两条 URL 路**全失败**；同一个容器里 PNG/JPEG **立刻成功**。
- **结论**：**UXP 的 `<img>` 不解码 webp** —— 平台约束，不是用法问题。
- **决定**
  1. **镜像里的缩略图一律用 png 或 jpg**；带透明用 **PNG**（实测 `_thumbs` 的缩略图确实带
     alpha，`f1.webp` 是 VP8X flags=0x10），无透明可用 **JPEG**（省体积）。
  2. **`_thumbs` 本身不动** —— 它是 VellumDesk 自用的缓存（它自己渲染支持 webp）。
     转码只发生在**写镜像那一步**。
  3. `docs/10` §10.6 的体积预算（webp 4.2 KB/张 → 3000 张 23.4 MB）**作废，需重算**。
- **同时确立的方法学纪律（第五条"工具骗人"）**：**多嫌疑并存时，先造一个"必定成功"的
  基准把变量分开。** 首版探针同时有「格式」与「容器可见度」两个嫌疑，且只测了 webp ——
  "渲染失败"**无法归因**；补上 PNG 基准后才发现 png 成功，于是容器嫌疑被排除。
  ⇒ **没有基准的失败实验，等于没做实验。**
- **未自证**：PNG/JPEG 的**真实体积量级**未测（本机无现成 jpg，PS 导的那张是纯色、不具代表性）。

---

## 决策：契约变更 —— 缩略图格式 `webp` → `png`/`jpg`（2026-10-10，插件侧发起）

- **依据**：本机真机自检 **S19** —— **UXP 的 `<img>` 不解码 webp**。矩阵
  `webp-alpha ✗ / webp-plain ✗ / png ✓ / jpg ✓`（同一可见容器、`data URL` 与 `blob URL` 两条路；
  判据是 `naturalWidth` **等于预期尺寸**，不是只比 >0）。
- **改了什么**（权威源 `D:/vellum-link/LINK-CONTRACT.md`）：
  - **§5.5** 缩略图约定：格式 `webp` → **`png`（默认，保透明）/ `jpg`（无透明可选）**；命名 `<assetId>.<ext>`
  - **§9.1** 新增第 7 条（`<img>` 不解码 webp）、第 8 条（**能**读自身 PluginData 的子目录与二进制）
  - **§六** 「前置待实测」→ 标注"**已验过一半**"
  - **§2.3** 进度表：插件侧「读镜像并渲染」→ 🔷 地基已实测通过
  - **§5.3** 补注：通用库 = **公司通用素材 + 用户自积累素材**（用户 2026-10-10 明确）
- **为什么不升契约版本**：契约版本仍为 **`vellum-link/1`** —— 改的是缩略图的**文件格式约定**，
  而 `asset.thumb` 仍是「镜像内相对路径」字符串（**扩展名自带格式信息**），协议结构未变。
  按契约 §十 走「改正文 + 两侧 `DECISIONS.md` 各记一条」。
- **已在 `LINK-LOG.md` 发公告**（带 `[插件侧]` 前缀 + 日期）；**待软件侧确认**。
- **对软件侧的连带要求**
  1. **写镜像时把 `_thumbs` 的 webp 转码成 png/jpg**；**`_thumbs` 本身不动**（它自己渲染支持 webp）。
  2. **§10.6 的体积预算作废** —— 那张表按 webp 4.2 KB/张 算的，换 png/jpg 后**需重新实测**。
- **未自证**：PNG/JPEG 的**真实体积量级**（本机无代表性 jpg 样本 —— 工作区里唯一那张 p2.jpg 是
  PS 导的纯色，不具代表性）。

---

## 决策：插件**只读**镜像；「置入」走 handoff 握手，**不存在**直连 `absPath` 的路（2026-10-10，真机实测）

- **背景**：M2 置入原本设计了两条策略，① 是"把 `asset.absPath` 直接交给 PS 的 `placeEvent`"，
  意图**省掉整条原图搬运**（若成，契约 §六 可以大幅简化）。
- **实测（真机 PS 27.2 / UXP 9.0.2，自检 S21）**
  - 裸路径 → `Error: invalid file token used`；
  - 沙箱内 Entry → `localFileSystem.createSessionToken(entry)` → 令牌 → 同一描述符 → **成功**
    （`图层数 1 → 2　changed=true`，两次一致）。
- **结论**：Photoshop 的 AM 层要的是 **UXP 授权过的文件令牌**，不是路径。能拿到 Entry 的只有
  ① 插件自身 PluginData ② 用户经文件选择器授权 ⇒ 用户的 `absPath` **两条都不满足**。
- **决定**
  1. **直连 `absPath` 置入不实现**（代码里保留显式拒绝 + 实测错误原文，防止以后有人"顺手加回来"）。
  2. **契约 §六 的 handoff 是必需项**，不是可选优化 —— 它是"把原图送进我们能拿到 Entry 的目录"，
     这是**唯一**可行路线。
  3. `lib/ps.js placeFile()` 的入参**收窄为 Entry**；字符串路径**立即拒绝**且**不发任何命令**
     （离线断言 27 钉死这条）。
- **契约同步**：§9.1 新增第 9 条（平台约束）、第 10 条（`getEntryWithUrl` 待查）；§六 前置待实测改"已验过"；
  §2.3 进度表；`LINK-LOG.md` 发 3 条 `[插件侧]` 公告。**属加法，不升契约版本**（`vellum-link/1` 不变）。
- **未自证**：端到端（`req.json → res.json → incoming`）没跑完 —— 需软件侧实现后配合。

## 决策：诊断项允许"无结论"，但**不许**把"无结论"写成结论（2026-10-10，S22 自查）

- **事件**：S22 想验"能不能直读沙箱外的绝对路径"，用沙箱内路径当**基准**。首版读数里**基准也失败**
  （`Could not find an entry of 'file:///…PluginData/library/thumb/401.png'`），
  而我把结论写成了「沙箱外不可读 ⇒ 直连置入不可行」—— 基准失败时这个推论**不成立**。
- **决定**
  1. 探针结论**分三档**落库：基准失败 = **无结论**；基准成功+目标成功 = 可行；基准成功+目标失败 = 不可行。
  2. 契约里如实记"待查"，**不据此改架构**。
  3. 这是本项目**第五次**踩同一类坑（量法错 → 判据错 → 判据可靠性 → 观测精度 → 本次"基准缺失"），
     纪律固定为一句：**没有基准的失败实验 = 没做实验。**
- **同时确立**：**期望值必须独立算**。S20 的卡片数**不复用 `mirror.js` 的展平结果**，
  而是自己递归数原始 JSON —— 否则是"拿自己的输出验自己"。

---

## 决策：确认软件侧按 §十 提的三处加法；其中 ②③ **实现**、① 零改动但**暴露了我方一个真实缺陷**（2026-10-10，插件侧）

- **背景**：软件侧在 `LINK-LOG.md` 公告并已改契约正文（§5.3 / §5.4 / §5.5）三处**加法**（不升版本）：
  ① 缩略图命名加命名空间（任务 `t<id>` / 通用 `b<id>`）；② `asset.source`（`company`/`user`）；
  ③ `groups[].parentId`（通用库两层分组）。软件侧请插件侧确认，并说明"②/③ 若要用于筛选/建树则实现，
  用不到就按忽略未知字段处理"。
- **决定：三处全部接受。②③ 都实现（不是"忽略未知字段"）。**
  - **③ 必须做**：不做两级的话，筛选行会把**父组和子组平铺成同级 chip** —— 父组点了没有素材、
    子组却和它并列。那是**错的 UI**，不只是缺个功能。
  - **② 做，但只在"能起区分作用时"出现**：「来源」行仅在**当前分组内**真有 ≥2 种来源时才画；
    否则那一行永远只有一个选项（那是噪音）。卡片角标同一套规则。详情行始终显示来源。
  - **① 零改动**：`asset.thumb` 对插件一直是"不透明路径"，插件按字符串取图、从不解析文件名。
- **① 顺带暴露的真实缺陷（本轮最有价值的一条）**：`lib/mirror.js` 的**缩略图缓存键原来用 `asset.id`**，
  而**两库 id 各自从 1 起** ⇒ 两库的 #1 是同一个键。原来只靠"revision 变了就 `clearThumbs()`"兜着 ——
  可**两个库的 revision 完全可能相等**（最典型：首次同步后 `task rev=1` / `brand rev=1`），
  那时不会清缓存 ⇒ **切库后网格里显示的是上一个库的缩略图**（不报错、只是图不对，最难发现的那种）。
  **修法**：键改成 **`asset.thumb`**（自带命名空间，天然唯一）。离线断言 32 用"同 id、同 revision、
  只差 thumb"的两个 asset 钉死。
  > 诚实标注：这个缺陷是**读代码 + 离线断言**确认的，**未在真机上复现**（复现需要两库 revision 恰好相等）。
- **顺带修掉自检自身的一处竞态**（`S20c/S20d` 同一轮才暴露）：
  `tools/library.js` 的 `switchScope()` 是**异步的**，而 S20b 结尾"切回原库"那次点击**没有被等待**；
  于是 S20c 紧接着操作筛选行，而它等的条件"tab 高亮 + 网格里有卡片"会被**上一个库留下的旧网格**满足
  ⇒ 操作到的是旧库的筛选行。第一轮碰巧过关（旧网格属于同一个库），第二轮就从 FAIL 显形。
  **修法**：网格元素带上 `data-scope` / `data-rev`，自检的等待条件**点名是哪个库**。
  **这是同一族缺陷的第二次**（v0.2.7 的 S20b 也是"判据描述的是'DOM 里现在有什么'，
  而不是'我要的那个库渲染完了没有'"）。教训：**判据要描述"我等的那个东西"，不是"看起来像的东西"。**
  **同时确立一条做法**：**改完自检要连跑两次**，而且**两次的起始状态要不同** ——
  这一条缺陷就是"两次结果不一样"才被抓出来的。
- **未自证**：真机上"两库 revision 相等导致串图"没有复现；两级分组只验到**两层**（三层以上按顶层兜底，
  有离线断言 30，无真机样本）；来源筛选只验了 `company`/`user` 两种取值。

---

## 决策：二级筛选用**自绘下拉**，不用原生 `<select>`、更不能押 Spectrum（2026-10-11，真机 S23 实测）

- **背景**：用户反馈通用库的两层按钮"UI 臃肿"，建议二层改成**下拉选择控件**（样式沿用现有风格）。
- **实测（PS 27.2.0 / UXP 9.0.2，自检 S23）**
  - 原生 `<select>` **可用**，但 `setAttribute("value", …)` 之后 `.value` 返回 **`"undefined"`**；
    改走 `option[i].selected = true` 后 `.selectedIndex` / `.value` 都正确。
  - Spectrum `sp-picker` / `sp-dropdown` / `sp-menu-item` **全部未注册**：
    与**伪造标签名**的三项读数（未注册 / 无 shadowRoot / display=block）**逐项相同**，
    而 `customElements.define/get/whenDefined` 都是 function（注册表真实存在）⇒ 读数可信。
- **决定：自绘下拉**（`div[role="button"]` 触发条 + 绝对定位列表浮层）。
  - 原生 `<select>` 的**外观改不动**，与"样式沿用现有风格"这个硬要求直接冲突；
  - Spectrum 已实测死掉；
  - 自绘的唯一真风险（浮层与触发条的**振荡回路**）本项目刚踩过并有现成纪律。
- **落地纪律（沿用调色板那次的四条）**：浮层**不得覆盖触发条**（纵向留间隙）/
  关层由**容器根节点正着判**、不绑被覆盖元素的 `mouseout` / 状态**幂等** / 尺寸**让帧后**再量。

## 决策：「拖到画布」不做（平台不支持）；改做「**置入到指定位置**」（2026-10-11，真机实测）

- **背景**：用户问"是否可以实现素材拖动到画布指定位置"。
- **分两半，结论不同**
  1. **真·拖放 ❌ 不可行**：官方两条明文（Asset Link UXP 文档「UXP 框架**不支持**从面板拖放资产到当前文档，
     请改用**置入副本**」；*Known UXP Issues*「Drag and Drop is not currently supported」），
     本项目实测再加一条独立证据：**`DataTransfer` 在 UXP 里是 `undefined`** ⇒ 拖放**没有数据通道**。
     （论坛 2026-06 有 Adobe 员工称修复已合入待发版 ⇒ **留观察点**，但不当成已知能力。）
  2. **「放到指定位置」✅ 可行，且已验到像素级**：`placeEvent` 的 `offset` 与图层位移 **1:1 精确**
     （实测 `40,80,360,320` → `104,128,424,368`，Δ=+64/+48）；默认落点是**画布居中且不缩放**。
     插件要"放到 (x,y)"只需 `offset = (x − (画布宽−素材宽)/2, y − (画布高−素材高)/2)` ——
     **画布尺寸来自 `docInfo()`、素材宽高来自镜像 `asset.width/height`（契约 §5.4 必填）**，
     ⇒ **不需要任何新能力**。
- **决定**
  1. **不做真拖放**，也不做"假装能拖"的手势；
  2. 需求 B 的落地先做**九宫格落点**（左上/上中/…/居中/…/右下 + 边距），零新能力依赖；
  3. **选区当落点**（"框哪儿放哪儿"）**暂不进方案** —— 见下一条未验；
  4. 顺手记录一条**将来可升级**的观察点：Adobe 已合入 DnD 修复，若某版 PS 放开，
     可在 S23 复测 `DataTransfer`，一旦存在就能真的支持拖放。
- **未验（不许写成结论）**
  - **选区落点**：ExtendScript 侧带区域的 `select()` 五种写法全失败、`deselect()` 也失败，
    **但基准 `selectAll()` 成功** ⇒ 只能说明"那几种区域写法不行"，**不能说选区不可用**；
    而且失败的是 **legacy ExtendScript DOM**（MCP 的通道），**插件走 UXP/AM 是另一条路**。
    ⇒ 记为待做探针 **S24**（建选区 / 读选区 / 置入后按矩形缩放）。
  - `<select>` 的下拉弹层能否正常打开（要真点击；本轮只验了"能建、能读值"）。
  - 置入后**按目标矩形缩放**（`offset` 只管位置，不管尺寸）。
  - 自绘拖拽的**真鼠标触发**（合成事件不算；鼠标事件本身有实物基准 —— 调色板）。

## 方法学：**能力判据必须带"不存在的基准"**（2026-10-11，S23 第一版错判）

- **事件**：S23 第一版用"给 `sp-picker` 设了宽高之后，几何 = 120×24"作为"组件渲染出来了"的证据。
  **但把伪造的标签名 `sp-not-a-real-thing-xyz` 放进去，几何同样是 120×24** ——
  那个读数只证明"我设的宽高生效了"。加上"**不设宽高 + 伪造标签名当基准**"之后才看清真相。
- **决定**：凡"某元素/某能力存在"的判据，**必须配一个"一定不存在"的对照组**，
  而且**至少两个互相独立的判别维度**（本例：注册表 + shadowRoot + computed display）。
  单靠"几何非零 / 不报错 / 有返回值"这类读数，会把"我自己的输入生效了"误当成"平台支持"。
- 这是本项目**第六次**同族错误（量法错 → 判据错 → 判据可靠性 → 观测精度 → 基准缺失 → **基准缺失（再一次）**）。
  纪律保持不变：**没有基准的失败实验 = 没做实验。**

---

## 决策：二层筛选用**自绘下拉**落地；浮层必须落在滚动容器内（2026-10-11，v0.3.0）

- **依据**：`docs/25` 的能力实测（原生 `<select>` 外观改不动、Spectrum `sp-picker` 未注册）。
- **落地**：触发条（当前子类+计数+▾）+ 绝对定位浮层；一层仍是按钮。
- **纪律**（沿用调色板那次的四条）：浮层**不覆盖触发条**（下方 +6px 间隙）/
  关层由**容器根节点正着判**、不绑被覆盖元素的 `mouseout` / 展开态**幂等** / 尺寸**让帧后**再量。
- **新增一条可测不变量**：**浮层矩形必须完全落在滚动容器 `.scroll` 之内**。
  理由：`.scroll` 有 `overflow-y:auto` ⇒ 越界部分**会被裁掉**，用户只会看到
  "下拉点开了但里面是空的" —— 这类错在真机上极难归因。已作为 S20c 的硬判据。

## 决策：`placeEvent` 的默认落点 = **选区中心**（无选区则画布中心）⇒ 九宫格基准必须动态取（2026-10-11）

- **真机实测（S24）**：无选区 → bounds `40,80,360,320`；有选区 `120,140,320,300`（中心 220,220）
  → bounds `60,100,380,340` ⇒ **素材居中于选区**、且不缩放。
- **连带后果（这一条差点让我算错）**：`offset` 是**相对默认落点**的位移 ⇒
  有选区时它叠在**选区中心**上。若九宫格仍以画布中心为基准，用户在有选区时选「左上」会**整体偏掉**，
  而画面不报错、只是位置不对。
- **决定**：新增 `ps.placeBaseCenter()`（返回 `{cx,cy,from:"selection"|"canvas"}`），
  `anchorOffset()` 增加 `base` 参数；UI 与自检**一律走它**，不许自己假设画布中心。
- **附带事实**：**这次置入会把选区吃掉**（S25 读数 `【置入后选区=无】`）⇒
  "框哪儿放哪儿"是**每次插入前框一次**。已写进界面提示（否则用户会以为选区一直在）。

## 决策：选区**建/读**用 `AM.setd`，不用 UXP DOM（2026-10-11，S24 实测）

- 同一台机器上四种写法：`DOM.select(2×2 数字)` ✗ / `DOM.select(扁平 4 数字)` ✗ /
  `DOM.selectAll()` ✗ / **`AM.setd(Chnl/fsel + Rctn)` ✓**。
- ⚠️ **而 ExtendScript 侧恰好相反**（`selectAll` 行、区域写法全不行）。
  ⇒ **两条 DOM 的可用性不能互相推断** —— 这也是当时拒绝把 MCP 的失败读数当结论的原因。
- 可用写法收进 `lib/ps.js setSelectionRect()`，注释里写明"真机试出来的"。

## 方法学：读数**分不清原因**时，加一个能把原因区分开的读数（2026-10-11，两处都用了）

- **S25 的 ④**：③ 通过、④ 不通过，**任何单一规律都无法同时解释两步** ⇒ 说明两步之间"有什么变了"。
  **没有改判据去迁就它**，而是加"选区存活读数" → 一跑就看到 `【置入后选区=无】`，
  于是补上"重建选区"这个**必要前置**，并把这条事实记下来。
- **S20c 那次 FAIL**：读数只有"浮层几何始终为 0"，**分不清**"没渲染 / 渲染了没展开 / 展开态被抹掉"。
  同样没猜，而是补 `libBarSig()`（筛选区结构签名）+ 在失败分支里同时报
  **展开态现在是什么** 与 computed `display`，并明确区分"**状态还在、是没进布局**"与"**展开态没了**"。
- ⇒ 纪律：**只有一种读数的失败，等于没测**。先让失败能自己解释自己，再谈根因。

---

## 决策：库的"形态"（有没有项目层）按**结构**判定，不按 scope id（2026-10-11，v0.3.1）

- **背景**：任务库要把"项目"从一排 chip 改成顶部下拉；通用库的顶层仍是按钮。
  界面必须知道"当前这个库是哪种形态"。
- **决定**：新增 `mirror.scopeKind(data)` —— `task.json` 有 `projects` → `"task"`；
  `brand.json` 有 `groups` → `"brand"`；其它 → `"unknown"`（按"没有二级结构"处理，**宁少不崩**）。
- **为什么不用 `if (scopeId === "task")`**：软件侧将来**加库 / 改名 / 换 id** 时，
  那种写法会**静默失效** —— 界面照常渲染，只是少了那块功能，没有任何报错。
  这与"契约是唯一耦合点"的设计相冲突：**耦合点应该只有数据形状，不该多出一个 id 约定。**
- **附带**：`scopeKind` 是纯函数，离线可断言（断言 39）。

## 决策：项目筛选**复用 `S.group`**、且**只有一个项目时不画**（2026-10-11）

- **复用**：`S.group` 本来就是"顶层分组"这一个筛选条件 ⇒
  `itemsInGroup` / `visibleItems` / `filterLabel` / `pruneFilters` **一行都不用改**。
  另起一个 `S.proj` 会让"哪些筛选参与可见性计算"出现两份真相。
- **不画的条件**：只有一个项目时下拉只有一个选项 —— 那**不构成筛选**，只是噪音。
  与「来源」行（`srcs.length > 1` 才画）**同一条判断**。
- **副作用（已写进 docs/27 §二）**：任务库的筛选区因此只剩一个总数计数。
  **离线断言 40 钉死"项目条件不许重复画一遍 chip"**（选完项目后筛选区 chip 数必须为 0）。

## 决策：贴行尾的下拉，浮层必须**右对齐**展开（2026-10-11，v0.3.1）

- **背景**：二级下拉从"独占一行"挪到"一级按钮那一行的最右"。`.fsel-pop` 原本是 `left: 0`（往右展开）。
- **问题**：贴到行尾后往右展开必然越界，而滚动容器 `.scroll` 同时有
  `overflow-y: auto` 与 **`overflow-x: hidden`** ⇒ 越界部分**直接被裁掉**，
  用户只会看到"点开了但里面是空的"。这类错在真机上极难归因。
- **决定**：`.fsel-pop` 改用 `right: 0`（往左展开）+ `max-width: 230px` + 选项文字截断。
- **守门**：离线断言 38 做源码级校验 —— **`right:0` 存在且 `left:0` 不存在**。
  这条与"浮层必须落在滚动容器内"是同一族的可测不变量（v0.3.0 立的）。

## 决策：自绘下拉的展开态存**元素 id**、且同时只允许一个展开（2026-10-11）

- **背景**：页面上现在有两个下拉（项目 / 二层子类）。原来只有一个，展开态存在 `S.subOpen`（布尔）。
- **问题**：布尔状态让两个下拉**各自为政** —— "点开 A 再点开 B"会让 A 的浮层留在原地
  （每个组件都以为"我很可能是开着的"）。
- **决定**：展开态改为模块级 `openSel`（**wrap 的 id 字符串**）；`openSelect()` 先 `closeSelect()`。
- **附带**：`renderProjSel()` / `renderFilters()` 开头都 `closeSelect()` —— 重建 DOM 前先关层，
  否则 `openSel` 会指向已被移除的节点。
- **顺带**：抽出 `makeSelect(cfg)` 供两个下拉共用（否则纪律要写两遍，迟早只改一处）。

## 方法学（第三次踩同一族）：**测试数据也必须能区分"对"和"错"**（2026-10-11）

- **事件**：项目筛选落地后，假软件桩里**只有一个项目** ⇒ 选项只有一个，
  而"只有一个选项就不画"是我们自己定的规则 ⇒ **项目筛选在真机上根本没被验到**。
  更糟的是离线断言 40 会因"二级下拉没出现"这种**与真因无关**的现象 FAIL，我一度去查渲染逻辑。
  ⇒ 给桩加了第二个项目（`秋季宣讲`，1 个任务包 / 1 张素材），"选它后卡片 3→1"才看得见。
- **纪律**：**一个"永远成立"的样本验不出任何东西。** 造测试数据时要问一句：
  "这份数据能让实现错、断言仍然通过吗？" 如果答案是"能"，那它就没用。

## 方法学（第四次踩同一族）：**判"元素没了"要判它是否还挂在文档上**（2026-10-11）

- **事件**：离线断言 40 第一版用 `!!document.getElementById("vt-lib-projsel")` 判"下拉是否消失"。
  **错**：离线 mock 的 `byId` 是**只增不减**的注册表，`removeChild` 不会摘掉它 ⇒
  脱离 DOM 的老节点**仍然能被找到**，那条判据**永远为真**。
- **决定**：改判**是否还挂在文档上**（沿 `parentNode` 往上走）。
- **附带**：同类修正 —— `libBarSig` / `libFlatSubChips` 原来用 `indexOf` 判 class，
  于是 `.fchips`（行内 chips 容器）被当成 `.fchip`，结构签名里冒出 `chip:null`。
  新增 `hasClass()` 按 **class token** 判。
- ⇒ 反复出现的同一句：**判据要描述"我等的那个东西"，不是"看起来像的东西"。**

---

## 决策：`handoff` 取图**必须等文件落盘**；且失败文案不许说"已就位"（2026-10-11，v0.3.2）

- **背景（真机实测）**：`res.json` 报 `ok:true / size=627927 / file=handoff/incoming.jpg`，
  而 `handoff/` 里**根本没有那个文件**；插件 `boot.log` 在 req 之后 **1 秒**就报
  `incoming ok=false … err=文件不存在：incoming.jpg`。
- **两个错都在插件侧**
  1. **判据太脆**：`fetchIncoming()` 读一次就返回 ⇒ 把「**竞态**（软件先写 res、后拷文件）」
     与「**软件压根没拷**」混成了同一个现象。
     → 改成看到 `res` 之后**再轮询 5s / 每 250ms 等文件落盘**（`FILE_WAIT_MS`）。
     这层兜底**不依赖对方守约**。
  2. **反馈错位**：原文案「原图已就位但拿不到可置入的文件句柄」—— 文件压根没到。
     → 改成能**区分**三种原因（res 说 ok 但文件不在 / res 说 ok:false 带原文 / 根本没等到 res），
     并把"请它按**先拷文件、后写 res.json**"写进文案。**判据正确 ≠ 反馈正确。**
- **契约同步**（§十 流程，加法不升版本）：§六 新增
  **规则 6｜顺序**（先落文件、再写 res；拷贝失败必须写 `ok:false` + `error`，不要乐观写 `ok:true`）、
  **规则 7｜`file` 语义**（镜像内相对路径、带 `handoff/` 前缀，插件取 basename）。
  `LINK-LOG.md` 发 `[插件侧]` 条目，附全部原始读数 + 三条待对方确认。**⚠️ 尚未收口。**
- **未自证**：软件侧到底有没有拷文件，**不知道**。插件侧的兜底与报错能改善可诊断性，
  但**若对方确实没拷，兜底也救不了** —— 等回复后需再跑一次端到端。

## 决策：「哪些库存在」只看 `manifest.scopes[]`，**不看磁盘上有没有那个文件**（2026-10-11，v0.3.2）

- **背景**：真机第一轮自检 `26/29`，其中 **S20c/S20d 是假 FAIL**。
  归因：它们的前置**直接读 `library/brand.json`** 就开工，而磁盘上躺着一份
  **stale `brand.json`**（我早先的假软件桩留下的），而真 `manifest.json` 里
  **根本没声明 `brand` scope** ⇒ 自检兴冲冲去操作一个**界面上根本不存在的库**。
- **决定**
  1. S20c/S20d **先查 `manifest.scopes[]`**；没声明就记 `rec(name, true, "【不适用】…")`，**不判失败**。
  2. **「不适用」统一记成 pass + 显式文字** —— 让 **FAIL 只剩"真的有东西坏了"**，
     而不是"这个镜像没有那个样本"。否则红一片会把人训练成"忽略红色"。
  3. 同一族一并改掉：S19 的期望值改为**从原始 JSON 自己数**（不再写死 `taskRows===3 && brandRows===4`）；
     S21/S22/S24/S25 的测试文件改为**从镜像里挑**（`testThumbFile()`，不再写死 `t401.png`）。
- **为什么这条值得单独立决策**：它和"库的形态按结构判、不按 scope id"是同一条原则的两面 ——
  **插件的世界由镜像内容定义，不由"磁盘上有什么"定义。** 自检也必须守同一条。

## 决策：假软件桩**拒绝覆盖真镜像**（2026-10-11，v0.3.2）

- **背景**：真 VellumDesk 上线后，**真镜像与假 fixture 躺在同一个目录**。
  以前 `node tools/fake-vellumdesk.cjs` 是"随手一跑"，现在同一句命令会**把用户的真项目/真素材
  整个换成 fixture** —— 而且它看起来"成功"了（最难发现的那一类）。
- **决定**：识别 `manifest.generator.fixture === true`；不是我们写的就 **`exit 3`** 并打印原因。
  覆盖必须显式 `--force`；**`--clean` 同样受此闸保护**（它也会删掉真镜像）。
  解析不了的 manifest 一律按"不是我们的"处理（更安全：那时可能正被真软件写着）。
- **可测性**：安全闸抽成**纯函数 `canWrite(manifestPath, force)`** ——
  因为**本环境起不了子进程**（`spawnSync` 报 `EBUSY`）。于是靠两件东西守住：
  ① 纯函数的单测（真 manifest 拒 / fixture 允 / `--force` 允 / 空目录允）；
  ② **源码级断言**确认**两条写路径（正常写 + `--clean`）都调了**闸 —— 只测纯函数不够，
  得确认它真的被接上。`main()` 也改成 `require.main === module` 才跑（否则 `require` 一次就写盘）。
- **未自证**：CLI 的 `exit 3` 那条路**没有真跑过**（子进程被沙箱挡）—— 靠源码级断言替代，如实标注。

## 方法学：**"正确行为"不等于"用户看得懂"**（2026-10-11，v0.3.2）

- **事件**：用户报「通用素材库入口丢失」。查下来**插件没 bug** ——
  真镜像是 `manifest.scopes` 只声明了 `task`，而 tab **完全由 `scopes[]` 生成**（设计如此）。
  但用户看到的就是"入口不见了"，而面板**一个字都没解释**。
- **决定**：在不足 2 个库时，元信息下面**加一行如实说明**
  「镜像里目前只有 1 个库（任务库）—— 其余库要由 VellumDesk 写进 manifest.scopes 才会出现」。
  默认隐藏（≥2 个库时不占地方），离线断言 42 钉死。
- ⇒ 纪律：**判据正确 ≠ 反馈正确**（这条已有），本条是它的姊妹条：
  **行为正确 ≠ 用户能理解。** 只要"看不见的东西消失了"，就要在界面上说出**为什么**。

## 决策：出图体检 = **只读内核 + 一份数据三个出口**（2026-10-12，v0.6.0 / docs/49）

- **决定**：体检数据**只算一次**（`lib/inspect.js` 的 `docInspect()`），喂三个出口 ——
  面板常驻状态条 / 导出参数条 / 交付规格单。三处共用同一份 finding。
- **为什么**：三套逻辑各写一遍必然跑偏（状态条说"未转曲 3 个"、参数条说"2 个"就没法查）。
- **内核的三条纪律**（写进文件头，改代码前先读）：
  ① **纯函数与采集分离** —— `judge(snap, spec)` 是纯函数，离线可测；只有 `collect()` 碰 PS。
     规则改动因此不必每次上真机。
  ② **允许「无结论」** —— severity 专设 `unknown` 档。沿用既有纪律
     「诊断项允许'无结论'，但不许把'无结论'写成结论」。
  ③ **判"对错"必须带 `basis`** —— 凡依赖「用途」的判定，都要写出按哪套标准判的，**不偷偷判**。
- **`judge` 全程只读**：不进 `executeAsModal`、不改像素、不动选区。

## 决策：体检规范 `usage` **默认按"印刷"审**（2026-10-12，v0.6.0）

- **决定**：`DEFAULT_SPEC.usage = "print"`，即默认用最严的一侧判（CMYK / ≥300dpi / 印刷前要转曲）。
- **为什么**：**印刷稿错了代价最大（要重印），屏幕稿错了顶多重导**。
  默认按严的一侧审 ⇒ 宁可对屏幕稿误报「未转曲」，不可对印刷稿漏报。
- **配套**：每一处依赖它的 finding 都带 `basis`（如「按「印刷」标准 · Vellum 出图规范 v1」），
  界面上要能看见依据。离线断言 M5-2 用**负对照**钉死"usage 真的生效"
  （同一快照换 usage，结论必须变）。

## 决策：v1「缺字体」只 **warn**，不给定 `fatal`（2026-10-12，v0.6.0）

- **决定**：`findings` 里 `font` 项在检出缺失时是 `warn`（标红不拦），**不是** `fatal`。
  离线断言 M5-5 明确钉"不许是 fatal"。
- **为什么**：判定靠**名字比对** —— `layer.textItem.characterStyle.font` 给的是 **PostScript 名**
  （探针实测 `AdobeHeitiStd-Regular`），而 `app.fonts` 每项同时有 `_postScriptName` / `_name` / `_family`
  三种写法。先按 postScriptName 匹配、再退化到 family/name，**仍可能有误报**。
  `fatal` 会**拦住导出** —— 误报的代价比漏报大。等真机跑一段时间、误报率看清了再决定升级。
- **另注**：`app.fonts` **本身就是集合**（本机 `length=583`），**没有 `getFontList()`** ——
  探针第一版在这里报过 `not a function`。

## 方法学：**负对照抓到了 `Number(null) === 0` 这个真 bug**（2026-10-12，v0.6.0）

- **事件**：`pxToMm(px, ppi)` 最初写成
  `const p = Number(px); if (!isFinite(p)) return null;` ——
  而 **`Number(null) === 0`**（`Number("") === 0` 同理）⇒ **"读不到宽度"被静默换算成 `0 mm`**，
  而不是 `null`。
- **抓它的正是我加的离线负对照**（`px=null` 必须返回 `null`，实测返回 `0`）。
  上线时写的 M5-1 如果只验"300px@72dpi=105.83"这一条正例，这个 bug 会一路带到真机。
- ⇒ 纪律（老话重提，这次有实物）：**每条判据都要带上"不存在的基准"/负例**。
  "正例通过"从来不能证明"没有 bug"。

## 方法学：**离线断言不许写死行数/项数**（2026-10-12，v0.6.0）

- **事件**：往首页宫格加两行灰行（`inspect` / `template`），离线回归立刻挂了 3 条 ——
  `2`（`navs.length === 4`）、`2b`（`rowTitles === "调色板 / 素材库 / 表格生成 / AI-MCP"`）、
  `22b`（`registry.planned.length === 1`）。真机侧 S11 反倒没事（它的期望是**动态取** `allRows().length`）。
- **决定**：**不放宽，改得更强** ——
  · `2` 改成"渲染结果必须与注册表**逐行**对齐（行数 / 顺序 / `data-tool` / 名称四项全对）"，
    比原来的"名字等于某个字符串"**多验了顺序与 data-tool**；
  · `2b` 改成验"**已实现的不灰（可点）、规划中的灰着**"—— 这是原判据完全没覆盖的视觉语义；
  · `22b` 去掉 `planned.length === 1`，只断言**真正要保的那件事**：M4 的 `mcp` 仍灰着。
- ⇒ 纪律：**断言要钉"不变量"，不要钉"快照"。**
  写死数量 = 把一次性的目录当成不变量，结果是"每加一个功能就要回来改数字"，
  改着改着就会有人顺手放宽它。

## 纪律：**加自检项前先数一遍现有编号**（2026-10-12，v0.6.0）

- **事件**：本轮新项起初写成 `S49`，而 `S49` 已被「绑定第 1 个文字层」占用 ⇒
  真机报告里出现**两条 S49**（`results.filter(/^S49/)` 命中 2 条）。
- **决定**：改为 **S50**，并在代码注释里保留这次撞车的说明。
- **核对方法**（下次照做）：`selfcheck.json` 里
  `[...new Set(results.map(r => r.name.match(/^S(\d+)/)?.[1]))]` 取最大号 +1。
  顺带把真机 S11 的标题从写死的"4 行"改成"导航行"。

## 决策：常驻体检摘要必须与消息区**分成两个节点**（2026-10-12，v0.6.0 第 2 步）

- **决定**：`#vt-status` 从"一个文本节点"改为 `[.vchip（常驻体检摘要）] + [.stx（消息区）]`；
  `setStatus()` 改写 `#vt-status-tx`，不再写整块。
- **为什么**：`setStatus()` 是 `textContent = ...` 整块覆盖 ——
  只要摘要在同一个节点里，**任何一次 setStatus 都会把它抹掉**。
  而全插件到处都在调 setStatus，等于摘要永远活不过一次操作。
- **配套**：`.vchip` 定高 `flex:none`、`.stx` 自己带 `max-height:70px + overflow-y:auto`
  ⇒ 总高仍受原来的 92px 约束，且**摘要不会被滚走**。
- **⚠️ 连带代价**：`tools/offline-smoke.cjs` 里有一份**手写的 mock DOM**，
  改外壳结构必须同步改它（见下条）。

## 方法学：**离线 mock 的 DOM 必须与真 HTML 逐字对齐**（2026-10-12，v0.6.0 第 2 步）

- **事件**：把状态条拆成两个节点后，离线回归里 **16 / 19 / 20 三条调色板断言全挂**。
  查下来不是功能坏了 —— 是 **mock 里 `#vt-status` 还是旧的单节点**，
  于是 `dom.$("vt-status-tx")` 取到 `null`，`setStatus()` 写了个空，
  断言读状态栏文本自然读不到东西。
- **决定**：把 mock 的状态条结构与 `index.html` **逐字对齐**，并在 mock 代码里写明
  「改外壳 DOM 结构时必须同步这里」。
- ⇒ 纪律：**这份 mock 是"真 HTML 的影子"，不是自由发挥的测试替身。**
  影子与本体脱节时，报出来的失败是**假失败** —— 而且它会指向错误的方向（看起来像功能坏了）。

## 决策：状态条用**两段式刷新**，体检页用**只读**（2026-10-12，v0.6.0 第 2 步）

- **决定**：
  · **哨兵**（每 2s）只读 `doc.id` / `doc.name`（廉价），**文档变了才**跑完整体检；
  · **字体清单进程内缓存**（`readFontNames(force)`），只在 chip 被点击时强制重读。
- **为什么**：完整体检要遍历图层树 + 比对 583 条字体（≈1700 次属性访问），
  按秒跑既浪费又可能让面板发涩。而"文档换了"才是体检结果真正会变的时机。
- **体检页本版没有「一键补标」**：补标要给文档**写参考线**，而"UXP 能否主动创建参考线"
  **没验过**（探针只验了 `presetJSON` 能不能带 guides）。
  ⇒ **不放会改稿的按钮** —— 宁可少一个功能，不可让一个"点了没反应/点坏了"的按钮存在。
- **哨兵在自检之后才启动**：自检自己会建/关临时文档，提前开哨兵只会让它频繁空转并污染读数。

## 决策：「元素超出画布」是**降级替代**，必须在界面上自我声明（2026-10-12，v0.6.0 第 2 步）

- **背景**：真正的「文字溢出检测」**无结论** —— 探针 C7 已证 UXP DOM 建不出段落文字，
  拿不到"文本框 bounds"，就无法比对"框 vs 内容"（docs/49 §四）。
- **决定**：先用**可读的那部分**顶上 —— 读每个图层的 `bounds`，看有没有超出画布。
  · 阈值按**毫米**换算（`spec.overflowWarnMm = 5`），因为"超出 60px"在 72dpi 和 300dpi 下差 4 倍；
  · 未过阈值 = `info`（只报事实），过了才 `warn`；
  · **note 里必须写明"启发式、不是精确检测：可能是刻意的出血/阴影/裁切"**。
- **为什么必须自我声明**：它**分不清**"刻意的出血"和"真的溢出"。
  把它当成"文字溢出检测"来宣传，就是在骗用户 —— 而用户会因为这个误报去改本来没问题的稿。
  ⇒ 纪律：**降级替代必须自报家门**，不能借原功能的名义。

## 方法学：**负对照也会写错 —— 断言失败时先怀疑断言**（2026-10-12，v0.6.0 第 2 步）

- **事件**：`M5-11` 失败。第一反应是 `normBounds` / `overflowPx` 有 bug，
  查下来是**我的期望值写错了**：`left:-5` 表示"左边出界"，
  画布再大也仍然出界，而我却写了 `overflowPx(bdB, 500, 300) === 0`。
- **决定**：修正期望值，并在断言里把这个易错点写成注释。
- ⇒ 纪律：**负对照是"我写的"，它同样会错。** 断言失败的第一动作是
  "把两侧都算一遍"，而不是直接去改被测代码。

## 方法学：`Number(null) === 0` 这一族坑，**隔一轮又犯了一次**（2026-10-12，v0.6.0）

- **第一次**（第 1 步）：`pxToMm` 里 `Number(null) === 0` ⇒ "读不到宽度"变成 `0 mm`。
- **第二次**（第 2 步）：`normBounds` 里同样 —— `{_left: null}` 被当成"坐标 0"。
- **两次都是离线负对照抓到的**，两次都不是靠真机。
- **决定**：凡"从 UXP 读一个可能缺失的数值"，一律**先显式判空再转数字**：
  ```js
  if (v === null || v === undefined || v === "") return null;
  ```
- ⇒ 纪律：**JS 的 `Number()` 把 `null`/`""` 都变成 0**，而 0 和 null 在下游是两件事
  （0 = "就是 0"，null = "我不知道"）。这一条要当成**读 UXP 数据的默认写法**，别再靠记性。

## 整批撤销：入口归外壳、标记自动记、退回必须自证（2026-10-13 跨零点，v0.7.0）

### ① 撤销入口归**外壳**管，不由各工具自己实现

- 批量功能（现在的批量出稿、将来的导出审核版 / 批量试色）只负责**记标记**；
  状态条上那个撤销入口由**外壳统一给**。
- 理由：否则每个批量功能都要自己写一遍撤销 UI，而且**一定会写得不一样**
  （文案、失败提示、有没有读回校验、跨文档怎么判……）。
- 与既有纪律一致：`tools/index.js` 那条"加工具 = 加一个模块文件 + 加一行，外壳零改动"。

### ② 标记**自动记**，不做"请先点一下记标记"

- 用户要的是"**事后能退**"，不是"事前记得点"。
- ⇒ **要人记住的防护等于没有防护。** 这条可以直接推广到本项目其它防护性功能。
- 代价（一次模态 + 几个只读）相对一次批量出稿可忽略；记标记失败**不拦路**，
  但原因要原样带回 UI 说清楚"这次没法一键撤"。

### ③ 退回**必须读回自证**，不许靠"调完命令没报错"

- `revert` 的成败判据是**读回的图层数回到标记时的数量**，不是"赋值没抛异常"。
- 依据就是 S48 那条教训（`Layer.translate()` 不抛错、`moved` 计数也在涨，**bounds 一动不动**）。
- ⚠️ 这条判据是**必要不充分**（数量相等 ≠ 状态完全相同：可能删一个又加一个）。
  但它能挡住最危险的失败模式 —— "静默无变化"（恰恰是赋值失败时最可能的表现）。
  这个局限已写进 `lib/history.js` 文件头，**不许拿它当"完全正确"用**。

### ④ 标记**绑文档**；"图层数已与标记时相同"是**提示**、不是失效

- 换文档 ⇒ `assess` 返回**不可用**（不跨文档撤回），并说出标记属于哪一张稿。
- 但"当前图层数已等于标记时" ⇒ **仍然可用**，只加一句提示。
  - 理由：数量相等并不等于状态相同；**"它是不是已经在原位了"是我们判不出来的事**，
    所以只能提示，不能替用户下结论。
- 这两条 MUST 答得不一样。离线断言 **M5-14** 专门钉这点（`hOther.usable !== hEqual.usable`）。

### ⑤ 主路与备路**必须在读数上分开**

- 主路（持对象赋值）：读数说「对象赋值（**精确**）」。
- 备路（`_offset` 相对位移）：读数**必须自己说出**「相对位移 N 步（**可能不精确**）」。
  - 备路是**相对**的：用户若在批量之后又手动做了几步，它会退到**比预期更早**的位置。
- ⇒ **不许用读数把两条路说成一样准** —— 那是在用工具的措辞**掩盖一条真限制**。
- 离线断言 **M5-15** 钉死：主路读数里**不许出现**「可能不精确」。

### ⑥ 单槽标记，不做栈

- 用户心智只有"**刚才那次**批量我不满意"；"退回上上一次"几乎不存在。
- 做成栈只是凭空多一份要维护的状态，还逼用户在两个撤销入口里选。真出现需求再说。
- 覆盖旧标记时，把被覆盖的那个**记进返回值**（`superseded`）——
  它意味着"上一次的退回点没了"，**不能让这件事悄悄发生**。

### ⑦ 依赖方向单向：`ps.js → history.js`

- `history.js` **不** require `ps.js`（它自己写了 10 行数图层，就是为了避开循环依赖）。
- 循环依赖的症状是"某个模块拿到半截 exports"，**报错位置离病根很远、极难查**。
- 离线断言 **M5-17** 直接读源码把方向钉死。

### ⑧ 版本分段：v0.6.0 = 体检，v0.7.0 = 整批撤销

- 理由：v0.6.0 已经作为"体检"的版本号出现在自检报告里了。继续在 0.6.0 里加功能，
  会让"**0.6.0 到底包含什么**"说不清 —— 而这正是之前"报告写 0.5.0、manifest 写 0.5.2"
  那类漂移的温床。

## 工作区 / 分支约定 + 摘代理推送（2026-10-13，用户主动要求"理清、别乱"）

### ① 单 worktree —— **已弃用** WorkBuddy worktree 模式（2026-10-13 收尾）

- 现状：**只有 `D:\ps-uxp-dev` 这一个 worktree**，checkout `main`，
  **会话直接跑在 `D:\ps-uxp-dev`**；`node_modules` / `tools\uxp.cmd` / uxp-devtools CLI 都在这里。
- 依据：新建任务界面的 `Worktree` 复选框是**可选开关**，官方提示原文
  「启用后…为任务创建独立工作区，**避免直接修改原工作目录中的文件**」⇒ **不勾即直接改原目录**。
- 收尾动作（2026-10-13 已完成）：
  `git worktree remove C:\Users\17736\WorkBuddy\Worktrees\ps-uxp-dev\main-589e7e48`
  → `git branch -d workbuddy/main-589e7e48`（当时两分支同在 `047178c`＝已合并，`-d` 安全放行）。
  复核：`git worktree list` 只剩 D 盘，`git branch -vv` 只剩 `main`。
- ⇒ **不再有第二工作区、不再有镜像分支要 merge。**

### ② （历史成因，留档）第二分支是**被 Git 规则逼出来的**，不是"新建了分支"

- Git 硬规则：**同一个分支不能同时在两个 worktree 里被 checkout**；`main` 已被 `D:\ps-uxp-dev` 占着
  ⇒ WorkBuddy 会话工作区只能挂别的分支名，定位是「**main 的镜像**」而非独立开发线。该分支**已删除**。

### ③ **收工两步**（保证"GitHub 上永远只有 main"）

1. 提交（就在 `D:\ps-uxp-dev` 的 `main` 上）；
2. `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY git push origin main`
   **+ 用 `git ls-remote origin main` 独立确认**结果。

> 2026-10-13 修订：原"三步"里的第 2 步（`git -C D:/ps-uxp-dev merge --ff-only workbuddy/…`）
> **随 worktree 模式一并取消**。早前那次的实测落地（远程 `dd9aafb` → `0c83bab`、50 个积压提交、
> 远程 `refs/heads/` 只有 main）保留为**当时的 merge+push 存档**。

### ④ 推送：**必须摘代理**（这是最容易误判的一条）

- 本机 `github.com:443` 会被**间歇性 SNI 拦截**；而环境里默认带着
  `http_proxy/https_proxy = http://127.0.0.1:4112`。
- **带代理时 `git push` 不是报错，而是挂住到超时** —— 极容易误判成"网络坏了/仓库有问题"。
  本次第一次 push 就是这么超时的（180s SIGTERM）。
- ✅ 可行命令：`env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY git push origin main`
  （摘掉后一次通过）。
- 兜底：`python tools/push_via_api.py`（走 `api.github.com`，通常仍可达）。
- ⚠️ **`git push` 的输出不可信**（README 已记：可能无输出但实际成功，也可能反过来）
  ⇒ **一律用 `git ls-remote origin main` 独立确认**，别只看命令输出。

### ⑤ 分支纪律（用户 2026-10-13 亲述）

> "我在该加分支的时候我会告诉你，让你在 GitHub 上再新开一个分支，然后拉到本地。"

- ⇒ **不要自行建分支、不要改工作流。** 需要新分支时**等用户说**。
- 平时所有工作都在 `main` 这条线上推进。

### ⑥ Git 身份

- `wooozxh <76898022+wooozxh@users.noreply.github.com>` —— 用 **noreply** 邮箱，别改用真实邮箱。

---

## M5 第 4 步地基：三条实测硬结论（2026-10-13 凌晨，探针 `review-probe`）

> 出处：`review-probe/`，真机 **16 项 = 14 通过 / 0 失败 / 2 无结论**；
> 完整读数 `review-probe/probe-report-2026-10-13.json`；方案 `docs/50`。
> 这三条**都改变了后续代码的设计**，不是可选项。

### ① `resizeCanvas` 的锚点：**字符串被静默忽略，必须用 `photoshop.constants` 的枚举**

```js
✗ await doc.resizeCanvas(w, h, "topCenter")     // 不报错，但**锚点被忽略** ⇒ 新空间上下各半
✗ "bottomCenter" / "top" / "TC"                 // 同上（5 种写法像素结果完全相同）
✗ await doc.resizeCanvas({ width, height })     // 报 Illegal data type（对象形式根本不支持）
✅ await doc.resizeCanvas(w, h, constants.AnchorPosition.TOPCENTER)   // 原内容贴顶、新空间全在底部
```

- ⚠️ **`AnchorPosition` 成员的值是中划线形式**：`TOPCENTER = "top-center"`、
  `BOTTOMLEFT = "bottom-left"`、`MIDDLECENTER = "middle-center"`（共 9 个）。
- ⚠️ **语义用像素验过，不是推断**：`TOP*` = **原内容贴顶** ⇒ 新空间加在**下方**；
  `BOTTOM*` 反向（新空间加在**上方**）；`MIDDLE*` = 上下各半（= 默认）。
- ⚠️ `resizeCanvas` 只吃**位置参数**，锚点只能走第 3 个位置参数。
- ★ **通用教训：需要枚举值时先查 `photoshop.constants`（本机 101 个枚举族），不要拼字符串。**
  字符串版"不报错但无效"，是本项目最危险的一类失败。

### ② 导出必须 `asCopy`，否则**改掉用户的文档名**

```js
✗ await doc.saveAs.png(entry)            // 文档名 未标题-12 → review-probe-r8-B2.png，路径也变
✅ await doc.saveAs.png(entry, {}, true)  // 文档名 / 路径都不变
```

- 改名是**文件级属性，历史回退救不回来**（`activeHistoryState` 只管图层状态）。
- ⇒ **任何"导出"动作都必须带第 3 参 `true`**，否则同事交付时文件名已被插件改掉。
- 附：`doc.saveAs` 只有 **6 种格式** —— `psd / psb / jpg / gif / png / bmp`（无 tiff / webp / pdf）。

### ③ 参数条中文字体：**本机程序化设置做不到**（四条路全无效）

| 机制 | 写法 | 结果 |
|---|---|---|
| 建层描述符 | `using.textStyleRange[].textStyle.fontName` | ❌ |
| `set textStyle` | `_property:"textStyle"` + `to.fontName` | ❌ |
| 读回写回 | `get textKey` → 改字段 → `set _target:[{_ref:"textLayer"}]` | ❌ |
| 读回写回（补字段） | 再加 `fontPostScriptName` / `fontStyleName` | ❌ |

- **判据是像素不是读回**：**12 张图文字区 MD5 完全相同**（`fdbeb2a5c4ef28c4`），
  黑像素数都是 688 ⇒ 全部渲染成同一个默认中文字体（本机 `Adobe Heiti Std`）。
- 🔴 **连带影响（既有代码也中招）**：**M3a「生成表格」走同一条 `fontName` 路径**
  （`lib/ps.js` 的 `textLayerBoxDesc`）⇒ **表格里的字体从来没生效过**，一直是默认中文字体。
  这是本轮才验实的**既有缺陷**，不是新引入的。
- **下一步（唯一剩下的路，需要人操作）**：在 PS 里用文字工具改一次字体 →
  动作面板「复制为 JavaScript」→ 拿到**录制**的描述符。本项目铁律：描述符不许猜，必须录制。

### ④ 顺带重录的两条硬约束（不改设计，但会反复踩）

- 🔴 **`set` 类 batchPlay 必须包在模态里**；`get` 不用。
  不进模态会报 `set may modify the state of Photoshop. Such events are only allowed from
  inside a modal scope.` —— **"读能跑"不能推断"写能跑"**（本轮第一版就因此得出假读数）。
- 🔴 **Document 上不存在**（别再去找）：`selectAll` / `deselect` / `createSolidColorLayer` /
  `createFillLayer` / `createRectangle` / `createEllipse` / `createGroup` / `export` /
  `snapshots` / `transform` / `translate` / `resize` / `flip` / `layerTree`。
  > `selectAll` / `deselect` 不在 ⇒ **"用选区框出参数条区域单独填白"这条路走不通**，
  > 这也是"白条只能靠 背景色 + resizeCanvas"的根本原因。

### ⑤ 好消息：地基全部成立（这几条是"可以做"的依据）

- ★ **扩画布 + 新增图层，能用同一个对象引用一步回原位**
  （R6：400×300/1 层 → 400×360/2 层 → 一步回到 400×300/1 层；画布**尺寸**与图层数都回）。
  ⇒ 跨模态持有历史状态对象的结论**再次成立**，且这次连"画布尺寸变化"也一并验了。
- **`resizeCanvas` 的新区域 = 用「背景色」填充**（像素实测）⇒ 临时把背景色设成白即得白条。
- **备路也成立**：新建高稿 + `duplicateLayers([...], targetDoc)` 跨文档复制 ⇒
  内容按原坐标留在上方、下方天然是条位（像素实测），**用户原稿完全不动**。

---

## 2026-10-16/17　M5 第 4 步「导出审核版 + 成品图」实施：走主路 + 8% 条高 + 落点记住

- **决定**：按用户拍板的五项实施 —— ① **主路**（在用户稿上临时加高画布 → 写参数条 →
  asCopy 导出 → **一步还原**）｜② 规范版本 **`specVersion: 3`** ｜③ 导出落点
  **首次选一次后记住**（`createPersistentToken`）｜④ 条高 = **图宽 × 8%**（下限 72px）｜
  ⑤ 「导出成品图」一起做（只 asCopy、不动稿）。
- **为什么主路**：拿到的审核版与用户的稿**逐像素一致** —— 这是"审核版必须真实"的硬要求。
  备路（新建高稿 + 跨文档复制）**已实测成立**（R12）但留档不接 UI：大稿复制慢，
  且复制件与原稿可能有细微差异。
- **为什么落点要持久令牌**：插件权限是 `localFileSystem: "request"`，**不能直接访问任意路径**
  ⇒ 只有**用户选过的**目录才拿得到句柄，所以必须存令牌（不能存路径字符串 + `getEntryWithUrl`）。
- **放弃**：每次都弹目录（每次打断）／固定导到桌面（OneDrive 机器上桌面路径会变，且用户没法自选）。

## 2026-10-17　🔴 三条只有真机样张才能抓到的坑（写代码时必须照这个来）

### ① 段落分隔符必须是 `\r`，不是 `\n`

- **现象**：参数条三行被**拼成一行**、右侧溢出画布被裁掉，连角标一起被盖住。
- **正解**：`lines.join("\r")`。AM 的文本引擎用 **CR** 作段落分隔（PS 的老约定）。
- **判据**（已进 S53 ⑭）：**读回 `textItem.contents` 数段落**，必须 = 3。
  ⚠️ 别再靠"建层命令没报错" —— 它当时是 ok 的。

### ② 不用「段落右对齐」来放角标：它会把整块文本排到画布外

- **现象**：给角标一个"**整宽 + `align:right`**"的盒子，读回外框 = `x 6403..6548`，
  而画布只有 1600 宽 ⇒ **导出图上完全看不到角标**（建层命令报成功）。
- **正解**：**不用任何对齐枚举**，改成"在右端放一个**只有角标那么宽**的盒子、默认左对齐"，
  位置由 `lib/review.js` 算出来。判据（S53 ⑮）：读回外框必须在画布内**且在右半边**。
- **附带教训**：这又是一条"**需要枚举值时别硬凑，先试不依赖枚举的路**"。

### ③ 正文盒子必须给角标**留宽**

- **现象**：第一版正文铺满整宽 ⇒ 红角标正好压在**第 2 行正文**上。
- **正解**：正文盒子右边界 = 整宽 − **角标宽 − 半个字间隙**。判据 S53 ⑫⑬（两盒不重叠）。

### ④ 顺带钉死（既有事实，本轮再次踩到）

- **`make textLayer` 的 `name` 不生效**（`textLayerBoxDesc` 里 S40 那条警告属实）：
  建出来的层名是「**文字图层 n**」，文字层则是按内容自动命名。
  ⇒ **自检里找层绝不能靠我们给的名字**，要用 `layerInfo()` 回报的真实名。

## 2026-10-17　参数条：字号按 ppi 换算 + 8% 是基准不是上限

- **决定**：`字号(pt) = 条高(px) × 0.156 × 72 / ppi`；`行高 = 字号 × 1.7`；
  **条高 = max(图宽 × 8%, 72px, 放得下实际行数所需的高度)**。
- **为什么**：条高是按**像素**定的（图宽 8%），而 PS 的字号单位是**点**。
  不换算的话**同一份参数条在 72dpi 稿上正常、在 300dpi 稿上字会大到离谱**
  （20pt = 83px 高）。真机读数：1600 宽 @300dpi ⇒ 条高 128px、字号 **4.79pt**。
- **为什么 8% 要能"加高"**：窄稿/长文件名会把三行撑成 4–5 行，8% 装不下就会被裁。
  实测 400×400@72 ⇒ 条高 72 → **84px**、字号缩到下限 8pt。**正常稿不触发**
  （代表稿 1600×1200@300 实测 `grown=false`、`fontShrunk=false`）。
- **放弃**：直接缩字号到放得下（会缩到不可读）／固定三行不管溢出（会裁字）。

## 2026-10-17　「未转曲数 / 缺字体数」只留一份实现

- **决定**：`lib/inspect.js` 抽出 **`missingFonts(snapshot)`** 纯函数并导出；
  `judge()`（体检页 / 状态条）与 `lib/review.js`（参数条）**都调它**。
- **为什么**：docs/49 §3.0 的「一个数据源、多个出口」。两处各算一遍，
  迟早就出现"状态条说未转曲 3 个、参数条说 2 个"——那是最难归因的一类 bug。
- **判据**（S56）：同一次 `docInspect` 喂两边，数字必须相等；
  再用"加一个文字层"做**负对照**，证明两个数字真会一起变（不是恒等巧合）。

---

## 2026-10-17　参数条改版（v0.9.0 / docs/51）：主题判定 + 竖线分隔 + 依据右对齐带 logo + 边距 + 大稿缩放

- **决定**（用户 2026-10-17 拍板，全部按我的建议）：
  ① 左右留白 **条高 × 0.16**（原 0.125）｜② 主题：取样**图片最下面 `max(条高, 图高×8%)` 全宽横带**
  的平均色，**相对亮度 < 0.5 ⇒ 浅条（白底深字）**，否则 **深条（#111 底 + #F2F2F2 字）**；
  ③ 依据前的 logo 高 = **1 × 行高**（等比 256:164）｜④「依据…」摘成独立层放**最后一行右端**；
  ⑤ 审核版**长边 > 4000 才等比缩**，参数条上印「已缩至 xx% ｜ 导出 w × h px」；成品图不动；
  ⑥ 不印主题依据。
- **为什么主题要"反着配"**：条与图片**同色系**就分不清边界 —— 深底图配白条、浅底图配黑条，
  边界永远清楚。这是用户的原话要求。
- **为什么取样可以放在"记撤销标记"之前**：`sampleRectAvgColor` 走 `imaging.getPixels`（1×1 平均），
  **只读、不动文档、不进历史** ⇒ 不会污染后续的"一步还原"。
- **为什么右对齐不用 `align` 枚举**：v0.8.0 已实测"整宽盒子 + 段落右对齐"会被 PS 排到画布外。
  ⇒ 一律走"**建层 → 读回 `bounds` → 平移 → 再读回自证**"。**这是本项目的第二次同源教训**
  （上一次是 `resizeCanvas` 的锚点字符串），可以上升为通则：
  **PS 里凡是"靠枚举/靠对齐"的地方，先找一条"位置自己算"的路。**
- **放弃**：JPEG（参数条是小字，细字边缘会有压缩伪影，反而伤"审核"用途）／
  固定导到桌面／把主题依据也印在参数条上（版面已满且属实现细节）。

### 🔴 实测更正：`Document.resizeImage` **在**，且可用

- 官方样例与本仓库都**没有** `imageSize` 描述符，我原本担心"怎么缩"要走录制。
  **实测：`Document.resizeImage(w, h)` 存在且可用**（800×600 → 400×300 真缩成功）。
- 端到端（S60）：1200×4200 @300 ⇒ 计划 95% ⇒ 实际 **1143×4000**，
  **PNG 文件头读回**也是 1143×4000（判据是文件头，不是"命令没报错"）。
- **实现仍先探能力再动手**：API 不在就**如实记「没缩」并告警**，绝不猜描述符。
- ⚠️ **仍未结论**：超大稿（5000 万像素）缩起来慢不慢/吃不吃内存 —— **没测**，不许宣称"很快"。

### ★ 附带的版式约束（写代码时要守）

- **主文盒子必须给"最宽的那个右端块"留位**：角标（第 1 行）与依据块（最后一行）宽度不同，
  取 `max`。否则长文件名那行会被压住（v0.8.0 踩过一次）。
- **依据块右端必须贴右留白线**（S59 实测 1185 = 1185，误差 0）—— 靠读回 bounds 平移保证。
- logo 是**彩色**的（`icons/logo-mark.png`，蓝绿 + 米色）⇒ 白条黑条上都看得见，不用做两版。

---

## 2026-10-17　🔴 PS 的 PNG 存储不支持 CMYK 稿（真机钉死 —— 改导出流程前必读）

- **事实**（三路交叉验证，详见 docs/52）：
  ① ExtendScript 直连 PS：CMYK 稿 `saveAs(file, new PNGSaveOptions(), true)` 抛
     **`命令「存储」的参数当前是无效的  #-25923`**；
  ② **新建的 400×400 CMYK 稿一样失败** ⇒ 与稿的大小 / 内容 / 位置无关；
  ③ 同一张 CMYK 稿存 **JPG 成功**（5.3 MB）⇒ 不是写盘问题，是 **PNG 这个格式**。
- **UXP 会吞错**：`Document.saveAs.png(entry, {}, true)` **不抛异常**（正常 resolve）
  ⇒ 表现为「报成功、盘上什么都没有」。**必须"问目录"复核**，绝不能只看命令有没有报错。
- **正面证据**：同一张稿 `changeMode(RGB)` 之后**立刻成功**（3178 B）。
- **API 可用性**（S66 实测）：`Document.duplicate` 与 `Document.changeMode` **都存在**。
- ⇒ **修法待拍板**：备路（duplicate 后在副本上转 RGB，原稿不动 —— 推荐）／主路加临时转 RGB（要赌还原）。

## 2026-10-17　🔴 「读回」要用**独立于失败路径**的第二种手段

- **决定**：导出的判据从「`entryBytes()` 有没有值」改成「**问目录**：这个文件名在不在、多大
  （`fileInFolder`，走 `getEntries`）」；拿不到目录句柄时才退化用 `entryBytes`，并**如实标 `via:"退化"`**。
- **为什么**：`entryBytes` 的「读失败」与「文件不存在」**读数完全一样**（都 `bytes=null`），
  这正是那次事故查不下去的**直接原因**。判据与被判据的操作共用一条路径 = 自己给自己作证。
- **配套**：目录里不在 → 等 400 ms **重试保存一次** → 仍在 → **如实报错**（并点明 CMYK 成因）。

## 2026-10-17　保存前必须**确保目标不存在**（反面教训）

- 本轮曾试过"先 `entry.write(0 字节)` 让 entry 落地"，结果**目标变成"已存在"**，
  那次 PS 保存**一个字节都没写**、盘上只留一个 0 字节文件。
- ⇒ **正解是反过来的**：`clearTarget()`（发现同名就先删掉），让 PS 一定是"新建"而不是"覆盖"。
- **别再**用"预写"去解决宿主 `createFile` 的惰性 —— 那会制造出"已存在"这个新问题。

## 2026-10-17　🔴 自检里"传了参数"必须**读回**（本项目第二个静默失效的坑）

- `createScratchDoc({mode:"CMYK"})` 一直**静默忽略 `mode`**：`documents.add({mode:"CMYKColorMode"})`
  不吃字符串枚举 ⇒ **所有标着"CMYK"的探针实际验的都是 RGB**，整个 CMYK 分支从没被覆盖过。
  ⇒ 我先前据此汇报的"CMYK ✔"**是错的**（已在 docs/52 §三 更正）。
- **通则（升格，与"需要枚举值时先查 `photoshop.constants`"并列）**：
  **凡是"传了参数"的地方，都要读回一次。**
  一个会把参数吃掉的测试台**比没有测试更危险** —— 它给出**虚假的绿色**。

---

## 2026-10-17　导出改走**备路**（复制副本作业）—— 这是用户拍板的架构改动

- **决定**：`exportReview` **不再在用户的稿上做任何写操作**。
  体检/版式/主题仍只读原稿；然后 `duplicate()` 一张副本，
  副本若非 RGB 先 `changeMode(RGB)`，扩画布/写参数条/缩放/`asCopy` 导出**全打在副本上**，
  最后**关掉副本（不保存）**、切回原稿、读回自证「模式/尺寸/图层数/背景色都没变」。
  **成品图同样走备路。**
- **为什么**（两条独立理由，任一条都足以推翻主路）：
  1. **PS 的 PNG 存储不支持 CMYK**（docs/52）⇒ 主路对**所有 CMYK 稿**（= 要印刷的稿）必然失败；
  2. 备路把「临时改用户的稿 + 靠 `activeHistoryState` 还原」**整块风险**消掉 ——
     连带那个唯一的未验点（历史状态被挤出后行为如何）一起消失。**原稿只被读过。**
- **放弃**：
  - **修法 2**（保留主路、中途 `changeMode(RGB)` 再靠历史状态还原）：要赌"能把 CMYK 原像素还原回去"，
    赌输就是把**用户的稿留在 RGB**（是事故，不是 bug）；
  - **修法 3**（只把静默失败改成明确报错）：不再骗人，但**同事还是导不出审核版**。
- **代价（已实测接受）**：多一次 `duplicate()` —— 5400 万像素稿整条路实测 **~4 s**（S61 ⑤）。
- **判据也换代了**：以前是「改过又还回去（三项读回原位）」，现在是
  「**从头到尾没碰过**」+「副本上确实做了那些操作（`hitCanvas`/`hitLayers`）」+「副本被关掉了」。
  ⇒ 判据**变强**了，不是变弱。

## 2026-10-17　`createScratchDoc` 的 `mode` 必须"读回 + 纠正"（自检台的地基）

- **决定**：`createScratchDoc({mode})` 不再把 mode 直接塞进 `documents.add()` 就完事 ——
  枚举值走 `constants.DocumentMode`，建完**读回**真实模式，不一致就 `changeMode` 纠正，
  再不一致就在返回值里标 `modeMismatch`，**绝不假装成功**。
- **为什么**：就是它一直**静默忽略 mode**，导致"所有标着 CMYK 的探针其实在验 RGB"、
  CMYK 分支从没被覆盖、还害我汇报过一条错的"CMYK ✔"（详见 docs/52 §三）。
- **为什么必须有真 CMYK 稿**：`S67` 要验的就是"CMYK 也能导出"；
  建不出真 CMYK 稿，这条修复就**无法被测试** —— 修好了也看不出来。

---

## 2026-10-17　🔴「估算 → 读回」是通则（今天第三次撞上同一类问题）

- **事实**：参数条的版式**不能靠估算**，必须**读回真实外框**再定：
  1. 「依据」块右对齐 —— 早已按"建层 → 读回 bounds → 平移 → 再读回"做（不用段落对齐枚举）；
  2. **logo 的 x**（本轮）：原按估算的依据文字宽算 ⇒ **多出一整个 logo 宽的空隙（54px）**；
     改按真实外框算 ⇒ 间隙 = gap ✔；
  3. **logo 的 y**（本轮）：只对 x 时 logo 偏下 **7.5px** ⇒ 垂直也对齐到真实外框中心线 ⇒ 同心差 0px；
  4. **整块文字的垂直居中**（本轮）：按"行数 × 算出的 lineH"当块高 ⇒ 偏上 12–24px；
     改成**读回正文层真实外框**再平移 ⇒ 上下留白相等。
- **根因同一条**：**PS 的实际渲染 ≠ 我们的估算**（本轮的元凶是"只设了字号、没设行距 ⇒ PS 用自动行距"）。
- **→ 升格为通则**：**凡是要"对齐/居中/贴合"的地方，一律"先建 → 读回真实外框 → 再定位"，
  估算值只当初始落点。** 与「需要枚举值先查 `photoshop.constants`」「判据要用独立于失败路径的第二种手段」并列。

## 2026-10-17　`leading` 可写但**读不回来** ⇒ 不用它做版式地基

- 项目里 `leading` 是已建立的**可写**字段（`TEXT_ITEM_WRITABLE`），但 **S32 实测读回是 `undefined`**。
- ⇒ 按铁律「**没报错 ≠ 生效**」，**无法证明它生效**的情形不能当地基
  ⇒ 垂直居中的实现走**纯几何**（读回外框 + 平移），**不依赖 `leading`**。
- 代价：行距仍由 PS 自动决定（≈1.56× 字号，我们设计的是 1.7×）。**视觉上可接受，且被"读回居中"兜住。**

## 2026-10-17　角标字号独立于正文（`tagFontRatio = 1.3`）

- **决定**：角标「审核用 · 非成品」字号 = 正文字号 × **1.3**（用户：怕真被当成成品）。
  只影响角标自己的**字号 / 占宽 / 盒高**，**不改正文字号**；角标盒子高度改用**它自己的行高**（否则被截断）。
- **判据**：`M5-28` 离线断言（倍数 = 1.3、盒高 ≥ 角标字号、不压正文）+ `M5-24` 跟着改。

---

## 2026-10-17　★★★ 「新建稿 / PSD 模板」四条地基实测（探针 **S68**，判据全是读回）

- ✅ **`presetJSON` 建稿带参考线：成立。**
  实测 `app.createDocument({ presetJSON })` → **600×400 @300、guides=4**；
  存成 PSD（36602 B）→ 关闭 → `app.open` 重开 → **guides 仍是 4**。
  ⇒ 用户要的「模板打好参考线、直接调用」**技术上成立**。
- 🔴 **`presetJSON` 必须给「完整字段集」——缺字段会让**整份被忽略、而且不报错**。**
  第一轮我只给了 `width/height/units/resolution/resolutionUnits/depth/mode/fill/guides`，
  漏了 **`scale` / `profile` / `artboards`** ⇒ 读回 **1946×172 @72、guides=0**
  （PS 换成默认参数了，一点提示都没有）。
  **正解：原样照抄 `template-probe` 当年验通过的那份**（`template-probe/index.js` 的 C1/C2 两段）。
  ⇒ **通则（本项目第三次「静默失效」）：凡是"传一整份配置对象"的地方，必须读回关键字段核对。**
- ⚠️ **`app.createDocument` 必须在模态里**（少数**会明确报错**的）：
  `Event: make may modify the state of Photoshop. Such events are only allowed from inside a modal scope.`
- ✅ **`app.open(entry)` 可用**（模态内）：能打开 `PluginData` 里的 PSD，
  名称／尺寸／分辨率／模式／**参考线**全部正确读回。
- 🔴 **`Document.name` 不可改** —— 赋值后**静默不变**（也不抛错）。
  ⇒ 走 handoff 来的模板 PSD 打开后**一定叫 `incoming.psd`**（PS 拿文件名当文档名）。
  ⇒ 产品上必须**如实告知**「这是模板副本，请另存为你的文件名」，不许假装能改名。
- ✅ ★ **`Entry.delete()` 存在、且真的把文件删掉了**（删完 `getEntry` 再取报不存在）。
  ⇒ **修正一条长期假设**：契约 §九 一直写着「插件能否删自己的文件**未验**」，
  LINK-LOG 里也记过「UXP 的 `Folder` 没有 `deleteEntry`」—— **那是 `Folder`；`Entry` 有 `delete()`**。
  ⇒ 插件侧**从此可以自己清理** handoff／临时文件（以前全靠软件侧的过期清理兜底）。
  ⚠️ 仍需向软件侧**公告**（他们的清理逻辑按旧假设设计的，可以简化但不必改）。
- ✅ `app.displayDialogs = "dontDisplay"` 可设、可读回（打开文件时防原生对话框卡死的兜底）。

---

## 2026-10-17　🔴🔴 「参数条底色无填充」三连根因（v0.9.5，用户真机报障）

### ① 用户报的 bug：深条（黑底）的底色**根本没填上**
- **现象**：白底稿 ⇒ 判深条 ⇒ 文字用了浅色，但**参数条底色还是白的**（导出图量到 `(255,255,255)`）；
  而蓝底稿 ⇒ 判浅条 ⇒ 白底「碰巧」对。
- 🔴 **根因**：**`resizeCanvas` 扩出来的新区域恒为白色，与「背景色」无关。**
  证据：`setColor("background", #111111)` 的**真读回**就是 `#111111`（`ok` 判据 = 回读命中），
  而扩画布后该区域像素仍是白的（**不是透明** —— 透明转 RGB 会是黑）。
- ⚠️ **推翻一条既有结论**：`review-probe` 的 **R4「新区域 = 背景色填充」是错的** ——
  当时背景色恰好是白，实验**无法区分**「填背景色」与「恒填白」（**缺负对照**）。
- **修法**：扩画布后，在参数条位置**放一个填充矩形层**（`makeRectShapeLayer`，M3a 早已验证）。
  ⇒ 顺带**不再需要「设背景色 / 还原背景色」**两步（少碰一次 app 级设置、少一个出错点）。

### ② 顺带挖出：`imaging.getPixels` 字段名一直写错 ⇒ 取色**从来没按矩形取过**
- **现象**：新加的像素探针在 4 个不同位置采到**完全相同的值**
  （`整条=#ABA9A9 条顶=#ABA9A9 条底=#ABA9A9 图区=#ABA9A9`）。
- 🔴 **根因**：矩形参数用了 **`sourceRect`**，而**官方字段名是 `sourceBounds`**
  （`developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/`）。
  PS **静默忽略**未知字段 ⇒ 返回**整幅文档**的平均色。
- ⇒ **影响面比想象大**：**主题判定**（"图片底部是深是浅"）此前一直用的是**整幅平均色**。
  用户那两次实测判对，是因为「整幅平均」与「图片底部」**方向恰好一致**（碰巧）；
  **上下反差大的稿会判错**。
- ✅ **还有第二层**：**`targetSize` 小于请求区域时，PS 会用「金字塔缓存层」**
  （偏好 *Performance Cache Levels*），返回的 `sourceBounds` 变成**缓存层坐标**
  （实测回读 `{0,0,150,113}`，而请求的是 `{0,226,300,298}` —— 正好一半）。
  ⚠️ 更要命：**缓存可能还没包含「刚画上去的内容」** ⇒ 读到的是**旧像素**。
- **修法**（`lib/ps.js` 取色）：字段名固定 `sourceBounds`；**发现 `level > 0` 就再取一次**
  （不传 `targetSize`，强制全分辨率 level 0）；判据改成「**回读区域落在请求区域内**」
  （PS 会把请求**裁剪**到"含像素数据的部分"，不能要求相等）。返回值带 `level` / `got` / `n`。

### ③ 顺带挖出：自检**在用户的 PS 里堆临时文档**，而且**污染后续自检**
- **现象**：某轮自检从 71/74 掉到 **62/74**，一批探针（S60/S61/S62/S63/S66/S67/S68）同时挂，
  S53 读数还明显不对（`resizeCanvas +98px`、`logo x 204..226` —— 那是**另一个文档**）。
- 🔴 **根因**：`closeDocument` 在"找不到 / 关不掉"时**返回 `{ok:false}` 而不抛异常**，
  而自检里 20+ 处调用都写成 `await ps.closeDocument(id)`、**不检查返回值** ⇒ 失败被无声吞掉。
  实测查到 **3 个自检残留**（`Vellum 自检临时文档(S51-A)`、`(S60缩放)`、`未标题-1`），
  而**堆积又反过来把活动文档/建稿搞乱** ⇒ 一批**假失败**（我差点把它当成"改坏了"）。
  ⚠️ `未标题-1` 之所以不可识别，是因为 **`presetJSON` 里的 `name` 被忽略**（S68 的稿因此没名字）。
- **修法**：新增 **`ps.sweepProbeDocs()`** —— 只关**名字带我们前缀**的文档
  （`Vellum 自检临时文档` / `Vellum 探针` / `TP-`），**用户稿绝不碰**；
  自检**开场清场 + 收尾复查**，新增 **S69** 把两边结果如实记进报告；
  S68 的 `createDocument` 补 `name` 参数让它可识别。

### 判据换代（本轮最重要的方法论）
- S53 ⑦ / S58 ④⑤ 从「**背景色设置成功**」改成「**参数条像素命中**」。
- 像素自证用「**整条参数条的平均亮度**」而不是"角落一小块"：
  第一版用小区域，因取样点坐标/取整不可靠而**误报**（导出图明明是对的）。
- ⚠️ **教训**：**"层建出来了 / 命令 ok"都不等于"颜色对"** —— 要**验到像素**。
  而要验像素，**必须先保证"取色本身是对的"**（本轮就是取色错了，导致我一度怀疑产品）。

---

## 2026-10-17　分组层数 2 → 5（**只动数据层**，v0.9.6）

- **决定**：`lib/mirror.js` 的 `MAX_DEPTH = 5`；`flattenBrand()` 改成**真递归**（任意层，上限 5）；
  `groupTree()` 改成**任意深度树**。**UI 一行没改。**
- **为什么只动数据层**：软件侧 Step 6（通用库放开多层）**在等这一版**。
  先把"能读任意层"发出去，UI 晚一步上 —— 这两件事**不该绑在一次发版里**（绑了就得等 UI 设计定稿）。
- **兼容策略（关键）**：`group` / `sub` 两个字段**保留且语义不变**（`path[0]` / `path[1]`），
  另加 `groupPath`（完整路径，本来就有）与 `depth`。
  ⇒ 旧 chips UI 在多层数据下表现为"第 3 层及更深并入第 2 层显示"：**不丢素材、不错乱、只是不能单独筛深一层**。
- **"两层零变化"是硬承诺，有断言钉死**：离线 `30d` 把旧行为的**顺序 + group + sub 逐项写成期望值**比；
  真机 `S70 ②` 同样比对。⇒ 这条不是"我觉得没影响"，是**可执行的证据**。
- **容错一个没删，只改阈值**：
  · 成环 → 当顶层（`pushed` 集合防重复、防爆栈）
  · `parentId` 指向不存在的组 → 当顶层
  · **超过 5 层** → 超出的子树当顶层吐出（**素材一条不丢**）
  ⚠️ 有人会想"支持更多层就调大常量" —— **别**，调大要同步改契约 §5.3 与两侧 DECISIONS。
- **代价（已接受）**：多层数据在**尚未更新的旧插件**上会被拍平到顶层。这是**降级不是损坏**，
  契约 §5.3 已因此补了"允许降级"的规则。

### 🔴 顺带查出一个"第三次同源"的坑：`createFile` 预建 0 字节 ⇒ `saveAs` 静默不写

- **现象**：真机 `S68` 时通时不通，失败时报 `saveAs.psd 无字节`（**命令不抛错**）。
- **根因**：`folder.createFile(name, {overwrite:true})` **真的会建出一个 0 字节文件**
  ⇒ PS 认为「目标已存在」⇒ `saveAs` **静默不写**。
  这与 v0.9.5「导出审核版」那次**完全同源**（当时修法是"保存前先清掉同名文件"），
  但 **S68 这个探针没照抄那一步** ⇒ 它一直是"看运气"。
- **正解**：`createFile` 之后、`saveAs` 之前，**先 `entry.delete()`**；
  判据用 **`fileInFolder`（问目录）**，不用 `entryBytes`（读失败与文件不存在读数一样）。
- ⇒ **通则（本轮第三次被印证）**：**`createFile` + `saveAs` 是两步，中间必须清目标。**
  凡是"创建 entry 然后保存"的代码，都该按这个模板写。

### 🔴 `sweepProbeDocs` 要"先快照、后动作"

- **现象**：真机 S69 读数里"当前开着的其它文档"是 `["","",""]` —— **三个名字全是空串**，
  于是 sweep **认不出自己的临时文档**，却报"漏关 0 个"（判据形同虚设）。
- **根因**：`Array.prototype.slice.call(app.documents)` 拿到元素后，
  **边遍历边关闭会让后续元素失效**（`d.name` 读成空串）。
- **修法**：先一次性**快照** `{id, name}`，再按 id 关；并新增 `unknown` 计数，
  **名字读不到就判不合格**（"看不见 ≠ 没有"）。
- **教训**：「没报错 ≠ 生效」在这里的具体形态 —— **能遍历 ≠ 能识别**。

---

## 2026-10-17　插入面板瘦身：落点九宫格移除，面板 150 → 52（v0.9.7）

- **决定**（用户 2026-10-17 拍板，同事反馈落点几乎没人用）：
  **删掉落点九宫格**；「置入」两字按钮放到素材名右侧；位置 / 标签 / 原图路径**移进 `title`**。
- **省下的主力不是按钮宽度，是九宫格那 66px**：面板 **150 → 52**（真机量到），
  580 高的面板下网格从 213 → 约 311。**这是本轮唯一有"用户可感知收益"的改动。**
- **为什么不用 icon**：文字「置入」宽 44px，340 宽面板里名称区还剩 ~270px（够 22 个中文字）；
  而箭头图标要用户去猜，置入是高频操作。icon 只多给 18px 名称宽度，不划算。
- **删的是 UI，不删能力**：
  · `ps.anchorOffset()` **保留**（置入仍需定位，固定 `"mc"` 居中）；
  · 自检 **S24 / S25 保留**（验的是 `placeEvent` 的真实落点规则，与有没有这个 UI 无关）；
  · `library-pref.json` 里的老 `anchor` 字段**读时忽略、不清除**（为一个无用字段去改用户文件不值当）。

### 🔴 `createFile` 的行为**不稳定** —— 所以"保存前先删目标"这步不能省

- **新读数**（S68，v0.9.7 那次）：`createFile` 之后 `entry.delete()` 报
  **`no such file or directory`** ⇒ **这一次它根本没建出文件**（惰性）。
  而上一轮它**确实建出了 0 字节文件**（导致 `saveAs` 静默不写）。
- ⇒ **同一个 API 两次行为不同**。**正解就是两种情况下都安全的那一步：先 `delete()`**
  （建了就删掉、没建就报错跳过 —— 报错本身无害，但要**记进 steps** 而不是当成功）。
- ⇒ 通则强化：**`createFile` + `saveAs` 之间必须有"清目标"，且 `delete` 的失败要记录**。

---

## 2026-10-17　三段式落地 + 插入面板留白修正（v0.9.8）

- **三段式**（用户原话：「目录选择器放到上面固定，插入面板放到下面固定，把插件面板垂直拉到最高」）：
  顶部筛选区 / 中间网格（唯一滚动区）/ 底部详情+置入。
- **置入区从顶部改到底部，为什么不会重犯 v0.3.2 的错**：
  当年挪到顶部是为了解决"选完素材还要滚到最底下按置入"；现在它是 `flex: 0 0 auto`
  **固定在容器底部、不随网格滚动**，同一个痛点同样消失，而且更像 PS 面板的固定底栏。
  🔴 **约束：它不能进滚动区**。离线断言 41 已加断言 —— `#vt-lib-foot` 的 parent **不能**是 `#vt-lib-body`。
- **留白**：`.lib-foot` 是"卡片"（有 border + background），水平内边距必须是正值。
  写成 0 时文字/按钮贴边框，**用户看起来就是溢出**（他截图报了）。
  ⇒ `padding: 8px 10px`；真机量到左右各 **11px**（含 1px 边框），高度 52 → 53。
- **判据缺口（本轮最重要的教训）**：S71 只量高度 ⇒ **留白这类"零高度变化"的缺陷它天生看不见**。
  补几何判据「内容块左沿 − 卡片左沿 ≥ 8px」，用 `getBoundingClientRect` 量，
  **不解析 CSS 字符串**（样式怎么写都无所谓，看得见的留白才是判据）。
  ⇒ 通则：**一个判据只能覆盖它测量的那个维度**。"通过了"不等于"没问题"。

---

## 2026-10-17　目录导航换成「面包屑下钻」（v0.9.9，方向 B 落地）

- **决定**：撤掉"两行 chips + 二级下拉"，改成**面包屑 + 子目录 chips**；抽 `lib/dirlib.js` 共用。
- **数据模型换了真相**：`S.path`（数组）是唯一真相，`S.group`/`S.sub` 降级为**派生值**
  （`path[0]` / `path[1]`），全部经 `setPath()` 这一处写。
  ⇒ 旧代码里那些"直接给 S.group 赋值"的地方必须改口，否则两份状态会分叉。
- **筛选判据换代**：`itemsInGroup()` 从"精确等于 group/sub"改成**路径前缀匹配**
  （用 `it.groupPath`，老数据退化 `[group]`）。
- **`pruneFilters()` 必须"截断到最长有效前缀"，不能整体清空**：
  两条时看不出差别，多层下一清空就是**把用户无声弹回顶层**（打断成本极高）。
- **深层不画「全部」chip**：回上级交给面包屑。两处各一个「全部」，用户点哪个都心虚。
- **子目录超 4 个折叠**：数量由软件侧决定，不折叠就会把网格挤没（docs/55 §九）。
- **`tpl` scope 不进素材库**：`mirror.libraryScopes()` 统一排除；
  **S20 的期望值用同一个函数算**，否则软件侧一写 tpl，"按 scopes 数 tab"就红成假警报。

### 🔴 判据本身的三条教训（比功能更容易出问题）

1. **"没有前置条件就判 true"= 永远绿的死判据**。S72 第一版写 `firstDir ? ok : true`，
   结果在任务库上**空过**（读数"根层没有可点的目录"却 PASS）。
   ⇒ 宁可判**不适用**并说明原因，也不许放宽成通过。
2. **mock 的 `getElementById` 只增不减** ⇒ 判"元素没了"必须用 `attached()`。
   这条 mock 里本来就有注释，我没看。
3. **`const` 写在 `if` 块里、块外引用** ⇒ 真机 `ReferenceError`（项目里记过一次，又犯）。

---

## 2026-10-17　子目录必须是**整行**（v0.9.10，按 mock 修正）+ 一条流程纪律

- **事实**：方向 B 的 mock 里子目录是**整行** `📁 名字 …… N 项`；
  我实现成了 chips（沿用旧版外观），理由是"省高度"。**用户当场指出「新 UI 不是这个吗？」**
- **改回整行**：面包屑第 0 段用**库名**（不用「全部」）、右端 `第 N/M 层`；
  子目录行高 26、超 **3 行**折叠、行右端 `N 项`；`lib/icons.js` 新增 `folder`。
- 🔴 **流程纪律（这条比功能重要）**：**实现以 mock 为准**。
  要换形态（哪怕"更省高度"）必须**先说再改**——
  "我自己觉得更好"不能覆盖用户已经看过并认可的设计稿。
- **判据跟着换**：行数会随层级变 ⇒ **"深层一定比根层高"不是不变量**；
  S72 改为只判**绝对预算 ≤ 96px**（真机：根层 70 / 深层 67）。
  断言 51 从数 `.fchip` 改为数 `.dir`（上限 3 行 ⇒ 折叠态 4 行、展开态 7 行）。

---

## 2026-10-17　模板库 Step 1：数据层（v0.9.11）

- **入口归属**（按契约 §5.7）：模板**属于「新建稿」工具页**，不进素材库。
  ⇒ 排除 `tpl` 已经做了（v0.9.9），入口在 Step 2 做进 `新建稿`（首页 ↑7，现为灰行）。
- 🔴 **`flatten()` 不能是二元分派**：原来是 `scopeId === "brand" ? brand : task`，
  任何新 scope 都会掉进 `flattenTask` ⇒ **静默返回空**。改成"按 id 显式分派 + 结构兜底"。
- 🔴 **`scopeKind()` 不能只看结构**：`tpl.json` 也有 `groups[]` ⇒ 会被认成通用库。
  改成**优先读文件里的 `scope` 字段**；结构兜底时用 `groups[] + items[]` 两张表识别模板库。
- **`flattenTpl()` 是"往上爬"而不是"往下走"**：`items[]` 扁平、只带 `groupId`
  ⇒ 路径靠 `parentId` 反查。输出字段与 `flattenBrand()` **逐字段对齐**，
  这样筛选 / `groupTree` / `dirlib` 全部可复用，不为模板库单写一套。
- **脏数据一律降级到「未分类」，不丢模板**；成环用 `seen` 拦住（不爆栈）。
- **排除留痕**：被排除出素材库的 scope 在 `boot.log` 记一行（契约建议）——
  否则以后会有人把"没有模板 tab"当成丢库来查。

---

## 2026-10-17　模板库 Step 2+3：入口在「新建稿」，打开的是副本（v0.9.13）

- **入口不单开一行**：契约 §5.7 说模板属于**新建稿工具页**；而且"从模板建稿"本来就是建稿的一种方式，
  分两个入口只会让用户先想"该点哪个"。⇒ 首页 ↑6「新建稿」转正，页内三段式。
- **页面结构与素材库同构**（顶目录固定 / 中网格滚动 / 底详情固定），并**复用 `dirlib`** ——
  抽这个组件的回报就在这：两库的导航行为天生一致，不会各自长歪。
- **打开的是 `incoming.psd` 副本**（handoff 拷进 `PluginData`）⇒ **模板原件绝不会被改坏**。
  🔴 代价：用户 Ctrl+S 会存回插件缓存目录 ⇒ 状态行必须**明说**"请用另存为"。
  （自动另存到工作区要写盘权限，未做，等拍板。）
- **`ps.openFile` 读参考线用 `null` 表示"未探到"，不用 0** —— 0 是"确认没有参考线"，
  两者差别很大（与契约 §5.7 的 `guides` 同一口径）。
- 🔴 **判据别写"末位"**：S55 原来断言"tools 末位是 review"，加一个工具就假红。
  ⇒ 改成"每个 tool 都 ready 且有 mount/unmount"，新工具上架自动被覆盖。

---

## 2026-10-17　模板库 Step 4：规范表放插件里 + 两条宿主纪律（v0.9.17）

- **规范表（`lib/specs.js`）是唯一真相**：成品 mm + 出血 mm → 画布 px，参考线落在**成品边**。
  不去读写 PS 的新文档预设目录（要 fullAccess、路径带版本号、有竞态）；
  用 `presetJSON` 直接建稿（S68 已验）。**别在别处再写第二份尺寸表。**
- 🔴 **`app.open` 打开 CMYK PSD 前必须 `displayDialogs = "dontDisplay"`**：
  否则 PS 弹「配置文件不匹配」，在模态里卡住 ⇒ 宿主返回
  `The 文档 with an id of undefined does not exist.`（完全误导）。
  **更贵的是**：卡住的对话框会**污染同一轮里后续（甚至先前）的操作 ——
  那一轮 S62/S63 的导出/文字全红，查了很久才定位。**
  ⇒ 通则：**一串本来好好的探针突然集体红，先怀疑有原生对话框没关。**
- 🔴 **handoff 的 res.json 可能两段写**（先报完成、后补 `file`）：等待时要**边等边重读 res**，
  并允许按候选名（`incoming.*`）找文件；等待上限 5s→12s（PSD 可能十几 MB）。
- **建稿后必须逐项读回**（尺寸/分辨率/模式/参考线条数），判据用**我们自己算的期望值**，
  不用返回值 —— 否则"PS 说成功"就又成了判据。

---

## 2026-10-17　UXP 不支持 CSS Grid（v0.9.23）+ 两条判据纪律

- 🔴 **事实**：PS 27.2.0 的 UXP 里 `display:grid` **不生效** —— 容器与子项 `offsetHeight` 全算 0，
  页面"存在但高度为零"，**不报错**。⇒ 两列布局一律 **flex + 百分比宽度**（`width:48.5%`）。
  素材库瀑布流一直是 flex，所以这条以前没暴露 —— 新页面图省事写 grid 就踩了。
- 🔴 **"建出来了 ≠ 看得见"**：数据 3 / 筛后 3 / 建卡 3 全对，屏幕上什么都没有。
  ⇒ 判据必须**量可见高度**（S74：首卡 > 40px），不能只数 `.nd-card` 个数。
  **数个数只证明"我建了"，量高度才证明"它在那儿"。**
- 🔴 **UXP 吞渲染异常**：异步里抛的错不进 console、不弹框。
  ⇒ `renderAll()` 里 tabs/bar/grid/foot **各包一层 guard**：谁炸写 `boot.log`，并在状态栏点出来。
  排查时"页面空白但日志干净"就是它 —— **先给渲染加 guard，再谈定位**。
- **量高度必须延迟**：刚 append 完 `offsetHeight` 读到 0 是正常的（布局未落定），
  要等（`setTimeout` / `waitFor`）。这次差点把"量早了"当成"真的 0 高"。

---

## 2026-10-17　模板缩略图改正方形（v0.9.31）+ 「能算的不要量」

- **决定**（用户选 ②）：512 信息卡按**正方形**整版显示。
  120px 高时小字只剩 ≈5px（出血与色彩模式糊）⇒ 加高，代价是一屏从 2.0 行降到 1.5 行。
- **实现方式**：`.nd-card` 固定宽 **193px** + `.nd-th` 固定高 **179px**
  （193 − padding 12 − border 2，border-box）。面板 422 时两列严丝合缝（193+8+193=394）；
  面板变宽时两列分开但**卡片仍是正方形**。
- 🔴 **教训：能算的不要量。** 这一件事我连错三版（168×174 → inline height 为空 → 校准从未执行），
  根因都是"把答案押在运行时量一个尺寸"：UXP 里布局落定要 1–2s、`clientWidth` 口径与假设差 6px、
  `style.height` 写入还会静默无效。
  ⇒ **尺寸确定的布局，用 CSS 算式写死；不要靠 JS 量了再改。**
- 🔴 **写类操作集体红 ⇒ 先看磁盘**：本轮 14 项（建稿/导出/打开）同时失败，
  而读取类全绿。根因是 **C 盘只剩 21G、PS 暂存文件占 14G** —— 暂存盘打满
  ⇒ PS 拒建文档、导出"成功"但无文件、`app.open` 打开错文档、甚至退出。
  **跑自检前先看 C 盘（建议 > 40G）**，或把暂存盘改到 D 盘。

---

## 2026-10-17　🔴 参考线是**百分比**，不是像素（v0.9.37）

- **事实**：`presetJSON.guides[].coordinate` 是**百分比（0–100）**。
  依据：PS 自带 `New Doc Sizes.json` 的 HDTV 1080p 写 `h:5/h:10/h:90/h:95`；
  社区资料原话「You can specify guides by percentage of width and height.」
- **我们错了三轮**：一直传像素（A3 上 35 / 3543 / 35 / 4996）⇒ PS 当 3543% ⇒ 两条落在画布外
  ⇒ **用户只看到 2 条参考线**。
- 🔴 **为什么判据一直绿**：S68/S75 只数 `document.guides.length` ——
  **画布外的参考线也算数**，照样回 4。**条数对 ≠ 参考线对。**
- 🔴 **真机读不到参考线坐标**（全部试过）：`guides[i]` 只有 `{_id,_docId}`；
  `get` `_property:"guides"` 报 `-25920`；`get` 整份 document 只回 `true`；`get` `_ref:"guide"` 抛异常。
  ⇒ **判据只能放在纯函数上**，位置正确性最终**由人眼确认**。
- **判据换代（关键）**：离线断言 54 不再写死 `v18,v4742,…`，改断**语义**：
  ① 全部 0–100；② 左右和 = 上下和 = 100；③ 回算 px ≈ bleedPx。
  **写死数字会被"看起来对"的值蒙过去；断语义才能抓住单位错误。**

### 🔴 附带教训：算出来的布局也要在真机上量一次

卡宽 193 时我算 `193+8+193 = 394 = 内容宽`，结论"两列刚好"。**真机是一列。**
原因：**出现滚动条要再扣约 15px**（394 → 379），386 放不下 ⇒ flex-wrap 换行。
⇒ 改成 186 / 172（缩略图仍正方形），并给 **S74 补「前两张卡 top 相同」判据**。
⇒ 「能算的不要量」对**尺寸**成立，但**可用宽度**这种东西仍必须真机确认一次。
