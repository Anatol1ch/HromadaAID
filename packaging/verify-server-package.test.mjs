import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyServerPackage } from './verify-server-package.mjs'

test('server package verifier accepts a complete synthetic package and rejects changed or missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-package-verify-'))
  try {
    await mkdir(join(root, 'runtime'))
    const content = Buffer.from('synthetic runtime file')
    await writeFile(join(root, 'runtime', 'node.exe'), content)
    const manifest = { formatVersion: 1, files: [{ path: 'runtime/node.exe', sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }] }
    await writeFile(join(root, 'package-integrity.json'), JSON.stringify(manifest))
    assert.equal((await verifyServerPackage(root)).files.length, 1)
    await writeFile(join(root, 'runtime', 'node.exe'), 'changed')
    await assert.rejects(verifyServerPackage(root), /не пройшов перевірку цілісності/)
    await rm(join(root, 'runtime', 'node.exe'))
    await assert.rejects(verifyServerPackage(root), /відсутній файл/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('server package verifier rejects traversal paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-package-verify-'))
  try {
    await writeFile(join(root, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: [{ path: '../outside', sizeBytes: 0, sha256: '0'.repeat(64) }] }))
    await assert.rejects(verifyServerPackage(root), /некоректний шлях/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
