<#
  mercury-restart.ps1  (v2)
  ------------------------------------------------------------------
  Resumable, retrying restarter for the Mercury node runtime.

  WHY v2 EXISTS
    v1 slept 60 seconds *inside a single* Task Scheduler run and was
    killed mid-sleep with STATUS_CONTROL_C_EXIT (0xC000013A). Because
    every step lived in that one doomed run, the restart never happened
    and the failure was silent.

    v2 removes the long in-script sleep (the grace period now comes from
    the task schedule) and stores its progress in a phase file. The task
    is triggered once a minute, so each run resumes exactly where the
    previous one stopped. A run may die at any point; the next run picks
    up and carries on. Convergence is guaranteed, not hoped for.

  PHASES
    armed -> stopping -> starting -> verifying -> waiting-tg -> done
                                                        \-> failed

  USAGE
    normal   : launched by the MercuryRestart scheduled task every minute
    dry run  : powershell -File mercury-restart.ps1 -DryRun   (read-only)

  Author : PiePeP (for Nick)   2026-09-18
#>

param(
  [int]$GraceSeconds = 70,
  [int]$MaxAttempts  = 8,
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# --- configuration -------------------------------------------------
$Coding      = 'C:\Users\nicho\OneDrive\Desktop\Coding'
$MercuryHome = 'C:\Users\nicho\.mercury'
$NodeExe     = 'C:\Users\nicho\AppData\Local\hermes\node\node.exe'
$EntryJs     = 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js'
$HermesCwd   = 'C:\Users\nicho\AppData\Local\hermes'
$DaemonTask  = 'MercuryAgent'
$SelfTask    = 'MercuryRestart'
$StateFile   = Join-Path $Coding 'mercury-restart-state.json'
$RunLog      = Join-Path $Coding 'mercury-restart-runs.log'
$IpcPort     = 6174

# --- logging -------------------------------------------------------
function Write-RunLog {
  param([string]$Message)
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Message
  Add-Content -Path $RunLog -Value $line -Encoding UTF8
}

# --- state ---------------------------------------------------------
function Get-RestartState {
  if (-not (Test-Path $StateFile)) { return $null }
  try { return (Get-Content $StateFile -Raw -ErrorAction Stop | ConvertFrom-Json) } catch { return $null }
}

function Set-RestartState {
  param([string]$Phase, [int]$Attempts, [string]$Note, $ArmedAt)
  $o = [ordered]@{
    phase     = $Phase
    attempts  = $Attempts
    note      = $Note
    armedAt   = $(if ($ArmedAt) { ([datetime]$ArmedAt).ToString('o') } else { $null })
    updatedAt = (Get-Date).ToString('o')
  }
  ($o | ConvertTo-Json -Compress) | Set-Content -Path $StateFile -Encoding UTF8
}

# --- probes --------------------------------------------------------
function Get-TrackedPid {
  param([string]$FileName)
  $p = Join-Path $MercuryHome $FileName
  if (-not (Test-Path $p)) { return 0 }
  $raw = Get-Content $p -Raw -ErrorAction SilentlyContinue
  if ($null -eq $raw) { return 0 }
  $n = 0
  if ([int]::TryParse($raw.Trim(), [ref]$n)) { return $n }
  return 0
}

function Test-ProcAlive {
  param([int]$ProcId)
  if ($ProcId -le 0) { return $false }
  return ($null -ne (Get-Process -Id $ProcId -ErrorAction SilentlyContinue))
}

function Test-IpcPort {
  return ($null -ne (Get-NetTCPConnection -State Listen -LocalPort $IpcPort -ErrorAction SilentlyContinue))
}

function Test-DaemonUp {
  $d = Get-TrackedPid 'daemon.pid'
  return ((Test-ProcAlive $d) -and (Test-IpcPort))
}

function Test-TelegramSocket {
  $d = Get-TrackedPid 'daemon.pid'
  if (-not (Test-ProcAlive $d)) { return $false }
  $conns = Get-NetTCPConnection -State Established -OwningProcess $d -ErrorAction SilentlyContinue |
           Where-Object { $_.RemotePort -eq 443 -and ($_.RemoteAddress -like '149.154.*' -or $_.RemoteAddress -like '91.108.*') }
  return ($null -ne $conns)
}

function Stop-TrackedProc {
  param([string]$PidFile, [string]$Label)
  $tp = Get-TrackedPid $PidFile
  if (-not (Test-ProcAlive $tp)) {
    Write-RunLog ('SKIP     ' + $Label + ' pid ' + $tp + ' not running')
    return
  }
  Write-RunLog ('STOP     ' + $Label + ' pid ' + $tp + ' (graceful)')
  try { Stop-Process -Id $tp -ErrorAction Stop } catch {
    Write-RunLog ('WARN     graceful stop threw: ' + $_.Exception.Message)
  }
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline -and (Test-ProcAlive $tp)) { Start-Sleep -Milliseconds 250 }
  if (Test-ProcAlive $tp) {
    Write-RunLog ('FORCE    ' + $Label + ' pid ' + $tp + ' (hard kill)')
    Stop-Process -Id $tp -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 750
  }
  if (Test-ProcAlive $tp) {
    Write-RunLog ('FAIL     ' + $Label + ' pid ' + $tp + ' survived')
  } else {
    Write-RunLog ('OK       ' + $Label + ' pid ' + $tp + ' stopped')
  }
}

