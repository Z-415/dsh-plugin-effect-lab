@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required on PATH.
  pause
  exit /b 1
)
node bin\lab.js gui %*
if errorlevel 1 pause
