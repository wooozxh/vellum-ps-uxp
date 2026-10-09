# PS 插件开发工作区（ps-uxp-dev）

Photoshop UXP 插件的开发工作区。宿主 **Photoshop 2026（v27.2）**，位于
`D:\software\adobe\Adobe Photoshop 2026\`。

> **工作模式：vibecoding** —— 你提需求、做验收，代码由 AI 写、由 AI 验证。
> 因此这里的重点不是「人类开发者的学习路径」，而是**一条能被脚本驱动的反馈闭环**：
> AI 改完代码 → 自动重载插件 → 读回运行结果 → 自己判断对错。

配套资料库在本目录下：`docs/`

---

## 一、闭环是怎么设计的

难点在于：**UXP 插件跑在 Photoshop 进程内部**。代码没法在 PS 外面执行，普通脚本也读不到
它的 `console.log`（那些只进 UDT 的调试窗口）。所以闭环要靠两条通道搭起来：

| 环节 | 靠什么实现 | 谁来做 |
|---|---|---|
| 把代码送进 PS | `uxp plugin load` | 脚本（AI） |
| 改完自动生效 | `uxp plugin watch`（存盘即重载） | 脚本（AI） |
| **把结果取回来** | **插件自己把结论写成 `report.json` 落盘** | 插件内代码 |
| 读结果并判断对错 | `node tools/report.mjs` | 脚本（AI） |
| 看面板长什么样 | 截图 Photoshop 窗口 | 脚本（AI） |

第二列里最关键的是第三行。**反馈不走日志、只走文件**，因为只有文件是脚本能稳定读到的。
为了不让「跑测试」依赖人去点按钮，`hello-uxp/` 下放了一个 `autorun.flag`：
只要这个文件在，插件每次加载都会自动跑一遍全量自检并写报告。
于是 **`reload` 就等于 `跑测试`**。想关掉自动自检就删掉那个文件。

---

## 二、当前状态

```
[ ✓ ] Photoshop 2026 (v27.2)        D:\software\adobe\Adobe Photoshop 2026\
[ ✓ ] PS 内置 UXP 运行时
[ ✓ ] UXP Developer CLI              （Adobe 官方工具，从 npm 装，已就位）
[ ✓ ] devtools 原生桥接              （含 AID.dll / VulcanControl.dll）
[ ✗ ] 开发者工作流开关  ★关键闸门     需要一次管理员操作
[ ✗ ] 自检报告通道                  等插件第一次跑过就会生成
```

**只差一步**：`C:\Program Files\Common Files\Adobe\UXP\Developer\settings.json`
这个开关文件（内容是 `{"developer":true,"hostAppPluginWorkspace":true}`）。
它在 Program Files 下，必须管理员权限才能写。

一个好消息：**Creative Cloud 和图形版 UXP Developer Tool 现在都不是必需的了。**
CLI 里已经打包了完整的原生桥接（`VulcanControl.dll` 等，就是 UDT 用的那套），
所以只要能写上面那个开关文件，load / reload / watch / logs 全都能由脚本完成。
CC 只有在你想用 UDT 图形界面时才需要——而你既然走 vibecoding，基本用不上。

---

## 三、一次性动作（需要你，约 1 分钟）

**第 1 步：开开发者工作流（需要管理员）**

按 Win 键 → 输入 `PowerShell` 或 `终端` → **右键 → 以管理员身份运行** → 粘贴：

```powershell
cd "D:\ps-uxp-dev"
node tools\enable-devtools.mjs
```

看到 `✓ 开发者工作流已启用` 即可。随时可以用 `node tools\enable-devtools.mjs --check`
查看状态，用 `--off` 关掉（关掉后 PS 不会再加载开发版插件）。

**第 2 步：在 Photoshop 里也开一下**

`编辑 → 首选项 → 插件 → 勾选「启用开发人员模式」` → **重启 Photoshop**。
（这一项和上面的开关各管一层，都开最稳。这一项不需要管理员权限。）

做完这两步告诉我，我跑一次自检确认，然后就能开始写真正的插件了。

---

## 四、日常开发闭环（做完上面两步之后）

```bash
# 终端 A：常驻服务（会一直占着，别关）
tools\uxp.cmd service start

