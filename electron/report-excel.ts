import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { externalExcelScriptPath } from './excel-worker.js'
import { cancelDocumentGeneration, setDocumentWorker } from './document-temp.js'
import { reportBudgetCode, reportGroups, reportInstitution, reportNumbers, reportTitle, reportTotals } from './report-data.js'
import type { ReportExportSnapshot } from './api-contract.js'

export type ReportExcelDiagnostic = { stage: string; code: string; message: string; exitCode: number | null; signal: string | null; errorType?: string; hresult?: number; line?: number }
export class ReportExcelError extends Error {
  constructor(readonly diagnostic: ReportExcelDiagnostic) { super(diagnostic.code); this.name = 'ReportExcelError' }
}

/** Accept only the script's bounded, non-sensitive diagnostic protocol. Never log raw stderr. */
function diagnostic(error: Error, stderr: string, exitCode: number | null, signal: string | null): ReportExcelDiagnostic {
  let result: ReportExcelDiagnostic = { stage: 'worker', code: 'HROMADA_REPORT_EXCEL_FAILED', message: 'Excel export process failed', exitCode, signal }
  for (const line of stderr.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      if (value.kind !== 'HROMADA_REPORT_EXCEL_ERROR' || typeof value.stage !== 'string' || !/^[a-z-]{1,40}$/.test(value.stage)) continue
      result.stage = value.stage
      if (typeof value.code === 'string' && /^HROMADA_[A-Z_]+$/.test(value.code)) result.code = value.code
      // These messages contain properties/types only, never workbook contents or paths.
      if (typeof value.message === 'string' && /^(?:PowerShell\/Excel operation failed|Excel COM activation failed|Export cancelled|Specified cast is not valid\.|Unable to set the [A-Za-z]+ property of the [A-Za-z]+ class|Exception from HRESULT: 0x[0-9A-Fa-f]{8})$/.test(value.message)) result.message = value.message
      if (typeof value.errorType === 'string' && /^[A-Za-z.]{1,120}$/.test(value.errorType)) result.errorType = value.errorType
      if (typeof value.hresult === 'number' && Number.isInteger(value.hresult)) result.hresult = value.hresult
      if (typeof value.line === 'number' && Number.isInteger(value.line)) result.line = value.line
    } catch { /* A parser/host stack trace is deliberately not forwarded to logs or UI. */ }
  }
  for (const code of ['HROMADA_EXCEL_UNAVAILABLE', 'HROMADA_REPORT_TIMEOUT', 'HROMADA_REPORT_CANCELLED']) if (error.message.includes(code)) result.code = code
  return result
}

const active = new Set<{ cancel: () => void; done: Promise<void> }>()
let stopping = false

export async function cleanupReportExcel() {
  stopping = true
  for (const worker of active) worker.cancel()
  await Promise.allSettled([...active].map(worker => worker.done))
}

/** Excel receives precomputed rows; PowerShell only writes values and formatting. */
export function writeReportExcel(snapshot: ReportExportSnapshot, directory: string): Promise<void> {
  if (stopping) return Promise.reject(new Error('HROMADA_REPORT_CANCELLED'))
  const cumulative = snapshot.kind === 'cumulative'
  const cells = (values: number[]) => cumulative ? values : values.slice(2, 4)
  const rows: { kind: string; label: string; values: number[] }[] = []
  for (const group of reportGroups(snapshot.summary)) {
    rows.push({ kind: 'program', label: group.name, values: cells(reportTotals(group.rows)) })
    for (const row of group.rows) rows.push({ kind: 'aid', label: row.officialName, values: cells(reportNumbers(row)) })
  }
  rows.push({ kind: 'total', label: 'Загальний підсумок', values: cells(reportTotals(snapshot.summary.rows)) })
  const payload = { cumulative, institution: reportInstitution.toLocaleUpperCase('uk'), title: reportTitle(snapshot.kind).toLocaleUpperCase('uk'), code: reportBudgetCode.toLocaleUpperCase('uk'), period: snapshot.periodRange, rows, excelPath: join(directory, 'report.xlsx'), cancelPath: join(directory, '.cancel') }
  let cancel = () => {}
  const done = new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', externalExcelScriptPath(dirname(fileURLToPath(import.meta.url)), 'excel-report.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = '', failure: Error | undefined, settled = false
    let exitCode: number | null = null, exitSignal: string | null = null
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let finishTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(finishTimer)
      if (error) reject(new ReportExcelError(diagnostic(error, stderr, exitCode, exitSignal))); else resolve()
    }
    const stop = (error: Error) => {
      if (settled || failure) return
      failure = error
      try { cancelDocumentGeneration(directory) } catch { /* Keep the original failure. */ }
      forceTimer = setTimeout(() => {
        if (settled) return
        child.kill()
        finishTimer = setTimeout(() => finish(failure), 2000)
      }, 10_000)
    }
    cancel = () => stop(new Error('HROMADA_REPORT_CANCELLED'))
    const timer = setTimeout(() => stop(new Error('HROMADA_REPORT_TIMEOUT')), 120_000)
    child.stdout.resume(); child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-16_384) })
    child.on('error', () => stop(new Error('HROMADA_EXCEL_UNAVAILABLE')))
    child.stdin.on('error', () => stop(new Error('HROMADA_EXCEL_UNAVAILABLE')))
    child.on('close', (code, signal) => {
      exitCode = code; exitSignal = signal
      try { setDocumentWorker(directory, null) } catch { /* Preserve cleanup ownership. */ }
      finish(failure ?? (code === 0 ? undefined : new Error(stderr || 'HROMADA_REPORT_EXCEL_FAILED')))
    })
    try {
      if (child.pid) setDocumentWorker(directory, child.pid)
      const json = JSON.stringify(payload).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      child.stdin.end(json, 'ascii')
    } catch { stop(new Error('HROMADA_EXCEL_UNAVAILABLE')) }
  })
  const worker = { cancel: () => cancel(), done }
  active.add(worker)
  void done.then(() => active.delete(worker), () => active.delete(worker))
  return done
}
