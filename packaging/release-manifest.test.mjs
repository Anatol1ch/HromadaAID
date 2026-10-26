import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReleaseManifest, verifyReleaseManifest, writeReleaseManifest } from './release-manifest.mjs'

test('release manifest records only the universal setup and existing server ZIP and verifies real hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hromada-release-manifest-'))
  try {
    await writeFile(join(directory, 'HromadaAID-Setup-1.2.3.exe'), Buffer.from('synthetic setup'))
    await writeFile(join(directory, 'HromadaAID-Server-v1.2.3-win-x64.zip'), Buffer.from('synthetic server zip with embedded package-integrity'))
    const value = await createReleaseManifest(directory, '1.2.3')
    assert.deepEqual(value.artifacts.map(item => item.component), ['installer', 'server'])
    assert.equal(value.artifacts[1].packageIntegrity, 'embedded-package-integrity-v1')
    assert.equal(await verifyReleaseManifest(directory, value), true)
    await assert.rejects(verifyReleaseManifest(directory, { ...value, compatibility: { ...value.compatibility, manager: { ...value.compatibility.manager, apiContractVersion: 2 } } }), /сумісності/)
    await writeReleaseManifest(directory, '1.2.3')
    await assert.rejects(writeReleaseManifest(directory, '1.2.3'), /EEXIST/)
    await writeFile(join(directory, 'HromadaAID-Server-v1.2.3-win-x64.zip'), 'modified')
    await assert.rejects(verifyReleaseManifest(directory, value), /SHA-256/)
    await assert.rejects(createReleaseManifest(directory, '1.2.4-rc.1'), /стабільної версії/)
    assert.equal(JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8')).version, '1.2.3')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
