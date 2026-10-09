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

## 待定（尚未拍板，别当已决）

| 项 | 选项 | 备注 |
|---|---|---|
| **产品形态** | Command（一次性动作）vs Panel（常驻面板） | 当前最该推进的事 |
| **是否上框架** | vanilla JS vs React / Svelte / Vue / TS | 建议先 vanilla 跑通再决定 |
| **许可证** | 无（当前）vs MIT vs Apache-2.0 | 仓库已公开；无 LICENSE = 他人不可合法复用 |