function Start-DaemonProcess {
  $env:MERCURY_HOME = $MercuryHome
  Write-RunLog ('START    schtasks /run /tn ' + $DaemonTask)
  try { schtasks /run /tn $DaemonTask 2>&1 | Out-Null } catch {
    Write-RunLog ('WARN     schtasks /run threw: ' + $_.Exception.Message)
  }
  $deadline = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $deadline -and -not (Test-DaemonUp)) { Start-Sleep -Seconds 2 }

  if (-not (Test-DaemonUp)) {
    Write-RunLog 'FALLBACK direct detached spawn of node daemon'
    $outLog = Join-Path $Coding 'mercury-daemon.out.log'
    $errLog = Join-Path $Coding 'mercury-daemon.err.log'
    try {
      Start-Process -FilePath $NodeExe `
                    -ArgumentList @($EntryJs, 'start', '--daemon') `
                    -WorkingDirectory $HermesCwd `
                    -WindowStyle Hidden `
                    -RedirectStandardOutput $outLog `
                    -RedirectStandardError $errLog `
                    -ErrorAction SilentlyContinue | Out-Null
    } catch {
      Write-RunLog ('WARN     fallback spawn threw: ' + $_.Exception.Message)
    }
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and -not (Test-DaemonUp)) { Start-Sleep -Seconds 2 }
  }
  return (Test-DaemonUp)
}

# ===================================================================
# MAIN
# ===================================================================
$st = Get-RestartState
if ($null -eq $st) {
  if ($DryRun) { Write-Output 'DRYRUN: no state file (idle) - task would exit immediately' }
  exit 0
}

$phase    = [string]$st.phase
$attempts = 0
if ($null -ne $st.attempts) { $attempts = [int]$st.attempts }
$armedAt  = $null
if ($null -ne $st.armedAt -and $st.armedAt) { $armedAt = [datetime]$st.armedAt }

$order = @{ 'armed' = 0; 'stopping' = 1; 'starting' = 2; 'verifying' = 3; 'waiting-tg' = 4; 'done' = 5; 'failed' = 6 }
if (-not $order.ContainsKey($phase)) { $phase = 'armed' }
$p = $order[$phase]

Write-RunLog ('RUN      phase=' + $phase + ' attempts=' + $attempts + ' dryrun=' + [bool]$DryRun)

if ($phase -eq 'done' -or $phase -eq 'failed') {
  if ($DryRun) { Write-Output ('DRYRUN: terminal phase ' + $phase + ' - nothing to do') }
  exit 0
}

