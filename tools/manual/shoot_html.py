# -*- coding: utf-8 -*-
"""生成手册的分段渲染副本：把前 N 个内容块 display:none，让截图从指定位置开始。

为什么不用 scrollTo：headless=new 的 --screenshot 固定从文档顶部截，`window.scrollTo`
在截图前不生效（实测 8 张全是同一张白图）⇒ 改成**物理移走前面的块**。
⚠️ 只生成文件，不调 Edge（本环境起不了子进程），截图由 shell 完成。
"""
import os

SRC = r"D:\ps-uxp-dev\docs\manual\index.html"
OUT = r"C:\Users\17736\WorkBuddy\vellum_PS_uxp_dev\.tmp"

BLOCKS = ("header.cover, .wrap > div > section, .wrap > div > .chapterhead, .wrap > div > footer")

html = open(SRC, "r", encoding="utf-8").read()
# 临时副本在别的目录 ⇒ 相对路径会失效（第一次渲染出来是"没样式"的裸 HTML）⇒ 换成绝对路径
html = html.replace('href="manual.css"', 'href="file:///D:/ps-uxp-dev/docs/manual/manual.css"')
html = html.replace('src="images/', 'src="file:///D:/ps-uxp-dev/docs/manual/images/')

for i, n in enumerate([0, 3, 6, 12, 15, 19, 23, 26]):
    inject = ("<script>window.addEventListener('load',function(){"
              "var a=[].slice.call(document.querySelectorAll('%s'));"
              "a.slice(0,%d).forEach(function(e){e.style.display='none'});"
              "})</script>" % (BLOCKS, n))
    patched = html.replace("</body>", inject + "\n</body>")
    work = os.path.join(OUT, "_pg%d.html" % i)
    open(work, "w", encoding="utf-8").write(patched)
    print(work, "隐藏前", n, "块")
