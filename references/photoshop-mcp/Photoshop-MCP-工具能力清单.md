# Photoshop MCP 工具集能力清单

**版本**：@alisaitteke/photoshop-mcp 1.7.32 ｜ **工具总数**：127 个 + 23 个提示词模板
**适用环境**：本机已装 Photoshop 2026（D 盘），通过 ExtendScript 通道通信
**清单来源**：直接读取服务端 `tools/list` 返回值解析生成，非文档转载

---

## 0. 阅读前须知

**工具命名规则**：`photoshop_<动作>_<对象>`。前缀 `recipe_` 的是"配方"——**多步操作打包成一次调用、一次撤销**，是做业务流水线时最该用的工具。

**`document_id` 参数**：几乎所有工具都带这个参数。传 `null` = 操作当前活动文档；传具体 id = **先切换**到那个文档再执行。多文档并行时必传，否则会误改别的稿子。

**破坏性标记**：MCP 协议里带 `destructiveHint: true` 的工具共 **43 个**（见第 12 节）。这类工具会改像素、删图层、写磁盘，用之前需要人工确认。

**只读工具**：官方标记为只读的仅 10 个（见第 13 节）。其余即使不改像素，也可能切换活动文档/图层这类"轻副作用"。

---

## 1. 会话与文档（12）

| 工具 | 作用 | 破坏性 |
|---|---|---|
| `ping` | 验证 PS 脚本引擎可用（会话开始必调） | 否 |
| `get_version` | 读 Photoshop 版本号 | 否 |
| `get_document_info` | 读当前文档的尺寸、分辨率、色彩模式 | 否 |
| `list_documents` | 列出所有打开的文档及 id | 否 |
| `set_active_document` | 按 id / 索引 / 名称切换活动文档 | 否 |
| `create_document` | 新建文档（宽、高、dpi、RGB/CMYK/灰度） | 否 |
| `open_image` | 打开图片文件为新文档 | 否 |
| `place_image` | 把外部图片作为新图层置入当前文档（可指定坐标） | 否 |
| `save_document` | 保存为 PSD / JPEG / PNG 到指定路径 | **是** |
| `export_as` | 导出副本为 PNG / JPEG / **WebP / AVIF**，不影响原文档 | 否 |
| `close_document` | 关闭文档标签页 | **是** |
| `submit_feedback` | 回应产品的反馈询问（可不用） | 否 |

**注意**：`create_document` 只接受**像素**尺寸。要做毫米稿（如 A4 出血稿），得用第 14 节的脚本套路。

---

## 2. 图层管理（23）

| 工具 | 作用 | 破坏性 |
|---|---|---|
| `create_layer` | 在活动层上方新建空图层 | 否 |
| `delete_layer` | 删除活动图层（含像素、蒙版、效果） | **是** |
| `get_layers` | 列出图层树（类型、可见性、不透明度） | 否 |
| `select_layer_by_name` | 按名称精确选中图层（含组内） | 否 |
| `rename_layer` | 重命名活动图层 | 否 |
| `duplicate_layer` | 复制活动图层 | 否 |
| `set_layer_opacity` | 设不透明度 0–100（绝对值，非增量） | 否 |
| `set_layer_blend_mode` | 设混合模式（27 种，含 COLOR 着色） | 否 |
| `set_layer_visibility` | 显示 / 隐藏 | 否 |
| `set_layer_locked` | 锁定 / 解锁图层 | 否 |
| `move_layer_up` / `move_layer_down` | 图层上移 / 下移一位 | 否 |
| `move_layer_to_top` / `move_layer_to_bottom` | 移到顶层 / 底层 | 否 |
| `move_layer_to_position` | 移到指定命名图层的上 / 下 / 顶 / 底 | 否 |
| `merge_visible_layers` | 合并所有可见层（隐藏层保留） | **是** |
| `flatten_image` | 拼合文档为单层（丢弃隐藏层） | **是** |
| `rasterize_layer` | 栅格化文字/智能对象层 | **是** |
| `convert_to_smart_object` | 转为智能对象 | 否 |
| `create_smart_object_via_copy` | 建立**独立**智能对象副本（不共享内容） | 否 |
| `replace_smart_object_contents` | **替换智能对象内容**（保留变换/滤镜）——样机套图核心 | **是** |
| `edit_smart_object_contents` | 打开内嵌 .psb 编辑 | 否 |
| `apply_layer_style` | 加图层样式（投影、外发光、描边、斜面和浮雕） | 否 |

