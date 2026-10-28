# Фактична архітектура

## Потік робочих даних

`Client React → typed preload/IPC → Electron main HttpClient → Fastify → SQLite`.
Renderer ізольований: sandbox/contextIsolation увімкнені, nodeIntegration
вимкнений. Сесія Client утримується в пам'яті Electron main; робоча база живе
виключно на сервері. Excel COM і файлові діалоги документів виконуються локально.

| Каталог | Відповідальність |
| --- | --- |
| `src/` | React Client, реєстри, налаштування, repository/API wrappers |
| `electron/` | Client main/preload/HTTP, Excel; також історично розміщені серверні SQL/domain модулі |
| `server/src/` | Fastify, auth/RBAC, installed runtime, backup/restore CLI |
| `shared/` | Типи, контракти, правила сумісності й спільна domain-логіка |
| `server-manager/src/` | React Manager: Огляд, Конфігурація, Діагностика, Резервне копіювання, Оновлення |
| `server-manager/electron/` | Довірені IPC, SCM, встановлення, update/recovery, блокування операцій |
| `packaging/`, `scripts/`, `assets/` | NSIS/PowerShell, build/verification, брендинг |

SQL stores і міграції в `electron/` використовує Server. Назва каталогу не означає
legacy local mode і не є підставою для видалення. `server/src/database.ts`
використовує спільну ініціалізацію з `electron/database.ts` (міграції до 28).
Server використовує Node.js `node:sqlite`; Fastify й Argon2 — його production dependencies.

## Встановлений сервер і транспорт

- Windows x64, WinSW, одна служба HromadaAIDApi під LocalService та окремий service SID.
- Програмні файли за замовчуванням: C:\Program Files\HromadaAID; дані:
  %ProgramData%\HromadaAID\Data; копії: %ProgramData%\HromadaAID\Backups.
- Data/server.json, SQLite Data/Database/hromada-aid.sqlite, журнали Data/Logs.
  Дані й архіви — окремі локальні фіксовані NTFS-каталоги; файлові експорт/імпорт
  архівів через Manager можуть працювати із зовнішніми доступними носіями.
- Один Fastify instance, одна серверна SQLite й один IPv4 HTTP listener
  0.0.0.0:4310. Адреса й порт зафіксовані в server/src/server-runtime.ts.
  Другого listener немає; зайнятий порт зупиняє запуск із діагностикою.
- Loopback http://127.0.0.1:4310, LAN і Tailscale одночасно ведуть до цього
  сервера. Wildcard bind не залежить від конкретної адреси адаптера; поява
  Tailscale після старту або зміна LAN IP не потребують повторного bind.
- Внутрішнього TLS немає. LAN HTTP не шифрує запити; Tailscale надає шифрований
  тунель. Сервер не залежить від Tailscale або інтернету. Зовнішній HTTPS для
  GitHub Releases та завантажень збережено.

### Конфігурація та клієнти Stage 9.2

Єдина схема server.json — configVersion: 3, programDirectory, databasePath,
backupDirectory. Transport-полів немає. Server parser, Manager inspection,
installer generator і PowerShell preflight відхиляють невідому версію/поля,
зокрема колишні mode/host/port/tls, без міграції або скидання даних. Шлях Logs
належить WinSW XML. Приклад: [installed-config.example.json](../server/installed-config.example.json).

Client вручну отримує HTTP URL з IPv4 або DNS-ім'ям і портом 4310. Адреса
зберігається в userData/server-connection.json; повторні спроби використовують
той самий сервер. Зміна адреси проходить health-check без credentials, завершує
стару сесію та потребує входу до нового origin. Redirects заборонені; API-шлях
не може змінювати origin запиту. Автоматичного пошуку й перемикання серверів немає.
Authentication, Argon2id, RBAC, sessions та server-side authorization збережено.

