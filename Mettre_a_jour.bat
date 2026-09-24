@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "NO_COLOR=1"
echo ========================================
echo   STAGE HUNTER V6.2.7 - MISE A JOUR
echo ========================================
if not exist ".venv\Scripts\python.exe" (
  echo [INFO] Installation absente. Lancement de install.bat...
  call install.bat
  exit /b %errorlevel%
)
echo Mise a jour des dependances sans toucher aux profils, identifiants ni resultats...
.venv\Scripts\python.exe -m pip install -r requirements-local.txt
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m py_compile stage_hunter.py stage_hunter_ui.py stage_hunter_web.py lancer_stage_hunter.py stage_hunter_scheduler.py
if errorlevel 1 goto :error
.venv\Scripts\python.exe -m unittest -q test_stage_hunter_v6.py > "%TEMP%\stage_hunter_tests.log" 2>&1
if errorlevel 1 goto :error
del /Q "%TEMP%\stage_hunter_tests.log" >nul 2>nul
echo.
echo Mise a jour verifiee. Tes dossiers config, credentials et output sont conserves.
pause
exit /b 0
:error
echo.
if exist "%TEMP%\stage_hunter_tests.log" type "%TEMP%\stage_hunter_tests.log"
echo [ERREUR] La mise a jour ou la verification a echoue.
pause
exit /b 1
