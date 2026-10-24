# HromadaAID Server Manager — D2.3C

Окремі Electron main і React/Vite entry points. Основний застосунок та Fastify не запускаються. Спільними є тільки CSS-токени/примітиви `src/styles.css`, локальний компонент `Alert` та Lucide. Привілейованих операцій і Installation Engine немає.

Команди з кореня репозиторію:

- `pnpm manager:dev` — окреме вікно з Vite/HMR на `127.0.0.1:5176`; закриття вікна завершує dev-сеанс. Зайнятий порт не звільняється примусово.
- `pnpm manager:start` — збірка й автономний запуск через `file://`, без Vite/Fastify. Потрібні лише залежності розробника цього репозиторію.
- `pnpm manager:build` — окремі виходи `dist-server-manager/main/main.js`, sandbox-сумісний `preload.cjs`, inspection modules і `dist-server-manager/renderer`; основна збірка клієнта їх не включає.
- `pnpm manager:test` — типи, збірка, unit-тести engine та функціональні перевірки Electron-вікна через `file://` і Vite, у тимчасових профілях. Знімок огляду: `dist-server-manager/preview.png`.

Реальний режим є режимом за замовчуванням. Він запускає перевірку лише після явної дії користувача. У dev-режимі залишено перемикач до шести синтетичних сценаріїв; у packaged UI його немає. Перемикання режиму не змінює систему.

Вікно має окремий профіль `HromadaAID-Server-Manager` у стандартному AppData, власну session partition, sandbox/contextIsolation, заборонені дозволи та нові вікна. Renderer не має Node.js або мережевого доступу. Мінімальний preload відкриває лише `inspectEnvironment()` без аргументів. Main перевіряє джерело IPC-виклику та не приймає довільних команд.

Inspection Engine читає службу `HromadaAIDApi` через локальний `Get-CimInstance Win32_Service`, звідти визначає шлях WinSW, читає XML служби та абсолютний `--config`. Для підтвердження пакета перевіряє наявність комплектного Node.js, WinSW, server entrypoint, Fastify й Argon2 та читає лише `version` з `app/package.json`. Конфігурація перевіряється allowlist-полями встановленого формату v1/v2. SQLite, резервні архіви, DPAPI-файл і вміст TLS-сертифіката/ключа не читаються. Для мережевої конфігурації перевіряється лише наявність шляхів TLS-файлів; HTTPS використовує стандартну перевірку сертифіката, не переходить за redirect і має 4-секундний тайм-аут.

Health перевірка виконує лише `GET /health` за адресою з валідної конфігурації. Відповідь приймається лише за HTTP 200 і точною формою `{ status: "ok", service: "hromada-aid-api", apiContractVersion: 1 }`. Для `mode=local` HTTP дозволений лише на loopback; `mode=network` вимагає конкретну IP-адресу й HTTPS. Стан відсутньої служби відрізняється від помилки SCM.

Без служби менеджер може визначити часткову інсталяцію тільки за стандартними каталогами `%ProgramFiles%\HromadaAID` і `%ProgramData%\HromadaAID\Data`. Якщо встановлювали у довільні каталоги й служба відсутня, сучасний механізм інсталяції не має окремого індексу/маркера, тому менеджер не сканує диск і може показати `not_installed`; це відоме обмеження для D2.3D.

`shared/installation-contract.ts` і надалі описує майбутні операції незалежно від React. Контракт Inspection Engine відокремлений у `server-manager/electron/inspection-types.ts`; відповіді містять лише безпечні статуси, пояснення, технічні коди та allowlist метадані.

Пакування Server Manager, UAC, керування службою, редагування конфігурації, майстер, аварійний ключ та оновлення ще не реалізовані. CIM/SCM інтеграцію необхідно окремо перевірити у Windows VM; unit-тести engine використовують mocks і не створюють службу.