# 确认 PS 被认到了（PS 必须先打开）
tools\uxp.cmd apps list

# 加载插件
tools\uxp.cmd plugin load --manifest hello-uxp\manifest.json

# 开发时：存盘自动重载（AI 改完代码就自动生效）
tools\uxp.cmd plugin watch --path hello-uxp

# 读插件跑出来的结果
node tools\report.mjs
```

手动重载一次并立刻看结果（最常用的一行）：

```bash
tools\uxp.cmd plugin reload && node tools\report.mjs
```

其它有用命令：

```bash
tools\uxp.cmd plugin validate --manifest hello-uxp\manifest.json   # 校验 manifest
tools\uxp.cmd plugin logs                                          # 插件日志窗口
tools\uxp.cmd plugin test                                          # 跑插件内测试
tools\uxp.cmd plugin package --apps PS                             # 打包发布用
node tools\doctor.mjs                                              # 环境自检
node tools\report.mjs --all                                        # 列出所有历史报告
```

改 `manifest.json` 必须重新 `load`（`reload` 不带 manifest 变更）。

---

## 五、目录结构

```
ps-uxp-dev/
├── PROJECT.md                  档案① 项目身份证（技术栈、铁律）—— AI 必读
├── PROGRESS.md                 档案② 进度台账（跨会话接力棒）—— AI 必读 + 必写
├── DECISIONS.md                档案③ 技术决策记录 —— 做了决策就追加
├── NEXT.md                     档案④ 换会话的启动词（整段复制即用，含环境坑速查）
├── README.md                   本文件：闭环手册
├── hello-uxp/                  冒烟测试插件 = 闭环的探针
│   ├── manifest.json            manifest v5：host 是数组，权限默认全关需显式声明
│   ├── index.html               面板 UI
│   ├── index.js                 自检用例 + 写报告 + 自动触发
│   └── autorun.flag            存在=加载时自动跑自检；删掉即关闭
├── tools/
│   ├── doctor.mjs              环境自检（按 vibecoding 闭环口径）
│   ├── enable-devtools.mjs     启用/关闭开发者工作流（需管理员）
│   ├── report.mjs              读取插件写出的 report.json
│   ├── push_via_api.py         github.com 被拦时的推送兜底通道
│   ├── uxp.cmd                 CLI 包装器（Windows）
│   └── uxp                     CLI 包装器（bash，给自动化用）
├── docs/                      资料库 + 方案文档（NN-xxx.md 编号，见 docs/README.md）
├── official-samples/           官方示例仓库（浅克隆，27 个示例）—— 不入库
├── node_modules/               UXP CLI 及其原生桥接 —— 不入库
├── .vscode/                    VS Code 工作区配置
├── .gitignore
└── .editorconfig
```

---

## 六、降级方案（万一不想动管理员权限）

不走 CLI，改成手工旁加载，代价是每次改代码都要重启 PS（约 1 分钟），闭环变慢但可用：

1. PS 里勾选「编辑 → 首选项 → 插件 → 启用开发人员模式」
2. 把整个 `hello-uxp` 目录复制到：
   ```
   C:\Program Files\Common Files\Adobe\UXP\Plugins\External\com.wooozxh.hellouxp\
   ```
   （需管理员；若该目录不能被 PS 识别，改放 `%APPDATA%\Adobe\UXP\Plugins\` 再试）
3. 重启 Photoshop，菜单 `插件 → Hello UXP` 打开面板
4. 面板上点「运行自检并写报告」，然后 `node tools\report.mjs` 读结果

写报告这条通道和 CLI 方案完全一样，所以「AI 能读到结果」这一点不受影响，
受影响的只是重载速度。

---

## 七、写新插件时的约定（写给 AI，也写给未来的你）

1. **从 `hello-uxp` 抄骨架**，而不是从零写——它已经把 manifest v5 的坑、模态约束、
   报告通道都踩平了。也可以从 `official-samples/` 里挑更合适的：
   `hello-world-panel-js-sample`（最小面板）、`ui-react-starter` / `ui-vue-starter` /
   `ui-svelte-starter`（框架面板）、`typescript-webpack-sample`（类型安全工程）、
   `swc-uxp-starter`（Spectrum Web Components，v5 manifest）。
2. **新插件的 `id` 必须唯一**，别和 `com.wooozxh.hellouxp` 撞。
3. **凡是有副作用的操作都要能被验证**，也就是跑完之后文档里要留下可检查的痕迹，
   并写进报告。否则 AI 只能"看起来对"，没法确认。
4. **测试不能污染用户工作区**：像 `hello-uxp` 那样，临时建的文档跑完自己关掉。
5. 框架工程（React/Vue/TS）要先 `yarn install && yarn build`，然后让 CLI / UDT
   指向构建产物里的 **`dist/manifest.json`**，不是源码目录里的那份。

---

## 八、项目档案（换会话不丢上下文）

根目录的四个文件是**给 AI 读的入职材料**，跟代码同等重要：

| 文件 | 回答什么问题 | 更新时机 |
|---|---|---|
| `PROJECT.md` | 这项目是干啥的？技术栈？铁律？ | 改选型或范围时 |
| `PROGRESS.md` | 干到哪了？下一步做什么？ | **每次会话收工都要更新** |
| `DECISIONS.md` | 为什么选 A 不选 B？ | 每做一次技术决策 |
| `NEXT.md` | 下个会话怎么开机？ | 现状大变时 |

用法：换新会话时，把 `NEXT.md` 第一节那段启动词**整段复制**发给 AI，它会自己读完档案再动手。

这套做法不是本项目原创 —— 是从上一个项目 VellumDesk 引入的通用方法论，
说明见 `docs/00-长周期开发-AI协作手册.md`。

---

## 九、Git 与仓库

**远程**：https://github.com/wooozxh/vellum-ps-uxp （Public）

- **已入库**：档案四件套、`README.md`、`hello-uxp/`、`tools/`、`docs/`、`.vscode/`、`package-lock.json`
- **不入库**（见 `.gitignore`）：`node_modules/`、`official-samples/`、`.workbuddy/`、构建产物

`official-samples/` 不入库的原因：它本身是个**独立的 git 仓库**（自带 `.git`），
提交进去只会变成空壳 gitlink；而且它是第三方代码，vendoring 有许可问题。换机器重新拉：

```bash
git clone --depth 1 https://github.com/AdobeDocs/uxp-photoshop-plugin-samples.git official-samples
```

### 推送：先试常规，不通走兜底

```bash
# 常规（大多数时候可用）。本机有代理变量时 GCM 会挂起，要先摘掉
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY git push origin main

