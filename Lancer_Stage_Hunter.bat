@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [ERREUR] Stage Hunter n est pas installe.
  echo Lance d abord install.bat
  pause
  exit /b 1
)
set "NO_COLOR=1"
set "PYTHONUTF8=1"
set "STREAMLIT_BROWSER_GATHER_USAGE_STATS=false"
".venv\Scripts\python.exe" lancer_stage_hunter.py
if errorlevel 1 pause
