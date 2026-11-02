@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
set "BUILD_EXIT=1"
set "ASSET_VSIX=%~1"
if /i "%~1"=="--help" goto help
where node.exe >nul 2>nul
if errorlevel 1 (
 echo ERROR: Install Node.js LTS with npm, then open a new terminal.
 goto finish
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
 echo ERROR: npm.cmd is not on PATH. Reinstall Node.js with npm enabled.
 goto finish
)
node.exe -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
 echo ERROR: Node.js 22.13 or newer is required.
 goto finish
)
echo [1/6] Installing dependencies...
call npm ci
if errorlevel 1 goto failed
echo [2/6] Running tests...
call npm test
if errorlevel 1 goto failed
echo [3/6] Preparing offline assets...
if defined ASSET_VSIX (
 powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\import-offline-assets.ps1" -VsixPath "%ASSET_VSIX%"
 if errorlevel 1 goto failed
)
call npm run test:package >nul 2>nul
if not errorlevel 1 goto assets_ready
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-windows-assets.ps1"
if errorlevel 1 goto failed

:assets_ready
echo [4/6] Verifying all voices, runtimes and the bundled local model...
call npm run test:package
if errorlevel 1 goto failed
echo [5/6] Building extension...
call npm run webpack
if errorlevel 1 goto failed
echo [6/6] Creating installable VSIX...
if not exist artifacts mkdir artifacts
if not exist artifacts goto failed
call npx --yes --package @vscode/vsce@3.6.0 vsce package --out artifacts\markdown-listening-offline.vsix
if errorlevel 1 goto failed
echo.
echo SUCCESS: %CD%\artifacts\markdown-listening-offline.vsix
echo Install in VS Code: Extensions - ... - Install from VSIX.
set "BUILD_EXIT=0"
goto finish
:failed
echo.
echo BUILD FAILED. See the error above. No success is reported for a failed step.
goto finish
:help
echo Usage: build.bat [path-to-existing-offline.vsix]
echo Installs npm dependencies, tests, restores/builds offline assets and packages VSIX.
echo Requirements: Node.js 22.13+ and internet. Missing assets require either
 echo an existing complete offline VSIX, or Windows Python 3.12+ and 7-Zip.
set "BUILD_EXIT=0"
:finish
popd
if not defined CI pause
exit /b %BUILD_EXIT%
