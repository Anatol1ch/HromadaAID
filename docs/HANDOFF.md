# HromadaAID — поточний checkpoint

## Стан проєкту

- Останній Stable: **v0.2.2**, опублікований через GitHub Actions.
- Stage 9.3 включено до опублікованого Stable v0.2.2.
- **Stage 9.4 — CI/CD Automation завершено та прийнято власником.** Stable v0.2.2
  успішно зібрано й опубліковано через GitHub Actions; приймальне тестування у
  Windows VM пройшло за всіма п'ятьма пунктами.
- **Stage 9.5 — Bank Details Validation & Production Release 1.0.0** погоджено в
  оновленому обсязі, але реалізацію ще не розпочато. Stable 1.0.0 ще не випущено.
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

### Stage 9.3 — COMPLETED / ACCEPTED

За [ROADMAP.md](ROADMAP.md) Stage 9.3 включено до release v0.2.2. Змінено шлях тесту `windows:test-installer`,
видалено підтверджено невикористаний Client helper, точково актуалізовано чинні
документи та додано перевірене очищення generated `dist-server` перед Server build.
Stage 9.3 прийнято як **COMPLETED / ACCEPTED**. `pnpm windows:test-installer`
пройшов 56/56; пройшли TypeScript checks, Server Manager build, Server build і
payload preparation/deployment, повторний build із перевіркою видалення stale
module, перевірка script paths і `git diff --check`. GUI/VM-тести та повний
Windows installer packaging не проводилися.

Stable 0.2.1 не включав Stage 9.3; її зміни увійшли до v0.2.2.
Протокол приймання Stage 9.2: [stage-9.2-manual-testing.md](stage-9.2-manual-testing.md).

## Stage 9.4 — Step 1: Release Packaging Preparation

Реалізовано `pnpm release:package`: чинний Universal Setup, ZIP із того самого
Server payload, чинні component/package/release manifests і перевірка ZIP
справжнім extractor та verifier Manager. Структуру й toolchain описано в
ARCHITECTURE. Наявний `release/<version>/` не перезаписується.
На момент Step 1 версія застосунку залишалася 0.2.1. Під час preparation її
піднято до 0.2.2; опублікований Stable поки залишається 0.2.1.

Автоматично перевірено: pnpm 11.25.0 приймає lockfile без змін через frozen/offline
lockfile-only install; Manager build; 7/7 цільових packaging/integrity tests,
включно із синтетичним ZIP round-trip через чинний Windows updater, Unicode,
прихованим файлом, пошкодженими даними й захистом наявного output.
Повний `release:package` з новим Universal Setup не запускався; його потрібно
підтвердити на чистому Windows runner. VM acceptance не виконувалося.

Погоджено майбутню модель: один `release.yml`, push у `main`, Windows x64,
версія з package.json, автоматична публікація комплекту у GitHub Releases;
функціональні tests виконуються до merge. Локальну реалізацію publication описано нижче.

## Stage 9.4 — Step 2: GitHub Actions Build

Додано `.github/workflows/release.yml`: push у main та workflow_dispatch,
один Windows x64 job на windows-2025, Node 24.22.1 / pnpm 11.25.0,
frozen-lockfile install і `pnpm release:package`. Перед upload workflow перевіряє
наявність рівно трьох очікуваних файлів, збіг версій і чинний release manifest.
Комплект завантажується одним Actions artifact із retention 30 днів.
Build job має лише contents: read, checkout credentials не зберігаються;
секрети packaging scripts не передаються.

Локально пройшли YAML/structure assertions, звірка toolchain, output paths,
upload settings, permissions та PowerShell syntax parse. Реального запуску на
GitHub runner не було: workflow ще не відправлено до GitHub. Перший hosted build
має підтвердити встановлення залежностей, NSIS і повний packaging pipeline.

## Stage 9.4 — Step 3: Automatic GitHub Releases

У тому самому release.yml додано publication job з contents: write і стандартним
GITHUB_TOKEN через actions/github-script; build job зберігає contents: read.
Workflow concurrency серіалізує запуски без переривання активної публікації.
Лише push у main із новішою Stable SemVer X.Y.Z дозволяє автоматичний Release.
До packaging перевіряються GitHub Releases (включно з видимими drafts), обидва
формати тегів X.Y.Z / vX.Y.Z і останній Stable; наявна або застаріла версія
завершує workflow без повторної збірки. workflow_dispatch завжди build-only.

