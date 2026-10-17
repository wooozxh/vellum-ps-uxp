# 下次开工 · 启动提示词

> 换新会话时，把**第一节的启动词**（代码框里那一整段）复制发给 AI 即可 —— **不需要替换任何占位符**。
> 第二节「待拍板」与第四节「环境坑速查」是给 AI 读的补充材料，**不用发**。
>
> ⚠️ **本文件已重写两次。** 上一版停在 2026-10-13 的「v0.7.0 / 第 4 步待拍板 3 件事」，
> 与实际严重脱节（实际已 **v0.9.3**、第 4 步完成并**改版三轮**）。
> **纪律：每个里程碑结束、或每次拍板后，顺手回来更一次。**
> 本次重写：**2026-10-17（M5 第 4 步收尾后）**。

---

## 一、标准启动词（直接复制整段）

```
开工。项目在 D:/ps-uxp-dev —— Photoshop UXP 插件开发工作区（宿主 Photoshop 2026 v27.2，装在
D:/software/adobe/Adobe Photoshop 2026/）。

⚠️ 开机后先做这三件事，**再**去读档案 —— 没做的话所有 CLI 命令都会报「连不上服务」，
别误判成环境坏了：
  ① 确认 Photoshop 开着（CLI 要连它）。查法：/c/Windows/System32/tasklist.exe | grep -i photoshop
  ② 起常驻服务：node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js apps list
     （能列出 `PS 27.2.0` 即服务在；列不出再起 —— 把 apps list 换成 service start，且要**后台跑**，
      前台跑会被当异常掐掉）
     **别用 tools\uxp.cmd** —— 它在 Git Bash 里会被按 GBK 读，中文注释行被当成命令执行
  ③ 确认闭环：node tools/doctor.mjs —— 应得 **14/15、闭环关键项 5/5**
     （若得 13/15 且 ✗ 项是「Photoshop 当前运行 无法探测」，那是 tasklist 在沙箱里取不到的
      **既有误报**，忽略；另一个常见 ✗ 是「Creative Cloud 桌面端（可选）」，也是既有）

工作模式是 vibecoding：我提需求和验收，你写代码并自己验证。别给我安排「你去点一下看看」
这类任务；凡是能脚本化的你自己跑完再给我证据。只有管理员授权、PS 里勾选项、
在 UXP DevTools 里录制描述符这种物理上没法代劳的才找我。

先读这几份，读完再动手（只读，不改文件）：
1. D:/ps-uxp-dev/PROJECT.md   —— 项目身份证、技术栈、协作铁律
2. D:/ps-uxp-dev/PROGRESS.md  —— 进度台账（现状在开头，逐次进展在文末）★ 最重要
   ⚠️ **开头「当前状态」块只记"当前阶段"，逐次进展以文末按版本号排列的小节为准**
   —— 曾因只看开头块而误判现状，**两边都要看**。
3. D:/ps-uxp-dev/DECISIONS.md —— 已做的技术决策，**不要推翻已验证的结论**
4. D:/ps-uxp-dev/README.md    —— 闭环手册：怎么加载插件、怎么把结果读回来
5. D:/ps-uxp-dev/NEXT.md      —— 本文件（第二节待拍板 + 第四节环境坑速查）
6. D:/vellum-link/LINK-CONTRACT.md  ＋  D:/vellum-link/LINK-LOG.md
   —— 与 VellumDesk 的联动契约（**规格 ＋ 公告板**）。
   ⚠️ 唯一权威源在 `D:/vellum-link/`，**不在本仓库**（仓库根那个 LINK-CONTRACT.md 只是指针）。
   凡涉及「插件读素材 / 软件推素材 / 两边数据结构对齐」的任务，**动脑之前先读这两份**。

读完先向我复述三件事，等我确认后再继续：
① 环境现状（doctor 的「闭环关键项 N/5」）
② 当前进度到哪一步、下一步该做什么
③ 你建议的做法 + 理由

本机现状（拿不准就实测，别猜）：
- **环境已就绪**（2026-10-09 完成，**持久**，重启不用重做）：
  ① 管理员开关写在 `C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json`
  ② PS 开发者模式已开（PS 主动连 devtools 端口 14001）
  判据：`netstat -ano | grep 14001` 里有一条来自 **Photoshop PID** 的 ESTABLISHED 连接。
- **★ 最近进展（2026-10-18）**：插件 **v0.9.37 已发布**（Release + `.ccx` 已发同事，代码在 `9ae4549`）。
  **M1 / M2 / M3a / M3b 均已完成并自证；M5 第 1–4 步已完成并自证。**
  第 4 步「导出审核版 + 成品图」做完后又**连改三轮**（都在同一天）：
  - **v0.9.0 参数条改版** —— 按图片底部深浅切黑白主题 / 参数一律「｜」分隔 /
    「依据…」右对齐并前置 logo / 留白加大 / 大稿按长边上限缩放
  - **v0.9.2 导出改走「备路」** —— 因为在**用户真稿上**查出
    **PS 的 PNG 存储不支持 CMYK**（`saveAs` 会静默失效）；改法是复制一张副本、副本上转 RGB、
    所有改动打在副本上，**原稿零改动**
  - **v0.9.3 版式三修** —— 按真实外框垂直居中 / logo 按真实外框定位 / 角标字号 ×1.3
  - **v0.9.4 「新建稿 / PSD 模板」地基探针（S68）** —— 把「用 JSON 按规范建稿 + 从 PSD 模板建稿」
    这条路的地基一次验完（详见下一条与 `docs/53`）
  - **v0.9.5 「参数条背景无填充」修复** —— 用户真机报障。挖出 **3 个根因**（详见 `DECISIONS.md`）：
    ① `resizeCanvas` 扩出的新区域**恒为白**（推翻 `review-probe` R4 旧结论）⇒ 改用**填充矩形层**；
    ② `imaging.getPixels` 的矩形字段名一直是错的（`sourceRect` → 官方 **`sourceBounds`**），
       导致**主题判定一直用整幅平均色**（碰巧对而已），且 `targetSize` 过小会落到**金字塔缓存层**；
    ③ 自检的 `closeDocument` 失败被无声吞掉 ⇒ **临时文档在你的 PS 里堆积**、还**搞乱后续自检**
       （制造过 62/74 的假失败）⇒ 新增 `sweepProbeDocs()` + S69 自检卫生。
  ⇒ 详情读 `docs/50-导出审核版-方案.md`、`docs/51-参数条改版方案.md`、
    `docs/52-CMYK导出缺陷-根因与修法.md`。
  **M5 只剩两步**（**⑤ 已定案开工中**）：
  - **⑤ 新建稿** —— 用户 2026-10-17 定案为「**一个入口、两类来源**」：
    ① **JSON 规范建稿**（空白稿 + 规范 + 参考线）② **PSD 模板建稿**（打开现成模板，参考线已打好）。
    方案 `docs/53`；**探针 S68 已把地基验绿**：`presetJSON` 能带参考线（回读 4 条）、
    存 PSD 后**重开参考线仍在**、`app.open(Entry)` 可用。
    🔴 **软件侧先行**：模板由 VellumDesk 新增的「模板分区」生产 ⇒
    **给软件侧的提示词已备好**：`docs/54-给软件侧的提示词-模板分区.md`（自包含，可直接发给那个会话）。
  - **⑤ 的「多层目录」子项：插件侧兼容层已发（v0.9.6）** —— 只动数据层（`MAX_DEPTH 2→5` + 真递归），
    **UI 一行没改**；两层数据输出**逐项一致**（离线 30d + 真机 S70 ② 双断言）。
    ⇒ 软件侧 Step 6 的**技术前置已满足**，但仓库**未提交/未打包** ⇒ 见 `docs/55 §8.4`。
    ✅ **面包屑下钻已落地（v0.9.9）**，抽了 `lib/dirlib.js` 供素材库/模板库共用。
  - **⑤ 的多层目录 UI（v0.9.9：全部完成）**：
    ✅ **插入面板瘦身**（去落点九宫格、150→53px，真机 S71 量到）；
    ✅ **三段式布局**（筛选固定上 / 网格居中滚动 / 插入固定下；离线断言 41 钉死"置入区不在滚动区里"）；
    ✅ **留白修正**（`.lib-foot` 水平内边距 0→10px；S71 补几何判据）；
    ✅ **面包屑下钻**（`S.path` 成唯一真相、`group`/`sub` 变派生值；`pruneFilters` **截断到最长前缀**）。
    ✅ **子目录 = 整行列表**（v0.9.10 按 mock 修正：📁 + 名字 + `N 项`，超 3 行折叠；
       面包屑第 0 段 = **库名**，右端 `第 N/M 层`）。
       🔴 **流程纪律：实现以 mock 为准，要换形态必须先说再改**（我这次擅自换成 chips，被当场指出）。
    ✅ 顺带：`tpl` scope 不再进素材库（`mirror.libraryScopes()`，S20 用同一函数算期望）。
    依据：`docs/55 §九 / §十二 / §十三` + `preview/dir-breadcrumb-mock.png`。
  - **模板库入口（Step 1 已完成 v0.9.11）**：入口按契约 §5.7 做进「新建稿」（首页 ↑7，现为灰行）。
    ✅ **Step 1 = 数据层**：`scopeKind` 认 tpl、`flatten()` 三分支、`flattenTpl()`（groupId 反查路径）、
    排除留痕；离线断言 **52** + 真机 **S73**。
    ✅ **Step 2 + 3 已上线（v0.9.13）**：首页 ↑6「新建稿」转正；页内三段式（复用 `dirlib`）；
    选中模板 → handoff → `ps.openFile()` 打开成新稿。真机截图 `preview/live-newdoc.png`。
    ✅ **Step 4 已完成（v0.9.17）**：`lib/specs.js` 规范表 + `ps.createFromSpec` + 页面第二个模式；
    **S75 真机 RGB/CMYK 各建一张（含参考线）通过**；**S76 从模板打开端到端通过**（5225×5225 · 参考线 13）。
    方案见 `docs/53 §十三`。
    ⚠️ 仍欠：打开的是 `incoming.psd` 副本 ⇒ 用户 Ctrl+S 会存回插件缓存目录（现只在状态行提示）。
    要不要自动另存到工作区（需写盘权限）**等你拍板**。
  - **⑥ PSD 模板部件插入** —— 归素材库（把模板里的一个部件插进当前稿），**与⑤不是一回事**，暂缓。
- **自证基线**：真机自检 **81/82**（唯一 FAIL = 既有的 **S17**）；
  离线回归 **109/109**；自检编号 **max = S77**（加项前先数一遍，下一个可用 **S78**）。
- 🔴 **UXP 不支持 CSS Grid**（v0.9.23 真机踩到）：`display:grid` 下高度全算 0、**不报错**。
  两列一律 flex + 百分比宽度；判据要**量可见高度**，别只数节点个数。
- ✅ **欠着的事已清（2026-10-18）**：已提交（`d729477` + `9ae4549`）、已推送、已打包
  `dist/com.vellum.toolbox_PS.ccx`、已发 Release、手册与更新说明已发到用户企业微信。
- ✅ **（已解决）曾有一批改动没提交**（当时用户明确"先不推"），2026-10-18 已全部提交推送：
  - **改**：`DECISIONS.md` / `NEXT.md` / `PROGRESS.md` / `tools/offline-smoke.cjs`；
    `vellum-toolbox/` 下 `index.html` / `index.js` / `manifest.json` /
    `lib/{inspect,ps,selfcheck}.js` / `tools/index.js`
  - **新**：`vellum-toolbox/lib/review.js`、`vellum-toolbox/tools/review.js`、
    `docs/50~52` 五份（含三张样张）、`review-probe/`、`preview/`
  ⇒ 新会话**先 `git status` 看一眼**，别以为是别人改的、也别顺手 `checkout` 掉。
  最近一次提交仍是 **`1cc58eb`（2026-10-13 01:22）**。
- **已就位的插件**：
  - `vellum-toolbox/` —— **交付物本体**（`com.vellum.toolbox`，v0.9.3）
  - 研发工具（**不进交付清单**，同事永远不会装到）：
    `hello-uxp` / `hello-world` / `env-check` / `link-probe` / `template-probe` / `review-probe`
  加载命令：`node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin load --manifest <相对路径>/manifest.json`
  （**幂等**：重复 load = 重新加载；`plugin reload` 不可靠，别用）
- **反馈通道都在插件自己的数据目录**
  （`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\<插件 id>\PluginData\`）：
  - `selfcheck.json` —— vellum-toolbox 的自检结论（由插件目录下的 **`verify.flag`** 触发，**默认不存在**）
  - `report.json` —— 各类探针的结论（`node tools/report.mjs` 读回）
  - `boot.log` —— 事件流水（**含用户点了什么**，`via=panel|command`；导出还会记 steps / fileCheck 读数）
- 仓库：**已上线** → https://github.com/wooozxh/vellum-ps-uxp（Public）

铁律（PROJECT.md 有完整版）：
- 新功能先出方案写成 docs/NN-xxx.md 给我确认，**确认后才动代码**
- 方案/需求没写到的先问我，不要自己拍板
- **没报错 ≠ 生效** —— 判据一律「读回」或「像素」，不许靠"命令没报错"
- 诊断项**允许「无结论」，但不许把无结论写成结论**
- ActionDescriptor **不许猜**，必须来自官方样例或真机录制
- 我不需要你教我写代码。我需要你把事做完，并给我能验证的证据（截图 / report / boot.log）
- 收工前把进展写回 PROGRESS.md，技术决策追加进 DECISIONS.md

先别写代码。读完档案把现状和建议给我，等我拍板这一轮做什么。
```

