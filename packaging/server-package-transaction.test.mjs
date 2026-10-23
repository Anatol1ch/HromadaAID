import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activateServerPackage, finalizePackageRollback, finalizePackageUpdate, markPackageHealthy,
  markPackageHealthCheck, markInitialInstallNeedsReview, preparePackageUpdate, rollbackServerPackage,
} from './server-package-transaction.mjs'

function fixture(hadPreviousPackage = true) {
  const root = mkdtempSync(join(tmpdir(), 'hromada-server-update-'))
  const programDirectory = join(root, 'program'), dataDirectory = join(root, 'data')
  mkdirSync(dataDirectory, { recursive: true }); mkdirSync(programDirectory, { recursive: true })
  if (hadPreviousPackage) {
    mkdirSync(join(programDirectory, 'Server', 'service'), { recursive: true })
    writeFileSync(join(programDirectory, 'Server', 'service', 'config.xml'), 'old service configuration')
    writeFileSync(join(programDirectory, 'Server', 'runtime.bin'), 'old package')
  }
  mkdirSync(join(programDirectory, 'Server.next', 'service'), { recursive: true })
  writeFileSync(join(programDirectory, 'Server.next', 'service', 'config.xml'), 'new service configuration')
  writeFileSync(join(programDirectory, 'Server.next', 'runtime.bin'), 'new package')
  const databasePath = join(dataDirectory, 'synthetic.sqlite'), keyPath = join(dataDirectory, 'synthetic.dpapi')
  writeFileSync(databasePath, 'synthetic database stays unchanged'); writeFileSync(keyPath, 'synthetic key stays unchanged')
  return { root, programDirectory, dataDirectory, databasePath, keyPath }
}

function prepare(f, hadPreviousPackage = true) {
  preparePackageUpdate({ programDirectory: f.programDirectory, dataDirectory: f.dataDirectory, hadPreviousPackage, oldSchemaMaximum: hadPreviousPackage ? 28 : 0, schemaBeforeActivation: hadPreviousPackage ? 28 : 28, serviceWasRunning: hadPreviousPackage })
}

test('activation preserves complete old package until new health succeeds, then commits new package', () => {
  const f = fixture()
  try {
    prepare(f)
    activateServerPackage(f)
    assert.equal(readFileSync(join(f.programDirectory, 'Server.previous', 'runtime.bin'), 'utf8'), 'old package')
    assert.equal(readFileSync(join(f.programDirectory, 'Server.previous', 'service', 'config.xml'), 'utf8'), 'old service configuration')
    assert.equal(readFileSync(join(f.programDirectory, 'Server', 'runtime.bin'), 'utf8'), 'new package')
    assert.equal(JSON.parse(readFileSync(join(f.dataDirectory, '.hromadaaid-update-state.json'), 'utf8')).phase, 'new-package-active')
    markPackageHealthCheck(f.dataDirectory); markPackageHealthy(f.dataDirectory)
    finalizePackageUpdate(f)
    assert.equal(existsSync(join(f.programDirectory, 'Server.previous')), false)
    assert.equal(existsSync(join(f.dataDirectory, '.hromadaaid-update-state.json')), false)
    assert.equal(readFileSync(f.databasePath, 'utf8'), 'synthetic database stays unchanged')
    assert.equal(readFileSync(f.keyPath, 'utf8'), 'synthetic key stays unchanged')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('activation failure restores old files and WinSW configuration when schema is compatible', () => {
  const f = fixture()
  try {
    prepare(f)
    rmSync(join(f.programDirectory, 'Server.next'), { recursive: true, force: true })
    assert.throws(() => activateServerPackage(f), /не готовий/)
    rollbackServerPackage({ ...f, schemaVersion: 28 })
    assert.equal(readFileSync(join(f.programDirectory, 'Server', 'runtime.bin'), 'utf8'), 'old package')
    assert.equal(readFileSync(join(f.programDirectory, 'Server', 'service', 'config.xml'), 'utf8'), 'old service configuration')
    finalizePackageRollback(f)
    assert.equal(existsSync(join(f.dataDirectory, '.hromadaaid-update-state.json')), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('schema newer than previous package prevents rollback and keeps both packages plus journal', () => {
  const f = fixture()
  try {
    prepare(f); activateServerPackage(f)
    assert.throws(() => rollbackServerPackage({ ...f, schemaVersion: 29 }), /відкат зупинено/)
    assert.equal(existsSync(join(f.programDirectory, 'Server.previous')), true)
    assert.equal(readFileSync(join(f.programDirectory, 'Server', 'runtime.bin'), 'utf8'), 'new package')
    assert.equal(existsSync(join(f.dataDirectory, '.hromadaaid-update-state.json')), true)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('interrupted first install is journaled without treating an unverified package as successful', () => {
  const f = fixture(false)
  try {
    prepare(f, false); activateServerPackage(f)
    markInitialInstallNeedsReview(f.dataDirectory)
    const journal = JSON.parse(readFileSync(join(f.dataDirectory, '.hromadaaid-update-state.json'), 'utf8'))
    assert.equal(journal.phase, 'initial-install-needs-review')
    assert.equal(journal.hadPreviousPackage, false)
    assert.equal(existsSync(join(f.programDirectory, 'Server')), true)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