Publication завантажує готовий Actions artifact, повторно перевіряє його manifest,
версію й точний склад та повторює eligibility check. Створює новий vX.Y.Z tag
на triggering SHA, Draft із автоматичними GitHub release notes, завантажує три
assets, перевіряє назви/розміри/state (і SHA-256 digest, якщо API його повернув)
та SHA тега, після чого публікує Stable/latest. Перебудови між jobs немає.
Помилки upload/перевірки залишають Draft; наявні tags/Releases не змінюються.
Перерваний запуск із tag або Draft не відновлюється автоматично: потрібна ручна
інспекція власником. Збій між створенням tag і Draft може залишити лише tag.

Пройшли 10 цільових tests із підставним GitHub API (SemVer, existing tag/release,
повторний запуск, event guards, upload/integrity failures), YAML/структурні та
синтаксичні перевірки workflow. Реальних GitHub API mutations, hosted run,
commit/push/tag/Release у цьому завданні не було. Перший реальний Windows runner
ще має підтвердити build, NSIS, artifact transfer та GITHUB_TOKEN publication.
Stage 9.4 прийнято після реального виконання й перевірки результатів.

## Підготовка v0.2.2

На main, HEAD 7b7311da458eecdd75f14d25d4d3289e42e2091e, Stage 9.3
інтегрований commit 739e80d. GitHub Stable має історичний tag `0.2.1` без `v`,
що вказує на e159ab5b8536beb74e31ae8a3cee4c7151487932. Після нього в історії —
b286a30, 739e80d та 7b7311d. Зміни Stage 9.4 і preparation ще незакомічені.

Кореневий і server/package.json узгоджено на 0.2.2. Client, Manager,
Universal Setup і release manifest отримують цю версію з наявних build scripts;
сторонні залежності й lockfile не змінено. Українські notes підготовлено в
`docs/release-notes/0.2.2.md`; publication використовує цей файл як body.
Stable Release v0.2.2 опублікований. Actions run 40688787157 успішно виконав
Windows build і publication. Власник підтвердив усі п’ять пунктів VM acceptance
оновлення 0.2.1 → 0.2.2. Stage 9.4 — COMPLETE / ACCEPTED.

Перевірки preparation: Manager build (включно з TypeScript) — PASS;
windows:test-installer — 56/56; release/ZIP/publication tests — 13/13.
Окремо пройшли assertions узгодженості 0.2.2, незмінності dependencies/lockfile,
workflow permissions/pins, eligibility проти підтвердженого remote snapshot та
назв/manifest 0.2.2 на синтетичних файлах. `git diff --check` — PASS.
Workflow `.github/workflows/release.yml`: push у `main` із новою Stable SemVer
запускає build і publication; `workflow_dispatch` виконує лише build. Toolchain:
Node.js 24.22.1, pnpm 11.25.0, Windows x64. Комплект формує
`pnpm release:package`; Actions перевіряє та публікує артефакти.

## Реліз v0.2.2

Release commit Stage 9.4 та v0.2.2: `62fff52d2ff0929adc502b77a490bfbd229057c2`.
Stage 9.3 вже інтегрований в історію. Перед push remote main збігався з локальним
HEAD; tags/Releases 0.2.2 і v0.2.2 були відсутні. Publication бере body із
`docs/release-notes/<version>.md`; лише відсутній файл вмикає автоматичні GitHub
notes. Порожній/нечитабельний файл зупиняє publication до створення tag.
Цільові перевірки publication виконуються локально, без Windows packaging.
Реальний Actions build/publication та Windows VM acceptance успішні; Stage 9.4 завершено.

## Наступний етап

Наступна дія — цільово інспектувати форми банківських реквізитів, відповідні API
та правила збереження перед реалізацією Stage 9.5. Погоджений scope: блокувальна
серверна перевірка заповненого МФО; добровільні перевірки ЄДРПОУ та IBAN за кнопкою,
які не блокують збереження; без зовнішніх API та без зміни чинної обов'язковості
полів. Структуру SQLite не змінювати без доведеної необхідності. Після реалізації
й приймання планується Stable 1.0.0 через чинний release pipeline.

Stage 9.5 — PLANNED / NEXT; Stage 9.6 — Installation & Administration Guide
залишається наступним етапом після Stage 9.5 зі своїм незміненим обсягом.
