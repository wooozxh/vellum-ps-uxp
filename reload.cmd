@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Vellum 工具箱 - 重新加载到 Photoshop

set "CLI=node_modules\@adobe-fixed-uxp\uxp-devtools-cli\dist\uxp.js"
if not exist "%CLI%" (
  echo [X] 找不到 UXP 桥接工具：
  echo     %CLI%
  echo     请先在工作区根目录执行一次： npm install
  echo.
  pause
  exit /b 1
)

rem 优先用 PATH 里的 node，没有就回退到本机托管的那份
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

echo.
echo ============================================================
echo    Vellum 工具箱  -^>  重新加载到 Photoshop
echo ============================================================
echo.

rem --- 1/3 Photoshop 必须在运行 ---
tasklist 2>nul | findstr /i "Photoshop.exe" >nul
if errorlevel 1 (
  echo [X] Photoshop 没有运行。
  echo     请先打开 Photoshop，再双击本脚本。
  echo.
  pause
  exit /b 1
)
echo [1/3] Photoshop 正在运行 ...  OK

rem --- 2/3 桥接服务必须在 14001 上监听 ---
netstat -ano 2>nul | findstr ":14001" | findstr /i "LISTENING" >nul
if errorlevel 1 (
  echo [2/3] 桥接服务未运行 - 正在新窗口启动，请不要关掉它 ...
  start "UXP 桥接服务（请勿关闭）" "%NODE%" "%CLI%" service start
  timeout /t 4 /nobreak >nul
) else (
  echo [2/3] 桥接服务已在运行 ...  OK
)

rem --- 3/3 加载（幂等：已加载过会重新加载） ---
echo [3/3] 正在加载插件 ...
echo.
"%NODE%" "%CLI%" plugin load --manifest vellum-toolbox\manifest.json --apps PS
echo.
echo ------------------------------------------------------------
echo    完成。回到 Photoshop 打开面板：
echo      窗口 -^> 增效工具 -^> Vellum 工具箱
echo ------------------------------------------------------------
echo.
pause
