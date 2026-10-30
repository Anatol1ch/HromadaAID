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

### Конфігурація та клієнти (підготовка 1.0.1)

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
На основному екрані Manager є три фіксовані позиції Loopback, LAN і Tailscale.
Адреси вводяться вручну; поруч із текстом — кнопки Copy → Pencil.
Збір Windows metadata, Get-NetAdapter/Get-NetIPAddress та поле
InspectionSnapshot.networkAddresses вилучено. Загальна перевірка середовища
та її 15-секундне оновлення збережені.

server-manager/electron/server-address-settings.ts читає й послідовно зберігає
userData/server-addresses.json у %APPDATA%/HromadaAID-Server-Manager.
Формат: { version: 1, loopback, lan, tailscale }; початковий Loopback —
http://127.0.0.1:4310, LAN/Tailscale — null. Відсутній файл не створюється
під час читання. Некоректний JSON, невідома версія, структура, URL або помилка
доступу повертають явну помилку й блокують звичайне редагування без reset.
Запис: черга → повторне читання → ексклюзивний тимчасовий файл у тому самому
каталозі → sync/close → rename. Профіль поза програмним каталогом зберігається
при стандартному оновленні для того самого Windows-користувача.

Чиста validateServerBaseUrl() у shared/server-base-url.mjs спільна для Client
і Manager; electron/runtime-config.ts зберігає сумісні експорти.
Дозволені HTTP, IPv4/DNS, порт 4310, без credentials, шляху, query чи fragment;
IPv6 і 0.0.0.0 відхиляються. Manager додатково обмежує Loopback до 127.0.0.1
або localhost; порожні LAN/Tailscale зберігає як null. Збереження не перевіряє
доступність і не викликає SCM. Вузькі IPC отримання/збереження/копіювання
перевіряють довірений renderer; копіювання приймає лише ключ позиції та читає
поточне значення зі сховища. Редаговані адреси не впливають на server.json,
Client або сталий LOCAL_HEALTH_URL http://127.0.0.1:4310/health.
Скрипт scripts/copy-manager-shared.mjs включає валідатор до окремого Manager
build/dev; упаковка копіює цей runtime asset разом із main.

Tailscale SDK/API, встановлення/керування tailnet, discovery і автоматичних правил
Windows Firewall немає. Мережевий доступ залежить від зовнішніх firewall rules,
маршрутизації й політик tailnet. Деталі: [TRANSPORT.md](../server/TRANSPORT.md).
Stage 9.2 прийнято у Windows VM; результати та відоме обмеження зафіксовані в
[чеклісті ручного тестування](stage-9.2-manual-testing.md).

## Формування платіжних документів (1.0.1)

StatementFormation отримує спеціалізовані StatementAssignment з bankId/bankName.
electron/statement-list-data.ts та electron/statement-data.ts визначають банк
через recipients.bank_details_id → bank_details.bank_id → banks.id. Схема SQLite
залишається 28; загальна модель призначення інших реєстрів не розширюється.

Наявні GET /api/statements, POST /api/statements/snapshot і
/api/statements/bank-snapshot використовують рік рішення та дозволені статуси.
Банківський snapshot повертає лише поля відповідного експорту й перевірки груп.
Перед генерацією Electron читає новий snapshot і звіряє ID, bankId та aidTypeId
кожного включеного призначення з погодженим планом. Зміни складу, недоступні
записи й неповні обов'язкові реквізити зупиняють пакет до Excel.

shared/statement-groups.ts використовується і планом, і генераторами:
персональні/зведені групуються за aidTypeId + bankId, банківські — лише за bankId.
Одиниця — assignment.id; повторний ID усувається, суперечливий повтор відхиляється,
різні призначення одного отримувача зберігаються. Рядки й групи впорядковуються
за стабільними ID. Суми рахуються в цілих копійках із контролем safe integer;
переведення в гривні для запису відбувається на межі Excel. Порожні групи
не створюють файлів; записи без банку не відкидаються мовчки.

У StatementParametersModal банки обмежені позначеними призначеннями;
«Всі банки» — масовий вибір із проміжним станом. Chips, підсумок і план реактивні,
чернетки реквізитів зберігаються за ключем виду/банку/частини. Кількість означає
призначення. Персональні групи діляться по 12; зведені мають один підсумковий
рядок на введену дату. Дати й період документа не є новим фільтром призначень
і не встановлюють paid_on.

electron/statements-ipc.ts послідовно запускає чинний Excel worker на копіях
незмінених шаблонів. Персональні результати — справжній XLS/BIFF8 і PDF,
зведені — XLSX і PDF, банківські — масив XLSX з банківськими метаданими.
Використовуються чинні керовані тимчасові каталоги, реєстр результатів і
діалоги збереження. Збій будь-якого файла скасовує весь поточний пакет;
попередні незалежні результати залишаються доступними.

shared/statement-filenames.ts зберігає спеціальний персональний формат
і блокує повторні назви за однакових номера/дати. Зведені й банківські назви
містять очищену назву банку та ідентичність на основі його ID; перевіряються
колізії без урахування регістру й довжина назв. Генерація виконує лише читання БД,
не змінює статусів, paid_on, сум або фінансових зв'язків.
Структура «ПриватБанк.xlsx» використовується як раніше; сумісність з імпортом
інших банків не підтверджена.

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
наявний manifest. Stable packaging/publication виконує стандартний GitHub Actions
workflow `.github/workflows/release.yml` за схемою:

`Push у main → Windows build → Release packaging → Integrity verification → Draft Release → Stable publication`

Єдиний workflow публікує лише нову Stable SemVer; перевірка наявних Releases і
тегів не допускає повторної публікації. Build job має `contents: read`, окремий
publication job — `contents: write`. Збережено чинні Universal Setup, Server ZIP і
release manifest contracts; локальні packaging scripts лишаються для розробки й
діагностики. Ручна Windows release build через Codex не потрібна.

`pnpm release:package` викликає чинний `windows:installer`, потім
`scripts/package-release.mjs`. Toolchain: Node.js 24.22.1 (`.node-version`,
`engines`) і pnpm 11.25.0 (`packageManager`); lockfile збережено.
Release packager копіює той самий `installer-payload/Server` у власний staging,
додає Deployment 2.0 component manifest наявним generator і формує ZIP без
каталогу-обгортки: `app/`, `runtime/`, `service/`, `installer/`,
`package-integrity.json`, `package-manifest.json`. ZIP entries використовують `/`.
Перед фінальною публікацією каталогу ZIP проходить чинний безпечний extractor
Manager, обидва package verifiers, runtime check і `verifyUpdatePackage`.
`release/<version>/` містить рівно Setup EXE, Server ZIP та release manifest із
чинними назвами. Наявний version directory не перезаписується; незавершений
власний staging видаляється. Це локальне формування комплекту, без GitHub publication.

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
