# -*- coding: utf-8 -*-
"""
tools/manual/shoot_win.py —— 抓 Windows 窗口截图 / 模拟点击（写给 UXP 插件手册用）

为什么不用现成的 PS 脚本：本机 PowerShell 执行策略禁 .ps1，且内联 Add-Type 被安全策略拦
⇒ 走 Python + ctypes 直调 user32/gdi32，零 .NET 依赖。

用法：
  python shoot_win.py capture --pid 41136 --out <目录> --tag ps_full [--crop L,T,W,H]
  python shoot_win.py click   --pid 41136 --x 1160 --y 300 [--n 1]
  python shoot_win.py rect    --pid 41136

坐标约定：一律**窗口左上角为原点**的物理像素（脚本内部已 SetProcessDPIAware）。
capture 优先 PrintWindow(PW_RENDERFULLCONTENT=2)；若整幅几乎全黑则回退 BitBlt 屏幕拷贝。
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

DIB_RGB_COLORS = 0
SRCCOPY = 0x00CC0020
SW_RESTORE = 9
SW_SHOW = 5


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
        ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
        ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]


class RECT(ctypes.Structure):
    _fields_ = [("Left", wt.LONG), ("Top", wt.LONG), ("Right", wt.LONG), ("Bottom", wt.LONG)]


def windows_of_pid(pid):
    """枚举该 PID 下所有可见顶层窗口，按面积从大到小返回 [(hwnd, rect)]。"""
    out = []

    def cb(hwnd, _):
        wpid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value != pid:
            return True
        if not user32.IsWindowVisible(hwnd):
            return True
        r = RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(r)):
            return True
        w, h = r.Right - r.Left, r.Bottom - r.Top
        if w > 200 and h > 150:
            out.append((hwnd, r, w * h))
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    user32.EnumWindows(WNDENUMPROC(cb), 0)
    out.sort(key=lambda x: -x[2])
    return [(h, r) for h, r, _ in out]


def pick_main(pid, index=0):
    ws = windows_of_pid(pid)
    if not ws:
        raise SystemExit("找不到 pid=%s 的可见窗口" % pid)
    return ws[min(index, len(ws) - 1)]


def grab(hwnd, r, use_printwindow=True):
    from PIL import Image
    w, h = r.Right - r.Left, r.Bottom - r.Top
    hdc_screen = user32.GetDC(0)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
    bmi = BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = w
    bmi.bmiHeader.biHeight = -h           # 负数 = top-down
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = DIB_RGB_COLORS
    bits = ctypes.c_void_p()
    hbmp = gdi32.CreateDIBSection(hdc_screen, ctypes.byref(bmi), DIB_RGB_COLORS,
                                  ctypes.byref(bits), None, 0)
    gdi32.SelectObject(hdc_mem, hbmp)
    ok = False
    if use_printwindow:
        ok = bool(user32.PrintWindow(hwnd, hdc_mem, 2))
    if not ok:
        gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, r.Left, r.Top, SRCCOPY)
    raw = ctypes.string_at(bits, w * h * 4)
    img = Image.frombuffer("RGBA", (w, h), raw, "raw", "BGRA", 0, 1).convert("RGB")
    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(0, hdc_screen)
    return img, ok


def is_blank(img):
    """极快判"整幅几乎全黑"（PrintWindow 对 GPU 合成窗口有时会返回黑图）。"""
    small = img.resize((64, 40))
    px = list(small.getdata())
    m = sum(sum(p) for p in px) / (len(px) * 3)
    return m < 8


def focus(hwnd):
    user32.SetProcessDPIAware()
    user32.ShowWindow(hwnd, SW_RESTORE)
    user32.ShowWindow(hwnd, SW_SHOW)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.7)


def do_capture(a):
    hwnd, r = pick_main(a.pid, a.index)
    focus(hwnd)
    hwnd, r = pick_main(a.pid, a.index)
    img, ok = grab(hwnd, r, not a.bitblt)
    if ok and is_blank(img):
        img, ok = grab(hwnd, r, False)
    os.makedirs(a.out, exist_ok=True)
    if a.crop:
        L, T, W, H = [int(x) for x in a.crop.split(",")]
        img = img.crop((L, T, L + W, T + H))
    path = os.path.join(a.out, a.tag + ".png")
    img.save(path)
    print("OK method=%s win=%dx%d crop=%s -> %s (%dx%d)" %
          ("PrintWindow" if ok else "BitBlt", r.Right - r.Left, r.Bottom - r.Top,
           a.crop or "-", path, img.size[0], img.size[1]))
    return path


def do_rect(a):
    for i, (hwnd, r) in enumerate(windows_of_pid(a.pid)):
        print("win[%d] hwnd=%s rect=(%d,%d) size=%dx%d" %
              (i, hwnd, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top))


def do_wheel(a):
    """在窗口内某点滚轮（PS 里默认「用滚轮缩放」⇒ 可用来把画布放大到能看清）。"""
    hwnd, r = pick_main(a.pid, a.index)
    focus(hwnd)
    x, y = r.Left + a.x, r.Top + a.y
    user32.SetCursorPos(x, y)
    time.sleep(0.25)
    for _ in range(max(1, a.n)):
        user32.mouse_event(0x0800, 0, 0, a.delta, 0)   # MOUSEEVENTF_WHEEL
        time.sleep(a.wait)
    print("OK wheel rel=(%d,%d) delta=%d x%d" % (a.x, a.y, a.delta, max(1, a.n)))


VK = {"ctrl": 0x11, "alt": 0x12, "shift": 0x10, "0": 0x30, "1": 0x31, "2": 0x32, "esc": 0x1B}


def do_keys(a):
    """给窗口发组合键（keybd_event，不需要 Add-Type）。例：ctrl+1 = PS 实际像素。"""
    hwnd, r = pick_main(a.pid, a.index)
    focus(hwnd)
    parts = [p.strip().lower() for p in a.combo.split("+")]
    mods = [p for p in parts if p in ("ctrl", "alt", "shift")]
    keys = [p for p in parts if p not in ("ctrl", "alt", "shift")]
    for m in mods:
        user32.keybd_event(VK[m], 0, 0, 0)
    for k in keys:
        user32.keybd_event(VK[k], 0, 0, 0)
        time.sleep(0.06)
        user32.keybd_event(VK[k], 0, 2, 0)
    for m in reversed(mods):
        user32.keybd_event(VK[m], 0, 2, 0)
    print("OK keys=%s" % a.combo)


def do_click(a):
    hwnd, r = pick_main(a.pid, a.index)
    focus(hwnd)
    x, y = r.Left + a.x, r.Top + a.y
    for _ in range(max(1, a.n)):
        user32.SetCursorPos(x, y)
        time.sleep(0.12)
        user32.mouse_event(0x0002, 0, 0, 0, 0)   # LEFTDOWN
        user32.mouse_event(0x0004, 0, 0, 0, 0)   # LEFTUP
        time.sleep(a.wait)
    print("OK click screen=(%d,%d) rel=(%d,%d) x%d" % (x, y, a.x, a.y, max(1, a.n)))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("capture", "click", "rect", "wheel", "keys"):
        p = sub.add_parser(name)
        p.add_argument("--pid", type=int, required=True)
        p.add_argument("--index", type=int, default=0)
        if name == "capture":
            p.add_argument("--out", required=True)
            p.add_argument("--tag", required=True)
            p.add_argument("--crop", default="")
            p.add_argument("--bitblt", action="store_true")
        if name == "click":
            p.add_argument("--x", type=int, required=True)
            p.add_argument("--y", type=int, required=True)
            p.add_argument("--n", type=int, default=1)
            p.add_argument("--wait", type=float, default=0.5)
        if name == "wheel":
            p.add_argument("--x", type=int, required=True)
            p.add_argument("--y", type=int, required=True)
            p.add_argument("--delta", type=int, default=120)
            p.add_argument("--n", type=int, default=1)
            p.add_argument("--wait", type=float, default=0.25)
        if name == "keys":
            p.add_argument("--combo", required=True)
    a = ap.parse_args()
    {"capture": do_capture, "click": do_click, "rect": do_rect,
     "wheel": do_wheel, "keys": do_keys}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