---

## 二、待拍板事项（用户决策，AI 先别自己定）

> **状态更新时间：2026-10-17**。M5 第 4 步那三票（主路/落点/条高）**已定并实施**，
> 下面只剩**第 5 步开工前的闸**与三件长期挂起项。

| # | 事项 | 状态 / 结论 |
|---|---|---|
| 1 | **第 5 步「新建稿」的规范数值** | ⏳ **就差这个**。方案（`docs/49 §3.3`）定了结构，但**数值只有用户知道**：① 常用**尺寸清单**（含用途、是否要出血）② **出血 / 安全区数值**（默认 3mm + 5mm？大幅面展架是否不同）③ **图层结构**（组名）④ 默认**色彩模式与配置文件** |
| 1b | **软件侧「模板分区」（跨项目）** | ✅ **已转出**。提示词 `docs/54` 已备（**自包含**，可直接发 `D:/proj_media` 那个会话）；契约加法提案也已写进 `D:/vellum-link/LINK-LOG.md`。**插件侧等它写出 `tpl.json`** |
| 1c | **模板打开后叫 `incoming.psd` 怎么缓解** | ⏳ **要你选**（`Document.name` 实测**不可改**）：**(A) 如实提示**「这是模板副本，请另存为你的文件名」（我倾向）／ **(B)** 打开后自动另存到你上次的目录 ／ **(C)** 动契约改固定文件名（不推荐） |
| 2 | **「AI-MCP」那一格** | ⏳ 未定（用户"先不定，再讨论"）。`tools/index.js` 那条 `planned` 灰行的 note **方向曾写反**（写的是"把插件动作暴露成 MCP"）—— 已更正并留痕，**定案前不要按任何一方实现** |
| 3 | **「常用入口」的重构** | ⏳ 未定。它是**视图**不是工具，与宫格有自我包含风险 |
| 4 | **许可证** | ⏳ 未定。仓库是 Public；**无 LICENSE = 他人不可合法复用**（若只内部用，需一句"内部使用"的声明） |
| 5 | **文字溢出检测的取舍** | ⏳ 未定。它是 `docs/49` 里**唯一无结论项**，卡在**需要用户在 PS 里录制一次描述符**（"物理上没法代劳"那一类）；已先用「元素超出画布」告警**降级替代** |

