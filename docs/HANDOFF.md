# Контекст для наступного чату

Оновлено 2026-10-27 після локального production packaging 0.1.4.
Це поточний checkpoint; технічна реалізація — у [ARCHITECTURE.md](ARCHITECTURE.md),
домовленості — у [DECISIONS.md](DECISIONS.md), план — у [ROADMAP.md](ROADMAP.md),
сценарії та історія VM — у [manual testing](stage-9.1.3-manual-testing.md).

## Git і версії

- Робоча гілка: `feature/client-server`; Git remote: `origin` — публічний
  `Anatol1ch/HromadaAID`.
- Перед цією документаційною консолідацією локальний HEAD був
  `9040574982efbbb3428f4b438c56d4caeaf0a6d5`, робоче дерево чисте, а origin
  відставав на три коміти: `1d06286`, `b260045` і `90405749`. Після документаційного
  коміту та звичайного push гілка чиста й синхронізована з origin. Незавершених
  merge/rebase/cherry-pick/revert операцій немає.
- Stable `0.1.3` опубліковано на GitHub; tag `0.1.3` вказує на hotfix commit
  `ada0c8bed6989cedbb25b83efe1cd451642bdaae`. Tag `0.1.4` не створювався.
- Остання опублікована версія — **0.1.3**; source/package version тепер `0.1.4`.
  Локальний комплект `0.1.4` зібраний, але ще не опублікований і не перевірений у VM.
  Stage 9.1.3 і Stage 9.1 не завершені.

## Stable 0.1.4 — локально підготовлено; publication і VM pending

Production workflow зібрав Client, API Server, Server Manager і Universal NSIS
Setup з версією `0.1.4`. У `release/0.1.4/` є Setup, Server ZIP,
`release-manifest.json` і `release-notes.md`. Manifest штатно створений і повторно
перевірений за розмірами та SHA-256. Server ZIP пройшов 7-Zip archive test,
внутрішню integrity/runtime перевірку та production ZIP → `Server.next` тест.
Client ASAR містить три погоджені tracked Excel templates побайтно; `Реєстр.xlsx`
відсутній. Manager Setup payload містить installer/recovery helpers без другого
Server runtime. Цільові перевірки охопили 65 сценаріїв; усі пройшли після окремого
повторного запуску production ZIP test, пропущеного в першому наборі.

Windows UAC, GUI, реальне встановлення, служба й GitHub auto-update `0.1.4` ще не
перевірені у VM. Stable `0.1.4`, tag і push не створювалися. Code signing не
налаштований. Наступні кроки: власник перевіряє локальні артефакти, вручну
публікує погоджений GitHub Release, потім виконується Windows 10 x64 VM acceptance.

## Stage 9.1.3: фактичний стан

IMPLEMENTED означає наявність у source; AUTOMATED PASS — цільові автоматичні
перевірки; VM PASS — лише прямо підтверджений власником сценарій. PENDING і FAIL
не перетворюються на PASS на підставі mock-тестів або іншого компонента.

| Сценарій | Реалізація / automation | Результат Windows 10 x64 VM |
| --- | --- | --- |
| Client 0.1.0 → 0.1.1 через GitHub Stable | IMPLEMENTED / AUTOMATED PASS | VM PASS: download/SHA-256, UAC, справжній NSIS, встановлена версія, свіжий marker, автоматичний restart |
| Збереження Server/Manager під час Client update | AUTOMATED PASS у цільових guards | VM PASS лише для InstalledComponents, контрольних SHA-256 Server/Manager, стану/PID API Service; не повна перевірка SQLite/даних або безперервності API health |
| Незалежний bootstrap після Electron | IMPLEMENTED / AUTOMATED PASS | U00 VM PASS; повний Client U01 також PASS |
| Manager-only NSIS swap | IMPLEMENTED / AUTOMATED PASS | VM PASS із локальним виправленим Setup; Manager 0.1.1 встановлено |
| Повний Manager GitHub auto-update | IMPLEMENTED / AUTOMATED PASS | PENDING; історичні спроби FAIL не є підтвердженням нового повного циклу |
| API ZIP update 0.1.0 → 0.1.1 | IMPLEMENTED; чинний transaction/recovery engine збережено | VM PASS за звітом власника після локального встановлення виправленого Manager; окремі data/config preservation checks PENDING |
| Windows shortcuts | IMPLEMENTED / AUTOMATED PASS, 14/14 цільових tests | Дефект підтверджено; VM-тест виправлення PENDING |
| UAC cancellation/retry, interrupted install, failure/recovery | Цільові synthetic/mock tests є | PENDING у VM; не заявляти rollback SQLite або повний rollback Client/Manager |

