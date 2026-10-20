$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$stage = 'input'
$payload = $null
$excel = $null
$workbook = $null
$sheet = $null
function Assert-Active {
  if ([System.IO.File]::Exists([string]$payload.cancelPath)) { throw 'HROMADA_REPORT_CANCELLED' }
}
function Color([string]$hex) {
  return [Convert]::ToInt32($hex.Substring(0,2),16) + 256 * [Convert]::ToInt32($hex.Substring(2,2),16) + 65536 * [Convert]::ToInt32($hex.Substring(4,2),16)
}
function Text($cell, [string]$value) {
  # Official names are always literal text, including any leading formula characters.
  $cell.NumberFormat = '@'
  $cell.Value2 = $value
}
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $stage = 'excel-start'
  Assert-Active
  try { $excel = New-Object -ComObject Excel.Application } catch { throw 'HROMADA_EXCEL_UNAVAILABLE' }
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $stage = 'workbook-create'
  $workbook = $excel.Workbooks.Add(-4167)
  $sheet = $workbook.Worksheets.Item(1)
  $sheet.Name = 'Звіт'
  # Match the working PrivatBank export: this Excel installation expects local
  # separators for numeric formats (NumberFormat rejects the invariant mask).
  $decimalSeparator = [string]$excel.International(3)
  $thousandsSeparator = [string]$excel.International(4)
  $countFormat = '#' + $thousandsSeparator + '##0'
  $moneyFormat = '#' + $thousandsSeparator + '##0' + $decimalSeparator + '00" грн";-#' + $thousandsSeparator + '##0' + $decimalSeparator + '00" грн";0' + $decimalSeparator + '00" грн"'
  $stage = 'document-heading' 
  $columns = if ($payload.cumulative) { 7 } else { 3 }
  $lastHeader = if ($payload.cumulative) { 7 } else { 6 }
  $sheet.Cells.Font.Name = 'Segoe UI'
  $sheet.Cells.Font.Size = 9.5
  $sheet.Columns.Item(1).ColumnWidth = if ($payload.cumulative) { 47 } else { 65 }
  for ($column = 2; $column -le $columns; $column++) {
    $sheet.Columns.Item($column).ColumnWidth = if ($column % 2 -eq 0) { if ($payload.cumulative) { 12 } else { 20 } } else { if ($payload.cumulative) { 18 } else { 25 } }
  }
  $headings = @($payload.institution, $payload.title, $payload.code, $payload.period)
  $heights = @(24,30,36,20)
  for ($row = 1; $row -le 4; $row++) {
    $range = $sheet.Range($sheet.Cells.Item($row,1),$sheet.Cells.Item($row,$columns))
    $range.Merge()
    Text $sheet.Cells.Item($row,1) ([string]$headings[$row-1])
    $range.WrapText = $true
    $range.HorizontalAlignment = -4108
    $range.VerticalAlignment = -4108
    $range.RowHeight = $heights[$row-1]
    $range.Font.Color = Color '414C44'
    if ($row -le 2) { $range.Font.Bold = $true }
    if ($row -eq 2) { $range.Font.Size = 11 }
    if ($row -eq 3) { $range.Font.Size = 8 }
  }
  $sheet.Rows.Item(5).RowHeight = 7
  $stage = 'table-heading'
  if ($payload.cumulative) {
    $sheet.Range('A6:A7').Merge()
    Text $sheet.Range('A6') 'Вид допомоги'
    $labels = @('ПЛАН','ФАКТ','РІЗНИЦЯ')
    for ($group = 0; $group -lt 3; $group++) {
      $col = 2 + $group * 2
      $sheet.Range($sheet.Cells.Item(6,$col),$sheet.Cells.Item(6,$col+1)).Merge()
      Text $sheet.Cells.Item(6,$col) $labels[$group]
      Text $sheet.Cells.Item(7,$col) 'Отримувачі'
      Text $sheet.Cells.Item(7,$col+1) 'Сума'
    }
  } else {
    Text $sheet.Cells.Item(6,1) 'Вид допомоги'
    Text $sheet.Cells.Item(6,2) 'Кількість виплачених допомог'
    Text $sheet.Cells.Item(6,3) 'Фактично виплачена сума'
  }
  $header = $sheet.Range($sheet.Cells.Item(6,1),$sheet.Cells.Item($lastHeader,$columns))
  $header.Interior.Color = Color 'EDF5EF'
  $header.Font.Color = Color '315D40'
  $header.Font.Bold = $true
  $header.HorizontalAlignment = -4108
  $header.VerticalAlignment = -4108
  $header.WrapText = $true
  $header.RowHeight = if ($payload.cumulative) { 22 } else { 32 }
  $row = $lastHeader + 1
  foreach ($record in @($payload.rows)) {
    Assert-Active
    $stage = 'row-label'
    Text $sheet.Cells.Item($row,1) ([string]$record.label)
    $sheet.Cells.Item($row,1).WrapText = $true
    $sheet.Cells.Item($row,1).HorizontalAlignment = -4131
    $values = @($record.values)
    for ($index = 0; $index -lt $values.Count; $index++) {
      $cell = $sheet.Cells.Item($row,$index+2)
      $number = [double]$values[$index]
      $stage = 'number-format'
      if ($index % 2 -eq 1) {
        $cell.NumberFormatLocal = $moneyFormat
        $stage = 'number-value'
        $cell.Value2 = $number / 100
      } else {
        $cell.NumberFormatLocal = $countFormat
        $stage = 'number-value'
        $cell.Value2 = $number
      }
      $cell.HorizontalAlignment = -4108
      $cell.VerticalAlignment = -4108
    }
    $stage = 'row-layout'
    $range = $sheet.Range($sheet.Cells.Item($row,1),$sheet.Cells.Item($row,$columns))
    $range.VerticalAlignment = -4108
    if ($record.kind -eq 'program') {
      $range.Font.Bold = $true
      $range.Interior.Color = Color 'F3F5F4'
    } elseif ($record.kind -eq 'total') {
      $range.Font.Bold = $true
      $range.Interior.Color = Color 'E5F0E7'
      $range.Font.Color = Color '294E36'
    }
    $range.Rows.AutoFit() | Out-Null
    $row++
  }
  $stage = 'column-fit'
  # Numeric columns must show the entire value, including large and negative sums.
  for ($column = 2; $column -le $columns; $column++) {
    $numericColumn = $sheet.Columns.Item($column)
    $minimumWidth = [double]$numericColumn.ColumnWidth
    $numericColumn.AutoFit() | Out-Null
    if ([double]$numericColumn.ColumnWidth -lt $minimumWidth) { $numericColumn.ColumnWidth = [int][Math]::Ceiling($minimumWidth) }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($numericColumn)
  }
  $table = $sheet.Range($sheet.Cells.Item(6,1),$sheet.Cells.Item($row-1,$columns))
  $table.Borders.LineStyle = 1
  $table.Borders.Weight = 2
  $table.Borders.Color = Color 'D6DDD8'
  $stage = 'page-setup'
  $setup = $sheet.PageSetup
  $setup.PaperSize = 9
  $setup.Orientation = 1
  $setup.Zoom = $false
  $setup.FitToPagesWide = 1
  $setup.FitToPagesTall = 1
  $setup.LeftMargin = $excel.CentimetersToPoints(1.3)
  $setup.RightMargin = $excel.CentimetersToPoints(1.3)
  $setup.TopMargin = $excel.CentimetersToPoints(1.3)
  $setup.BottomMargin = $excel.CentimetersToPoints(1.3)
  $setup.CenterHorizontally = $true
  $setup.PrintArea = '$A$1:$' + [char](64 + $columns) + '$' + [string]($row - 1)
  $setup.PrintTitleRows = if ($payload.cumulative) { '$6:$7' } else { '$6:$6' }
  Assert-Active
  $workbook.CheckCompatibility = $false
  $stage = 'save-xlsx'
  $workbook.SaveAs([string]$payload.excelPath, 51)
  $stage = 'close-workbook'
  $workbook.Close($false)
  [Console]::Out.Write((@{ kind = 'HROMADA_REPORT_EXCEL_DONE'; stage = 'complete' } | ConvertTo-Json -Compress))
} catch {
  $exception = $_.Exception
  $code = 'HROMADA_REPORT_EXCEL_FAILED'
  $safeMessage = 'PowerShell/Excel operation failed'
  if ($exception.Message -match 'HROMADA_EXCEL_UNAVAILABLE') { $code = 'HROMADA_EXCEL_UNAVAILABLE'; $safeMessage = 'Excel COM activation failed' }
  elseif ($exception.Message -match 'HROMADA_REPORT_CANCELLED') { $code = 'HROMADA_REPORT_CANCELLED'; $safeMessage = 'Export cancelled' }
  elseif ($exception.Message -match '(Unable to set the [A-Za-z]+ property of the [A-Za-z]+ class)') { $safeMessage = $Matches[1] }
  elseif ($exception.Message -eq 'Specified cast is not valid.') { $safeMessage = 'Specified cast is not valid.' }
  elseif ($exception.Message -match '(Exception from HRESULT: 0x[0-9A-Fa-f]{8})') { $safeMessage = $Matches[1] }
  # Never emit the payload, cell contents, paths or a PowerShell stack trace.
  [Console]::Error.Write((@{ kind = 'HROMADA_REPORT_EXCEL_ERROR'; stage = $stage; code = $code; message = $safeMessage; errorType = $exception.GetType().FullName; hresult = $exception.HResult; line = $_.InvocationInfo.ScriptLineNumber } | ConvertTo-Json -Compress))
  exit 1
} finally {
  if ($workbook -ne $null) { try { $workbook.Close($false) } catch {} }
  if ($excel -ne $null) { try { $excel.Quit() } catch {} }
  foreach ($object in @($setup,$table,$header,$range,$cell,$sheet,$workbook,$excel)) {
    if ($null -ne $object -and [System.Runtime.InteropServices.Marshal]::IsComObject($object)) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object) } catch {} }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
