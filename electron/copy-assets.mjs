import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'dist-electron')
const outputReference = join(output, 'reference')
mkdirSync(outputReference, { recursive: true })
copyFileSync(join(root, 'electron', 'excel-templates.ps1'), join(output, 'excel-templates.ps1'))
copyFileSync(join(root, 'electron', 'excel-privatbank.ps1'), join(output, 'excel-privatbank.ps1'))
copyFileSync(join(root, 'electron', 'excel-report.ps1'), join(output, 'excel-report.ps1'))
copyFileSync(join(root, 'reference', 'Список.xlsx'), join(outputReference, 'Список.xlsx'))
copyFileSync(join(root, 'reference', 'Зведений список.xlsx'), join(outputReference, 'Зведений список.xlsx'))
copyFileSync(join(root, 'reference', 'ПриватБанк.xlsx'), join(outputReference, 'ПриватБанк.xlsx'))

const outputAssets = join(output, 'assets')
mkdirSync(outputAssets, { recursive: true })
for (const extension of ['ico', 'png', 'svg']) {
  copyFileSync(join(root, 'assets', `hromadaaid.${extension}`), join(outputAssets, `hromadaaid.${extension}`))
}
