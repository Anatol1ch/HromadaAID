import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, lstatSync } from 'node:fs'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderInstalledServerConfig, renderWinSWConfig, validateInstallerOptions } from './windows-installer-config.mjs'

function parseArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!key?.startsWith('--') || !value || values.has(key)) throw new Error('Очікуються --program-dir, --data-dir і --backup-dir з окремими значеннями.')
    values.set(key, value)
  }
  for (const key of ['--program-dir', '--data-dir', '--backup-dir']) if (!values.has(key)) throw new Error(`Не задано параметр ${key}.`)
  return {
    mode: 'server',
    programDirectory: values.get('--program-dir'),
    dataDirectory: values.get('--data-dir'),
    backupDirectory: values.get('--backup-dir'),
  }
}

export function prepareServerInstall(options, root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const valid = validateInstallerOptions(options)
  if (valid.mode === 'client') return { configured: false }

  const serverConfigPath = join(valid.dataDirectory, 'server.json')
  const databasePath = join(valid.dataDirectory, 'hromada-aid.sqlite')
  const existed = existsSync(serverConfigPath)
  const serviceDirectory = join(valid.programDirectory, 'Server', 'service')
  const sourceTemplate = join(root, 'server', 'windows-service', 'HromadaAIDService.xml.template')
  const packagedTemplate = join(root, 'service', 'HromadaAIDService.xml.template')
  const templatePath = existsSync(sourceTemplate) ? sourceTemplate : packagedTemplate
  if (!existsSync(templatePath)) throw new Error('Шаблон конфігурації WinSW не знайдено; каталог даних не змінено.')
  const renderedXml = renderWinSWConfig(readFileSync(templatePath, 'utf8'), valid)
  if (existed) {
    const existing = JSON.parse(readFileSync(serverConfigPath, 'utf8'))
    if (win32.resolve(existing.programDirectory).toLocaleLowerCase('en-US') !== win32.resolve(valid.programDirectory).toLocaleLowerCase('en-US')) {
      throw new Error('Наявний server.json прив’язаний до іншого каталогу програми; автоматичне переміщення конфігурації заборонено.')
    }
  } else if (existsSync(databasePath)) {
    throw new Error('Знайдено SQLite без server.json. Конфігурацію не створено, щоб не підмінити наявні дані.')
  }

  mkdirSync(valid.dataDirectory, { recursive: true })
  mkdirSync(valid.backupDirectory, { recursive: true })
  mkdirSync(join(valid.dataDirectory, 'Logs'), { recursive: true })
  const config = renderInstalledServerConfig(valid)
  if (!existed) {
    let descriptor
    try { descriptor = openSync(serverConfigPath, 'wx', 0o600) }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('server.json з’явився під час встановлення; файл не перезаписано.')
      throw new Error('Не вдалося створити server.json у вибраному каталозі даних.')
    }
    try { writeFileSync(descriptor, config, 'utf8') } finally { closeSync(descriptor) }
  }

  const serviceXmlPath = join(serviceDirectory, 'HromadaAIDService.xml')
  mkdirSync(serviceDirectory, { recursive: true })
  if (!existsSync(serviceXmlPath)) writeFileSync(serviceXmlPath, renderedXml, { flag: 'wx', encoding: 'utf8' })
  else if (!lstatSync(serviceXmlPath).isFile()) throw new Error('Конфігурація WinSW не є звичайним файлом.')

  return { configured: true, configCreated: !existed, configPath: serverConfigPath, databasePath }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const packagedRoot = join(options.programDirectory, 'Server', 'app')
    const result = prepareServerInstall(options, packagedRoot)
    if (result.configured) console.log(`Параметри сервера підготовлено: ${result.configPath}. SQLite не створювалася.`)
  } catch (error) {
    console.error(`Не вдалося підготувати параметри сервера: ${error instanceof Error ? error.message : 'перевірте вибрані каталоги та наявні дані.'}`)
    process.exitCode = 1
  }
}
