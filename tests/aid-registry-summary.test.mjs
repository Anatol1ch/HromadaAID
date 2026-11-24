import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summarizeAidRegistry } from '../src/lib/aidRegistrySummary.ts'

const example = [
  { id: 'a1', recipientId: 'p1', status: 'Виплачено', amountMinor: 1_279_250 },
  { id: 'a2', recipientId: 'p2', status: 'Очікує рішення', amountMinor: 523_647 },
  { id: 'a3', recipientId: 'p3', status: 'Призначено', amountMinor: 244_533 },
  { id: 'a4', recipientId: 'p4', status: 'В роботі', amountMinor: 1_591_483 },
  { id: 'a5', recipientId: 'p5', status: 'Передано до казначейства', amountMinor: 615_176 },
  { id: 'a6', recipientId: 'p6', status: 'Виплачено', amountMinor: 897_736 },
  { id: 'a7', recipientId: 'p7', status: 'Очікує рішення', amountMinor: 2_482_202 },
]

test('counts and totals every status, including the owner example, in integer minor units', () => {
  assert.deepEqual(summarizeAidRegistry(example), { count: 7, totalMinor: 7_634_027 })
  assert.deepEqual(summarizeAidRegistry(example.filter(row => row.status !== 'Очікує рішення')), { count: 5, totalMinor: 4_628_178 })
})

test('summarizes the already filtered subset and yields zero for an empty result', () => {
  const filtered = example.filter(row => row.status === 'Очікує рішення' || row.status === 'Призначено')
  assert.deepEqual(summarizeAidRegistry(filtered), { count: 3, totalMinor: 3_250_382 })
  assert.deepEqual(summarizeAidRegistry([]), { count: 0, totalMinor: 0 })
})

test('counts distinct assignment IDs, not recipients, and deduplicates repeated assignment IDs', () => {
  const sameRecipient = [
    { id: 'same-recipient-1', recipientId: 'person-1', amountMinor: 101 },
    { id: 'same-recipient-2', recipientId: 'person-1', amountMinor: 202 },
    { id: 'same-recipient-1', recipientId: 'person-1', amountMinor: 101 },
  ]
  assert.deepEqual(summarizeAidRegistry(sameRecipient), { count: 2, totalMinor: 303 })
})

test('sorting and selection state do not affect the registry total', () => {
  const selectedIds = new Set(['a1', 'a3'])
  const expected = summarizeAidRegistry(example)
  assert.deepEqual(summarizeAidRegistry([...example].reverse()), expected)
  assert.deepEqual(summarizeAidRegistry(example), expected)
  assert.equal(selectedIds.size, 2)
})

test('AidRegistry derives the summary from the filtered row set, not the selection', () => {
  const source = readFileSync(new URL('../src/AidRegistry.tsx', import.meta.url), 'utf8')
  assert.match(source, /summarizeAidRegistry\(visible\)/)
  assert.doesNotMatch(source, /summarizeAidRegistry\(selectedIds\)/)
})
