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

## Stage 9.2 — Tailscale Connectivity — NEXT

**Статус: NEXT, не розпочато.** Мета — підключати клієнти до одного API Server
через три маршрути, доступні одночасно в межах однієї серверної інсталяції:

1. Loopback HTTP на серверному комп’ютері.
2. HTTP через локальну мережу.
3. HTTP через приватну мережу Tailscale.

Різні клієнти зможуть одночасно використовувати відповідні маршрути до того самого
сервера й тієї самої бази. Не створювати окремі сервери або бази для різних типів
підключення.

Цільова політика для **внутрішнього API HromadaAID** — HTTP на loopback, LAN і
Tailscale. Це погоджена майбутня зміна: поточна реалізація досі вимагає HTTPS/TLS
для мережевого режиму. Loopback HTTP обмежений локальним комп’ютером; LAN HTTP не
має прикладного транспортного шифрування; Tailscale надає шифрований тунель між
вузлами tailnet. API додатково захищений чинними authentication, RBAC,
server-side authorization та іншими механізмами доступу. HTTP-ціль не змінює
HTTPS для GitHub Releases, завантаження оновлень чи інших зовнішніх сервісів.

Tailscale залишається зовнішнім мережевим інструментом: не плануються його SDK,
автоматичне встановлення, керування tailnet або окремі TLS-сертифікати.
Механізм прослуховування кількох мережевих інтерфейсів визначити під час
технічного проєктування; конкретний bind/listener наперед не фіксується.
Не послаблювати чинні мережеві обмеження без окремого обґрунтування.

Під час Stage 9.2 актуалізувати `server/TRANSPORT.md`, щоб він описував нову
фактичну реалізацію після її впровадження. До реалізації цей документ лишається
описом поточної TLS-політики.

Планована окрема гілка: `feature/tailscale-connectivity`, створена від `main`;
гілка ще не створена. Архітектурні рішення — у [DECISIONS.md](DECISIONS.md),
фактична реалізація — у [ARCHITECTURE.md](ARCHITECTURE.md).

## Stage 9.3 — Project Cleanup — PLANNED

- Видаляти лише підтверджено невикористаний код.
- Очищати застарілі залежності й технічний борг з конкретним обґрунтуванням.
- Перевірити конфігурації та актуалізувати документацію.
- Зберігати чинні контракти й сумісність; не проводити масштабний рефакторинг без потреби.
- SQL/domain modules у `electron/`, які використовує Server, не вважати застарілими лише за їхнім розташуванням.

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
