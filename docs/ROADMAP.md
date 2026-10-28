# Roadmap

## Stage 9.1 — Automatic Updates — COMPLETED

| Підетап | Статус | Підсумок |
| --- | --- | --- |
| Stage 9.1.1 | **COMPLETED** | Stable GitHub provider, release manifest, перевірка цілісності та Client update |
| Stage 9.1.2 | **COMPLETED** | Manager selective update та API Server ZIP update через чинну транзакцію/recovery |
| Stage 9.1.3 | **COMPLETED** | Виправлення й інтеграція автоматичних оновлень, production packaging та Stable 0.1.6 |
| Stage 9.1 | **COMPLETED** | Основні Client, Server Manager та API Server update flows прийняті у Windows 10 x64 VM |

Stable **0.1.6** опубліковано. Власник підтвердив у Windows 10 x64 VM оновлення
Client до 0.1.6, повний автоматичний Manager update 0.1.5 → 0.1.6 та API Server
update до 0.1.6. Перевірено роботу Windows Service й API, авторизацію Client та
збереження наявних даних; усі компоненти мають версію 0.1.6. Створено snapshot
`HromadaAID 0.1.6 – Stable Baseline`. Розширені негативні, аварійні та стресові
тести не входили до погодженого обсягу приймання. Історичні результати й обмеження
збережені у [Stage 9.1.3 manual testing](stage-9.1.3-manual-testing.md).

## Stage 9.2 — Tailscale Connectivity — COMPLETED

**Статус: COMPLETED. Прийнята стабільна версія — 0.2.1.** Власник підтвердив
успішне ручне приймання Stage 9.2 у Windows VM, включно з оновленням установленої
0.2.0 до 0.2.1 та збереженням серверної конфігурації й даних.

- Один Fastify API Server з однією SQLite та IPv4 HTTP listener 0.0.0.0:4310.
- Одночасні loopback/LAN/Tailscale підключення; HTTP не має внутрішнього TLS.
  LAN HTTP не шифрує дані; Tailscale забезпечує тунель між вузлами.
- Client вручну отримує й зберігає HTTP IPv4/DNS адресу з портом 4310, без discovery
  або автоматичного перемикання серверів. Авторизація, RBAC і сесії збережені.
- Manager показує адреси з копіюванням лише в огляді та окремо перевіряє SCM/API.
  Майстер має три кроки: каталоги, адміністратор, підсумок.
- У 0.2.1 Manager намагається визначати адреси за Windows metadata адаптерів;
  Tailscale CLI не запускається. На протестованій Windows VM автоматичне визначення
  LAN/Tailscale IPv4 працює некоректно в окремих конфігураціях. Це некритичне
  обмеження відображення: підключення Client не порушене, адресу можна ввести вручну.
  Власник прийняв це обмеження; окремого завдання на виправлення не створюється.
- Єдина конфігурація v3; старі версії й транспортні поля відхиляються без
  автоматичної міграції, перезапису чи створення іншої SQLite.
- Немає Tailscale SDK/API, керування tailnet або автоматичних Windows Firewall
  rules. Зовнішній HTTPS, backup/restore та загальний update/recovery збережено.

Автоматичні перевірки й пакування пройшли. У Windows VM власник підтвердив
оновлення Client, Server Manager та API Server через Manager, збереження
конфігурації/SQLite та роботу системи після оновлення; віддалене підключення Client
через Tailscale працює. VM-протокол і прийняте обмеження зафіксовано у
[stage-9.2-manual-testing.md](stage-9.2-manual-testing.md). Фактична реалізація —
[ARCHITECTURE.md](ARCHITECTURE.md), політика — [TRANSPORT.md](../server/TRANSPORT.md).

## Stage 9.3 — Project Cleanup — COMPLETED

**Статус: COMPLETED / ACCEPTED.** Виправлено шлях тесту `windows:test-installer`, видалено підтверджено
невикористаний Client helper резервування, актуалізовано чинні документи для
Stage 9.2 та HTTP transport, а перед `server:build` додано перевірене очищення
лише generated `dist-server`. Server payload і staging publication не змінено.
Автоматичні цільові перевірки успішні; GUI/VM-тести та повний Windows installer
packaging не проводилися.

На момент завершення Stage 9.3 Stable залишався **0.2.1**: зміни Stage 9.3
увійшли до наступного релізу **v0.2.2**, який згодом було опубліковано після
Stage 9.4.

| Cleanup audit item | Результат Stage 9.4 |
| --- | --- |
| CL-05 — зафіксувати CI toolchain | **COMPLETED** — Node.js 24.22.1, pnpm 11.25.0 |
| CL-06 — стабілізувати NSIS packaging у CI | **COMPLETED** — Windows x64 packaging через GitHub Actions, Stable build успішний |
| CL-07 — цільові regression checks | **COMPLETED** — 12 цільових перевірок пройшли |
| CL-08 — release artifact orchestration | **COMPLETED** — Setup, Server ZIP, manifest і автоматична Stable publication |
SQL/domain modules у `electron/`, які використовує Server, збережено.