Журнали успішного Client-тесту власник свідомо не збирав. Не стверджувати окремий
аналіз launcher events; PASS доведений фактичним встановленням і контрольним
скриптом. UI/DPI 125–150%, негативні сценарії й усі серверні дані не перевірені
повністю. **Stage 9.1.3 і Stage 9.1 не завершені; production readiness не заявляється.**

## Виправлення в source та коротка історія

- Fresh server setup: коміт `2ed9d9a` усунув хибну вимогу збігу Data/Backups з
  початковим HKLM locator. Порожні каталоги на різних дисках допускаються лише
  без ознак наявної/неповної інсталяції. A08 підтверджено власником на чистій VM.
- Перші Client/Manager спроби 0.1.0 → 0.1.1: discovery працював; Client download
  мав timeout близько 80%, retry пройшов SHA-256. Після закриття Electron UAC/NSIS
  не з'являлися; це збережені історичні FAIL.
- Локально на PowerShell 5.1 з Node/Electron-as-Node відтворено exit 0 до тіла ps1
  за detached:true. Просто прибрати detached недостатньо через життєвий цикл
  дочірнього процесу. Спільний bootstrap через абсолютний System32 PowerShell
  створює незалежний launcher, перевіряє PID/readiness і завершення bootstrap;
  Electron закривається лише після handoff.confirmed. U00, потім Client U01 VM PASS.
- Launcher зберігає файлову діагностику після виходу Electron, використовує RunAs,
  чекає завершення NSIS, звіряє exit code, свіжий marker поточної спроби та версію
  EXE (допускається fourth zero), виконує один restart. Старий marker не доводить
  успіх; Setup не видаляється передчасно. Помилки запуску/UAC/restart відображаються.
- Shared downloader: connect timeout 20 с, network inactivity timeout 45 с;
  активний потік не обривається коротким absolute timeout. Збережені HTTPS,
  SHA-256/size, partial cleanup, locks і retry. Shared UI структурує release notes
  без raw HTML/активних посилань, показує bytes/percent або indeterminate progress.
- Manager NSIS: cwd лишався в ServerManager.next, Windows блокувала rename.
  SetOutPath "$INSTDIR" перед swap усуває це. Синтетичний Windows filesystem test
  і реальне Manager-only встановлення у VM пройшли; recovery-гілку не послаблено.
- Manager packaging: Setup виключав весь resources/server-payload, хоча main
  запускав звідти installer. Test-Path у VM дав False; Server.next залишився без
  journal, Service PID 3764 працював з 0.1.0. Тепер Setup зберігає тільки installer
  subtree та sibling modules, без дублю app/runtime/service. Після виправлення
  власник повідомив успішний API ZIP update; окремі data/config checks не підтверджено.
- Journal створюється після підготовки next, preflight і зупинки Service. Відмова
  раніше може лишити next без journal. Cleanup видаляє лише temp extraction;
  невизначені next/previous/failed та журнали не очищуються автоматично.
- Manager-only shortcuts: NSIS передавав ClientSelected=0, synchronizer видаляв
  належні Client-ярлики. Тепер прапорець походить з InstalledComponents. Client-only
  уже зберігав Manager-ярлики. API ZIP updater ярликами не керує. Відсутність
  ярликів у VM помітили лише після обох операцій; точний момент не спостерігали.
  Виправлення не потрапило до жодного з наявних Setup, VM повторний тест pending.

## Локальні артефакти — тимчасове сховище поза Git

Власник вручну очистив увесь каталог `release/`; це навмисно. Попередні локальні
збірки та діагностичні пакети не відновлювати. Згадані в історичних розділах нижче
шляхи й контрольні суми фіксують результати минулих перевірок, але не означають, що
файли досі є локально.

Для майбутнього релізу автоматично створювати `release/<version>/` — наприклад,
`release/0.1.4/` або `release/0.1.5/` — і зберігати там Setup, Server ZIP,
`release-manifest.json`, `release-notes.md` та інші необхідні артефакти цієї версії.
Підготовка не повинна залежати від наявності каталогів чи файлів попередніх версій.
Після успішної публікації та перевірки GitHub Release власник може вручну видалити
локальні артефакти. `release/` є тимчасовим сховищем результатів збірки, а не
постійним архівом; версії 0.1.0–0.1.3 не відновлювати без окремої потреби.

