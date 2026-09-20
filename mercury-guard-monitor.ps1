#Requires -Version 5.1
<#
.SYNOPSIS
    Post-restart verifier and recurring watchdog for the Mercury Agent 1.2.7
    DeepSeek bug: HTTP 400 "Thinking mode does not support this tool_choice".

.DESCRIPTION
    Runs six independent checks and prints one verdict:

      1. PATCH INTEGRITY  Both prepareStep forced-tool sites carry
                          providerOptions.deepseek.thinking.type = "disabled".
      2. JOURNAL HOOK     provider-utils postToApi journals failing provider
                          responses to .mercury\provider-errors.jsonl.
      3. RESTART STATUS   Is the running runtime process newer than the patch?
                          (The bundle is loaded at startup, so an un-restarted
                           process still executes the OLD code.)
      4. RECURRENCE SCAN  Any journaled provider error since the patch landed?
                          An empty journal after a restart IS the proof of no
                          recurrence, because the original 400 was never
                          written to disk before the hook existed.
      5. PROTOCOL PROBE   Live DeepSeek API, both directions:
                            A) thinking DEFAULTS ON + tool_choice required -> expect 400
                            B) thinking DISABLED    + tool_choice required -> expect 200
                          Credentials are read from process env, then
                          ~/.mercury/.env, then mercury.yaml (in that order).
      6. SECRETS AT REST  mercury.yaml holds no non-empty credential fields, and
                          ~/.mercury/.env supplies DEEPSEEK_API_KEY +
                          TELEGRAM_BOT_TOKEN to the runtime via dotenv.
                          A plaintext secret reappearing in mercury.yaml means
                          a pre-restart process rewrote the config.

.PARAMETER Quiet
    Print only the verdict lines.

.PARAMETER Journal
    Append a one-line summary to .mercury\guard-monitor-history.log.

.PARAMETER SkipProbe
    Skip check 5 (no network calls).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\mercury-guard-monitor.ps1

.NOTES
    Local stopgap only. Any Mercury reinstall/update reverts these patches.
