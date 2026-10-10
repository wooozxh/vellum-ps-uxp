# -*- coding: utf-8 -*-
"""
make-logo.py —— 把品牌 logo 的 JPG（白底）转成 UXP 插件可用的透明 PNG。

做三件事：
  1) **从四边泛洪抠白** —— 只抠「与画面边界连通的白色」，环内/纸内的白色保留
     （简单按颜色阈值扣会让 logo 内部的白洞也变透明，那是错的）。
  2) **边缘去白边** —— JPEG 在边缘会留一圈浅灰halo，泛洪后对这些像素按
     「离白多远」给部分 alpha，避免在深色面板上出现一圈白毛边。
  3) 输出两份：
       logo-mark.png  只含图形（自动找图形与文字的横向间隙切掉 "Vellum Desk" 字样）
       logo-full.png  完整标（含字样），留作备选

用法：
  <venv>/Scripts/python.exe tools/make-logo.py <源jpg> <输出目录>
"""

import sys
import os
from collections import deque

from PIL import Image

WHITE_MIN = 238          # 三通道都 >= 此值视为"背景候选"
EDGE_SOFT_LO = 200       # 边缘去白边的下界（低于此亮度保持不透明）
PAD = 8                  # 裁剪后四周留白


def flood_background(px, w, h):
    """从四边泛洪，标记与边界连通的白像素。返回 bytearray（1 = 背景）。"""
    is_white = bytearray(w * h)
    for y in range(h):
        base = y * w
        for x in range(w):
            r, g, b, _a = px[base + x]
            if r >= WHITE_MIN and g >= WHITE_MIN and b >= WHITE_MIN:
                is_white[base + x] = 1

    mask = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if is_white[i] and not mask[i]:
            mask[i] = 1
            q.append(i)

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        i = q.popleft()
        x = i % w
        y = i // w
        if x > 0:
            push(x - 1, y)
        if x < w - 1:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y < h - 1:
            push(x, y + 1)
    return mask


def build_alpha(px, w, h, mask):
    """把背景遮罩转成 alpha；顺带对边缘像素做去白边（部分透明）。"""
    alpha = bytearray(w * h)
    for y in range(h):
        base = y * w
        for x in range(w):
            i = base + x
            if mask[i]:
                alpha[i] = 0
                continue
            # 白色中心（非背景）也保留不透明
            r, g, b, _a = px[i]
            m = min(r, g, b)
            near_bg = False
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if xx < 0 or xx >= w:
                        continue
                    if mask[yy * w + xx]:
                        near_bg = True
                        break
                if near_bg:
                    break
            if near_bg and m > EDGE_SOFT_LO:
                # 越接近白越透明：m=238 → 0，m=200 → 255
                a = int(255 * (WHITE_MIN - m) / (WHITE_MIN - EDGE_SOFT_LO))
                alpha[i] = max(0, min(255, a))
            else:
                alpha[i] = 255
    return alpha


def bbox_of_opaque(alpha, w, h):
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        base = y * w
        for x in range(w):
            if alpha[base + x] > 8:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    return minx, miny, maxx, maxy


def row_ink(alpha, w, h):
    """每一行"墨量"（不透明像素数），用来找图形与文字之间的横向空档。"""
    ink = [0] * h
    for y in range(h):
        base = y * w
        c = 0
        for x in range(w):
            if alpha[base + x] > 8:
                c += 1
        ink[y] = c
    return ink


def find_text_gap(ink, miny, maxy):
    """在图形区之后找最宽的一段"空白行"，作为图形 / 字样的分界。"""
    runs = []
    start = None
    for y in range(miny, maxy + 1):
        if ink[y] == 0:
            if start is None:
                start = y
        else:
            if start is not None:
                runs.append((start, y - 1))
                start = None
    if start is not None:
        runs.append((start, maxy))
    # 忽略贴着顶端的空段；取图形下方的第一段足够宽的空白
    best = None
    for a, b in runs:
        if b - a + 1 >= 4 and a > miny + 10:
            best = (a, b)
            break
    return best


def main():
    src = sys.argv[1]
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = list(im.getdata())
    print("源图尺寸：%dx%d" % (w, h))

    mask = flood_background(px, w, h)
    alpha = build_alpha(px, w, h, mask)

    out = Image.new("RGBA", (w, h))
    out.putdata([
        (px[i][0], px[i][1], px[i][2], alpha[i]) for i in range(w * h)
    ])

    bx0, by0, bx1, by1 = bbox_of_opaque(alpha, w, h)
    print("内容边界：(%d,%d)-(%d,%d)" % (bx0, by0, bx1, by1))

    ink = row_ink(alpha, w, h)
    gap = find_text_gap(ink, by0, by1)
    print("图形/字样分界空档行：", gap)

    # ---- full：整幅内容，留白 ----
    fx0 = max(0, bx0 - PAD)
    fy0 = max(0, by0 - PAD)
    fx1 = min(w - 1, bx1 + PAD)
    fy1 = min(h - 1, by1 + PAD)
    full = out.crop((fx0, fy0, fx1 + 1, fy1 + 1))
    full.save(os.path.join(outdir, "logo-full.png"))
    print("logo-full.png  %dx%d" % full.size)

    # ---- mark：只取图形（切掉字样） ----
    if gap:
        gy0 = max(0, by0 - PAD)
        gy1 = min(h - 1, gap[0] - 1 + PAD // 2)
        mark = out.crop((fx0, gy0, fx1 + 1, gy1 + 1))
    else:
        mark = full
        print("⚠️ 没找到图形/字样分界，mark 退化为 full")
    # 图形区再收紧一次左右边界
    mw, mh = mark.size
    mpx = list(mark.getdata())
    ma = bytearray(mw * mh)
    for i in range(mw * mh):
        ma[i] = mpx[i][3]
    mx0, my0, mx1, my1 = bbox_of_opaque(ma, mw, mh)
    mark = mark.crop((max(0, mx0 - PAD), max(0, my0 - PAD),
                      min(mw - 1, mx1 + PAD) + 1, min(mh - 1, my1 + PAD) + 1))
    mark.save(os.path.join(outdir, "logo-mark.png"))
    print("logo-mark.png  %dx%d" % mark.size)

    # ---- 校验图：分别合成到深色 / 浅色面板底色上 ----
    def composite(bg, im2):
        canvas = Image.new("RGBA", (im2.size[0] * 2 + 30, im2.size[1] + 20), bg)
        canvas.alpha_composite(im2, (10, 10))
        canvas.alpha_composite(im2, (im2.size[0] + 20, 10))
        return canvas

    dark = composite((50, 50, 50, 255), mark)
    light = composite((240, 240, 240, 255), mark)
    check = Image.new("RGBA", (max(dark.size[0], light.size[0]),
                               dark.size[1] + light.size[1]), (128, 128, 128, 255))
    check.alpha_composite(dark, (0, 0))
    check.alpha_composite(light, (0, dark.size[1]))
    check.save(os.path.join(outdir, "..", ".tmp-logo-check.png"))
    print("校验图 → .tmp-logo-check.png")


if __name__ == "__main__":
    main()
