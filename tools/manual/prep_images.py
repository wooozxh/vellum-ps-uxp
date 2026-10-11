# -*- coding: utf-8 -*-
"""把抓到的原始截图整理成手册用图（裁剪 / 放大 / 改名）到 docs/manual/images/。"""
import os
import shutil
from PIL import Image

SH = "C:/Users/17736/WorkBuddy/vellum_PS_uxp_dev/screenshots"
REPO = "D:/ps-uxp-dev"
OUT = os.path.join(REPO, "docs", "manual", "images")
os.makedirs(OUT, exist_ok=True)

# 1) 面板整屏截图（422×732，直接可用）→ 顺序命名
COPY = [
    ("nav_try.png", "01-首页.png"),
    ("tpl_palette.png", "02-调色板.png"),
    ("tpl_library.png", "03-素材库-任务库.png"),
    ("tpl_library_brand.png", "04-素材库-通用库.png"),
    ("tpl_library_sel.png", "05-素材库-选中详情.png"),
    ("tpl_table.png", "06-表格生成-未导入.png"),
    ("tpl_table_data.png", "07-表格生成-已导入.png"),
    ("tpl_table_done.png", "08-表格生成-已生成.png"),
]
for src, dst in COPY:
    p = os.path.join(SH, src)
    if os.path.exists(p):
        shutil.copyfile(p, os.path.join(OUT, dst))
        print("copy", dst, Image.open(p).size)
    else:
        print("!! 缺", src)

# 2) 画布上的表格（100% 缩放，1:1 裁 → 放大 2.5×，字才看得清）
im = Image.open(os.path.join(SH, "ps_100.png"))
c = im.crop((880, 583, 1325, 800))
c = c.resize((int(c.size[0] * 2.5), int(c.size[1] * 2.5)), Image.LANCZOS)
c.save(os.path.join(OUT, "09-生成结果-画布.png"))
print("crop 09", c.size)

# 3) 图层面板：证明"生成的是可继续编辑的普通图层"
im2 = Image.open(os.path.join(SH, "ps_after.png"))
c2 = im2.crop((2258, 385, 2576, 900))
c2.save(os.path.join(OUT, "10-生成结果-图层面板.png"))
print("crop 10", c2.size)

# 4) logo
for src, dst in [
    (os.path.join(REPO, "vellum-toolbox", "icons", "logo-full.png"), "logo.png"),
    ("D:/proj_media/docs/manual/images/logo-128.png", "logo-128.png"),
]:
    if os.path.exists(src):
        shutil.copyfile(src, os.path.join(OUT, dst))
        print("logo", dst, Image.open(src).size)
    else:
        print("!! logo 缺", src)
