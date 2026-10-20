import { app, BrowserWindow, type WebContents, dialog } from 'electron'
import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isReportPdfKind, reportPdfFileName } from './report-filenames.js'
import { reportTitle } from './report-data.js'
import { cleanupReportExcel, ReportExcelError, writeReportExcel } from './report-excel.js'
import { createDocumentDirectory, initializeDocumentTemp, isDocumentTempPath, removeDocumentDirectory } from './document-temp.js'
import type { ReportExportSnapshot } from './api-contract.js'
import { trustedIpcMain as ipcMain } from './ipc-security.js'

type Document = { owner: number; snapshot: ReportExportSnapshot; pdf: Buffer; fileName: string }
const documents = new Map<string, Document>()
const busy = new Set<number>()
const watched = new Set<number>()
let stopping = false

function readSnapshot(value: unknown): ReportExportSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Некоректні параметри звіту.')
  const data = value as ReportExportSnapshot
  const summary = data.summary
  const integers = (values: unknown[]) => values.every(value => Number.isSafeInteger(value))
  if (!isReportPdfKind(data.kind) || typeof data.periodRange !== 'string' || !data.periodRange || !summary || !integers([summary.year]) || !Array.isArray(summary.rows) || typeof summary.periodLabel !== 'string') throw new Error('Некоректні дані звіту.')
  const expectedKind = data.kind === 'cumulative' ? 'year-to-date' : data.kind
  if (data.period?.kind !== expectedKind) throw new Error('Період не відповідає типу звіту.')
  if (summary.programs && (!Array.isArray(summary.programs) || summary.programs.some(program => typeof program.id !== 'string' || typeof program.officialName !== 'string' || typeof program.shortName !== 'string'))) throw new Error('Некоректний перелік програм.')
  for (const row of summary.rows) {
    if (!row || typeof row.aidTypeId !== 'string' || typeof row.officialName !== 'string' || typeof row.programOfficialName !== 'string' || (row.programId !== undefined && typeof row.programId !== 'string') || !integers([row.assignmentCount, row.amountMinor, row.paidCount, row.paidAmountMinor, row.plannedRecipientCount ?? 0, row.plannedAmountMinor ?? 0])) throw new Error('Некоректний рядок звіту.')
  }
  return structuredClone(data)
}
function watchOwner(sender: WebContents) {
  if (watched.has(sender.id)) return
  watched.add(sender.id)
  const clear = () => { for (const [id, document] of documents) if (document.owner === sender.id) documents.delete(id) }
  sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) clear() })
  sender.once('destroyed', () => { clear(); watched.delete(sender.id) })
}
function ownedDocument(sender: WebContents, id: unknown) {
  const document = typeof id === 'string' ? documents.get(id) : undefined
  if (!document || document.owner !== sender.id) throw new Error('Документ недоступний. Сформуйте звіт повторно.')
  return document
}
export async function cleanupGeneratedReports() {
  stopping = true; documents.clear()
  await cleanupReportExcel()
}

async function logExcelFailure(error: unknown, ipcStage: string) {
  const details = error instanceof ReportExcelError ? error.diagnostic : {
    stage: ipcStage, code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'REPORT_EXPORT_FAILED',
    message: 'Report export filesystem or IPC operation failed',
  }
  const entry = JSON.stringify({ at: new Date().toISOString(), ipcStage, ...details })
  console.error('[HromadaAid][reports.xlsx]', entry)
  try {
    const logs = app.getPath('logs')
    await mkdir(logs, { recursive: true })
    await appendFile(join(logs, 'report-export.log'), entry + '\n', 'utf8')
  } catch { console.warn('[HromadaAid][reports.xlsx] Не вдалося записати діагностичний журнал.') }
}

