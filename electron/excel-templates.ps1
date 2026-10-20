$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$excel = $null
$workbook = $null
$sheet = $null
function Assert-GenerationActive {
  if ($payload.cancelPath -and [System.IO.File]::Exists([string]$payload.cancelPath)) { throw 'HROMADA_GENERATION_CANCELLED' }
}
Add-Type -AssemblyName System.Drawing

function Get-TextHeight($cell, [string]$text) {
  $bitmap = $null
  $graphics = $null
  $font = $null
  try {
    $bitmap = [System.Drawing.Bitmap]::new(1, 1)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Point
    $style = [System.Drawing.FontStyle]::Regular
    if ($cell.Font.Bold) { $style = $style -bor [System.Drawing.FontStyle]::Bold }
    if ($cell.Font.Italic) { $style = $style -bor [System.Drawing.FontStyle]::Italic }
    $font = [System.Drawing.Font]::new([string]$cell.Font.Name, [single]$cell.Font.Size, $style, [System.Drawing.GraphicsUnit]::Point)
    $width = [Math]::Max(1, [double]$cell.Width - 8)
    $size = $graphics.MeasureString($text, $font, [System.Drawing.SizeF]::new([single]$width, 10000))
    return [double]$size.Height + 6
  } finally {
    if ($font) { $font.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
  }
}

function Set-StatementNumber($sheet, [string]$address, [string]$number) {
  $heading = [string]$sheet.Range($address).Value2
  $marker = $heading.IndexOf([char]0x2116)
  if ($marker -lt 0) { throw 'HROMADA_STATEMENT_NUMBER_FIELD_MISSING' }
  $sheet.Range($address).Value2 = $heading.Substring(0, $marker + 1) + ' ' + $number
}

function Set-PrintableTitle($sheet, [string]$address, [string]$text) {
  $cell = $sheet.Range($address)
  $cell.Value2 = $text
  $area = $cell.MergeArea
  $area.WrapText = $true
  $height = [Math]::Max([double]$sheet.Rows.Item($area.Row).RowHeight, (Get-TextHeight $area $text))
  if ($height -gt 409.5) { throw 'HROMADA_LAYOUT_TOO_TALL: Повна назва не вміщується в рядок шаблону без обрізання.' }
  $sheet.Rows.Item($area.Row).RowHeight = $height
}
try {
  Assert-GenerationActive
  if (-not (Test-Path -LiteralPath $payload.templatePath)) { throw 'Excel-шаблон не знайдено.' }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  Assert-GenerationActive
  $workbook = $excel.Workbooks.Open($payload.templatePath, 0, $false)
  $sheet = $workbook.Worksheets.Item(1)
  if ($payload.kind -eq 'personal') {
    $templateRowHeights = @()
    for ($row = 13; $row -le 24; $row++) { $templateRowHeights += [double]$sheet.Rows.Item($row).RowHeight }
    # Preserve the template heading, without reusing its sample document number.
    Set-StatementNumber $sheet 'A4' $payload.documentNumber
    Set-PrintableTitle $sheet 'A6' $payload.aidTypeName
    $sheet.Range('A9').Value2 = $payload.periodText
    # Row 12 numbers the columns; row 25 contains the original total formula.
    $sheet.Range('A13:K24').ClearContents()
    # Identifiers are text: Excel must not discard leading zeroes in MFO, RNOKPP or accounts.
    $sheet.Range('A13:A24').NumberFormat = '@'
    $sheet.Range('C13:F24').NumberFormat = '@'
    $sheet.Range('H13:K24').NumberFormat = '@'
    $records = @($payload.records)
    if ($records.Count -gt 12) { throw 'Персональна форма вміщує до 12 записів. Розділіть вибір на кілька відомостей.' }
    for ($i = 0; $i -lt $records.Count; $i++) {
      Assert-GenerationActive
      $record = $records[$i]
      $row = 13 + $i
      $sheet.Cells.Item($row, 1).Value2 = $record.dateDisplay
      $sheet.Cells.Item($row, 2).Value2 = [double]($i + 1)
      $sheet.Cells.Item($row, 3).Value2 = $record.bankAccount
      $sheet.Cells.Item($row, 4).Value2 = $record.bankName
      $sheet.Cells.Item($row, 5).Value2 = $record.bankMfo
      $sheet.Cells.Item($row, 6).Value2 = $record.bankEdrpou
      $sheet.Cells.Item($row, 7).Value2 = [double]$record.amount
      $sheet.Cells.Item($row, 8).Value2 = $record.fullName
      $sheet.Cells.Item($row, 9).Value2 = $record.rnokpp
      $sheet.Cells.Item($row, 10).Value2 = $record.passport
      $sheet.Cells.Item($row, 11).Value2 = $record.registeredAddress
    }
    # Keep populated source rows at least as high as the original; collapse only unused slots in the copy.
    for ($row = 13; $row -le 24; $row++) {
      $height = $templateRowHeights[$row - 13]
      if ($row -lt (13 + $records.Count)) {
        foreach ($column in @(1, 3, 4, 5, 6, 8, 9, 10, 11)) {
          $cell = $sheet.Cells.Item($row, $column)
          if ($cell.WrapText -and $null -ne $cell.Value2) { $height = [Math]::Max($height, (Get-TextHeight $cell ([string]$cell.Value2))) }
        }
        if ($height -gt 409.5) { throw 'HROMADA_LAYOUT_TOO_TALL: Реквізити отримувача не вміщуються в рядок шаблону без обрізання.' }
      }
      $sheet.Rows.Item($row).RowHeight = $height
      $sheet.Rows.Item($row).Hidden = ($row -ge (13 + $records.Count))
    }
  } elseif ($payload.kind -eq 'summary') {
    Set-StatementNumber $sheet 'B4' $payload.documentNumber
    Set-PrintableTitle $sheet 'B6' $payload.aidTypeName
    $sheet.Range('B9').Value2 = $payload.periodText
    $daily = @($payload.daily)
    $templateRowHeight = [double]$sheet.Rows.Item(12).RowHeight
    $insertCount = [Math]::Max(0, $daily.Count - 1)
    if ($insertCount -gt 0) {
      $lastInserted = 12 + $insertCount
      [void]$sheet.Rows("13:$lastInserted").Insert()
      # Extend only the existing print area to include shifted signatures.
      $printRange = $sheet.Range($sheet.PageSetup.PrintArea)
      $lastPrintRow = [Math]::Max(19 + $insertCount, $printRange.Row + $printRange.Rows.Count - 1)
      $sheet.PageSetup.PrintArea = '$B$1:$D$' + $lastPrintRow
    }
    $sheet.Range('B12:D12').ClearContents()
    for ($i = 0; $i -lt $daily.Count; $i++) {
      Assert-GenerationActive
      $row = 12 + $i
      if ($i -gt 0) { [void]$sheet.Range('B12:D12').Copy(); [void]$sheet.Range("B$row:D$row").PasteSpecial(-4122) }
      $sheet.Rows.Item($row).RowHeight = $templateRowHeight
      $sheet.Cells.Item($row, 2).NumberFormat = '@'
      $sheet.Cells.Item($row, 2).Value2 = $daily[$i].dateDisplay
      $sheet.Cells.Item($row, 3).Value2 = [double]$daily[$i].count
      $sheet.Cells.Item($row, 4).Value2 = [double]$daily[$i].amount
    }
  } else { throw 'Невідомий вид відомості.' }
  # Keep the updated template's orientation, margins, scale and print settings.
  Assert-GenerationActive
  $workbook.Save()
  if ($payload.kind -eq 'personal') {
    if (-not $payload.excelPath -or [System.IO.Path]::GetExtension([string]$payload.excelPath) -ne '.xls') { throw 'HROMADA_PERSONAL_XLS_PATH_REQUIRED' }
    # Convert the filled copy to the real BIFF8 format, never rename an OOXML file.
    $workbook.CheckCompatibility = $false
    Assert-GenerationActive
    $workbook.SaveAs([string]$payload.excelPath, 56)
  }
  Assert-GenerationActive
  $workbook.ExportAsFixedFormat(0, $payload.pdfPath)
  $workbook.Close($false)
  [Console]::Out.Write((ConvertTo-Json -Compress @{ ok = $true }))
} catch {
  if ($workbook -ne $null) { try { $workbook.Close($false) } catch {} }
  [Console]::Error.Write($_.Exception.Message)
  exit 1
} finally {
  if ($excel -ne $null) { try { $excel.Quit() } catch {} }
  if ($sheet -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) } catch {} }
  if ($workbook -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) } catch {} }
  if ($excel -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch {} }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