# 兜底：报 "Failed to connect to github.com:443" 时用（改走 api.github.com）
python tools/push_via_api.py
```

`push_via_api.py` 为什么存在：本机 `github.com:443` 会被**间歇性 SNI 拦截**，
而同一时刻 `api.github.com` 是通的 —— 远端没坏，坏的只是那一个入口。
它走 Git Data API；因为 Git 对象内容寻址，远端算出的 sha 与本地完全一致，
推完连 `fetch` 都不需要。**常规 `git push` 可用时优先用它**，这个只是兜底。

### 其它踩过的坑

- **`git push` 的输出会被吞**（无输出但实际成功）。判定结果用 `git ls-remote origin main`，别信输出。
- **`git credential fill` 会偶发返回空**，脚本里取令牌必须重试。
- **本机没装 `gh`**；建仓库 / 发 Release 走 GCM 凭据 + REST API
  （GitHub 连接器只能读，且其令牌没有建仓库权限）。

---

## 十、相关链接

- 官方文档总览（跨应用 UXP Hub）：https://developer.adobe.com/uxp/
- Photoshop DOM API：https://developer.adobe.com/photoshop/uxp/2022/ps-reference/
- Manifest v5 规范：https://developer.adobe.com/photoshop/uxp/2022/guides/uxp-guide/uxp-misc/manifest-v5/
- 官方示例仓库：https://github.com/AdobeDocs/uxp-photoshop-plugin-samples
- 官方开发者论坛：https://forums.creativeclouddeveloper.com/
- CLI 源码：https://github.com/adobe-uxp/devtools-cli
