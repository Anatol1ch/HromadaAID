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

Stable `0.1.2` — попередній опублікований реліз. Stable `0.1.3` hotfix також
опубліковано; після виправлення clean Server-only/Combined setup та API health у
Windows 10 x64 VM ще потребують підтвердження. Функціональні зміни інсталятора й
Server Manager ведуться окремо для `0.1.4`.

| Напрям | Поточний статус | Межі доказів |
| --- | --- | --- |
| Client 0.1.0 → 0.1.1 | VM PASS | Повний GitHub Stable update, UAC/NSIS, свіжий marker, версія й restart; Server/Manager контрольні hashes та API Service state/PID збережені. Без повної перевірки SQLite/даних і безперервного health |
| Manager-only NSIS | VM PASS | Локальний виправлений Setup; SetOutPath перед swap перевірено у Windows 10 x64 |
| Manager через GitHub | PENDING | Повний автоматичний цикл із виправленим опублікованим Setup ще не підтверджений; старі спроби FAIL збережені в історії |
| API Server ZIP 0.1.0 → 0.1.1 | VM PASS | Власник підтвердив успішний ZIP update після локального встановлення виправленого Manager; окремі data/config preservation checks PENDING |
| Windows shortcuts | IMPLEMENTED / AUTOMATED PASS; VM PENDING | Дефект видалення Client-ярликів підтверджено; виправлення й цільові тести 14/14 PASS, повторний VM-тест pending |
| Відмови / recovery / UAC retry | PENDING у VM | Автоматичні synthetic/mock перевірки не замінюють реальні Windows сценарії |
| Stable 0.1.2 clean server setup | VM FAIL | `package.verify / ENOENT` на helper-only Manager payload; Service і server.json не створилися, бо setup зупинився раніше |
| Stable 0.1.3 hotfix | PUBLISHED; VM ACCEPTANCE PENDING | Payload resolver використовує повний `Server.next`, не послаблює integrity checks; production build і manifest були перевірені до публікації. Чистий Server-only/Combined VM test та API health після hotfix ще не підтверджені |

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

## Версії та наступні кроки

`0.1.2` — попередній Stable Release. `0.1.3` — опублікований Stable hotfix.
Поточний вихідний код зберігає версію `0.1.3`; `0.1.4` ще не має version bump,
production build, Git tag або GitHub Release.

Для `0.1.4` вже реалізовано два UX-завдання: спрощений потік Universal Setup та
покращення сторінки оновлень Server Manager. Їхні цільові автоматизовані перевірки
пройшли; ручна Windows VM-перевірка залишається pending. Порядок наступних етапів:

1. Окреме завдання production packaging `0.1.4`: узгодження версій і підготовка
   Setup, Server ZIP та release manifest у `release/0.1.4/`.
2. Ручна публікація GitHub Stable Release власником після перевірки артефактів.
3. Windows 10 x64 VM acceptance після публікації; не заявляти VM PASS раніше.

## 0.1.4 — Task 1: Installation / Update UX

**Статус: IMPLEMENTED / AUTOMATED PASS.** У `packaging/windows-installer.nsi` звичайний Universal Setup показує
Welcome → Components, а Client/Manager selective update — відповідний Update Welcome
і пропускає Components. Clean/installed/unknown визначається тільки з
`InstalledComponents` разом із перевіркою потрібних EXE; стан не виводить версію, а
selective update показує цільову версію зі Setup. API Server і далі оновлюється
окремо через Server Manager. Цільові automated NSIS/selective-update tests пройшли;
ручна Windows 10/11 VM-перевірка сторінок, completion і restart залишається PENDING.
Production packaging та GitHub publication `0.1.4` — PENDING; version bump не
виконувався.

## 0.1.4 — Task 2: Server Manager Updates UI

**Статус: IMPLEMENTED / AUTOMATED PASS.** У `server-manager/src/UpdateManagement.tsx` API Server ZIP download
показує спільний Client/Manager progress із фактичними байтами, приховує
transaction stages до завершення завантаження та перевірки, а потім повертається до
наявного семиетапного встановлення. Картки зберігають структуру й розміщують дії у
правій колонці; довгі release notes можна розгорнути. Стани перевірки Manager
узгоджені з Client, з окремими доступним, актуальним, активним і помилковим станами.
Цільові результати наведені у HANDOFF; перевірка UI, адаптивності й реального
завантаження у Windows VM — PENDING. Production packaging та GitHub publication
`0.1.4` — PENDING. Механізми оновлення та серверної транзакції не змінювалися.

## Подальші напрями

| Етап | Обсяг | Передумови |
| --- | --- | --- |
| 9.1 — Automatic Updates | Завершення реальних component/update/failure перевірок | Прийняті результати VM та матриця pending; не підміняти source readiness production readiness |
| 9.2 — Tailscale Connectivity | Підключення Client і мережеві перевірки | Зберегти TLS/auth/RBAC; перевірити реальне підключення машин |
| 9.3 — Project Cleanup | Окремий технічний борг і застарілі файли | Підтверджені залежності; збереження SQL modules, копій і сумісності |
| 9.4 — Production Release | Фінальна перевірка й підготовка до використання | VM acceptance та явні дозволи на packaging/publication |
