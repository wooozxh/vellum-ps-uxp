# -*- coding: utf-8 -*-
"""
生成手册用的**示例素材图**（不含任何真实物料信息）。

为什么要有这个脚本：
  手册里素材库那一屏必须能看出"里面有很多素材"，但真实素材是部门在用的海报 / 展架 /
  讲师照片，**不能外发**。所以造一批明显是"示例"的图写进 VellumDesk 工作区，
  手册截的就是它们。用户 2026-10-18 明确要求过这件事。

设计约定（改了请一起改）：
  · 一望即知是示例：统一的 SAMPLE 角标 + 「示例」前缀文件名；
  · 尺寸刻意做得**长短不一**（长图 1080×2400 / 方图 1080×1080 / 横图 1920×720 …），
    这样手册里"瀑布流保持原比例、长图方图混排"那句话才有画面支撑；
  · 配色用一组中性色板，**不用**任何真实品牌色；
  · 不出现真人、二维码、真实文案。

用法：python tools/manual/make_sample_assets.py [输出目录]
默认输出到 preview/sample-assets/（先看效果），确认后再由调用方拷进工作区。
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

# 中性色板（避开真实品牌色）
PALETTE = [
    ((38, 44, 58), (86, 98, 122), "深灰蓝"),
    ((214, 106, 74), (238, 168, 128), "砖橙"),
    ((52, 122, 116), (128, 186, 168), "墨绿"),
    ((124, 108, 160), (186, 172, 214), "灰紫"),
    ((206, 172, 92), (238, 214, 152), "芥黄"),
]

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"


def font(size, bold=False):
    path = FONT_BOLD if bold else FONT_REG
    try:
        return ImageFont.truetype(path, size, index=0)
    except Exception:
        return ImageFont.load_default()


def vgrad(w, h, c1, c2):
    """竖向渐变底。"""
    im = Image.new("RGB", (w, h), c1)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return im


def badge(im, text="SAMPLE", pad=18):
    """右下角 SAMPLE 角标 —— 一望即知是示例。"""
    d = ImageDraw.Draw(im)
    f = font(max(14, im.width // 46), bold=True)
    tw = d.textlength(text, font=f)
    x0 = im.width - tw - pad * 3
    y0 = im.height - pad * 3 - 20
    d.rectangle([x0, y0, im.width - pad, im.height - pad], fill=(0, 0, 0))
    d.text((x0 + pad * 0.7, y0 + 6), text, font=f, fill=(255, 255, 255))


def centered(im, lines, base_y=None, color=(255, 255, 255)):
    """把若干行文字竖排在画面中部偏上。lines = [(text, size, bold, gap_after), ...]"""
    d = ImageDraw.Draw(im)
    heights = []
    for text, size, bold, gap in lines:
        f = font(size, bold)
        bbox = d.textbbox((0, 0), text, font=f)
        heights.append((bbox[3] - bbox[1]) + gap)
    total = sum(heights)
    y = base_y if base_y is not None else int(im.height * 0.36) - total // 2
    for (text, size, bold, gap), hh in zip(lines, heights):
        f = font(size, bold)
        tw = d.textlength(text, font=f)
        d.text(((im.width - tw) / 2, y), text, font=f, fill=color)
        y += hh


def make(name, w, h, kind, color_idx):
    c1, c2, cn = PALETTE[color_idx % len(PALETTE)]

    if kind == "poster":          # 竖版海报：上色块 + 大字
        im = vgrad(w, h, c1, c2)
        d = ImageDraw.Draw(im)
        d.rectangle([int(w * 0.1), int(h * 0.12), int(w * 0.9), int(h * 0.30)], fill=(255, 255, 255))
        centered(im, [
            ("示例海报", int(w * 0.115), True, int(h * 0.02)),
            ("A3 · 297 × 420 mm", int(w * 0.052), False, int(h * 0.05)),
            ("这里放主标题", int(w * 0.070), True, int(h * 0.02)),
            ("副标题 · 一句话说明", int(w * 0.045), False, 0),
        ], base_y=int(h * 0.34))
        d.rectangle([int(w * 0.1), int(h * 0.78), int(w * 0.9), int(h * 0.90)], fill=(255, 255, 255))
        badge(im)

    elif kind == "rollup":        # 窄长展架
        im = vgrad(w, h, c1, c2)
        centered(im, [
            ("示例展架", int(w * 0.13), True, int(h * 0.03)),
            ("800 × 1800 mm", int(w * 0.062), False, int(h * 0.05)),
            ("竖版长图", int(w * 0.055), False, 0),
        ], base_y=int(h * 0.30))
        badge(im)

    elif kind == "square":        # 方图：几何拼贴
        im = Image.new("RGB", (w, h), c1)
        d = ImageDraw.Draw(im)
        q = w // 2
        d.rectangle([0, 0, q, q], fill=c2)
        d.ellipse([q, 0, w, q], fill=(255, 255, 255))
        d.rectangle([0, q, q, h], fill=(255, 255, 255))
        d.ellipse([q, q, w, h], fill=c2)
        centered(im, [("示例", int(w * 0.10), True, int(h * 0.01)),
                      ("1200 × 1200", int(w * 0.045), False, 0)],
                 base_y=int(h * 0.42), color=c1)
        badge(im)

    elif kind == "banner":        # 横版 banner
        im = vgrad(w, h, c1, (255, 255, 255))
        d = ImageDraw.Draw(im)
        d.rectangle([0, int(h * 0.62), w, h], fill=c2)
        f = font(int(h * 0.26), bold=True)
        d.text((int(w * 0.06), int(h * 0.16)), "示例 Banner", font=f, fill=(255, 255, 255))
        f2 = font(int(h * 0.10))
        d.text((int(w * 0.06), int(h * 0.46)), "1920 × 720", font=f2, fill=(255, 255, 255))
        badge(im)

    elif kind == "long":          # 超长详情页
        im = vgrad(w, h, c1, c2)
        d = ImageDraw.Draw(im)
        y = int(h * 0.05)
        for i in range(6):
            bh = int(h * 0.10)
            d.rectangle([int(w * 0.08), y, int(w * 0.92), y + bh],
                        fill=(255, 255, 255) if i % 2 == 0 else c1)
            y += bh + int(h * 0.03)
        centered(im, [("示例长图", int(w * 0.10), True, int(h * 0.01)),
                      ("1080 × 2400", int(w * 0.045), False, 0)],
                 base_y=int(h * 0.02))
        badge(im)

    elif kind == "logo":          # logo 横版 / 方版
        im = Image.new("RGB", (w, h), (250, 250, 248))
        d = ImageDraw.Draw(im)
        r = int(min(w, h) * 0.30)
        cx, cy = int(w * 0.22), h // 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c1)
        d.ellipse([cx - int(r * 0.45), cy - int(r * 0.45),
                   cx + int(r * 0.45), cy + int(r * 0.45)], fill=(255, 255, 255))
        f = font(int(min(w, h) * 0.20), bold=True)
        d.text((cx + r + int(w * 0.05), cy - int(min(w, h) * 0.13)), "SAMPLE", font=f, fill=c1)
        f2 = font(int(min(w, h) * 0.085))
        d.text((cx + r + int(w * 0.052), cy + int(min(w, h) * 0.10)),
               "示例标识", font=f2, fill=(120, 120, 120))
        badge(im)

    elif kind == "icon":          # 方形图标
        im = Image.new("RGB", (w, h), (245, 245, 243))
        d = ImageDraw.Draw(im)
        m = int(w * 0.14)
        d.rounded_rectangle([m, m, w - m, h - m], radius=int(w * 0.18), fill=c1)
        f = font(int(w * 0.30), bold=True)
        t = "示"
        tw = d.textlength(t, font=f)
        d.text(((w - tw) / 2, h * 0.30), t, font=f, fill=(255, 255, 255))
        badge(im)

    im.save(name, "PNG", optimize=True)
    return name


SPECS = [
    ("示例-海报-A3.png",      1240, 1754, "poster", 0),
    ("示例-展架-80x180.png",   800, 1800, "rollup", 1),
    ("示例-方图-朋友圈.png",  1200, 1200, "square", 2),
    ("示例-Banner-横版.png",  1920,  720, "banner", 3),
    ("示例-长图-详情页.png",  1080, 2400, "long",   4),
    ("示例-logo-横版.png",    1200,  400, "logo",   0),
    ("示例-logo-方版.png",     800,  800, "logo",   2),
    ("示例-图标-深蓝.png",     512,  512, "icon",   0),
    ("示例-图标-墨绿.png",     512,  512, "icon",   2),
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join("preview", "sample-assets")
    os.makedirs(out, exist_ok=True)
    for name, w, h, kind, ci in SPECS:
        p = os.path.join(out, name)
        make(p, w, h, kind, ci)
        print("%-28s %4d×%-4d %6.1f KB" % (name, w, h, os.path.getsize(p) / 1024))
    print("\n共 %d 张 → %s" % (len(SPECS), os.path.abspath(out)))


if __name__ == "__main__":
    main()