**已定，不要再问**：产品形态 =「一个插件、两类入口」（Panel 工作台 + Command 快捷动作）；
技术栈 = vanilla JS + UXP 内置 Spectrum，**零构建**；联动路线 = ② 镜像单写；
**第 4 步走备路**（副本上作业，原稿零改动）；导出落点 = **首次选一次后记住**（持久令牌）；
条高 = **图宽 × 8%**（基准，放不下按实际行数加高）；规范版本号 = **3**；
仓库 `wooozxh/vellum-ps-uxp`（Public）；提交邮箱用 GitHub noreply。

### 挂着的外部依赖（不是 AI 能做的）

- ⏳ **在有 Creative Cloud 的机器上装一次 `.ccx`**，把插件 `boot.log` 里那行 `paths data=…`
  发到 `D:\vellum-link\LINK-LOG.md`（条目须带 `[插件侧]` + 日期）—— 本机没 CC/UPIA，**这条验不了**。
- ⏳ **把 `env-check` 带到同事机器跑**（取回 PS 2024/2025 的真实数据）；
  并调查同事里是否还有 PS 2023 或更老（若有，`minVersion: "25.0.0"` 需重算）。
- ⏳ **参数条字体**：需要在 PS 里用文字工具改一次字体 → 动作面板「复制为 JavaScript」，
  把描述符给 AI（**这是唯一剩下的路**）。顺带也能解开「文字溢出检测」。
