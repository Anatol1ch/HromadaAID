import { join } from 'node:path'

/** External programs cannot read Electron's virtual app.asar filesystem. */
export function externalExcelScriptPath(directory: string, name: 'excel-templates.ps1' | 'excel-privatbank.ps1' | 'excel-report.ps1'): string {
  return join(directory, name).replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2')
}

const stages = ['input', 'template-check', 'drawing-init', 'excel-start', 'workbook-open', 'fill-template', 'workbook-save', 'xls-save', 'pdf-export', 'workbook-close', 'worker', 'temporary-directory', 'template-copy', 'pdf-read'] as const
type Stage = typeof stages[number]
export type StatementExcelDiagnostic = { stage: Stage; code: string; exitCode: number | null; signal: string | null; errorType?: string; hresult?: number; line?: number }
export class StatementExcelError extends Error {
  constructor(readonly diagnostic: StatementExcelDiagnostic) { super(diagnostic.code); this.name = 'StatementExcelError' }
}

/** Never expose raw PowerShell messages, workbook contents or file paths. */
export function statementExcelDiagnostic(stderr: string, exitCode: number | null, signal: string | null): StatementExcelDiagnostic {
  const result: StatementExcelDiagnostic = { stage: 'worker', code: 'EXCEL_WORKER_FAILED', exitCode, signal }
  for (const line of stderr.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      if (value.kind !== 'HROMADA_STATEMENT_EXCEL_ERROR' || !stages.includes(value.stage as Stage)) continue
      result.stage = value.stage as Stage
      if (['EXCEL_OPERATION_FAILED', 'HROMADA_LAYOUT_TOO_TALL', 'HROMADA_BANK_TEMPLATE_INVALID', 'HROMADA_GENERATION_CANCELLED'].includes(String(value.code))) result.code = String(value.code)
      if (typeof value.errorType === 'string' && /^[A-Za-z.]{1,120}$/.test(value.errorType)) result.errorType = value.errorType
      if (Number.isInteger(value.hresult)) result.hresult = Number(value.hresult)
      if (Number.isInteger(value.line)) result.line = Number(value.line)
    } catch { /* Unstructured stderr can contain document data. Discard it. */ }
  }
  return result
}

export function statementFailure(error: unknown, stage: Stage): { diagnostic: StatementExcelDiagnostic; message: string } {
  const diagnostic: StatementExcelDiagnostic = error instanceof StatementExcelError ? error.diagnostic : {
    stage, code: error && typeof error === 'object' && 'code' in error && ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC'].includes(String(error.code)) ? String(error.code) : 'DOCUMENT_OPERATION_FAILED', exitCode: null, signal: null,
  }
  const messages: Partial<Record<Stage, string>> = {
    input: 'Не вдалося передати параметри формування документа.',
    'template-copy': 'Не вдалося прочитати або скопіювати шаблон документа.',
    'template-check': 'Тимчасову копію шаблону не знайдено або вона недоступна.',
    'temporary-directory': 'Не вдалося створити тимчасові файли документа.',
    'drawing-init': 'Не вдалося підготувати вимірювання тексту шаблону.',
    'excel-start': 'Не вдалося запустити автоматизацію Microsoft Excel.',
    'workbook-open': 'Microsoft Excel не зміг відкрити копію шаблону.',
    'fill-template': 'Microsoft Excel не зміг заповнити шаблон.',
    'workbook-save': 'Microsoft Excel не зміг зберегти XLSX.',
    'xls-save': 'Microsoft Excel не зміг зберегти персональну відомість у форматі XLS.',
    'pdf-export': 'Microsoft Excel не зміг експортувати PDF.',
    'pdf-read': 'Не вдалося прочитати сформований PDF.',
    'workbook-close': 'Microsoft Excel не зміг завершити роботу з документом.',
  }
  const message = diagnostic.code === 'HROMADA_LAYOUT_TOO_TALL'
    ? 'Повна назва або реквізити не вміщуються в рядок шаблону без обрізання.'
    : diagnostic.code === 'HROMADA_BANK_TEMPLATE_INVALID'
      ? 'Структура шаблону «ПриватБанк» не відповідає очікуваним колонкам.'
      : messages[diagnostic.stage] ?? 'Не вдалося виконати допоміжний процес формування документа.'
  return { diagnostic, message: `${message} Документи не збережено. Технічні відомості: statement-export.log у журналі клієнта.` }
}
