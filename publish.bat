@echo off
REM ============================================================================
REM  publish.bat - One-click publisher for Nexus Arcade
REM  ---------------------------------------------------------------------------
REM  Pushes this folder to https://github.com/shamoug/gamarc and turns on
REM  GitHub Pages, so the arcade is playable online at:
REM        https://shamoug.github.io/gamarc/
REM
REM  Safe to run repeatedly: it initialises git on first run, then just commits
REM  and pushes whatever changed. Requires Git for Windows (already installed)
REM  and a GitHub sign-in (GitHub Desktop or a previous push handles this).
REM ============================================================================

setlocal enableextensions
cd /d "%~dp0"

set "OWNER=shamoug"
set "REPO=gamarc"
set "BRANCH=main"
set "REPO_URL=https://github.com/%OWNER%/%REPO%.git"
set "SITE_URL=https://%OWNER%.github.io/%REPO%/"

echo.
echo ===============================================
echo   Publishing Nexus Arcade to GitHub
echo   Repo: %REPO_URL%
echo ===============================================
echo.

REM --- 0. Sanity: is git available? ------------------------------------------
git --version >nul 2>&1
if errorlevel 1 (
  echo [X] Git is not installed or not on PATH.
  echo     Install Git for Windows from https://git-scm.com/download/win and re-run.
  goto :fail
)

REM --- 1. Initialise the repository on first run -----------------------------
if not exist ".git" (
  echo [*] Initialising a new git repository...
  git init >nul
  if errorlevel 1 goto :fail
)

REM Make sure we are on the 'main' branch (rename whatever HEAD points at).
git branch -M %BRANCH%

REM --- 2. Point 'origin' at the GitHub repo -----------------------------------
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo [*] Adding remote 'origin' -^> %REPO_URL%
  git remote add origin %REPO_URL%
) else (
  git remote set-url origin %REPO_URL%
)

REM --- 3. Stage and commit any changes ---------------------------------------
echo [*] Staging files...
git add -A

REM 'git diff --cached --quiet' exits 1 when there is something staged.
git diff --cached --quiet
if errorlevel 1 (
  echo [*] Committing...
  git commit -m "Publish Nexus Arcade" >nul
) else (
  echo [=] No file changes since the last commit.
)

REM --- 4. Push to GitHub ------------------------------------------------------
echo [*] Pushing to %BRANCH%...
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo [X] Push failed. A browser window may have opened asking you to sign in
  echo     to GitHub - complete that and run publish.bat again.
  goto :fail
)
echo [OK] Code pushed.

REM --- 5. Turn on GitHub Pages (best effort, via the GitHub API) --------------
echo [*] Ensuring GitHub Pages is enabled...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $q = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10; $out = $q | git credential fill; $tok = ($out | Where-Object {$_ -like 'password=*'}) -replace '^password=',''; if (-not $tok) { Write-Host '[!] No saved GitHub token found - enable Pages once at https://github.com/%OWNER%/%REPO%/settings/pages (Source: main, /root).'; exit 0 }; $h = @{ Authorization = 'Bearer ' + $tok; Accept='application/vnd.github+json'; 'User-Agent'='nexus-arcade-publish'; 'X-GitHub-Api-Version'='2022-11-28' }; $b = @{ source = @{ branch='%BRANCH%'; path='/' } } | ConvertTo-Json -Compress; try { Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/%OWNER%/%REPO%/pages' -Headers $h -Body $b -ContentType 'application/json' | Out-Null; Write-Host '[OK] GitHub Pages enabled.' } catch { $c=0; try { $c=[int]$_.Exception.Response.StatusCode } catch {}; if ($c -eq 409) { Write-Host '[=] GitHub Pages was already enabled.' } else { Write-Host ('[!] Could not auto-enable Pages (HTTP ' + $c + '). Enable once at https://github.com/%OWNER%/%REPO%/settings/pages') } }"

echo.
echo ===============================================
echo   Done!  Your game station will be live at:
echo       %SITE_URL%
echo   (first deploy can take ~1 minute to go live)
echo ===============================================
echo.
endlocal
exit /b 0

:fail
echo.
echo Publish aborted.
endlocal
exit /b 1
