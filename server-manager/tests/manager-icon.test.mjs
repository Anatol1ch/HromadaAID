import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Manager uses a white wrench on the brand green without the Client symbol', () => {
  const svg = readFileSync('assets/hromadaaid-server-manager.svg', 'utf8')
  const client = readFileSync('assets/hromadaaid.svg', 'utf8')
  assert.equal(svg.includes(/<path d="([^"]+)"/.exec(client)[1]), false)
  assert.match(svg, /fill="#286343"/)
  assert.equal((svg.match(/<path /g) ?? []).length, 1)
  assert.match(svg, /fill="#fff"/)
  assert.doesNotMatch(svg, /<text|<circle|heart-handshake/i)
})

test('both native icons contain valid PNG frames at every required size and their sources remain distinct', () => {
  for (const name of ['hromadaaid', 'hromadaaid-server-manager']) {
    const png = readFileSync(`assets/${name}.png`)
    assert.equal(png.readUInt32BE(16), 512)
    assert.equal(png.readUInt32BE(20), 512)
    const ico = readFileSync(`assets/${name}.ico`)
    assert.equal(ico.readUInt16LE(0), 0)
    assert.equal(ico.readUInt16LE(2), 1)
    assert.equal(ico.readUInt16LE(4), 7)
    const sizes = []
    let nextOffset = 6 + 7 * 16
    for (let i = 0; i < 7; i++) {
      const header = 6 + i * 16, size = ico[header] || 256, length = ico.readUInt32LE(header + 8), offset = ico.readUInt32LE(header + 12)
      assert.equal(size, ico[header + 1] || 256)
      assert.ok(offset + length <= ico.length)
      assert.equal(offset, nextOffset)
      assert.ok([0, 1].includes(ico.readUInt16LE(header + 4)))
      assert.equal(ico.readUInt16LE(header + 6), 32)
      assert.equal(ico.readUInt32BE(offset + 16), size)
      assert.equal(ico.readUInt32BE(offset + 20), size)
      nextOffset = offset + length
      assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a')
      sizes.push(size)
    }
    assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])
    assert.equal(nextOffset, ico.length)
  }
  assert.notDeepEqual(readFileSync('assets/hromadaaid-server-manager.ico'), readFileSync('assets/hromadaaid.ico'))
})

test('Electron EXE/runtime resources and stable AppUserModelIDs agree for each application', () => {
  const client = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(client.productName, 'HromadaAID')
  assert.equal(client.build.appId, 'local.hromadaaid')
  assert.equal(client.build.win.icon, 'assets/hromadaaid.ico')
  assert.match(readFileSync('electron/main.ts', 'utf8'), /setAppUserModelId\('local.hromadaaid'\)/)
  assert.match(readFileSync('electron/main.ts', 'utf8'), /icon: join\(iconDirectory,.*'hromadaaid.ico'/)
  assert.deepEqual(client.build.extraResources[0].filter, ['hromadaaid.ico', 'hromadaaid.png', 'hromadaaid.svg'])
  const config = readFileSync('server-manager/electron-builder.yml', 'utf8')
  assert.match(config, /^appId: local.hromadaaid.server-manager$/m)
  assert.match(config, /icon: assets\/hromadaaid-server-manager.ico/)
  assert.match(config, /installerIcon: assets\/hromadaaid-server-manager.ico/)
  assert.match(readFileSync('server-manager/electron/main.ts', 'utf8'), /icon: app\.isPackaged.*hromadaaid-server-manager.ico/)
  assert.match(readFileSync('server-manager/electron/main.ts', 'utf8'), /setAppUserModelId\('local.hromadaaid.server-manager'\)/)
  assert.match(readFileSync('server-manager/src/App.tsx', 'utf8'), /import managerIcon from '..\/..\/assets\/hromadaaid-server-manager.svg'/)
  for (const extension of ['ico', 'png', 'svg']) assert.match(config, new RegExp(`- hromadaaid-server-manager\\.${extension}`))
})
