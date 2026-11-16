@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 只在“想让脚本自动抓签到链接”时才需要装证书；
rem 只是复制粘贴链接的话可以跳过。

set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture-tool\install-cert.ps1" %*

echo.
echo 完成后这个窗口可以直接关掉。
pause
