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

Stage 8.2 завершено за рішенням власника проєкту. Це статус реалізації,
а не твердження про виконання всіх ручних VM-сценаріїв або production readiness.
Актуальні підтвердження й обмеження зберігає [HANDOFF.md](HANDOFF.md).

## Наступні етапи

| Етап | Обсяг | Основні передумови |
| --- | --- | --- |
| **9.1 — Automatic Updates** | Client, Manager та API Server через GitHub Releases | Узгодити канали, довіру до артефактів, version/compatibility metadata і перезапуск; повторно використати серверні транзакції/recovery |
| **9.2 — Tailscale Connectivity** | Підключення клієнтів, конфігурація адреси й необхідні мережеві перевірки | Зберегти TLS/auth/RBAC; перевірити реальне підключення кількох машин і дозволені маршрути/порти |
| **9.3 — Project Cleanup** | Цільове очищення застарілих файлів і технічного боргу | Підтвердити недосяжність/відсутність залежностей; зберегти чинні SQL modules, копії й сумісність |
| **9.4 — Production Release** | Фінальна перевірка, версія, production-збірка, GitHub Release та підготовка до використання | Прийняті VM-перевірки, правила релізу й оновлення, явний дозвіл на packaging/publication |

Ці етапи заплановані. Поточна документаційна задача їх не реалізує й не дозволяє
автоматично виконувати публікацію, зміну версії або пакування.
