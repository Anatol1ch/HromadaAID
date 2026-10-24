import test from 'node:test'
import assert from 'node:assert/strict'

const { isInitialInstallRetryJournal } = await import('../../dist-server-manager/main/installation-recovery.js')
const program = 'D:\\Застосунки HromadaAID'
const valid = { formatVersion: 1, phase: 'initial-install-needs-review', programDirectory: program, hadPreviousPackage: false }

test('only a matching failed first-install journal authorizes retry over package files', () => {
  assert.equal(isInitialInstallRetryJournal(valid, program), true)
  assert.equal(isInitialInstallRetryJournal({ ...valid, programDirectory: 'E:\\Other' }, program), false)
  assert.equal(isInitialInstallRetryJournal({ ...valid, phase: 'new-package-active' }, program), false)
  assert.equal(isInitialInstallRetryJournal({ ...valid, hadPreviousPackage: true }, program), false)
  assert.equal(isInitialInstallRetryJournal(null, program), false)
})
