import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNetworkAddresses, readNetworkAddresses, createAddressCopyHandler } from '../../dist-server-manager/main/network-addresses.js'

test('Windows adapter metadata tolerates Tailscale naming variants and requires trusted identity', () => {
  const result = parseNetworkAddresses([
    { alias: 'Ethernet', description: 'Intel Ethernet', pnpDeviceId: 'PCI\\VEN_1234', status: 'Up', physical: true, addresses: ['192.168.1.10', '192.168.1.11', '::1', '0.0.0.0', '127.0.0.1'] },
    { alias: 'Wi-Fi', description: 'Wi-Fi Adapter', pnpDeviceId: 'PCI\\VEN_5678', status: 'Up', physical: true, addresses: ['192.168.2.10', '192.168.1.10'] },
    { alias: 'Tailscale', description: 'Wintun Userspace Tunnel', pnpDeviceId: 'SWD\\Wintun\\{A1}', status: 'Up', physical: false, addresses: ['100.64.1.2'] },
    { alias: 'Mesh VPN', description: 'Tailscale Tunnel #2 (Wintun)', pnpDeviceId: 'SWD\\Wintun\\{A2}', status: 'Up', physical: false, addresses: ['100.101.102.103', '192.168.3.10'] },
    { alias: 'WireGuard', description: 'Wintun Userspace Tunnel', pnpDeviceId: 'SWD\\Wintun\\{A3}', status: 'Up', physical: false, addresses: ['100.70.1.2'] },
    { alias: 'Tailscale', description: 'Renamed physical card', pnpDeviceId: 'PCI\\VEN_9999', status: 'Up', physical: true, addresses: ['100.80.1.2'] },
    { alias: 'Tailscale VPN', description: 'Tailscale Tunnel', pnpDeviceId: 'SWD\\Wintun\\{A4}', status: 'Disconnected', physical: false, addresses: ['100.90.1.2'] },
    { alias: 'Tailscale', description: 'Tailscale Tunnel', pnpDeviceId: 'SWD\\Wintun\\{A5}', status: 'Up', physical: false, addresses: [] },
    { alias: 'vEthernet', description: 'Hyper-V Virtual Ethernet Adapter', pnpDeviceId: 'VMS_MP', status: 'Up', physical: false, addresses: ['172.18.1.1'] },
  ])
  assert.deepEqual(result, {
    lan: ['http://100.80.1.2:4310', 'http://192.168.1.10:4310', 'http://192.168.1.11:4310', 'http://192.168.2.10:4310'],
    tailscale: ['http://100.101.102.103:4310', 'http://100.64.1.2:4310'],
    unavailable: false,
  })
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
