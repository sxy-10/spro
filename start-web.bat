@echo off
title Travel Agent Web Server (port 8080)
cd /d %~dp0frontend\prototype

echo [1/2] Checking node environment...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] "node" not found in PATH. Please install Node.js first.
  echo.
  pause
  exit /b 1
)
node -v
echo [2/2] Starting web server on http://127.0.0.1:8080/login.html ...
echo (Keep this window open while using the platform. Press Ctrl+C to stop.)
echo.
node server.cjs

echo.
echo ===== Server exited. Error message is above if any. =====
pause
