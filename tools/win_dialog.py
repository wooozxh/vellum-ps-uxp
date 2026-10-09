#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
win_dialog.py —— 列出（并可选关闭）某个进程的顶层窗口。

用途：UXP 插件在 Photoshop 里跑 batchPlay 失败时，PS 会弹出**原生模态错误框**，
把整个模态作用域卡住 —— 外面的脚本看不到任何进展，只能干等。这个脚本让你
先看清楚卡在哪个窗口上，再决定要不要替用户把它点掉。

用法：
    python tools/win_dialog.py                 # 列出 Photoshop 的所有顶层窗口
    python tools/win_dialog.py <pid>           # 指定进程
    python tools/win_dialog.py <pid> --close "#32770"   # 关掉指定类名的窗口

安全设计：--close 只对「类名/标题同时匹配」的窗口动手，默认不关任何东西。
"""

import ctypes
import sys
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def get_text(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def get_class(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def get_pid(hwnd):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def find_photoshop_pids():
    """按名字找 Photoshop.exe 的 pid，避免用户还要自己查。"""
    import subprocess

    pids = []
    try:
        out = subprocess.run(
            ["tasklist", "/fi", "imagename eq Photoshop.exe", "/fo", "csv", "/nh"],
            capture_output=True,
            text=True,
        ).stdout
    except Exception:
        return pids
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2:
            try:
                pids.append(int(parts[1]))
            except ValueError:
                pass
    return pids


def collect(pids):
    rows = []

    def cb(hwnd, _):
        pid = get_pid(hwnd)
        if pid in pids:
            rows.append(
                {
                    "hwnd": hwnd,
                    "pid": pid,
                    "title": get_text(hwnd),
                    "cls": get_class(hwnd),
                    "visible": bool(user32.IsWindowVisible(hwnd)),
                    "enabled": bool(user32.IsWindowEnabled(hwnd)),
                }
            )
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return rows


def main():
    args = [a for a in sys.argv[1:]]
    do_close = "--close" in args
    close_filter = None
    if do_close:
        i = args.index("--close")
        if i + 1 < len(args):
            close_filter = args[i + 1]
        args = args[:i] + args[i + 2 :]

    if args:
        pids = [int(args[0])]
    else:
        pids = find_photoshop_pids()

    if not pids:
        print("没有找到 Photoshop 进程。")
        return 1

    print("目标进程 PID：" + ", ".join(str(p) for p in pids))
    rows = collect(pids)
    if not rows:
        print("没有枚举到任何顶层窗口。")
        return 0

    print("")
    print("%-12s %-8s %-28s %s" % ("HWND", "可见", "类名", "标题"))
    print("-" * 96)
    for r in rows:
        print(
            "%-12s %-8s %-28s %s"
            % (
                hex(r["hwnd"]),
                "是" if r["visible"] else "否",
                r["cls"][:28],
                r["title"][:60],
            )
        )

    if do_close:
        if not close_filter:
            print("\n[!] --close 需要指定要关的类名或标题关键字。")
            return 1
        hit = 0
        for r in rows:
            if close_filter.lower() in r["cls"].lower() or close_filter.lower() in r["title"].lower():
                rc = user32.PostMessageW(r["hwnd"], 0x0010, 0, 0)  # WM_CLOSE
                print("\n已发送关闭消息 -> %s (%s) rc=%s" % (r["title"], r["cls"], rc))
                hit += 1
        if not hit:
            print("\n没有匹配到窗口，什么都没做。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