## Stage 9.4 — CI/CD Automation — COMPLETED / ACCEPTED

Автоматизувати цільові перевірки, Windows x64 build та підготовку релізу через
GitHub Actions, не змінюючи архітектуру оновлень, release provider чи SemVer policy.
Code signing не є обов’язковою умовою цього етапу.

Обсяг планування:

- Ризик-орієнтовані automated tests та TypeScript/build checks.
- Windows x64 packaging: Universal NSIS Setup і Server ZIP.
- Release manifest generation та перевірка цілісності зовнішніх і внутрішніх manifests.
- Погоджена модель: один `release.yml` на push у `main`, Windows x64, версія з
  package.json та автоматична публікація у GitHub Releases. Функціональні tests
  виконуються до merge, поза release workflow.
- Пріоритет тестів: authentication/RBAC, database integrity, migrations, financial
  calculations, update/recovery, release integrity та packaging correctness.
- GitHub Actions виконує Windows x64 packaging і публікацію Stable Releases.

Реалізовано один workflow `.github/workflows/release.yml`: push у `main` запускає
Windows x64 build, `pnpm release:package`, integrity/manifest verification,
artifact upload і Stable publication. `workflow_dispatch` виконує build без
публікації. Наявна Stable SemVer не перебудовується й не публікується повторно.
Build job має `contents: read`, окремий publication job — `contents: write`.

