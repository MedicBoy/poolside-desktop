<#
  mercury-tasks-setup.ps1
  ------------------------------------------------------------------
  (Re)register the two Windows scheduled tasks the Mercury runtime
  needs on this machine:

    MercuryAgent    - long-running daemon host + autostart at logon.
                      The task's action IS node.exe, so the daemon is the
                      task's own process (not a child). That means it is
                      never collateral damage when a task instance ends,
                      and an endless ExecutionTimeLimit keeps it alive.

    MercuryRestart  - the resumable restarter. Fires once a minute for a
                      bounded window; mercury-restart.ps1 advances a phase
                      file so a killed run is retried by the next one.

  Idempotent: safe to re-run after a Mercury update.

  Usage:
    powershell -File mercury-tasks-setup.ps1              # (re)register only
    powershell -File mercury-tasks-setup.ps1 -Restart      # also arm a restart
    powershell -File mercury-tasks-setup.ps1 -Disarm       # make it inert

  Author : PiePeP (for Nick)   2026-09-18
#>

param(
  [switch]$Restart,
  [switch]$Disarm
)

$ErrorActionPreference = 'Stop'

$Coding    = 'C:\Users\nicho\OneDrive\Desktop\Coding'
$NodeExe   = 'C:\Users\nicho\AppData\Local\hermes\node\node.exe'
$EntryJs   = 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js'
$HermesCwd = 'C:\Users\nicho\AppData\Local\hermes'
$Pwsh      = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$StateFile = Join-Path $Coding 'mercury-restart-state.json'
$User      = "$env:USERDOMAIN\$env:USERNAME"

# ---------------------------------------------------------------
# 1. MercuryAgent - daemon host + autostart
# ---------------------------------------------------------------
$agentAction = New-ScheduledTaskAction `
  -Execute $NodeExe `
  -Argument ('"' + $EntryJs + '" start --daemon') `
  -WorkingDirectory $HermesCwd

$agentTrigger = New-ScheduledTaskTrigger -AtLogOn -User $User
try { $agentTrigger.Delay = 'PT30S' } catch { Write-Output 'note: logon delay not settable, continuing' }

$agentSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$agentPrincipal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'MercuryAgent' `
  -Action $agentAction -Trigger $agentTrigger `
  -Settings $agentSettings -Principal $agentPrincipal -Force | Out-Null

Write-Output 'MercuryAgent  : registered (daemon host; autostart at logon +30s; no battery/idle stops; unlimited runtime)'

# ---------------------------------------------------------------
# 2. MercuryRestart - resumable restarter
# ---------------------------------------------------------------
$rsArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
          (Join-Path $Coding 'mercury-restart.ps1') + '" -GraceSeconds 70 -MaxAttempts 8'

$rsAction = New-ScheduledTaskAction -Execute $Pwsh -Argument $rsArgs

$startAt   = (Get-Date).AddSeconds(90)
$rsTrigger = New-ScheduledTaskTrigger -Once -At $startAt `
              -RepetitionInterval (New-TimeSpan -Minutes 1) `
              -RepetitionDuration (New-TimeSpan -Minutes 30)

$rsSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -StartWhenAvailable `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

$rsPrincipal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'MercuryRestart' `
  -Action $rsAction -Trigger $rsTrigger `
  -Settings $rsSettings -Principal $rsPrincipal -Force | Out-Null

Write-Output ('MercuryRestart: registered (first fire ' + $startAt.ToString('HH:mm:ss') + ', then every 1 min for 30 min)')

# ---------------------------------------------------------------
# 3. state file
# ---------------------------------------------------------------
if ($Disarm) {
  if (Test-Path $StateFile) { Remove-Item $StateFile -Force }
  Disable-ScheduledTask -TaskName 'MercuryRestart' -ErrorAction SilentlyContinue | Out-Null
  Write-Output 'state         : DISARMED (state file removed, task disabled)'
}
elseif ($Restart) {
  $now = Get-Date
  $o = [ordered]@{
    phase     = 'armed'
    attempts  = 0
    note      = 'armed by mercury-tasks-setup.ps1'
    armedAt   = $now.ToString('o')
    updatedAt = $now.ToString('o')
  }
  ($o | ConvertTo-Json -Compress) | Set-Content -Path $StateFile -Encoding UTF8
  Write-Output ('state         : ARMED at ' + $now.ToString('HH:mm:ss') + ' (grace 70s, then it takes effect)')
}
else {
  Write-Output 'state         : left as-is'
}
