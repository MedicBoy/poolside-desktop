@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required to run the offline lab.
  exit /b 1
)
node "%~dp0simulator.cjs"
set "lab_exit=%errorlevel%"
endlocal & exit /b %lab_exit%
