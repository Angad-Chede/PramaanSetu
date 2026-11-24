# Start PramaanSetu on Windows: install, seed, build and run both services.
#
#   .\scripts\run.ps1              install if needed, seed if empty, start both
#   .\scripts\run.ps1 -Reset       drop the database and seed it again first
#   .\scripts\run.ps1 -Stop        stop both services
#   .\scripts\run.ps1 -Status      say what is running, and what is holding each port
#
# Both services are started detached so this window is free afterwards. That is also why
# they survive closing the terminal, which is the usual cause of "port already in use":
# the process ids are recorded under .run so -Stop can end exactly those, and anything
# else squatting on a port is named rather than killed silently.

[CmdletBinding()]
param(
    [switch]$Reset,
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$Stop,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$runDir = Join-Path $root ".run"

$API_PORT = 8000
$WEB_PORT = 3000

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Get-PortOwner($port) {
    $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $connection) { return $null }
    $procId = $connection.OwningProcess
    $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Port = $port
        ProcessId = $procId
        Name = if ($process) { $process.ProcessName } else { "unknown" }
        Started = if ($process) { $process.StartTime } else { $null }
    }
}

function Read-RecordedPid($name) {
    $file = Join-Path $runDir "$name.pid"
    if (-not (Test-Path $file)) { return $null }
    $value = (Get-Content $file -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    return [int]$value
}

function Write-RecordedPid($name, $procId) {
    if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Path $runDir | Out-Null }
    Set-Content -Path (Join-Path $runDir "$name.pid") -Value $procId -Encoding ascii
}

function Stop-Service($name, $port) {
    $stopped = $false

    # Prefer the process this script started; it is the one we know is ours.
    $recorded = Read-RecordedPid $name
    if ($recorded) {
        $process = Get-Process -Id $recorded -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "Stopping $name (pid $recorded)"
            Stop-Process -Id $recorded -Force -ErrorAction SilentlyContinue
            $stopped = $true
        }
        Remove-Item (Join-Path $runDir "$name.pid") -ErrorAction SilentlyContinue
    }

    # A previous run, or a manually started server, may still hold the port.
    $owner = Get-PortOwner $port
    if ($owner) {
        Write-Host "Stopping the process on port $port (pid $($owner.ProcessId), $($owner.Name))"
        Stop-Process -Id $owner.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }

    if ($stopped) { Start-Sleep -Milliseconds 700 }
    return $stopped
}

function Assert-PortFree($port, $label) {
    $owner = Get-PortOwner $port
    if ($owner) {
        Write-Host ""
        Write-Host "Port $port is still held by pid $($owner.ProcessId) ($($owner.Name))." -ForegroundColor Red
        Write-Host "$label cannot start. Close that process, or run: .\scripts\run.ps1 -Stop" -ForegroundColor Red
        exit 1
    }
}

function Show-Tail($path, $lines = 25) {
    if (Test-Path $path) {
        Write-Host "--- last $lines lines of $(Split-Path -Leaf $path) ---" -ForegroundColor DarkGray
        Get-Content $path -Tail $lines
    }
}

if ($Status) {
    Write-Step "PramaanSetu status"
    foreach ($pair in @(@{ Name = "api"; Port = $API_PORT }, @{ Name = "web"; Port = $WEB_PORT })) {
        $owner = Get-PortOwner $pair.Port
        if ($owner) {
            $recorded = Read-RecordedPid $pair.Name
            $ours = if ($recorded -eq $owner.ProcessId) { "started by this script" } else { "not started by this script" }
            Write-Host ("  port {0}: pid {1} ({2}), {3}" -f $owner.Port, $owner.ProcessId, $owner.Name, $ours)
        } else {
            Write-Host ("  port {0}: free" -f $pair.Port)
        }
    }
    exit 0
}

if ($Stop) {
    Write-Step "Stopping PramaanSetu"
    $a = Stop-Service "api" $API_PORT
    $b = Stop-Service "web" $WEB_PORT
    if ($a -or $b) { Write-Host "Stopped." -ForegroundColor Green }
    else { Write-Host "Nothing was running on ports $API_PORT or $WEB_PORT." }
    exit 0
}

Write-Step "Checking the toolchain"
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python 3.11 or later is required and was not found on PATH."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node 20 or later is required and was not found on PATH."
}
Write-Host "Python: $((python --version) 2>&1)"
Write-Host "Node:   $(node --version)"

