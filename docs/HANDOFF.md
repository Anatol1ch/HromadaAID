# HromadaAID — поточний checkpoint

## Стан проєкту

- Поточний Stable: **0.1.6**, опублікований у GitHub.
- **Stage 9.1 — Automatic Updates завершено** після приймання основних сценаріїв у Windows 10 x64 VM.
- Stage 9.1 інтегровано в main. Поточна робоча гілка — feature/tailscale-connectivity, HEAD 1b9c143c210c019e2c42d0276c0ca27df1acaad9 (документаційний commit перед реалізацією Stage 9.2). Зміни Stage 9.2 незакомічені; push/merge/rebase не виконувалися.
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

## Stage 9.2 — реалізовано, очікує VM-приймання

Стан на 2026-10-28: Prompt 1–4 інтегровано в робочому дереві. Етап **не завершено**.
Один Fastify/SQLite та IPv4 HTTP 0.0.0.0:4310 доступні через loopback, LAN і
Tailscale. Client зберігає введену вручну HTTP IPv4/DNS адресу; discovery або
автоматичного перемикання серверів немає. Manager показує адреси з копіюванням
лише в огляді; майстер — каталоги → адміністратор → підсумок.

Єдина конфігурація — configVersion: 3, programDirectory, databasePath,
backupDirectory. Старі версії/transport-поля відхиляються без переписування,
скидання чи підміни SQLite. Listener і порт не налаштовуються. Внутрішнього TLS,
Tailscale SDK/API та автоматичних Windows Firewall rules немає. LAN HTTP не
шифрується; Tailscale забезпечує тунель. Зовнішній HTTPS збережено.
WinSW/LocalService, authentication/RBAC, сесії, backup/restore та загальні
update/recovery guards залишаються чинними. Деталі — у
[ARCHITECTURE.md](ARCHITECTURE.md) і [TRANSPORT.md](../server/TRANSPORT.md).

### Автоматично перевірено

Результати Prompt 1–3: TypeScript/збірки змінених компонентів; один IPv4 listener,
локальний health і запити до адрес локальних інтерфейсів; зайнятий порт і звільнення
ресурсів після невдалого bind; строгий config v3 і відмова без змін тестових файлів;
Client URL/redirect/session/auth/RBAC; збереження адреси після втрати зв'язку;
Manager inspection, відсутність Tailscale, довірений IPC, service-control, preflight,
пакетні update/rollback і захист ACL на ізольованих даних. Реальний read-only запит
Windows визначив один фізичний LAN-адаптер; Tailscale-адаптера в цьому середовищі немає.
Production ZIP acceptance пропущено: свіжого пакета цього стану не створювали.

Prompt 4: цільовий огляд інтеграції та констант, синхронізація семи документів,
практичний VM-чекліст. Прибрано дублювання адрес на сторінці конфігурації Manager
і застарілі demo-підказки про обов’язковий HTTPS та доступ лише з цього ПК.
Виконано свіжі server:build і manager:build, три shell/source-тести Manager та
чотири цільові backup/restore тести — PASS. Останні підтвердили HTTP auth/RBAC,
захист від пошкодженого/несумісного restore, відмову за нових записів/відсутніх
доказів, збереження журналів і Backups ACL на ізольованих даних. Попередні
успішні набори для незміненого коду не повторювалися.
Переліки залежностей і зовнішній GitHub HTTPS не змінювалися.

### Ще потребує Windows 10 x64 VM

Свіжий Universal NSIS з поточного коду, UAC, три режими встановлення, реальний SCM,
LocalService/ACL, перезапуск Windows, візуальний огляд, копіювання адрес, LAN і
Tailscale з іншого доступного вузла, update/recovery та backup/restore через GUI.
Mock SCM, локальні IP-запити й тести файлів не доводять ці сценарії. Старий
опублікований Setup 0.1.6 не є кандидатом Stage 9.2; сумісність із ним не перевіряється.

Наступний крок — окремо дозволена підготовка свіжих пакетів, потім
[stage-9.2-manual-testing.md](stage-9.2-manual-testing.md). Для update/rollback потрібні
узгоджені тестові версії з HTTP/config v3 та підготовлений сценарій помилки.
До успішного ручного приймання лишати Stage 9.2 у статусі AWAITING VM ACCEPTANCE.
Не створювати commit/release або запускати packaging без нового завдання.
