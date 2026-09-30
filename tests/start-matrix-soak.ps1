# Detached local-only one-hour gate with a temporary system-awake request.
# No power-plan edits, display request, production calls, or user-profile cleanup.
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$Label
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = Join-Path $taskRoot 'test-results'
$taskReport = Join-Path $taskOutput "p4-matrix-cdp-soak-3600s-off-$Label.json"
$taskStdout = Join-Path $taskOutput "soak-$Label.stdout.log"
$taskStderr = Join-Path $taskOutput "soak-$Label.stderr.log"
foreach ($taskPath in @($taskReport, $taskStdout, $taskStderr)) {
    if (Test-Path -LiteralPath $taskPath) { throw "Refusing to overwrite: $taskPath" }
}
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskModules = Join-Path (Split-Path -Parent (Split-Path -Parent $taskNode)) 'node_modules'
if (-not (Test-Path -LiteralPath (Join-Path $taskModules 'playwright'))) {
    throw 'Bundled Playwright dependency path not found; do not run an unconfigured fixture'
}
$taskManifest = Join-Path $taskRoot 'build/web-release-main-default/manifest.json'
$taskSha = [Security.Cryptography.SHA256]::Create()
$taskStream = [IO.File]::OpenRead($taskManifest)
try { $taskDigest = [BitConverter]::ToString($taskSha.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
finally { $taskStream.Dispose(); $taskSha.Dispose() }
if ($taskDigest -ne '2d9d735cca2e84fe2e76113c6a2c513025ce925dccbbf89d3a9cb937bdce8885') {
    throw 'Frozen default release mismatch; do not start another artifact silently'
}
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class IPPPingSoakExecutionState {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@
$taskProcess = $null
$taskTimer = [Diagnostics.Stopwatch]::StartNew()
$taskExit = 1
try {
    # ES_CONTINUOUS | ES_SYSTEM_REQUIRED. No ES_DISPLAY_REQUIRED/AWAYMODE.
    $taskPrevious = [IPPPingSoakExecutionState]::SetThreadExecutionState([uint32]2147483649)
    if ($taskPrevious -eq 0) { throw 'Temporary system-awake request failed' }
    Write-Output "Temporary system-awake request active; no persistent power settings changed."
    Write-Output "Started UTC: $([DateTime]::UtcNow.ToString('o')); label: $Label"
    $env:TEST_RELEASE_ROOT = 'build/web-release-main-default'
    $env:SOAK_SECONDS = '3600'
    $env:SOAK_HOST = 'main-default'
    $env:SOAK_PATH = 'sweep'
    $env:MATRIX_SERIES_POINTS = '120'
    $env:SOAK_LABEL = $Label
    $env:SOAK_WIDTH = '1800'
    $env:SOAK_FORMAT = 'normal'
    $env:CDP_NETWORK = 'off'
    $env:NODE_PATH = $taskModules
    $taskDriver = Join-Path $PSScriptRoot 'matrix-cdp-soak.cjs'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskDriver + '"') `
        -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr
    $null = $taskProcess.Handle
    Write-Output "Owned Node PID: $($taskProcess.Id); report: $taskReport"
    while (-not $taskProcess.WaitForExit(30000)) {
        if ($taskTimer.Elapsed.TotalSeconds -gt 3900) {
            # Only the process tree spawned above, never arbitrary Chrome/Node.
            & taskkill.exe /PID $taskProcess.Id /T /F | Out-Null
            throw '65-minute safety limit reached; partial report is not acceptance'
        }
        if ([IPPPingSoakExecutionState]::SetThreadExecutionState([uint32]2147483649) -eq 0) {
            & taskkill.exe /PID $taskProcess.Id /T /F | Out-Null
            throw 'System-awake request lost; stopped owned test tree'
        }
    }
    $taskProcess.Refresh()
    if ($taskProcess.ExitCode -ne 0) { throw "Long-test driver failed: $($taskProcess.ExitCode); see $taskStderr" }
    & $taskNode (Join-Path $PSScriptRoot 'analyze-p4-soak.cjs') $taskReport
    if ($LASTEXITCODE -ne 0) { throw 'Original acceptance gate failed; no deployment permitted' }
    $taskExit = 0
} catch {
    Write-Error $_ -ErrorAction Continue
} finally {
    [IPPPingSoakExecutionState]::SetThreadExecutionState([uint32]2147483648) | Out-Null
    Write-Output "Temporary system-awake request released UTC: $([DateTime]::UtcNow.ToString('o'))"
}
exit $taskExit
