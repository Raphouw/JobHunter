@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [ERREUR] Lance d abord install.bat
  pause
  exit /b 1
)
set PROFILE=%~1
if "%PROFILE%"=="" set PROFILE=raphael
".venv\Scripts\python.exe" stage_hunter.py scan --profile "%PROFILE%"
pause
