<#
.SYNOPSIS
  Potenshall Damage: builds stacks.json from last patch's high-elo ranked games.

.DESCRIPTION
  Stacking champions (Veigar AP, Sion HP, Senna AD, Thresh armor...) gain stats that the
  timeline reports but no item explains. For each game on the previous patch we take that
  champion's stats at minute 30, subtract base stats for their level, their items and rune
  shards, and keep the leftover as "stacks". The median across games goes into stacks.json.

  Only per-champion averages are written. No player names, Riot IDs, PUUIDs or match IDs
  are saved. The API key is read from a file and never printed.

.EXAMPLE
  pwsh -File tools/update-stacks.ps1
  pwsh -File tools/update-stacks.ps1 -Platform euw1 -Region europe -MaxMatches 600
#>
param(
  [string]$KeyFile = "$env:USERPROFILE\.riot\api-key.txt",
  [string]$Platform = 'na1',          # league lookups (na1, euw1, kr, ...)
  [string]$Region = 'americas',       # match lookups (americas, europe, asia, sea)
  [int]$Players = 120,                # high-elo players to sample
  [int]$MaxMatches = 500,             # match details to inspect
  [int]$Minute = 30,                  # timeline snapshot (≈ level 16-18)
  [string]$Out = (Join-Path $PSScriptRoot '..\stacks.json')
)
$ErrorActionPreference = 'Stop'

# ---------------- Champions we measure ----------------
# stats: which stat gains we measure.  counterFrom: turn a stat gain into the stack count the
# ability formulas use (e.g. Senna souls = bonus AD / 0.75).
$Measured = @{
  Veigar   = @{ stats = @('ap');          counterFrom = @{ stat = 'ap';    per = 1 } }
  Sion     = @{ stats = @('hp') }
  Chogath  = @{ stats = @('hp');          counterFrom = @{ stat = 'hp';    per = 80 } }
  Swain    = @{ stats = @('hp') }
  Senna    = @{ stats = @('ad');          counterFrom = @{ stat = 'ad';    per = 0.75 } }
  Thresh   = @{ stats = @('armor', 'ap'); counterFrom = @{ stat = 'armor'; per = 1 } }
}
# Stacks the API can't see (they don't change a stat). Typical counts around 30 minutes,
# hand-set from community norms. Update these by hand if they drift.
$Estimated = @{
  Nasus = 350; Smolder = 225; AurelionSol = 250; Kindred = 8; Draven = 1; KSante = 1; Locke = 5
}

# ---------------- HTTP helpers ----------------
if (-not (Test-Path $KeyFile)) { throw "API key file not found: $KeyFile" }
$ApiKey = (Get-Content $KeyFile -Raw).Trim()
$script:calls = 0
function Invoke-Riot([string]$url) {
  for ($try = 0; $try -lt 6; $try++) {
    Start-Sleep -Milliseconds 1250           # stays under the dev-key limit of 100 calls / 2 min
    $script:calls++
    try {
      return Invoke-RestMethod -Uri $url -Headers @{ 'X-Riot-Token' = $ApiKey }
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      if ($code -eq 429) {
        $wait = [int]($_.Exception.Response.Headers.RetryAfter.Delta.TotalSeconds)
        if ($wait -lt 1) { $wait = 10 }
        Write-Host "  rate limited, waiting $wait s"; Start-Sleep -Seconds $wait; continue
      }
      if ($code -eq 401 -or $code -eq 403) { throw "Riot API rejected the key ($code). Dev keys expire every 24h: regenerate it and save it to $KeyFile." }
      if ($code -eq 404) { return $null }
      if ($code -ge 500) { Start-Sleep -Seconds 5; continue }
      throw
    }
  }
  return $null
}

# ---------------- Previous patch static data ----------------
$versions = Invoke-RestMethod 'https://ddragon.leagueoflegends.com/api/versions.json'
$prev = $versions[1]
$prevShort = ($prev -split '\.')[0..1] -join '.'
Write-Host "Measuring stacks on patch $prevShort (data version $prev)"
$champData = (Invoke-RestMethod "https://ddragon.leagueoflegends.com/cdn/$prev/data/en_US/champion.json").data
$itemData = (Invoke-RestMethod "https://ddragon.leagueoflegends.com/cdn/$prev/data/en_US/item.json").data

