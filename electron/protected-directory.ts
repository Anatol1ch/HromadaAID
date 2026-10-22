import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function securePrivateDirectory(directory: string): void {
  const existing = existsSync(directory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Захищений каталог не може бути символічним посиланням.')
  if (process.platform !== 'win32') { chmodSync(directory, 0o700); return }
  const whoami = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] })
  const sid = whoami.match(/\bS-\d-(?:\d+-)+\d+\b/)?.[0]
  if (!sid) throw new Error('Не вдалося визначити власника захищеного каталогу.')
  execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { windowsHide: true, timeout: 10_000, stdio: 'ignore' })
  if (existing) {
    // Inspect only identities, never file contents. Remove pre-existing explicit
    // grants to other accounts as well as inherited grants removed above.
    const script = "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'); $directory=[Console]::In.ReadToEnd(); (Get-Acl -LiteralPath $directory).Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Select-Object -Unique"
    const identities = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { input: directory, encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)
    for (const identity of identities) {
      if (!/^S-\d-(?:\d+-)+\d+$/.test(identity)) throw new Error('Не вдалося перевірити права захищеного каталогу.')
      if (![sid, 'S-1-5-18', 'S-1-5-32-544'].includes(identity)) execFileSync('icacls.exe', [directory, '/remove:g', `*${identity}`], { windowsHide: true, timeout: 10_000, stdio: 'ignore' })
      execFileSync('icacls.exe', [directory, '/remove:d', `*${identity}`], { windowsHide: true, timeout: 10_000, stdio: 'ignore' })
    }
  }
  // Set inheritance on children separately: recursively applying directory-only
  // (OI)(CI) grants with /inheritance:r can leave a regular file with an empty DACL.
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Захищений каталог містить символічне посилання.')
    execFileSync('icacls.exe', [join(directory, entry.name), '/reset', '/T', '/C', '/L'], { windowsHide: true, timeout: 10_000, stdio: 'ignore' })
  }
}