Успішний реліз **v0.2.2** зібрано та опубліковано через Actions. Власник підтвердив
Windows VM acceptance за всіма п’ятьма пунктами. Усі 12 цільових перевірок пройшли.
Stable Release і assets: [v0.2.2](https://github.com/Anatol1ch/HromadaAID/releases/tag/v0.2.2);
Actions run: [40688787157](https://github.com/Anatol1ch/HromadaAID/actions/runs/40688787157);
release commit: `62fff52d2ff0929adc502b77a490bfbd229057c2`.

## Stage 9.5 — Bank Details Validation & Production Release 1.0.0 — COMPLETED

Реалізувати й прийняти три точкові перевірки банківських реквізитів, а потім
підготувати та опублікувати Stable Release **1.0.0**:

- МФО: автоматична блокувальна перевірка рівно шести цифр для заповненого поля,
  з перевіркою на серверному рівні та без зміни чинної обов'язковості.
- ЄДРПОУ: автоматична блокувальна перевірка рівно восьми цифр; контрольний
  розряд не перевіряється.
- IBAN: добровільна перевірка українського формату й MOD 97 лише після натискання
  кнопки; результат не блокує збереження.
- Без зовнішніх API/довідників і без висновків про існування банку, юридичної
  особи чи рахунку або його належність отримувачу.
- Цільові автоматичні тести правил МФО, ЄДРПОУ та IBAN, включно із серверною
  валідацією МФО; ручне UI-тестування у dev-збірці, VS Code та Electron.
- Після реалізації й приймання — підготовка та публікація Stable 1.0.0 через
  чинний GitHub Actions pipeline.

Stage 9.5.1–9.5.3 функціонально прийнято власником після ручного тестування. Stable **1.0.0** успішно опубліковано через GitHub Actions; реліз містить Universal Setup, Server ZIP і `release-manifest.json`. Release commit: `d7980aab22ccd5ac6975cfb396d58c2585aae410`. Післярелізний checkpoint та рішення власника не проводити повторний цикл приймання наведено в [HANDOFF](HANDOFF.md). Реліз: [Stable 1.0.0](https://github.com/Anatol1ch/HromadaAID/releases/tag/v1.0.0).

## Stage 9.6 — Installation & Administration Guide — COMPLETED (documentation deliverable)

Підготовлено [одну комплексну Markdown-інструкцію](installation-and-administration.md)
для Stable 1.0.0 українською для працівників ОМС із базовими навичками роботи у
Windows. Відповідність реалізації технічно перевірено. Описано погоджений обсяг:

1. Встановлення Client-only, Server-only і Combined.
2. Початкове налаштування Server Manager та підключення Client.
3. Робота на одному ПК і в LAN.
4. Зовнішні процедури Windows Firewall і DHCP Reservation, включно зі старими
   маршрутизаторами TP-Link із класичним вебінтерфейсом.
5. Tailscale для віддаленого підключення.
6. Адміністрування Server Manager, резервне копіювання та відновлення.
7. Оновлення Client, Server Manager і API Server.
8. Діагностика й усунення несправностей.

Інструкція містить практичні процедури Tailscale і DHCP Reservation.
Windows Firewall, DHCP Reservation і Tailscale — зовнішні процедури/засоби, а не
вбудовані функції HromadaAID. Технічні обмеження й ризики зазначено. Stage 9.6
завершено як документаційний результат. Повторний цикл післярелізного приймання
Stable 1.0.0 не планується за рішенням власника. Це не підтвердження окремого
проходження кожного додаткового сценарію після випуску.

## Post-release backlog

Інші погоджені post-release ідеї, якщо вони заведені в окремих планах, зберігають
чинний статус і не змінюються цим оновленням.

<a id="post-1-0-0-backlog"></a>
## Post-1.0.0 – Future Development Backlog

Власник погодив п'ять функціональних напрямів. Усі мають статус **PLANNED / NOT
STARTED**. Новий етап розробки ще не розпочато; наведені вимоги не є затвердженням
архітектури, транспорту подій або остаточного workflow.

### Recipient Assistance History

**Статус: PLANNED / NOT STARTED.** Додати в картку отримувача вкладку «Історія допомоги».

- Показувати всі призначення й виплати отримувача за різні роки.
- Для кожного запису відображати дату й номер рішення, програму та вид
  матеріальної допомоги, призначену й фактично виплачену суми, поточний статус.
- Підсумки за весь період: кількість призначень, загальна призначена сума та
  загальна виплачена сума.
- Використовувати наявні зв'язки отримувачів, рішень, призначень і виплат;
  не створювати дублікати фінансових даних.

### Executive Committee Decision Annex Generation

**Статус: PLANNED / NOT STARTED.** Підготовка додатків до рішень виконавчого комітету.

- Створення та редагування проєкту рішення до офіційного прийняття.
- Додавання отримувачів, видів допомоги й сум та формування додатка за
  затвердженим шаблоном.
- Після прийняття внесення фактичного номера й дати та переведення проєкту
  в стан прийнятого рішення.
- Створення проєкту чи формування додатка не повинно автоматично створювати
  остаточне призначення допомоги.
- Зберегти сумісність із чинною моделлю рішень і призначень. Формат документа
  й остаточний workflow визначити перед реалізацією.

### Administrator Broadcast Notifications

**Статус: PLANNED / NOT STARTED.** Повідомлення адміністратора на екранах підключених Client.

- Створення повідомлення через адміністративний інтерфейс і надсилання всім
  підключеним клієнтам або вибраним користувачам.
- Інформаційні, важливі й термінові повідомлення без перезапуску Client.
- Підтвердження прочитання для відповідних типів повідомлень.
- Транспорт серверних подій визначити під час технічного проєктування.

### Centralized Maintenance Mode

**Статус: PLANNED / NOT STARTED.** Централізований режим технічного обслуговування.

- Попередження про заплановані роботи, встановлення часу початку й відображення
  попереджень на підключених Client.
- Централізоване блокування робочого інтерфейсу, окремий екран обслуговування
  та обов'язкове серверне обмеження звичайних бізнес-операцій на час робіт.
- Контрольоване завершення режиму й відновлення роботи Client; безпечний
  адміністративний та аварійний механізм вимкнення режиму.
- Під час проєктування врахувати незавершені операції, збереження даних,
  активні сесії та адміністративне відновлення доступу.
- Розглянути спільний механізм серверних подій з Administrator Broadcast
  Notifications; конкретний транспорт поки не визначено.

### Recipient Email Status Notifications

**Статус: PLANNED / NOT STARTED.** Електронні повідомлення отримувачам про зміну статусу допомоги.

- Необов'язкове поле email у картці отримувача, налаштування SMTP через
  адміністративний інтерфейс і захищене зберігання облікових даних поштового сервісу.
- Налаштовувані шаблони листів для статусів «Призначено», «В роботі», «Виплачено».
- Черга надсилання, повторні спроби, контроль помилок, захист від повторного
  надсилання однакових повідомлень і журнал результатів.
- Можливість централізовано вимкнути автоматичну розсилку.
- Помилка доставки не повинна впливати на статус призначення чи виплати.
- Не включати до листів РНОКПП, паспортні дані, IBAN та іншу зайву персональну
  інформацію. Перед реалізацією визначити правові підстави обробки email-адрес
  і надсилання повідомлень.
- Статус «Виплачено» має відповідати підтвердженому факту виплати.

### Орієнтовне групування за версіями

Це попередній план, без затверджених дат чи зобов'язань щодо релізів. Номери
версій можуть змінитися перед початком реалізації; поточний Stable залишається 1.0.0.

| Попередня версія | Напрям | Функції | Статус |
| --- | --- | --- | --- |
| 1.1.0 | Recipients & Decisions | Recipient Assistance History; Executive Committee Decision Annex Generation | PLANNED / NOT STARTED |
| 1.2.0 | Centralized Administration | Administrator Broadcast Notifications; Centralized Maintenance Mode | PLANNED / NOT STARTED |
| 1.3.0 | Recipient Communications | Recipient Email Status Notifications | PLANNED / NOT STARTED |

## Документи проєкту

Призначення продукту: [PROJECT.md](PROJECT.md). Поточний checkpoint:
[HANDOFF.md](HANDOFF.md). Архітектура: [ARCHITECTURE.md](ARCHITECTURE.md).
Затверджені рішення: [DECISIONS.md](DECISIONS.md).
