# HromadaAID

HromadaAID — настільна клієнт-серверна система обліку матеріальних допомог для
органів місцевого самоврядування. Інтерфейс користувача українською мовою.

## Компоненти

| Компонент | Призначення |
| --- | --- |
| HromadaAID Client | Робота працівників із реєстрами та документами через API |
| HromadaAID API Server | Бізнес-операції, автентифікація, SQLite та серверні резервні копії |
| HromadaAID Server Manager | Локальне адміністрування встановленого сервера |
| Єдиний Windows Setup | Client-only, Server-only (API + Manager), Combined; Modify/Upgrade/Uninstall |

## Наявні можливості

- Облік отримувачів, банків, рішень і призначень матеріальної допомоги.
- Довідники, річне планування, звітність і формування платіжних відомостей.
- Формування Excel-документів через Windows Excel COM та наявні шаблони.
- Облікові записи, ролі й обмеження доступу до операцій.
- Налаштування адреси сервера в Client; поточна реалізація використовує HTTP на
  loopback та HTTPS у мережевому режимі. Ціль Stage 9.2 щодо майбутнього внутрішнього
  HTTP transport для LAN і Tailscale ще не впроваджена.
- Первинне налаштування сервера, контроль служби/API, резервування,
  ZIP-оновлення та контрольоване recovery через Server Manager.
- Обов'язкові Stable GitHub оновлення Client/Manager через універсальний Setup
  та завантаження Server ZIP через чинний транзакційний updater.

Client не має автономної робочої SQLite або адміністративного резервування.
Старі клієнтські backup-файли залишаються на диску й автоматично не мігруються.

## Поточний стан

Останній опублікований Stable Release — **0.1.6**. Client, Server Manager та API
Server мають версію 0.1.6. Основні автоматичні оновлення компонентів, робота
Windows Service та API, Client authorization і збереження наявних даних підтверджені
власником у Windows 10 x64 VM. **Stage 9.1 — Automatic Updates завершено.**

Наступний етап — **Stage 9.2: Tailscale Connectivity**. Його погоджена ціль —
одночасне підключення до одного API Server через loopback HTTP, LAN HTTP та HTTP
через Tailscale; поточна мережна реалізація поки вимагає HTTPS. Деталі майбутньої
політики й інші етапи наведені у [ROADMAP.md](ROADMAP.md). Поточний checkpoint і
межі VM-приймання — у [HANDOFF.md](HANDOFF.md); історія тестування — у
[Stage 9.1.3 manual testing](stage-9.1.3-manual-testing.md).

Технічні межі: [ARCHITECTURE.md](ARCHITECTURE.md). Подальша робота:
[ROADMAP.md](ROADMAP.md). Актуальний checkpoint і перевірки: [HANDOFF.md](HANDOFF.md).
