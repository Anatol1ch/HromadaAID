import { bankStatementFileName, statementFileName } from './statement-filenames.js'
import { statementKey, statementPeriodText, statementPlan, validateStatementParameters } from './statement-parameters.js'
import { app, dialog } from 'electron'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { appendFileSync, mkdirSync, copyFileSync, readFileSync, unlinkSync } from 'node:fs'
import { externalExcelScriptPath, StatementExcelError, statementExcelDiagnostic, statementFailure } from './excel-worker.js'
import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { GeneratedStatement, StatementKind } from './api-contract.js'
import { cancelDocumentGeneration, cleanupDocumentTemp, createDocumentDirectory, initializeDocumentTemp, isDocumentTempPath, removeDocumentDirectory, setDocumentWorker } from './document-temp.js'

type Row = Record<string, number | string | null>
type DocumentPath = { excelPath: string; excelName: string; pdfPath?: string; pdfName?: string }
const savedDocuments = new Map<string, DocumentPath>()
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const activeGenerations = new Set<{ cancel: () => void; done: Promise<void> }>()
let shuttingDown = false

function displayDate(iso: string) { return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` }
function safeFileName(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '_').slice(0, 100) || 'Відомість' }
function asMinor(value: unknown) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error('invalid amount'); return number }

function generationFailure(error: unknown, stage: Parameters<typeof statementFailure>[1]) {
  const failure = statementFailure(error, stage)
  const entry = JSON.stringify({ at: new Date().toISOString(), ...failure.diagnostic })
  console.error('[HromadaAid][statements]', entry)
  try {
    const logs = app.getPath('logs')
    mkdirSync(logs, { recursive: true })
    appendFileSync(join(logs, 'statement-export.log'), entry + '\n', 'utf8')
  } catch { /* Diagnostics must never replace the original failure. */ }
  return { ok: false as const, message: failure.message }
}

function socialAidText(shortName: string) {
  let detail = shortName.trim().replace(/\s+/gu, ' ').replace(/^(?:на\s+надання\s+)+/iu, '')
  const modifiers: string[] = []
  let modifier: RegExpMatchArray | null
  while ((modifier = detail.match(/^(щорічна|щорічної|одноразова|одноразової)(?:\s+|$)/iu))) {
    const genitive = modifier[1].toLocaleLowerCase('uk').startsWith('щорічн') ? 'щорічної' : 'одноразової'
    if (!modifiers.includes(genitive)) modifiers.push(genitive)
    detail = detail.slice(modifier[0].length)
  }
  detail = detail.replace(/^(?:(?:матеріальна|матеріальної)\s+)?(?:допомога|допомоги)(?:\s+|$)/iu, '')
  detail = detail.replace(/^[А-ЯІЇЄҐ](?=[а-яіїєґ])/u, (letter) => letter.toLocaleLowerCase('uk'))
  return `на надання ${[...modifiers, 'матеріальної допомоги', detail].filter(Boolean).join(' ')}`
}

function invokeExcel(scriptPath: string, payload: object) {
  if (shuttingDown) return Promise.reject(new Error('Generation shutting down'))
  const directory = dirname((payload as { templatePath: string }).templatePath)
  let cancel = () => {}
  const done = new Promise<void>((resolve, reject) => {
    // The ChildProcess retains Windows' process handle; never terminate by PID/name.
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    let failure: Error | undefined
    let settled = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let finishTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(forceTimer)
      clearTimeout(finishTimer)
      if (error) reject(error); else resolve()
    }
    const stop = (error: Error) => {
      if (settled || failure) return
      failure = error
      try { cancelDocumentGeneration(directory) } catch { /* Never replace the generation error. */ }
      // Give the generator time to reach a cancellation checkpoint and its finally.
      forceTimer = setTimeout(() => {
        if (settled) return
        child.kill()
        // If Windows refuses termination, retain its worker marker and files.
        finishTimer = setTimeout(() => finish(failure), 2000)
      }, 10_000)
    }
    cancel = () => stop(new Error('Generation cancelled during shutdown'))
    const timeout = setTimeout(() => stop(new Error('Excel script timeout')), 120_000)
    child.stdout.resume()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-16_384) })
    child.on('error', () => stop(new Error('Excel engine unavailable')))
    child.stdin.on('error', () => stop(new Error('Excel input unavailable')))
    child.on('close', (code, signal) => {
      try { setDocumentWorker(directory, null) } catch { /* Conservative stale marker is safe. */ }
      finish(failure ?? (code === 0 && !shuttingDown ? undefined : new StatementExcelError(statementExcelDiagnostic(stderr, code, signal))))
    })
    try {
      if (child.pid) setDocumentWorker(directory, child.pid)
      const safeJson = JSON.stringify({ ...payload, cancelPath: join(directory, '.cancel') }).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      child.stdin.end(safeJson, 'ascii')
    } catch { stop(new Error('Excel input unavailable')) }
  })
  const generation = { cancel: () => cancel(), done }
  activeGenerations.add(generation)
  void done.then(() => activeGenerations.delete(generation), () => activeGenerations.delete(generation))
  return done
}

export type StatementDataSource = { readRows: (ids: string[], year: string) => Promise<Row[]>; readBankRows: (ids: string[], year: number) => Promise<Row[]> }
export function registerStatementsIpc(source: StatementDataSource) {
  initializeDocumentTemp()

  ipcMain.handle('statements:generate', async (_event, kindValue: unknown, idsValue: unknown, yearValue: unknown, parametersValue: unknown) => {
    if (shuttingDown) return { ok: false, message: 'Застосунок завершує роботу.' }
    if ((kindValue !== 'personal' && kindValue !== 'summary') || !Array.isArray(idsValue) || idsValue.length < 1 || idsValue.length > 500 || idsValue.some((id) => typeof id !== 'string' || !id)) {
      return { ok: false, message: 'Позначте від одного до 500 призначень.' }
    }
    const year = Number.isInteger(yearValue) && Number(yearValue) >= 2000 && Number(yearValue) <= 2200 ? String(yearValue) : null
    if (!year) return { ok: false, message: 'Оберіть коректний звітний рік.' }
    const kind = kindValue as StatementKind
    const ids = [...new Set(idsValue as string[])]
    const rows = await source.readRows(ids, year)
    if (rows.length !== ids.length) return { ok: false, message: 'Частина призначень недоступна: їх видалено, змінено статус або рік рішення. Оновіть список.' }
    try {
      for (const row of rows) asMinor(row.amount_minor)
    } catch { return { ok: false, message: 'Суми допомог у базі потребують перевірки.' } }

    if (rows.some(row => !row.bank_name || !row.bank_mfo || !row.bank_edrpou)) return { ok: false, message: 'У вибраних отримувачів не обрано банківські реквізити. Доповніть картки перед формуванням відомості.' }
    const grouped = new Map<string, Row[]>()
    for (const row of rows) {
      const group = grouped.get(String(row.aid_type_id)) ?? []
      group.push(row); grouped.set(String(row.aid_type_id), group)
    }
    const parameters = validateStatementParameters(parametersValue, statementPlan(kind, rows.map(row => ({ aidTypeId: String(row.aid_type_id), aidTypeName: String(row.aid_type_name) }))))
    if (!parameters) return { ok: false, message: 'Перевірте номер, дати та період кожної відомості. Якщо склад документів змінився, відкрийте параметри повторно.' }
    const parameterMap = new Map(parameters.map(value => [statementKey(value), value]))
    const templatePath = join(currentDirectory, 'reference', kind === 'personal' ? 'Список.xlsx' : 'Зведений список.xlsx')
    const scriptPath = externalExcelScriptPath(currentDirectory, 'excel-templates.ps1')
    let directory: string | undefined
    let stage: 'temporary-directory' | 'template-copy' | 'worker' | 'pdf-read' = 'temporary-directory'
    const documents: GeneratedStatement[] = []
    try {
      directory = createDocumentDirectory()
      for (const typeRows of grouped.values()) {
        const aidTypeName = String(typeRows[0].aid_type_name)
        const batches = kind === 'personal' ? Array.from({ length: Math.ceil(typeRows.length / 12) }, (_unused, index) => typeRows.slice(index * 12, index * 12 + 12)) : [typeRows]
        for (let index = 0; index < batches.length; index++) {
          const batch = batches[index]
          const parameter = parameterMap.get(statementKey({ aidTypeId: String(batch[0].aid_type_id), partIndex: index }))!
          const id = randomUUID()
          const suffix = kind === 'personal' && batches.length > 1 ? `_${index + 1}` : ''
          const baseName = `${safeFileName(`${kind === 'personal' ? 'Персональна_відомість' : 'Зведений_список'}_${aidTypeName}${suffix}`)}_${id.slice(0, 8)}`
          const xlsxPath = join(directory, `${baseName}.xlsx`)
          const excelExtension = kind === 'personal' ? 'xls' : 'xlsx'
          const excelPath = join(directory, `${baseName}.${excelExtension}`)
          const pdfPath = join(directory, `${baseName}.pdf`)
          stage = 'template-copy'
          copyFileSync(templatePath, xlsxPath)
          stage = 'worker'
          const common = { kind, templatePath: xlsxPath, excelPath, pdfPath, aidTypeName: socialAidText(aidTypeName), periodText: statementPeriodText(parameter), documentNumber: parameter.documentNumber, documentDateDisplay: displayDate(parameter.documentDate) }
          const records = batch.map((row) => ({
            dateDisplay: displayDate(parameter.documentDate),
            amount: Number(row.amount_minor) / 100,
            fullName: [row.last_name, row.first_name, row.patronymic].filter((part) => typeof part === 'string' && part.trim()).join(' '),
            bankAccount: String(row.bank_account ?? ''), bankName: String(row.bank_name ?? ''), bankMfo: String(row.bank_mfo ?? ''), bankEdrpou: String(row.bank_edrpou ?? ''),
            rnokpp: String(row.rnokpp ?? ''), passport: String(row.passport ?? ''), registeredAddress: String(row.registered_address ?? ''),
          }))
          const totalMinor = batch.reduce((sum, row) => sum + asMinor(row.amount_minor), 0)
          if (kind === 'personal') await invokeExcel(scriptPath, { ...common, records })
          else {
            const dailyMap = new Map<string, { count: number; amountMinor: number }>()
            for (const row of batch) {
              const date = parameter.documentDate; const daily = dailyMap.get(date) ?? { count: 0, amountMinor: 0 }
              daily.count++; daily.amountMinor += asMinor(row.amount_minor); dailyMap.set(date, daily)
            }
            const daily = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => ({ dateDisplay: displayDate(parameter.documentDate), count: value.count, amount: value.amountMinor / 100 }))
            await invokeExcel(scriptPath, { ...common, daily })
          }
          if (kind === 'personal') {
            try { unlinkSync(xlsxPath) } catch { /* A locked intermediate remains in the managed job directory until cleanup. */ }
          }
          stage = 'pdf-read'
          const pdfBase64 = readFileSync(pdfPath).toString('base64')
          const excelName = statementFileName(kind, parameter)
          const pdfName = excelName.replace(/\.(?:xls|xlsx)$/, '.pdf')
          savedDocuments.set(id, { excelPath, excelName, pdfPath, pdfName })
          documents.push({ id, fileName: pdfName, aidTypeName, recordCount: batch.length, totalMinor, pdfBase64, documentNumber: parameter.documentNumber, documentDate: parameter.documentDate })
        }
      }
      return { ok: true, documents }
    } catch (error) {
      for (const document of documents) savedDocuments.delete(document.id)
      if (directory) removeDocumentDirectory(directory)
      return generationFailure(error, stage)
    }
  })

  ipcMain.handle('statements:generate-bank', async (_event, idsValue: unknown, yearValue: unknown) => {
    if (shuttingDown) return { ok: false, message: 'Застосунок завершує роботу.' }
    if (!Array.isArray(idsValue) || idsValue.length < 1 || idsValue.length > 500 || idsValue.some((id) => typeof id !== 'string' || !id)) {
      return { ok: false, message: 'Позначте від одного до 500 призначень.' }
    }
    if (!Number.isInteger(yearValue) || Number(yearValue) < 2000 || Number(yearValue) > 2200) {
      return { ok: false, message: 'Оберіть коректний звітний рік.' }
    }
    const excelName = bankStatementFileName()
    const ids = [...new Set(idsValue as string[])]
    const rows = await source.readBankRows(ids, Number(yearValue))
    if (rows.length !== ids.length) return { ok: false, message: 'Частина призначень недоступна: їх видалено, змінено статус або рік рішення. Оновіть список.' }
    const missing = rows.flatMap((row) => {
      const fields = [!String(row.rnokpp ?? '').trim() ? 'РНОКПП' : '', !String(row.bank_account ?? '').trim() ? 'банківський рахунок' : ''].filter(Boolean)
      if (!fields.length) return []
      const name = [row.last_name, row.first_name, row.patronymic].filter(Boolean).join(' ')
      return [`${name}: ${fields.join(', ')}`]
    })
    if (missing.length) return { ok: false, message: `Відомість «ПриватБанк» не сформовано. Заповніть дані в картках отримувачів:\n${missing.join('\n')}` }
    let totalMinor = 0
    try {
      for (const row of rows) totalMinor += asMinor(row.amount_minor)
    } catch { return { ok: false, message: 'Суми допомог у базі потребують перевірки.' } }
    const id = randomUUID()
    let directory: string | undefined
    let stage: 'temporary-directory' | 'template-copy' | 'worker' = 'temporary-directory'
    const fileName = `ПриватБанк_${yearValue}_${id.slice(0, 8)}.xlsx`
    try {
      directory = createDocumentDirectory()
      const excelPath = join(directory, fileName)
      stage = 'template-copy'
      copyFileSync(join(currentDirectory, 'reference', 'ПриватБанк.xlsx'), excelPath)
      stage = 'worker'
      await invokeExcel(externalExcelScriptPath(currentDirectory, 'excel-privatbank.ps1'), {
        templatePath: excelPath,
        paymentPurpose: 'Матеріальна допомога',
        records: rows.map((row) => ({ amount: Number(row.amount_minor) / 100, rnokpp: String(row.rnokpp).trim(), bankAccount: String(row.bank_account).trim() })),
      })
      savedDocuments.set(id, { excelPath, excelName })
      return { ok: true, document: { id, fileName: excelName, recordCount: rows.length, totalMinor } }
    } catch (error) {
      if (directory) removeDocumentDirectory(directory)
      return generationFailure(error, stage)
    }
  })

  ipcMain.handle('statements:save', async (_event, idValue: unknown) => {
    if (typeof idValue !== 'string') return { ok: false, message: 'Файл не знайдено.' }
    const document = savedDocuments.get(idValue)
    if (!document) return { ok: false, message: 'Тимчасовий файл уже очищено. Сформуйте відомість повторно.' }
    try {
      const result = await dialog.showSaveDialog({
        title: 'Зберегти заповнений файл Excel', defaultPath: document.excelName,
        filters: [{ name: extname(document.excelName) === '.xls' ? 'Книга Excel 97–2003' : 'Книга Excel', extensions: [extname(document.excelName).slice(1)] }],
      })
      if (result.canceled || !result.filePath) return { ok: false, message: 'Збереження скасовано.' }
      if (shuttingDown) return { ok: false, message: 'Застосунок завершує роботу.' }
      if (isDocumentTempPath(result.filePath)) return { ok: false, message: 'Оберіть місце поза службовим каталогом тимчасових документів.' }
      if (extname(document.excelName) === '.xls' && extname(result.filePath).toLowerCase() !== '.xls') return { ok: false, message: 'Для персональної відомості оберіть файл із розширенням .xls.' }
      copyFileSync(document.excelPath, result.filePath)
      return { ok: true }
    } catch { return { ok: false, message: 'Не вдалося зберегти Excel-файл.' } }
  })

  ipcMain.handle('statements:save-pdf', async (_event, idValue: unknown) => {
    if (typeof idValue !== 'string') return { ok: false, message: 'Файл не знайдено.' }
    const document = savedDocuments.get(idValue)
    if (!document) return { ok: false, message: 'Тимчасовий файл уже очищено. Сформуйте відомість повторно.' }
    if (!document.pdfPath || !document.pdfName) return { ok: false, message: 'Для банківської відомості доступне збереження лише Excel-файлу.' }
    try {
      const result = await dialog.showSaveDialog({
        title: 'Зберегти сформований PDF', defaultPath: document.pdfName,
        filters: [{ name: 'Документ PDF', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return { ok: false, message: 'Збереження скасовано.' }
      if (shuttingDown) return { ok: false, message: 'Застосунок завершує роботу.' }
      if (isDocumentTempPath(result.filePath)) return { ok: false, message: 'Оберіть місце поза службовим каталогом тимчасових документів.' }
      copyFileSync(document.pdfPath, result.filePath)
      return { ok: true }
    } catch { return { ok: false, message: 'Не вдалося зберегти PDF-файл.' } }
  })
}

export async function cleanupGeneratedStatements() {
  shuttingDown = true
  const generations = [...activeGenerations]
  for (const generation of generations) generation.cancel()
  await Promise.allSettled(generations.map(({ done }) => done))
  savedDocuments.clear()
  cleanupDocumentTemp()
}
