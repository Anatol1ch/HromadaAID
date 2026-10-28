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

Опублікований Stable залишається **0.2.1**. Зміни Stage 9.3 є у вихідному коді й
Git-історії, але не входять до пакетів чи release artifacts 0.2.1; окрему збірку
або реліз не створювали. Їх потрібно включити до наступного релізу після Stage 9.4.
Перед підготовкою релізу перевірити, що artifacts зібрано з commit, який містить
Stage 9.3. Наступну версію не призначено.

CL-05–08 — фіксація CI toolchain, NSIS compiler, підготовка окремих regression
checks і release artifact orchestration — залишаються завданнями Stage 9.4.
SQL/domain modules у `electron/`, які використовує Server, збережено.

## Stage 9.4 — CI/CD Automation — PLANNED

Автоматизувати цільові перевірки, Windows x64 build та підготовку релізу через
GitHub Actions, не змінюючи архітектуру оновлень, release provider чи SemVer policy.
Code signing не є обов’язковою умовою цього етапу.

Обсяг планування:

- Ризик-орієнтовані automated tests та TypeScript/build checks.
- Windows x64 packaging: Universal NSIS Setup і Server ZIP.
- Release manifest generation та перевірка цілісності зовнішніх і внутрішніх manifests.
- Контрольована підготовка GitHub Release із публікацією лише після підтвердження.
- Пріоритет тестів: authentication/RBAC, database integrity, migrations, financial
  calculations, update/recovery, release integrity та packaging correctness.
- Не створювати надмірний GUI automation suite для сценаріїв, які надійно
  перевіряються вручну.

## Stage 9.5 — Production Release 1.0.0 — PLANNED

Підготувати та опублікувати перший production-ready Stable Release **1.0.0** після:

- фінальних цільових перевірок і Windows VM acceptance;
- перевірки Client, Server та Manager, встановлення й оновлення;
- перевірки резервного копіювання та відновлення;
- перевірки мережевих сценаріїв;
- формування й перевірки фінальних release artifacts;
- публікації Stable 1.0.0 та перевірки опублікованих assets.

Stage 9.5 не вважати завершеним до фактичного приймання.

## Stage 9.6 — Installation & Administration Guide — PLANNED

Після стабілізації відповідних механізмів створити коротку практичну інструкцію
українською для адміністратора HromadaAID. Вона охоплюватиме встановлення Server
і Client, первинне налаштування, loopback/LAN/Tailscale підключення, встановлення
та налаштування Tailscale, додаткові робочі місця, базову діагностику, резервне
копіювання та оновлення компонентів. До Stage 9.6 інструкцію не створювати.

Окремий пункт Stage 9.6 — інструкція із закріплення локальної IPv4 серверного ПК
через **DHCP Reservation на маршрутизаторах TP-Link, зокрема старих моделях**:
визначення MAC-адреси ПК, вхід до вебінтерфейсу, типовий розділ
DHCP → Address Reservation, закріплення IPv4, застосування налаштувань і перевірка
отриманої адреси. Врахувати відмінності моделей і прошивок. Повну інструкцію
створити на Stage 9.6; DHCP Reservation у HromadaAID не реалізовувати.

## Post-release backlog

### POST-001 — Валідація банківських реквізитів — PLANNED

POST-001 не входить до Stage 9.2–9.6.

1. МФО: рівно 6 цифр.
2. ЄДРПОУ: рівно 8 цифр і перевірка контрольного розряду.
3. IBAN: окрема дія для перевірки формату та контрольної суми MOD 97.

IBAN validation не повинна автоматично блокувати збереження реквізитів. Успішна
контрольна сума не підтверджує існування рахунку або його належність отримувачу.
Зовнішні API банків чи НБУ не плануються.

Інші погоджені post-release ідеї, якщо вони заведені в окремих планах, зберігають
чинний статус і не змінюються цим оновленням.

## Документи проєкту

Призначення продукту: [PROJECT.md](PROJECT.md). Поточний checkpoint:
[HANDOFF.md](HANDOFF.md). Архітектура: [ARCHITECTURE.md](ARCHITECTURE.md).
Затверджені рішення: [DECISIONS.md](DECISIONS.md).
