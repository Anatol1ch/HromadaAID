import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyClientZoomAction, clampClientZoomLevel, isValidClientZoomFactor, readClientZoomPreference, setClientWindowZoomFactor, writeClientZoomPreference } from './client-zoom-preference.js'

test('validates finite zoom factors within the supported range', () => {
  for (const factor of [0.5, 0.8, 1, 1.5, 2]) assert.equal(isValidClientZoomFactor(factor), true)
  for (const factor of [NaN, Infinity, -Infinity, 0.49, 2.01, '1', null]) assert.equal(isValidClientZoomFactor(factor), false)
})

test('clamps keyboard zoom levels to supported Electron zoom-factor bounds', () => {
  assert.equal(clampClientZoomLevel(-100), Math.log(0.5) / Math.log(1.2))
  assert.equal(clampClientZoomLevel(100), Math.log(2) / Math.log(1.2))
  assert.equal(clampClientZoomLevel(Number.NaN), 0)
})

test('settings zoom actions use the Electron keyboard step and reset to 100%', () => {
  let level = 0
  const contents = { getZoomLevel: () => level, setZoomLevel: (value: number) => { level = value }, getZoomFactor: () => Math.pow(1.2, level) }
  assert.equal(applyClientZoomAction(contents, 'increase'), Math.pow(1.2, 0.5))
  assert.equal(level, 0.5)
  assert.equal(applyClientZoomAction(contents, 'decrease'), 1)
  assert.equal(level, 0)
  applyClientZoomAction(contents, 'increase')
  assert.equal(applyClientZoomAction(contents, 'reset'), 1)
  assert.equal(level, 0)
})

test('persists and restores zoom preference; invalid data falls back to 100%', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hromadaaid-zoom-'))
  try {
    assert.equal(await readClientZoomPreference(directory), 1)
    await writeClientZoomPreference(directory, 1.25)
    assert.equal(await readClientZoomPreference(directory), 1.25)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'client-zoom.json'), 'utf8')), { version: 1, factor: 1.25 })
    await writeClientZoomPreference(directory, 0.75)
    assert.equal(await readClientZoomPreference(directory), 0.75)
    await assert.rejects(writeClientZoomPreference(directory, Number.NaN))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('window zoom bridge applies only validated values and persists the Electron result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hromadaaid-zoom-ipc-'))
  let currentFactor = 1
  let calls = 0
  const window = { webContents: { setZoomFactor: (factor: number) => { calls += 1; currentFactor = factor }, getZoomFactor: () => currentFactor } }
  try {
    assert.equal(await setClientWindowZoomFactor(window, 1.1, factor => writeClientZoomPreference(directory, factor)), 1.1)
    assert.equal(await readClientZoomPreference(directory), 1.1)
    await assert.rejects(setClientWindowZoomFactor(window, Infinity, factor => writeClientZoomPreference(directory, factor)))
    assert.equal(calls, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
