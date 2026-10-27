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

### 0.1.5 — launcher CWD hotfix та оформлення Setup

**IMPLEMENTED; VM PENDING.** Bootstrap і незалежний launcher працюють із user-data
updates directory; NSIS має явний CWD поза компонентом. Recovery/swap, UAC,
handoff, marker/version verification і restart збережені. Setup отримав
узгоджений Segoe UI, правий логотип і компактніший welcome без зміни порядку
сторінок чи штатного розміру MUI2. Source версії всіх компонентів — `0.1.5`.
Цільові launcher/Client/Manager/NSIS/packaging, payload/integrity/provider і
production ZIP tests: **57 PASS, 0 FAIL, 0 SKIP**. Production builds, фінальна
NSIS compilation, archive/integrity, точні templates та release manifest — PASS.

Власник повідомив VM PASS Client 0.1.3 → 0.1.4 та VM FAIL Manager 0.1.3 → 0.1.4.
Launcher старого Manager утримував CWD у ServerManager; конкретна помилка Rename
не журналювалася. Нове виправлення ще потребує VM-підтвердження. Для встановлення
0.1.5 поверх старого Manager рекомендовано ручний Setup поза його каталогом:
старий auto-updater запускає старий launcher і може повторити проблему.

Production packaging та artifact verification завершено: у `release/0.1.5/`
є Setup, Server ZIP, manifest і release notes. Git-етап передбачає один
release commit, звичайний push і annotated tag 0.1.5. GitHub Release публікує
власник вручну. Після публікації — Windows VM acceptance; історичні checkpoints
0.1.4 нижче не означають поточний статус релізу 0.1.5.

`0.1.2` — попередній Stable Release. `0.1.3` — останній опублікований Stable
hotfix. Source version піднято до `0.1.4`; production Setup, Server ZIP, manifest і
release notes локально підготовлено в `release/0.1.4/`. Tag і GitHub Release `0.1.4`
не створювалися.

Для `0.1.4` вже реалізовано два UX-завдання: спрощений потік Universal Setup та
покращення сторінки оновлень Server Manager. Їхні цільові автоматизовані перевірки
пройшли; production packaging завершено локально, ручна Windows VM-перевірка
залишається pending. Порядок наступних етапів:

1. Перегляд власником підготовлених артефактів та окреме погодження публікації.
2. Ручна публікація GitHub Stable Release власником.
3. Windows 10 x64 VM acceptance після публікації; не заявляти VM PASS раніше.

## 0.1.4 — Task 1: Installation / Update UX

**Статус: IMPLEMENTED / AUTOMATED PASS.** У `packaging/windows-installer.nsi` звичайний Universal Setup показує
Welcome → Components, а Client/Manager selective update — відповідний Update Welcome
і пропускає Components. Clean/installed/unknown визначається тільки з
`InstalledComponents` разом із перевіркою потрібних EXE; стан не виводить версію, а
selective update показує цільову версію зі Setup. API Server і далі оновлюється
окремо через Server Manager. Цільові automated NSIS/selective-update tests пройшли;
ручна Windows 10/11 VM-перевірка сторінок, completion і restart залишається PENDING.
Production packaging `0.1.4` виконано локально; GitHub publication і VM acceptance
залишаються PENDING.

## 0.1.4 — Task 2: Server Manager Updates UI

**Статус: IMPLEMENTED / AUTOMATED PASS.** У `server-manager/src/UpdateManagement.tsx` API Server ZIP download
показує спільний Client/Manager progress із фактичними байтами, приховує
transaction stages до завершення завантаження та перевірки, а потім повертається до
наявного семиетапного встановлення. Картки зберігають структуру й розміщують дії у
правій колонці; довгі release notes можна розгорнути. Стани перевірки Manager
узгоджені з Client, з окремими доступним, актуальним, активним і помилковим станами.
Цільові результати наведені у HANDOFF; перевірка UI, адаптивності й реального
завантаження у Windows VM — PENDING. Production packaging `0.1.4` виконано локально;
GitHub publication і VM acceptance залишаються PENDING. Механізми оновлення та
серверної транзакції не змінювалися.

## Подальші напрями

| Етап | Обсяг | Передумови |
| --- | --- | --- |
| 9.1 — Automatic Updates | Завершення реальних component/update/failure перевірок | Прийняті результати VM та матриця pending; не підміняти source readiness production readiness |
| 9.2 — Tailscale Connectivity | Підключення Client і мережеві перевірки | Зберегти TLS/auth/RBAC; перевірити реальне підключення машин |
| 9.3 — Project Cleanup | Окремий технічний борг і застарілі файли | Підтверджені залежності; збереження SQL modules, копій і сумісності |
| 9.4 — Production Release | Фінальна перевірка й підготовка до використання | VM acceptance та явні дозволи на packaging/publication |