- ⏳ **系统目录选择器 `getFolder()`**：只能人点一次（之后靠持久令牌记住）。**全链路其余部分已验通**。
- ⏳ **超大稿性能**：5400 万像素（4961×10866）实测整条导出路 **~4 s**（含 `duplicate()`）；
  **更大的稿没测** ⇒ 在真拿更大的稿跑过之前，**不许宣称"很快"**。
- ⏳ `hello-world` 在 PS 菜单里的**确切位置**（「窗口」菜单 + 「插件/增效工具」菜单各看一眼）。

---

## 三、下一步候选

- **A.（推荐）M5 第 5 步 · 新建稿（`spec.json` + `presetJSON`）** —— 它是刚做完的审核版的**另一半**：
  现在审核版要**弹窗问出血**，而出血本是**建稿那一刻**就该定的事；做完后**出血弹窗基本不再出现**
  （`docs/49 §3.3` 原话）。地基**已实测**（`presetJSON` 携带 `guides` 传 4 回读 4）。
  风险比当初评估时**更小**：它是**新建文档**，不动用户任何已有稿 —— 比已走通的「导出审核版」还安全。
  **开工前需 §二 1 的四个数值。**
- **B. M5 第 6 步 · PSD 模板部件插入** —— 归「素材库」，复用 M2 既有置入链路，技术上最便宜。
  适合在 A 之后直接接。
