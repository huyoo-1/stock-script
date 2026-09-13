@echo off
chcp 65001 >nul
title AStock Crowd Monitor
cd /d "%~dp0"

echo ========================================
echo   AStock Crowd Monitor - One-Click Start
echo ========================================

REM Install deps if missing (vite = frontend build dep; node_modules alone may be runtime-only)
if not exist "node_modules\vite" (
  echo [init] deps missing, running npm install ...
  call npm install
  if errorlevel 1 ( echo npm install failed & pause & exit /b 1 )
)

REM config.json required (contains feishu credentials, loadConfig is fail-fast)
if not exist "config.json" (
  echo [error] config.json not found. Copy from config.sample.json and fill feishu credentials.
  pause
  exit /b 1
)

REM Show local/LAN access URLs (port read from config, not hardcoded)
node scripts\start-info.js

echo   Starting service (auto-builds frontend on first run)...
echo   Press Ctrl+C to stop
echo ========================================
echo.

call npm start
pause