function excelFailureMessage(error: unknown, ipcStage: string) {
  const detail = error instanceof ReportExcelError ? error.diagnostic : null
  if (detail?.code === 'HROMADA_EXCEL_UNAVAILABLE') return 'Microsoft Excel не встановлений або COM недоступний. PDF і друк залишаються доступними.'
  if (detail?.code === 'HROMADA_REPORT_TIMEOUT') return 'Excel не завершив експорт вчасно. Повторіть спробу. PDF і друк залишаються доступними.'
  const stages: Record<string, string> = { input: 'читання даних звіту', 'excel-start': 'запуск Microsoft Excel', 'workbook-create': 'створення книги', 'document-heading': 'заповнення заголовка', 'table-heading': 'оформлення таблиці', 'row-label': 'заповнення назв', 'number-format': 'форматування числових комірок', 'number-value': 'запис числових значень', 'row-layout': 'форматування рядків', 'column-fit': 'підбір ширини колонок', 'page-setup': 'налаштування друку', 'save-xlsx': 'збереження книги XLSX', 'close-workbook': 'завершення роботи з книгою', 'copy-output': 'запис файлу у вибрану папку', 'temporary-directory': 'підготовка тимчасового файлу' }
  const stage = stages[detail?.stage ?? ipcStage]
  return stage ? `Не вдалося експортувати Excel: ${stage}. Повторіть спробу; технічну причину записано в журнал. PDF і друк залишаються доступними.` : 'Не вдалося зберегти Excel. Технічну причину записано в журнал. PDF і друк залишаються доступними.'
}

export function registerReportExportIpc() {
  initializeDocumentTemp()
  ipcMain.handle('reports:generate', async (event, value: unknown) => {
    const ownerId = event.sender.id
    if (stopping || busy.has(ownerId)) return { ok: false, message: 'Зачекайте завершення поточної операції.' }
    busy.add(ownerId)
    try {
      const snapshot = readSnapshot(value)
      watchOwner(event.sender)
      // Capture the existing, committed report-paper with its unchanged print styles.
      const pdf = await event.sender.printToPDF({ pageSize: 'A4', landscape: false, printBackground: true, preferCSSPageSize: true })
      if (event.sender.isDestroyed() || stopping) return { ok: false, message: 'Формування звіту скасовано.' }
      const id = randomUUID()
      documents.set(id, { owner: ownerId, snapshot, pdf, fileName: reportPdfFileName(snapshot.kind) })
      return { ok: true, document: { id, pdfBase64: pdf.toString('base64'), title: reportTitle(snapshot.kind), periodRange: snapshot.periodRange } }
    } catch { return { ok: false, message: 'Не вдалося сформувати PDF звіту. Повторіть спробу.' } }
    finally { busy.delete(ownerId) }
  })
  for (const format of ['pdf', 'excel'] as const) ipcMain.handle(`reports:save-${format}`, async (event, id: unknown) => {
    const ownerId = event.sender.id
    if (stopping || busy.has(ownerId)) return { ok: false, message: 'Зачекайте завершення поточної операції.' }
    busy.add(ownerId)
    let directory: string | undefined
    let stage = 'document-lookup'
    try {
      const document = ownedDocument(event.sender, id)
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner) throw new Error('Вікно звіту недоступне.')
      const extension = format === 'pdf' ? 'pdf' : 'xlsx'
      stage = 'save-dialog'
      const result = await dialog.showSaveDialog(owner, { title: format === 'pdf' ? 'Зберегти звіт PDF' : 'Зберегти звіт Excel', defaultPath: document.fileName.replace(/\.pdf$/, `.${extension}`), filters: [{ name: format === 'pdf' ? 'PDF' : 'Excel', extensions: [extension] }] })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      if (isDocumentTempPath(result.filePath)) return { ok: false, message: 'Оберіть папку поза тимчасовим сховищем застосунку.' }
      if (format === 'pdf') await writeFile(result.filePath, document.pdf)
      else {
        stage = 'temporary-directory'
        directory = createDocumentDirectory()
        stage = 'excel-worker'
        await writeReportExcel(document.snapshot, directory)
        stage = 'copy-output'
        await copyFile(join(directory, 'report.xlsx'), result.filePath)
      }
      return { ok: true }
    } catch (error) {
      if (format === 'excel') {
        await logExcelFailure(error, stage)
        return { ok: false, message: excelFailureMessage(error, stage) }
      }
      return { ok: false, message: 'Не вдалося зберегти PDF. Повторіть спробу.' }
    } finally { if (directory) removeDocumentDirectory(directory); busy.delete(ownerId) }
  })
  ipcMain.handle('reports:release', (event, id: unknown) => {
    if (typeof id === 'string' && !busy.has(event.sender.id) && documents.get(id)?.owner === event.sender.id) documents.delete(id)
  })
}
