# Draws og.png (1200x630), the image link previews show (Reddit, Discord, X...). Windows only (System.Drawing).
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$W = 1200; $H = 630
$bmp = [Drawing.Bitmap]::new($W, $H)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$hex = { param($h) [Drawing.ColorTranslator]::FromHtml($h) }

# Background: the site's dark navy with a soft gold glow.
$g.Clear((& $hex '#0a0f1a'))
$glow = [Drawing.Drawing2D.GraphicsPath]::new(); $glow.AddEllipse(-200, -350, 1600, 900)
$pgb = [Drawing.Drawing2D.PathGradientBrush]::new($glow)
$pgb.CenterColor = [Drawing.Color]::FromArgb(70, 200, 162, 74); $pgb.SurroundColors = @([Drawing.Color]::FromArgb(0, 10, 15, 26))
$g.FillPath($pgb, $glow)
$pen = [Drawing.Pen]::new((& $hex '#c8a24a'), 3); $g.DrawRectangle($pen, 28, 28, $W - 56, $H - 56)

$center = [Drawing.StringFormat]::new(); $center.Alignment = 'Center'
$gold = [Drawing.SolidBrush]::new((& $hex '#e7c46a')); $text = [Drawing.SolidBrush]::new((& $hex '#e8e3d6')); $muted = [Drawing.SolidBrush]::new((& $hex '#8f9bb3'))
$g.DrawString('POTENTIAL DAMAGE', [Drawing.Font]::new('Georgia', 60, [Drawing.FontStyle]::Bold), $gold, [Drawing.RectangleF]::new(0, 135, $W, 110), $center)
$g.DrawString('Draft a random champion and 6 random items.', [Drawing.Font]::new('Segoe UI', 36), $text, [Drawing.RectangleF]::new(0, 262, $W, 70), $center)
$g.DrawString('How much damage can you deal in 10 seconds?', [Drawing.Font]::new('Segoe UI Semibold', 36), $text, [Drawing.RectangleF]::new(0, 325, $W, 75), $center)

# Three "stat" pills like the training dummy panel.
$pill = [Drawing.SolidBrush]::new((& $hex '#111a2b')); $line = [Drawing.Pen]::new((& $hex '#22314d'), 2)
$labels = @(@('10,000', 'HEALTH'), @('200', 'ARMOR'), @('100', 'MAGIC RES'))
for ($i = 0; $i -lt 3; $i++) {
  $x = 300 + $i * 210
  $g.FillRectangle($pill, $x, 430, 180, 90); $g.DrawRectangle($line, $x, 430, 180, 90)
  $g.DrawString($labels[$i][0], [Drawing.Font]::new('Segoe UI Semibold', 30), $text, [Drawing.RectangleF]::new($x, 436, 180, 48), $center)
  $g.DrawString($labels[$i][1], [Drawing.Font]::new('Segoe UI', 14), $muted, [Drawing.RectangleF]::new($x, 484, 180, 28), $center)
}
$g.DrawString('potentialdamage.gg  ·  free, no sign-up', [Drawing.Font]::new('Segoe UI', 22), $muted, [Drawing.RectangleF]::new(0, 548, $W, 40), $center)

$out = Join-Path $root 'og.png'
$bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
Write-Host "Wrote $out"
