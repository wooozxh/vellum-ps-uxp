"""按**窗口尺寸**锁定 UXP 面板并截图 / 点击（不依赖会漂移的窗口下标）。

为什么需要它：`shoot_win.py` 靠 `--index` 选窗口，而 PS 的窗口在两次调用之间会重排，
于是"列出来的 2 号"和"截图时的 2 号"经常不是同一个（实测踩过多次：截到 656×702 的别的窗口）。

用法：
  python uipanel.py list  --pid 13088
  python uipanel.py shot  --pid 13088 --out D:/x/y --size 422x732
  python uipanel.py click --pid 13088 --size 422x732 --x 200 --y 531 [--n 2]
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.SetProcessDPIAware()


def windows(pid):
    out = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        p = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value != pid:
            return True
        r = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        out.append((hwnd, r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True

    # 🔴 必须真的调用 EnumWindows 去枚举；直接 `cb(0,0)` 一次只会拿到空列表
    #    （这就是我第一版"枚举不到任何窗口"的原因，和 UXP/沙箱无关）。
    user32.EnumWindows(cb, 0)
    return out


def pick(pid, size, hwnd=None):
    """选窗口。

    ⚠️ **优先用 `--hwnd`**：PS 重启或用户拖动面板时尺寸会变
    （实测同一块面板从 422×732 变到 445×732），而**句柄不会变**。
    `--size` 只留给"我还不知道句柄、先探一下"的场景。
    """
    lst = windows(pid)
    if hwnd:
        want_h = int(hwnd, 16) if isinstance(hwnd, str) else int(hwnd)
        for it in lst:
            if it[0] == want_h:
                return it
        return None
    want = None
    if size:
        w, h = size.lower().split("x")
        want = (int(w), int(h))
    for hwnd_, x, y, w, h in lst:
        if want and (w, h) != want:
            continue
        if not want and w < 200:
            continue
        return hwnd_, x, y, w, h
    return None


def shot(pid, out, size, hwnd=None):
    hit = pick(pid, size, hwnd)
    if not hit:
        print("找不到窗口 size=%s hwnd=%s pid=%s" % (size, hwnd, pid))
        return 1
    hwnd, x, y, w, h = hit
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    ok = user32.PrintWindow(hwnd, mem, 2)

    class BIH(ctypes.Structure):
        _fields_ = [
            ("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
            ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
            ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG),
            ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD),
        ]

    bi = BIH(ctypes.sizeof(BIH), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    from PIL import Image

    img = Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1)
    os.makedirs(out, exist_ok=True)
    p = os.path.join(out, "shot.png")
    img.convert("RGB").save(p)
    print("OK %s %dx%d -> %s (PrintWindow=%s)" % (hex(hwnd), w, h, p, ok))
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    return 0


def click(pid, size, x, y, n=1, wait=0.45, hwnd=None):
    hit = pick(pid, size, hwnd)
    if not hit:
        print("找不到窗口 size=%s" % size)
        return 1
    hwnd, wx, wy, w, h = hit
    """
    🔴 **置前必须确认真的成功了**（2026-10-18 踩）：`SetForegroundWindow` 在 Windows 上
    经常被静默拒绝（返回 0）。UXP 面板窗口的 rect 是 (0,0)，一旦没置前，`SetCursorPos`
    点的是**屏幕左上角那个窗口**，于是一连串点击全都"点了但没反应"，
    而脚本还打印 OK —— 极难查。
    兜底：先发一下 Alt（系统会认为用户在操作，允许抢焦点），再 SetForegroundWindow，
    最后 `GetForegroundWindow()` 确认；没抢到就打印警告（宁可吵，也别静默点空）。
    """
    user32.keybd_event(0x12, 0, 0, 0)      # Alt down
    user32.SetForegroundWindow(hwnd)
    user32.keybd_event(0x12, 0, 2, 0)      # Alt up
    time.sleep(0.25)
    if user32.GetForegroundWindow() != hwnd:
        user32.BringWindowToTop(hwnd)
        user32.SetActiveWindow(hwnd)
        time.sleep(0.2)
    if user32.GetForegroundWindow() != hwnd:
        print("⚠️ 置前失败（ForegroundWindow 不是目标窗口），这次点击可能落到别的窗口上")
    for _ in range(max(1, n)):
        user32.SetCursorPos(wx + x, wy + y)
        time.sleep(0.1)
        user32.mouse_event(0x0002, 0, 0, 0, 0)
        user32.mouse_event(0x0004, 0, 0, 0, 0)
        time.sleep(wait)
    print("OK click win=(%d,%d) rel=(%d,%d) x%d" % (wx + x, wy + y, x, y, max(1, n)))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "shot", "click"])
    ap.add_argument("--pid", type=int, required=True)
    ap.add_argument("--size", default="422x732")
    ap.add_argument("--hwnd", default="", help="直接指定窗口句柄（十六进制，如 0x836c8）。"
                                               "比 --size 稳：PS 重启/拖动时尺寸会变，句柄不会。")
    ap.add_argument("--out", default="")
    ap.add_argument("--x", type=int, default=0)
    ap.add_argument("--y", type=int, default=0)
    ap.add_argument("--n", type=int, default=1)
    a = ap.parse_args()
    if a.cmd == "list":
        for hwnd, x, y, w, h in windows(a.pid):
            print("hwnd=%s rect=(%d,%d) size=%dx%d" % (hex(hwnd), x, y, w, h))
        return 0
    if a.cmd == "shot":
        return shot(a.pid, a.out, a.size, a.hwnd)
    return click(a.pid, a.size, a.x, a.y, a.n, hwnd=a.hwnd)


if __name__ == "__main__":
    sys.exit(main())