- **C. 攻「文字溢出检测」** —— 独立攻坚，**需用户录制描述符**，难度最高。建议单独一轮，别混在 A 里。
- **D. 顺手清理** —— §二 的 2、3、4 项（AI-MCP 灰行 / 常用入口 / 许可证）。

> 生产层面的提醒：**第 4 步还没被用户在实际工作里真正用起来**（只在真稿上跑过），
> 若他用过之后发现别的问题，**那些优先修**，不急着开新功能。

---

## 四、本机环境坑速查（踩过别再踩）

### 4.0 ★ 2026-10-17 新增（全部真机踩过，代价很大）

| 坑 | 应对 |
|---|---|
| ⛔ **PS 文本描述符里 `\n` 不换行** | 段落分隔符必须用 **`\r`**。用 `\n` 会把三行**拼成一行**、右侧溢出被裁断（**命令照样报成功**）。判据：读回 `textItem.contents` 数段落 |
| ⛔ **段落右对齐（`align:right`）会把整块文字排到画布外** | 实测读回外框 `x=6403..6548`，而画布只有 1600 宽 ⇒ **导出图上完全看不到它**。**正解：不用对齐枚举**，改成"在目标位置放一个只有那么宽的盒子、默认左对齐"，**位置自己算** |
| ⛔ **PS 的 PNG 存储不支持 CMYK 稿** | ExtendScript 真实报错 `命令「存储」的参数当前是无效的  #-25923`（新建的 400×400 CMYK 稿一样失败；同稿存 JPG 却成功）。**UXP 的 `saveAs.png` 把这个错吞掉** ⇒ 表现为「报成功、盘上什么都没有」 |
| ⛔ **导出后必须「问目录」复核** | 光看 `entryBytes` 不够 ——「读失败」与「文件不存在」读数完全一样（都是 `null`）。改成列目录里"这文件名在不在、多大"，不在就重试一次，仍在就**如实报错** |
| ⛔ **不要在保存前"预写空文件让 entry 落地"** | 那会让目标变「已存在」，PS 那次保存**一个字节都没写**（盘上只留 0 字节文件）。**正解相反**：保存前先 `clearTarget()` 删掉同名 |
| ⛔ **`documents.add({mode:"CMYKColorMode"})` 静默忽略 mode** | `createScratchDoc({mode:"CMYK"})` 曾一直建出 **RGB** 稿 ⇒ **所有标着 CMYK 的探针其实在验 RGB**，整条分支从没被覆盖。**通则：凡是"传了参数"，都要读回一次**（枚举走 `constants.DocumentMode`，不一致就 `changeMode` 纠正） |
| ⛔ **"估算 ≠ 真实"：对齐/居中/贴合必须读回真实外框再定位** | 今天四处同源：依据块右对齐 / logo 的 x（估算宽 ⇒ 多出一整个 logo 宽的缝隙）/ logo 的 y（偏下 7.5px）/ 整块文字垂直居中（偏上 12–24px，元凶是**只设了字号没设行距 ⇒ PS 用自动行距**）。**一律"先建层 → 读回 `bounds` → 再定位"，估算只当初始落点** |
| ⛔ **`make textLayer` 的 `name` 不生效** | 建出来的层名是「文字图层 n」。自检里找层**只能用 `layerInfo()` 回报的真实名**，别用我们给的名字（会读到 `null`） |
| ⛔ **别靠"看缩略图"下结论** | 曾看缩放预览误判"浅条也变黑了"，裁出来量像素才发现代码是对的。**裁出来 + 量像素（众数）才作数** |
| 🔴 **`userdoc.flag` 绝不能擅自 `touch`** | 它会**在用户的真稿上真跑一次导出**。只在明确要复现用户问题时、且已告知后才开 |
| ✅ **`Document.resizeImage` / `duplicate` / `changeMode` 都存在且可用** | 本机 UXP 实测。缩放仍**先探能力再动手**，API 不在就如实记「没缩」并告警 |
| ✅ **MCP 可当开发期验仪器**（代码搬不进插件） | `@alisaitteke/photoshop-mcp` 走 `cscript → VBScript → CreateObject("Photoshop.Application") → DoJavaScript`。**能读 UXP 读不到的 `doc.guides` 坐标**（体检「出血无法判断」的根因）。⚠️ 它**不是**必须带 `/Automation` 才能连（那条旧结论**至少不是充分必要条件**，10-10 那次 429 是真的但成因**未查明**，如实标无结论）；PS 实例由谁拉起会影响存活（沙箱收尾会回收子进程） |

