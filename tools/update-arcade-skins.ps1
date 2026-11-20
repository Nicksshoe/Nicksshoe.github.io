# Writes arcade-skins.json: for each champion with an Arcade / Battle Boss / Final Boss skin, the skin number and name.
# The arcade theme shows that skin's art on champion cards. Run each patch (new skins in the line get picked up).
$root = Split-Path $PSScriptRoot -Parent
$patch = ((Invoke-WebRequest 'https://ddragon.leagueoflegends.com/api/versions.json').Content | ConvertFrom-Json)[0]
$j = (Invoke-WebRequest "https://ddragon.leagueoflegends.com/cdn/$patch/data/en_US/championFull.json").Content | ConvertFrom-Json -AsHashtable
$out = [ordered]@{ patch = $patch; champions = [ordered]@{} }
foreach ($id in ($j.data.Keys | Sort-Object)) {
  # The first (original) skin in the line; later entries can be anniversary re-releases.
  $sk = $j.data[$id].skins | Where-Object { $_.name -match '\b(Arcade|Battle Boss|Final Boss)\b' } | Select-Object -First 1
  if ($sk) { $out.champions[$id] = [ordered]@{ num = [int]$sk.num; name = $sk.name } }
}
$path = Join-Path $root 'arcade-skins.json'
$out | ConvertTo-Json -Depth 4 | Set-Content -Path $path -Encoding utf8
Write-Host "Wrote $path ($($out.champions.Count) champions, patch $patch)"
