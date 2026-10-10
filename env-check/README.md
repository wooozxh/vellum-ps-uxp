# env-check · Vellum 环境体检

> **一句话**：在**没法开发的机器**（同事的 PS 2024 / 2025）上，点一下就把本机的 UXP 能力采集回来。

## 为什么需要它

开发机只有 PS 2026（UXP 9.0.2）。同事的 PS 2024 / 2025 装的是什么 UXP、
哪些 API 能用、有没有静默行为差异 —— **这些在本机无法复现**。
于是做这个一次性体检插件：同事跑一遍，把 `report.json` 发回来，把"我猜"变成"数据"。

策略背景见 `docs/12-多版本兼容性策略.md`。

## 一、怎么跑（开发机：本机）

```bash
# 先确保 PS 开着、常驻服务在跑（见 README.md 开机三件事）
node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin load --manifest env-check/manifest.json
```

**加载即自动跑一遍**，面板名 **「Vellum 环境体检」**。读回结果：

```bash
# 报告与日志都在插件数据目录
%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.wooozxh.envcheck\PluginData\
  ├── report.json     # 结构化结论（脚本读这个）
  └── boot.log        # 流水
```

## 二、怎么给同事（分发）

打包成 `.ccx`（**不需要签名**）：

```bash
node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin package \
     --manifest env-check/manifest.json --outputPath dist
# → dist/com.wooozxh.envcheck_PS.ccx
```

同事那边装：

| 情况 | 做法 |
|---|---|
| 有 Creative Cloud 桌面端（正常商用安装） | **双击 `.ccx`**，按 CC 提示安装 |
| 无 CC / 权限受限 | `.ccx` 本质是 zip → 解压后把整个文件夹**拷进 PS 的 `Plug-ins` 目录**（如 `...\Adobe Photoshop 2024\Plug-ins\`），重启 PS |

> ⚠️ `.ccx` 的 `host` 必须是**单个对象**。开发用的 manifest 写的是数组（方便多宿主），
> 打包时工具会**自动折成第一个宿主**，无需手改。

## 三、怎么把报告拿回来

报告面板会**直接显示全文**（最省事：截图即可）。另有两条更完整的通道：

1. **「另存报告…」按钮** → 弹系统保存框 → 存到桌面 → 发回。
   走的是 `localFileSystem: "request"` 权限（**不需要** `fullAccess`）。
2. 手工取 `PluginData\report.json`（路径见面板底部）。

## 四、它测什么

| 组 | 项 |
|---|---|
| **A 运行时与宿主** | UXP 版本、`uxp.host` 名/版本、DOM `app.version`、`batchPlay` 读 version、平台、sandbox 路径（**含 PS 大版本号**） |
| **B 核心 API** | `executeAsModal`、DOM 对象图、`batchPlay` 只读、**写自身 PluginData**（M2 镜像通道地基） |
| **C 版本差异项** | DOM `createTextLayer`（新路）vs `batchPlay make+textKey`（老路） |
| **D 调色板地基** | 读/设 前景、背景色（batchPlay 多写法 + DOM SolidColor），**设完即恢复原值** |
| **E UI 组件** | `<input type="color">`、内置 `sp-*` 组件注册情况 |
| **F 其他** | `fetch` / `WebSocket` 是否存在（路线 ③ 的可选性） |

## 五、安全声明（它会碰什么、不会碰什么）

- **会**：建一个临时文档跑 C 组，**跑完立即关闭**，不污染你的工作区。
- **会**：临时改前景/背景色做 D 组测试，**测完恢复原值并回读校验**。
  - ⚠️ **仅在能读到原值时才改** —— 读不到就不测（否则无法恢复）。这是硬策略。
- **绝不会**：对非文本层发带 `textKey` 的 `set textLayer`（那会让 PS 弹原生框并**卡死模态**，见 `docs/04`）。
- **不会**：联网、读写你 PluginData 以外的任何目录（`localFileSystem: "request"` 只在"另存报告"时用系统选择框）。

## 六、本机（PS 2026 / UXP 9.0.2）基线结果

`17 / 21`。**4 个 FAIL 全部合理且预期**：

| FAIL 项 | 含义 |
|---|---|
| `photoshop.app.version`（DOM） | 本版本读不到 → 用 `uxp.host.version` 代替 |
| `batchPlay` 读 `application.version` | 读不到；官方 `_warning` 明确"请改用 `require('uxp').host.version`" |
| `batchPlay make+textKey`（老路） | **预期 FAIL** —— 2026 上只建普通层（`kind=pixel` / `layerKind=1`），改走 DOM |
| `<input type="color">` | `type` 保留为 `"color"` 但 `value=null` → **实现不完整，M1 不应依赖它** |

### 🔑 M1 调色板的地基：已实测通过的写法

```js
const { action, app } = require("photoshop");

// 读前景/背景色 —— target 用 [_property, application]
const r = await action.batchPlay([{
  _obj: "get",
  _target: [
    { _property: "foregroundColor" },
    { _ref: "application", _enum: "ordinal", _value: "targetEnum" }
  ]
}], {});
// → r[0].foregroundColor = { _obj:"RGBColor", red, grain, blue }   ← 注意是 grain

// 设前景/背景色 —— target 用 [color!]（与"读"不同！）
await action.batchPlay([{
  _obj: "set",
  _target: [{ _ref: "color", _property: "foregroundColor" }],
  to: { _obj: "RGBColor", red: 255, grain: 0, blue: 0 }            // 0–255，半浮点
}], {});
```

**两个坑（都已在探针里加了防护）**：

1. **读、设的 `_target` 写法不一样。** 用错的一方**静默失败、不报错** ——
   `[prop, appRef]` 能"读"但**设不上**；只有 `[ref:color]` 能设。
2. **"设上了"的判据不能只看回读值等于目标色** —— 若测试色恰好等于当前色，
   "没设上"也会判成"设上了"（首轮实测踩到）。必须**同时要求"值确实变了"**。

DOM 侧同理：`app.foregroundColor = {red,green,blue}` 会抛 `reading 'desc'`；
正确姿势是拿现有的 `SolidColor` 改属性再赋值：

```js
const c = app.foregroundColor;      // SolidColor 实例
c.rgb.red = 34; c.rgb.green = 12; c.rgb.blue = 200;
app.foregroundColor = c;
```

## 七、文件

| 文件 | 作用 |
|---|---|
| `manifest.json` | v5，`minVersion: "25.0.0"`，panel + command 双入口 |
| `index.html` | 面板外壳。**刻意不用 `sp-*`** —— 否则在不支持的老版本上连界面都出不来 |
| `index.js` | 全部探测逻辑（六组），超时/错误全捕获 |
| `icons/` | 自生成图标（纯标准库 PNG，见 `tools/` 临时脚本已删） |
