import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { decisionAssignmentTarget } from '../src/lib/decision-assignment-navigation.ts'
import { allowedDictionarySections, hasWorkspacePage } from '../shared/authorization.ts'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const dictionaries = await readFile(new URL('../src/Dictionaries.tsx', import.meta.url), 'utf8')
const aidRegistry = await readFile(new URL('../src/AidRegistry.tsx', import.meta.url), 'utf8')

test('decision context uses the stable ID and the year in its date, only when assignments are accessible', () => {
  assert.deepEqual(decisionAssignmentTarget('decision-uuid-1', '2024-11-21', true), { decisionId: 'decision-uuid-1', year: 2024 })
  assert.equal(decisionAssignmentTarget('decision-uuid-1', '2024-11-21', false), null)
  assert.equal(decisionAssignmentTarget('', '2024-11-21', true), null)
  assert.equal(decisionAssignmentTarget('decision-uuid-1', '2024-13-40', true), null)
})

test('role gates permit the transition only from roles that can use both source and destination', () => {
  assert(hasWorkspacePage(['administrator'], 'assignments'))
  assert(allowedDictionarySections(['administrator']).includes('decisions'))
  assert(hasWorkspacePage(['assignment_specialist'], 'assignments'))
  assert(allowedDictionarySections(['assignment_specialist']).includes('decisions'))
  assert(hasWorkspacePage(['viewer', 'assignment_specialist'], 'assignments'))
  assert(allowedDictionarySections(['viewer', 'assignment_specialist']).includes('decisions'))
  for (const role of ['payment_specialist', 'planning_specialist', 'viewer']) {
    assert.equal(hasWorkspacePage([role], 'assignments'), false)
    assert.equal(allowedDictionarySections([role]).includes('decisions'), false)
  }
  assert.match(app, /canOpenPage\('assignments', 'assignments\.read'\)/)
  assert.match(app, /dictionarySections\.includes\('decisions'\)/)
})

test('context filter compares decision IDs, respects the selected year, and returns to the decisions tab', () => {
  assert.match(dictionaries, /onClick=\{\(\) => onViewDecisionAssignments\?\.\(item\)\}/)
  assert.match(aidRegistry, /row\.decisionId !== filters\.decisionId/)
  assert.match(aidRegistry, /assignmentRepository\.list\(selectedYear\)/)
  assert.match(aidRegistry, /setFilters\(\{ \.\.\.emptyFilters\(\), decisionId: decisionContext\.decisionId \}\)/)
  assert.match(app, /setYear\(target\.year\)/)
  assert.match(app, /setDictionarySection\('decisions'\)/)
  assert.match(app, /setYear\(decisionContext\.year\)/)
  assert.match(app, /Рішення № \$\{decision\.decisionNumber\} від \$\{new Date\(/)
  assert.match(aidRegistry, /decision-assignment-context[\s\S]*Допомоги за рішенням[\s\S]*decisionContext\.label[\s\S]*Повернутися до рішення/)
  // The context transition passes only the decision reference and performs no recipient-card lookup.
  const transition = app.slice(app.indexOf('const viewDecisionAssignments'), app.indexOf('const returnToDecision'))
  assert.match(transition, /decision\.id/)
  assert.doesNotMatch(transition, /recipientRepository|recipients\.get/)
})
