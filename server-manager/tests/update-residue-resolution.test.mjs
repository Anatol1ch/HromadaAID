import assert from 'node:assert/strict'
import { mkdtemp, mkdir, lstat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { archiveUpdateResidues, residueResolutionBlockReason } from '../electron/update-residue-resolution.mjs'

const good = {
  operationBusy: false, journalExists: false, restorePending: false, administrator: true,
  installationInstalled: true, discoveryConfirmed: true, serviceRunning: true,
  serviceUsesActivePackage: true, apiAvailable: true, apiContractMatches: true,
  activePackageIntegrityVerified: true, lockExists: false,
}
const id = '12345678-1234-1234-1234-123456789abc'

async function fixture(names = ['Server.previous']) {
  const root = await mkdtemp(join(tmpdir(), 'hromadaaid-residue-resolution-'))
  const programDirectory = join(root, 'Program')
  await mkdir(programDirectory)
  const artifacts = []
  for (const name of names) {
    const path = join(programDirectory, name)
    await mkdir(path)
    await (await import('node:fs/promises')).writeFile(join(path, 'sentinel.txt'), `preserve ${name}`)
    artifacts.push({ name, path, kind: 'directory' })
  }
  return { root, programDirectory, artifacts }
}
async function cleanup(root) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir())), 'temporary fixture cleanup must remain in OS temp')
  assert.ok((await lstat(root)).isDirectory())
  await rm(root, { recursive: true })
}

test('healthy active package with orphaned directories is eligible for confirmed archiving', async () => {
  const why = residueResolutionBlockReason(good)
  assert.equal(why, '')
  const f = await fixture(['Server.previous', 'Server.failed'])
  try {
    const result = await archiveUpdateResidues({ ...f, checks: good, confirmed: true, operationId: id })
    assert.deepEqual(result.moved, ['Server.previous', 'Server.failed'])
    assert.equal(await readFile(join(result.archiveDirectory, 'Server.previous', 'sentinel.txt'), 'utf8'), 'preserve Server.previous')
    assert.equal(await readFile(join(result.archiveDirectory, 'Server.failed', 'sentinel.txt'), 'utf8'), 'preserve Server.failed')
  } finally { await cleanup(f.root) }
})

test('unhealthy active server blocks without moving files', async () => {
  const f = await fixture()
  try {
    await assert.rejects(archiveUpdateResidues({ ...f, checks: { ...good, serviceRunning: false }, confirmed: true, operationId: id }), /справний активний сервер/)
    assert.equal(await readFile(join(f.programDirectory, 'Server.previous', 'sentinel.txt'), 'utf8'), 'preserve Server.previous')
  } finally { await cleanup(f.root) }
})

test('an existing operation journal blocks residue resolution', async () => {
  const f = await fixture()
  try {
    await assert.rejects(archiveUpdateResidues({ ...f, checks: { ...good, journalExists: true }, confirmed: true, operationId: id }), /журнал оновлення/)
    assert.equal(await lstat(join(f.programDirectory, 'Server.previous')).then(() => true), true)
  } finally { await cleanup(f.root) }
})

test('unexpected and escaping paths are rejected', async () => {
  const f = await fixture()
  try {
    await assert.rejects(archiveUpdateResidues({ ...f, artifacts: [{ ...f.artifacts[0], path: join(f.root, 'Server.previous') }], checks: good, confirmed: true, operationId: id }), /Шлях службового каталогу/)
    await assert.rejects(archiveUpdateResidues({ ...f, artifacts: [{ ...f.artifacts[0], name: 'Server.other' }], checks: good, confirmed: true, operationId: id }), /невідомий або небезпечний/)
  } finally { await cleanup(f.root) }
})

test('a concurrent system operation blocks before any file movement', async () => {
  const f = await fixture()
  try {
    await assert.rejects(archiveUpdateResidues({ ...f, checks: { ...good, operationBusy: true }, confirmed: true, operationId: id }), /інша системна операція/)
    assert.equal(await readFile(join(f.programDirectory, 'Server.previous', 'sentinel.txt'), 'utf8'), 'preserve Server.previous')
  } finally { await cleanup(f.root) }
})

test('filesystem rename failure preserves source and releases the operation lock', async () => {
  const f = await fixture()
  try {
    await assert.rejects(archiveUpdateResidues({ ...f, checks: good, confirmed: true, operationId: id, io: { rename: async () => { throw Object.assign(new Error('injected filesystem failure'), { code: 'EACCES' }) } } }), /Файли залишено без змін/)
    assert.equal(await readFile(join(f.programDirectory, 'Server.previous', 'sentinel.txt'), 'utf8'), 'preserve Server.previous')
    await assert.rejects(lstat(join(f.programDirectory, '.hromadaaid-update-residue-resolution.lock')), { code: 'ENOENT' })
  } finally { await cleanup(f.root) }
})

test('partial archive failure retains moved items and leaves remaining items in place', async () => {
  const f = await fixture(['Server.previous', 'Server.failed'])
  let calls = 0
  try {
    await assert.rejects(archiveUpdateResidues({ ...f, checks: good, confirmed: true, operationId: id, io: { rename: async (source, target) => {
      calls++
      if (calls === 2) throw Object.assign(new Error('injected second rename failure'), { code: 'EACCES' })
      return (await import('node:fs/promises')).rename(source, target)
    } } }), /Переміщено до архіву: Server.previous/)
    assert.equal(await readFile(join(f.programDirectory, 'HromadaAID-Update-Residue-Archive', `operation-${id}`, 'Server.previous', 'sentinel.txt'), 'utf8'), 'preserve Server.previous')
    assert.equal(await readFile(join(f.programDirectory, 'Server.failed', 'sentinel.txt'), 'utf8'), 'preserve Server.failed')
  } finally { await cleanup(f.root) }
})

test('confirmed resolution archives artifacts and leaves original update directories absent', async () => {
  const f = await fixture(['Server.next', 'Server.previous', 'Server.failed'])
  try {
    const result = await archiveUpdateResidues({ ...f, checks: good, confirmed: true, operationId: id })
    assert.equal(result.success, true)
    for (const name of ['Server.next', 'Server.previous', 'Server.failed']) {
      await assert.rejects(lstat(join(f.programDirectory, name)), { code: 'ENOENT' })
      assert.equal(await readFile(join(result.archiveDirectory, name, 'sentinel.txt'), 'utf8'), `preserve ${name}`)
    }
  } finally { await cleanup(f.root) }
})
