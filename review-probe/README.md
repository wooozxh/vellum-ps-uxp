# Review Probe · 「导出审核版 + 参数条」能力探针

> 建于 **2026-10-13**。回答一个问题：**docs/49 §3.2 写的那条「扩画布 → 铺白底 →
> 写参数文字 → 导出 → 一步还原」链路，在真机上到底成不成立？**
>
> **结论：16 项 = 14 通过 / 0 失败 / 2 无结论**（真机 PS 27.2 / UXP 9.0.2）。
> 其中 **2 项无结论全是同一个原因：程序化设置中文字体做不到**（详见 §三）。
> **原设计里的一处关键假设被推翻**（锚点写法），已换到正确写法（§二）。

配套方案：`docs/50-导出审核版-方案.md`
报告归档：`probe-report-2026-10-13.json`（含全部原始读数）
物证图片：`artifacts/`

---

## 一、怎么跑

```bash
# 常驻服务（已起则可跳过）
node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js apps list

# 加载探针（插件目录下有 autorun.flag ⇒ 加载即自动跑一遍）
node node_modules/@adobe-fixed-uxp/uxp-devtools-cli/dist/uxp.js plugin load --manifest review-probe/manifest.json

# 读结论
node tools/report.mjs
```

> ⚠️ 本机 `tools\uxp.cmd` 在 Git Bash 里不可靠（UTF-8 被按 GBK 读）⇒ 直接用上面那条 `node .../uxp.js`。
>
> 面板名 **Review Probe**（窗口菜单里），有「运行探针并写报告」按钮（跑全套 16 项）。
>
> **两种模式（靠插件目录下的 flag 选）**：
> - `samples.flag` 存在 ⇒ **只出三张参数条样张**（R17，约 6 秒）★ 这个优先级更高
> - `autorun.flag` 存在 ⇒ 跑全套 16 项（约 30 秒，会建 30+ 张临时文档）
> - 两个都没有 ⇒ 加载后不动手，等你点按钮
>
> ⇒ **不想要自动跑就把对应的 `.flag` 文件删掉**（外面删，插件自己删不了自己的文件）。

**安全性自证**：探针**只在自己建的临时文档上试**，收尾全部关闭；报告里
`docsBefore` / `docsAfter` / `userDocsUntouched` 三个字段可核对 ——
本次三轮运行**都是 2 / 2 / true**（用户当时开着 2 个文档，一个没被碰）。
另外探针会临时改「背景色」，**用完还原并读回确认**（R10 实测：设前 `RGB(230,0,18)` → 设成白 → 用完还原回 `RGB(230,0,18)`）。

---

## 二、实测矩阵

| # | 验的什么 | 结果 | 关键读数 |
|---|---|---|---|
| R1 | Document / 宿主能力普查（只读） | ✅ | Document 上 **36 / 56** 个候选成员存在；原型链 level0 = **65 个** |
| R2 | `resizeCanvas` 写法矩阵 | ✅ | **位置参数**形式可用；**对象形式全报 `Illegal data type`** |
| R3 | `saveAs` 普查 + 真导 PNG | ✅ | `saveAs` = **`{psd, psb, jpg, gif, png, bmp}`**；`saveAs.png(entry)` 落盘 2634 B |
| R4 | 白底机制（像素判定） | ✅ | **`resizeCanvas` 的新区域用「背景色」填充** ← 白底靠这个 |
| R5 | 中文字体候选普查（只读） | ⚠️ 无结论 | 本机 583 字体，候选命中 **11 个**；但建层带 `fontName` **不生效** |
| **R6** | ★ **扩画布 + 新增图层 能否一步回退** | ✅ | **400×300/1 层 → 400×360/2 层 → 一步回到 400×300/1 层** |
| R7 | 锚点矩阵（字符串写法） | ✅ | 🔴 **5 种写法结果完全相同** ⇒ 字符串锚点**被静默忽略** |
| **R8** | ★ **导出会不会劫持文档** | ✅ | 🔴 不带 asCopy ⇒ **文档被改名**；**带 asCopy ⇒ 名字/路径都不变** |
| R9 | `set textStyle{fontName}` | ⚠️ 无结论 | 不生效（回读仍是默认字体） |
| R10 | 综合样张（链路跑通 + 留物证） | ✅ | 400×360 样张落盘；背景色**成功还原** |
| **R11** | ★ **`photoshop.constants.AnchorPosition`** | ✅ | ★ **枚举值 `top-center` 生效** ⇒ 新空间真的能只落在底部 |
| R12 | ★ 替代路线：新建高稿 + 跨文档复制图层 | ✅ | 内容 y0-299、白条 y300-359；**用户原稿未被改** |
| R13 | 字体：像素比对（4 组） | ✅（结论=不可控） | 🔴 **4 张图文字区像素哈希完全相同** |
| R14 | 字体：读回 textKey → 改 `fontName` → 整份写回 | ✅（结论=不可控） | 复读仍是 `Adobe Heiti Std` |
| R15 | 字体：`fontPostScriptName` 四种组合 | ✅（结论=不可控） | 4 张仍与基线像素相同 |
| R16 | 字体：连 `fontStyleName` 一起换 | ✅（结论=不可控） | 3 张仍与基线像素相同 |
| R17 | 参数条样张：图宽 4% / 6% / 8% 三档 | ✅ | 3 张样张；**内容贴顶、条在底部**，供挑比例 |

