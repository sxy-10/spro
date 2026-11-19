@echo off
setlocal
chcp 65001 >nul
title Travel Agent Web Server (port 8080)
cd /d %~dp0

echo ============================================================
echo  旅游规划智能体 · 演示环境启动器
echo    后端 API   : http://127.0.0.1:3001/v1
echo    管理端页面 : http://127.0.0.1:8080/login.html
echo ============================================================
echo.

echo [1/4] 检查 Node 环境...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 node，请先安装 Node.js 并加入 PATH。
  pause
  exit /b 1
)
node -v
echo.

echo [2/4] 检查后端 (3001)...
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if errorlevel 1 (
  if not exist "backend\dist\server.js" (
    echo [ERROR] 缺少 backend\dist\server.js，请先执行: cd backend ^&^& npx tsc
    pause
    exit /b 1
  )
  echo     未运行，正在新窗口启动后端...
  start "backend :3001" cmd /k "cd /d %~dp0backend && node dist\server.js"
  timeout /t 4 /nobreak >nul
) else (
  echo     已在运行，跳过。
)
echo.

echo [3/4] 检查前端原型服务器 (8080)...
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo     未运行，启动中（本窗口保持打开，Ctrl+C 停止）...
  start "" http://127.0.0.1:8080/login.html
  cd /d %~dp0prototype
  node server.cjs
) else (
  echo     已在运行，跳过。
  echo [4/4] 打开浏览器...
  start "" http://127.0.0.1:8080/login.html
  echo.
  echo 前端已在独立进程中运行，本窗口可直接关闭。
  pause
)
