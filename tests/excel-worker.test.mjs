import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { externalExcelScriptPath, statementExcelDiagnostic, statementFailure, StatementExcelError } from '../dist-electron/electron/excel-worker.js'

test('external Excel workers resolve to physical unpacked files, including spaces and Ukrainian paths', () => {
  const directory = join('C:\\', 'Тест клієнта', 'resources', 'app.asar', 'dist-electron', 'electron')
  for (const name of ['excel-templates.ps1', 'excel-privatbank.ps1', 'excel-report.ps1']) {
    assert.equal(externalExcelScriptPath(directory, name), join('C:\\', 'Тест клієнта', 'resources', 'app.asar.unpacked', 'dist-electron', 'electron', name))
    assert.equal(externalExcelScriptPath(join('C:\\', 'Розробка', 'electron'), name), join('C:\\', 'Розробка', 'electron', name))
  }
})

test('Excel diagnostics distinguish stages and preserve exit metadata without forwarding document contents', () => {
  for (const stage of ['template-check', 'excel-start', 'workbook-open', 'fill-template', 'workbook-save', 'xls-save', 'pdf-export']) {
    const stderr = 'SYNTHETIC_PRIVATE_DATA\n' + JSON.stringify({ kind: 'HROMADA_STATEMENT_EXCEL_ERROR', stage, code: 'EXCEL_OPERATION_FAILED', message: 'SYNTHETIC_PRIVATE_DATA', errorType: 'System.Exception', hresult: -2147024891, line: 55, path: 'SYNTHETIC_PRIVATE_DATA' })
    const diagnostic = statementExcelDiagnostic(stderr, 1, null)
    assert.equal(diagnostic.stage, stage)
    assert.equal(diagnostic.exitCode, 1)
    assert.equal(diagnostic.hresult, -2147024891)
    assert.equal(diagnostic.line, 55)
    const result = statementFailure(new StatementExcelError(diagnostic), 'worker')
    assert.ok(result.message.length)
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_DATA'))
  }
})

test('filesystem, malformed worker output and layout errors remain distinct', () => {
  assert.equal(statementFailure(Object.assign(new Error('PRIVATE'), { code: 'ENOENT' }), 'template-copy').diagnostic.code, 'ENOENT')
  assert.equal(statementFailure(Object.assign(new Error('PRIVATE'), { code: 'EACCES' }), 'temporary-directory').diagnostic.code, 'EACCES')
  assert.deepEqual(statementExcelDiagnostic('PRIVATE PowerShell parser trace', -196608, null), { stage: 'worker', code: 'EXCEL_WORKER_FAILED', exitCode: -196608, signal: null })
  const layout = statementExcelDiagnostic(JSON.stringify({ kind: 'HROMADA_STATEMENT_EXCEL_ERROR', stage: 'fill-template', code: 'HROMADA_LAYOUT_TOO_TALL' }), 1, null)
  assert.match(statementFailure(new StatementExcelError(layout), 'worker').message, /не вміщуються/)
})
