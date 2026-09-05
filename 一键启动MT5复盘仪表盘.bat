@echo off
setlocal EnableExtensions
title MT5 Review Dashboard

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "PROJECT_DIR=%ROOT_DIR%\mt5-review-system"
set "DASHBOARD_URL=http://127.0.0.1:8787"
if "%MT5_REVIEW_HOST%"=="" set "MT5_REVIEW_HOST=127.0.0.1"
if "%MT5_REVIEW_PORT%"=="" set "MT5_REVIEW_PORT=8787"

if not exist "%PROJECT_DIR%\start.ps1" (
  echo [ERROR] Cannot find the project startup file:
  echo "%PROJECT_DIR%\start.ps1"
  echo.
  echo Please keep this BAT file next to the mt5-review-system folder.
  echo Current BAT folder: "%ROOT_DIR%"
  echo.
  pause
  exit /b 1
)

echo Starting MT5 Review Dashboard...
echo Project: "%PROJECT_DIR%"
echo URL: %DASHBOARD_URL%
echo Bind host: %MT5_REVIEW_HOST%:%MT5_REVIEW_PORT%
echo.

if /I not "%MT5_REVIEW_SKIP_BROWSER%"=="1" (
  start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process '%DASHBOARD_URL%'"
)

pushd "%PROJECT_DIR%"
if errorlevel 1 (
  echo [ERROR] Cannot enter project folder:
  echo "%PROJECT_DIR%"
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Service stopped or failed. Exit code: %EXIT_CODE%
) else (
  echo Service stopped.
)
echo Dashboard URL: %DASHBOARD_URL%
echo.
pause
exit /b %EXIT_CODE%