---

## 三🔴 两条必须记住的结论

### 1. `resizeCanvas` 的锚点：字符串没用，**枚举值才行**

```
✗ resizeCanvas(w, h, "topCenter")        → 静默忽略，新空间上下各半
✗ resizeCanvas(w, h, "bottomCenter")     → 同上
✗ resizeCanvas(w, h, "top") / "TC"       → 同上
✗ resizeCanvas({width, height, anchor})  → 报 Illegal data type
✅ resizeCanvas(w, h, constants.AnchorPosition.TOPCENTER)   → 内容留在上方、新空间全在底部
```

`photoshop.constants.AnchorPosition` 的 9 个成员（值的写法是**中划线**）：

```
BOTTOMCENTER = bottom-center   BOTTOMLEFT = bottom-left   BOTTOMRIGHT = bottom-right
MIDDLECENTER = middle-center   MIDDLELEFT = middle-left   MIDDLERIGHT = middle-right
TOPCENTER    = top-center      TOPLEFT    = top-left      TOPRIGHT    = top-right
```

**语义要小心**（本轮用像素验过，不是推断）：`TOP*` 表示"**原内容贴在顶部**"⇒ 新空间加在**下方**，
正是"下方参数条"要的；`BOTTOM*` 反过来（新空间加在上方）；`MIDDLE*` = 上下各半。

> ⚠️ 这条**推翻了 docs/49 §3.2** 里写的 `resizeCanvas(宽, 高+条高, 向下锚点)` ——
> 那句用的是字符串，**不生效**。已改到枚举写法。

### 2. 导出必须带 `asCopy`，否则**改掉用户文档的名字**

```
saveAs.png(entry)          → 文档名 未标题-12 → review-probe-r8-B2.png  🔴 被劫持
saveAs.png(entry, {}, true) → 文档名不变、路径不变                        ✅
```

对「审核版」是硬要求：不带 asCopy 的话，同事交付时**文件名已经被插件改掉了**，
而且这是**文件级属性，历史回退救不回来**。

### 3. 程序化设置中文字体：**四条路全部无效**（本轮唯一的硬缺口）

| 机制 | 写法 | 结果 |
|---|---|---|
| 建层描述符 | `using.textStyleRange[].textStyle.fontName` | ❌ |
| `set textStyle` | `_property:"textStyle"` + `to.fontName` | ❌ |
| 读回写回 | `get textKey` → 改 → `set _target:[{_ref:"textLayer"}]` | ❌ |
| 读回写回补全字段 | 再加 `fontPostScriptName` / `fontStyleName` | ❌ |

**判据不是读回值，是像素**：12 张图（4 条机制的各种组合）文字区 **MD5 完全相同**
（`fdbeb2a5c4ef28c4`），黑像素数也都是 688 ⇒ 全都渲染成同一个默认字体
（读回显示 `Adobe Heiti Std` / `AdobeHeitiStd-Regular`）。

