import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
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
  const script = await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
  assert.match(script, /Section "Клієнт HromadaAID" SEC_CLIENT/)
  assert.match(script, /Section "Сервер HromadaAID" SEC_SERVER/)
  assert.match(script, /SectionSetFlags \$\{SEC_CLIENT\} \$\{SF_SELECTED\}/)
  assert.match(script, /SectionSetFlags \$\{SEC_SERVER\} 0/)
  assert.match(script, /StrCpy \$ValidationMode "client"/)
  assert.match(script, /StrCpy \$ValidationMode "server-client"/)
  assert.match(script, /-Mode "\$ValidationMode"/)
  assert.match(script, /--package-root "\$INSTDIR\\Server"/)
  assert.match(script, /Function DataPage[\s\S]*Call IsServerSelected[\s\S]*FunctionEnd/)
  assert.match(script, /Function BackupPage[\s\S]*Call IsServerSelected[\s\S]*FunctionEnd/)
})

test('NSIS registers and verifies the LocalService WinSW wrapper, preserves user data on uninstall', async () => {
  const script = await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  const serviceControl = await readFile(new URL('../packaging/windows-service-control.ps1', import.meta.url), 'utf8')
  assert.match(script, /install-server-service\.ps1/)
  assert.match(script, /windows-service-control\.ps1/)
  assert.match(installer, /\('install'\)/)
  assert.match(installer, /\('uninstall'\)/)
  assert.doesNotMatch(installer, /\('refresh'\)/)
  assert.match(installer, /\('sidtype', \$serviceName, 'unrestricted'\)/)
  assert.match(installer, /\('start'\)/)
  assert.match(installer, /Status -eq 'Running'/)
  assert.match(installer, /Test-HromadaServiceHealth/)
  assert.match(installer, /RESTORE_MAINTENANCE/)
  assert.match(installer, /installer-preflight\.js/)
  assert.match(installer, /installer-initialization\.js/)
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

test('PowerShell path validator skips server data paths for client-only installation', async () => {
  const validator = await readFile(new URL('../packaging/windows-installer-paths.ps1', import.meta.url), 'utf8')
  assert.match(validator, /ValidateSet\('client', 'server', 'server-client'\)/)
  assert.match(validator, /if \(\$Mode -ne 'client'\)/)
  assert.match(validator, /\$paths = @\{ 'програми' = \$ProgramDirectory \}/)
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