---

## 3. 绘制与填充（2）

| 工具 | 作用 | 破坏性 |
|---|---|---|
| `fill_layer` | 活动图层填充纯色。**有选区时只填选区** | **是** |
| `fill_gradient` | 活动图层填充双色线性渐变（4 个方向） | **是** |

**注意**：文字层不能直接填色，要先 `set_text_color` 或先栅格化。智能对象会被就地栅格化。

---

## 4. 画布与几何变换（11）

| 工具 | 作用 | 破坏性 |
|---|---|---|
| `resize_image` | 重采样**整个文档**到新的像素宽高（双三次） | **是** |
| `crop_document` | 按像素矩形裁切文档 | **是** |
| `fit_layer_to_document` | 图层自动适配画布（`fillDocument:false` 留白 / `true` 铺满裁切） | **是** |
| `scale_layer` | 按百分比缩放图层（可选中心/左上锚点） | **是** |
| `move_layer` | 按偏移量移动图层 | 否 |
| `rotate_layer` | 旋转图层（正值顺时针），画布不跟着转 | **是** |
| `image_stack` | 多图载入同一文档 → 转智能对象 → 应用堆栈模式（平均/中值等），做**矩阵合成去噪** | 否 |
| `list_artboards` | 列出画板及像素范围 | 否 |
| `create_artboard` | 新建画板 | 否 |
| `set_active_artboard` | 按 id / 名称选中画板 | 否 |
| `export_artboards` | 把每个画板分别导出到文件夹 | 否 |

---

## 5. 文字与排版（9）

| 工具 | 作用 | 破坏性 |
|---|---|---|
| `create_text_layer` | 建文字层（内容、坐标、字号、字体、**字间距、行高、段落框、对齐、颜色**） | 否 |
| `list_fonts` | 列出 PS 可用字体 | 否 |
| `install_font` | 装字体文件并即时重载字体列表（**不用重启 PS**） | 否 |
| `set_text_font` | 改字体族与字号 | 否 |
| `set_text_color` | 整个文字层设一种 RGB 色 | 否 |
| `set_text_alignment` | 设置对齐（LEFT → FULLYJUSTIFIED） | 否 |
| `update_text_content` | 替换文字内容（保留字体/颜色/对齐）——**模板批产核心** | 否 |
| `set_text_style` | 层级排版：字间距、行高、点文字/段落文字 | 否 |
| `set_text_ranges` | **层内混排**：对一段文字里的不同片段设不同字体/字号/颜色 | 否 |

**中文用户必看**：建中文字必须显式传 `fontName: "MicrosoftYaHei"`，默认字体的中文字形可能缺失。

---

## 6. 选区与蒙版（17）

| 工具 | 作用 | 破坏性 |
|---|---|---|
| `select_all` | 全选 | 否 |
| `deselect` | 取消选区（不改像素） | 否 |
| `invert_selection` | 反选 | 否 |
| `select_rectangle` | 按角点坐标建矩形选区 | 否 |
| `select_ellipse` | 建椭圆选区（抗锯齿） | 否 |
| `select_subject` | **选择主体**（像素级选区，不建蒙版） | 否 |
| `get_selection_bounds` | 读当前选区的像素范围 | 否 |
| `expand_selection` | 选区外扩 N 像素 | 否 |
| `contract_selection` | 选区收缩 N 像素 | 否 |
| `feather_selection` | 选区羽化 | 否 |
| `save_selection` | 选区存为 Alpha 通道 | 否 |
| `create_layer_mask` | 用当前选区**建图层蒙版**（非破坏性抠图） | 否 |
| `delete_layer_mask` | 删除图层蒙版 | **是** |
| `apply_layer_mask` | 蒙版烘焙进像素并删除蒙版 | **是** |
| `apply_gradient_mask` | 蒙版上涂黑白渐变（渐隐融合） | **是** |
| `create_clipping_mask` | 建立剪贴蒙版 | 否 |
| `release_clipping_mask` | 释放剪贴蒙版 | 否 |

