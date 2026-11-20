# Draws og.png (1200x630), the image link previews show (Reddit, Discord, X...), in the arcade theme's colours.
# Windows only (System.Drawing). Text stays in the middle: previews often crop the edges.
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$W = 1200; $H = 630
$bmp = [Drawing.Bitmap]::new($W, $H)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$hex = { param($h) [Drawing.ColorTranslator]::FromHtml($h) }
$bg = & $hex '#0c0614'; $gold = & $hex '#ffd23f'; $cyan = & $hex '#3ef0ff'; $pink = & $hex '#ff3ea5'; $white = & $hex '#f4f0ff'

$g.Clear($bg)
# Top stripe (yellow, then a pink line), like the site.
$g.FillRectangle([Drawing.SolidBrush]::new($gold), 0, 0, $W, 14)
$g.FillRectangle([Drawing.SolidBrush]::new($pink), 0, 14, $W, 6)
# Frame: pink offset shadow behind a yellow border.
$g.FillRectangle([Drawing.SolidBrush]::new($pink), 70, 92, 1076, 480)
$g.FillRectangle([Drawing.SolidBrush]::new($bg), 58, 80, 1076, 480)
$g.DrawRectangle([Drawing.Pen]::new($gold, 6), 58, 80, 1076, 480)

$center = [Drawing.StringFormat]::new(); $center.Alignment = 'Center'
$shadow = { param($text, $font, $brush, $y, $h, $off)
  $g.DrawString($text, $font, [Drawing.SolidBrush]::new($pink), [Drawing.RectangleF]::new($off, $y + $off, $W, $h), $center)
  $g.DrawString($text, $font, $brush, [Drawing.RectangleF]::new(0, $y, $W, $h), $center) }
& $shadow 'POTENTIAL DAMAGE' ([Drawing.Font]::new('Arial Black', 62)) ([Drawing.SolidBrush]::new($gold)) 160 110 5
$g.DrawString('Draft a random champion and 6 random items.', [Drawing.Font]::new('Segoe UI Semibold', 34), [Drawing.SolidBrush]::new($white), [Drawing.RectangleF]::new(0, 300, $W, 64), $center)
$g.DrawString('How much damage can you deal in 10 seconds?', [Drawing.Font]::new('Segoe UI', 34, [Drawing.FontStyle]::Bold), [Drawing.SolidBrush]::new($cyan), [Drawing.RectangleF]::new(0, 360, $W, 70), $center)
$g.DrawString('POTENTIALDAMAGE.GG  ·  FREE, NO SIGN-UP', [Drawing.Font]::new('Segoe UI', 22, [Drawing.FontStyle]::Bold), [Drawing.SolidBrush]::new($gold), [Drawing.RectangleF]::new(0, 460, $W, 44), $center)

$out = Join-Path $root 'og.png'
$bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
Write-Host "Wrote $out"