Manager перевіряє SCM та http://127.0.0.1:4310/health окремо. Running не доводить
готовності API. Той самий локальний health URL використовують install/update/recovery.
Майстер має три кроки: каталоги, адміністратор, підсумок; адрес на завершенні немає.
На основному екрані Manager є loopback і адреси з копіюванням. LAN визначається за
активними фізичними IPv4 адаптерами Windows; Tailscale — за metadata адаптера та
відповідною IPv4, а сама CGNAT-адреса не є доказом. Відоме обмеження 0.2.1: у
протестованій Windows VM автоматичне визначення/відображення LAN або Tailscale IPv4
може бути некоректним. Це не впливає на API чи Client transport; адресу вводять у
Client вручну. Власник прийняв обмеження. Збір metadata має timeout і його помилка
не змінює результати SCM/API.

Tailscale SDK/API, встановлення/керування tailnet, discovery і автоматичних правил
Windows Firewall немає. Мережевий доступ залежить від зовнішніх firewall rules,
маршрутизації й політик tailnet. Деталі: [TRANSPORT.md](../server/TRANSPORT.md).
Stage 9.2 прийнято у Windows VM; результати та відоме обмеження зафіксовані в
[чеклісті ручного тестування](stage-9.2-manual-testing.md).

## Резервування та restore

API Server створює SQLite backup API snapshots, перевіряє цілісність і формує
шифровані `.hraid` (AES-256-GCM, ключ із DPAPI-захистом, незалежний аварійний ключ).
Щоденний цикл — 12:00 локального часу, catch-up після запуску, до трьох спроб із
паузою 5 хвилин; ротація лише 14 автоматичних копій.

Manager використовує авторизований API для звичайних операцій і packaged Node/CLI
для локальної перевірки та offline restore. Restore: підтвердження → maintenance →
підтверджена зупинка служби/процесу → чинний journaled SQLite engine зі страховою
копією і `.before-restore-<id>` → запуск служби → API health.

`restore-recovery.ts` і наявний CLI продовжують незавершений restore. Повернення
попередньої бази можливе лише за незмінних логічних fingerprint поточної та
страхових баз і наявного непідтвердженого completion receipt. Зміни даних,
пошкоджені докази або вже підтверджений API блокують повернення. Restore захищає
staging, але не перебудовує ACL кореня Backups під користувача Manager.

## Оновлення та recovery

Ручний ZIP проходить захищене розпакування, обидва маніфести, хеші, API/schema
сумісність і SemVer-політику: лише новіша стабільна версія. Перевірка integrity
існуючого пакета збережена; підтримки старого транспорту чи server.json v1/v2 немає.

Транзакція використовує `Server.next`, `Server`, `Server.previous`, `Server.failed`
і `Data/.hromadaaid-update-state.json`. Старий пакет зберігається до підтвердження
успіху. Recovery звіряє реальні файли/identity, схему, SCM і health: завершує вже
придатний новий пакет або повертає перевірений попередній. Неоднозначний стан
зберігає артефакти. Оновлення пакета не є rollback бази даних.

Критичні IPC серіалізовані й перевіряють renderer/повноваження. Локальний recovery
потребує Windows administrator; online DB recovery — також актуального RBAC.
Після timeout lock не звільняється без підтвердження завершення дерева процесів.

### Stable GitHub Releases і Client

`shared/release-updates.mjs` містить спільну перевірку SemVer, Stable release
metadata, GitHub Releases API, HTTPS-перевірку redirect host, manifest contract,
потокове завантаження, контроль точного розміру/SHA-256 і тимчасові файли з атомарним
перейменуванням. `assets/release-channel.json` задає owner/repository; значення
підтверджене Git remote (`Anatol1ch/HromadaAID`). Токени не використовуються.
З'єднання має timeout 20 с, потік — timeout бездіяльності 45 с; активне повільне
завантаження не обмежується коротким загальним часом. JSON metadata має окремий
обмежений timeout і size limit. Якщо джерело недоступне до
підтвердження нового релізу, Client працює звичайно; після підтвердження номер версії
і метадані зберігаються в Electron `userData`, тож вимога оновлення лишається після
перезапуску й недоступності GitHub.

