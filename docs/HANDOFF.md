# HromadaAID — поточний checkpoint

## Checkpoint 1.0.1 — локальна підготовка, не опубліковано

Дата: 30.10.2026. Версії root/server: **1.0.1**. Підготовка виконується на main;
попередній HEAD — 16582ce252086bb39d2276ac3c1de90e4895f21f.
Цей checkpoint входить до локального коміту «release: prepare HromadaAID v1.0.1»;
push, теги, release workflow та GitHub Release у цьому завданні не виконуються.

### Реалізовано

- Персональні/зведені документи групуються за aidTypeId + banks.id; персональні
  частини — до 12 призначень. Банківські відомості групуються лише за банком
  та повертаються масивом. Кількість означає призначення, не унікальних людей.
- Спільний план, усунення повторних ID, перевірка safe integer сум, свіжий snapshot,
  перевірка реквізитів і складу, колізій назв та скасування невдалого пакета.
  Генерація не змінює фінансових даних; шаблони незмінені.
- Вибір банків через chips, компактні картки параметрів, фіксовані заголовок/дії,
  реактивні підсумки. Стовпець «Банк» між видом допомоги та статусом; відсутній банк
  показується як «Не вказано», довгі назви скорочуються з повною підказкою.
- Ручні Loopback/LAN/Tailscale у server-addresses.json профілю Manager;
  текст адреси з Copy → Pencil, модальне редагування, явні помилки сховища.
  Автовизначення адаптерів вилучено. Спільний із Client чистий URL-валідатор;
  SCM/API, локальний health-check і серверна конфігурація v3 незалежні.

Основні модулі: src/StatementFormation.tsx, src/components/StatementParametersModal.tsx,
shared/statement-groups.ts, shared/statement-parameters.ts, shared/statement-filenames.ts,
electron/statement-data.ts, electron/statement-list-data.ts, electron/statements-ipc.ts,
server/src/app.ts; server-manager/src/ServerAddresses.tsx,
server-manager/electron/server-address-settings.ts, shared/server-base-url.mjs.
Відповідні контракти, preload, стилі, скрипти доставки runtime та тести включені.

### Приймання та свіжі автоматизовані перевірки

Користувач підтвердив ручне тестування реалізованих функцій та UI перед цим
завданням. Це не твердження про перевірку опублікованих пакетів 1.0.1.
Повторний повний GUI-цикл у цьому завданні не проводиться.

Перевірки виконано заново після підняття версій у цьому checkpoint:

- pnpm build — PASS (Client TypeScript, Electron TypeScript, assets і Vite).
- pnpm server:build — PASS; pnpm manager:build — PASS (обидва Manager TypeScript і Vite).
- Документи: tests/statement-groups.test.mjs, tests/statement-parameters.test.mjs,
  tests/statement-filenames.test.mjs, tests/statement-bank-generation.test.mjs — **18/18 PASS**.
  Генератори перевірено через справжні Fastify endpoints та ізольовану SQLite
  з підставним Excel worker, включно зі збоєм другого файла й незмінністю фінансів.
- Цільові джерела документів у tests/banks.test.mjs та tests/accounting-years.test.mjs —
  **2/2 PASS**. scripts/test-document-transport.mjs — PASS.
- Адреси, незалежність inspection/presentation/SCM:
  server-manager/tests/server-address-settings.test.mjs, inspection.test.mjs,
  inspection-presentation.test.mjs, service-control.test.mjs — **43/43 PASS**.
- Client URL/transport: electron/transport.test.ts — **4/4 PASS**.
- Release eligibility/publication з підставним GitHub API, manifest і синтетичний
  Server ZIP round-trip: scripts/github-release.test.mjs,
  packaging/release-manifest.test.mjs, scripts/package-release.test.mjs —
  **14/14 PASS**, без реальних GitHub mutations.
- Разом **81/81 автоматизованих тестів PASS**, окремий transport script PASS.
- Root/server 1.0.1; джерела версій Client, Manager, Setup і manifest узгоджені.
  Свіжий Manager bundle містить 1.0.1; перевірено синтетичний manifest 1.0.1.
  Залежності й pnpm-lock.yaml незмінені.
