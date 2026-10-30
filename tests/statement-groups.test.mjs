import test from 'node:test'
import assert from 'node:assert/strict'
import { groupStatements, sumStatementMinor, assertStatementSelection } from '../shared/statement-groups.ts'
import { statementPlan, statementKey, validateStatementParameters } from '../shared/statement-parameters.ts'
import { statementFileName, bankStatementFileName, assertUniqueStatementFileNames } from '../shared/statement-filenames.ts'

const row = (id, aidTypeId = 'a', bankId = 'bank1', amountMinor = 101) => ({ id, aidTypeId, aidTypeName: aidTypeId, bankId, bankName: 'Однакова назва', amountMinor, recipientId: 'same-person' })
const selection = rows => rows.map(({ id, aidTypeId, bankId }) => ({ id, aidTypeId, bankId }))
const parameters = plan => plan.map((item, i) => ({ ...item, documentNumber: String(i + 1), documentDate: '2026-10-30', periodStart: '2026-01-01', periodEnd: '2026-12-31' }))

test('two aids × two banks only creates nonempty combinations and bank files combine aid types', () => {
  const rows = [row('1'), row('2', 'b'), row('3', 'a', 'bank2', 202)]
  for (const kind of ['personal', 'summary']) {
    const groups = groupStatements(kind, rows)
    assert.equal(groups.length, 3)
    assert.deepEqual(groups.map(g => [g.aidTypeId, g.bankId, g.recordCount, g.totalMinor]), [['a', 'bank1', 1, 101], ['a', 'bank2', 1, 202], ['b', 'bank1', 1, 101]])
  }
  const bank = groupStatements('bank', rows)
  assert.deepEqual(bank.map(g => [g.bankId, g.recordCount, g.totalMinor]), [['bank1', 2, 202], ['bank2', 1, 202]])
  assert.equal(new Set(bank[0].rows.map(r => r.aidTypeId)).size, 2)
  assert.deepEqual(groupStatements('summary', []), [])
  assert.equal(groupStatements('summary', [...rows, row('4', 'b', 'bank2')]).length, 4)
  const selectedBank = rows.filter(r => r.bankId === 'bank2')
  assert.deepEqual(groupStatements('bank', selectedBank).flatMap(g => g.rows.map(r => r.id)), ['3'])
})

test('bank identity ignores detail sets and keeps identical names with different IDs separate', () => {
  const rows = [{ ...row('1'), bankDetailsId: 'detail1' }, { ...row('2'), bankDetailsId: 'detail2' }, row('3', 'a', 'bank2')]
  assert.deepEqual(groupStatements('bank', rows).map(g => g.recordCount), [2, 1])
})

test('personal capacities 12, 13, 24, 25 are applied after bank/aid grouping', () => {
  for (const [count, expected] of [[12, [12]], [13, [12, 1]], [24, [12, 12]], [25, [12, 12, 1]]]) {
    const rows = Array.from({ length: count }, (_, i) => row(String(i).padStart(3, '0')))
    const groups = groupStatements('personal', rows)
    assert.deepEqual(groups.map(g => g.recordCount), expected)
    assert.equal(new Set(groups.map(statementKey)).size, expected.length)
    assert.equal(groups.reduce((sum, g) => sum + g.totalMinor, 0), count * 101)
    assert.deepEqual(groups, groupStatements('personal', rows.toReversed()))
  }
})

test('duplicate assignment IDs collapse; distinct assignments for one person remain and cents reconcile', () => {
  const rows = [row('1', 'a', 'bank1', 10001), row('2', 'a', 'bank1', 20002), row('1', 'a', 'bank1', 10001)]
  const groups = groupStatements('summary', rows)
  assert.equal(groups[0].recordCount, 2); assert.equal(groups[0].totalMinor, 30003)
  assert.deepEqual(groups[0].rows.map(r => r.id), ['1', '2'])
  assert.throws(() => groupStatements('bank', [row('1'), row('1', 'b')]), /суперечливі/)
  for (const amount of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => sumStatementMinor([{ amountMinor: amount }]))
  assert.throws(() => groupStatements('bank', [row('1', 'a', 'bank1', Number.MAX_SAFE_INTEGER), row('2')]), /суми|Суми/)
})

test('missing banks and changed individual memberships cannot disappear or swap silently', () => {
  assert.throws(() => groupStatements('bank', [row('1', 'a', null)]), /без визначеного банку/)
  const rows = [row('1'), row('2', 'b', 'bank2')], expected = selection(rows)
  assert.doesNotThrow(() => assertStatementSelection(rows, ['1', '2'], expected))
  for (const changed of [[row('1', 'b'), rows[1]], [row('1', 'a', 'bank2'), rows[1]], [rows[0]], [rows[0], row('3')], [rows[0], rows[0]]]) {
    assert.throws(() => assertStatementSelection(changed, ['1', '2'], expected), /Оновіть список/)
  }
  assert.throws(() => assertStatementSelection(rows, ['1', '2'], [expected[0], expected[0]]))
  const plan = statementPlan('personal', rows), values = parameters(plan)
  assert.ok(validateStatementParameters(values, plan))
  assert.equal(validateStatementParameters([{ ...values[0], bankId: 'other' }, values[1]], plan), null)
})

test('bank filenames distinguish names, cleaned names and case-sensitive bank IDs; personal numbers stay exact', () => {
  const banks = [{ bankId: 'bank1', bankName: 'Банк/А' }, { bankId: 'bank2', bankName: 'Банк:А' }, { bankId: 'BANK1', bankName: 'Банк/А' }]
  const date = new Date(2026, 9, 30), value = { documentNumber: '0001', documentDate: '2026-10-30' }
  for (const names of [banks.map(bank => bankStatementFileName(date, bank)), banks.map(bank => statementFileName('summary', value, bank))]) {
    assert.doesNotThrow(() => assertUniqueStatementFileNames(names))
    for (const name of names) { assert.doesNotMatch(name, /[<>:"/\\|?*]/); assert.ok(name.length <= 255) }
  }
  const personal = statementFileName('personal', value, banks[0])
  assert.equal(personal, 'vf021324210900415261030410595690001.xls')
  assert.throws(() => assertUniqueStatementFileNames([personal, personal]), /різні номери/)
  assert.throws(() => assertUniqueStatementFileNames(['File.xlsx', 'file.xlsx']), /повторюються/)
  assert.throws(() => statementFileName('summary', { ...value, documentNumber: '1'.repeat(220) }, banks[0]))
})
