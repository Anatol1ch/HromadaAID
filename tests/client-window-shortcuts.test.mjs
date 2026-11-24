import test from 'node:test'
import assert from 'node:assert/strict'
import { getClientWindowAction } from '../electron/window-shortcuts.ts'

const key = (overrides = {}) => ({ type: 'keyDown', key: '', code: '', control: true, meta: false, shift: false, alt: false, ...overrides })

test('client zoom shortcuts cover equal, plus, keypad, minus and reset keys', () => {
  assert.equal(getClientWindowAction(key({ key: '=', code: 'Equal' })), 'zoom-in')
  assert.equal(getClientWindowAction(key({ key: '+', code: 'Equal', shift: true })), 'zoom-in')
  assert.equal(getClientWindowAction(key({ key: '+', code: 'NumpadAdd' })), 'zoom-in')
  assert.equal(getClientWindowAction(key({ key: '-', code: 'Minus' })), 'zoom-out')
  assert.equal(getClientWindowAction(key({ key: '-', code: 'NumpadSubtract' })), 'zoom-out')
  assert.equal(getClientWindowAction(key({ key: '0', code: 'Digit0' })), 'zoom-reset')
  assert.equal(getClientWindowAction(key({ key: '0', code: 'Numpad0' })), 'zoom-reset')
})

test('client shortcuts preserve edit commands and ignore unrelated combinations', () => {
  assert.equal(getClientWindowAction(key({ key: 'c', code: 'KeyC' })), 'copy')
  assert.equal(getClientWindowAction(key({ key: 'v', code: 'KeyV' })), 'paste')
  assert.equal(getClientWindowAction(key({ key: 'x', code: 'KeyX' })), 'cut')
  assert.equal(getClientWindowAction(key({ key: 'a', code: 'KeyA' })), 'selectAll')
  assert.equal(getClientWindowAction(key({ key: 'z', code: 'KeyZ' })), 'undo')
  assert.equal(getClientWindowAction(key({ key: 'z', code: 'KeyZ', shift: true })), 'redo')
  assert.equal(getClientWindowAction(key({ key: '+', code: 'Equal', alt: true })), undefined)
  assert.equal(getClientWindowAction(key({ key: '+', code: 'Equal', control: false })), undefined)
  assert.equal(getClientWindowAction(key({ key: '0', code: 'Digit0', type: 'keyUp' })), undefined)
})