# Item stats from the description's <stats> block (same approach as the game page).
$itemStats = @{}
foreach ($p in $itemData.PSObject.Properties) {
  $s = @{ ad = 0; ap = 0; hp = 0; armor = 0; mr = 0 }
  $block = [regex]::Match($p.Value.description, '<stats>(.*?)</stats>').Groups[1].Value
  foreach ($line in ($block -split '<br\s*/?>')) {
    $t = ($line -replace '<[^>]+>', '').Trim()
    $m = [regex]::Match($t, '^([\d.]+)%?\s+(.+)$')
    if (-not $m.Success) { continue }
    $v = [double]$m.Groups[1].Value
    switch ($m.Groups[2].Value.ToLower()) {
      'attack damage' { $s.ad += $v } 'ability power' { $s.ap += $v } 'health' { $s.hp += $v }
      'armor' { $s.armor += $v } 'magic resist' { $s.mr += $v }
    }
  }
  $itemStats[[int]$p.Name] = $s
}

function Get-BaseStat($champ, [string]$stat, [int]$level) {
  $st = $champ.stats
  $pair = switch ($stat) {
    'ad' { @($st.attackdamage, $st.attackdamageperlevel) }
    'hp' { @($st.hp, $st.hpperlevel) }
    'armor' { @($st.armor, $st.armorperlevel) }
    'mr' { @($st.spellblock, $st.spellblockperlevel) }
    default { @(0, 0) }
  }
  $n = $level - 1
  return $pair[0] + $pair[1] * $n * (0.7025 + 0.0175 * $n)
}

# ---------------- Sample players and matches ----------------
$ladder = @()
foreach ($tier in 'challengerleagues', 'grandmasterleagues') {
  $l = Invoke-Riot "https://$Platform.api.riotgames.com/lol/league/v4/$tier/by-queue/RANKED_SOLO_5x5"
  if ($l) { $ladder += $l.entries }
}
$ladder = $ladder | Where-Object { $_.puuid } | Get-Random -Count ([Math]::Min($Players, $ladder.Count))
Write-Host "Sampled $($ladder.Count) high-elo players"

$since = [DateTimeOffset]::UtcNow.AddDays(-35).ToUnixTimeSeconds()
$matchIds = [System.Collections.Generic.HashSet[string]]::new()
$i = 0
foreach ($e in $ladder) {
  $i++
  $ids = Invoke-Riot "https://$Region.api.riotgames.com/lol/match/v5/matches/by-puuid/$($e.puuid)/ids?queue=420&type=ranked&startTime=$since&count=20"
  foreach ($id in @($ids)) { if ($id) { [void]$matchIds.Add($id) } }
  if ($i % 20 -eq 0) { Write-Host "  players $i/$($ladder.Count), unique matches $($matchIds.Count)" }
}
$e = $null; $ladder = $null   # drop player identifiers as soon as we're done with them