#>
[CmdletBinding()]
param(
    [switch]$Quiet,
    [switch]$Journal,
    [switch]$SkipProbe
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# ---------------------------------------------------------------- paths -----
$script:P = @{
    UserHome = $env:USERPROFILE
    Home     = Join-Path $env:USERPROFILE '.mercury'
    Config   = Join-Path $env:USERPROFILE '.mercury\mercury.yaml'
    EnvFile  = Join-Path $env:USERPROFILE '.mercury\.env'
    Dist     = 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js'
    Provider = 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\node_modules\@ai-sdk\provider-utils\dist\index.mjs'
    Errors   = Join-Path $env:USERPROFILE '.mercury\provider-errors.jsonl'
    History  = Join-Path $env:USERPROFILE '.mercury\guard-monitor-history.log'
    Hermes   = 'C:\Users\nicho\AppData\Local\hermes\logs'
}

$script:Findings = [ordered]@{}

function Say {
    param([string]$Text, [string]$Colour = 'Gray')
    if (-not $Quiet) { Write-Host $Text -ForegroundColor $Colour }
}

function Head {
    param([string]$Text)
    if (-not $Quiet) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
}

function Ok    { param([string]$t) Write-Host "  [ OK ] $t"   -ForegroundColor Green }
function Warn  { param([string]$t) Write-Host "  [WARN] $t"   -ForegroundColor Yellow }
function Bad   { param([string]$t) Write-Host "  [FAIL] $t"   -ForegroundColor Red }
function Info  { param([string]$t) if (-not $Quiet) { Write-Host "         $t" -ForegroundColor DarkGray } }

# ------------------------------------------------------- 1. patch integrity --
Head 'CHECK 1 - Patch integrity (Fix A forced-tool sites)'

$forceSites = @()
if (Test-Path $P.Dist) {
    $forceSites = @(
        Select-String -Path $P.Dist -Pattern 'toolChoice:\s*"required"' |
            Where-Object { $_.Line.Trim() -notmatch '^//' }
    )
}
$patchedSites = @($forceSites | Where-Object { $_.Line -match "type:\s*`"disabled`"" })

if ($forceSites.Count -eq 0) {
    Bad "No forced-tool sites found - dist\index.js missing or unexpectedly changed."
    $Findings.Patch = 'MISSING'
} elseif ($patchedSites.Count -eq $forceSites.Count) {
    Ok "All $($forceSites.Count) forced-tool sites carry thinking:disabled."
    $Findings.Patch = 'PATCHED'
    foreach ($s in $patchedSites) { Info "line $($s.LineNumber)" }
} else {
    Bad "$($patchedSites.Count)/$($forceSites.Count) forced-tool sites patched."
    foreach ($s in $forceSites) {
        $mark = if ($s.Line -match "type:\s*`"disabled`"") { 'patched' } else { 'NOT PATCHED' }
        Info "line $($s.LineNumber) -> $mark"
    }
    $Findings.Patch = 'PARTIAL'
}

# ---------------------------------------------------------- 2. journal hook --
Head 'CHECK 2 - Provider-error journal hook'

$hookHits = @()
if (Test-Path $P.Provider) {
    $hookHits = @(Select-String -Path $P.Provider -Pattern 'provider-errors\.jsonl' -ErrorAction SilentlyContinue)
}
if ($hookHits.Count -ge 1) {
    Ok "Journal hook present (provider-utils line $($hookHits[0].LineNumber))."
    $Findings.Hook = 'PRESENT'
} else {
    Warn 'Journal hook NOT present - recurrence will be invisible on disk.'
    $Findings.Hook = 'ABSENT'
}

# --------------------------------------------------------- 3. restart status --
Head 'CHECK 3 - Restart status'

$patchTime = $null
if (Test-Path $P.Dist)         { $patchTime = (Get-Item $P.Dist).LastWriteTime }
$providerTime = $null
if (Test-Path $P.Provider)     { $providerTime = (Get-Item $P.Provider).LastWriteTime }
if ($providerTime -and ($null -eq $patchTime -or $providerTime -gt $patchTime)) { $patchTime = $providerTime }

Info "Newest patch write: $(if ($patchTime) { $patchTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'n/a' })"

$procs = @()
try {
    $procs = @(
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*mercury-agent*' }
    )
} catch {
    Warn "Could not enumerate processes: $($_.Exception.Message)"
}

$liveCount = 0
$newestStart = $null
foreach ($proc in $procs) {
    $started = $proc.CreationDate
    if ($started -and ($null -eq $newestStart -or $started -gt $newestStart)) { $newestStart = $started }
    $mode = if ($proc.CommandLine -like '*--foreground*') { 'foreground' } elseif ($proc.CommandLine -like '*--daemon*') { 'daemon' } else { 'other' }
    $fresh = ($patchTime -and $started -and $started -gt $patchTime)
    if ($fresh) { $liveCount++ }
    Info "pid $($proc.ProcessId) $mode started $($started.ToString('yyyy-MM-dd HH:mm:ss')) -> $(if ($fresh) { 'AFTER patch (loaded)' } else { 'BEFORE patch (STALE)' })"
}

if ($procs.Count -eq 0) {
    Warn 'No mercury-agent process running.'
    $Findings.Restart = 'NOT RUNNING'
} elseif ($liveCount -gt 0) {
    Ok "$liveCount/$($procs.Count) runtime process(es) started after the patch - fix is LIVE."
    $Findings.Restart = 'LIVE'
} else {
    Warn "All $($procs.Count) runtime process(es) predate the patch - RESTART STILL PENDING."
    $Findings.Restart = 'PENDING'
}

# -------------------------------------------------------- 4. recurrence scan --
Head 'CHECK 4 - Recurrence scan'

$journalEntries = @()
if (Test-Path $P.Errors) {
    $journalEntries = @(Get-Content $P.Errors -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })
}

$thinkingErrors = @($journalEntries | Where-Object { $_ -match 'Thinking mode does not support this tool_choice' })
$anyAfterPatch  = @()
if ($patchTime) {
    foreach ($entry in $journalEntries) {
        if ($entry -match '"at":"([^"]+)"') {
            $stamp = $null
            try { $stamp = [datetime]::Parse($Matches[1]).ToLocalTime() } catch { }
            if ($stamp -and $stamp -gt $patchTime) { $anyAfterPatch += $entry }
        }
    }
}

if ($journalEntries.Count -eq 0) {
    Ok 'Journal empty - no provider error has occurred since the hook was installed.'
    $Findings.Recurrence = 'NONE'
} else {
    Info "$($journalEntries.Count) journaled provider error(s); $($anyAfterPatch.Count) after the patch."
    if ($thinkingErrors.Count -gt 0) {
        Bad "$($thinkingErrors.Count) occurrence(s) of the ORIGINAL tool_choice/thinking 400."
        foreach ($e in ($thinkingErrors | Select-Object -Last 3)) {
            if ($e.Length -gt 220) { Info $e.Substring(0, 220) } else { Info $e }
        }
        $Findings.Recurrence = 'TOOL_CHOICE_400'
    } elseif ($anyAfterPatch.Count -gt 0) {
        Warn 'Other provider error(s) after the patch (not the tool_choice bug) - inspect journal.'
        $Findings.Recurrence = 'OTHER'
    } else {
        Ok 'Only pre-patch entries present - nothing new.'
        $Findings.Recurrence = 'NONE'
    }
}