# --- phase 0: armed (grace + patch sanity) -------------------------
if ($p -le 0) {
  if ($null -ne $armedAt) {
    $elapsed = ((Get-Date) - $armedAt).TotalSeconds
    if ($elapsed -lt $GraceSeconds) {
      Write-RunLog ('WAIT     grace ' + [int]$elapsed + 's of ' + $GraceSeconds + 's')
      if ($DryRun) { Write-Output ('DRYRUN: in grace, ' + [int]$elapsed + 's of ' + $GraceSeconds + 's') }
      exit 0
    }
  }

  $patchCount  = (Select-String -Path $EntryJs -SimpleMatch -Pattern 'type: "disabled"' -ErrorAction SilentlyContinue | Measure-Object).Count
  $redactCount = (Select-String -Path $EntryJs -SimpleMatch -Pattern 'redactEnvBackedSecrets' -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-RunLog ('PATCH    thinking:disabled x' + $patchCount + '   redaction x' + $redactCount)

  if ($patchCount -lt 2 -or $redactCount -lt 2) {
    $attempts++
    Set-RestartState 'failed' $attempts 'PATCH-WIPED' $armedAt
    Write-RunLog 'ABORT    patch markers missing - refuse to restart into unpatched bundle'
    exit 3
  }

  if ($DryRun) {
    Write-Output ('DRYRUN: patches OK; would stop foreground + daemon, then start daemon')
    Write-Output ('  foreground.pid = ' + (Get-TrackedPid 'foreground.pid'))
    Write-Output ('  daemon.pid     = ' + (Get-TrackedPid 'daemon.pid'))
    exit 0
  }

  Set-RestartState 'stopping' $attempts 'patches verified' $armedAt
  $phase = 'stopping'; $p = 1
}

# --- phase 1: stopping --------------------------------------------
if ($p -eq 1) {
  Stop-TrackedProc -PidFile 'foreground.pid' -Label 'foreground'
  Stop-TrackedProc -PidFile 'daemon.pid'     -Label 'daemon'
  Start-Sleep -Seconds 2

  $strays = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*mercury-agent*' }
  foreach ($s in $strays) {
    Write-RunLog ('SWEEP    stray mercury node pid ' + $s.ProcessId)
    Stop-Process -Id $s.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2

  foreach ($f in @('daemon.pid', 'foreground.pid')) {
    $fp = Join-Path $MercuryHome $f
    if (Test-Path $fp) {
      Remove-Item $fp -Force -ErrorAction SilentlyContinue
      Write-RunLog ('CLEAN    removed stale ' + $f)
    }
  }

  Set-RestartState 'starting' $attempts 'runtimes stopped' $armedAt
  $phase = 'starting'; $p = 2
}

# --- phase 2: starting --------------------------------------------
if ($p -eq 2) {
  if (Test-DaemonUp) {
    Write-RunLog 'DAEMON   already up'
    Set-RestartState 'verifying' $attempts 'daemon already up' $armedAt
    $phase = 'verifying'; $p = 3
  } else {
    $ok = Start-DaemonProcess
    if ($ok) {
      Write-RunLog ('DAEMON   up pid ' + (Get-TrackedPid 'daemon.pid'))
      Set-RestartState 'verifying' $attempts 'daemon up' $armedAt
      $phase = 'verifying'; $p = 3
    } else {
      $attempts++
      Write-RunLog ('RETRY    daemon not up (attempt ' + $attempts + ' of ' + $MaxAttempts + ')')
      if ($attempts -ge $MaxAttempts) {
        Set-RestartState 'failed' $attempts 'daemon never came up' $armedAt
        exit 4
      }
      Set-RestartState 'starting' $attempts 'daemon not up yet' $armedAt
      exit 0
    }
  }
}

# --- phase 3: verifying (settle, confirm it did not die) ----------
if ($p -eq 3) {
  if (Test-DaemonUp) {
    Set-RestartState 'waiting-tg' $attempts 'daemon verified alive' $armedAt
    $phase = 'waiting-tg'; $p = 4
  } else {
    $attempts++
    Write-RunLog ('FAIL     daemon died after start (attempt ' + $attempts + ' of ' + $MaxAttempts + ')')
    if ($attempts -ge $MaxAttempts) {
      Set-RestartState 'failed' $attempts 'daemon died post-start' $armedAt
      exit 4
    }
    Set-RestartState 'starting' $attempts 'daemon died - retrying' $armedAt
    exit 0
  }
}

# --- phase 4: waiting for Telegram -------------------------------
if ($p -eq 4) {
  if (Test-TelegramSocket) {
    Set-RestartState 'done' $attempts 'telegram connected' $armedAt
    Write-RunLog 'RESULT   HEALTHY - patched daemon up, IPC listening, Telegram connected'
    try { schtasks /change /tn $SelfTask /disable 2>&1 | Out-Null } catch { }
    exit 0
  }
  $attempts++
  Write-RunLog ('WAIT     telegram socket not seen yet (attempt ' + $attempts + ' of ' + $MaxAttempts + ')')
  if ($attempts -ge $MaxAttempts) {
    Set-RestartState 'failed' $attempts 'telegram socket never appeared' $armedAt
    Write-RunLog 'RESULT   FAILED - daemon up but Telegram never connected'
    exit 5
  }
  Set-RestartState 'waiting-tg' $attempts 'telegram pending' $armedAt
  exit 0
}

exit 0
