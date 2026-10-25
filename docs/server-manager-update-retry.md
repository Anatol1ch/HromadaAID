# Повторне тестування ZIP-оновлення Server Manager у Windows VM

Причина збою підготовки: production ZIP містить 1482 файли з `package-integrity.json`
та два маніфести (1484 файли). `prepareServerInstall` додає
`service/HromadaAIDService.xml` (1485 файлів). Первинна перевірка залишається суворою.
Після підготовки дозволено лише цей додатковий файл із точним SHA-256 результату
чинного `renderWinSWConfig`; решта складу та хешів перевіряється без винятків.

Помилка підготовки означає: виклик перемикання не розпочинався або сценарій явно
підтвердив збереження попереднього пакета, немає журналу/`Server.previous`/
`Server.failed`, перевірено хеші чинного пакета та початковий стан служби/API.
Сам `Server.next` не є доказом невдалого відкату. Він залишається для діагностики
та блокує наступне оновлення до явного рішення адміністратора.

Успішний відкат потребує окремого сигналу сценарію після `finalize-rollback`,
відсутності залишків транзакції та підтвердження попереднього пакета й стану
служби. Доступний API та збіг версії самі по собі цього не доводять.

## VM із залишеним Server.next після помилки підготовки

Ця процедура призначена лише для описаної тестової VM з наведеними нижче шляхами.
Збережіть знімок VM та повідомлення попередньої помилки. Закрийте старий Manager.
Наступний блок виконується вручну в адміністративному PowerShell у VM.
Він перевіряє активний сервер і перейменовує лише підготовлений каталог;
служба не зупиняється, дані не видаляються.

```powershell
$ErrorActionPreference = 'Stop'
$program = 'C:\Program Files\HromadaAID'
$data = 'C:\ProgramData\HromadaAID\Data'
$next = Join-Path $program 'Server.next'
$active = Join-Path $program 'Server'
$critical = @(
  (Join-Path $program 'Server.previous'),
  (Join-Path $program 'Server.failed'),
  (Join-Path $data '.hromadaaid-update-state.json')
)
foreach ($path in $critical) {
  if (Test-Path -LiteralPath $path) { throw "Потрібна діагностика транзакції: $path" }
}
$service = Get-CimInstance Win32_Service -Filter "Name='HromadaAIDApi'"
if (-not $service -or $service.State -ne 'Running') { throw 'Чинна служба не працює.' }
$binary = $null
if ($service.PathName -match '^\s*"([^"]+)"') { $binary = $matches[1] }
elseif ($service.PathName -match '^\s*(.*?\.exe)(?:\s|$)') { $binary = $matches[1] }
$expected = Join-Path $active 'service\HromadaAIDService.exe'
if (-not $binary -or [IO.Path]::GetFullPath($binary) -ine [IO.Path]::GetFullPath($expected)) {
  throw 'Служба використовує інший пакет; каталог не перейменовано.'
}
& (Join-Path $active 'runtime\node.exe') (Join-Path $active 'installer\verify-server-package.mjs') $active
if ($LASTEXITCODE -ne 0) { throw 'Чинний пакет не пройшов штатну перевірку.' }
$health = Invoke-RestMethod 'http://127.0.0.1:4310/health' -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.service -ne 'hromada-aid-api' -or $health.apiContractVersion -ne 1) {
  throw 'API не підтвердив працездатність HromadaAID.'
}
$item = Get-Item -LiteralPath $next
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Server.next не є звичайним каталогом.'
}
foreach ($path in $critical) {
  if (Test-Path -LiteralPath $path) { throw 'Стан транзакції змінився. Зупиніться.' }
}
$preservedName = 'Server.next.preparation-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
if (Test-Path -LiteralPath (Join-Path $program $preservedName)) { throw 'Каталог діагностики вже існує.' }
Rename-Item -LiteralPath $next -NewName $preservedName
Write-Output "Підготовлений пакет збережено: $(Join-Path $program $preservedName)"
```

Якщо будь-яка перевірка не проходить, нічого не перейменовуйте й не видаляйте.
Для нестандартних шляхів спершу звірте їх у Manager із реальною службою та
`server.json`; не переносіть цю команду на робочий комп'ютер.

## Наступний запуск

1. Розпакуйте новий portable ZIP Manager в окремий каталог та запустіть EXE
   від адміністратора. Копіювання лише EXE недостатньо.
2. Перевірте: інсталяція встановлена, служба працює, API доступний.
3. Виберіть той самий довірений server ZIP; підтвердьте дані пакета й оновлення.
4. Перевірте кінцевий стан API/служби та відсутність журналу транзакції,
   `Server.next`, `Server.previous`, `Server.failed`. Діагностичний каталог,
   перейменований вручну, зберігайте до завершення тестування.
5. Авторизуйтеся в клієнті та перевірте попередні тестові записи. Збереження
   конфігурації й ключа перевіряйте за контрольними сумами, не публікуючи їхній вміст.

Реальна зупинка, реєстрація, запуск, health-check і відкат залишаються перевірками
Windows VM. Автоматизовані тести використовують mock SCM та повний production ZIP
із комплектним Node.js у тимчасових каталогах. Для явного вибору архіву:

```powershell
$env:HROMADAAID_TEST_SERVER_ZIP = 'D:\Packages\HromadaAID-Server-v0.1.0-win-x64.zip'
pnpm manager:test
```
