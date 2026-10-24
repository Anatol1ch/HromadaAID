param([string]$Script, [string]$Culture)
$ErrorActionPreference = 'Stop'
# Test process only; never modify Windows or Excel's regional preferences.
[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($Culture)
[Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::GetCultureInfo($Culture)
& $Script
exit $LASTEXITCODE
