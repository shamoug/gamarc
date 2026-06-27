@echo off
REM ===========================================================================
REM  Nexus Arcade - local launcher
REM  Serves the static files over HTTP (required for ES modules) and opens
REM  the arcade in your default browser. No installation needed beyond Python.
REM ===========================================================================

setlocal
cd /d "%~dp0"

set PORT=8000

REM --- Find a Python launcher ------------------------------------------------
set PY=
where py >nul 2>nul && set PY=py
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY where python3 >nul 2>nul && set PY=python3

if not defined PY (
  echo.
  echo  Python was not found on your PATH.
  echo  Install Python from https://www.python.org/downloads/ and try again,
  echo  or serve this folder with any other static server.
  echo.
  pause
  exit /b 1
)

echo.
echo  Starting Nexus Arcade at http://localhost:%PORT%
echo  Press Ctrl+C in this window to stop the server.
echo.

REM Open the browser shortly after the server comes up.
start "" cmd /c "timeout /t 1 >nul & start http://localhost:%PORT%/index.html"

REM Run the server in the foreground (keeps this window alive).
%PY% -m http.server %PORT%

endlocal
