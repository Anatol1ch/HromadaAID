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

## Збірка

TypeScript/React/Vite, Electron, pnpm; конфігурації й команди в `package.json`,
`server/package.json`, `server-manager/electron-builder.yml`. NSIS Unicode + MUI2
і nsDialogs дають єдиний Setup з одним Installed Apps записом; програмні файли
відокремлені від даних, які штатний Uninstall зберігає. SHA-256 manifests
перевіряють цілісність, але не є криптографічним підтвердженням видавця.