if (-not $SkipInstall) {
    Write-Step "Installing backend dependencies"
    Push-Location $backend
    python -m pip install --disable-pip-version-check --quiet -r requirements-dev.txt
    Pop-Location

    Write-Step "Installing web dependencies"
    Push-Location $frontend
    if (Test-Path "package-lock.json") { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
    Pop-Location
}

Write-Step "Preparing the database"
Push-Location $backend
$databaseFile = Join-Path $backend "pramaansetu.db"
if ($Reset -or -not (Test-Path $databaseFile)) {
    if ($Reset) { Write-Host "Resetting and seeding" } else { Write-Host "No database found, seeding" }
    python -m app.seed --reset
} else {
    Write-Host "Database present. Pass -Reset to rebuild it."
}
Pop-Location

if (-not $SkipBuild) {
    Write-Step "Building the web application"
    Push-Location $frontend
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        throw "Building the web application failed."
    }
    Pop-Location
}

# Free both ports before either service starts, so a half-started stack cannot happen.
Write-Step "Clearing ports $API_PORT and $WEB_PORT"
Stop-Service "api" $API_PORT | Out-Null
Stop-Service "web" $WEB_PORT | Out-Null
Assert-PortFree $API_PORT "The API"
Assert-PortFree $WEB_PORT "The web application"

if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Path $runDir | Out-Null }
$apiLog = Join-Path $root "api.log"
$apiErrLog = Join-Path $root "api.err.log"
$webLog = Join-Path $root "web.log"
$webErrLog = Join-Path $root "web.err.log"

Write-Step "Starting the API on port $API_PORT"
$apiProcess = Start-Process -FilePath "python" `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$API_PORT" `
    -WorkingDirectory $backend `
    -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog `
    -WindowStyle Hidden -PassThru
Write-RecordedPid "api" $apiProcess.Id
Write-Host "pid $($apiProcess.Id)"

Write-Step "Starting the web application on port $WEB_PORT"
# On Windows "npm" is a shell script, not an executable, so Start-Process cannot launch
# it directly. cmd.exe resolves npm.cmd the same way an interactive prompt does.
$webProcess = Start-Process -FilePath "$env:ComSpec" `
    -ArgumentList "/c", "npm", "run", "start" `
    -WorkingDirectory $frontend `
    -RedirectStandardOutput $webLog -RedirectStandardError $webErrLog `
    -WindowStyle Hidden -PassThru
Write-RecordedPid "web" $webProcess.Id
Write-Host "pid $($webProcess.Id)"

Write-Step "Waiting for both services"
$ready = $false
foreach ($attempt in 1..40) {
    if ($apiProcess.HasExited) {
        Write-Host "The API exited during startup." -ForegroundColor Red
        Show-Tail $apiErrLog
        Show-Tail $apiLog
        exit 1
    }
    try {
        $api = Invoke-WebRequest -Uri "http://127.0.0.1:$API_PORT/api/v1/healthz" -UseBasicParsing -TimeoutSec 3
        $web = Invoke-WebRequest -Uri "http://127.0.0.1:$WEB_PORT/" -UseBasicParsing -TimeoutSec 5
        if ($api.StatusCode -eq 200 -and $web.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "The services did not come up within 80 seconds." -ForegroundColor Red
    Show-Tail $apiErrLog
    Show-Tail $webErrLog
    exit 1
}

# cmd.exe spawns node as a child, so the process that was started is not the one
# holding the port. Record the actual listeners now that both are up, which makes
# -Status truthful and -Stop precise.
foreach ($pair in @(@{ Name = "api"; Port = $API_PORT }, @{ Name = "web"; Port = $WEB_PORT })) {
    $owner = Get-PortOwner $pair.Port
    if ($owner) { Write-RecordedPid $pair.Name $owner.ProcessId }
}

Write-Step "Running the smoke test"
python (Join-Path $root "scripts\smoke_test.py")

Write-Host ""
Write-Host "PramaanSetu is running." -ForegroundColor Green
Write-Host "  Web application:  http://localhost:$WEB_PORT"
Write-Host "  API:              http://localhost:$API_PORT"
Write-Host "  API docs:         http://localhost:$API_PORT/docs"
Write-Host ""
Write-Host "Sign in at http://localhost:$WEB_PORT/signin. Every seeded account uses the password"
Write-Host "PramaanSetu@2026, and the sign-in page lists one account per role."
Write-Host ""
Write-Host "Stop with:   .\scripts\run.ps1 -Stop"
Write-Host "Check with:  .\scripts\run.ps1 -Status"
