@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0tools\pack-release.ps1" %*
set "HIP_PACK_EXIT=%ERRORLEVEL%"

if not "%HIP_PACK_EXIT%"=="0" (
  echo.
  echo Packaging failed with exit code %HIP_PACK_EXIT%.
  pause
  exit /b %HIP_PACK_EXIT%
)

echo.
echo Packaging completed successfully.
pause
exit /b 0
