# HromadaAID Server Manager

Окремі Electron main, preload та React/Vite entry point. Manager не залежить від запущеного Fastify й відкривається максимізованим. Він використовує CSS-токени, кнопки, Alert і Lucide основного Client, але не його бізнес-екрани.

## Запуск і перевірки

- `pnpm manager:dev` — окремий dev-сеанс на порту 5176; зайнятий порт не звільняється примусово.
- `pnpm manager:start` — production renderer через `file://`, без Vite/Fastify.
- `pnpm manager:build` — типізація й збірка до `dist-server-manager`.
- `pnpm manager:test-stage7` — цільові перевірки станів, Inspection Engine, керування службою, іконки й Electron GUI; без реальних SCM-операцій та повторного повного тестування ZIP-транзакцій.
- `pnpm manager:test` — весь набір Manager, включно з тестовими файловими транзакціями оновлення.
- `pnpm manager:portable` — portable Windows x64 у `release/server-manager/win-unpacked`. Пакет містить Electron та комплектний server payload; робочі SQLite, конфігурації та ключі до нього не входять.
- `pnpm manager:portable:smoke` — запуск готового EXE з тимчасовим профілем. Завершується лише процес тестового Manager.

## Межі безпеки

У renderer увімкнені sandbox і contextIsolation та вимкнений nodeIntegration. Preload має лише фіксовані типізовані методи діагностики, вибору каталогів, встановлення, ZIP-оновлення й керування службою. Main перевіряє джерело IPC; довільних команд немає. На Windows адміністративні операції потребують підвищених прав за поточною архітектурою.

Реальний стан перевіряється під час запуску та кожні 15 секунд. Опитування призупиняється під час системних операцій. Кнопки ручної перевірки показують зайнятість та фактичний результат. Шість демонстраційних сценаріїв доступні лише в dev-режимі; перемикання не змінює систему. Закриття Manager не зупиняє сервер.

Inspection Engine залишається read-only: служба HromadaAIDApi, її WinSW XML, allowlist полів server.json, версія пакета та GET /health. Робоча SQLite, вміст резервних архівів і ключів для оглядової перевірки не відкриваються. SCM-помилка відрізняється від відсутньої служби. HTTP 200 без коректного HromadaAID health contract не підтверджує готовності API.

Джерела Installation Discovery — метадані Windows Service, захищені advisory-шляхи інсталятора в HKLM\Software\HromadaAID\Installer та обмежені стандартні каталоги. Шляхи з locator не вважаються довіреними без перевірки. Сканування всіх дисків немає. Для мережевого API збережені HTTPS і стандартна перевірка сертифікатів.

Встановлення використовує наявні серверні CLI й PowerShell-сценарії, передає пароль через stdin, окремо підтверджує збереження аварійного ключа. Оновлення використовує чинну транзакцію Server.next / Server / Server.previous / Server.failed. Установлений старий пакет з одним integrity-маніфестом підтримується без створення фіктивних метаданих. Новий ZIP потребує обох маніфестів. Коди помилок і стани відкату залишаються окремими.

## Дизайн і перевірка у VM

Іконки `assets/hromadaaid-server-manager.svg/png/ico` мають спільний із Client знак та окремий символ гайкового ключа. Вони використовуються у вікні, EXE, portable та конфігурації майбутнього інсталятора. Client icon не змінюється.

Знімки тестового UI: `release/server-manager-ui-review`. Вони містять синтетичні відповіді IPC, а не стан робочого сервера. GUI-чекліст, мережеві умови й передумови Stage 8: `docs/stage-7-architecture-and-ui.md`. Процедура повторного ZIP-тесту: `docs/server-manager-update-retry.md`.