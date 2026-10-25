Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path $PSScriptRoot '..\assets'
$assetDirectory = [System.IO.Path]::GetFullPath($assetDirectory)
$logoPath = Join-Path $assetDirectory 'hromadaaid.png'

function New-Canvas([int]$width, [int]$height) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Canvas($canvas, [string]$name) {
  $path = Join-Path $assetDirectory $name
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

$green = [System.Drawing.ColorTranslator]::FromHtml('#286343')
$paleGreen = [System.Drawing.ColorTranslator]::FromHtml('#EAF2ED')
$white = [System.Drawing.Color]::White

$header = New-Canvas 150 57
$header.Graphics.Clear($white)
$logo = [System.Drawing.Image]::FromFile($logoPath)
$header.Graphics.DrawImage($logo, 5, 8, 40, 40)
$font = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Point)
$brush = New-Object System.Drawing.SolidBrush($green)
$header.Graphics.DrawString('HromadaAID', $font, $brush, 49, 15)
$logo.Dispose()
$font.Dispose()
$brush.Dispose()
Save-Canvas $header 'hromadaaid-installer-header.bmp'

function New-ModeIcon([string]$kind, [string]$file) {
  $canvas = New-Canvas 48 48
  $g = $canvas.Graphics
  $g.ScaleTransform(1.5, 1.5)
  $g.Clear($white)
  $background = New-Object System.Drawing.SolidBrush($paleGreen)
  $g.FillEllipse($background, 1, 1, 30, 30)
  $background.Dispose()
  $pen = New-Object System.Drawing.Pen($green, 2.2)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $fill = New-Object System.Drawing.SolidBrush($green)
  if ($kind -eq 'client') {
    $g.DrawRectangle($pen, 7, 7, 18, 13)
    $g.DrawLine($pen, 16, 20, 16, 24)
    $g.DrawLine($pen, 11, 25, 21, 25)
  } elseif ($kind -eq 'server') {
    foreach ($y in @(6, 13, 20)) {
      $g.DrawRectangle($pen, 7, $y, 18, 5)
      $g.FillEllipse($fill, 10, $y + 2, 2, 2)
      $g.DrawLine($pen, 16, $y + 2, 22, $y + 2)
    }
  } else {
    $g.DrawRectangle($pen, 3, 8, 12, 10)
    $g.DrawLine($pen, 9, 18, 9, 22)
    $g.DrawLine($pen, 6, 23, 12, 23)
    foreach ($y in @(7, 14, 21)) {
      $g.DrawRectangle($pen, 18, $y, 10, 5)
      $g.FillEllipse($fill, 20, $y + 2, 2, 2)
    }
  }
  $pen.Dispose()
  $fill.Dispose()
  Save-Canvas $canvas $file
}

New-ModeIcon 'client' 'hromadaaid-installer-mode-client.bmp'
New-ModeIcon 'server' 'hromadaaid-installer-mode-server.bmp'
New-ModeIcon 'combined' 'hromadaaid-installer-mode-combined.bmp'