# --------------------------------------------------------- 5. protocol probe --
Head 'CHECK 5 - Live protocol probe (DeepSeek API)'

if ($SkipProbe) {
    Warn 'Skipped (-SkipProbe).'
    $Findings.ProbeA = 'SKIPPED'
    $Findings.ProbeB = 'SKIPPED'
} else {
    # --- credentials: process env -> .env -> mercury.yaml ------------------
    # Secrets now live in ~/.mercury/.env after the migration, so reading
    # mercury.yaml alone is no longer sufficient.
    $key = $null; $base = $null; $model = $null

    if ($env:DEEPSEEK_API_KEY) { $key = $env:DEEPSEEK_API_KEY }

    if (-not $key -and (Test-Path $P.EnvFile)) {
        foreach ($line in (Get-Content $P.EnvFile)) {
            if ($line -match '^\s*DEEPSEEK_API_KEY\s*=\s*(.+)$') {
                $key = $Matches[1].Trim()
                if ($key.StartsWith('"') -and $key.EndsWith('"') -and $key.Length -ge 2) {
                    $key = $key.Substring(1, $key.Length - 2)
                }
            }
        }
    }

    if (Test-Path $P.Config) {
        $inDeepseek = $false
        foreach ($line in (Get-Content $P.Config)) {
            if ($line -match '^\s{2}(\w+):\s*$') { $inDeepseek = ($Matches[1] -eq 'deepseek') }
            if ($inDeepseek) {
                if (-not $key   -and $line -match 'apiKey:\s*"?(sk-\S+?)"?\s*$') { $key   = $Matches[1] }
                if (-not $base  -and $line -match 'baseUrl:\s*(\S+)\s*$')            { $base  = $Matches[1] }
                if (-not $model -and $line -match 'model:\s*(\S+)\s*$')              { $model = $Matches[1] }
            }
        }
    }

    if (-not $key -or -not $base) {
        Warn 'Could not resolve DeepSeek apiKey/baseUrl (env, .env, mercury.yaml) - probe skipped.'
        $Findings.ProbeA = 'NO_CREDENTIALS'
        $Findings.ProbeB = 'NO_CREDENTIALS'
    } else {
        $url = ($base.TrimEnd('/')) + '/chat/completions'
        Info "endpoint $url   model $model"

        Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
        $client = New-Object System.Net.Http.HttpClient
        $client.Timeout = [TimeSpan]::FromSeconds(60)
        $client.DefaultRequestHeaders.Authorization =
            New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $key)

        $tool = @{
            type     = 'function'
            function = @{
                name        = 'noop'
                description = 'Do nothing.'
                parameters  = @{ type = 'object'; properties = @{ a = @{ type = 'string' } }; required = @('a') }
            }
        }
        $payload = @{
            model       = $model
            messages    = @(@{ role = 'user'; content = 'Call the noop tool with a=1.' })
            tools       = @($tool)
            tool_choice = 'required'
            stream      = $false
            max_tokens  = 64
        }

        function Invoke-Probe {
            param([string]$Label, [hashtable]$Body, [string]$Expect)
            $json    = $Body | ConvertTo-Json -Depth 12 -Compress
            $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
            try {
                $resp = $script:client.PostAsync($script:probeUrl, $content).Result
                $code = [int]$resp.StatusCode
                $text = $resp.Content.ReadAsStringAsync().Result
            } catch {
                $code = -1
                $text = $_.Exception.Message
            }
            $snippet = if ($text.Length -gt 200) { $text.Substring(0, 200) } else { $text }
            if ($code -eq $Expect) {
                Write-Host "  [ OK ] $Label -> HTTP $code (expected $Expect)" -ForegroundColor Green
            } else {
                Write-Host "  [FAIL] $Label -> HTTP $code (expected $Expect)" -ForegroundColor Red
            }
            Info $snippet
            return $code
        }

        # script scope so the function can see them
        $script:client   = $client
        $script:probeUrl = $url

        $codeA = Invoke-Probe -Label 'A: thinking DEFAULT  + tool_choice required' -Body $payload -Expect 400
        $Findings.ProbeA = $codeA

        $payloadB = $payload.Clone()
        $payloadB['thinking'] = @{ type = 'disabled' }
        $codeB = Invoke-Probe -Label 'B: thinking DISABLED + tool_choice required' -Body $payloadB -Expect 200
        $Findings.ProbeB = $codeB

        if ($codeA -eq 400 -and $codeB -eq 200) {
            Ok 'Mechanism CONFIRMED: default thinking + forced tool choice is rejected; disabling thinking fixes it.'
        } elseif ($codeA -eq 400 -and $codeB -eq 400) {
            Bad 'Patch mechanism NOT working - disabled thinking is still rejected.'
        } elseif ($codeB -eq 200) {
            Warn "Patched combo accepted (HTTP 200), but the failing combo returned $codeA instead of 400."
        }
    }
}

