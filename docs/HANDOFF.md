# Контекст для наступного чату

## Follow-up: підготовка до публікації

- Власник вирішив зробити `Anatol1ch/HromadaAID` публічним у тому самому
  репозиторії; окремий release repository не створюється. Власник дозволив
  публікацію контактної картки `src/App.tsx`: її не змінювати й Git history через
  неї не переписувати.
- Власник вручну знеособив `reference/Список.xlsx`,
  `reference/Зведений список.xlsx` і `reference/ПриватБанк.xlsx` та гарантує їхню
  придатність до публікації. Вміст повторно не оцінювати. Вони є потрібними
  runtime templates для трьох потоків генерації документів; залишити їх у Git.
  `.gitignore` дозволяє лише ці три книги та ігнорує решту `reference/`.
- `reference/Реєстр.xlsx` власник видалив; не відновлювати. Воно було лише вхідним
  джерелом окремого імпортера, не Client runtime і не packaging.
- Client portable ZIP не є обов'язковим release asset: release manifest і updater
  використовують universal Setup та Server ZIP. Manager runtime payload потрібний
  Setup; Server ZIP потрібний API Server update.
- Попередні Stage 9.1.3 артефакти в корені `release/stage-9.1.3/` застарілі.
  Свіжі Setup, Server ZIP і manifest `0.1.0` зібрані в
  `release/stage-9.1.3/stable-0.1.0/`; Client portable не створювався.
- Контактна картка є в історії лише local `feature/client-server` і відсутня в
  `origin/main`; з дозволу власника історію не переписувати.
- Цільові перевірки після оновлення файлів: Excel COM statements IPC test — 1/1
  (3 персональні, 2 зведені й банківська відомість на синтетичних даних);
  параметри персональної/зведеної форм у en-US і uk-UA — 1/1; packaging,
  NSIS, server package, manifest та shared updater — 52/52. Один початковий запуск
  IPC тесту виявив помилковий шлях у його fixture setup; виправлено шлях копіювання
  тестових шаблонів без зміни production generator.
- Installer/Server ZIP не перебудовували. Client Setup за поточною конфігурацією
  включатиме рівно три дозволені книги через `electron/copy-assets.mjs`;
  `Реєстр.xlsx` у payload немає. Release manifest contract лишився Setup + Server ZIP.
- Client portable ZIP — необов'язковий ручний формат; updater використовує Setup,
  а manifest містить лише Setup і Server ZIP. Manager portable runtime потрібний
  для збирання універсального Setup; Server ZIP потрібний API Server update.
- Контактна картка `src/App.tsx` є в feature HEAD і 60 доступних commit trees з
  моменту `f4f4a29890a64e250ebfa07cd169c43af753ee77`; `origin/main` її не містить.
  Потрібно замінити контакт і окремо погодити очищення feature history перед її
  публікацією/merge. Історію не переписували; безпечний план backup/rewrite наведено
  у [аудиті публікації](stage-9.1.3-publication-security-audit.md).
- У цьому follow-up змінено лише документацію. Packaging і тести не запускалися;
  `git diff --check` перевірити перед завершенням.

## Checkpoint

- Дата фіксації: **2026-10-26**.
- Гілка: **`feature/client-server`**.
- Stage 9.1.1 був зафіксований на попередньому HEAD; Stage 9.1.2 реалізацію
  та документацію зафіксовано окремим логічним commit. Для актуального hash
  виконай `git rev-parse HEAD`; HANDOFF не дублює власний commit hash.
- Поточна версія Client, Server Manager та API Server у вихідному коді: **`0.1.1`**;
  Stable **`0.1.0`** опубліковано й використовується як baseline для оновлення.
- На початку Stage 9.1.3 HEAD був **`521251067e2f9c6f81559ea337402e61dfbd78e5`**,
  гілка `feature/client-server`, дерево чисте.
- **Stage 8.2 та реалізація Stage 9.1.1–9.1.2 завершені. Stage 9.1.3 packaging
  завершено; ручне тестування pending. Stage 9.1 і продукт не production-ready.**

## Останні зміни

