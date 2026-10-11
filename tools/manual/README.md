# tools/manual · 插件用户手册的工具链

手册本体在 `docs/manual/`。这里只放**生成与体检用的脚本**，跟软件侧 `D:\proj_media\tools\manual\`
同一套路数（那份是 Node，这份是 Python —— 因为本机跑 Node 起子进程会被沙箱挡）。

## 文件

| 脚本 | 干什么 |
|---|---|
| `shoot_win.py` | **抓 Windows 窗口截图 / 模拟点击**（Python + ctypes 直调 user32/gdi32） |
| `prep_images.py` | 把抓到的原始截图整理成手册用图（改名 / 裁剪 / 放大）到 `docs/manual/images/` |
| `shoot_html.py` | 生成"分段渲染"的手册临时副本（把前 N 个内容块隐藏），供无头浏览器逐段截图核对版式 |
| `make_single.py` | 把 `index.html` 打成**自包含单文件**（CSS 内联 + 图片 base64） |
| `check.py` | **手册一致性体检**：版本号 / 目录对账 / 图片 / 标签配对 / 类名白名单 / 产物新鲜度 |

## 为什么不用现成的窗口截图方案

本机有三重限制，现成的 `.ps1` 截图脚本和经验全都用不上：

1. **shell 执行策略禁 `.ps1`**（"在此系统上禁止运行脚本"）；
2. **内联 `Add-Type` 被安全策略拦**（"compiles and loads .NET code at runtime"）；
3. **Python 起不了子进程**（沙箱，`spawnSync` 报 EBUSY）。

⇒ 所以 `shoot_win.py` 用 **ctypes 直调 user32/gdi32**，一条命令一个动作。

## 用法

```bash
PY=C:/Users/<你>/.workbuddy/binaries/python/envs/default/Scripts/python.exe

# 找窗口（PS 会有很多可见窗口，UXP 面板那个是独立的顶层窗口，约 422×732）
"$PY" tools/manual/shoot_win.py rect --pid <PhotoshopPID>
"$PY" tools/manual/shoot_win.py capture --pid <PID> --index 27 --out <目录> --tag panel
"$PY" tools/manual/shoot_win.py click  --pid <PID> --index 27 --x 160 --y 268
"$PY" tools/manual/shoot_win.py keys   --pid <PID> --index 0  --combo ctrl+1
```

## 踩过的坑（都会让"看起来做了"其实没做）

- 🔴 **UXP 面板是一个独立顶层窗口**，不在 PS 主窗口的 `PrintWindow` 结果里
  ⇒ 要么单独截它（推荐，深色原生、无裁切），要么用屏幕拷贝再裁。
- 🔴 **`SetForegroundWindow` 之后的第一发点击会被"窗口激活"吃掉**（第一次点面板某一行毫无反应）
  ⇒ **先在空白处点一下"预热"，第二次点击才生效**。
- **滚轮不能当缩放用**（PS 默认没开"用滚轮缩放"）；要放大画布用 `Ctrl+1`（实际像素）。
- `PrintWindow` 对 GPU 合成的窗口有时返回**整幅黑图** ⇒ 脚本内置"全黑则回退 `BitBlt`"。
- **Edge 无头截图必须带 `--user-data-dir`**，且命令返回是异步的（要 sleep 再确认产物）。
- Edge 无头截图**固定从文档顶部截**，`window.scrollTo` 不生效（实测 8 张全是同一张白图）
  ⇒ 分段核对版式要用 `shoot_html.py` 把前面的块 `display:none`。

## 体检与产物

```bash
"$PY" tools/manual/check.py          # 退出码 0 = 没问题
"$PY" tools/manual/make_single.py    # 重建单文件版
```

`.pdf` 与 `*单文件*.html` **不入库**（脚本可重建），与软件侧口径一致。
生成 PDF：

```bash
"<Edge>/msedge.exe" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="docs/manual/Vellum工具箱-插件使用手册.pdf" \
  "file:///D:/ps-uxp-dev/docs/manual/index.html"
```

📌 写 `check.py` 时自己踩的一个坑：**分析目录与类名之前必须先摘掉 `<script>`** ——
否则脚本里的模板字符串 `'<a href="#' + x.id + '">'` 会被正则当成真的目录项。
