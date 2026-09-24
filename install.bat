@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "NO_COLOR=1"
echo ========================================
echo    STAGE HUNTER V6.2.7 - INSTALLATION
echo ========================================
where py >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Python 3.11 ou plus recent est requis.
  echo Installe Python depuis python.org et coche Add Python to PATH.
  pause
  exit /b 1
)
set "PY_LAUNCHER=py -3"
py -3.12 --version >nul 2>nul
if not errorlevel 1 set "PY_LAUNCHER=py -3.12"
if not exist ".venv\Scripts\python.exe" %PY_LAUNCHER% -m venv .venv
if errorlevel 1 (
  echo [ERREUR] Creation de l environnement Python impossible.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements-local.txt
if errorlevel 1 (
  echo [ERREUR] Installation des dependances impossible.
  pause
  exit /b 1
)
if not exist ".env" copy /Y ".env.example" ".env" >nul
if not exist "credentials" mkdir credentials
if not exist "output" mkdir output
.venv\Scripts\python.exe -m py_compile stage_hunter.py stage_hunter_ui.py stage_hunter_web.py lancer_stage_hunter.py stage_hunter_scheduler.py
if errorlevel 1 (
  echo [ERREUR] Verification du code impossible.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m unittest -q test_stage_hunter_v6.py > "%TEMP%\stage_hunter_tests.log" 2>&1
if errorlevel 1 (
  type "%TEMP%\stage_hunter_tests.log"
  echo [ERREUR] Les tests automatiques ont detecte un probleme.
  pause
  exit /b 1
)
del /Q "%TEMP%\stage_hunter_tests.log" >nul 2>nul
echo.
echo Installation V6.2.7 terminee et verifiee.
echo Double-clique maintenant sur Lancer_Stage_Hunter.bat
pause