# ---------------- Measure ----------------
$samples = @{}
foreach ($k in $Measured.Keys) { $samples[$k] = @{} }
$checked = 0
foreach ($mid in ($matchIds | Get-Random -Count ([Math]::Min($MaxMatches, $matchIds.Count)))) {
  $checked++
  if ($checked % 25 -eq 0) { Write-Host "  matches $checked, API calls $script:calls" }
  $m = Invoke-Riot "https://$Region.api.riotgames.com/lol/match/v5/matches/$mid"
  if (-not $m -or -not $m.info.gameVersion.StartsWith("$prevShort.")) { continue }
  if ($m.info.gameDuration -lt ($Minute * 60 + 30)) { continue }
  $targets = @($m.info.participants | Where-Object { $Measured.ContainsKey($_.championName) })
  if (-not $targets.Count) { continue }

  $tl = Invoke-Riot "https://$Region.api.riotgames.com/lol/match/v5/matches/$mid/timeline"
  if (-not $tl -or $tl.info.frames.Count -le $Minute) { continue }
  $frame = $tl.info.frames[$Minute]
  $cutoff = $frame.timestamp

  foreach ($p in $targets) {
    $partId = $p.participantId
    # Rebuild the inventory at the snapshot from purchase/sell/destroy/undo events.
    $inv = [System.Collections.Generic.List[int]]::new()
    foreach ($f in $tl.info.frames) {
      foreach ($ev in $f.events) {
        if ($ev.timestamp -gt $cutoff -or $ev.participantId -ne $partId) { continue }
        switch ($ev.type) {
          'ITEM_PURCHASED' { $inv.Add([int]$ev.itemId) }
          'ITEM_SOLD' { [void]$inv.Remove([int]$ev.itemId) }
          'ITEM_DESTROYED' { [void]$inv.Remove([int]$ev.itemId) }
          'ITEM_UNDO' { if ($ev.beforeId) { [void]$inv.Remove([int]$ev.beforeId) }; if ($ev.afterId) { $inv.Add([int]$ev.afterId) } }
        }
      }
    }
    $items = @{ ad = 0; ap = 0; hp = 0; armor = 0; mr = 0 }
    foreach ($id in $inv) { if ($itemStats.ContainsKey($id)) { foreach ($k in @($items.Keys)) { $items[$k] += $itemStats[$id][$k] } } }

    $pf = $frame.participantFrames."$partId"
    $level = [int]$pf.level
    $cs = $pf.championStats
    $champ = $champData.($p.championName)
    $shards = @($p.perks.statPerks.offense, $p.perks.statPerks.flex, $p.perks.statPerks.defense)
    $adaptive = @($shards | Where-Object { $_ -eq 5008 }).Count
    $runeHp = (@($shards | Where-Object { $_ -eq 5011 }).Count * 65) + (@($shards | Where-Object { $_ -eq 5001 }).Count * (10 + 170 * ($level - 1) / 17))
    $deathcap = $inv.Contains(3089)

    foreach ($stat in $Measured[$p.championName].stats) {
      $observed = switch ($stat) { 'ap' { $cs.abilityPower } 'ad' { $cs.attackDamage } 'hp' { $cs.healthMax } 'armor' { $cs.armor } 'mr' { $cs.magicResist } }
      if ($stat -eq 'ap' -and $deathcap) { $observed = $observed / 1.3 }
      $runes = switch ($stat) { 'ap' { 15 * $adaptive } 'ad' { 9 * $adaptive } 'hp' { $runeHp } default { 0 } }
      $leftover = $observed - (Get-BaseStat $champ $stat $level) - $items[$stat] - $runes
      if (-not $samples[$p.championName].ContainsKey($stat)) { $samples[$p.championName][$stat] = [System.Collections.Generic.List[double]]::new() }
      $samples[$p.championName][$stat].Add([Math]::Max(0, $leftover))
    }
  }
}

# ---------------- Aggregate ----------------
function Get-Median($list) { $s = $list | Sort-Object; if (-not $s.Count) { return 0 }; return [double]$s[[int][Math]::Floor(($s.Count - 1) / 2)] }

$result = [ordered]@{
  patch = $prevShort; generated = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  snapshotMinute = $Minute; matchesChecked = $checked
  note = 'Median stat gains no item or rune explains, from high-elo ranked games on the previous patch. Estimated entries are hand-set.'
  champions = [ordered]@{}
}
foreach ($name in ($Measured.Keys | Sort-Object)) {
  $cfg = $Measured[$name]; $s = $samples[$name]
  $games = if ($s.Count) { ($s.Values | Select-Object -First 1).Count } else { 0 }
  if ($games -lt 3) { Write-Host "  $name`: only $games games, skipped"; continue }
  $stats = [ordered]@{}
  foreach ($stat in $cfg.stats) { $stats[$stat] = [Math]::Round((Get-Median $s[$stat]), 1) }
  $entry = [ordered]@{ source = 'riot-api'; games = $games; stats = $stats }
  if ($cfg.counterFrom) { $entry.counter = [Math]::Round($stats[$cfg.counterFrom.stat] / $cfg.counterFrom.per) }
  $result.champions[$name] = $entry
  Write-Host ("  {0,-10} {1,3} games  {2}" -f $name, $games, (($stats.GetEnumerator() | ForEach-Object { "$($_.Key) +$($_.Value)" }) -join ', '))
}
foreach ($name in ($Estimated.Keys | Sort-Object)) {
  $result.champions[$name] = [ordered]@{ source = 'estimate'; counter = $Estimated[$name] }
}

$result | ConvertTo-Json -Depth 6 | Set-Content -Path $Out -Encoding utf8
Write-Host "Wrote $(Resolve-Path $Out) after $script:calls API calls"
