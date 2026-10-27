# Roadmap

## Завершені етапи

| Етап | Статус | Підсумок |
| --- | --- | --- |
| Stage 9.1.1 | **COMPLETED** | Stable GitHub provider, release manifest, цілісність і Client update |
| Stage 9.1.2 | **COMPLETED** | Manager selective update та API Server ZIP update з чинною транзакцією/recovery |
| Stage 9.1.3 | **COMPLETED** | Виправлення й інтеграція автоматичних оновлень, пакування та перевірка Stable 0.1.6 |
| Stage 9.1 — Automatic Updates | **COMPLETED** | Основні Client, Manager та API Server update flows прийняті у Windows 10 x64 VM; Stable 0.1.6 опубліковано |

Власник підтвердив VM PASS для Client update до 0.1.6, повного автоматичного
Server Manager update 0.1.5 → 0.1.6 та API Server update до 0.1.6. Також
підтверджено роботу Windows Service та API, Client authorization, збереження
наявних даних, версію 0.1.6 усіх компонентів і snapshot
`HromadaAID 0.1.6 – Stable Baseline`. Розширені негативні, аварійні та стресові
перевірки не входили до погодженого обсягу приймання й не блокують завершення.
Історичні невдалі спроби та їх виправлення збережені у [Stage 9.1.3 manual testing](stage-9.1.3-manual-testing.md).

## Наступний етап

### Stage 9.2 — Tailscale Connectivity (**NEXT**)

Планувати підключення Client до сервера через Tailscale із збереженням чинних
TLS, авторизації та RBAC. Stage 9.1 уже інтегровано у `main` fast-forward способом.
Розробку Stage 9.2 планується вести в окремій гілці
`feature/tailscale-connectivity`, створеній від `main`; гілку ще не створено.
Конкретні вимоги Stage 9.2 визначатимуть обсяг реалізації. Етап має статус NEXT,
ще не розпочатий.

## Історичні релізи та етапи

- Stable `0.1.6` — поточний реліз; приймання Stage 9.1 завершено.
- `0.1.5`, `0.1.4`, `0.1.3` і раніші версії — історія виправлень та релізів, а не
  поточні PENDING роботи. Інциденти, результати та межі доказів наведені в
  [HANDOFF.md](HANDOFF.md) і [manual testing](stage-9.1.3-manual-testing.md).
- Stage 7, Stage 8 і клієнт-серверна міграція — завершені попередні етапи.

Повний контекст продукту: [PROJECT.md](PROJECT.md). Архітектурні межі й сталі
домовленості: [ARCHITECTURE.md](ARCHITECTURE.md) та [DECISIONS.md](DECISIONS.md).