### 4.1 收工与推送（**2026-10-13 起改为两步**）

```bash
git add <具体文件>            # 显式点名，别用 -A
git commit -m "…"
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY git push origin main
git ls-remote origin main     # ★ 唯一的可信确认（push 的输出可能被吞）
```

- ⛔ **代理变量会让 `git push` 挂住到超时**（本机 `http_proxy/https_proxy` 有值）。
  **必须摘掉再跑**；症状是"不报错、一直等"，极易误判成网络坏了。
- ⛔ **`git push` 的输出会被吞**：经常完全无输出而 `$?` 还是 0，其实已成功。
  **判定一律用 `git ls-remote origin main`**。
- 兜底通道：`python tools/push_via_api.py`（走 `api.github.com`）。
- 🔵 **分支纪律**：要开新分支时**用户会说**，由他在 GitHub 新建再拉到本地。
  **不要自行建分支、不要改工作流。**
- Git 身份：`wooozxh <76898022+wooozxh@users.noreply.github.com>`（noreply）。

### 4.2 脚本与执行环境

| 坑 | 应对 |
|---|---|
| ⛔ **沙箱里 `spawn cmd.exe` → ENOENT** | 别走 shell；改成「扫 PATH 找 exe + 直接调」。`doctor.mjs` 第一版就因此误报 npm/git/python「未找到」 |
| ⛔ **本机 Node 在受限环境里 spawn 任何 `.exe` 都 EBUSY** | 需要调外部命令的脚本**优先用 Python**，或把外部命令交给 bash 层 |
| ⛔ **沙箱里 COM 实例化被拦** | `New-Object -ComObject Photoshop.Application` 报 "COM object instantiation can run arbitrary code" |
| ⛔ **`reg.exe` 被沙箱禁** | 查安装信息改用 `find` / `ls` 或 PowerShell 的 `Get-ItemProperty` |
| ⛔ **`npm run build:win` 那类"先 build 再打包"会被批量删除护栏拦** | 护栏按会话轮次累计。**正解：拆两步**，输出到全新空目录；清大目录用 Python `shutil.rmtree` |
| ⛔ **不能跑 `.ps1`** | shell 执行策略禁脚本。要跑得显式绕，或改用别的语言 |
| ⛔ **不能用内联 `Add-Type`** | 安全策略拦。需要调 Win32 API 时走 **Python + ctypes 直调 user32/gdi32**（先例 `tools/manual/shoot_win.py`） |
| ⛔ **Python 起不了子进程** | 沙箱下 `subprocess` EBUSY。Python 只做"生成文件"这类纯计算 |
| ⛔ **PowerShell 工具的输出经常被整体吞掉** | 同一段命令**改用 Bash 重跑**通常就正常 |
| ⛔ **PowerShell 沙箱会回收子进程** | 用它 `Start-Process` 拉起的 PS **在工具调用收尾时被清掉**（不是 PS 自己退出）。要常驻得挂在**受管后台任务**里跑 |
| ⛔ **截图路线不可用** | `windows-app-screenshot` 的 `capture_window.ps1` 跑不出 PNG。**要"看到"插件行为，用 `boot.log` 而不是截图** |
| ✅ **Edge 无头截图可用** | `msedge.exe --headless=new --disable-gpu --hide-scrollbars --user-data-dir=<临时目录> --window-size=W,H --screenshot=out.png "file:///…"`。**必须带 `--user-data-dir`**（不带静默不出图）；返回是**异步**的，要 sleep 后确认产物 |

