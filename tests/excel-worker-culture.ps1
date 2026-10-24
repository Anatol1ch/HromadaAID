param([string]$Script, [string]$Culture)
$ErrorActionPreference = 'Stop'
# Only this disposable child process is affected. Never alter Windows/Excel settings.
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($Culture)
[Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::GetCultureInfo($Culture)
$global:HromadaTestWorkerAst = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$null, [ref]$null)
function New-Object {
  param([string]$TypeName, [object[]]$ArgumentList, [string]$ComObject)
  if (-not $ComObject) { return Microsoft.PowerShell.Utility\New-Object @PSBoundParameters }
  if ($ComObject -ne 'Excel.Application') { throw 'Unexpected COM request' }
  # Inspect the real worker's decoded stdin at the COM boundary; no Excel starts.
  $actual = Get-Variable payload -Scope 1 -ValueOnly
  $record = $actual.records[0]
  if ($record.amount -is [string] -or [Math]::Abs([double]$record.amount - 1234.56) -gt 0.000001) { throw 'Numeric JSON contract failed' }
  # Evaluate the actual Value2 RHS expressions from the shipped worker, not copies
  # of its conversion logic, without creating a workbook or reading user data.
  $values = @{}
  foreach ($column in @(1, 7, 8)) {
    $left = '$sheet.Cells.Item($row, ' + $column + ').Value2'
    $assignment = @($global:HromadaTestWorkerAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq $left }, $true))[0]
    if (-not $assignment) { throw 'Worker cell assignment missing' }
    $values[$column] = & ([scriptblock]::Create($assignment.Right.Extent.Text))
  }
  if ($values[7] -isnot [double] -or [Math]::Abs($values[7] - 1234.56) -gt 0.000001) { throw 'Excel amount type changed' }
  if ($values[1] -isnot [string] -or $values[1] -ne '29.02.2028') { throw 'Excel date contract changed' }
  if ($values[8] -ne $actual.expectedName) { throw 'Unicode contract changed' }
  $total = [double]$record.amount + [double]$actual.records[1].amount
  if ([Math]::Abs($total - 1235) -gt 0.000001) { throw 'Total changed with culture' }
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ tested = $true; culture = $Culture; amount = $values[7]; date = $values[1]; unicode = ($values[8] -eq $actual.expectedName); total = $total }))
  throw 'SYNTHETIC_COM_BOUNDARY_STOP'
}
& $Script
exit $LASTEXITCODE
