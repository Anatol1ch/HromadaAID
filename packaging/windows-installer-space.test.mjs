import test from 'node:test'
import assert from 'node:assert/strict'
import { computeInstallerVolumeRequirements, formatBytes } from './windows-installer-space.mjs'

const base = {
  programDirectory: 'D:\\HromadaAID', dataDirectory: 'E:\\Дані HromadaAID',
  backupDirectory: 'E:\\Копії HromadaAID', temporaryDirectory: 'C:\\Users\\Test\\AppData\\Local\\Temp',
  clientBytes: 370 * 1024 * 1024, serverBytes: 114 * 1024 * 1024, supportBytes: 128 * 1024,
}

test('component modes include only selected payloads plus installer support on the temp volume', () => {
  const client = computeInstallerVolumeRequirements({ ...base, mode: 'client' })
  assert.equal(client.get('D:\\'), Math.ceil(base.clientBytes * 1.15))
  assert.equal(client.get('C:\\'), base.supportBytes + 8 * 1024 * 1024)
  assert.equal(client.has('E:\\'), false)
  const server = computeInstallerVolumeRequirements({ ...base, mode: 'server' })
  assert.equal(server.get('D:\\'), Math.ceil(base.serverBytes * 1.15))
  assert.equal(server.get('E:\\'), 32 * 1024 * 1024)
  const combined = computeInstallerVolumeRequirements({ ...base, mode: 'server-client' })
  assert.equal(combined.get('D:\\'), Math.ceil((base.clientBytes + base.serverBytes) * 1.15))
})

test('requirements on a shared volume are summed once', () => {
  const requirements = computeInstallerVolumeRequirements({ ...base, mode: 'server-client', dataDirectory: 'D:\\Серверні дані', backupDirectory: 'D:\\Резервні копії', temporaryDirectory: 'D:\\Temp' })
  assert.equal(requirements.size, 1)
  assert.equal(requirements.get('D:\\'), Math.ceil((base.clientBytes + base.serverBytes) * 1.15) + 40 * 1024 * 1024 + base.supportBytes)
})

test('Manager-only update reserves only the Manager payload and installer support', () => {
  const managerBytes = 90 * 1024 * 1024
  const requirements = computeInstallerVolumeRequirements({ ...base, mode: 'manager', managerBytes })
  assert.equal(requirements.get('D:\\'), Math.ceil(managerBytes * 1.15))
  assert.equal(requirements.has('E:\\'), false)
  assert.equal(requirements.get('C:\\'), base.supportBytes + 8 * 1024 * 1024)
})

test('insufficient space is reported against the specific volume requirement', () => {
  const needed = computeInstallerVolumeRequirements({ ...base, mode: 'server-client' })
  const available = new Map([['D:\\', needed.get('D:\\') - 1], ['E:\\', needed.get('E:\\')], ['C:\\', needed.get('C:\\') - 1]])
  const deficient = [...needed].filter(([volume, bytes]) => available.get(volume) < bytes).map(([volume]) => volume)
  assert.deepEqual(deficient, ['D:\\', 'C:\\'])
  assert.match(formatBytes(needed.get('D:\\')), /МіБ|ГіБ/)
})
