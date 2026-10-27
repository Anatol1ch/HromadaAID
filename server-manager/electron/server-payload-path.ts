import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Select only payload roots that carry integrity metadata; helpers alone are not a server package. */
export function resolvePackagedServerPayloadRoot(resourcesPath: string, applicationPath: string): string {
  const bundled = join(resourcesPath, 'server-payload')
  if (existsSync(join(bundled, 'package-integrity.json'))) return bundled

  const installRoot = resolve(dirname(dirname(dirname(applicationPath))))
  const staged = join(installRoot, 'Server.next')
  if (existsSync(join(staged, 'package-integrity.json'))) return staged

  throw new Error('Не знайдено повний перевірений пакет сервера: відсутній package-integrity.json у комплектному payload і Server.next.')
}
