// Headless tests only: resolve NodeNext .js imports to their TypeScript sources.
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith('file:') && specifier.startsWith('.') && specifier.endsWith('.js')) {
    const source = new URL(specifier.slice(0,-3)+'.ts', context.parentURL)
    if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context)
  }
  return nextResolve(specifier, context)
}, load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    return { format: 'module', source, shortCircuit: true }
  }
  return nextLoad(url, context)
} })
