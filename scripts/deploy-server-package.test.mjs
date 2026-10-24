import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('production dependencies install from the lockfile into an isolated flat tree on Windows and other hosts', async () => {
  const script = await readFile(new URL('./deploy-server-package.mjs', import.meta.url), 'utf8')
  assert.match(script, /'--config\.node-linker=hoisted'/)
  assert.match(script, /'install'.*'--filter'.*'@hromadaaid\/server'.*'--prod'.*'--frozen-lockfile'/s)
  assert.match(script, /\['install', '--filter', '@hromadaaid\/server', '--prod', '--config\.node-linker=hoisted', '--frozen-lockfile'\]/)
  assert.match(script, /copyRequired\(workspaceModules, join\(deployed, 'node_modules'\)\)/)
  assert.match(script, /assertNoLinks\(deployed\)/)
  assert.match(script, /'@phc\/format\/package\.json'/)
})
