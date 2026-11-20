# Adds a content fingerprint to every local script in the pages (engine.js -> engine.js?v=1a2b3c4d), so browsers fetch a
# changed file as soon as the page itself refreshes instead of keeping an old copy for up to 10 minutes (GitHub Pages
# caching). Run before committing changes to any .js file the pages load; it only rewrites the ?v= part.
$root = Split-Path $PSScriptRoot -Parent
$sha = [Security.Cryptography.SHA256]::Create()
$pages = 'index.html', 'testbench.html', 'audit.html'
foreach ($page in $pages) {
  $path = Join-Path $root $page
  if (-not (Test-Path $path)) { continue }
  $html = [IO.File]::ReadAllText($path)
  $new = [regex]::Replace($html, '<script src="([\w.\-/]+\.js)(\?v=[0-9a-f]+)?"', {
    param($m)
    $file = Join-Path $root $m.Groups[1].Value
    if (-not (Test-Path $file)) { return $m.Value }
    $hash = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($file))) -replace '-', '').Substring(0, 8).ToLower()
    '<script src="' + $m.Groups[1].Value + '?v=' + $hash + '"'
  })
  if ($new -ne $html) { [IO.File]::WriteAllText($path, $new, [Text.UTF8Encoding]::new($false)); Write-Host "Stamped $page" }
  else { Write-Host "$page already up to date" }
}
