import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const installer = readFileSync('packaging/windows-installer.nsi', 'utf8')
const section = (start, end) => installer.slice(installer.indexOf(start), installer.indexOf(end, installer.indexOf(start)))
const state = section('Function SetStandardWelcomeContext', 'Function WelcomePageCreate')
const welcome = section('Function WelcomePageCreate', 'Function FinishPagePre')
const init = section('Function .onInit', 'Function un.onInit')

test('manual setup shows Welcome before component choice and keeps the existing page sequence', () => {
  const welcomePage = installer.indexOf('Page custom WelcomePageCreate')
  const componentPage = installer.indexOf('Page custom ModePageCreate ModePageLeave')
  assert.ok(welcomePage >= 0 && welcomePage < componentPage)
  assert.ok(componentPage < installer.indexOf('!insertmacro MUI_PAGE_DIRECTORY'))
  assert.ok(installer.indexOf('!insertmacro MUI_PAGE_DIRECTORY') < installer.indexOf('!insertmacro MUI_PAGE_INSTFILES'))
  assert.ok(installer.indexOf('!insertmacro MUI_PAGE_INSTFILES') < installer.indexOf('!insertmacro MUI_PAGE_FINISH'))
  assert.match(installer, /Page custom ModePageCreate ModePageLeave "Вибір компонентів"/)
})

test('regular welcome distinguishes only clean, complete registered, and unknown or partial states', () => {
  assert.match(init, /Call SetStandardWelcomeContext[\s\S]*?GetOptions/)
  assert.match(state, /StrCpy \$WelcomeHeader "HromadaAID – майстер встановлення"[\s\S]*?Не вдалося достовірно визначити стан/)
  assert.match(state, /ReadRegStr \$InstalledComponents HKLM "Software\\HromadaAID\\Installer" "InstalledComponents"/)
  assert.match(state, /StrCmp \$InstalledComponents "" welcomeContextClean/)
  assert.match(state, /StrCmp \$InstalledComponents "Client" welcomeContextClient/)
  assert.match(state, /StrCmp \$InstalledComponents "Server,ServerManager" welcomeContextServer/)
  assert.match(state, /StrCmp \$InstalledComponents "Client,Server,ServerManager" welcomeContextCombined/)
  assert.match(state, /welcomeContextClean:[\s\S]*?Встановлення HromadaAID[\s\S]*?Майстер допоможе встановити необхідні компоненти HromadaAID на цей комп'ютер\./)
  assert.match(state, /welcomeContextClient:[\s\S]*?Client\\HromadaAID\.exe[\s\S]*?welcomeContextServer/)
  assert.match(state, /welcomeContextServer:[\s\S]*?ServerManager\\HromadaAID Server Manager\.exe[\s\S]*?Server\\service\\HromadaAIDService\.exe[\s\S]*?welcomeContextCombined/)
  assert.match(state, /welcomeContextCombined:[\s\S]*?Client\\HromadaAID\.exe[\s\S]*?ServerManager\\HromadaAID Server Manager\.exe[\s\S]*?Server\\service\\HromadaAIDService\.exe[\s\S]*?welcomeContextInstalled/)
  assert.match(state, /welcomeContextInstalled:[\s\S]*?Обслуговування HromadaAID[\s\S]*?На цьому комп'ютері вже встановлено компоненти HromadaAID\. Ви можете оновити їх або змінити склад встановлення\./)
  assert.doesNotMatch(state, /InstallVersion|DisplayVersion|GetDLLVersion|FileGetVersion/)
})

test('selective update welcome uses the current Setup version and names the correct component', () => {
  assert.match(init, /clientUpdateTargetExists:[\s\S]*?Оновлення HromadaAID Client[\s\S]*?до версії \$\{APP_VERSION\}\.[\s\S]*?client-update-success\.txt/)
  assert.match(init, /managerUpdateTargetExists:[\s\S]*?Оновлення HromadaAID Server Manager[\s\S]*?до версії \$\{APP_VERSION\}\.[\s\S]*?managerPreviousPresent/)
  assert.doesNotMatch(welcome, /ClientUpdateMode|ManagerUpdateMode/)
})

test('both selective update modes still bypass Components and ordinary directory selection', () => {
  const modePage = section('Function ModePageCreate', 'Function SelectClientMode')
  const directoryPre = section('Function DirectoryPagePre', 'Function ModePageLeave')
  assert.match(modePage, /ClientUpdateMode == "1"[\s\S]*?ManagerUpdateMode == "1"[\s\S]*?Abort[\s\S]*?nsDialogs::Create/)
  assert.match(directoryPre, /ManagerUpdateMode == "1"[\s\S]*?Abort/)
  assert.match(directoryPre, /ClientUpdateMode == "1"[\s\S]*?Call SummaryLeave[\s\S]*?Abort/)
  assert.match(init, /SectionSetFlags \$\{SEC_CLIENT\} \$\{SF_SELECTED\}[\s\S]*?SectionSetFlags \$\{SEC_SERVER\} 0[\s\S]*?Goto initDone/)
})

test('welcome initialization does not reset component choices or alter installer operations', () => {
  assert.doesNotMatch(state, /SectionSetFlags|WriteReg|DeleteReg|File \/r|Rename |RMDir|ExecToLog|ExecToStack/)
  assert.doesNotMatch(welcome, /SectionSetFlags|WriteReg|DeleteReg|File \/r|Rename |RMDir|ExecToLog|ExecToStack/)
  assert.match(section('Function ModePageLeave', 'Function SetStandardWelcomeContext'), /SectionSetFlags \$\{SEC_CLIENT\}[\s\S]*?SectionSetFlags \$\{SEC_SERVER\}[\s\S]*?Call SummaryLeave/)
  assert.match(installer, /Section -RemoveDeselected[\s\S]*?ClientUpdateMode == "1"[\s\S]*?ManagerUpdateMode == "1"[\s\S]*?Goto removeDeselectedDone/)
  assert.match(installer, /Section -UninstallMetadata[\s\S]*?InstalledComponents[\s\S]*?client-update-success\.txt[\s\S]*?manager-update-success\.txt/)
})

test('finish success requires the final installation section and keeps launch/marker ownership unchanged', () => {
  assert.match(init, /StrCpy \$InstallCompleted "0"/)
  assert.equal((installer.match(/StrCpy \$InstallCompleted "1"/g) ?? []).length, 1)
  assert.match(installer, /updateMetadataDone:\s*;[^\r\n]*\r?\n\s*StrCpy \$InstallCompleted "1"\s*SectionEnd/)
  const finish = section('Function FinishPagePre', 'Function .onGUIEnd')
  assert.match(finish, /\$InstallCompleted != "1"[\s\S]*?Abort/)
  assert.match(finish, /ClientUpdateMode == "1"[\s\S]*?Client оновлено[\s\S]*?ManagerUpdateMode == "1"[\s\S]*?Server Manager оновлено/)
  assert.doesNotMatch(finish, /FileWrite|FileOpen|WriteReg|Exec(?:Shell|Wait)? |Rename |RMDir/)
})