> ⇒ **参数条 v1 只能用 PS 的默认中文字体**。好处是**它一定能出中文**（不会方框），
> 坏处是**不同同事机器上的字体可能不一样**（本机是 Adobe Heiti）。
> 要真正控住字体得**录制**一个「用文字工具改字体」的动作 → 动作面板「复制为 JavaScript」
> —— 这一步**物理上必须有人操作**，是我做不了的（项目铁律允许把这类交给用户）。
>
> 🔴 **顺带的重要影响**：工具箱现有的 **M3a「生成表格」也走同一条 `fontName` 路径**
> （`lib/ps.js` 的 `textLayerBoxDesc`）⇒ **表格里的字体同样从来没生效过**，
> 一直渲染成默认中文字体。这一条要记进 DECISIONS。

---

## 四、附带发现（写代码要照这个来）

1. 🔴 **`set` 类 batchPlay 必须包在模态里**：读 `get` 不需要，但 `set` 会报
   `set may modify the state of Photoshop. Such events are only allowed from inside a modal scope.`
   —— "读能跑"**不能**推断"写能跑"（本轮 R4 第一版就栽在这，差点误判成"改不了背景色"）。
2. 🔴 **Document 上**不**存在**这些方法（别再去找）：
   `export` / `layerTree` / `createGroup` / `createRectangle` / `createEllipse` /
   `createSolidColorLayer` / `createFillLayer` / `createGradientLayer` / `createPatternLayer` /
   `createClippingMask` / `createLayerMask` / **`selectAll`** / **`deselect`** /
   `snapshots` / `transform` / `resize` / `translate` / `flip`。
   > `selectAll` / `deselect` 不在 ⇒ **"用选区把参数条区域框出来单独填白"这条路走不通**，
   > 这也是"白底只能靠背景色 + resizeCanvas"的根本原因。
3. **原型链上真正的 API 面**（level0，65 项）里有几个以后可能有用：
   `suspendHistory`、`duplicateLayers`、`groupLayers`、`linkLayers`、`rasterizeAllLayers`、
   `changeMode`、`convertProfile`、`splitChannels`、`sampleColor`、`countItems`、`backgroundLayer`。
4. **`saveAs` 只有 6 种格式**：`psd / psb / jpg / gif / png / bmp`（没有 tiff / webp / pdf）。
5. `photoshop.constants` 有 **101 个枚举族**（`AnchorPosition` / `SaveOptions` /
   `Justification` / `LayerKind` / `ResampleMethod` / `PNGMethod` / `DocumentFill` …）
   —— **以后需要枚举值时先来这里查，不要拼字符串**（本轮的锚点就是这么找到的）。
6. **`action` 只有 `batchPlay`**：没有 `getDocumentInfo` / `fromJSON` / `validateJSON`。
7. **`core` 没有 `getActiveDocument`**（有 `executeAsModal` / `showAlert` /
   `calculateDialogSize` / `redrawDocument` / `isModal`）。
8. **`new doc + duplicateLayers` 的落位规律**：跨文档复制时图层**按原坐标落位**，
   于是在"更高的目标稿"里，内容自然留在上方、空出的下方就是条位（R12 像素实测）。
   源稿的图层名会变成 `原名 拷贝`；`duplicateLayers([...], targetDoc)` 返回 `[{_id,_docId}]`。

---

## 五、探针自己的坑（保留痕迹，不删）

1. **ASCII 双引号写进中文 JS 字符串** ⇒ `SyntaxError`，一次就废掉 7 处。
   本项目的老坑（v0.7.0 记过一次），**这次又犯**。⇒ 纪律：**JS 字符串里塞中文标点一律用「」。**
   （好在 `node --check` 一秒抓到。）
2. **`set` 没包模态**（见 §四 1），第一轮 R4 因此得出"设背景色失败"的假读数。
   **没有造成污染** —— 因为 set 直接失败了，背景色一直是用户原值。
3. **R4 的物证一开始是"无效证据"**：临时稿本身就是纯白的，扩完还是白的，
   **像素判不出任何东西**（第一版 400×360 全白）。第二轮起改成"内容铺青色、
   新区域是背景色红"，边界才可判。
4. **`R2` 只验了"尺寸变了"就标 PASS** —— 漏掉"新空间落在哪一侧"。
   这是**判据不完整**，靠 R7 补上，并因此推翻了原设计。⇒ 教训：
   **"操作没报错 + 某个量变了"不等于"功能对了"**，要问"我真正要的那个性质变了没有"。
5. **五张物证字节数完全相同（2845）时我就该立刻怀疑** —— 虽然当时是靠 md5/像素才定的案，
   但**"多个变体产出同样大小的文件"本身就是强信号**（不同结果通常不会字节数一致）。
