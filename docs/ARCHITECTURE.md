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

- Windows x64, WinSW, служба `HromadaAIDApi`, LocalService та окремий service SID.
- Програмні файли за замовчуванням: `C:\Program Files\HromadaAID`; дані:
  `%ProgramData%\HromadaAID\Data`; копії: `%ProgramData%\HromadaAID\Backups`.
- `Data/server.json`, нова SQLite `Data/Database/hromada-aid.sqlite`, журнали
  `Data/Logs`. Сумісні старі шляхи з конфігурації зберігаються.
- Дані й архіви — окремі локальні фіксовані NTFS-каталоги; файлові експорт/імпорт
  архівів через Manager можуть працювати із зовнішніми доступними носіями.
- Типовий local endpoint: `http://127.0.0.1:4310`. `mode=local` у конфігурації
  сервера означає loopback HTTP, а не автономний SQLite-режим Client.
- Мережевий режим вимагає конкретного інтерфейсу й довіреного TLS; wildcard bind
  заборонений. Деталі: [server/TRANSPORT.md](../server/TRANSPORT.md).
- Стан служби через штатний системний `sc.exe` і стан `/health` перевіряються
  окремо. SCM-помилка не означає відсутності служби; Running не доводить готовності API.

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
сумісність і SemVer-політику: лише новіша стабільна версія. Installed legacy-пакет
із одним integrity manifest підтримується без вигаданих метаданих.

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
підтверджене Git remote. Токени не використовуються. Якщо джерело недоступне до
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
підтвердження попередження про незбережені зміни окремий PowerShell launcher чекає
завершення Client, викликає чинний Setup через звичайний UAC `RunAs`, чекає NSIS і
підтверджує результат за маркером успішної секції; тоді запускає Client повторно.
Відмова UAC/невдале встановлення повертає Client до обов'язкового gate. Автоматичний
rollback частково перезаписаного Client не заявляється.

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
запуском launcher. NSIS success marker підтверджує завершення; marker відсутній —
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
має візуальний progress. Після видалення попередньої папки повний rollback не
гарантується. Реальні UAC, NSIS, переривання копіювання та перезапуск потребують
Windows VM.

## Збірка

TypeScript/React/Vite, Electron, pnpm; конфігурації й команди в `package.json`,
`server/package.json`, `server-manager/electron-builder.yml`. NSIS Unicode + MUI2
і nsDialogs дають єдиний Setup з одним Installed Apps записом; програмні файли
відокремлені від даних, які штатний Uninstall зберігає. SHA-256 manifests
перевіряють цілісність, але не є криптографічним підтвердженням видавця.
