import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { externalExcelScriptPath } from '../dist-electron/electron/excel-worker.js'

const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const directory = resolve('release/HromadaAID-Client-portable/resources/app.asar/dist-electron/electron')
const asciiJson = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)

test('actual portable Excel workers are external, current and parse/run with Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, t => {
  const temporary = mkdtempSync(join(tmpdir(), 'hromada-packaged-excel-'))
  t.after(() => { assert.equal(dirname(temporary), resolve(tmpdir())); rmSync(temporary, { recursive: true, force: true }) })
  const scripts = ['excel-templates.ps1', 'excel-privatbank.ps1', 'excel-report.ps1']
  for (const name of scripts) {
    const script = externalExcelScriptPath(directory, name)
    assert.ok(!script.includes(`${join('app.asar', '')}\\`))
    const bytes = readFileSync(script)
    assert.deepEqual(bytes, readFileSync(join('electron', name)))
    if (bytes.some(byte => byte > 127)) assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf', `${name}: PS 5.1 Unicode requires BOM`)
    const parseCommand = `$errors=$null;$tokens=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors);if($errors.Count){exit 1};$PSVersionTable.PSVersion.Major`
    const parse = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', parseCommand], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    assert.equal(parse.status, 0, parse.stderr)
    assert.equal(parse.stdout.trim(), '5')
    if (name === 'excel-report.ps1') continue // Its path/parser are tested; never start COM in this test.
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { input: asciiJson({ templatePath: join(temporary, 'Неіснуючий шаблон.xlsx'), records: [], privateSentinel: 'PRIVATE_SENTINEL' }), encoding: 'utf8', windowsHide: true, timeout: 15000 })
    assert.equal(result.status, 1)
    const diagnostic = JSON.parse(result.stderr.trim())
    assert.equal(diagnostic.stage, 'template-check')
    assert.equal(diagnostic.kind, 'HROMADA_STATEMENT_EXCEL_ERROR')
    assert.ok(!result.stderr.includes('PRIVATE_SENTINEL'))
    assert.ok(!result.stderr.includes(temporary))
  }
})

for (const culture of ['en-US', 'uk-UA']) test(`packaged worker stdin, dates, decimal amounts, totals and Cyrillic under ${culture} (COM intercepted)`, { skip: process.platform !== 'win32' }, t => {
  const temporary = mkdtempSync(join(tmpdir(), 'hromada-excel-culture-'))
  t.after(() => { assert.equal(dirname(temporary), resolve(tmpdir())); rmSync(temporary, { recursive: true, force: true }) })
  const unicodeDirectory = join(temporary, 'Шляхи з пробілами')
  mkdirSync(unicodeDirectory)
  const script = join(unicodeDirectory, 'excel-templates.ps1')
  copyFileSync(externalExcelScriptPath(directory, 'excel-templates.ps1'), script)
  const template = join(unicodeDirectory, 'Синтетична копія.xlsx')
  writeFileSync(template, 'synthetic placeholder; never opened by Excel')
  const expectedName = 'Вигаданий Отримувач Український'
  const payload = { templatePath: template, expectedName, records: [{ amount: 1234.56, dateDisplay: '29.02.2028', fullName: expectedName }, { amount: 0.44 }] }
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/excel-worker-culture.ps1'), '-Script', script, '-Culture', culture], { input: asciiJson(payload), encoding: 'utf8', windowsHide: true, timeout: 15000 })
  assert.equal(result.status, 1, 'intentional stop before actual COM activation')
  assert.ok(result.stdout.trim(), result.stderr)
  const checked = JSON.parse(result.stdout.trim())
  assert.deepEqual(checked, { tested: true, culture, amount: 1234.56, date: '29.02.2028', unicode: true, total: 1235 })
  const diagnostic = JSON.parse(result.stderr.trim())
  assert.equal(diagnostic.stage, 'excel-start')
  assert.ok(!result.stderr.includes(expectedName))
})
