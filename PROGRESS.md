# 进度台账

> **AI 每次收工都要更新这个文件。** 这是跨会话协作的接力棒 —— 下次开新会话，读完它就等于接上了。

---

## 当前状态

- 阶段：**环境已就绪，等待产品形态立项**（业务代码 0 行）
- 完成度：环境调研 **100%**；工具链 **100%**；**闭环打通 100%**；档案与仓库 **100%**；
  **无阻塞**；产品形态 **0%（未定）**
- 环境基线：`node tools/doctor.mjs` = **13/15 项**，其中「闭环关键项 **5/5**」
- 闭环实证：`hello-uxp` 探针插件加载后自检 **7/7 全通过**，`report.json` 落盘并被外部脚本读回
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

## 待办

- [ ] **【当前唯一待办 · 需用户拍板】产品形态**（Command / Panel、是否上框架）
      → 拍板后产出 `docs/03-产品形态方案.md`，用户确认后才动代码
- [ ] （可选）给仓库加许可证 —— 当前**无 LICENSE**，公开仓库下他人不可合法复用
- [ ] （可选）探针插件用例从 7 项扩充（如 batchPlay 写属性、UXP 权限声明校验、面板 UI 交互）

## 下一步（下次开工从这里开始）

1. **环境已就绪，不必重新调研环境** —— 跑 `node tools/doctor.mjs` 应得 13/15、闭环 5/5；
   若不对，先看 `README.md` 第三节（两步准备工作）
2. 直接进入**产品形态立项**：与用户敲定 Command / Panel、是否上框架
3. 形态定了 → 写 `docs/03-产品形态方案.md` → 用户确认 → 才开始写代码

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
