# HromadaAID — поточний checkpoint

## Стан проєкту

- Поточний Stable: **0.1.6**, опублікований у GitHub.
- **Stage 9.1 — Automatic Updates завершено** після приймання основних сценаріїв у Windows 10 x64 VM.
- Stage 9.1 інтегровано у `main` fast-forward способом. Актуальний Git checkpoint — `main` і `feature/client-server` на `5eb6c926ec9f8b7bf915402e0283038207cadbb2`, синхронізовані з origin.
- Релізний commit: `10b0b85b36a9cad84d75259aa6fe2dd90e08b4d4`; annotated tag `0.1.6` лишається на цьому commit. Документаційний checkpoint перед README update був `263c50b74cabf3d1172676bcaa5b738f650559d3`.
- VM snapshot: `HromadaAID 0.1.6 – Stable Baseline`.

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

## Наступний етап

**Stage 9.2 — Tailscale Connectivity** є наступним і ще не розпочато. Планована гілка — `feature/tailscale-connectivity`, створена від `main`; її ще не створено. Погоджена ціль для внутрішнього API — HTTP через loopback, LAN і Tailscale до одного Server/бази; чинна мережна реалізація до впровадження Stage 9.2 продовжує вимагати HTTPS/TLS. Tailscale лишається зовнішнім інструментом, а authentication/RBAC зберігаються. Під час Stage 9.2 актуалізувати `server/TRANSPORT.md` після зміни реалізації. Поточний план — у [ROADMAP.md](ROADMAP.md), рішення — у [DECISIONS.md](DECISIONS.md).
