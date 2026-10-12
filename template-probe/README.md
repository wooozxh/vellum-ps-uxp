# Template Probe · 「建稿模板 / 出图体检」能力探针

> 建于 2026-10-12。回答一个问题：**我们规划的那套「建稿模板 + 出图体检」，
> 依赖的 UXP 能力到底成不成立？**
> 结论：**7 通过 / 0 失败 / 1 无结论**（真机 PS 27.2 / UXP 9.0.2）。

配套方案：`docs/49-出图体检与建稿模板-方案.md`
报告归档：`probe-report-2026-10-12.json`

---

## 一、怎么跑

```bash
# 终端 A：常驻服务（会一直占着，别关）
D:\ps-uxp-dev> tools\uxp.cmd service start

# 终端 B：加载探针（插件目录下有 autorun.flag ⇒ 加载即自动跑一遍）
D:\ps-uxp-dev> tools\uxp.cmd plugin load --manifest <本仓库>\template-probe\manifest.json

# 读结论（结构化）
node tools/report.mjs
```

探针会把结论写进自己的数据目录，外部脚本直接读：

```
%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.wooozxh.templateprobe\PluginData\report.json
```

面板名 **Template Probe**（窗口菜单里），有「运行探针并写报告」按钮。

> ⚠️ 探针会自己建 8 个临时文档、跑完全部关掉（`cleanup` 字段逐条记录）。
> **不会碰你已打开的稿子** —— 这一点在报告里可核对。

---

## 二、实测矩阵（PS 27.2 / UXP 9.0.2，2026-10-12 22:53）

| # | 能力 | 结果 | 关键读数 |
|---|---|---|---|
| C1 | `presetJSON` 基线（不带 guides）+ 体检字段真实形态 | ✅ | 800×600@300dpi 精确回读 |
| **C2** | ★ **`presetJSON` 能否携带 `guides`** | ✅ | **传 4 条、回读 4 条** |
| C3 | `presetJSON` + CMYK 模式 | ✅ | `mode=CMYKColorMode`、`Japan Color 2001 Coated` 生效 |
| **C4** | ★ `activeHistoryState` 可写（整批撤销地基） | ✅ | 图层数 1 → 2 → **1** |
| C5 | `duplicateLayers` 跨文档复制图层 | ✅ | B 的图层 `[背景]` → `[TP-SRC-LAYER, 背景]` |
| C6 | 文字层字体名的读取路径 | ✅ | **`textItem.characterStyle.font`** |
| C7 | 文字溢出检测 | ⚠️ **无结论** | DOM 建不出段落文字 |
| C8 | `app.fonts` 的形态（字体缺失检测用） | ✅ | `length=583` |

**合计 7 / 8 明确通过，1 项无结论（不是失败）。**

---

## 三、附带发现（比"通过/失败"更有用）

1. **体检字段的真实形态**（写体检代码要照着这个解析）：
   `doc.mode` = `"RGBColorMode"` / `"CMYKColorMode"`；
   `doc.bitsPerChannel` = `"bitDepth8"`；
   `doc.colorProfileType` = `"workingSpaceCode"`；
   `doc.colorProfileName` = 普通字符串；`doc.saved` 布尔。
2. 🔴 **`presetJSON` 里的 `name` 字段被忽略** —— 传了名字，回读仍是「未标题-3」。
   ⇒ 文档命名必须走 `createDocument` 的 `name` 参数，别指望 presetJSON。
3. 🔴 **C2 留了一个缺口**：`doc.guides[i]` 只回 `{"_id":…,"_docId":…}`，
   **读不到 direction / coordinate** ⇒ **无法从文档反查"出血距边缘几毫米"**。
   影响：出血量只能靠 ① 模板定义（我们自己写的，本来就知道）或 ② 弹窗问人。
4. **`app.fonts` 就是字体集合本身**（`length=583`），**没有 `getFontList()`**。
   每项形态 `{_family,_name,_postScriptName,_style,_parent}`
   ⇒ 字体缺失检测＝拿稿里的字体名去比对 `_postScriptName` / `_family`。
5. **`createTextLayer` 建不出段落文字**：试了 `kind` / `type` / `paragraphText` + `width,height`
   共 4 种写法，`textItem.isParagraphText` **恒为 false**，排版选项被静默忽略。
6. `textKey`（走 batchPlay 读）信息远比 DOM 丰富：顶层键含
   `bounds / boundingBox / textShape / textStyleRange / paragraphStyleRange / kerningRange /
   textClickPoint / textGridding`。

---

## 四、探针自己的三处错判（保留痕迹，不删）

本项目的老规矩：**工具会骗人，记录比掩饰有用。**

1. **第一版 C2 / C8 报 `Cannot convert a Symbol value to a string`，我差点当成"能力失败"。**
   实为探针 bug：**不要对 UXP 原生对象调用 `Object.prototype.toString.call(x)`** ——
   它内部会读 `x[Symbol.toStringTag]`，而 UXP 原生绑定访问 Symbol 键时会抛。
   已改为 `describeNative()`（只用 `typeof` + 逐项 `try/catch`，绝不碰 Symbol）。
   > 教训：**报错要先分清"被测对象不行"还是"我的量法不行"。**

2. **第一版 C7 只建了「点文字」就断言无结论 —— 测错了对象。**
   点文字根本没有"文本框"这个概念，谈不上"溢出文本框"。第二版改成试建段落文字，
   才查出真正原因：**DOM 根本建不出段落文字**。

3. **我一度把 C7 判成 PASS**，判据是"能读到两条范围读数" —— **判据太松，属于过度声称**。
   那两条读数（`layer.bounds` 像素 / `textKey.bounds` 点）都是"文字自身范围"的不同表达，
   **不是**「框 vs 内容」，不能当溢出判据。已改回诚实的 INCONCLUSIVE。

---

## 五、对方案的意义

| 结论 | 意味着 |
|---|---|
| C2 通过 | **「建稿时自动写入出血参考线」这条路成立** ⇒ 整套模板闭环保住了 |
| C4 通过 | **「整批撤销」成立** ⇒ 所有批量功能的地基有了 |
| C5 通过 | **PSD 模板库（logo / 背景等部件）可行** |
| C6 + C8 通过 | **字体缺失检测可行** |
| C2 的缺口 | 出血量**不能从文档反查** ⇒ 设计上必须靠"模板定义"或"弹窗回答" |
| C7 无结论 | **文字溢出检测暂不可做**；要做得先解决"用 batchPlay 建段落文字"，
  且描述符**必须录制，不许猜**（项目纪律） |
