import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyServerPackage } from './verify-server-package.mjs'
import { verifyServerRuntime } from './server-runtime-check.mjs'

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

test('server package verifier rejects a symlink even when the referenced files exist locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-package-link-'))
  try {
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime', 'node.exe'), 'synthetic runtime file')
    await writeFile(join(root, 'outside.txt'), 'synthetic target')
    await symlink(join(root, 'outside.txt'), join(root, 'runtime', 'external.txt'))
    await writeFile(join(root, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: [] }))
    await assert.rejects(verifyServerPackage(root), /посилання/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('packaged runtime smoke test detects a missing scoped transitive dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-runtime-verify-'))
  try {
    const app = join(root, 'app')
    const argon = join(app, 'node_modules', 'argon2')
    const fastify = join(app, 'node_modules', 'fastify')
    await mkdir(join(argon, 'node_modules', '@phc'), { recursive: true })
    await mkdir(fastify, { recursive: true })
    await mkdir(join(app, 'dist', 'server', 'src'), { recursive: true })
    await writeFile(join(app, 'package.json'), JSON.stringify({ type: 'commonjs' }))
    await writeFile(join(argon, 'package.json'), JSON.stringify({ main: 'index.js' }))
    await writeFile(join(argon, 'index.js'), "const phc = require('@phc/format'); module.exports = { hash: async () => phc.value, verify: async hash => hash === phc.value }\n")
    await writeFile(join(fastify, 'package.json'), JSON.stringify({ main: 'index.js' }))
    await writeFile(join(fastify, 'index.js'), "module.exports = () => ({ get() {}, ready: async () => {}, close: async () => {} })\n")
    await writeFile(join(app, 'dist', 'server', 'src', 'create-admin.js'), "console.log(JSON.stringify({users:0,schemaVersion:1,maximumSupportedSchemaVersion:28}))\n")

    assert.throws(() => verifyServerRuntime(root, { nodeExecutable: process.execPath }), /@phc\/format/)
    const phc = join(argon, 'node_modules', '@phc', 'format')
    await mkdir(phc, { recursive: true })
    await writeFile(join(phc, 'package.json'), JSON.stringify({ main: 'index.js' }))
    await writeFile(join(phc, 'index.js'), "exports.value = 'synthetic-phc-dependency'\n")
    const result = verifyServerRuntime(root, { nodeExecutable: process.execPath })
    assert.equal(result.users, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
