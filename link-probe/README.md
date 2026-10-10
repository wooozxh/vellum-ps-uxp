# Link Probe · 插件侧「联动能力」探针

> 建于 2026-10-10。回答一个问题：**UXP 插件到底能不能和本地服务实时联动？**
> 结论：**能。** 实测矩阵见下。配套服务 `tools/linkprobe/server.mjs`（零依赖，本地 127.0.0.1:8799）。

---

## 一、怎么跑

```bash
# 终端 A：起配套服务（会一直占着，别关）
node tools/linkprobe/server.mjs

# 终端 B：加载探针插件（加载即自动跑一遍）
tools\uxp.cmd plugin load --manifest link-probe\manifest.json

# 读结论（结构化）
node tools/report.mjs
```

探针会把结论写进自己的数据目录（`report.json` + `boot.log`），外部脚本可直接读：

```
%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\Developer\com.wooozxh.linkprobe\PluginData\
```

面板名 **Link Probe**（窗口菜单里），有「重新运行探针」按钮。

---

## 二、实测矩阵（PS 2026 v27.2 / UXP 9.0.2，2026-10-10）

| # | 能力 | 结果 | 证据 |
|---|---|---|---|
| 1 | `fetch` 本地 HTTP 的 JSON | ✅ | `status=200 bytes=237 items=3` |
| 2 | `<img>` 直连 HTTP 图片 | ✅ | `naturalWidth=96 naturalHeight=96` |
| 3 | 内嵌 `data:` URL 图片（对照项） | ✅ | `naturalWidth=1` |
| 4 | `fetch`→`blob`→`URL.createObjectURL`→`<img>` | ✅ | `blob=19485B → 96×96` |
| 5 | `WebSocket` 连接本地服务并收**主动推送** | ✅ | 收到 `{"type":"library-changed",...}` |
| 6 | 本地磁盘图片 `file://` 直接给 `<img>` | ❌ | `onerror`（被明确拒绝） |

**合计 5 / 6。** 第 6 项失败 = 「插件直接用 `file://` 显示任意磁盘图片」这条路不通。

---

## 三、踩到的两个坑（务必记住）

### 坑 1：`display:none` 的容器里，UXP **不会加载图片**

第一版把测试图片塞进 `<div id="sink" style="display:none">`，结果所有图片测试**全部超时**
（连 `onerror` 都不触发，极易误判成"网络被拒"）。把该容器改成**可见**后立刻全部通过。
→ **要显示图片，承载它的 DOM 必须可见。**

### 坑 2：`network.domains` 写 localhost / IP **不生效**，只能写 `"all"`

```
"network": { "domains": ["http://127.0.0.1:8799"] }        ❌ Manifest entry not found
"network": { "domains": ["http://127.0.0.1:8799/"] }       ❌ Manifest entry not found
"network": { "domains": ["http://127.0.0.1", "localhost"] }❌ Manifest entry not found
"network": { "domains": "all" }                            ✅ 全部通过
```

这是 Adobe 侧的已知缺陷（官方论坛与文档仓库都有记录：localhost/127.0.0.1 匹配存在 bug，
`domains` 数组在若干版本里解析异常）。**本机 UXP 9.0.2 实测确认：只有字符串 `"all"` 可靠。**
→ 代价：插件将获得"访问任意网络域名"的权限。对内网工具可接受，需在方案里写明。

> 顺带确认：官方文档示例里的**图片直连**写法（`<img src="https://...">`）在本机同样成立 ——
> 只要域名被授予权限，缩略图走 HTTP 完全可行。

---

## 四、这对路线选择意味着什么

- **路线 C（本地联动服务 HTTP + WebSocket）三项核心能力全部验证通过** → 可行，推荐。
- **路线 A/B（插件直读工作区磁盘）** 的"显示"一环卡在 `file://` 被拒；
  理论上可改走「UXP storage 读文件 → Blob → objectURL」绕开（objectURL 已证可用，见第 4 项），
  但**这一环尚未实测**，若要回归 A/B 须先补一环探针。

详见 `docs/10-产品方案.md` 第十节。