---

## 7. 调整与调色（12）

亮度对比度、色相饱和度、曲线、自然饱和度、曝光、照片滤镜、渐变映射、颜色查找（3D LUT）、自动色阶、自动对比度、去色、反相。
其中**曲线 / 自然饱和度 / 曝光 / 照片滤镜 / 渐变映射 / LUT 是新建调整图层**（非破坏性），其余是直接改像素。

---

## 8. 滤镜（6）

高斯模糊、USM 锐化、添加杂色、动感模糊、高反差保留、特殊模糊。
全部作用于活动栅格图层，属直接改像素。

---

## 9. AI 与生成式（8）

| 工具 | 作用 | 代价 |
|---|---|---|
| `generative_fill` | 生成式填充（Firefly，按提示词） | 消耗 Adobe 生成积分 |
| `generative_remove` | AI 移除（"移除工具"或生成式兜底） | 同上 |
| `generative_expand` | 生成式扩展画布 | 同上 |
| `generative_upscale` | 生成式放大（需 PS 27+） | 同上 |
| `generate_image` | Firefly ImageGen 直接由提示词出图 | 同上 |
| `sky_replacement` | PS 原生换天空 | 否 |
| `neural_filter` | 调用神经滤镜（需配套 UXP 桥接插件 + 本地端口） | 否 |
| `content_aware_fill` | 内容识别填充（非 AI 积分） | 否 |

---

## 10. 数据驱动批产（3）

| 工具 | 作用 |
|---|---|
| `list_datasets` | 列出文档已定义的数据集（图像 > 变量） |
| `import_datasets` | 导入数据组 XML（同 PS 的"导入数据组"） |
| `generate_from_datasets` | **按每个数据集批量出图**：逐个应用 → 存副本 → 下一步 |

配套的是配方里的 `recipe_csv_to_cards`——**直接从 CSV 生成数据集**，这条链是"Excel 驱动批量出稿"的完整实现。

---

## 11. 执行、历史与逃生舱（5）

| 工具 | 作用 | 说明 |
|---|---|---|
| `play_action` | 播放动作面板里指定动作集下的动作 | **复用设计师已录好的动作，绕开底层命令格式** |
| `execute_script` | 执行任意 ExtendScript（JSX） | 兜底手段，用不到的工具能力都能自己写 |
| `undo` / `redo` | 逐步撤销 / 重做 | 对应 Ctrl+Z / Ctrl+Shift+Z |
| `get_history` | 读历史记录栈及当前所处状态 | 只读 |

---

## 12. 状态感知（3）

| 工具 | 作用 |
|---|---|
| `get_state` | 轻量快照：活动文档、图层、选区、所有打开的文档 |
| `get_preview` | 导出 JPEG 预览图（Base64），**用于每步操作后回读确认** |
| `get_capabilities` | 版本相关的功能开关（选择主体 v2、生成式填充是否可用等） |

这三个是"AI 能看见自己在干什么"的关键，也是这套工具比单纯脚本可靠的原因。

---

## 13. 配方（16 个）——业务流水线首选

配方 = 多步操作打包，**一次调用、一次撤销**。

