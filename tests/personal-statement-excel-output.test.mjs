import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

function readZipEntry(filePath, entryName) {
  const data = readFileSync(filePath)
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.notEqual(eocd, -1, 'template must be a valid ZIP/OOXML file')
  const count = data.readUInt16LE(eocd + 10)
  let offset = data.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index++) {
    assert.equal(data.readUInt32LE(offset), 0x02014b50)
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLength)
    const method = data.readUInt16LE(offset + 10)
    const compressedSize = data.readUInt32LE(offset + 20)
    const localOffset = data.readUInt32LE(offset + 42)
    if (name === entryName) {
      const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28)
      const compressed = data.subarray(start, start + compressedSize)
      return method === 0 ? compressed.toString('utf8') : method === 8 ? inflateRawSync(compressed).toString('utf8') : assert.fail(`Unsupported ZIP compression: ${method}`)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  assert.fail(`Missing ZIP entry ${entryName}`)
}

test('personal Excel export applies a two-decimal numeric format to amounts and keeps its total formula and outputs', () => {
  const script = readFileSync(new URL('../electron/excel-templates.ps1', import.meta.url), 'utf8')
  assert.match(script, /\$sheet\.Range\('G13:G25'\)\.NumberFormatLocal\s*=\s*'# ##0,00'/)
  assert.match(script, /\$sheet\.Cells\.Item\(\$row, 7\)\.Value2\s*=\s*\[double\]\$record\.amount/)
  assert.match(script, /\$workbook\.SaveAs\(\[string\]\$payload\.excelPath, 56\)/)
  assert.match(script, /\$workbook\.ExportAsFixedFormat\(0, \$payload\.pdfPath\)/)

  const worksheet = readZipEntry(new URL('../reference/Список.xlsx', import.meta.url), 'xl/worksheets/sheet1.xml')
  const totalCell = worksheet.match(/<c\b[^>]*\br="G25"[^>]*>[\s\S]*?<\/c>/)?.[0]
  assert.ok(totalCell, 'template total cell G25 must exist')
  assert.match(totalCell, /<f>SUM\(G13:G24\)<\/f>/, 'template total formula remains unchanged')
})
