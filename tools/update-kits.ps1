# Regenerates kits/: each champion's ability data from the game files (CommunityDragon), trimmed to what the game
# reads (the champion record and its spell objects), so players and the leaderboard Worker load it from this site
# instead of CommunityDragon. Run after each patch, commit kits/, then rebuild and redeploy the Worker.
# kits/manifest.json records the patch; if it falls behind Data Dragon, the game falls back to CommunityDragon
# and tools/check-patch.ps1 (plus the GitHub check) reports it as stale.
param([string]$Patch)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root 'kits'
New-Item -ItemType Directory -Force $dir | Out-Null
if (-not $Patch) { $Patch = (Invoke-RestMethod 'https://ddragon.leagueoflegends.com/api/versions.json')[0] }
$ids = (Invoke-RestMethod "https://ddragon.leagueoflegends.com/cdn/$Patch/data/en_US/champion.json").data.PSObject.Properties.Name
$cdVersion = try { (Invoke-RestMethod 'https://raw.communitydragon.org/latest/content-metadata.json').version } catch { '' }

# A few requests at a time, with retries: CommunityDragon is a free community service.
$results = $ids | ForEach-Object -ThrottleLimit 4 -Parallel {
  $id = $_; $lc = $id.ToLower(); $dir = $using:dir
  for ($try = 1; $try -le 3; $try++) {
    try {
      $raw = (Invoke-WebRequest "https://raw.communitydragon.org/latest/game/data/characters/$lc/$lc.bin.json" -UseBasicParsing -TimeoutSec 60).Content
      $bin = $raw | ConvertFrom-Json -AsHashtable -Depth 100
      $keep = [ordered]@{}
      foreach ($k in $bin.Keys) {
        $v = $bin[$k]
        if ($v -is [System.Collections.IDictionary] -and ($v['__type'] -eq 'SpellObject' -or $v['__type'] -eq 'CharacterRecord')) { $keep[$k] = $v }
      }
      if (-not ($keep.Values | Where-Object { $_['__type'] -eq 'CharacterRecord' })) { throw 'no CharacterRecord' }
      $json = ConvertTo-Json -InputObject $keep -Depth 100 -Compress
      [IO.File]::WriteAllText((Join-Path $dir "$lc.json"), $json, (New-Object Text.UTF8Encoding $false))
      return [pscustomobject]@{ id = $id; ok = $true; kb = [Math]::Round($json.Length / 1KB) }
    } catch { $err = $_.Exception.Message; Start-Sleep -Seconds (2 * $try) }
  }
  [pscustomobject]@{ id = $id; ok = $false; err = $err }
}

$ok = @($results | Where-Object ok | Sort-Object id)
$failed = @($results | Where-Object { -not $_.ok })
$manifest = [ordered]@{ patch = $Patch; communityDragon = $cdVersion; built = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); champions = @($ok | ForEach-Object id) }
[IO.File]::WriteAllText((Join-Path $dir 'manifest.json'), (ConvertTo-Json $manifest -Depth 5), (New-Object Text.UTF8Encoding $false))
Write-Host ("Wrote kits/ for patch {0}: {1} champions, {2} KB total" -f $Patch, $ok.Count, (($ok | Measure-Object kb -Sum).Sum))
if ($failed.Count) { Write-Host "Failed (these load from CommunityDragon instead): $(($failed | ForEach-Object { "$($_.id) ($($_.err))" }) -join ', ')" }
