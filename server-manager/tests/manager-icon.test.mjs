import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Manager reuses the Client brand, adds a wrench and ships distinct multi-size native icons', () => {
  const svg = readFileSync('assets/hromadaaid-server-manager.svg', 'utf8')
  const client = readFileSync('assets/hromadaaid.svg', 'utf8')
  assert.ok(svg.includes(/<path d="([^"]+)"/.exec(client)[1]))
  assert.match(svg, /fill="#286343"/)
  assert.equal((svg.match(/<path /g) ?? []).length, 2)
  const ico = readFileSync('assets/hromadaaid-server-manager.ico')
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 7)
  const sizes = []
  for (let i = 0; i < 7; i++) {
    const header = 6 + i * 16, size = ico[header] || 256, length = ico.readUInt32LE(header + 8), offset = ico.readUInt32LE(header + 12)
    assert.equal(size, ico[header + 1] || 256)
    assert.ok(offset + length <= ico.length)
    assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a')
    sizes.push(size)
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])
  assert.notDeepEqual(ico, readFileSync('assets/hromadaaid.ico'))
  const config = readFileSync('server-manager/electron-builder.yml', 'utf8')
  assert.match(config, /icon: assets\/hromadaaid-server-manager.ico/)
  assert.match(config, /installerIcon: assets\/hromadaaid-server-manager.ico/)
  assert.match(readFileSync('server-manager/electron/main.ts', 'utf8'), /icon: app\.isPackaged.*hromadaaid-server-manager.ico/)
})
