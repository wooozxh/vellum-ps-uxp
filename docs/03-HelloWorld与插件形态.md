# 03 · Hello World 与两种插件形态

> 建于 2026-10-09。第一个真插件位于 `hello-world/`。
> 它同时是「产品形态未定」这个问题的**实物样本**：一个插件、两个入口。

---

## 一、它是什么

一个最小但完整的 Photoshop 插件 —— 在当前文档插入一个内容为 `Hello World` 的文字图层。
业务上是玩具，工程上是**填满坑位的最小完整件**：manifest v5 + 权限 + 模态 + batchPlay + 双入口 + 日志通道。

```
hello-world/
├── manifest.json    manifest v5；两个 entrypoint（panel + command）
├── index.html       面板 UI（用 UXP 内置 Spectrum 组件，零外部依赖、零构建）
└── index.js         全部逻辑与注释
```

manifest 里的两个入口：

| 入口类型 | id | 在 PS 里的位置 |
|---|---|---|
| `panel` | `helloWorldPanel` | 常驻面板，在「窗口」菜单下的插件面板区 |
| `command` | `insertHelloWorld` | 菜单命令，点一下直接执行，**不打开面板** |

两者**共用同一份代码**：面板按钮和菜单命令最后都调用 `actionInsert(who)`，
只有 `who` 不同（`panel` / `command`）—— 这个参数会写进日志，便于分辨是谁触发的。

---

## 二、Panel 与 Command 的差别（本轮的主要目的）

这是 Adobe 官方定义的两种插件形态，**选错会直接影响后面所有工作**：

| | **Panel（常驻面板）** | **Command（菜单命令）** |
|---|---|---|
| 形态 | 面板，可停靠也可浮动 | 菜单里的一项 |
| 用户路径 | 打开面板 → 操作 → 看着结果 | 点菜单/按快捷键 → 执行完即结束 |
| 有 UI 吗 | 必须有 | 可以完全没有 |
| 状态 | 面板活着，能记住上次的选择 | 无状态，每次从零开始 |
| 适合 | 需要反复调参、需要看实时状态、复杂工作流 | 一次性的确定动作、需要快捷键、批处理的一环 |
| 开发成本 | 高（要设计界面、处理布局与主题） | 低（可以只有几十行逻辑） |
| 用户感知 | 「工具箱里的一个工具」 | 「一个动作」 |

**怎么选 —— 用一句话回答自己**：

> 用户会不会**反复地**用它，并且**需要看着点什么**？
> 会 → Panel。不会 → Command。

举几个判断例子：

- 「一键导出所有图层为 PNG」→ Command（点完就走，不需要面板）
- 「批量重命名图层」→ Command 就够了（除非要预览改名规则，那就 Panel）
- 「调色辅助：显示当前色值、可微调、实时预览」→ Panel（要看着调）
- 「素材库：浏览、搜索、拖入画布」→ Panel（要浏览）

**还有第三条路：两个都要。** 这正是 `hello-world` 现在的样子 ——
一个复杂功能常拆成「面板用来操作 + 命令用来触发常用动作」，例如面板里配好参数后，
命令给这个配置绑一个快捷键。

---

## 三、怎么用

加载（已实测可用，幂等 —— 重复执行等于重新加载）：

```bash
cd D:\ps-uxp-dev
tools\uxp.cmd plugin load --manifest hello-world\manifest.json
```

然后在 Photoshop 里找：

- **面板**：在「窗口」菜单里找 `Hello World`（不同中文版本可能译作「插件」/「扩展功能」下的面板）
- **命令**：在插件/增效工具菜单里找 `Hello World：插入文字图层`

> 📌 实测确认：面板的「插入」按钮已被实际点击并成功执行
> （`boot.log` 里留下了 `insert via=panel doc=晋升公告.psd layers=11` 的记录）。

---

## 四、反馈通道：boot.log

**这是本插件对 vibecoding 最有价值的部分。**

UXP 跑在 Photoshop 进程里，`console.log` 只有调试窗口能看到，外部脚本读不到。
所以插件把关键事件**追加写入自己的数据目录**：

```
%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.wooozxh.helloworld\PluginData\boot.log
```

格式（每行一条）：

```
2026-10-09 22:46:52  loaded  plugin=com.wooozxh.helloworld  uxp=uxp-9.0.2-uxp1-e0d9ef0
2026-10-09 22:47:15  insert  via=panel  doc=晋升公告.psd  layers=11
```

于是形成了**双向闭环**：

| 方向 | 手段 |
|---|---|
| AI → 插件 | 改代码 → `plugin load` → 插件执行 |
| 插件 → AI | 插件写 `boot.log` → AI 读文件 |

这意味着：**用户在面板上点了什么、成功还是失败，AI 都能读到** ——
不需要截图、不需要用户复述。

> ⚠️ UXP 插件只能把数据写到 APPDATA（Adobe 硬编码），所以这个文件与项目放在哪个盘无关。

---

## 五、开发期自检：verify.flag

插件目录下若存在 `verify.flag`，则**每次加载插件都会跑一次无痕演练**：

1. 新建临时文档 640×400
2. 插入文字图层
3. 读回图层列表，确认 `Hello World` 在里面
4. **关闭临时文档（不保存）** —— 不留任何痕迹
5. 结论写进 `boot.log`（`selfverify ok=true layers=["Hello World","背景"] cleaned=yes`）

用途：**在用户点按钮之前，先确认这批 batchPlay 描述符在当前 PS 版本上真的成立**。
开关放文件而不是代码，是为了让 AI/脚本能一键开关。

```bash
# 开启
type nul > hello-world\verify.flag
# 关闭
del hello-world\verify.flag
```

`verify.flag` 已在 `.gitignore` 中排除（属本地行为开关，不入库）。

---

## 六、下一步

环境、工具链、闭环、档案、仓库都已就绪，`hello-world` 也跑通了。
**现在唯一能推动项目的事是确定产品形态** —— 请回答：

1. 想解决什么场景？谁用、在什么工作流里、现在的痛点是什么？
2. 看完上面那张 Panel / Command 对比表，偏向哪一个？（或两个都要）
3. 要不要上框架？（vanilla JS 起步 vs React / Svelte / TS —— 建议先 vanilla 跑通再决定）

答完这三点，我会产出 `docs/04-产品方案.md`，确认后才开始写业务代码。
