@echo off
rem ===========================================================================
rem  uxp.cmd —— UXP Developer Tools 命令行包装器
rem ---------------------------------------------------------------------------
rem  用法示例（注意：service start 会一直占住窗口，要单独开一个）：
rem
rem    tools\uxp.cmd service start                      常驻服务（先开这个）
rem    tools\uxp.cmd apps list                          看 PS 是否连上
rem    tools\uxp.cmd plugin load --manifest hello-uxp\manifest.json
rem    tools\uxp.cmd plugin watch --path hello-uxp      存盘自动重载
rem    tools\uxp.cmd plugin reload                      手动重载
rem    tools\uxp.cmd plugin logs                        插件日志窗口
rem    tools\uxp.cmd plugin validate --manifest hello-uxp\manifest.json
rem    tools\uxp.cmd plugin test                        跑插件内测试
rem
rem  首次使用前需要先启用开发者工作流（管理员执行一次）：
rem    node tools\enable-devtools.mjs
rem ===========================================================================
setlocal

set "CLI=%~dp0..\node_modules\@adobe-fixed-uxp\uxp-devtools-cli\dist\uxp.js"

if not exist "%CLI%" (
  echo [!] 找不到 UXP CLI，请先在工作区根目录执行：
  echo     npm install @adobe-fixed-uxp/uxp-devtools-cli
  exit /b 1
)

rem 优先用 PATH 里的 node，否则回退到 WorkBuddy 托管的那份
where node >nul 2>nul
if errorlevel 1 (
  set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
) else (
  set "NODE=node"
)

"%NODE%" "%CLI%" %*
exit /b %errorlevel%
