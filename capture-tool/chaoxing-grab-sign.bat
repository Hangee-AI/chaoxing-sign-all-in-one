@echo off
setlocal enabledelayedexpansion
title chaoxing group sign link grabber

rem ================= edit these two lines if the tools are not on PATH =================
set "ADB=C:\Tools\adb\platform-tools\adb.exe"
set "MITMDUMP=mitmdump"
rem =======================================================================================

set "CONF=%USERPROFILE%\.mitmproxy"
set "OUT=%TEMP%\cx-sign-url.txt"

if /i "%~1"=="cert" goto :cert

del "%OUT%" 2>nul

if not exist "%ADB%" (
  echo [x] adb not found: "%ADB%"
  echo     Edit the ADB= line near the top of this file.
  goto :fail
)

set "OK="
for /f "skip=1 tokens=2" %%i in ('"%ADB%" devices') do if "%%i"=="device" set "OK=1"
if not defined OK (
  echo [x] No device ready. Plug the phone in with USB and allow debugging.
  goto :fail
)

"%MITMDUMP%" --version >nul 2>nul
if errorlevel 1 (
  echo [x] mitmdump not found. Run: pip install mitmproxy
  goto :fail
)

echo [1/4] starting mitmdump on 8080 ...
start "cx-mitm" /min "%MITMDUMP%" -p 8080 --ssl-insecure -s "%~dp0cx_grab.py"
timeout /t 3 /nobreak >nul

echo [2/4] routing phone traffic to this PC ...
"%ADB%" reverse tcp:8080 tcp:8080 >nul
"%ADB%" shell settings put global http_proxy 127.0.0.1:8080 >nul

echo.
echo   >>> On the phone: open the group, tap the photo-sign card. <<<
echo   The camera will pop up - just cancel it, the link is already captured.
echo   First time only: run  "%~nx0 cert"  and install the CA on the phone.
echo.

set /a N=0
:wait
timeout /t 1 /nobreak >nul
if exist "%OUT%" goto :got
set /a N+=1
if %N% LSS 120 goto :wait
echo [x] Timed out, nothing captured.
goto :cleanup_fail

:got
set /p LINK=<"%OUT%"
echo.
echo [3/4] captured:
type "%OUT%"
powershell -NoProfile -Command "Set-Clipboard -Value (''+[IO.File]::ReadAllText('%OUT%')).Trim()"
echo       it is now in the clipboard.
echo.
echo [4/4] paste it into the app: camera icon on the account card - "paste sign link" - Recognize - choose photo - submit.

:cleanup
"%ADB%" shell settings put global http_proxy :0 >nul
"%ADB%" reverse --remove-all >nul
taskkill /im mitmdump.exe /f >nul 2>nul
echo proxy revoked, mitmdump stopped. Done.
endlocal
exit /b 0

:cleanup_fail
"%ADB%" shell settings put global http_proxy :0 >nul
"%ADB%" reverse --remove-all >nul
taskkill /im mitmdump.exe /f >nul 2>nul
echo proxy revoked, mitmdump stopped.
endlocal
exit /b 1

:cert
if not exist "%CONF%\mitmproxy-ca-cert.cer" (
  echo [i] CA not generated yet. Run this file without arguments once ^(it will time out, that is fine^),
  echo     then run "%~nx0 cert" again.
  goto :end
)
"%ADB%" push "%CONF%\mitmproxy-ca-cert.cer" /sdcard/Download/
echo.
echo Pushed to /sdcard/Download/mitmproxy-ca-cert.cer
echo On the phone: Settings - Security - More settings - Encryption and credentials
echo               - Install a certificate - CA certificate - pick the file.
echo This is ONE TIME ONLY, the app trusts user CAs and never needs a reinstall.
:end
endlocal
exit /b 0

:fail
echo.
echo [x] Aborted before touching the phone. Nothing to revoke.
echo     Need: adb (USB debugging allowed) + pip install mitmproxy
pause
endlocal
exit /b 1
