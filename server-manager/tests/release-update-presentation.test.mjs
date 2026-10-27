import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/release-update-presentation.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { releaseUpdateDisplay } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('Manager release status follows Client wording and distinguishes check, available, install and error states', () => {
  assert.deepEqual(releaseUpdateDisplay({ status: 'checking' }), { label: 'Перевірка…', tone: 'info' })
  assert.deepEqual(releaseUpdateDisplay({ status: 'up-to-date' }), { label: 'Встановлено останню перевірену версію', tone: 'success' })
  assert.deepEqual(releaseUpdateDisplay({ status: 'available', availableVersion: '0.1.4' }), { label: 'Доступна версія 0.1.4', tone: 'warning' })
  assert.deepEqual(releaseUpdateDisplay({ status: 'error', error: 'Не вдалося перевірити GitHub Releases.' }), { label: 'Не вдалося перевірити GitHub Releases.', tone: 'error' })
  assert.notEqual(releaseUpdateDisplay({ status: 'installing' }).label, releaseUpdateDisplay({ status: 'up-to-date' }).label)
  assert.equal(releaseUpdateDisplay({ status: 'ready' }).label, 'Оновлення завантажено й перевірено')
})

test('unknown progress is represented without a percentage', () => {
  const progressSource = readFileSync(new URL('../../src/components/ReleaseUpdateDetails.tsx', import.meta.url), 'utf8')
  assert.match(progressSource, /total > 0 && <strong>\{percent\}%<\/strong>/)
  assert.match(progressSource, /Завантажено \{format\(received\)\}/)
})
