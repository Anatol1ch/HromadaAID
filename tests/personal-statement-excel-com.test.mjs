import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const probe = process.platform === 'win32' && existsSync(powershell)
  ? spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; $x=New-Object -ComObject Excel.Application; $x.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($x)'], { encoding: 'utf8', windowsHide: true })
  : null

test('Excel COM writes numeric personal amounts, keeps total formula, exports PDF and writes residence address', { skip: !probe || probe.status !== 0 }, t => {
  const temp = mkdtempSync(join(tmpdir(), 'hromada-personal-excel-com-'))
  t.after(() => {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()))
    rmSync(temp, { recursive: true, force: true })
  })
  const template = join(temp, 'Список.xlsx')
  const xls = join(temp, 'personal.xls')
  const pdf = join(temp, 'personal.pdf')
  copyFileSync(join(root, 'reference', 'Список.xlsx'), template)
  const payload = {
    kind: 'personal', templatePath: template, excelPath: xls, pdfPath: pdf,
    aidTypeName: 'на надання допомоги', periodText: 'з 01.01.2026 по 31.12.2026',
    documentNumber: '1', documentDateDisplay: '30.10.2026',
    records: [
      { dateDisplay: '30.10.2026', amount: 1000, bankAccount: 'UA1', bankName: 'Банк', bankMfo: '000001', bankEdrpou: '00000001', fullName: 'Особа Перша', rnokpp: '0000000001', passport: 'ТТ000001', residenceAddress: 'Адреса проживання 1' },
      { dateDisplay: '30.10.2026', amount: 1234.5, bankAccount: 'UA2', bankName: 'Банк', bankMfo: '000001', bankEdrpou: '00000001', fullName: 'Особа Друга', rnokpp: '0000000002', passport: 'ТТ000002', residenceAddress: 'Адреса проживання 2' },
      { dateDisplay: '30.10.2026', amount: 0, bankAccount: 'UA3', bankName: 'Банк', bankMfo: '000001', bankEdrpou: '00000001', fullName: 'Особа Третя', rnokpp: '0000000003', passport: 'ТТ000003', residenceAddress: 'Адреса проживання 3' },
    ],
  }
  const safeJson = JSON.stringify(payload).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
  const generated = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'electron', 'excel-templates.ps1')], { input: safeJson, encoding: 'ascii', windowsHide: true, timeout: 120_000 })
  assert.equal(generated.status, 0, generated.stderr || generated.stdout)
  assert.ok(existsSync(xls)); assert.ok(existsSync(pdf));

  const quote = value => "'" + value.replace(/'/g, "''") + "'"
  const inspect = `$ErrorActionPreference='Stop'; $OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $excel=$null; $book=$null; $sheet=$null; try { $excel=New-Object -ComObject Excel.Application; $excel.Visible=$false; $excel.DisplayAlerts=$false; $book=$excel.Workbooks.Open(${quote(xls)},0,$true); $sheet=$book.Worksheets.Item(1); @{ g13=$sheet.Range('G13').Value2; g14=$sheet.Range('G14').Value2; g15=$sheet.Range('G15').Value2; g25=$sheet.Range('G25').Value2; formula=$sheet.Range('G25').Formula; format=$sheet.Range('G13:G25').NumberFormat; localFormat=$sheet.Range('G13:G25').NumberFormatLocal; text1000=$sheet.Range('G13').Text; textCents=$sheet.Range('G14').Text; textZero=$sheet.Range('G15').Text; address=$sheet.Range('K13').Value2 } | ConvertTo-Json -Compress } finally { if($book){$book.Close($false)}; if($excel){$excel.Quit()}; foreach($object in @($sheet,$book,$excel)){ if($object){[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object)} } }`
  const inspected = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', inspect], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout)
  const result = JSON.parse(inspected.stdout.trim())
  assert.equal(typeof result.g13, 'number'); assert.equal(typeof result.g14, 'number'); assert.equal(typeof result.g15, 'number')
  assert.equal(result.g13, 1000); assert.equal(result.g14, 1234.5); assert.equal(result.g15, 0)
  assert.equal(result.g25, 2234.5); assert.equal(result.formula, '=SUM(G13:G24)')
  assert.equal(result.format, '# ##0,00'); assert.equal(result.localFormat, '# ##0,00')
  assert.equal(result.text1000, '1 000,00'); assert.equal(result.textCents, '1 234,50'); assert.equal(result.textZero, '0,00')
  assert.equal(result.address, 'Адреса проживання 1')
})
