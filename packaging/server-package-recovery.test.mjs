import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateServerPackage, finalizePackageRecovery, inspectPackageRecovery, preparePackageUpdate, recoverPackageRollback } from './server-package-transaction.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hromada-package-recovery-'))
  const f = { root, programDirectory: join(root, 'program'), dataDirectory: join(root, 'data'), schemaVersion: 28 }
  mkdirSync(f.dataDirectory, { recursive: true })
  for (const [name, content] of [['Server', 'old'], ['Server.next', 'new']]) {
    mkdirSync(join(f.programDirectory, name), { recursive: true })
    writeFileSync(join(f.programDirectory, name, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, testContent: content }))
    writeFileSync(join(f.programDirectory, name, 'app.txt'), content)
  }
  writeFileSync(join(f.dataDirectory, 'synthetic.sqlite'), 'database sentinel')
  writeFileSync(join(f.dataDirectory, 'server.json'), 'configuration sentinel')
  writeFileSync(join(f.dataDirectory, '.dpapi'), 'key sentinel')
  preparePackageUpdate({ ...f, hadPreviousPackage: true, oldSchemaMaximum: 28, schemaBeforeActivation: 28, serviceWasRunning: true })
  return f
}
function cleanup(f) { assert.ok(f.root.startsWith(join(tmpdir(), 'hromada-package-recovery-'))); rmSync(f.root, { recursive: true, force: true }) }
const journalPath = f => join(f.dataDirectory, '.hromadaaid-update-state.json')

for (const phase of ['prepared', 'old-renamed', 'candidate-active', 'candidate-renamed-for-rollback', 'previous-restored-before-journal']) {
  test(`interrupted update reconciles ${phase} and retains candidates until confirmed health`, () => {
    const f = fixture()
    try {
      if (phase === 'old-renamed') renameSync(join(f.programDirectory, 'Server'), join(f.programDirectory, 'Server.previous'))
      if (!['prepared', 'old-renamed'].includes(phase)) activateServerPackage(f)
      if (['candidate-renamed-for-rollback', 'previous-restored-before-journal'].includes(phase)) renameSync(join(f.programDirectory, 'Server'), join(f.programDirectory, 'Server.failed'))
      if (phase === 'previous-restored-before-journal') renameSync(join(f.programDirectory, 'Server.previous'), join(f.programDirectory, 'Server'))
      recoverPackageRollback(f)
      assert.equal(readFileSync(join(f.programDirectory, 'Server', 'app.txt'), 'utf8'), 'old')
      assert.ok(existsSync(journalPath(f)))
      assert.ok(existsSync(join(f.programDirectory, phase === 'prepared' || phase === 'old-renamed' ? 'Server.next' : 'Server.failed')))
      finalizePackageRecovery({ ...f, outcome: 'previous' })
      assert.equal(existsSync(journalPath(f)), false)
      for (const [file, content] of [['synthetic.sqlite', 'database sentinel'], ['server.json', 'configuration sentinel'], ['.dpapi', 'key sentinel']]) assert.equal(readFileSync(join(f.dataDirectory, file), 'utf8'), content)
    } finally { cleanup(f) }
  })
}

test('verified healthy candidate completes without rolling back, including a crash after previous cleanup', () => {
  const f = fixture()
  try {
    activateServerPackage(f)
    assert.equal(inspectPackageRecovery(f).active, 'candidate')
    const record = JSON.parse(readFileSync(journalPath(f), 'utf8'))
    record.phase = 'healthy'; writeFileSync(journalPath(f), JSON.stringify(record))
    rmSync(join(f.programDirectory, 'Server.previous'), { recursive: true })
    finalizePackageRecovery({ ...f, outcome: 'candidate' })
    assert.equal(readFileSync(join(f.programDirectory, 'Server', 'app.txt'), 'utf8'), 'new')
    assert.equal(existsSync(journalPath(f)), false)
  } finally { cleanup(f) }
})

test('ambiguous directories, corrupted journal and incompatible SQLite preserve all recovery artifacts', () => {
  const f = fixture()
  try {
    activateServerPackage(f)
    assert.throws(() => recoverPackageRollback({ ...f, schemaVersion: 29 }), /SQLite/)
    writeFileSync(join(f.programDirectory, 'Server.previous', 'package-integrity.json'), 'unknown manifest')
    assert.throws(() => inspectPackageRecovery(f), /не відповідає/)
    assert.ok(existsSync(join(f.programDirectory, 'Server.previous')))
    assert.ok(existsSync(join(f.programDirectory, 'Server')))
    writeFileSync(journalPath(f), '{invalid')
    assert.throws(() => inspectPackageRecovery(f), /некоректний/)
    assert.ok(existsSync(journalPath(f)))
  } finally { cleanup(f) }
})

test('legacy journal roles can be inferred only before unambiguous rollback renames', () => {
  const f = fixture()
  try {
    activateServerPackage(f)
    const record = JSON.parse(readFileSync(journalPath(f), 'utf8'))
    delete record.previousIdentity; delete record.candidateIdentity
    writeFileSync(journalPath(f), JSON.stringify(record))
    recoverPackageRollback(f)
    assert.equal(inspectPackageRecovery(f).active, 'previous', 'identities persist before rollback, closing rename crash gaps')
    finalizePackageRecovery({ ...f, outcome: 'previous' })
  } finally { cleanup(f) }
})