### 4.3 UXP / PS 侧

| 坑 | 应对 |
|---|---|
| ⛔ **UXP CLI 未启用开发者模式时全线不可用**（连纯本地的 `plugin validate` 也报连不上服务） | 别误判成 CLI 装坏了 |
| ⛔ **`plugin reload` 不可靠** | 不接受 `--manifest`，实测报 `Command execution failed in all connected applications`。**用 `plugin load --manifest` 代替**（幂等） |
| ⛔ **`tools\uxp.cmd` 在 Git Bash 里不可靠** | UTF-8 被按 GBK 读。直接用 `node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js <子命令>` |
| ⛔ **`app.name` / `app.version` 在本机读不到** | PS 27.2 / UXP 9.0.2 下返回 `undefined`。别拿它们当「连接是否建立」的判据（用 `app.documents.length`） |
| ⛔ **PS 原生模态框会卡死 `executeAsModal`** | 对非文本层 `set textLayer` 等非法操作会让 PS 弹原生错误框并**阻塞整个模态作用域** —— 插件侧 `await` 永不返回。用 `python tools/win_dialog.py <PS_PID>`（列表）/ `--close PSDialogBox`（关闭）。**预防 > 抢救** |
| ⛔ **`batchPlay` 的 `make`+`textKey` 建不出文本图层** | 只建出 `layerKind=1` 的普通层（**图层名却是对的 → 极易假阳性**）。正解见 `docs/04` |
| ⛔ **`set` 类 batchPlay 必须包在模态里** | `get` 不用、`set` 必需。**"读能跑"不能推断"写能跑"** |
| ⛔ **`resizeCanvas` 的锚点字符串被静默忽略** | 必须用 `photoshop.constants.AnchorPosition.TOPCENTER`（值 `top-center`）。**通则：需要枚举值时先查 `photoshop.constants`，不要拼字符串** |
| ⛔ **`saveAs.png(entry)` 会改掉文档名** | 必须传第 3 参 `true`（asCopy） |
| ⛔ **程序化设置中文字体无效** | 四条路全无效，需录制动作。详见 DECISIONS 最新一节 |
| ⛔ **插件目录是只读存储** | 插件删不掉自己的文件；UXP 的 `Folder` **没有 `deleteEntry`**。所以「文件开关」只能由**外部**管理，插件产物一律写 `PluginData` |
| ⛔ **`rm` 删不了 `$APPDATA` 展开出的路径** | 报 `SAFE_DELETE_INVALID_PATH`。改用相对路径（先 `cd` 进去再删），或让插件自己覆写 |
| ⛔ **改文件后判断"内容有没有变"别读磁盘** | `core.autocrlf=true`：磁盘可能是 CRLF、git 里是 LF。用 `git cat-file blob <sha>` 或 `git show HEAD:<path>` |
| **报告在 C 盘、项目在 D 盘是正常的** | Adobe 硬编码在 `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<ver>\`。`report.mjs` 按 `%APPDATA%` 递归搜 |
| **PS 是离线安装包装的（非 CC）** | 若「CLI 加载成功但 PS 里看不到插件」，优先怀疑这一点 |
| **`gh` 没装** | 建仓库 / 发 Release 走 GCM 凭据 + REST API。**GitHub 连接器只能读**，其令牌**没有建仓库权限**（403） |

- ✅ **2026-10-18 已发布 v0.9.37**：
  · 代码 commit `d729477`（v0.7.0 → v0.9.37 全部功能）+ `9ae4549`（手册）
  · Release：https://github.com/wooozxh/vellum-ps-uxp/releases/tag/v0.9.37
  · 安装包 `dist/com.vellum.toolbox_PS.ccx`（619KB）
  · 主手册 `docs/manual/`（8 个工具，6 张新截图）+ 更新说明 `docs/update/v0.9.37-更新说明.html`
  · 已通过企业微信发到用户（3 个文件）
  · ⏳ **等用户肉眼确认**：按规范建稿的 4 条参考线位置对不对（真机读不到坐标）
  · ✅ **2026-10-18 02:30 手册截图全部换成示例素材**（commit `18ac4d1`）：
    真实物料改了目录名（`_22` / `_logo`）+ 备份到 `D:/vellum_workspace_bak_20261018/`；
    示例图由 `tools/manual/make_sample_assets.py` 生成；两本手册已重新生成并再发企微。
    🔴 **以后重截手册，别直接截真实工作区** —— 先按这个流程把示例素材铺进去。
