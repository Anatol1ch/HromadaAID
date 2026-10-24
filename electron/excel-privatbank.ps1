$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$payload = $null
$stage = 'input'
$excel = $null
$workbook = $null
$sheet = $null
function Assert-GenerationActive {
  if ($payload.cancelPath -and [System.IO.File]::Exists([string]$payload.cancelPath)) { throw 'HROMADA_GENERATION_CANCELLED' }
}
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Assert-GenerationActive
  $stage = 'template-check'
  if (-not (Test-Path -LiteralPath $payload.templatePath)) { throw 'Bank template copy not found.' }
  $records = @($payload.records)
  if ($records.Count -lt 1 -or $records.Count -gt 500) { throw 'Invalid record count.' }
  $stage = 'excel-start'
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  Assert-GenerationActive
  $stage = 'workbook-open'
  $workbook = $excel.Workbooks.Open($payload.templatePath, 0, $false)
  $sheet = $workbook.Worksheets.Item('cards 1')
  $stage = 'fill-template'
  $expected = @('RLSUM', 'LSTBL', 'INN', 'RLKOD')
  for ($column = 1; $column -le 4; $column++) {
    if ([string]$sheet.Cells.Item(1, $column).Value2 -cne $expected[$column - 1]) { throw 'HROMADA_BANK_TEMPLATE_INVALID' }
  }
  if ([string]$sheet.Cells.Item(1, 5).Value2 -cnotin @('CARD_NO', 'CARN_NO')) { throw 'HROMADA_BANK_TEMPLATE_INVALID' }
  $rowHeight = [double]$sheet.Rows.Item(2).RowHeight
  $lastTemplateRow = $sheet.UsedRange.Row + $sheet.UsedRange.Rows.Count - 1
  $lastDataRow = $records.Count + 1
  if ($lastTemplateRow -gt $lastDataRow) {
    $firstUnusedRow = $lastDataRow + 1
    [void]$sheet.Rows("${firstUnusedRow}:$lastTemplateRow").Delete()
  }
  # Remove all sample values in the copy, keeping the source header and row formatting.
  $sheet.Range("A2:E$lastDataRow").ClearContents()
  for ($i = 0; $i -lt $records.Count; $i++) {
    Assert-GenerationActive
    $row = $i + 2
    if ($i -gt 0) {
      [void]$sheet.Range('A2:E2').Copy()
      [void]$sheet.Range("A${row}:E$row").PasteSpecial(-4122)
    }
    $sheet.Rows.Item($row).RowHeight = $rowHeight
    $sheet.Cells.Item($row, 1).NumberFormatLocal = '0' + [string]$excel.International(3) + '00'
    $sheet.Cells.Item($row, 1).Value2 = [double]$records[$i].amount
    # LSTBL stays empty. Identifiers must remain strings, including leading zeroes.
    $sheet.Cells.Item($row, 3).NumberFormat = '@'
    $sheet.Cells.Item($row, 3).Value2 = [string]$records[$i].rnokpp
    $sheet.Cells.Item($row, 4).Value2 = [string]$payload.paymentPurpose
    $sheet.Cells.Item($row, 5).NumberFormat = '@'
    $sheet.Cells.Item($row, 5).Value2 = [string]$records[$i].bankAccount
  }
  Assert-GenerationActive
  $stage = 'workbook-save'
  $workbook.Save()
  $stage = 'workbook-close'
  $workbook.Close($false)
  [Console]::Out.Write((ConvertTo-Json -Compress @{ ok = $true }))
} catch {
  $failure = $_
  if ($workbook -ne $null) { try { $workbook.Close($false) } catch {} }
  $code = 'EXCEL_OPERATION_FAILED'
  foreach ($known in @('HROMADA_BANK_TEMPLATE_INVALID', 'HROMADA_GENERATION_CANCELLED')) {
    if ($failure.Exception.Message.Contains($known)) { $code = $known }
  }
  [Console]::Error.WriteLine((ConvertTo-Json -Compress @{ kind = 'HROMADA_STATEMENT_EXCEL_ERROR'; stage = $stage; code = $code; errorType = $failure.Exception.GetType().FullName; hresult = $failure.Exception.HResult; line = $failure.InvocationInfo.ScriptLineNumber }))
  exit 1
} finally {
  if ($excel -ne $null) { try { $excel.Quit() } catch {} }
  if ($sheet -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) } catch {} }
  if ($workbook -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) } catch {} }
  if ($excel -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch {} }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
