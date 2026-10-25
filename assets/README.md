# Іконка HromadaAID

Server Manager має окремі `hromadaaid-server-manager.svg/png/ico`: чинний бренд
HeartHandshake доповнено символом Wrench із уже встановленого Lucide (ISC).
Геометрія Client та його файли не змінюються. ICO містить 16/24/32/48/64/128/256 px;
PNG — 512 px. Відтворення: `node scripts/generate-manager-icons.mjs` (потрібні
лише наявні build-залежності Electron). `server-manager/electron-builder.yml`
задає іконку EXE та майбутнього NSIS, `main.ts` — вікна/панелі завдань. Portable
містить файли у `resources/assets`, без залежності від шляху всередині ASAR.

`hromadaaid.svg` точно відтворює графічний знак сайдбару: `HeartHandshake` з наявного `lucide-react`, 22×22 у квадраті 42×42, strokeWidth=2.1, білий колір, фон #286343, радіус 12. Текстове найменування поруч із знаком не входить до іконки.

- PNG: 512×512, прозорі кути, пропорції SVG збережено.
- ICO: окремі кадри 16, 24, 32, 48, 64, 128, 256 px.
- SVG: масштабований вихідний ресурс.

Ресурси готові й не потребують генерації під час запуску. `electron/copy-assets.mjs` копіює всі три файли до `dist-electron/electron/assets` для Electron runtime та зберігає сумісну копію в `dist-electron/assets` для чинних перевірок. У майбутньому пакеті extraResources копіює іконки поза ASAR до resources/assets, звідки їх читає main. Це забезпечує звичайний файловий шлях для нативного Windows-завантажувача ICO.

У `package.json` додано конфігурацію electron-builder для Windows EXE, NSIS та ярликів. AppUserModelID збігається з main.ts: local.hromadaaid. Ключі конфігурації звірено зі стабільною схемою electron-builder 26.18.0. Пакування використовує electron-builder із чинного lockfile; Stage 7 не створює інсталяторів. Перед майбутнім пакуванням потрібно виконати звичайну збірку застосунку. Назву package та userData не змінено.

У dev використовується виконуваний файл Electron, тому його власна іконка у Провіднику або старий вручну закріплений ярлик Electron можуть залишатися стандартними. Іконка головного вікна задається безпосередньо, а майбутній Windows EXE та створені NSIS ярлики отримуватимуть ICO з конфігурації пакування.
