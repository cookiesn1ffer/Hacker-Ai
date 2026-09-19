@echo off
cd /d "%~dp0backend"

set PY=python
python --version >nul 2>&1
if errorlevel 1 (
  set PY=py -3
  py -3 --version >nul 2>&1
  if errorlevel 1 (
    echo Real Python is not installed. Run this in a terminal, then re-open this window:
    echo    winget install Python.Python.3.12
    echo Or download from python.org and tick "Add python.exe to PATH".
    pause
    exit /b 1
  )
)

if not exist venv\.installed (
  echo First run: setting up environment...
  rmdir /s /q venv 2>nul
  %PY% -m venv venv
  if errorlevel 1 ( echo venv creation failed & pause & exit /b 1 )
  call venv\Scripts\activate
  python -m pip install --upgrade pip
  pip install -r requirements.txt
  if errorlevel 1 ( echo pip install failed - send me the error above & pause & exit /b 1 )
  echo ok> venv\.installed
) else (
  call venv\Scripts\activate
)

REM open the browser a few seconds AFTER the server starts
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8000"
python app.py
echo.
echo Server stopped. Scroll up for the error.
pause
