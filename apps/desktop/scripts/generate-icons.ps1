# Regenerate icon.iconset from assets/icon-source.png (run from apps/desktop).
# Scales to fit inside a square canvas (no stretch); pads with app background.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$sourcePath = Join-Path $root "assets/icon-source.png"
$iconset = Join-Path $root "icon.iconset"

if (-not (Test-Path $sourcePath)) {
  Write-Error "Missing $sourcePath — add a PNG source first."
}

New-Item -ItemType Directory -Force -Path $iconset | Out-Null
Add-Type -AssemblyName System.Drawing

# Admin UI background — matches letterbox padding
$bgColor = [System.Drawing.Color]::FromArgb(255, 15, 23, 36)

$sizes = @(
  @{ name = "icon_16x16.png"; size = 16 },
  @{ name = "icon_32x32.png"; size = 32 },
  @{ name = "icon_128x128.png"; size = 128 },
  @{ name = "icon_256x256.png"; size = 256 },
  @{ name = "icon_512x512.png"; size = 512 },
  @{ name = "icon_16x16@2x.png"; size = 32 },
  @{ name = "icon_32x32@2x.png"; size = 64 },
  @{ name = "icon_128x128@2x.png"; size = 256 },
  @{ name = "icon_256x256@2x.png"; size = 512 },
  @{ name = "icon_512x512@2x.png"; size = 1024 }
)

$src = [System.Drawing.Image]::FromFile((Resolve-Path $sourcePath))
$sourceSize = "$($src.Width)x$($src.Height)"
try {
  foreach ($entry in $sizes) {
    $side = $entry.size
    $scale = [Math]::Min($side / $src.Width, $side / $src.Height)
    $drawW = [int][Math]::Round($src.Width * $scale)
    $drawH = [int][Math]::Round($src.Height * $scale)
    $offsetX = [int][Math]::Round(($side - $drawW) / 2.0)
    $offsetY = [int][Math]::Round(($side - $drawH) / 2.0)

    $bmp = New-Object System.Drawing.Bitmap $side, $side
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($bgColor)
    $g.DrawImage($src, $offsetX, $offsetY, $drawW, $drawH)
    $bmp.Save((Join-Path $iconset $entry.name), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
  }
} finally {
  $src.Dispose()
}

Write-Host "Wrote icon.iconset under $iconset (scale-to-fit from $sourceSize)"
