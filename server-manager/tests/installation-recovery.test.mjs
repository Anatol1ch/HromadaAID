import test from 'node:test'
import assert from 'node:assert/strict'

const { canResumeInitialInstallLayout, isInitialInstallRetryJournal } = await import('../../dist-server-manager/main/installation-recovery.js')
const program = 'D:\\Застосунки HromadaAID'
const valid = { formatVersion: 1, phase: 'initial-install-needs-review', programDirectory: program, hadPreviousPackage: false }

test('only a matching failed first-install journal authorizes retry over package files', () => {
  assert.equal(isInitialInstallRetryJournal(valid, program), true)
  assert.equal(isInitialInstallRetryJournal({ ...valid, programDirectory: 'E:\\Other' }, program), false)
  assert.equal(isInitialInstallRetryJournal({ ...valid, phase: 'new-package-active' }, program), false)
  assert.equal(isInitialInstallRetryJournal({ ...valid, hadPreviousPackage: true }, program), false)
  assert.equal(isInitialInstallRetryJournal(null, program), false)
})

test('partial first install can be retried from an active package only with its matching review journal', () => {
  const base = { retryJournal: true, stagedPackageExists: false, activePackageExists: true, previousPackageExists: false, failedPackageExists: false }
  assert.equal(canResumeInitialInstallLayout(base), true)
  assert.equal(canResumeInitialInstallLayout({ ...base, retryJournal: false }), false)
  assert.equal(canResumeInitialInstallLayout({ ...base, previousPackageExists: true }), false)
  assert.equal(canResumeInitialInstallLayout({ ...base, activePackageExists: false }), false)
  assert.equal(canResumeInitialInstallLayout({ ...base, stagedPackageExists: true }), true)
  assert.equal(canResumeInitialInstallLayout({ ...base, retryJournal: false, stagedPackageExists: true, activePackageExists: false }), true)
})
