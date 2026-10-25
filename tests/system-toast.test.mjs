import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = async path => readFile(new URL(path, import.meta.url), 'utf8')
const [host, toast, assignments, decisions, recipients, banks, planning, users, settings] = await Promise.all([
  source('../src/components/SystemToastHost.tsx'), source('../src/components/SystemToast.tsx'),
  source('../src/AidRegistry.tsx'), source('../src/DecisionRegistry.tsx'), source('../src/RecipientRegistry.tsx'),
  source('../src/components/BankFormModal.tsx'), source('../src/AnnualPlanning.tsx'), source('../src/UsersAdmin.tsx'),
  source('../src/SettingsPage.tsx'),
])

test('shared toast host serializes notices and keeps only the current toast visible', () => {
  assert.match(host, /setQueue\(current => \[\.\.\.current,/)
  assert.match(host, /const notice = queue\[0\]/)
  assert.match(host, /filter\(item => item\.id !== notice\.id\)/)
  assert.match(host, /duration: typeof detail\.duration === 'number'/)
})

test('toasts dismiss automatically, animate out, and remain manually dismissible', () => {
  assert.match(toast, /duration = 3_500/)
  assert.match(toast, /setTimeout\(\(\) => setClosing\(true\), duration\)/)
  assert.match(toast, /setTimeout\(\(\) => closeRef\.current\(\), 180\)/)
  assert.match(toast, /aria-label="Закрити повідомлення"/)
})

test('successful mutations notify only after the server success result', () => {
  const assignmentSave = assignments.slice(assignments.indexOf('const submit ='), assignments.indexOf('const update ='))
  assert.match(assignmentSave, /if \(!result\.ok\) \{ setError\(result\.message\);[\s\S]*?return \}[\s\S]*?notifySystemToast\('success'/)
  assert.equal((assignmentSave.match(/notifySystemToast\(/g) ?? []).length, 1)
  assert.match(decisions, /if \(!result\.ok\) \{ setError\(result\.message\); return \}[\s\S]*?notifySystemToast\('success'/)
  assert.match(recipients, /if \(result\.ok\) \{ notifySystemToast\('success'/)
  assert.match(banks, /if \(result\.ok\) \{ notifySystemToast\('success'/)
  assert.match(planning, /if \(!result\.ok\) setError\(result\.message[\s\S]*?notifySystemToast\('success'/)
  assert.match(users, /if \(!result\.ok\) \{ setError\(result\.message\); return \}; notifySystemToast\('success'/)
  assert.match(settings, /onSaved=\{state => \{ setConnection\(state\); setConnectionMessage\(''\); notifySystemToast\('success'/)
})

test('success notice text is generic and does not include user-entered records or credentials', () => {
  for (const text of [assignments, decisions, recipients, banks, planning, users, settings]) {
    assert.doesNotMatch(text, /notifySystemToast\('success',\s*(?:user\.|draft\.|input\.|password|token|bankAccount|rnokpp|username|iban)/i)
  }
})
