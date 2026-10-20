# Test-only inspector. Reads synthetic workbooks, never the user's Excel session.
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$excel = $null; $book = $null; $baseline = $null; $sheet = $null; $other = $null
function Snapshot($worksheet) {
  $cells = @()
  for ($r = 1; $r -le 32; $r++) {
    for ($c = 1; $c -le 11; $c++) {
      $cell = $worksheet.Cells.Item($r, $c)
      $borders = @()
      foreach ($edge in @(7,8,9,10)) { $border = $cell.Borders.Item($edge); $borders += @([int]$border.LineStyle, [double]$border.Weight, [double]$border.Color) }
      $cells += ,@($cell.Value2, [string]$cell.Formula, [string]$cell.NumberFormat, [string]$cell.Font.Name, [double]$cell.Font.Size, [bool]$cell.Font.Bold, [bool]$cell.Font.Italic, [double]$cell.Font.Color, [double]$cell.HorizontalAlignment, [double]$cell.VerticalAlignment, [bool]$cell.WrapText, [string]$cell.MergeArea.Address(), $borders)
    }
  }
  $rows = @(for ($r = 1; $r -le 32; $r++) { @([double]$worksheet.Rows.Item($r).RowHeight, [bool]$worksheet.Rows.Item($r).Hidden) })
  $columns = @(for ($c = 1; $c -le 11; $c++) { [double]$worksheet.Columns.Item($c).ColumnWidth })
  $page = $worksheet.PageSetup
  return @{ cells=$cells; rows=$rows; columns=$columns; print=@([string]$page.PrintArea,[int]$page.Orientation,[int]$page.PaperSize,$page.Zoom,$page.FitToPagesWide,$page.FitToPagesTall,[double]$page.TopMargin,[double]$page.BottomMargin,[double]$page.LeftMargin,[double]$page.RightMargin) }
}
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $book = $excel.Workbooks.Open([string]$payload.path,0,$true)
  if ([int]$book.FileFormat -ne 56) { throw ('Expected genuine xlExcel8, found ' + $book.FileFormat) }
  $sheet = $book.Worksheets.Item(1)
  if ($payload.baselinePath) {
    $baseline = $excel.Workbooks.Open([string]$payload.baselinePath,0,$true)
    $other = $baseline.Worksheets.Item(1)
    $actual = Snapshot $sheet
    $expected = Snapshot $other
    # Compare each category independently for actionable regression failures.
    foreach ($key in @('cells','rows','columns','print')) {
      $a = ConvertTo-Json -InputObject $actual[$key] -Depth 12 -Compress
      $b = ConvertTo-Json -InputObject $expected[$key] -Depth 12 -Compress
      if ($a -cne $b) { throw ('XLS conversion changed ' + $key) }
    }
    $baseline.Close($false)
  }
  if ($payload.inspectionPath) { $book.CheckCompatibility=$false; $book.SaveAs([string]$payload.inspectionPath,51) }
  $book.Close($false)
  [Console]::Out.Write('{"ok":true,"format":56}')
} catch { [Console]::Error.Write($_.Exception.Message); exit 1 }
finally {
  if ($baseline) { try {$baseline.Close($false)} catch {} }
  if ($book) { try {$book.Close($false)} catch {} }
  if ($excel) { try {$excel.Quit()} catch {} }
  foreach ($item in @($other,$sheet,$baseline,$book,$excel)) { if ($item) { try {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($item)} catch {} } }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
