// Headless tests only: resolve NodeNext .js imports to their TypeScript sources.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const records = new Set(['records-ipc', 'recipient-ipc', 'bank-ipc'].map(name => new URL('../electron/' + name + '.ts', import.meta.url).href))
const fake = new URL('./fakes/ipc-security.mjs', import.meta.url).href
registerHooks({ resolve(specifier, context, nextResolve) {
  if (records.has(context.parentURL) && specifier === './ipc-security.js') return nextResolve(fake, context)
  if (context.parentURL?.startsWith('file:') && specifier.startsWith('.') && specifier.endsWith('.js')) {
    const source = new URL(specifier.slice(0,-3)+'.ts', context.parentURL)
    if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context)
  }
  return nextResolve(specifier, context)
} })
