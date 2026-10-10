# Vellum 工具箱（`vellum-toolbox`）· M1

公司设计部门的 Photoshop 小工具合集。**一个插件、两类入口、共用一份代码**。

| | |
|---|---|
| 插件 id | `com.vellum.toolbox` |
| 插件名 | `vellum_toolbox`（manifest 的 `name`；面板显示名用「Vellum 工具箱」） |
| 版本 | `0.1.0` |
| 最低 PS | `25.0.0`（PS 2024 起，暂定 —— 见 `docs/12`） |
| 权限 | **无**（`requiredPermissions: {}`）—— M1 不需要网络、不需要文件系统授权 |
| 目录 | `D:\ps-uxp-dev\vellum-toolbox\` |

---

## 一、怎么用

```bash
# 加载（幂等，重复 load = 重载）
node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin load --manifest vellum-toolbox/manifest.json

# 打包成可发给同事的 .ccx（不需签名，双击即装）
node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin package --manifest vellum-toolbox/manifest.json --outputPath dist
```

- **面板**：PS 里 `窗口 > 插件 > Vellum 工具箱`（**这一步只能人工点**）。
- **命令**：PS 里 `插件 / 增效工具` 菜单 → 「品牌主色 → 前景色」/「品牌主色 → 背景色」。

> ⚠️ `tools\uxp.cmd` 在 Git Bash 里会解析错乱（UTF-8 的 .cmd 被 cmd.exe 按 GBK 读），
> 所以上面两条都用等价的 `node …/uxp.js <子命令>` 写法。在真实 cmd / PowerShell 窗口里 `.cmd` 正常。

## 二、目录结构

```
vellum-toolbox/
├── manifest.json          1 个 panel + 2 个 command
├── index.html             外壳 UI（首页宫格 + 工具视图容器 + 状态条）
├── index.js               外壳：读注册表 → 渲染首页 → mount / unmount
├── lib/
│   ├── data.js            PluginData 文件底座（读写 / 开关文件 / 路径）
│   ├── log.js             boot.log 通道
│   ├── store.js           PluginData 里的 JSON（readJson / writeJson / backup）
│   ├── dom.js             极小 DOM 工具（el / clear / makeBinder）
│   ├── ps.js              PS 操作封装（runModal / 读设前景背景色 / 恢复）
│   ├── caps.js            能力探测 + 降级（横切约束，见 docs/12）
│   └── selfcheck.js       无痕自检（verify.flag 控制）
├── tools/
│   ├── index.js           注册表（加工具 = 加一行）
│   └── palette.js         调色板（M1）
└── icons/                 6 个 PNG（dark / light / plugin，各 1x+2x）
```

**加工具的方式**：新建 `tools/xxx.js` 导出 `{id, title, subtitle, mount, unmount}`，在 `tools/index.js` 的 `tools` 数组里加一行。**外壳不用动。**

## 三、M1 做了什么

**调色板**
- **品牌色**：6 个色块 —— ⚠️ **当前是占位色**，等品牌 HEX 定了改 `tools/palette.js` 里的 `DEFAULT_BRAND` 即可（一处改完）。
- **我的颜色**：用户自己存的常用色，落在 `PluginData/palette.json`。
- **交互**：`左键` = 前景色 ／ `Shift + 左键` = 背景色 ／ `右键` 或块上 `✕` = 删除（仅「我的颜色」）。
- **＋ 存为我的颜色**：把当前前景色存进列表（同色不重复存）。
- 顶部常显**当前前景/背景色读数**（就是回读值，肉眼可见的凭证）。

## 四、反馈闭环（怎么验证它真的能用）

所有结论都落在插件数据目录，外部脚本可读：

```
%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.vellum.toolbox\PluginData\
├── boot.log         加载 / 工具切换 / 每次设色（含 hex + **回读值** + 失败原因）
├── palette.json     「我的颜色」数组（version=1）
├── selfcheck.json   自检结论（跑过才有）
└── palette.backup.json  自检前的自动备份
```

**开自检**：在插件目录建一个空文件 `verify.flag`，然后重载 —— 加载即跑一遍无痕自检（删掉文件即关）。
再加 `verify-keep.flag`，自检色会**保留**到磁盘，下一次加载时由 S2 证明「它活过了重载」。

**自检怎么做的**：**不另写一套逻辑**，而是**合成点击真的 DOM 元素**，让事件走真实处理器。
所以它测的是面板本身，不是影子实现。

⚠️ 踩过的坑（已写进代码注释）：
- UXP 的 `new MouseEvent("click", {shiftKey:true})` **构造不报错但会丢掉 `shiftKey`**，
  于是「Shift+点击」会静默退化成普通点击 —— 测试"看起来跑了"其实没测到。
  正解是造一个普通 `Event` 再把 `shiftKey` 当**自有属性**挂上去（`selfcheck.js` 的 `syntheticClick`）。
- 落盘类判据必须锚定「**本次新增的条目**」，不能只按值匹配 —— 否则会等到上一次的遗留条目，出现假阳性。

## 五、技术约束（改代码前必读）

- **不是浏览器、也不是 Node**：引宿主模块只能 `require()`，不能 `import`。
- **改文档必须包在 `core.executeAsModal()` 里**，否则报「模态被占用」。
- **读色 / 设色的 target 写法不一样，写错会静默失败**：
  - 读：`_target: [{_property:"foregroundColor"}, {_ref:"application", _enum:"ordinal", _value:"targetEnum"}]`
  - 设：`_target: [{_ref:"color", _property:"foregroundColor"}]`，`to: {_obj:"RGBColor", red, grain, blue}`
  - **绿色分量的键名是 `grain`**，不是 `green`（分量 0–255）。
  - 详见 `lib/ps.js` 文件头与 `DECISIONS.md`。
- **装不上比跑错好**：任何有版本门槛的能力都先探测再调用（`lib/caps.js`），不裸调。见 `docs/12`。

## 六、M1 验收（可自证）

| # | 标准 | 结果 |
|---|---|---|
| 1 | `plugin load` 成功、`boot.log` 出现 `loaded` | ✅ |
| 2 | 面板显示工具宫格；点「调色板」进工具、「←」返回 | ✅（自检 S1 验证 mount + 渲染） |
| 3 | 点品牌色 → 前景色变化，日志记 `hex` + **回读值** | ✅（S3） |
| 4 | `Shift+点` → 背景色变化，日志记 `set=background` | ✅（S4） |
| 5 | 「＋存为我的颜色」→ `palette.json` 落盘，**跨重载仍在** | ✅（S5 + S2：上一轮写的活过了重载） |
| 6 | `verify.flag` 存在时加载即跑无痕自检，`ok=` 写进 `boot.log` | ✅（10/10 与 9/9 两轮） |
| 7 | 环境不回归：`node tools/doctor.mjs` 仍 13/15、闭环 5/5 | ✅ |

自检脚本的产出：`selfcheck.json`（`summary` / 逐条 `results`）。
