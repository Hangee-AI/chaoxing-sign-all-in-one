@echo off
title chaoxing-sign launcher
setlocal

rem If node/corepack is not already on your PATH, uncomment and edit this line:
rem set "NODE_DIR=C:\Users\you\tools\node-v24.18.0-win-x64"
rem set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] node not found. Install Node 18+ or set NODE_DIR above.
  pause
  exit /b 1
)

echo [1/3] Starting PostgreSQL in WSL (keeps the distro alive in its own window)...
start "pg-keepalive" wsl.exe -d Ubuntu -e bash -lc "sudo -n service postgresql start; sleep infinity"

echo [2/3] Starting Nuxt dev server (chaoxing-dev window)...
start "chaoxing-dev" cmd /c "cd /d %~dp0 && corepack pnpm exec nuxi dev --port 8050"

echo Waiting for http://localhost:8050 to be ready...
:waitloop
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$c.Connect('127.0.0.1',8050);exit 0}catch{exit 1}"
if errorlevel 1 goto waitloop

echo [3/3] Opening browser...
start "" http://localhost:8050/
echo.
echo All set! Keep the two windows (pg-keepalive / chaoxing-dev) open while using the app.
echo Close those windows to stop the server.
pause
