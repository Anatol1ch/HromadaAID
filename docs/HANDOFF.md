# Контекст для наступного чату

## Checkpoint

- Дата фіксації: **2026-10-26**.
- Гілка: **`feature/client-server`**.
- HEAD до Stage 9.1.1:
  **`0270b3f5ddb25d1c174c66aac018f75a3cfe7ac1`**.
- Stage 9.1.1 зафіксовано одним commit на поточному HEAD. Для точного hash
  виконай `git rev-parse HEAD`; документ не дублює власний commit hash.
  Stage 9.1 продовжується роботою над Manager та API Server.
- Версії кореневого проєкту та API Server: **`0.1.0`**.
- Робоче дерево на початку документаційного завдання було чистим.
- **Stage 8.2 завершено. Stage 9.1.1 реалізовано; Stage 9.1 триває.**
  Наступний напрям: Server Manager і API Server через спільні Stable release
  contracts. Реальну перевірку NSIS/UAC виконати у Windows VM.

## Останні зміни

| Коміт | Значення |
| --- | --- |
| `e4d843b` | Restore зберігає ACL service SID на Backups |
| `05b5677` | Посилено ZIP update, SemVer, PowerShell arguments/діагностику |
| `92cc835` | UX Server Manager, наявна дизайн-система й усі п'ять розділів |
| `c8ba96d` | Recovery update/restore, захист від небезпечного DB return, timeout/lock |
| `9501b08` | Лише installer test: assertion узгоджено зі структурованою JSON/Base64 діагностикою |
| `HEAD` | Shared Stable GitHub Releases та Client automatic updates, NSIS Client-only upgrade mode |

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
- Автоматичне оновлення реалізоване лише для Client. Server Manager і API Server
  ще не інтегровані.

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
- GitHub Release не публікувався й не перевірявся наживо; Manager/API Server update
  та криптографічне підтвердження видавця залишаються майбутньою роботою.
- У Windows VM перевірити Client-only/Server-only/Combined upgrade, збереження
  `InstalledComponents` і Installed Apps запису, Combined Server Service/файлів,
  даних та конфігурації, штатний UAC і його відмову, download/install progress,
  hash/HTTP/timeout/network failure, перерване встановлення, повтор після збою,
  NSIS success marker і автоматичний повторний запуск Client. Перевірити також
  реальний GitHub Stable Release зі створеним release manifest. Packaging і
  публікація у цьому завданні не виконувалися.

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