# ----------------------------------------------------- 6. secrets at rest ----
Head 'CHECK 6 - Secrets at rest'

$plaintextHits = @()
if (Test-Path $P.Config) {
    $cfgLines = @(Get-Content $P.Config)
    for ($i = 0; $i -lt $cfgLines.Count; $i++) {
        if ($cfgLines[$i] -match '^\s*(apiKey|botToken|appToken|clientSecret|accessToken|refreshToken|jwt|accessKey|agentApiKey):\s*(.+)$') {
            $val = $Matches[2].Trim()
            if ($val.Length -gt 0 -and $val -ne '""' -and $val -ne "''") {
                $plaintextHits += "line $($i + 1): $($Matches[1]) = $($val.Length) chars"
            }
        }
    }
}

$envVars = @{}
if (Test-Path $P.EnvFile) {
    foreach ($line in (Get-Content $P.EnvFile)) {
        if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.+)$') {
            $envVars[$Matches[1]] = ($Matches[2].Trim() -replace '^"|"$', '')
        }
    }
}

if ($plaintextHits.Count -eq 0) {
    Ok 'mercury.yaml holds no non-empty credential fields.'
} else {
    Warn "$($plaintextHits.Count) non-empty credential field(s) found in mercury.yaml:"
    foreach ($hit in $plaintextHits) { Info $hit }
}

$needEnv = @('DEEPSEEK_API_KEY', 'TELEGRAM_BOT_TOKEN')
$missingEnv = @($needEnv | Where-Object { -not $envVars[$_] })
if ($missingEnv.Count -eq 0) {
    Ok "~/.mercury/.env supplies all $($needEnv.Count) required secret(s)."
} else {
    Bad "~/.mercury/.env is MISSING: $($missingEnv -join ', ') - provider/channel auth will fail."
}

if ($plaintextHits.Count -eq 0 -and $missingEnv.Count -eq 0) {
    $Findings.Secrets = 'CLEAN'
} elseif ($missingEnv.Count -gt 0) {
    $Findings.Secrets = 'ENV-MISSING'
} else {
    $Findings.Secrets = 'PLAINTEXT'
}

# ---------------------------------------------------------------- verdict ----
Write-Host ''
Write-Host '================ VERDICT ================' -ForegroundColor Cyan
Write-Host ("  patch          : " + $Findings.Patch)      -ForegroundColor White
Write-Host ("  journal hook   : " + $Findings.Hook)       -ForegroundColor White
Write-Host ("  restart        : " + $Findings.Restart)    -ForegroundColor White
Write-Host ("  recurrence     : " + $Findings.Recurrence) -ForegroundColor White
Write-Host ("  probe (fail)   : " + $Findings.ProbeA)     -ForegroundColor White
Write-Host ("  probe (fixed)  : " + $Findings.ProbeB)     -ForegroundColor White
Write-Host ("  secrets        : " + $Findings.Secrets)    -ForegroundColor White
Write-Host '=========================================' -ForegroundColor Cyan

$status =
    if ($Findings.Recurrence -eq 'TOOL_CHOICE_400') { 'RECURRENCE-DETECTED' }
    elseif ($Findings.Patch -eq 'MISSING')          { 'PATCH-WIPED' }
    elseif ($Findings.Secrets -ne 'CLEAN')          { 'SECRETS-IN-PLAINTEXT' }
    elseif ($Findings.Restart -eq 'PENDING')        { 'READY-RESTART-PENDING' }
    elseif ($Findings.Restart -eq 'LIVE' -and
            $Findings.Recurrence -eq 'NONE' -and
            $Findings.ProbeB -eq 200)               { 'HEALTHY' }
    else                                            { 'REVIEW' }

$statusColour = 'Yellow'
switch ($status) {
    'HEALTHY'               { $statusColour = 'Green' }
    'READY-RESTART-PENDING' { $statusColour = 'Yellow' }
    'RECURRENCE-DETECTED'   { $statusColour = 'Red' }
    'PATCH-WIPED'           { $statusColour = 'Red' }
    'SECRETS-IN-PLAINTEXT'  { $statusColour = 'Red' }
    default                 { $statusColour = 'Yellow' }
}

Write-Host "  STATUS: $status" -ForegroundColor $statusColour

if ($Journal) {
    $line = '{0} status={1} patch={2} restart={3} recurrence={4} secrets={5} probeFail={6} probeFixed={7}' -f `
        (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $status, $Findings.Patch, $Findings.Restart, $Findings.Recurrence, $Findings.Secrets, $Findings.ProbeA, $Findings.ProbeB
    try { Add-Content -Path $P.History -Value $line -ErrorAction Stop } catch { }
}

exit 0