| 配方 | 作用 | 明显用途 |
|---|---|---|
| `recipe_remove_background` | 抠图去背（非破坏性） | 电商主图 |
| `recipe_csv_to_cards` | **CSV 驱动批量生成卡片** | 工牌 / 会员卡 / 证书 |
| `recipe_batch_mockup_replace` | 遍历文件夹，逐个替换智能对象内容 | 批量样机套图 |
| `recipe_batch_watermark` | 整文件夹批量加水印并导出 JPEG | 交付加水印 |
| `recipe_export_social_variants` | 按平台各出一版 JPEG（不同尺寸） | 一套稿出全平台 |
| `recipe_prepare_for_web` | Web 优化导出：转 sRGB + 降采样 + 锐化 | 网站素材 |
| `recipe_passport_photo` | 证件照：去背 + 换底 + 排版尺寸 | 员工证件照 |
| `recipe_split_carousel` | 宽图等分成 N 条竖切片并顺序导出 | 小红书 / IG 组图 |
| `recipe_apply_color_grade` | 电影感/复古/青橙等 6 种预设调色（调整图层组） | 统一色调 |
| `recipe_enhance_portrait` | 人像精修：建频率分离双图层结构 | 人像后期 |
| `recipe_frequency_separation` | 建频率分离堆栈（低频 + 高频） | 手动精修底子 |
| `recipe_dodge_burn` | 一键建 50% 灰的减淡加深层 | 影调塑形 |
| `recipe_gradient_fade` | 蒙版上涂渐变，让图层融进背景 | 合成过渡 |
| `recipe_sky_blend` | 换天空合成：置入天空图 + 蒙版 + 地平线 | 风景合成 |
| `recipe_remove_distraction` | 去除杂物（AI 优先，内容识别兜底） | 商品图清场 |
| `recipe_organize_layers` | 整理图层：统一命名规范 + 可选分组 | 收稿规范化 |

---

## 14. 覆盖部门场景的对照表

| 部门需求 | 用哪些工具 |
|---|---|
| 批量素材处理（抠图/裁切/加水印/导出） | `recipe_remove_background` + `resize_image` + `recipe_batch_watermark` + `recipe_export_social_variants` |
| PSD 模板批产（按名单出物料） | `recipe_csv_to_cards` / `import_datasets` + `generate_from_datasets` + `replace_smart_object_contents` + `update_text_content` |
| 样机批量套图 | `recipe_batch_mockup_replace` |
| 规范体检 + 一键修正 | `get_state` / `get_layers` / `get_capabilities` 读现状 + `recipe_organize_layers` 修正 + `execute_script` 补充自定义规则 |
| 复用设计师既有动作 | `play_action` |
| 尺寸/格式交付规范 | `export_as`（含 WebP/AVIF）+ `recipe_prepare_for_web` + `save_document` |
| 多稿并行处理 | `list_documents` + `set_active_document` + 所有工具的 `document_id` |

---

## 15. 43 个破坏性工具（操作前需确认）

```
save_document, close_document, delete_layer, fill_layer, fill_gradient,
resize_image, crop_document, replace_smart_object_contents, fit_layer_to_document,
scale_layer, rotate_layer, rasterize_layer, merge_visible_layers, flatten_image,
apply_gaussian_blur, apply_sharpen, apply_noise, apply_motion_blur,
apply_high_pass, apply_smart_blur, adjust_brightness_contrast,
adjust_hue_saturation, auto_levels, auto_contrast, desaturate, invert,
delete_layer_mask, apply_layer_mask, content_aware_fill, apply_gradient_mask,
play_action, execute_script, undo, redo, generative_fill, generative_remove,
generative_expand, generative_upscale, sky_replacement, neural_filter,
recipe_batch_mockup_replace, recipe_gradient_fade, recipe_remove_distraction
```

**策略建议**：把这类工具统一包一层"预览 → 确认 → 执行"，并且**永远先对副本操作**，不要直接动源文件。

## 16. 10 个只读工具（可安全自由调用）

```
get_version, get_document_info, get_layers, list_fonts, get_selection_bounds,
get_history, get_state, get_capabilities, list_datasets, list_artboards
```

---

## 17. 实测踩坑记录（本机 PS 2026）

1. **`Units.MILLIMETERS` 无效**——设标尺单位会报"无效枚举值 (1320)"，必须用 `Units.MM`。
2. **DOM 的 `selection.fill()` 同样报枚举错**——填色改用 `fill_layer` 工具，别写脚本。
3. **`ActionDescriptor.getKeys()` 不存在**——无法遍历 AM 描述符的键。
4. **Background 图层无法脚本改名**（静默失败）。
5. **文字层 y 坐标有约 100px 偏移**——不要信输入坐标，读回 `bounds` 再校正。
6. **参考线不会出现在导出图中**（非像素内容），只能在 PS 界面按 `Ctrl+;` 校验。
7. **`create_document` 只吃像素**——做毫米稿要用 `execute_script` 配 `UnitValue`。
8. **`npx` 首次运行需 30–60 秒**下载依赖，之后走缓存。
