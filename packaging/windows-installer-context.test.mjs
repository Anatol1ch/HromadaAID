import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('packaging/windows-installer.nsi', 'utf8')
const section = (name, next) => source.slice(source.indexOf(name), source.indexOf(next, source.indexOf(name)))
const context = section('Function DetermineWelcomeContext', 'Function WelcomePageCreate')
const welcome = section('Function WelcomePageCreate', 'Function .onInit')

test('component selection precedes the contextual welcome page; selective updater modes skip both pages', () => {
  assert.match(source, /Page custom ModePageCreate ModePageLeave[\s\S]*?Page custom WelcomePageCreate[\s\S]*?!insertmacro MUI_PAGE_DIRECTORY/)
  assert.doesNotMatch(source, /!insertmacro MUI_PAGE_WELCOME/)
  assert.match(section('Function ModePageCreate', 'Function SelectClientMode'), /\$ClientUpdateMode == "1"[\s\S]*?\$ManagerUpdateMode == "1"[\s\S]*?Abort/)
  assert.match(welcome, /\$ClientUpdateMode == "1"[\s\S]*?\$ManagerUpdateMode == "1"[\s\S]*?Abort/)
})

test('clean install is determined from the installer registry marker, not leftover directories', () => {
  assert.match(context, /ReadRegStr \$InstalledComponents HKLM "Software\\HromadaAID\\Installer" "InstalledComponents"/)
  assert.match(context, /StrCmp \$InstalledComponents "" welcomeContextInstall/)
  assert.match(context, /welcomeContextInstall:[\s\S]*?StrCpy \$WelcomeHeader "Встановлення HromadaAID"[\s\S]*?Вас вітає майстер встановлення HromadaAID/)
})

test('recognized installed component sets require their executables and compare selected components before saying update', () => {
  assert.match(context, /StrCmp \$InstalledComponents "Client" welcomeContextClient/)
  assert.match(context, /StrCmp \$InstalledComponents "Server,ServerManager" welcomeContextServer/)
  assert.match(context, /StrCmp \$InstalledComponents "Client,Server,ServerManager" welcomeContextCombined/)
  assert.match(context, /welcomeContextClient:[\s\S]*?Client\\HromadaAID\.exe[\s\S]*?welcomeContextServer/)
  assert.match(context, /welcomeContextServer:[\s\S]*?ServerManager\\HromadaAID Server Manager\.exe[\s\S]*?Server\\service\\HromadaAIDService\.exe[\s\S]*?welcomeContextCombined/)
  assert.match(context, /welcomeContextCombined:[\s\S]*?Client\\HromadaAID\.exe[\s\S]*?ServerManager\\HromadaAID Server Manager\.exe[\s\S]*?Server\\service\\HromadaAIDService\.exe/)
  assert.match(context, /welcomeContextComponentChange:[\s\S]*?Зміна компонентів HromadaAID/)
  assert.match(context, /welcomeContextUpdate:[\s\S]*?Оновлення HromadaAID[\s\S]*?Вас вітає майстер оновлення HromadaAID[\s\S]*?Налаштування сервера та дані користувачів будуть збережені\.[\s\S]*?Версія оновлення: \$\{APP_VERSION\}/)
  assert.match(context, /welcomeContextUnknown:[\s\S]*?Return/)
})

test('unknown and partial installs use neutral wording and no shared installed-version claim is shown', () => {
  assert.match(context, /StrCpy \$WelcomeHeader "Налаштування HromadaAID"/)
  assert.match(context, /StrCpy \$WelcomeDescription "Перевірте вибрані компоненти\./)
  assert.doesNotMatch(context, /InstallVersion|DisplayVersion/)
  assert.match(welcome, /\$WelcomeVersion != ""[\s\S]*?\$WelcomeVersion/)
})

test('installer context helper is read-only and leaves install/update sections outside it', () => {
  assert.doesNotMatch(context, /WriteReg|DeleteReg|File \/r|Rename |RMDir|ExecToLog|ExecToStack/)
  assert.match(section('Function ModePageLeave', 'Function DetermineWelcomeContext'), /Call SummaryLeave[\s\S]*?Call DetermineWelcomeContext/)
  assert.match(section('Section -ManagerOnlyUpdate', 'Section -ProductBranding'), /ServerManager\.next[\s\S]*?Rename "\$INSTDIR\\ServerManager" "\$INSTDIR\\ServerManager\.previous"[\s\S]*?Rename "\$INSTDIR\\ServerManager\.next" "\$INSTDIR\\ServerManager"/)
  assert.match(source, /Section "Клієнт HromadaAID" SEC_CLIENT/)
  assert.match(source, /Section "API Server \+ Server Manager \(обов’язковий комплект\)" SEC_SERVER/)
})
