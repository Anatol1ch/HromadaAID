import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldFormatError, normalizeField, validUkrainianIban } from '../electron/field-formats.ts'
import { caretForDigit, cleanPassportInput, displayMask, editMask, formatMask } from '../src/lib/inputMasks.ts'

test('Passport input mask caps booklet at two letters/six digits and ID at nine digits', () => {
  for (const [input, expected] of [
    ['ае1234567','АЕ123456'], ['АЕЇ12345678','АЕ123456'], ['А','А'], ['А123','А123'],
    ['1234567890','123456789'], ['001122334455','001122334'], ['12АЕ34567890','123456789'],
    [' ае 123-4567!','АЕ123456'], ['АЕ129456','АЕ129456'], ['', ''],
  ]) assert.equal(cleanPassportInput(input), expected, input)
})

test('Passport: two Ukrainian uppercase letters plus six digits, or exactly nine digits', () => {
  for (const value of ['АВ123456','ґї000001','ЄІ123456','000000001']) assert.equal(fieldFormatError('passport',value),'',value)
  assert.equal(normalizeField('passport','ав123456'),'АВ123456')
  for (const value of ['','А123456','ABC123456','АВ12345','АВ1234567','12345678','1234567890','ЫЭ123456','АВ12-456','АВ12345x']) assert.notEqual(fieldFormatError('passport',value),'',value)
})
test('RNOKPP retains initial zeros and rejects incomplete and non-digit input', () => {
  assert.equal(fieldFormatError('rnokpp','0000000001'),'')
  for(const value of ['123456789','12345678901','12345 6789','123456789x']) assert.notEqual(fieldFormatError('rnokpp',value),'')
})
test('Phone: optional prefix is empty; formatted, local and canonical numbers normalize consistently', () => {
  for(const value of ['','+380','380','   ']) { assert.equal(normalizeField('phone',value),'');assert.equal(fieldFormatError('phone',value),'') }
  for(const value of ['+380 50 123 45 67','0501234567','380501234567','501234567','+380 (50) 123-45-67']) assert.equal(normalizeField('phone',value),'+380501234567')
  for(const value of ['+38050','+48123456789','+3805012345678','+380x501234567']) assert.notEqual(fieldFormatError('phone',value),'')
})
test('Email allows different providers and international domain labels, rejecting malformed domains and whitespace', () => {
  for(const value of ['','name+tag@sub.example.org','fictional@example.invalid','приклад@пошта.укр']) assert.equal(fieldFormatError('email',value),'',value)
  for(const value of ['a@@example.org','@example.org','a@','a@example','a@.org','a@example..org','a@-example.org','a@example-.org','a@exam_ple.org','a@example.123','a b@example.org',' a@example.org','a@example.org ','a..b@example.org']) assert.notEqual(fieldFormatError('email',value),'',value)
})
test('Ukrainian IBAN is format-only; standalone MOD 97 remains available', () => {
  for(const value of ['UA890000000000000000000000000','UA620000000000000000000000001','UA350000000000000000000000002']) { assert.equal(validUkrainianIban(value),true);assert.equal(fieldFormatError('bankAccount',value),'') }
  assert.equal(validUkrainianIban('UA000000000000000000000000001'),false)
  assert.equal(fieldFormatError('bankAccount','UA000000000000000000000000001'),'')
  assert.equal(normalizeField('bankAccount','ua 62 000000 0000000000000000001'),'UA620000000000000000000000001')
  for(const value of ['UA62000000000000000000000001','UA6200000000000000000000000001','UA62000000000000000000000000x','DE620000000000000000000000001']) assert.notEqual(fieldFormatError('bankAccount',value),'',value)
})

test('Optional IBAN check accepts spaced canonical input and validates Ukrainian format and MOD 97', () => {
  const spaced = 'UA 62 000000 0000000000000000001'
  assert.equal(validUkrainianIban(normalizeField('bankAccount', spaced)), true)
  for (const value of ['DE620000000000000000000000001', 'UA62000000000000000000000001', 'UA62000000000000000000000000X', 'UA000000000000000000000000001']) assert.equal(validUkrainianIban(normalizeField('bankAccount', value)), false, value)
})
test('Masks display prefixes without changing an empty model and preserve invalid legacy values visibly', () => {
  assert.equal(displayMask('phone',''),'+380');assert.equal(displayMask('bankAccount',''),'UA')
  assert.equal(displayMask('phone','+380501234567'),'+380 50 123 45 67')
  assert.equal(displayMask('bankAccount','UA620000000000000000000000001'),'UA 62 000000 0000000000000000001')
  assert.equal(displayMask('bankAccount','legacy-invalid'),'legacy-invalid')
})
test('Phone mask insertion, replacement, Backspace, Delete and prefix protection use digit positions', () => {
  const display='+380 50 123 45 67'
  const before=caretForDigit('phone',display,2)
  const back=editMask('phone',display,before+1,before+1,'','backward')
  assert.equal(back.value,'+38051234567')
  assert.equal(editMask('phone',display,before,before,'','forward').value,'+38050234567')
  assert.equal(editMask('phone',display,0,4,'','backward').value,'+380501234567')
  assert.equal(editMask('phone',display,0,4,'','forward').value,'+380501234567')
  assert.equal(editMask('phone',display,0,display.length,'').value,'')
  assert.equal(editMask('phone','+380',0,4,'501234567').value,'+380501234567')
  const replacement=editMask('phone',display,5,7,'67')
  assert.equal(replacement.value,'+380671234567');assert.equal(replacement.caret,7)
})
test('IBAN mask supports replacement in every digit position without losing prefix or zeros', () => {
  const original='620000000000000000000000001'
  const display=formatMask('bankAccount',original)
  for(let index=0;index<27;index++) {
    const start=index ? caretForDigit('bankAccount',display,index) : 2
    const end=caretForDigit('bankAccount',display,index+1)
    const result=editMask('bankAccount',display,start,end,'5')
    assert.equal(result.value,'UA'+original.slice(0,index)+'5'+original.slice(index+1))
  }
})
