import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNetworkAddresses, readNetworkAddresses, createAddressCopyHandler } from '../../dist-server-manager/main/network-addresses.js'

test('addresses include all active physical interfaces; CGNAT or alias alone cannot identify Tailscale', () => {
  const result = parseNetworkAddresses([
    { description: 'Intel Ethernet', physical: true, addresses: ['192.168.1.10', '192.168.1.11', '::1', '0.0.0.0', '127.0.0.1'] },
    { description: 'Wi-Fi', physical: true, addresses: ['192.168.2.10', '192.168.1.10'] },
    { description: 'Wintun', alias: 'Tailscale', physical: false, addresses: ['100.64.1.2'] },
    { description: 'Hyper-V Virtual Ethernet Adapter', physical: false, addresses: ['172.18.1.1'] },
    { description: 'Tailscale Tunnel', physical: false, addresses: ['100.101.102.103', '192.168.3.10'] },
  ])
  assert.deepEqual(result, { lan: ['http://192.168.1.10:4310', 'http://192.168.1.11:4310', 'http://192.168.2.10:4310'], tailscale: ['http://100.101.102.103:4310'], unavailable: false })
})

test('no Tailscale, unsupported platform and failed Windows metadata queries remain nonfatal', async () => {
  assert.deepEqual(await readNetworkAddresses(async () => '[]', 'win32'), { lan: [], tailscale: [], unavailable: false })
  for (const query of [async () => { throw new Error('ETIMEDOUT') }, async () => '{invalid', async () => '{}']) {
    assert.deepEqual(await readNetworkAddresses(query, 'win32'), { lan: [], tailscale: [], unavailable: true })
  }
  assert.deepEqual(await readNetworkAddresses(async () => { assert.fail('must not query Windows on Linux') }, 'linux'), { lan: [], tailscale: [], unavailable: true })
})

test('address copy IPC requires trusted renderer and permits only current connection URLs', async () => {
  const copied = []
  let queries = 0
  const handler = createAddressCopyHandler(event => event === 'trusted', async () => { queries++; return { lan: ['http://192.168.1.10:4310'], tailscale: [], unavailable: false } }, text => copied.push(text))
  await assert.rejects(handler('untrusted', 'http://127.0.0.1:4310'), /UNTRUSTED_RENDERER/)
  assert.equal(queries, 0)
  for (const address of ['http://0.0.0.0:4310', 'http://100.64.1.2:4310', 'https://example.com', 'arbitrary clipboard text', null]) assert.equal(await handler('trusted', address), false)
  assert.equal(await handler('trusted', 'http://127.0.0.1:4310'), true)
  assert.equal(await handler('trusted', 'http://192.168.1.10:4310'), true)
  assert.deepEqual(copied, ['http://127.0.0.1:4310', 'http://192.168.1.10:4310'])
})