| Коміт | Значення |
| --- | --- |
| `e4d843b` | Restore зберігає ACL service SID на Backups |
| `05b5677` | Посилено ZIP update, SemVer, PowerShell arguments/діагностику |
| `92cc835` | UX Server Manager, наявна дизайн-система й усі п'ять розділів |
| `c8ba96d` | Recovery update/restore, захист від небезпечного DB return, timeout/lock |
| `9501b08` | Лише installer test: assertion узгоджено зі структурованою JSON/Base64 діагностикою |
| Попередній HEAD | Shared Stable GitHub Releases та Client automatic updates, NSIS Client-only upgrade mode |
| `HEAD` | Server Manager обов’язкове оновлення через Manager-only NSIS; API Server автоматичне завантаження та чинний ZIP update/recovery |

Технічну реалізацію й source map див. в [ARCHITECTURE.md](ARCHITECTURE.md),
обов'язкові обмеження — в [DECISIONS.md](DECISIONS.md) та [AGENTS.md](../AGENTS.md).

## Що фактично перевірено

### Stage 9.1.1

- `pnpm client:updates:test` — **10/10** цільових перевірок, включно з розбором
  launcher PowerShell без його виконання.
- `node --test scripts/windows-installer-paths.test.mjs packaging/windows-installer-space.test.mjs` — **36/36** regression checks.
- `pnpm exec tsc -p tsconfig.electron.json --noEmit` і
  `pnpm exec tsc -p tsconfig.app.json --noEmit` — пройшли.
- `git diff --check` — пройшов.
- У тестах використано синтетичні release metadata й файли; GitHub Release не
  публікувався, Setup/Server ZIP не збирався, реальний Windows installer/Service
  не запускався.
- `assets/release-channel.json` містить адресу GitHub remote
  `Anatol1ch/HromadaAID`; жоден токен не вбудовано.

### Stage 9.1.2

- Shared Stable provider повертає Setup і Server ZIP з одного manifest та проводить
  SHA-256/size-verified streaming download. Release manifest вимагає same-release
  Server Manager та API contract v1 сумісність.
- Server Manager перевіряє реліз при запуску, кожні 3 години та вручну. Підтверджене
  оновлення зберігається, блокує звичайні IPC/UI операції, а recovery залишається
  доступним. Універсальний NSIS має `/MANAGERUPDATE=1`, який замінює лише каталог
  Manager, зберігає компонентний склад/Installed Apps і не зупиняє службу.
- API Server ZIP проходить спільний downloader і потім чинний
  `prepareServerUpdate` / `applyServerUpdate`; Manager має бути тієї самої версії
  релізу. Служба зупиняється лише після підтвердження адміністратора. Результат
  успіху залежить від чинних перевірок активного пакета, SCM та API health.
- Перевірки: `pnpm client:updates:test` — 11/11; новий Manager release updater разом
  із shared provider/manifest/client service тестами — 7/7; installer path/space та
  Client/Manager NSIS regression — 42/42; server-package/update/recovery/process —
  45/45; чотири TypeScript no-emit checks; `git diff --check`.
- Release metadata, файли й мережеві відповіді синтетичні. Packaging, GitHub Release,
  live GitHub check, реальний інсталятор і Windows Service на машині розробника не
  запускалися. Recovery service/health інтеграції в автоматичних тестах замокані.

### Stage 9.1.3 — Stable 0.1.1 packaging prepared / Manual testing pending

- Stable **0.1.0** опубліковано й встановлено на чистій Windows 10 x64 VM у режимі
  Combined; основні функції Client, Server Manager та API Server пройшли початкове
  ручне тестування. Під час подальшого тесту виявили, що первинне
  Combined налаштування з порожніми Data/Backups на інших дисках блокує
  `verifyInitialInstallCandidate`: перевірка прирівнювала початкові шляхи HKLM
  locator до вибраних у Manager. Виправлено: Program path/package залишаються
  прив'язаними до перевіреного payload; старі locator і вибрані Data/Backups
  допускаються лише за відсутності файлів. Існуючий вміст не очищується.
- `pnpm manager:build` — успішно (Manager TypeScript та renderer build);
  `node --test server-manager/tests/installation-recovery.test.mjs` — **15/15**.
  Власник підтвердив успішне повторне встановлення Setup 0.1.1 на чистій Windows
  10 x64 VM, первинне налаштування API Server з Data/Backups на різних дисках та
  працездатність системи (сценарій A08). Client/Manager/API auto-update, UAC
  cancellation/retry і збереження серверних даних під час оновлення окремо pending.
- `pnpm windows:installer` зібрав свіжі Client/Server production payloads,
  Server Manager та універсальний Unicode NSIS Setup. NSIS успішно завершився;
  Setup не запускався.
