# HromadaAID — поточний checkpoint

## Стан проєкту

- Поточний Stable: **0.2.0**, опублікований у GitHub.
- **Stage 9.1 — Automatic Updates завершено** після приймання основних сценаріїв у Windows 10 x64 VM.
- Stage 9.2 інтегровано в `main`; Stable tag `0.2.0` вказує на `c1319027f2d3edb63f1d33299120260c18e09e6b`. Поточна робоча гілка — `fix/tailscale-adapter-detection`.
- Релізний commit: `10b0b85b36a9cad84d75259aa6fe2dd90e08b4d4`; annotated tag `0.1.6` лишається на цьому commit. Документаційний checkpoint перед README update був `263c50b74cabf3d1172676bcaa5b738f650559d3`.
- Історичний VM snapshot Stage 9.1: `HromadaAID 0.1.6 – Stable Baseline`. Він не підтверджує Stage 9.2; новий transport і конфігурація v3 потребують чистого приймання.

## Архітектура й оновлення

Client та Server Manager — окремі Electron-застосунки; API Server — Fastify із робочою SQLite на сервері. Один Universal NSIS Setup підтримує Client-only, Server-only (API + Manager) і Combined. Client і Manager оновлюються окремо через Stable GitHub Setup; API Server оновлюється ZIP-транзакцією з Server Manager.

Автоматичний Setup update використовує спільний зовнішній PowerShell launcher, handoff після завершення Electron, UAC, NSIS, свіжий completion marker, перевірку встановленої версії та restart. Server ZIP update зберігає integrity, compatibility та transaction/recovery guards. Деталі й незмінні рішення: [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md).

## Приймання Stable 0.1.6 — Windows 10 x64 VM

Власник підтвердив:

- Client автоматично оновився до 0.1.6.
- Server Manager автоматично оновився з 0.1.5 до 0.1.6.
- API Server оновився до 0.1.6 через Server Manager.
- Windows Service працює після оновлення, API доступний.
- Авторизація Client працює, наявні дані збережені.
- Усі компоненти мають версію 0.1.6.

Це підтверджує основні сценарії приймання, а не кожну окрему журнальну подію чи повну побайтову перевірку всіх даних. Розширені негативні, аварійні та стресові сценарії не входили до погодженого обсягу Stage 9.1 і не є блокером його завершення.

## Історія та обмеження

Попередні збої й виправлення не видаляються: вони залишаються в [історії ручного тестування Stage 9.1.3](stage-9.1.3-manual-testing.md). Ключові рішення: не робити recovery за неоднозначного стану; не трактувати відсутність журналу як доказ безпечного rollback; Server Manager payload містить потрібні installer/recovery helpers без дублювання Server runtime; shortcut sync спирається на фактично встановлений набір компонентів. Автоматичні тести й mock SCM самі по собі не доводять поведінку Windows VM.

Локальний `release/<version>/` — тимчасове сховище артефактів; він ігнорується Git. Після опублікованого та перевіреного релізу власник може видалити локальні збірки. Source scripts, regression tests, fixtures, migrations та recovery/integrity code залишаються під контролем версій.

## Stage 9.2 — очікує завершального оновлення 0.2.0 → 0.2.1 у VM

Stable `0.2.0` опубліковано; користувач підтвердив у Windows VM базове встановлення,
Windows Service, API, авторизацію та віддалене Tailscale-підключення. Етап **не
завершено**: лишилася ручна перевірка оновлення встановленої системи до 0.2.1.

Транспорт незмінний: один Fastify/SQLite та IPv4 HTTP `0.0.0.0:4310`; Client
використовує вручну збережену IPv4/DNS адресу; discovery немає. Server Manager
показує адреси лише в огляді. Єдина конфігурація — v3. TLS для внутрішнього API,
Tailscale SDK/API та автоматичні Windows Firewall rules відсутні. Зовнішній HTTPS,
WinSW/LocalService, auth/RBAC, backup/restore і загальні update/recovery guards
збережені.

### Виправлення Tailscale у 0.2.1

У 0.2.0 Manager покладався на повний збіг `InterfaceDescription` з обмеженим
переліком назв. Властивості адаптера проблемної VM не збережені, тому це
обґрунтована причина, а не підтверджене відтворення. 0.2.1 читає Windows alias,
description, PnP identity, стан і адресу; приймає варіанти назви Tailscale на
активному не фізичному адаптері та перевіряє IPv4. Сторонній Wintun/CGNAT інтерфейс
без Tailscale identity не класифікується як Tailscale. Tailscale CLI не запускається;
API Server і Windows Service не залежать від цих метаданих.

### Автоматичні перевірки та пакети

Server Manager зібрано; мережеві й inspection-тести — 25/25 PASS, включно з типовими
та альтернативними назвами, відсутністю/неактивністю/IPv4-less Tailscale, стороннім
100.x адаптером, кількома інтерфейсами й помилкою metadata query. На цьому Windows
хості read-only query визначив активний Tailscale `100.89.0.34`; це не замінює VM.
Universal Setup зібрано, NSIS archive integrity та вміст перевірено; Server ZIP після
розпакування пройшов package integrity/runtime. Пакетні тести — 50/50 PASS.
Локальні артефакти лежать у `release/0.2.1`.

### Ще потребує Windows 10 x64 VM

Використати наявну інсталяцію 0.2.0 — чиста інсталяція не замінює цей сценарій.
Після ручної публікації 0.2.1 перевірити оновлення Client і Manager через Stable
Setup, API Server через Server ZIP, збереження `server.json`/SQLite/записів, службу,
Tailscale IPv4 у Manager, копіювання та авторизацію Client через Tailscale. Також
перевірити реальний SCM/LocalService, UAC і повторний запуск. Оновлення не запускалося.
Чекліст: [stage-9.2-manual-testing.md](stage-9.2-manual-testing.md), сценарій E7.
Stage 9.2 лишається AWAITING VM ACCEPTANCE до підтвердження користувачем.
