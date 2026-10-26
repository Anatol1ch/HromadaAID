# Roadmap

## Завершено

| Етап / напрям | Результат |
| --- | --- |
| Клієнт-серверна міграція | Робочі реєстри через API; SQLite й бізнес-операції на Server; auth/RBAC |
| Stage 7 | Узгоджений UI і розділення компонентів; історичний звіт у `stage-7-architecture-and-ui.md` |
| Stage 8.2 | Єдиний Windows installer, первинне налаштування, SCM/health verification, брендинг і ярлики |
| Stage 8.2.5–8.2.10 | Backup management у Manager, restore ACL fix, update hardening та UX refinement |
| Stage 8.2.10.1 | Контрольоване recovery update/restore, безпечне повернення бази, timeout/operation lock |
| Stage 8.2.10.2 + Final Test Fix | Контрольні Windows-артефакти; виправлено застарілий test assertion; installer tests 51/51 |
| Stage 9.1.1 | Shared Stable GitHub Releases metadata/checksum/download infrastructure, local release-manifest verification, Client automatic update та client-only режим чинного NSIS; цільові перевірки 10/10, TypeScript checks пройшли |
| Stage 9.1.2 | Server Manager mandatory update через Manager-only режим універсального NSIS; API Server Stable ZIP через чинний транзакційний update/recovery; цільові provider/Manager, NSIS/path, recovery й TypeScript перевірки пройшли |
| Stage 9.1.3 | **Stable 0.1.1 packaging prepared / Manual update testing pending** — 0.1.0 is the published Windows VM baseline; fresh 0.1.1 Universal Setup, Server ZIP and SHA-256 manifest are verified in `release/stage-9.1.3/stable-0.1.1/`; custom Data/Backups initial setup passed on a clean Windows 10 x64 VM (confirmed scope A08); GitHub 0.1.0 → 0.1.1 Client/Manager/API update scenarios remain pending publication and manual testing |

Stage 8.2 завершено за рішенням власника проєкту. Це статус реалізації,
а не твердження про виконання всіх ручних VM-сценаріїв або production readiness.
Актуальні підтвердження й обмеження зберігає [HANDOFF.md](HANDOFF.md).

## Наступні етапи

| Етап | Обсяг | Основні передумови |
| --- | --- | --- |
| **9.1 — Automatic Updates** | Client, Manager та API Server через GitHub Releases | Stable 0.1.0 — baseline; комплект Stable 0.1.1 підготовлено. Потрібні реальні GitHub update-перевірки Client/Manager/API, UAC/NSIS/component-preservation, Service/API health і failure/recovery у Windows VM. Stage 9.1 і продукт не production-ready до перевірок |
| **9.2 — Tailscale Connectivity** | Підключення клієнтів, конфігурація адреси й необхідні мережеві перевірки | Зберегти TLS/auth/RBAC; перевірити реальне підключення кількох машин і дозволені маршрути/порти |
| **9.3 — Project Cleanup** | Цільове очищення застарілих файлів і технічного боргу | Підтвердити недосяжність/відсутність залежностей; зберегти чинні SQL modules, копії й сумісність |
| **9.4 — Production Release** | Фінальна перевірка, версія, production-збірка, GitHub Release та підготовка до використання | Прийняті VM-перевірки, правила релізу й оновлення, явний дозвіл на packaging/publication |

Stage 9.1 позначає реалізацію, а не production readiness; потрібні VM перевірки з
HANDOFF. Наступні етапи не дозволяють автоматично виконувати публікацію, зміну
версії або пакування.
