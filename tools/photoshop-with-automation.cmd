@echo off
rem ---------------------------------------------------------------------------
rem 以 /Automation 模式启动 Photoshop
rem
rem 为什么需要这个：
rem   Photoshop 的 COM 自动化类工厂（Photoshop.Application）只在**以 /Automation
rem   启动的那个实例**里注册。如果你用开始菜单 / 任务栏正常启动 PS，再让外部程序
rem   去 CreateObject("Photoshop.Application")，Windows 会去拉起第二个
rem   Photoshop.exe /Automation —— 而那个新实例发现已有实例后会立刻退出，
rem   交棒失败，外部程序最终拿到 429「ActiveX 部件不能创建对象」。
rem
rem 证据（2026-10-10 实测，0.1 秒精度进程采样）：
rem   19:25:39  pids=4198760,4209200   ← 第二个 PS 进程出现
rem   19:25:42  pids=4198760           ← 3 秒后自行退出（正常启动要 15~40 秒）
rem   19:26:09  cscript 结束，报 429
rem
rem 用法：
rem   1. 完全退出 Photoshop（含后台进程）
rem   2. 双击本文件
rem   3. 之后再让 MCP / 外部脚本连接
rem ---------------------------------------------------------------------------

set "PS_EXE=D:\software\adobe\Adobe Photoshop 2026\Photoshop.exe"

if not exist "%PS_EXE%" (
  echo [错误] 找不到 Photoshop：%PS_EXE%
  echo         请修改本文件顶部的 PS_EXE 变量。
  pause
  exit /b 1
)

echo 正在以 /Automation 模式启动 Photoshop ...
echo   %PS_EXE% /Automation
start "" "%PS_EXE%" /Automation
exit /b 0
