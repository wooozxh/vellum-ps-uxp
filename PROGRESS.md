# 进度台账

> **AI 每次收工都要更新这个文件。** 这是跨会话协作的接力棒 —— 下次开新会话，读完它就等于接上了。

---

## 当前状态

- 阶段：**环境准备**（业务代码 0 行）
- 完成度：环境调研 **100%**；工具链 **100%**；档案与仓库 **100%**；
  **阻塞 1 项**（管理员开关）；产品形态 **0%（未定）**
- 环境基线：`node tools/doctor.mjs` = **10/15 项**，其中「闭环关键项 **3/5**」
- 仓库：本地已 `git init` + 首次提交；**远程尚未推送**（可见性与仓库名待用户拍板）

## 已完成

- [x] 2026-10-09　资料库建立：官方文档地图 + 教程资源 + 工具链全景 + 本机环境体检（`docs/` 两份）
- [x] 2026-10-09　本机环境体检：PS 2026 v27.2 已装、Node 22、npm、git、Python 就位；**VS Code 已装**
- [x] 2026-10-09　工作区成型并从 C 盘迁到 `D:\ps-uxp-dev`（迁移后自检结果与搬迁前完全一致）
- [x] 2026-10-09　工具链：UXP CLI 装好并跑通（187 个依赖，无原生编译报错）
- [x] 2026-10-09　官方示例仓库浅克隆（27 个示例，13 MB）→ `official-samples/`
- [x] 2026-10-09　闭环脚本：`doctor.mjs`（15 项自检）/ `report.mjs`（读插件报告）/
      `enable-devtools.mjs`（管理员开关）/ `uxp.cmd` + `uxp`（CLI 包装器）
- [x] 2026-10-09　自检探针插件 `hello-uxp`（manifest v5，8 个用例，自检即报告）
- [x] 2026-10-09　档案四件套建立（`PROJECT` / `PROGRESS` / `DECISIONS` / `NEXT`）
- [x] 2026-10-09　`docs/` 编号制度建立（现有资料纳入 `NN-xxx.md` 体系）
- [x] 2026-10-09　GitHub 仓库准备：`.gitignore` 写好、`git init`、首次提交完成

## 待办

- [ ] **【唯一阻塞 · 需用户】** 以管理员身份跑 `node tools\enable-devtools.mjs`
      （往 `C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json` 写开发者开关）
- [ ] **【需用户】** PS 里勾「编辑 → 首选项 → 插件 → 启用开发人员模式」→ **重启 PS**（此项不需管理员）
- [ ] 打通后验证：`uxp service start` → `apps list` 能认出 Photoshop 2026 (v27)
- [ ] 打通后验证：`uxp plugin load --manifest hello-uxp/manifest.json` →
      跑全量自检 → `node tools/report.mjs` 看到 **8/8** → 环境闭环成立
- [ ] **与用户确认产品形态**（Command / Panel、是否上框架）→ 产出 `docs/03-xxx方案.md`
- [ ] 推 GitHub（等用户确认可见性与仓库名后执行）

## 下一步（下次开工从这里开始）

1. 先问用户那两步（管理员开关 + PS 开发者模式）做了没有
2. **若已做** → 跑 `node tools/doctor.mjs` 确认闭环 5/5 → 加载 `hello-uxp` 验证全链路 → 开始谈产品形态
3. **若未做** → **不要空转**，改为与用户讨论**产品形态**（这是当前最该推进、且不依赖环境的事）

## 已知问题与风险

| 项 | 说明 |
|---|---|
| **管理员闸门** | `C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json` 非管理员不可写。**Adobe 有意为之**（防止任意脚本偷偷往 PS 塞插件），不是 bug，绕不过去。 |
| PS 来自离线安装包 | PS 2026 是 `D:\安装包\Win版 PS 2026 v27.2.zip` 装的，**不是 CC 装的**。多数情况下 CLI 照常能连；若出现「加载后 PS 里看不到插件」，优先怀疑这一点。 |
| **产品形态未定** | 最大风险 = 在形态未明时写大量代码，白做。所以铁律第一条就是「先出方案再动代码」。 |
| 官方示例仓库不入库 | 它是独立 git 仓库 + 第三方代码。换机器需重新克隆（命令在 `README.md`）。 |
| 沙箱三条限制 | 本会话环境里 `spawn cmd.exe` → ENOENT、COM 实例化被拦、`reg.exe` 被禁。写脚本时**别走 shell**，改成「扫 PATH 找 exe + 直调」。详见 `NEXT.md` 第四节。 |

## 会话日志

### 2026-10-09（第 1 次会话）
- **做了什么**：环境调研（资料库 / 本机体检 / 工具链 / 闭环设计）；工作区从 C 盘迁到 D 盘；
  建立档案四件套；准备 GitHub 仓库。
- **改了哪些文件**：全部为新建（新工程）。核心是 `PROJECT.md` / `PROGRESS.md` / `DECISIONS.md` / `NEXT.md`
  + `tools/` 四个脚本 + `hello-uxp/` 三个文件 + `.gitignore`。
- **遗留**：管理员开关未启用（唯一阻塞）；产品形态未定；远程仓库未推送。