- Локальні посилання документації та git diff --check перевірено перед комітом.
- Client Vite попереджає про chunk понад 500 kB; збірка успішна.
  Повний suite, повторна Excel COM/GUI-перевірка, реальний Windows packaging,
  оновлення у VM та release workflow у цьому завданні не запускалися.

### Обмеження і наступний крок

- Банківський XLSX використовує «ПриватБанк.xlsx»; імпорт іншими банками
  не підтверджений. Рахуються призначення, зокрема кілька призначень одній людині.
- Пошкоджене/несумісне сховище адрес Manager блокує редагування; автоматичного
  reset немає. Профіль прив'язаний до Windows-користувача.
- Локальні перевірки не доводять поведінку реального SCM/ACL чи банківського імпорту.
  Пакети 1.0.1 у цьому завданні не створювалися.
- Після перевірки локального коміту власником потрібне окреме завдання на push.
  Чинний workflow на push у main перевіряє eligibility, збирає Windows x64 комплект
  та публікує Stable. Перевірити Actions, tag SHA, версії й три очікувані assets.
  До того останній підтверджений опублікований Stable — 1.0.0.

Нижче збережено історичний checkpoint Stable 1.0.0 та попередніх етапів.
Його описи автопошуку й обмежень Stage 9.2 не є актуальною поведінкою 1.0.1.

## Історичний стан Stable 1.0.0


- **Stage 9.6 — COMPLETED (documentation deliverable).** Підготовлено
  [єдину практичну інструкцію](installation-and-administration.md) для Stable
  1.0.0 та працівників ОМС із базовими навичками Windows. Описано всі погоджені
  сценарії встановлення й адміністрування, LAN, Windows Firewall, DHCP
  Reservation для різних поколінь TP-Link, Tailscale, резервування, відновлення
  й оновлення. Відповідність реалізації перевірено; обмеження й ризики зазначено.
  Повторний післярелізний цикл приймання не планується за рішенням власника.
- **Stage 9.5 — COMPLETED.** Stable **1.0.0** опубліковано через GitHub Actions.
  Release commit: `d7980aab22ccd5ac6975cfb396d58c2585aae410`. Релізні артефакти:
  Universal Setup, Server ZIP і `release-manifest.json`.
