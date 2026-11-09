@echo off
chcp 65001 >nul
title 一键拍照签到
setlocal

rem 用 pwsh（如果有）或 Windows PowerShell 跑真正的逻辑脚本
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture-tool\quick-sign.ps1" %*
echo.
pause