`release-manifest.json` описує один Windows x64 універсальний Setup і Server ZIP,
їхні SHA-256/розміри, версію та compatibility markers. Server ZIP зберігає власний
`package-integrity.json`; зовнішній release manifest не дублює його. Команда
`node packaging/release-manifest.mjs --create <directory> <version>` створює й
локально перевіряє metadata за фактичними файлами, `--verify <directory>` звіряє
наявний manifest. Скрипт не публікує GitHub Release.

Electron main виконує асинхронну перевірку на запуску та кожні три години; Settings
дає ручну перевірку. Після підтвердженого релізу єдиний модальний gate блокує Client,
поки перевірений Setup не встановить нову версію. Downloader тримає lock, показує
progress, перевіряє цілісність і очищує лише власний неповний файл. Після явного
підтвердження попередження про незбережені зміни спільний
`shared/windows-update-launcher.mjs` запускає короткий PowerShell bootstrap через
абсолютний System32 шлях, без Node `detached:true`. Bootstrap через Start-Process
створює незалежний launcher із файловими stdout/stderr. Electron очікує
`ready.json` із правильним PID та завершення bootstrap, записує `handoff.confirmed`
і лише тоді закривається. Без handoff Setup не авторизований.
Launcher чекає завершення Client, викликає Setup через звичайний UAC `RunAs`, чекає
NSIS і перевіряє exit code, свіжий success marker поточної спроби та ProductVersion
EXE (допускається Windows fourth zero); тоді виконує один restart.
Відмова UAC/невдале встановлення повертає Client до обов'язкового gate. Автоматичний
rollback частково перезаписаного Client не заявляється.

Діагностика лишається в користувацькому `updates/installer-launcher.log` і
`updates/launcher-<uuid>/`: stdout/stderr, bootstrap stdout/stderr, ready/result,
handoff та параметри bootstrap. Логи не містять credentials чи повного environment.
Client і Manager використовують спільні `ReleaseUpdateDetails` / `ReleaseNotes` /
`ReleaseUpdateProgress`: Markdown відтворюється React text nodes без raw HTML і
активних посилань; довгий опис прокручується, download показує bytes/percent,
невизначені етапи — indeterminate progress.

Для цього використовується той самий NSIS Setup і запис Installed Apps. Спеціальний
`/CLIENTUPDATE=1` обходить вибір компонентів/каталогів, виконує наявний Client
payload section і disk preflight, пропускає видалення незазначених компонентів,
зберігає `InstalledComponents`, шляхи Data/Backups і metadata Manager. Server section,
service control, server files та server data не змінюються. Client-only, Server-only
і Combined як і раніше підтримуються звичайним Setup. Реальне UAC/NSIS/Combined
перевіряється лише у Windows VM.

Server Manager повторно використовує той самий `shared/release-updates.mjs`,
`assets/release-channel.json`, `release-manifest.json`, SemVer і SHA-256 downloader.
У Manager package script додає модуль до `main/shared/`; токени й інші credentials
не використовуються. Main process перевіряє Stable реліз під час запуску й кожні
три години, а розділ «Оновлення» дає ручну перевірку. Стан Manager з підтвердженим
релізом атомарно зберігається в окремому `userData`; якщо GitHub згодом недоступний,
обов’язковий gate залишається. Завантаження Setup перевіряється повторно перед
запуском launcher. Свіжий NSIS marker і версія EXE підтверджують завершення; marker відсутній —
після рестарту Manager зберігає вимогу оновлення. Менеджер оновлюється першим.

