import { assertStatementSelection, groupStatements, type DocumentKind } from '../shared/statement-groups.js'
import { assertUniqueStatementFileNames, bankStatementFileName, statementFileName } from './statement-filenames.js'
import { statementKey, statementPeriodText, validateStatementParameters } from './statement-parameters.js'
import { app, dialog } from 'electron'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { appendFileSync, mkdirSync, copyFileSync, readFileSync, unlinkSync } from 'node:fs'
import { externalExcelScriptPath, StatementExcelError, statementExcelDiagnostic, statementFailure } from './excel-worker.js'
import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { GeneratedStatement, GeneratedBankStatement, StatementKind } from './api-contract.js'
import { cancelDocumentGeneration, cleanupDocumentTemp, createDocumentDirectory, initializeDocumentTemp, isDocumentTempPath, removeDocumentDirectory, setDocumentWorker } from './document-temp.js'

type Row = Record<string, number | string | null>
type DocumentPath = { excelPath: string; excelName: string; pdfPath?: string; pdfName?: string }
const savedDocuments = new Map<string, DocumentPath>()
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const activeGenerations = new Set<{ cancel: () => void; done: Promise<void> }>()
let shuttingDown = false

function displayDate(iso: string) { return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` }
function safeFileName(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '_').slice(0, 100) || 'Відомість' }

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
function prepareStatementGroups(kind: DocumentKind, rows: Row[], ids: string[], selection: unknown) {
  const normalized = rows.map(row => ({
    id: typeof row.id === 'string' ? row.id : '', aidTypeId: typeof row.aid_type_id === 'string' ? row.aid_type_id : '',
    aidTypeName: String(row.aid_type_name ?? ''), bankId: typeof row.bank_id === 'string' ? row.bank_id : null,
    bankName: typeof row.bank_name === 'string' ? row.bank_name : null,
    amountMinor: typeof row.amount_minor === 'number' ? row.amount_minor : NaN,
    decisionDate: String(row.decision_date ?? ''), createdAt: String(row.created_at ?? ''), source: row,
  }))
  const groups = groupStatements(kind, normalized)
  assertStatementSelection(normalized, ids, selection)
  const required = kind === 'bank' ? ['rnokpp', 'bank_account'] : kind === 'summary' ? ['bank_mfo', 'bank_edrpou'] : ['bank_mfo', 'bank_edrpou', 'bank_account', 'last_name', 'first_name', 'patronymic', 'rnokpp', 'passport', 'registered_address']
  if (rows.some(row => required.some(field => !String(row[field] ?? '').trim()))) throw new Error('У вибраних отримувачів неповні реквізити для цього документа. Доповніть картки й оновіть список.')
  return groups
}

export function registerStatementsIpc(source: StatementDataSource, worker: typeof invokeExcel = invokeExcel) {
  initializeDocumentTemp()

  ipcMain.handle('statements:generate', async (_event, kindValue: unknown, idsValue: unknown, yearValue: unknown, parametersValue: unknown, selectionValue: unknown) => {
    if (shuttingDown) return { ok: false, message: 'Застосунок завершує роботу.' }
    if ((kindValue !== 'personal' && kindValue !== 'summary') || !Array.isArray(idsValue) || idsValue.length < 1 || idsValue.length > 500 || idsValue.some((id) => typeof id !== 'string' || !id)) {
      return { ok: false, message: 'Позначте від одного до 500 призначень.' }
    }
    const year = Number.isInteger(yearValue) && Number(yearValue) >= 2000 && Number(yearValue) <= 2200 ? String(yearValue) : null
    if (!year) return { ok: false, message: 'Оберіть коректний звітний рік.' }
    const kind = kindValue as StatementKind
    const ids = [...new Set(idsValue as string[])]
    let rows: Row[]
    try { rows = await source.readRows(ids, year) }
    catch { return { ok: false, message: 'Не вдалося отримати актуальні дані призначень. Оновіть список і параметри формування.' } }
    let grouped: ReturnType<typeof prepareStatementGroups>
    let parameters: NonNullable<ReturnType<typeof validateStatementParameters>>
    let fileNames: string[]
    try {
      grouped = prepareStatementGroups(kind, rows, ids, selectionValue)
      const validated = validateStatementParameters(parametersValue, grouped)
      if (!validated) throw new Error('Перевірте номер, дати та період кожного документа. Якщо склад змінився, відкрийте параметри повторно.')
      parameters = validated
      const byKey = new Map(parameters.map(value => [statementKey(value), value]))
      fileNames = grouped.map(group => statementFileName(kind, byKey.get(statementKey(group))!, group))
      assertUniqueStatementFileNames(fileNames)
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Перевірте параметри формування.' } }
    const parameterMap = new Map(parameters.map(value => [statementKey(value), value]))
    const templatePath = join(currentDirectory, 'reference', kind === 'personal' ? 'Список.xlsx' : 'Зведений список.xlsx')
    const scriptPath = externalExcelScriptPath(currentDirectory, 'excel-templates.ps1')
    let directory: string | undefined
    let stage: 'temporary-directory' | 'template-copy' | 'worker' | 'pdf-read' = 'temporary-directory'
    const documents: GeneratedStatement[] = []
    try {
      directory = createDocumentDirectory()
      for (const [groupIndex, group] of grouped.entries()) {
        const batch = group.rows.map(row => row.source)
        const aidTypeName = group.aidTypeName
        const parameter = parameterMap.get(statementKey(group))!
        const id = randomUUID()
        const suffix = `_${group.partIndex + 1}`
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
        const totalMinor = group.totalMinor
        if (kind === 'personal') await worker(scriptPath, { ...common, records })
        else await worker(scriptPath, { ...common, daily: [{ dateDisplay: displayDate(parameter.documentDate), count: group.recordCount, amount: totalMinor / 100 }] })
        if (kind === 'personal') {
          try { unlinkSync(xlsxPath) } catch { /* A locked intermediate remains in the managed job directory until cleanup. */ }
        }
        stage = 'pdf-read'
        const pdfBase64 = readFileSync(pdfPath).toString('base64')
        const excelName = fileNames[groupIndex]
        const pdfName = excelName.replace(/\.(?:xls|xlsx)$/, '.pdf')
        savedDocuments.set(id, { excelPath, excelName, pdfPath, pdfName })
        documents.push({ id, fileName: pdfName, aidTypeName, bankId: group.bankId, bankName: group.bankName, recordCount: batch.length, totalMinor, pdfBase64, documentNumber: parameter.documentNumber, documentDate: parameter.documentDate })
      }
      return { ok: true, documents }
    } catch (error) {
      for (const document of documents) savedDocuments.delete(document.id)
      if (directory) removeDocumentDirectory(directory)
      return generationFailure(error, stage)
    }
  })

  ipcMain.handle('statements:generate-bank', async (_event, idsValue: unknown, yearValue: unknown, selectionValue: unknown) => {
    if (shuttingDown) return { ok: false, message: 'Застосунок завершує роботу.' }
    if (!Array.isArray(idsValue) || idsValue.length < 1 || idsValue.length > 500 || idsValue.some((id) => typeof id !== 'string' || !id)) {
      return { ok: false, message: 'Позначте від одного до 500 призначень.' }
    }
    if (!Number.isInteger(yearValue) || Number(yearValue) < 2000 || Number(yearValue) > 2200) {
      return { ok: false, message: 'Оберіть коректний звітний рік.' }
    }
    const ids = [...new Set(idsValue as string[])]
    let rows: Row[]
    try { rows = await source.readBankRows(ids, Number(yearValue)) }
    catch { return { ok: false, message: 'Не вдалося отримати актуальні дані призначень. Оновіть список і параметри формування.' } }
    let groups: ReturnType<typeof prepareStatementGroups>
    let fileNames: string[]
    try {
      groups = prepareStatementGroups('bank', rows, ids, selectionValue)
      const date = new Date()
      fileNames = groups.map(group => bankStatementFileName(date, group))
      assertUniqueStatementFileNames(fileNames)
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Перевірте параметри формування.' } }
    const documents: GeneratedBankStatement[] = []
    let directory: string | undefined
    let stage: 'temporary-directory' | 'template-copy' | 'worker' = 'temporary-directory'
    try {
      directory = createDocumentDirectory()
      for (const [index, group] of groups.entries()) {
        const id = randomUUID()
        const excelPath = join(directory, `bank_${id}.xlsx`)
        stage = 'template-copy'
        copyFileSync(join(currentDirectory, 'reference', 'ПриватБанк.xlsx'), excelPath)
        stage = 'worker'
        await worker(externalExcelScriptPath(currentDirectory, 'excel-privatbank.ps1'), {
          templatePath: excelPath, paymentPurpose: 'Матеріальна допомога',
          records: group.rows.map(({ source: row }) => ({ amount: Number(row.amount_minor) / 100, rnokpp: String(row.rnokpp).trim(), bankAccount: String(row.bank_account).trim() })),
        })
        const excelName = fileNames[index]
        savedDocuments.set(id, { excelPath, excelName })
        documents.push({ id, fileName: excelName, bankId: group.bankId, bankName: group.bankName, recordCount: group.recordCount, totalMinor: group.totalMinor })
      }
      return { ok: true, documents }
    } catch (error) {
      for (const document of documents) savedDocuments.delete(document.id)
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
        title: 'Зберегти заповнений файл Excel', defaultPath: document.excelName, properties: ['showOverwriteConfirmation'],
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
        title: 'Зберегти сформований PDF', defaultPath: document.pdfName, properties: ['showOverwriteConfirmation'],
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
