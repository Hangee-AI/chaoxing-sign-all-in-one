@echo off
chcp 65001 >nul
title 还原手机网络
set ADB=C:\Tools\adb\platform-tools\adb.exe

echo 正在清理手机上的抓包代理...
if exist "%ADB%" (
  "%ADB%" shell settings put global http_proxy :0
  "%ADB%" reverse --remove-all
) else (
  echo [x] 找不到 adb：%ADB%
)

taskkill /f /im mitmdump.exe >nul 2>nul

echo.
echo 已还原：手机 HTTP 代理 = 空、adb reverse 已清空、mitmdump 已关闭。
echo 如果手机还是打不开网页，把 Wi-Fi/数据开关切一下，或者重启手机浏览器。
pause
