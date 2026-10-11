# -*- coding: utf-8 -*-
"""把 index.html 打成一个自包含单文件（CSS 内联 + 图片 base64），便于直接发给同事。

对齐软件侧 docs/manual/make_single.py 的做法：整份手册只要能双击打开就行，
不依赖同目录的 images/ 与 manual.css。
"""
import base64
import os
import re

MAN = r"D:\ps-uxp-dev\docs\manual"
SRC = os.path.join(MAN, "index.html")
CSS = os.path.join(MAN, "manual.css")
OUT = os.path.join(MAN, "Vellum工具箱-插件使用手册（单文件）.html")

html = open(SRC, "r", encoding="utf-8").read()
css = open(CSS, "r", encoding="utf-8").read()

# 1) 外链样式 → 内联 <style>
html = html.replace(
    '<link rel="stylesheet" href="manual.css" />',
    "<style>\n" + css + "\n</style>",
)

# 2) 图片 → data URI
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}
used = []


def inline(m):
    rel = m.group(1)
    p = os.path.join(MAN, rel.replace("/", os.sep))
    if not os.path.exists(p):
        print("!! 缺图", rel)
        return m.group(0)
    ext = os.path.splitext(p)[1].lower()
    b64 = base64.b64encode(open(p, "rb").read()).decode("ascii")
    used.append(rel)
    return 'src="data:%s;base64,%s"' % (MIME.get(ext, "application/octet-stream"), b64)


html = re.sub(r'src="(images/[^"]+)"', inline, html)
open(OUT, "w", encoding="utf-8").write(html)
print("单文件已生成：%s（%.1f MB，内联 %d 张图）" % (OUT, os.path.getsize(OUT) / 1048576, len(used)))
for u in used:
    print("   inlined", u)
