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

Stable 0.1.0, 0.1.1 і 0.1.2 опубліковані. Чисте встановлення 0.1.2 на Windows 10
x64 VM виявило блокер: Manager вибирає helper-only resources замість повного
`Server.next`, після чого перевірка integrity зупиняє первинний wizard до створення
`server.json` і Service. Готується мінімальний Stable 0.1.3 hotfix; функціональні
зміни інсталятора та Server Manager перенесено на 0.1.4.

| Напрям | Поточний статус | Межі доказів |
| --- | --- | --- |
| Client 0.1.0 → 0.1.1 | VM PASS | Повний GitHub Stable update, UAC/NSIS, свіжий marker, версія й restart; Server/Manager контрольні hashes та API Service state/PID збережені. Без повної перевірки SQLite/даних і безперервного health |
| Manager-only NSIS | VM PASS | Локальний виправлений Setup; SetOutPath перед swap перевірено у Windows 10 x64 |
| Manager через GitHub | PENDING | Повний автоматичний цикл із виправленим опублікованим Setup ще не підтверджений; старі спроби FAIL збережені в історії |
| API Server ZIP 0.1.0 → 0.1.1 | VM PASS | Власник підтвердив успішний ZIP update після локального встановлення виправленого Manager; окремі data/config preservation checks PENDING |
| Windows shortcuts | IMPLEMENTED / AUTOMATED PASS; VM PENDING | Дефект видалення Client-ярликів підтверджено; виправлення й цільові тести 14/14 PASS, повторний VM-тест pending |
| Відмови / recovery / UAC retry | PENDING у VM | Автоматичні synthetic/mock перевірки не замінюють реальні Windows сценарії |
| Stable 0.1.2 clean server setup | VM FAIL | `package.verify / ENOENT` на helper-only Manager payload; Service і server.json не створилися, бо setup зупинився раніше |
| Stable 0.1.3 hotfix | LOCAL BUILD / AUTOMATED PASS; VM PENDING | Payload resolver використовує повний `Server.next`, не послаблює integrity checks; build і manifest перевірені. Чистий Server-only/Combined VM test та публікація pending |

Під час консолідації 2026-10-27: updater/launcher/manifest/NSIS/packaging —
**40/40 AUTOMATED PASS**; чотири релевантні TypeScript no-emit checks пройшли.
Під час локальної підготовки 0.1.2 production builds завершилися, package/runtime
checks пройшли, а цільові updater/launcher/NSIS/shortcut/package тести — **46/46
AUTOMATED PASS**. Для 0.1.3 production build завершився; цільові перевірки —
**118/119 PASS, 1 SKIP** (наявний Windows ZIP-specific test пропущено без його test
fixture), два Manager TypeScript no-emit checks пройшли. Усі результати лишаються
локальними й не замінюють Windows VM acceptance.
Матриця сценаріїв і попередні FAIL: [manual testing](stage-9.1.3-manual-testing.md).
Stage 9.1.3 та Stage 9.1 не завершені; production readiness не заявляється.

## Погоджена послідовність 0.1.2 → 0.1.3 → 0.1.4

Stable 0.1.2 уже опубліковано. 0.1.3 — виправний реліз без функціональних змін;
майбутні зміни інтерфейсу Manager та інсталятора відкладені до 0.1.4.

1. Підготувати й перевірити код, production assets та manifest Stable 0.1.3.
2. Окремо погодити push, tag і публікацію Stable 0.1.3.
3. Виконати чисте Server-only та Combined встановлення 0.1.3 у Windows 10 x64 VM; перевірити wizard, config, service та API health.
4. Після успішного baseline створити контрольний snapshot.
5. Реалізувати майбутні зміни інсталятора та Server Manager для Stable 0.1.4.
6. Окремо погодити публікацію Stable 0.1.4.
7. Послідовно перевірити Client, Manager і API Server update 0.1.3 → 0.1.4 у VM.

## 0.1.4 — Task 1: Installation / Update UX

IMPLEMENTED у `packaging/windows-installer.nsi`: після вибору компонентів welcome
сторінка розрізняє чисте встановлення, оновлення, зміну складу та невизначений стан.
Класифікація спирається на `InstalledComponents` і наявність executable-файлів;
перевстановлення з тим самим набором показується як оновлення. Для update UI
відображає цільову версію Setup, але не приписує одну встановлену версію компонентам,
які могли оновлюватися окремо. Вибір компонентів та інсталяційні/оновлювальні секції
збережені. Цільові automated NSIS source tests пройшли; візуальна Windows 10/11 VM
перевірка чистого встановлення, оновлення та повторного запуску залишається PENDING.
Повний реліз 0.1.4 не готувався.

## Подальші напрями

| Етап | Обсяг | Передумови |
| --- | --- | --- |
| 9.1 — Automatic Updates | Завершення реальних component/update/failure перевірок | Прийняті результати VM та матриця pending; не підміняти source readiness production readiness |
| 9.2 — Tailscale Connectivity | Підключення Client і мережеві перевірки | Зберегти TLS/auth/RBAC; перевірити реальне підключення машин |
| 9.3 — Project Cleanup | Окремий технічний борг і застарілі файли | Підтверджені залежності; збереження SQL modules, копій і сумісності |
| 9.4 — Production Release | Фінальна перевірка й підготовка до використання | VM acceptance та явні дозволи на packaging/publication |
