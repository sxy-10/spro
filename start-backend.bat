@echo off
title Travel Agent API Server (port 3001)
cd /d %~dp0backend

echo [1/2] Checking node environment...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] "node" not found in PATH. Please install Node.js first.
  echo.
  pause
  exit /b 1
)
node -v
echo [2/2] Starting API server on http://127.0.0.1:3001 ...
echo (Keep this window open while using the platform. Press Ctrl+C to stop.)
echo.
call npx tsx src/server.ts

echo.
echo ===== Server exited. Error message is above if any. =====
pause