Client portable ZIP не є обов'язковим за чинним release contract; стандартний набір
релізу — Universal Setup, Server ZIP і release manifest. Діагностичні артефакти
додаються лише якщо їх вимагає окреме завдання.

## Перевірки консолідації

2026-10-27 — **40/40 AUTOMATED PASS**, 0 failures/skips:
shared release/Windows launcher, Client/Manager release services, installer-result
harness, NSIS selective modes, Windows branding/shortcuts, Manager Setup payload,
release manifest. Реальні нешкідливі PowerShell процеси доводять handoff і файловий
stdout/stderr після виходу Node/Electron-as-Node. UAC/NSIS у result tests замокані;
COM ярлики створювалися лише в temp, не в системних Desktop/Start Menu.

Чотири TypeScript no-emit checks пройшли: tsconfig.electron.json,
tsconfig.app.json, server-manager/tsconfig.electron.json, server-manager/tsconfig.json.
Серверний transaction/recovery source у поточному diff не змінено, тому повний
server/recovery suite не повторювався. Попередні цільові перевірки: Server update
24 PASS / 1 SKIP та recovery/process tests; mock SCM/health не доводить VM-поведінку.
У межах саме консолідаційної перевірки packaging не запускалося; Setup, Service та
реальна SQLite не запускалися.

## Stable 0.1.2 — опублікований реліз і виявлений дефект

Production `pnpm run windows:installer` завершився успішно: Client, API Server,
Server Manager і Universal Setup побудовані зі source 0.1.2. Серверний ZIP сформовано
зі свіжого `release/installer-payload/Server`, збережено його `package-integrity.json`
і додано component compatibility manifest (REST API v1, SQLite schema 1–28).
`release-manifest.json` створено штатним генератором і повторно перевірено за точними
розмірами/SHA-256 Setup та ZIP. Додатковий 7-Zip archive test — PASS.

Payload review: Client ASAR містить побайтно актуальні три погоджені tracked templates;
`Реєстр.xlsx` відсутній. Manager Setup payload містить installer/recovery helper-и,
але не дублює Server app/runtime/service. Версії Client, Manager, API Server, Setup
manifest і release manifest узгоджені на 0.1.2; Stable source лишається
`Anatol1ch/HromadaAID`.

Stable 0.1.2 опубліковано з цими перевіреними артефактами. Власник повідомив про
реальну чисту Windows 10 x64 VM-помилку `package.verify / ENOENT` для
`ServerManager\resources\server-payload\package-integrity.json`. Setup містить
повний `Server.next\package-integrity.json`, але в Manager resources залишає тільки
installer/recovery helpers. Отже, відсутність Service та `server.json` є наслідком
блокування до запуску первинного майстра, а не самостійно підтвердженими дефектами.

## Stable 0.1.3 hotfix — опубліковано; VM acceptance pending

Source-виправлення обирає bundled Server лише за наявності його integrity manifest;
helper-only payload переходить до повного `Server.next`, а відсутність повного пакета
завершується контрольованою помилкою. Пошкоджений manifest лишається вибраним і буде
відхилений штатною перевіркою. Portable Manager з повним bundled payload зберігає
поточну поведінку. SemVer залишається `X.Y.Z`; 0.1.3 новіша за 0.1.2.

Client, API Server, Server Manager, Universal Setup і Server ZIP зібрані штатним
production workflow з версією 0.1.3. Цільові перевірки: **118/119 PASS, 1 SKIP**
(наявний Windows ZIP-specific test пропускається без відповідного test ZIP); два
Server Manager TypeScript no-emit checks пройшли. Setup та Server ZIP пройшли
архівну/ціліснісну перевірку, release manifest створено штатним генератором і
перевірено. Client ASAR містить три tracked Excel templates; `Реєстр.xlsx` відсутній.
Setup містить повний `Server.next/package-integrity.json`, helper-only Manager
payload та не дублює Server runtime у Manager resources. GitHub Stable Release
`0.1.3` опубліковано; code signing не налаштований. Реальні Windows UAC, NSIS,
первинне Server-only/Combined налаштування та API health після hotfix не перевірялися.
Публікація не є підтвердженням Windows VM acceptance. Stage 9.1.3 і Stage 9.1 не
завершені.

