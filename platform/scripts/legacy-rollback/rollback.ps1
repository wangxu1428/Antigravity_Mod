# AGM-PLUGIN-01 one-click rollback: restores C:\Antigravity_Mod to the pre-PLUGIN-01 state (= post-STABILITY-03) from backup\ (SHA256-verified).
# Usage: rollback.ps1 [-VerifyOnly] [-ChainStability03]
#   -ChainStability03 : after a successful PLUGIN-01 rollback, also run C:\AGM_TestLab\AGM_STABILITY_03\rollback.ps1 (back to pre-STABILITY-03).
# New files PLUGIN-01 added under mod_kit\ or plugins\ (not in manifest) are moved aside, never deleted. Never kills processes: exits 3 if the C Mod runs.
param([switch]$VerifyOnly,[switch]$ChainStability03)
$ErrorActionPreference='Stop'
$M='C:\Antigravity_Mod'; $B=Join-Path $PSScriptRoot 'backup'; $S03='C:\AGM_TestLab\AGM_STABILITY_03\rollback.ps1'
$man=Get-Content -LiteralPath "$B\manifest.tsv" -Encoding UTF8 | ? { $_ } | % { $p=$_ -split "`t"; [pscustomobject]@{K=$p[0];R=$p[1];H=$p[2]} }
$bad=0; $ok=0
foreach($e in $man){ $f=Join-Path "$B\files" $e.R
  if(!(Test-Path -LiteralPath $f)){ "BACKUP MISSING $($e.R)"; $bad++; continue }
  if((Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash -ne $e.H){ "BACKUP HASH MISMATCH $($e.R)"; $bad++ } else { $ok++ } }
"backup verify: $ok ok, $bad bad"
if($bad){ 'ABORT: backup is not intact, nothing restored'; exit 2 }
$known=@{}; $man | % { $known[$_.R.ToLower()]=1 }
$extra=@(foreach($d in 'mod_kit','plugins','resources\app.asar.unpacked'){ if(Test-Path "$M\$d"){ Get-ChildItem -LiteralPath "$M\$d" -Recurse -File | ? { -not $known[$_.FullName.Substring($M.Length+1).ToLower()] } } })
$diff=@($man | ? { $p=Join-Path $M $_.R; !(Test-Path -LiteralPath $p) -or (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $_.H })
$diff | ? K -ne 'UNPK' | % { "  would restore: $($_.R)" }; $extra | ? { $_.FullName -notlike "$M\resources\*" } | % { "  would move aside (added): $($_.FullName.Substring($M.Length+1))" }
"production differs from backup in $($diff.Count) entries; $($extra.Count) added files"
if($VerifyOnly){ 'VerifyOnly: nothing changed'; if($ChainStability03){ '--- chained STABILITY-03 rollback (VerifyOnly)'; & powershell -NoProfile -ExecutionPolicy Bypass -File $S03 -VerifyOnly; "STABILITY-03 rollback VerifyOnly exit=$LASTEXITCODE" }; exit 0 }
$busy=@(Get-CimInstance Win32_Process | ? { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$M\",[StringComparison]::OrdinalIgnoreCase) })
if($busy.Count){ $busy | % { "  busy: PID $($_.ProcessId) $($_.ExecutablePath)" }; 'ABORT: close the C Mod first (this script never kills processes)'; exit 3 }
$D=Join-Path $B ("displaced_" + (Get-Date -Format yyyyMMdd_HHmmss)); New-Item -ItemType Directory -Force $D | Out-Null
foreach($x in $extra){ $rel=$x.FullName.Substring($M.Length+1); $d=Join-Path $D $rel; New-Item -ItemType Directory -Force (Split-Path $d) | Out-Null; Move-Item -LiteralPath $x.FullName -Destination $d; "moved aside: $rel" }
foreach($e in $diff){ $p=Join-Path $M $e.R
  if(Test-Path -LiteralPath $p){ $d=Join-Path $D $e.R; New-Item -ItemType Directory -Force (Split-Path $d) | Out-Null; Copy-Item -LiteralPath $p -Destination $d -Force }
  New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null; Copy-Item -LiteralPath (Join-Path "$B\files" $e.R) -Destination $p -Force; if($e.K -ne 'UNPK'){ "restored: $($e.R)" } }
"restored $(@($diff | ? K -eq 'UNPK').Count) app.asar.unpacked files"
# remove now-empty dirs left by moved-aside additions (only under plugins\ and mod_kit\)
foreach($d in 'plugins','mod_kit'){ Get-ChildItem "$M\$d" -Recurse -Directory | Sort { $_.FullName.Length } -Descending | ? { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | % { Remove-Item -LiteralPath $_.FullName; "removed empty dir: $($_.FullName.Substring($M.Length+1))" } }
$after=@($man | ? { $p=Join-Path $M $_.R; !(Test-Path -LiteralPath $p) -or (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $_.H }).Count
$after+=@(foreach($d in 'mod_kit','plugins','resources\app.asar.unpacked'){ Get-ChildItem -LiteralPath "$M\$d" -Recurse -File | ? { -not $known[$_.FullName.Substring($M.Length+1).ToLower()] } }).Count
if($after){ "ROLLBACK INCOMPLETE ($after)"; exit 4 }
"ROLLBACK OK: production matches PLUGIN-01 backup manifest (= post-STABILITY-03 state). Displaced copies kept in $D"
if($ChainStability03){ '--- chaining STABILITY-03 rollback'; & powershell -NoProfile -ExecutionPolicy Bypass -File $S03; exit $LASTEXITCODE }
exit 0
