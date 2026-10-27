# Roadmap

## Завершена реалізація

| Етап / напрям | Результат |
| --- | --- |
| Клієнт-серверна міграція | Робочі реєстри через API; SQLite й бізнес-операції на Server; auth/RBAC |
| Stage 7 | Узгоджений UI і розділення компонентів; історичний звіт у stage-7-architecture-and-ui.md |
| Stage 8.2 | Єдиний Windows installer, первинне налаштування, SCM/health verification, брендинг і ярлики |
| Stage 8.2.5–8.2.10.2 + Final Test Fix | Backup/restore/update hardening, recovery, operation locks; історичні цільові перевірки завершені |
| Stage 9.1.1 | IMPLEMENTED: спільний Stable GitHub provider, manifest/SHA-256/downloader і Client update |
| Stage 9.1.2 | IMPLEMENTED: Manager-only NSIS update та API Stable ZIP через чинну транзакцію/recovery |

Завершена реалізація не означає завершення всіх ручних сценаріїв або production
readiness. Обмеження перевірок — у [HANDOFF.md](HANDOFF.md).

## Stage 9.1.3 — триває

Stable 0.1.0 і 0.1.1 опубліковані. Source SemVer залишається 0.1.1. Виправлення
консолідовані локальними комітами; опублікований 0.1.1 їх не отримував.

| Напрям | Поточний статус | Межі доказів |
| --- | --- | --- |
| Client 0.1.0 → 0.1.1 | VM PASS | Повний GitHub Stable update, UAC/NSIS, свіжий marker, версія й restart; Server/Manager контрольні hashes та API Service state/PID збережені. Без повної перевірки SQLite/даних і безперервного health |
| Manager-only NSIS | VM PASS | Локальний виправлений Setup; SetOutPath перед swap перевірено у Windows 10 x64 |
| Manager через GitHub | PENDING | Повний автоматичний цикл із виправленим опублікованим Setup ще не підтверджений; старі спроби FAIL збережені в історії |
| API Server ZIP 0.1.0 → 0.1.1 | VM PASS | Власник підтвердив успішний ZIP update після локального встановлення виправленого Manager; окремі data/config preservation checks PENDING |
| Windows shortcuts | IMPLEMENTED / AUTOMATED PASS; VM PENDING | Дефект видалення Client-ярликів підтверджено; виправлення й цільові тести 14/14 PASS, повторний VM-тест pending |
| Відмови / recovery / UAC retry | PENDING у VM | Автоматичні synthetic/mock перевірки не замінюють реальні Windows сценарії |

Під час консолідації 2026-10-27: updater/launcher/manifest/NSIS/packaging —
**40/40 AUTOMATED PASS**; чотири релевантні TypeScript no-emit checks пройшли.
Матриця сценаріїв і попередні FAIL: [manual testing](stage-9.1.3-manual-testing.md).
Stage 9.1.3 та Stage 9.1 не завершені; production readiness не заявляється.

## Погоджена послідовність 0.1.2 → 0.1.3

Це план окремих завдань. Поточна консолідація не починає release preparation.

1. Консолідувати Git і документацію Stage 9.1.3.
2. За окремим завданням підготувати Stable 0.1.2 з усіма виправленнями.
3. Зробити production build усіх компонентів зі штатного source.
4. Перевірити Universal Setup, Server ZIP і release manifest.
5. Отримати окреме погодження публікації.
6. Опублікувати Stable 0.1.2.
7. Виконати чисте Combined встановлення 0.1.2 у Windows 10 x64 VM.
8. Створити контрольний snapshot.
9. Реалізувати майбутні зміни installer і Server Manager для 0.1.3 за окремими вимогами власника.
10. Опублікувати Stable 0.1.3 за окремим погодженням.
11. Послідовно перевірити Client, Manager і API Server update 0.1.2 → 0.1.3 у VM.

## Подальші напрями

| Етап | Обсяг | Передумови |
| --- | --- | --- |
| 9.1 — Automatic Updates | Завершення реальних component/update/failure перевірок | Прийняті результати VM та матриця pending; не підміняти source readiness production readiness |
| 9.2 — Tailscale Connectivity | Підключення Client і мережеві перевірки | Зберегти TLS/auth/RBAC; перевірити реальне підключення машин |
| 9.3 — Project Cleanup | Окремий технічний борг і застарілі файли | Підтверджені залежності; збереження SQL modules, копій і сумісності |
| 9.4 — Production Release | Фінальна перевірка й підготовка до використання | VM acceptance та явні дозволи на packaging/publication |