Артефакти: `release/stage-9.1.3/stable-0.1.3/`. SHA-256: Setup
`764b033bb5eebe53081b73cd8b6e201f6c431049341c5922987ef3e631fb7811`, Server ZIP
`8090f86a3f2e91cf3a8afaa793287bbf3bd9d1628f36c286b00d439de8b73e58`, manifest
`c5fdde2697b00a5abcd6a0f4f097175decbca993e800f1f482cfa58d061290b6`.

## Публікаційна безпека та наступний крок

[Попередній security audit](stage-9.1.3-publication-security-audit.md) чинний у своєму
scope. Збережені рішення власника: публічний основний repository; дозволена його
контактна картка; три знеособлені tracked Excel templates. Через них не переписувати
history і не повторювати оцінку XLSX. Реєстр.xlsx відсутній; release/data/log/key
артефакти ігноруються. Зміни source не додали виявлених production credentials чи
даних; це цільова перевірка diff, а не повторний аудит усієї історії.

Наступні окремі етапи для `0.1.4`: production packaging із version bump і трьома
релізними артефактами, ручна публікація власником, а потім Windows VM acceptance.
Жоден із цих кроків не вважати виконаним до відповідного підтвердження.

## 0.1.4 — спрощення NSIS welcome та selective update UX

Universal Setup лишається єдиним інсталятором. Для звичайного запуску порядок
сторінок: Welcome → вибір компонентів → наявні кроки → Finish. Welcome розрізняє
чисту інсталяцію за відсутністю `InstalledComponents`, повну зареєстровану інсталяцію
за маркером і відповідними EXE та невідомий/неповний стан; залишкові каталоги не є
доказом встановлення. Намір змінити склад або обслуговувати компоненти визначається
після вибору, без додаткового майстра.

Client `/CLIENTUPDATE=1` та Manager `/MANAGERUPDATE=1` показують першу welcome-сторінку
з назвою відповідного компонента і цільовою версією `${APP_VERSION}`. Потім штатні
guards пропускають сторінку компонентів і звичайний вибір каталогу; виконуються
наявні selective operation та Finish. Client, Manager і API Server оновлюються у
своїх чинних режимах; API ZIP оновлення лишається окремою операцією з Server Manager.

Launcher, UAC handoff, exit code, completion marker, перевірка версії та автоматичний
restart не змінювалися. `InstalledComponents`, Service, дані та ярлики не змінювалися
цією UX-правкою. Цільові NSIS/selective-update перевірки проходять; ручна Windows VM
перевірка welcome, selective flow, completion та restart залишається PENDING.
Production Setup не пакувався.

## 0.1.4 — Server Manager: сторінка оновлень

IMPLEMENTED у `server-manager/src/UpdateManagement.tsx`: API Server ZIP download
використовує спільний `ReleaseUpdateProgress`, як Client і завантаження Setup.
Передані updater-ом `receivedBytes`/`totalBytes` визначають відсоток лише за відомого
розміру; для невідомого розміру смуга лишається indeterminate і може показати реально
отримані байти. Під час завантаження діалог не показує етапи серверної транзакції;
після отримання та перевірки ZIP він переходить до наявного preview, а встановлення
зберігає порядок семи етапів без змін.

Три картки сторінки залишилися на місці, їхні основні дії перенесені у праву колонку;
кнопка Server ZIP показується лише за статусу доступного оновлення та зберігає чинні
guards. Release notes Server розгортаються через компактний disclosure з наявним
безпечним renderer. Статуси Manager відповідають Client: «Встановлено останню
перевірену версію», «Доступна версія …», повідомлення перевірки та помилки; перевірка
позначається активною одразу після натискання. Update mechanisms, SHA-256, API
transaction, Service, recovery та restart не змінювалися.

Цільові автоматичні перевірки: 3/3 PASS (статусні стани, відсутність фіктивного
відсотка без розміру та події байтів/перехід verifying → ready). Два Manager/Client
UI TypeScript no-emit checks пройшли. Windows VM-візуальна перевірка кнопок, довгих
release notes, невідомого download size і вузького вікна залишається PENDING.
Production packaging `0.1.4`, version bump і GitHub publication ще не виконувалися.
