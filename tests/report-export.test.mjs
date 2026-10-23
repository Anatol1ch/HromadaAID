import test from 'node:test'
import assert from 'node:assert/strict'
import { reportPdfFileName, isReportPdfKind } from '../electron/report-filenames.ts'

test('PDF filenames: exact punctuation, two-digit local date and all four tab names',()=>{
 const date=new Date(2026,9,18,12)
 for(const [kind,label] of Object.entries({month:'МІСЯЦЬ',quarter:'КВАРТАЛ',annual:'РІК',cumulative:'З ПОЧАТКУ РОКУ'})){
  assert.equal(reportPdfFileName(kind,date),`[2026-10-18][0213242][ЗВІТ] – ${label}.pdf`)
  assert.equal(isReportPdfKind(kind),true)
 }
 assert.equal(reportPdfFileName('annual',new Date(2027,0,2)),'[2027-01-02][0213242][ЗВІТ] – РІК.pdf')
 for(const invalid of [null,{},'__proto__','toString','year','annual.pdf'])assert.equal(isReportPdfKind(invalid),false)
})

test('PDF naming uses local calendar dates on either side of UTC midnight',()=>{
 const before=process.env.TZ
 try {
  process.env.TZ='Europe/Kyiv'
  assert.equal(reportPdfFileName('month',new Date('2026-01-01T22:30:00Z')),'[2026-01-02][0213242][ЗВІТ] – МІСЯЦЬ.pdf')
  process.env.TZ='America/Los_Angeles'
  assert.equal(reportPdfFileName('month',new Date('2026-01-01T01:30:00Z')),'[2025-12-31][0213242][ЗВІТ] – МІСЯЦЬ.pdf')
 } finally {if(before===undefined)delete process.env.TZ;else process.env.TZ=before}
})