- Погоджено [Post-1.0.0 backlog](ROADMAP.md#post-1-0-0-backlog): п'ять напрямів
  зі статусом **PLANNED / NOT STARTED** та орієнтовним групуванням за майбутніми
  версіями. Новий етап розробки ще не розпочато; Stable 1.0.0 і завершені статуси
  Stage 9.5–9.6 залишаються чинними.
- Рішення власника для Stage 9.6: створити одну комплексну інструкцію; включити
  практичні процедури Tailscale і DHCP Reservation, передбачити старі моделі
  TP-Link із класичним вебінтерфейсом; код HromadaAID заради документації не
  змінювати. Tailscale, DHCP Reservation і Windows Firewall описувати як зовнішні
  процедури, не як вбудовані функції.


- Історичний Stable до v1.0.0: **v0.2.2**, опублікований через GitHub Actions.
- Stage 9.3 включено до опублікованого Stable v0.2.2.
- **Stage 9.4 — CI/CD Automation завершено та прийнято власником.** Stable v0.2.2
  успішно зібрано й опубліковано через GitHub Actions; приймальне тестування у
  Windows VM пройшло за всіма п'ятьма пунктами.
- **Stage 9.5.1–9.5.2 — Bank Details Validation реалізовано** в гілці
  `codex/stage-9-5-bank-validation`: МФО та ЄДРПОУ автоматично перевіряються
  сервером і клієнтом та блокують некоректне збереження; checksum ЄДРПОУ немає.
  IBAN перевіряється вручну кнопкою за українським форматом і MOD 97, без впливу
  на збереження. Stage 9.5.1–9.5.3 функціонально прийнято власником після ручного тестування.
- **Stage 9.1 — Automatic Updates завершено** після приймання основних сценаріїв у Windows 10 x64 VM.
- **Stage 9.2 — Tailscale Connectivity завершено** та прийнято власником у Windows VM; Stable tag `0.2.1` вказує на `e159ab5b8536beb74e31ae8a3cee4c7151487932`.
- Автоматичне оновлення Client, Server Manager та API Server з 0.2.0 до 0.2.1 підтверджене власником. Конфігурація, SQLite й наявні дані збережені; служба та система працюють після оновлення.
- Відоме некритичне обмеження: Manager може некоректно визначати/показувати LAN або Tailscale IPv4 у деяких Windows VM. Client підключається через вручну введену адресу. Власник прийняв обмеження; окремого виправлення не планується.
- Релізний commit: `10b0b85b36a9cad84d75259aa6fe2dd90e08b4d4`; annotated tag `0.1.6` лишається на цьому commit. Документаційний checkpoint перед README update був `263c50b74cabf3d1172676bcaa5b738f650559d3`.
- Історичний VM snapshot Stage 9.1: `HromadaAID 0.1.6 – Stable Baseline`; він зберігає лише результати Stage 9.1.

## Рішення щодо післярелізного приймання Stable 1.0.0

Власник проєкту вирішив не проводити окремий повторний цикл післярелізного приймання Stable 1.0.0, враховуючи результати функціонального, інтеграційного та ручного тестування попередніх етапів. Додаткові сценарії не залишаються відкритими завданнями поточного плану. Це рішення не означає, що кожен із них був окремо перевірений після випуску 1.0.0.

Історичні записи нижче описують стан на час відповідного етапу; поточний
документаційний статус і рішення власника наведено вище.

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

## Stage 9.5 — Production Release 1.0.0 — COMPLETED

Stage 9.5.1–9.5.3 функціонально прийнято власником після ручного тестування. Stable v1.0.0 опубліковано через GitHub Actions. Цей checkpoint замінює передрелізний статус нижче; історичні результати підготовки збережені.

МФО — автоматично рівно 6 цифр, ЄДРПОУ — автоматично рівно 8 цифр, із блокуванням збереження на клієнті й сервері. Контрольний розряд ЄДРПОУ не перевіряється. IBAN — добровільно кнопкою за українським форматом і MOD 97, без нових блокувальних правил.

Власник дозволив commit, інтеграцію в main та push для автоматичної публікації.

Передрелізні перевірки: bank/recipient/field formats — 33/33; accounting years/reporting/migrations/integrity — 14/14; auth-session — 3/3; server lifecycle/API authorization — 8/8; release manifest/package integrity/ZIP/publication — 18/18 PASS.
pnpm build, pnpm server:build, pnpm manager:build (включно з TypeScript) і git diff --check — PASS. Локальне Windows release packaging не запускалося.

Тестові передумови актуалізовано до expectedUpdatedAt, confirmationToken, requestId та schema 28. Міграційні fixtures відтворюють узгоджену синтетичну v18 замість підміни лише user_version. Production-код для проходження старих тестів не змінювався.

Root/server package.json синхронізовано на 1.0.0; lockfile не містить версії root package й не змінювався. Client/Manager/Setup отримують версію з чинних scripts. Notes: docs/release-notes/1.0.0.md. Workflow незмінний: push main публікує нову Stable версію; workflow_dispatch build-only.

Stable 1.0.0 опубліковано; реліз містить Universal Setup, Server ZIP і
`release-manifest.json`. Release commit: `d7980aab22ccd5ac6975cfb396d58c2585aae410`.
Деталі передрелізних перевірок вище є історичними. Stage 9.6 — **COMPLETED
(documentation deliverable)**. Повторне післярелізне приймання, включно з
окремим оновленням 0.2.2 → 1.0.0, не планується за рішенням власника; це не
підтвердження проходження цих сценаріїв після випуску.
