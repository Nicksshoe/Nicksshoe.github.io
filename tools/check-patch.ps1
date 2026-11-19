# Checks whether the per-patch data files are behind the live patch on Data Dragon.
# Run it any time (and after Riot ships a patch). Exit code 1 = something is stale, with the commands to fix it.
# The GitHub workflow .github/workflows/patch-check.yml runs the same check daily and opens an issue when stale.
$root = Split-Path $PSScriptRoot -Parent
$live = (Invoke-RestMethod 'https://ddragon.leagueoflegends.com/api/versions.json')[0]
$minor = { param($p) ($p -split '\.')[0..1] -join '.' }
$rows = @()
$read = { param($file, $pattern) $path = Join-Path $root $file; if (Test-Path $path) { $m = [regex]::Match((Get-Content $path -Raw), $pattern); if ($m.Success) { $m.Groups[1].Value } } }
$kits = try { (Get-Content (Join-Path $root 'kits/manifest.json') -Raw | ConvertFrom-Json).patch } catch { $null }
$rows += [pscustomobject]@{ Data = 'Ability data (kits/)';       Patch = $kits;                                              Fix = 'pwsh -File tools/update-kits.ps1' }
$rows += [pscustomobject]@{ Data = 'Attack damage growth';       Patch = (& $read 'growth.js' '\(patch ([0-9.]+)\)');        Fix = 'pwsh -File tools/update-growth.ps1' }
$rows += [pscustomobject]@{ Data = 'Crowd control (cc.js)';      Patch = (& $read 'cc.js' '\(patch ([0-9.]+)\)');            Fix = 'pwsh -File tools/update-cc.ps1' }
$rows += [pscustomobject]@{ Data = 'Item limits (itemgroups.js)'; Patch = (& $read 'itemgroups.js' '\(patch ([0-9.]+)\)');   Fix = 'pwsh -File tools/update-itemgroups.ps1' }
foreach ($r in $rows) { $r | Add-Member Status ($(if (-not $r.Patch) { 'unknown' } elseif ((& $minor $r.Patch) -eq (& $minor $live)) { 'ok' } else { 'STALE' })) }
Write-Host "Live patch on Data Dragon: $live"
$rows | Format-Table Data, Patch, Status -AutoSize | Out-String | Write-Host
$stale = @($rows | Where-Object Status -ne 'ok')
if ($stale.Count) {
  Write-Host 'To update, run:'
  $stale | ForEach-Object { Write-Host "  $($_.Fix)" }
  Write-Host '  pwsh -File tools/update-stacks.ps1   (stacks.json, needs your Riot API key)'
  Write-Host 'then commit, run tools/build-worker.ps1 and redeploy the Worker.'
  exit 1
}
Write-Host 'Everything matches the live patch.'