- Історична packaging-перевірка створила Client portable ZIP, однак він не потрібен
  обов'язковому release workflow. Наявний packaging не має окремого Manager portable
  ZIP: збережено Manager portable `win-unpacked` каталог, який потрібний універсальному Setup.
- Свіжі артефакти в `release/stage-9.1.3/stable-0.1.0/`, усі компоненти **0.1.0**.
  Universal Setup створено штатним `pnpm windows:installer`. Server ZIP зібрано з
  перевіреного server payload та чинного component-manifest механізму; updater
  integration перевірив його через тимчасову транзакцію. Manifest сформований із
  готових файлів і повторно перевірив names, sizes, SHA-256 та compatibility.
- Client portable ZIP не створювався, бо він не входить до обов'язкового release
  contract. У target folder також є `RELEASE-READINESS.md`.
- Client portable assets перевірені; Manager packager підтвердив `app.asar`,
  shared updater, version marker і payload layout. Цільові packaging regression
  тести — **50/50**.
- Після підготовки Stable 0.1.0: `pnpm windows:test-installer` — **51/51**,
  `pnpm client:updates:test` — **12/12**, Server ZIP updater integration — **7/7**.
  Client `app.asar` містить рівно три дозволені актуальні templates з байтами,
  ідентичними tracked source; import register відсутній. Ці перевірки не запускають
  Setup і не змінюють Windows Service.
- Комплект Stable **0.1.1** зібрано після коміту виправлення, без встановлення:
  `release/stage-9.1.3/stable-0.1.1/HromadaAID-Setup-0.1.1.exe` — **224,801,170**
  bytes, SHA-256 `f4ffbc6b919d28d43d6f1f62ebb6b60c614333d9487d86151a2ab627464635c3`;
  `HromadaAID-Server-v0.1.1-win-x64.zip` — **45,324,906** bytes, SHA-256
  `6e0e3d26639a6b28a122175c3f76db4ec7d2241f3687a125485c6eca97d890f2`;
  поруч сформовано `release-manifest.json`. Усі компоненти й component manifest
  мають версію 0.1.1; Server зберігає API contract v1 і schema 1–28.
- Цільові перевірки 0.1.1: `pnpm windows:test-installer` — **51/51**;
  `pnpm client:updates:test` — **12/12**; custom-directory recovery — **15/15**;
  Manager/API updater tests — **24 passed, 1 skipped** (skip — production ZIP
  scenario повторно перевірено окремо); actual production Server ZIP updater
  integration — **7/7**; повторна перевірка production ZIP із `Server.next` — **1/1**.
  SemVer `0.1.0 → 0.1.1`, release manifest hashes, package manifests та три Client
  templates (ідентичні tracked source) перевірені. `Реєстр.xlsx` і runtime data
  файлів у пакетах не виявлено.
- Початкова NSIS компіляція показала, що custom page була оголошена з неіснуючим
  pre-callback параметром; packaging виявив ризик показу вибору компонентів при
  selective update. Creator тепер пропускає сторінку для Client-only та
  Manager-only, зайвий `!undef` і невикористану recovery мітку прибрано.
  Regression checks — **42/42**; повторна NSIS компіляція пройшла без warnings.
  Реальну UI/UAC/selective поведінку треба перевірити у Windows VM.
- Signing certificate не налаштований, тому electron-builder пропустив code signing;
  у VM Windows може показати попередження про видавця.
- Артефакти Stable 0.1.1 підготовлено. Автоматичне оновлення 0.1.0 → 0.1.1
  потребує опублікованого Release; результат GitHub-перевірки та Windows VM
  сценаріїв фіксується окремо від локальної підготовки пакетів.
- Детальний план і таблиця сценаріїв: [stage-9.1.3-manual-testing.md](stage-9.1.3-manual-testing.md).
  У таблиці PASS має лише A08 у підтвердженому власником обсязі; інші сценарії
  лишаються «Не перевірено». На машині розробника інсталятор не запускався,
  робочу Service/SQLite не змінювали.

За останні контрольні прогони в цьому робочому середовищі (не повторювалися
під час створення документації):

- Production payload Client/API/Manager і Unicode NSIS Setup зібрано на baseline
  `c8ba96d`; packaged smoke Client та Manager пройшли.
