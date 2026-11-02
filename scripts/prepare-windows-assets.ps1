$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Find-Python {
    foreach ($candidate in @('py', 'python', 'python3')) {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) {
            & $candidate -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        }
    }
    return $null
}
function Install-Prerequisite($id) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Install $id manually, then rerun build.bat. Windows Package Manager (winget) is unavailable."
    }
    Write-Host "Installing build prerequisite: $id"
    & winget install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Installation failed: $id ($LASTEXITCODE). Install it manually, then rerun build.bat." }
    # Refresh PATH for this build after installation.
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
$python = Find-Python
if (-not $python) {
    Install-Prerequisite 'Python.Python.3.12'
    $python = Find-Python
    if (-not $python) { throw 'Python installed but is not on PATH yet. Open a new terminal and rerun build.bat.' }
}
& cmd.exe /d /c 'node scripts/verify-voices.js >nul 2>nul'
if ($LASTEXITCODE -ne 0) {
    & $python scripts/bundle_voices.py
    if ($LASTEXITCODE -ne 0) { throw 'Voice download failed. See the error above.' }
}
& cmd.exe /d /c 'node scripts/verify-runtime.js >nul 2>nul'
if ($LASTEXITCODE -ne 0) {
    $sevenzip = Get-Command 7z -ErrorAction SilentlyContinue
    $installed = Test-Path (Join-Path $env:ProgramFiles '7-Zip\7z.exe')
    if (-not $sevenzip -and -not $installed) { Install-Prerequisite '7zip.7zip' }
    & $python scripts/bundle_runtime.py
    if ($LASTEXITCODE -ne 0) { throw 'Runtime preparation failed. See the error above.' }
}
& cmd.exe /d /c 'node scripts/verify-ai.js >nul 2>nul'
if ($LASTEXITCODE -ne 0) {
    & $python scripts/bundle_ai.py
    if ($LASTEXITCODE -ne 0) { throw 'Local AI bundle preparation failed. See the error above.' }
}
Write-Host 'Offline assets prepared using native Windows tools. WSL is not required.'