Спільний release manifest описує сумісність Manager за `same-release-version` та
API contract v1. Менеджер дозволяє автоматичне серверне оновлення лише коли його
встановлена версія збігається з версією релізу. Це виключає запуск ZIP-транзакції
старішим Manager. Серверний ZIP завантажується тим самим verifier і передається
наявним `prepareServerUpdate` / `applyServerUpdate`; перевірки внутрішніх integrity
manifests, API/schema compatibility, SemVer, `Server.next` / `Server.previous` /
`Server.failed`, журнал, SCM та API health лишаються у чинному engine. Зупинка API
починається лише після окремого підтвердження адміністратора. Успіх UI відображає
лише результат після підтвердження активного пакета, SCM і health.

Універсальний Setup має `/MANAGERUPDATE=1` для Server Manager-only Upgrade.
Режим перевіряє місце для Manager payload, пропускає вибір компонентів і каталогів,
замінює лише `ServerManager`, зберігає `InstalledComponents`, Installed Apps запис,
Data/Backups locators та не викликає server section, service control чи видалення
інших компонентів. Зовнішній launcher чекає завершення Manager, запускає чинний
Setup через стандартний UAC `RunAs`, перевіряє exit code і marker, потім запускає
Manager повторно. NSIS стадіює payload у `ServerManager.next`, виконує swap через
`ServerManager.previous` і відновлює попередню папку, якщо rename перервався. Setup
перед swap виконує `SetOutPath "$INSTDIR"`, звільняючи робочий каталог
`ServerManager.next`. Setup має візуальний progress. Після видалення попередньої папки повний rollback не
гарантується. Реальні UAC, NSIS, переривання копіювання та перезапуск потребують
Windows VM.

## Збірка

`packaging/manager-setup-payload.mjs` залишає в Manager
`resources/server-payload/installer` із PowerShell orchestration та sibling
transaction/verifier/runtime-check modules; повний Server app/runtime/service
повторно не копіюється. Manager має власні update/recovery helpers незалежно від
версії завантаженого ZIP. Підготовка створює `Server.next` раніше за запуск
installer; journal записується пізніше після preflight і зупинки Service.
Залишки без journal зберігаються, автоматичне recovery заборонене.

Ярлики обох компонентів синхронізує `packaging/windows-shortcuts.ps1` після
встановлення/Modify. Selective update визначає інший встановлений компонент за
`InstalledComponents`: Client-only передає ManagerSelected, Manager-only —
ClientSelected. Звичайний режим використовує вибрані секції. Видаляються лише
належні exact-name ярлики з очікуваним target/arguments/identity; сторонні й
користувацькі ярлики зберігаються. API ZIP updater ярликами не керує. Єдиний
Installed Apps запис і склад компонентів зберігає NSIS metadata section.

### Welcome та UI встановлення й оновлень

Звичайний запуск Universal Setup проходить Welcome → вибір одного з трьох режимів → каталог програми; welcome
класифікує лише достовірний стан інсталяції, не визначаючи наперед намір змінити
склад компонентів. `/CLIENTUPDATE=1` і `/MANAGERUPDATE=1` показують власний update
welcome та штатно пропускають Components. Обидва режими залишаються незалежними; API
Server оновлюється окремо через Server Manager.

На сторінці Manager «Оновлення» три наявні картки розміщують головні дії у правій
колонці. Client і Manager використовують спільні `ReleaseUpdateDetails`, `ReleaseNotes`
та `ReleaseUpdateProgress`; ZIP download показує фактичні байти/розмір або
невизначений прогрес, а стадії серверної транзакції відображаються окремо після
завантаження. Довгі release notes розгортаються через `details`; оновлення цього UI
не змінює IPC, updater чи серверну транзакцію. Ручна Windows VM-перевірка цих UX
змін залишається окремим acceptance кроком.

TypeScript/React/Vite, Electron, pnpm; конфігурації й команди в `package.json`,
`server/package.json`, `server-manager/electron-builder.yml`. NSIS Unicode + MUI2
і nsDialogs дають єдиний Setup з одним Installed Apps записом; програмні файли
відокремлені від даних, які штатний Uninstall зберігає. SHA-256 manifests
перевіряють цілісність, але не є криптографічним підтвердженням видавця.