- Backup/restore suite: **24/24**; update/recovery/process suite: **44/44**;
  update suite проти нового серверного ZIP: **24/24** (частина тестів перетинається).
- Після test-only fix `9501b08`: `pnpm run windows:test-installer` — **51/51**.
- TypeScript компонентів і `git diff --check` проходили у відповідних завданнях.
- SCM/health у recovery-інтеграціях замокані. Окремо перевірялися реальні файлові
  транзакції, SQLite, синтетичні Windows ACL і завершення тестового дерева Node.
  Це не є end-to-end перевіркою WinSW/LocalService `HromadaAIDApi`.

Контрольні артефакти локально: `release/stage-8.2.10.2/` (поза Git):
`HromadaAID-Setup-0.1.0.exe`, `HromadaAID-Client-portable.zip`,
`HromadaAID-Server-Manager-portable.zip`, `HromadaAID-Server-v0.1.0-win-x64.zip`.
Test-only commit не змінював ці файли. Наявність цього каталогу в іншому checkout
не гарантується. Не видавати старі файли за нову збірку.

## Межі гарантій і ручні перевірки

- У Windows 10 x64 VM ще потрібна фінальна перевірка поточного комплекту:
  чисте Combined встановлення/первинний setup, служба/API/Client, backup/restore,
  переривання й recovery на різних етапах, безпечний DB return, ZIP update,
  Modify/Uninstall із збереженням даних та UI при DPI 125–150%.
- Restore без proof receipt старого завершення не дозволяє автоматичне повернення
  попередньої бази. Зміни даних, пошкоджені докази, невідома схема або неоднозначні
  транзакції вимагають ручного рішення; копії й журнали зберігаються.
- Непідтверджене завершення дочірнього дерева утримує критичний lock. Безпечного
  примусового unlock або скасування restore немає.
- GitHub Release не публікувався й не перевірявся наживо. SHA-256 підтверджує
  цілісність відносно manifest, але не ідентичність видавця.
- NSIS Manager-only update staging/swap використовує `ServerManager.next` і
  `ServerManager.previous`, а перерваний rename відновлює на наступному Setup.
  Після видалення previous-folder повного rollback не гарантовано; перевірити
  переривання й повторний запуск у VM. Success marker визначає завершення Setup;
  його відсутність зберігає обов’язковий gate.
- У Windows VM перевірити Client-only/Server-only/Combined Manager-only upgrade,
  збереження
  `InstalledComponents` і Installed Apps запису, Combined Server Service/файлів,
  даних і конфігурації, штатний UAC та його відмову, прогрес Manager Setup,
  success marker і повторний запуск Manager. Окремо перевірити Server-only і
  Combined: Manager update не зупиняє API Service/не змінює Server; Manager upgrade
  виконується першим, а API ZIP блокується до версійної сумісності.
- У VM також перевірити Server ZIP download/hash/HTTP/timeout/часткове завантаження,
  адміністраторське підтвердження зупинки, `Server.next`/`previous`/`failed`, журнал,
  recovery, SCM status і API health, невдалий health та фактичне повідомлення
  результату. Реальний GitHub Stable Release і його manifest перевіряються тільки
  після окремого релізного процесу.

## Як продовжувати

1. Перевірити реальні Git-стан і завдання користувача, прочитати AGENTS і потрібні
   документи. Для нового етапу спочатку цільово оглянути його модулі.
2. Команди перевірок брати з `package.json`; для нового recovery — також окремі
   `packaging/server-package-recovery.test.mjs`, `server-manager/tests/server-update-recovery.test.mjs`
   та `server-manager/tests/recovery-process.test.mjs`. `manager:test` не включає
   автоматично всі ці нові тести.
3. Не запускати packaging/push/release без прямої вказівки. Зберігати дані,
   журнали, ключі, попередні пакети й страхові копії.

## Історична документація

`docs/stage-7-architecture-and-ui.md`, `docs/backup-restore.md`, частини
`server-manager/README.md` і `packaging/README.md` описують попередні етапи.
Наприклад, старий backup UI Client, чотири розділи Manager та обов'язковий ручний
CLI для звичайного restore вже не відповідають чинному GUI. Вони збережені як
історичні матеріали, а не як поточні операційні інструкції.
`docs/server-manager-update-retry.md` містить також ручні дії для конкретної старої VM;
їх не виконувати автоматично замість поточного контрольованого recovery.
