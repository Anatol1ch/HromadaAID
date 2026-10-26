# Контекст для наступного чату

## Checkpoint

- Дата фіксації: **2026-10-26**.
- Гілка: **`feature/client-server`**.
- Stage 9.1.1 був зафіксований на попередньому HEAD; Stage 9.1.2 реалізацію
  та документацію зафіксовано окремим логічним commit. Для актуального hash
  виконай `git rev-parse HEAD`; HANDOFF не дублює власний commit hash.
- Версії кореневого проєкту та API Server: **`0.1.0`**.
- Робоче дерево було чистим перед Stage 9.1.2; після commit перевірити
  `git status --short`.
- **Stage 8.2 та реалізація Stage 9.1.1–9.1.2 завершені. Stage 9.1 і продукт
  не production-ready до ручних Windows VM перевірок.**

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
