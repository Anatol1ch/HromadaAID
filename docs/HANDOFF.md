# HromadaAID — поточний checkpoint

## Стан проєкту

- Поточний Stable: **0.2.1**, опублікований у GitHub.
- **Stage 9.1 — Automatic Updates завершено** після приймання основних сценаріїв у Windows 10 x64 VM.
- **Stage 9.2 — Tailscale Connectivity завершено** та прийнято власником у Windows VM; Stable tag `0.2.1` вказує на `e159ab5b8536beb74e31ae8a3cee4c7151487932`.
- Автоматичне оновлення Client, Server Manager та API Server з 0.2.0 до 0.2.1 підтверджене власником. Конфігурація, SQLite й наявні дані збережені; служба та система працюють після оновлення.
- Відоме некритичне обмеження: Manager може некоректно визначати/показувати LAN або Tailscale IPv4 у деяких Windows VM. Client підключається через вручну введену адресу. Власник прийняв обмеження; окремого виправлення не планується.
- Релізний commit: `10b0b85b36a9cad84d75259aa6fe2dd90e08b4d4`; annotated tag `0.1.6` лишається на цьому commit. Документаційний checkpoint перед README update був `263c50b74cabf3d1172676bcaa5b738f650559d3`.
- Історичний VM snapshot Stage 9.1: `HromadaAID 0.1.6 – Stable Baseline`; він зберігає лише результати Stage 9.1.

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

## Stage 9.2 — COMPLETED, Stable 0.2.1

Власник підтвердив успішне ручне оновлення на Windows VM: Client, Server Manager
і API Server оновилися з 0.2.0; конфігурація, SQLite та записи збережені, Windows
Service і застосунок працюють після оновлення. Client підключається й авторизується
через Tailscale.

Транспорт незмінний: один Fastify/SQLite та IPv4 HTTP `0.0.0.0:4310`; Client
використовує вручну збережену IPv4/DNS адресу; discovery немає. Server Manager
показує адреси лише в огляді. Єдина конфігурація — v3. TLS для внутрішнього API,
Tailscale SDK/API та автоматичні Windows Firewall rules відсутні. Зовнішній HTTPS,
WinSW/LocalService, auth/RBAC, backup/restore і загальні update/recovery guards
збережені.

### Відоме обмеження Manager

На тестовій Windows VM автоматичне визначення/відображення LAN і Tailscale IPv4
працює некоректно. Це лише інформаційне відображення: воно не впливає на API,
Windows Service чи мережеву доступність. Client дозволяє вручну ввести серверну
адресу, і Tailscale-підключення Client підтверджене. Власник визнав обмеження
некритичним і вирішив не продовжувати виправлення зараз; нових завдань чи етапів
на цю тему не створювати.

### Автоматичні перевірки та пакети

Server Manager зібрано; мережеві й inspection-тести — 25/25 PASS, включно з типовими
та альтернативними назвами, відсутністю/неактивністю/IPv4-less Tailscale, стороннім
100.x адаптером, кількома інтерфейсами й помилкою metadata query. На цьому Windows
хості read-only query визначив активний Tailscale `100.89.0.34`; це не замінює VM.
Universal Setup зібрано, NSIS archive integrity та вміст перевірено; Server ZIP після
розпакування пройшов package integrity/runtime. Пакетні тести — 50/50 PASS.
Локальні артефакти лежать у `release/0.2.1`.

### Наступний крок

За [ROADMAP.md](ROADMAP.md) наступний запланований етап — **Stage 9.3: Project
Cleanup**. Stage 9.2 прийнято; виправлення відомого обмеження Manager не планується.
Протокол та результати оновлення: [stage-9.2-manual-testing.md](stage-9.2-manual-testing.md).
