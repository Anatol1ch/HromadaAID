param(
  [Parameter(Mandatory = $true)][ValidateSet('client', 'server', 'server-client')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$ProgramDirectory,
  [Parameter(Mandatory = $false)][string]$DataDirectory,
  [Parameter(Mandatory = $false)][string]$BackupDirectory,
  [Parameter(Mandatory = $true)][ValidateRange(0, 9007199254740991)][Int64]$ClientBytes,
  [Parameter(Mandatory = $true)][ValidateRange(0, 9007199254740991)][Int64]$ServerBytes,
  [Parameter(Mandatory = $true)][ValidateRange(0, 9007199254740991)][Int64]$SupportBytes
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class HromadaAidInstallerPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
  public static string Resolve(string path) {
    using (var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      var buffer = new StringBuilder(32768);
      var length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
      if (length == 0 || length >= buffer.Capacity) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      var result = buffer.ToString();
      if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + result.Substring(8);
      if (result.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return result.Substring(4);
      return result;
    }
  }
}
'@

function Stop-WithMessage([string]$message) {
  [Console]::Error.WriteLine($message)
  if ($message -match 'недостатньо місця') { exit 3 }
  if ($message -match 'NTFS') { exit 4 }
  if ($message -match 'server\.json|базу HromadaAID|DPAPI-ключ|резервних архівів|резервних копій уже є архіви') { exit 5 }
  if ($message -match 'перекриватися|поза каталогом програми|каталозі програмних файлів') { exit 6 }
  exit 1
}

function Resolve-PotentialPath([string]$path) {
  $full = [IO.Path]::GetFullPath($path).TrimEnd('\')
  $tail = [Collections.Generic.List[string]]::new()
  $current = $full
  while (-not [IO.Directory]::Exists($current)) {
    $parent = [IO.Directory]::GetParent($current)
    if ($null -eq $parent) { throw "Не вдалося визначити реальне розташування: $path" }
    $tail.Insert(0, [IO.Path]::GetFileName($current))
    $current = $parent.FullName
  }
  $resolved = [HromadaAidInstallerPath]::Resolve($current)
  foreach ($part in $tail) { $resolved = Join-Path $resolved $part }
  return [IO.Path]::GetFullPath($resolved).TrimEnd('\')
}

function Is-Within([string]$parent, [string]$candidate) {
  $parentFull = [IO.Path]::GetFullPath($parent).TrimEnd('\')
  $candidateFull = [IO.Path]::GetFullPath($candidate).TrimEnd('\')
  return $candidateFull.Equals($parentFull, [StringComparison]::OrdinalIgnoreCase) -or $candidateFull.StartsWith($parentFull + '\', [StringComparison]::OrdinalIgnoreCase)
}

$paths = @{ 'програми' = $ProgramDirectory }
if ($Mode -ne 'client') {
  if ([string]::IsNullOrWhiteSpace($DataDirectory) -or [string]::IsNullOrWhiteSpace($BackupDirectory)) {
    Stop-WithMessage 'Для серверного компонента потрібно вказати каталоги даних і резервних копій.'
  }
  $paths['серверних даних'] = $DataDirectory
  $paths['резервних копій'] = $BackupDirectory
}
$resolved = @{}
foreach ($entry in $paths.GetEnumerator()) {
  if ($entry.Value -notmatch '^[A-Za-z]:\\' -or $entry.Value.Substring(2) -match '[<>:"|?*\x00-\x1f]') {
    Stop-WithMessage "Шлях до каталогу $($entry.Key) має бути абсолютним локальним шляхом Windows."
  }
  if ($entry.Value.StartsWith('\\')) { Stop-WithMessage 'Мережеві шляхи та UNC-каталоги для встановлення не підтримуються.' }
  if ([IO.Path]::GetFullPath($entry.Value).TrimEnd('\').Equals([IO.Path]::GetPathRoot($entry.Value).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithMessage "Каталог $($entry.Key) не може бути коренем диска."
  }
  try { $resolved[$entry.Key] = Resolve-PotentialPath $entry.Value }
  catch { Stop-WithMessage $_.Exception.Message }
  $drive = [IO.Path]::GetPathRoot($resolved[$entry.Key]).TrimEnd('\')
  $volume = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $drive + "'")
  if ($null -eq $volume -or $volume.DriveType -ne 3 -or $volume.FileSystem -ne 'NTFS') {
    Stop-WithMessage "Каталог $($entry.Key) має бути на доступному локальному диску NTFS."
  }
}

# The payload sizes come from the file-by-file packaging manifest. All consumers
# sharing a volume are aggregated before comparing with its one free-space value.
$requirements = @{}
function Add-VolumeRequirement([string]$Path, [Int64]$Bytes) {
  $root = [IO.Path]::GetPathRoot($Path).TrimEnd('\').ToUpperInvariant()
  if (-not $requirements.ContainsKey($root)) { $requirements[$root] = [Int64]0 }
  $requirements[$root] += $Bytes
}
$includesClient = $Mode -ne 'server'
$includesServer = $Mode -ne 'client'
$programPayload = [Int64]0
if ($includesClient) { $programPayload += $ClientBytes }
if ($includesServer) { $programPayload += $ServerBytes }
$programReserve = [Math]::Ceiling($programPayload * 0.15)
Add-VolumeRequirement $resolved['програми'] ($programPayload + $programReserve)
if ($includesServer) {
  Add-VolumeRequirement $resolved['серверних даних'] (16MB)
  Add-VolumeRequirement $resolved['резервних копій'] (16MB)
}
$tempPath = [IO.Path]::GetTempPath()
try { $tempResolved = Resolve-PotentialPath $tempPath }
catch { Stop-WithMessage "Системний тимчасовий каталог недоступний: $tempPath" }
$tempRoot = [IO.Path]::GetPathRoot($tempResolved).TrimEnd('\')
$tempVolume = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $tempRoot + "'")
if ($null -eq $tempVolume -or $tempVolume.DriveType -ne 3 -or $tempVolume.FileSystem -ne 'NTFS') {
  Stop-WithMessage 'Системний тимчасовий каталог має бути на доступному локальному диску NTFS.'
}
Add-VolumeRequirement $tempResolved ($SupportBytes + 8MB)

foreach ($volumeRoot in $requirements.Keys) {
  $volume = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $volumeRoot + "'")
  if ($null -eq $volume) { Stop-WithMessage "Диск $volumeRoot недоступний." }
  $required = [Int64]$requirements[$volumeRoot]
  $available = [Int64]$volume.FreeSpace
  if ($available -lt $required) {
    $requiredText = [Math]::Ceiling($required / 1MB).ToString('N0', [Globalization.CultureInfo]::GetCultureInfo('uk-UA')) + ' МіБ'
    $availableText = [Math]::Floor($available / 1MB).ToString('N0', [Globalization.CultureInfo]::GetCultureInfo('uk-UA')) + ' МіБ'
    Stop-WithMessage "На диску $volumeRoot недостатньо місця: потрібно щонайменше $requiredText, доступно $availableText. Змініть каталог або звільніть місце."
  }
}

$labels = @($resolved.Keys)
for ($i = 0; $i -lt $labels.Count; $i++) {
  for ($j = $i + 1; $j -lt $labels.Count; $j++) {
    $a = $resolved[$labels[$i]]
    $b = $resolved[$labels[$j]]
    if ((Is-Within $a $b) -or (Is-Within $b $a)) { Stop-WithMessage 'Каталоги програми, даних і резервних копій не повинні перекриватися.' }
  }
}

if ($Mode -ne 'client' -and ((Is-Within $resolved['програми'] $resolved['серверних даних']) -or (Is-Within $resolved['програми'] $resolved['резервних копій']))) {
  Stop-WithMessage 'Серверні дані та резервні копії мають бути поза каталогом програми.'
}
$programFilesRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
foreach ($root in $programFilesRoots) {
  $canonicalRoot = Resolve-PotentialPath $root
  if ($Mode -ne 'client' -and ((Is-Within $canonicalRoot $resolved['серверних даних']) -or (Is-Within $canonicalRoot $resolved['резервних копій']))) {
    Stop-WithMessage 'Серверні дані та резервні копії не можна розміщувати в каталозі програмних файлів.'
  }
}

$config = $null
$database = $null
if ($Mode -ne 'client') {
  $config = Join-Path $DataDirectory 'server.json'
  $database = Join-Path $DataDirectory 'hromada-aid.sqlite'
  $freshDatabase = Join-Path (Join-Path $DataDirectory 'Database') 'hromada-aid.sqlite'
  $keyFile = Join-Path $BackupDirectory '.hromadaaid-backup-key.dpapi'
  $archivePresent = [IO.Directory]::Exists($BackupDirectory) -and @(Get-ChildItem -LiteralPath $BackupDirectory -Filter '*.hraid' -File -ErrorAction Stop).Count -gt 0
  if (([IO.File]::Exists($database) -or [IO.File]::Exists($freshDatabase)) -and -not [IO.File]::Exists($config)) {
    Stop-WithMessage 'У вибраному каталозі знайдено базу HromadaAID без server.json. Потрібна явна перевірка наявних даних.'
  }
  if ([IO.File]::Exists($config)) {
    try { $existing = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json }
    catch { Stop-WithMessage 'Наявний server.json некоректний; він не буде перезаписаний.' }
    $expectedDatabase = [IO.Path]::GetFullPath($database)
    $expectedBackup = [IO.Path]::GetFullPath($BackupDirectory)
    $existingDatabase = [IO.Path]::GetFullPath([string]$existing.databasePath)
    if (($existingDatabase -ine $expectedDatabase -and $existingDatabase -ine [IO.Path]::GetFullPath($freshDatabase)) -or [IO.Path]::GetFullPath([string]$existing.backupDirectory) -ine $expectedBackup) {
      Stop-WithMessage 'Вибрані каталоги не відповідають наявному server.json. Для оновлення залиште попередні шляхи.'
    }
    if ([string]$existing.programDirectory -and [IO.Path]::GetFullPath([string]$existing.programDirectory) -ine [IO.Path]::GetFullPath($ProgramDirectory)) {
      Stop-WithMessage 'Каталог програми не відповідає наявному server.json. Для оновлення залиште попередній шлях або виконайте окреме перенесення.'
    }
    $databaseExists = [IO.File]::Exists($existingDatabase)
    if (([IO.File]::Exists($database) -or [IO.File]::Exists($freshDatabase)) -and -not $databaseExists) { Stop-WithMessage 'Знайдено SQLite поза шляхом із server.json; наявні дані залишено без змін.' }
    $keyExists = [IO.File]::Exists($keyFile)
    if (($databaseExists -xor $keyExists) -or ($archivePresent -and -not ($databaseExists -and $keyExists))) { Stop-WithMessage 'Наявні база, DPAPI-ключ або резервні архіви не утворюють повний комплект; потрібна окрема перевірка адміністратора.' }
  } elseif ([IO.File]::Exists($database) -or [IO.File]::Exists($freshDatabase) -or [IO.File]::Exists($keyFile) -or $archivePresent) {
    Stop-WithMessage 'У вибраних каталогах уже є база, DPAPI-ключ або архіви без сумісної конфігурації; автоматичну ініціалізацію зупинено.'
  }
}
