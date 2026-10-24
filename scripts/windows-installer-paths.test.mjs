import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderInstalledServerConfig, renderWinSWConfig, validateInstallerOptions } from '../packaging/windows-installer-config.mjs'
import { prepareServerInstall } from '../packaging/prepare-server-install.mjs'
import { readFile } from 'node:fs/promises'

const volume = () => ({ driveType: 3, fileSystem: 'NTFS', freeBytes: 2_000_000_000 })
const base = (root, mode = 'server-client') => ({
  mode,
  programDirectory: join(root, 'HromadaAID Програма'),
  dataDirectory: join(root, 'Дані HromadaAID'),
  backupDirectory: join(root, 'Резервні копії HromadaAID'),
})

test('installer accepts the three choices and only validates server paths when needed', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const paths = base(root)
    assert.equal(validateInstallerOptions(paths, { inspectVolume: volume }).mode, 'server-client')
    assert.equal(validateInstallerOptions({ ...paths, mode: 'server' }, { inspectVolume: volume }).mode, 'server')
    assert.deepEqual(validateInstallerOptions({ mode: 'client', programDirectory: paths.programDirectory }, { inspectVolume: volume }), {
      mode: 'client', programDirectory: paths.programDirectory,
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('NSIS exposes the three install modes as independent client and server components', async () => {
  const script = (await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')).replace(/^\uFEFF/, '')
  assert.match(script, /Section "Клієнт HromadaAID" SEC_CLIENT/)
  assert.match(script, /Section "Сервер HromadaAID" SEC_SERVER/)
  assert.match(script, /SectionSetFlags \$\{SEC_CLIENT\} \$\{SF_SELECTED\}/)
  assert.match(script, /SectionSetFlags \$\{SEC_SERVER\} 0/)
  assert.match(script, /StrCpy \$ValidationMode "client"/)
  assert.match(script, /StrCpy \$ValidationMode "server-client"/)
  assert.match(script, /-Mode "\$ValidationMode"/)
  assert.match(script, /--package-root "\$INSTDIR\\Server\.next"/)
  assert.match(script, /CLIENT_PAYLOAD_BYTES/)
  assert.match(script, /SERVER_PAYLOAD_BYTES/)
  assert.match(script, /INSTALLER_SUPPORT_BYTES/)
  assert.match(script, /Function DataPage[\s\S]*Call IsServerSelected[\s\S]*FunctionEnd/)
  assert.match(script, /Function BackupPage[\s\S]*Call IsServerSelected[\s\S]*FunctionEnd/)
  assert.match(script, /Page custom AdminSetupPage AdminSetupLeave "Створення адміністратора"/)
  assert.match(script, /SetOutPath "\$INSTDIR\\Server\.next"/)
  assert.ok(script.replace(/^\uFEFF/, '').startsWith('# -*- coding: utf-8 -*-\r\nUnicode true') || script.replace(/^\uFEFF/, '').startsWith('# -*- coding: utf-8 -*-\nUnicode true'))
  assert.match(script, /nsExec::ExecToStack/)
  assert.doesNotMatch(script, /ExecWait/)
  assert.match(script, /Pop \$2[\s\S]*?\$2 == 3[\s\S]*?\$2 == 4[\s\S]*?\$2 == 5[\s\S]*?\$2 == 6/)
  assert.doesNotMatch(script, /ExecWait\s+'[^\r\n]*powershell\.exe/i)
})

test('installer text sources are explicitly UTF-8 and Unicode NSIS is enabled', async () => {
  const scriptBytes = readFileSync(new URL('../packaging/windows-installer.nsi', import.meta.url))
  assert.deepEqual([...scriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  const script = scriptBytes.subarray(3).toString('utf8')
  assert.match(script, /^Unicode true/m)
  assert.match(script, /Клієнт HromadaAID/)
  assert.match(script, /Каталог серверних даних/)
  assert.doesNotMatch(script, /\uFFFD|Рџ|СЂС/)
  const build = readFileSync(new URL('./build-windows-installer.mjs', import.meta.url), 'utf8')
  assert.match(build, /'\/INPUTCHARSET',[\s\S]*?'UTF8'/)
  for (const name of ['admin-setup.ps1', 'install-server-service.ps1', 'windows-service-control.ps1', 'windows-installer-paths.ps1']) {
    const bytes = readFileSync(new URL(`../packaging/${name}`, import.meta.url))
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} must include a UTF-8 BOM for Windows PowerShell 5.1`)
    const text = bytes.subarray(3).toString('utf8')
    assert.doesNotMatch(text, /\uFFFD|Рџ|СЂС/, `${name} contains likely mojibake`)
  }
})

test('NSIS registers and verifies the LocalService WinSW wrapper, preserves user data on uninstall', async () => {
  const script = await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  const serviceControl = await readFile(new URL('../packaging/windows-service-control.ps1', import.meta.url), 'utf8')
  assert.match(script, /install-server-service\.ps1/)
  assert.match(script, /windows-service-control\.ps1/)
  assert.match(installer, /\$Wrapper @\('install'\)/)
  assert.match(installer, /& \$oldWrapper uninstall/)
  assert.doesNotMatch(installer, /\('refresh'\)/)
  assert.match(installer, /\('sidtype', \$serviceName, 'unrestricted'\)/)
  assert.match(installer, /\('start'\)/)
  assert.match(installer, /Status -eq 'Running'/)
  assert.match(installer, /Test-HromadaServiceHealth/)
  assert.match(installer, /installer-preflight\.js/)
  assert.match(installer, /installer-initialization\.js/)
  assert.match(installer, /create-admin\.js/)
  assert.match(installer, /\$adminArguments[\s\S]*Start-Process[\s\S]*-WindowStyle Hidden -Wait -PassThru/)
  assert.match(installer, /Invoke-PackageTransaction \$stagedServer 'prepare'/)
  assert.match(installer, /Invoke-PackageTransaction \$stagedServer 'activate'/)
  assert.match(installer, /verify-server-package\.mjs/)
  assert.match(installer, /Wait-ServiceHealthy/)
  assert.match(installer, /schemaVersion.*oldSchemaMaximum/)
  assert.match(installer, /Server\.previous/)
  assert.match(installer, /NT SERVICE\\HromadaAIDApi/)
  assert.doesNotMatch(installer, /LocalSystem|Everyone:|S-1-1-0/)
  assert.match(script, /-Action uninstall/)
  assert.match(serviceControl, /\$Action -eq 'uninstall'/)
  assert.doesNotMatch(script, /RMDir\s+\/r\s+"\$DataDirectory|RMDir\s+\/r\s+"\$BackupDirectory/)
})

test('server production dependencies deploy only in a disposable isolated workspace', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const deployScript = await readFile(new URL('./deploy-server-package.mjs', import.meta.url), 'utf8')
  assert.match(packageJson.scripts['windows:package'], /deploy-server-package\.mjs/)
  assert.doesNotMatch(packageJson.scripts['windows:package'], /pnpm --filter.*deploy/)
  assert.match(deployScript, /mkdtemp/)
  assert.match(deployScript, /cwd: workspace/)
  assert.match(deployScript, /pnpm\.cmd/)
})

test('package manifest records measured payload and support sizes for pre-copy disk checks', async () => {
  const packager = await readFile(new URL('./package-windows.mjs', import.meta.url), 'utf8')
  const installerBuilder = await readFile(new URL('./build-windows-installer.mjs', import.meta.url), 'utf8')
  assert.match(packager, /const clientBytes = await sumBytes\(clientTarget, clientFiles\)/)
  assert.match(packager, /const serverBytes = await sumBytes\(serverTarget, completeServerFiles\)/)
  assert.match(packager, /cp\(serverSource, join\(serverTarget, 'app'\), \{ recursive: true \}\)/)
  assert.match(packager, /if \(entry\.isSymbolicLink\(\)\)/)
  assert.match(packager, /sizeBytes: clientBytes/)
  assert.match(packager, /sizeBytes: serverBytes/)
  assert.match(packager, /package-integrity\.json/)
  assert.match(packager, /server-package-transaction\.mjs/)
  assert.match(installerBuilder, /CLIENT_PAYLOAD_BYTES/)
  assert.match(installerBuilder, /SERVER_PAYLOAD_BYTES/)
  assert.match(installerBuilder, /INSTALLER_SUPPORT_BYTES/)
})

test('PowerShell path validator skips server data paths for client-only installation', async () => {
  const validator = await readFile(new URL('../packaging/windows-installer-paths.ps1', import.meta.url), 'utf8')
  assert.match(validator, /ValidateSet\('client', 'server', 'server-client'\)/)
  assert.match(validator, /if \(\$Mode -ne 'client'\)/)
  assert.match(validator, /\$paths = @\{ 'програми' = \$ProgramDirectory \}/)
  assert.match(validator, /Add-VolumeRequirement/)
  assert.match(validator, /SupportBytes \+ 8MB/)
  assert.match(validator, /\$requiredText/)
  assert.doesNotMatch(validator, /67108864|64\s*\*\s*1024\s*\*\s*1024/)
  assert.match(validator, /недостатньо місця[\s\S]*exit 3/)
  assert.match(validator, /NTFS[\s\S]*exit 4/)
  assert.match(validator, /server\\\.json\|базу HromadaAID[\s\S]*exit 5/)
})

test('PowerShell preflight accepts Unicode, not-yet-created sibling directories without creating them', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID preflight '))
  const paths = {
    program: join(root, 'Програма'),
    data: join(root, 'Серверні дані'),
    backups: join(root, 'Резервні копії'),
  }
  try {
    const script = fileURLToPath(new URL('../packaging/windows-installer-paths.ps1', import.meta.url))
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Mode', 'server-client', '-ProgramDirectory', paths.program, '-DataDirectory', paths.data,
      '-BackupDirectory', paths.backups, '-ClientBytes', '0', '-ServerBytes', '0', '-SupportBytes', '0',
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    for (const path of Object.values(paths)) assert.equal(existsSync(path), false, `preflight must not create ${path}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server preparation creates new data and backup directories only when installation work begins', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-create-targets-'))
  const options = {
    mode: 'server-client',
    programDirectory: join(root, 'Програма'),
    dataDirectory: join(root, 'Дані'),
    backupDirectory: join(root, 'Копії'),
    packageRoot: join(root, 'Програма', 'Server.next'),
  }
  try {
    assert.equal(existsSync(options.dataDirectory), false)
    assert.equal(existsSync(options.backupDirectory), false)
    prepareServerInstall(options)
    for (const path of [options.dataDirectory, join(options.dataDirectory, 'Database'), join(options.dataDirectory, 'Logs'), options.backupDirectory]) {
      assert.equal(existsSync(path), true, `${path} is created during install preparation`)
    }
    assert.equal(existsSync(join(options.dataDirectory, 'Database', 'hromada-aid.sqlite')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('administrator setup keeps credentials in masked controls and forwards them only through child stdin', async () => {
  const helper = await readFile(new URL('../packaging/admin-setup.ps1', import.meta.url), 'utf8')
  const cli = await readFile(new URL('../server/src/create-admin.ts', import.meta.url), 'utf8')
  assert.match(helper, /UseSystemPasswordChar = \$true/)
  assert.match(helper, /Ім''я користувача/)
  assert.match(helper, /displayName = \$displayName\.Trim\(\)/)
  assert.match(helper, /RedirectStandardInput = \$true/)
  assert.match(helper, /StandardInput\.WriteLine\(\$payload\)/)
  assert.doesNotMatch(helper, /Start-Transcript|Set-Clipboard|Write-Host.*password/i)
  assert.match(cli, /--installer-stdin/)
  assert.match(cli, /createFirstAdministrator\(database, \{ displayName: input\.displayName, username: input\.username, password: input\.password \}\)/)
  assert.match(cli, /input\.password = ''/)
  assert.doesNotMatch(cli, /process\.env\.[A-Z_]*PASSWORD|--password/)
})

test('server activation preserves the old package through health verification and rejects unsafe schema rollback', async () => {
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  const transaction = await readFile(new URL('../packaging/server-package-transaction.mjs', import.meta.url), 'utf8')
  const activation = installer.indexOf("Invoke-PackageTransaction $stagedServer 'activate'")
  const health = installer.indexOf('Wait-ServiceHealthy $healthUrl')
  const commit = installer.indexOf("Invoke-PackageTransaction $activeServer 'healthy'")
  const cleanup = transaction.indexOf("rmSync(join(program, 'Server.previous')")
  assert.ok(activation >= 0 && health > activation && commit > health && cleanup > 0)
  assert.match(installer, /schemaVersion -le \$oldSchemaMaximum/)
  assert.match(installer, /Попередній пакет не запускався/)
  assert.match(transaction, /old-package-preserved|new-package-active|health-check/)
  assert.match(transaction, /journal\.phase !== 'healthy'/)
})

test('installer rejects relative, network, missing-drive, and overlapping directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const paths = base(root)
    assert.throws(() => validateInstallerOptions({ ...paths, dataDirectory: 'relative\\data' }), /абсолютним локальним шляхом/)
    assert.throws(() => validateInstallerOptions({ ...paths, dataDirectory: '\\\\server\\share\\data' }), /абсолютним локальним шляхом/)
    assert.throws(() => validateInstallerOptions(paths, { inspectVolume: () => ({ driveType: 2, fileSystem: 'NTFS', freeBytes: 1e9 }) }), /локальному диску NTFS/)
    assert.throws(() => validateInstallerOptions({ ...paths, backupDirectory: join(paths.programDirectory, 'Backups') }), /не повинні перекриватися/)
    assert.throws(() => validateInstallerOptions({ ...paths, dataDirectory: paths.backupDirectory }), /не повинні перекриватися/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('paths with Unicode and spaces render explicit installed config and WinSW absolute targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  const paths = base(root)
  try {
  const config = JSON.parse(renderInstalledServerConfig(paths))
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.databasePath, win32.join(paths.dataDirectory, 'Database', 'hromada-aid.sqlite'))
  const template = readFileSync(new URL('../server/windows-service/HromadaAIDService.xml.template', import.meta.url), 'utf8')
  const xml = renderWinSWConfig(template, paths)
  assert.ok(xml.includes(`${paths.programDirectory}\\Server\\runtime\\node.exe`))
  assert.ok(xml.includes(`${paths.dataDirectory}\\server.json`))
  assert.doesNotMatch(xml, /__[A-Z_]+__/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an existing database without config is never treated as a fresh install', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const data = join(root, 'data')
    mkdirSync(data)
    writeFileSync(join(data, 'hromada-aid.sqlite'), 'synthetic marker only')
    const paths = { ...base(root), dataDirectory: data, programDirectory: join(root, 'program'), backupDirectory: join(root, 'backups') }
    assert.throws(() => validateInstallerOptions(paths), /без конфігурації/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an existing server config must match the selected persistent paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const data = join(root, 'data'), program = join(root, 'program'), backups = join(root, 'backups')
    mkdirSync(data); mkdirSync(program); mkdirSync(backups)
    writeFileSync(join(data, 'server.json'), JSON.stringify({ databasePath: join(data, 'hromada-aid.sqlite'), backupDirectory: join(root, 'other-backups') }))
    assert.throws(() => validateInstallerOptions({ mode: 'server', programDirectory: program, dataDirectory: data, backupDirectory: backups }), /залиште попередні шляхи/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('existing database and DPAPI key must be present together and legacy database paths are retained', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-state-'))
  try {
    const programDirectory = join(root, 'program'), dataDirectory = join(root, 'data'), backupDirectory = join(root, 'backups')
    mkdirSync(programDirectory); mkdirSync(dataDirectory); mkdirSync(backupDirectory)
    const databasePath = join(dataDirectory, 'hromada-aid.sqlite')
    const configPath = join(dataDirectory, 'server.json')
    writeFileSync(databasePath, 'synthetic database marker')
    writeFileSync(configPath, JSON.stringify({ configVersion: 2, mode: 'local', programDirectory, host: '127.0.0.1', port: 4310, databasePath, backupDirectory }))
    const paths = { mode: 'server', programDirectory, dataDirectory, backupDirectory }
    assert.throws(() => validateInstallerOptions(paths), /повний комплект/)
    writeFileSync(join(backupDirectory, '.hromadaaid-backup-key.dpapi'), 'synthetic protected key marker')
    assert.equal(validateInstallerOptions(paths).mode, 'server')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server preparation writes config and WinSW paths without creating SQLite', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const programDirectory = join(root, 'Програма HromadaAID')
    const dataDirectory = join(root, 'Серверні дані')
    const backupDirectory = join(root, 'Архіви')
    const templateRoot = join(programDirectory, 'Server')
    mkdirSync(join(templateRoot, 'service'), { recursive: true })
    writeFileSync(join(templateRoot, 'service', 'HromadaAIDService.xml.template'), readFileSync(new URL('../server/windows-service/HromadaAIDService.xml.template', import.meta.url), 'utf8'))
    const result = prepareServerInstall({ mode: 'server', programDirectory, dataDirectory, backupDirectory }, templateRoot)
    assert.equal(result.configCreated, true)
    assert.equal(JSON.parse(readFileSync(result.configPath, 'utf8')).databasePath, join(dataDirectory, 'Database', 'hromada-aid.sqlite'))
    assert.equal(existsSync(result.databasePath), false)
    const serviceXml = readFileSync(join(programDirectory, 'Server', 'service', 'HromadaAIDService.xml'), 'utf8')
    assert.ok(serviceXml.includes(join(programDirectory, 'Server', 'runtime', 'node.exe')))
    assert.ok(serviceXml.includes(join(dataDirectory, 'server.json')))
    assert.equal(existsSync(join(backupDirectory, '.hromadaaid-backup-key.dpapi')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server preparation renders WinSW configuration into the staged package, targeting the stable active path', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-stage-'))
  try {
    const programDirectory = join(root, 'Програма HromadaAID')
    const dataDirectory = join(root, 'Дані HromadaAID')
    const backupDirectory = join(root, 'Копії HromadaAID')
    const packageRoot = join(programDirectory, 'Server.next')
    mkdirSync(join(packageRoot, 'service'), { recursive: true })
    writeFileSync(join(packageRoot, 'service', 'HromadaAIDService.xml.template'), readFileSync(new URL('../server/windows-service/HromadaAIDService.xml.template', import.meta.url), 'utf8'))
    prepareServerInstall({ mode: 'server', programDirectory, dataDirectory, backupDirectory, packageRoot }, packageRoot)
    assert.ok(existsSync(join(packageRoot, 'service', 'HromadaAIDService.xml')))
    const xml = readFileSync(join(packageRoot, 'service', 'HromadaAIDService.xml'), 'utf8')
    assert.ok(xml.includes(`${programDirectory}\\Server\\runtime\\node.exe`))
    assert.equal(existsSync(join(programDirectory, 'Server', 'service', 'HromadaAIDService.xml')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
