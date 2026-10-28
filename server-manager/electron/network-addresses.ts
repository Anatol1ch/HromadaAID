import { execFile } from 'node:child_process'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { NetworkAddresses } from './inspection-types.js'

// Read adapter identity and assigned IPv4 addresses together. An alias or CGNAT
// address alone does not identify Tailscale; generic virtual adapters are omitted.
export const networkAddressScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
$ipv4 = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.AddressState -eq 'Preferred' })
$result = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $adapter = $_
  $addresses = @($ipv4 | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex } | ForEach-Object { [string]$_.IPAddress })
  [pscustomobject]@{ description = [string]$adapter.InterfaceDescription; physical = [bool]$adapter.HardwareInterface; addresses = $addresses }
})
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 4))
`

export function parseNetworkAddresses(value: unknown): NetworkAddresses {
  if (!Array.isArray(value)) throw new Error('NETWORK_METADATA_INVALID')
  const lan = new Set<string>(), tailscale = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.description !== 'string' || typeof item.physical !== 'boolean' || !Array.isArray(item.addresses)) continue
    const identifiedTailscale = /^Tailscale(?: Tunnel)?(?: #\d+)?$/i.test(item.description)
    for (const address of item.addresses) {
      if (typeof address !== 'string' || isIP(address) !== 4) continue
      const [first, second] = address.split('.').map(Number)
      if (first === 0 || first === 127 || first >= 224) continue
      const url = `http://${address}:4310`
      if (identifiedTailscale && first === 100 && second >= 64 && second <= 127) tailscale.add(url)
      else if (!identifiedTailscale && item.physical) lan.add(url)
    }
  }
  return { lan: [...lan].sort(), tailscale: [...tailscale].sort(), unavailable: false }
}

async function queryWindowsAddresses(): Promise<string> {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = await promisify(execFile)(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(networkAddressScript, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 3_000, killSignal: 'SIGTERM', maxBuffer: 128 * 1024, encoding: 'utf8',
  })
  return result.stdout
}

export async function readNetworkAddresses(query = queryWindowsAddresses, platform = process.platform): Promise<NetworkAddresses> {
  if (platform !== 'win32') return { lan: [], tailscale: [], unavailable: true }
  try { return parseNetworkAddresses(JSON.parse(await query())) }
  catch { return { lan: [], tailscale: [], unavailable: true } }
}

/** A narrow clipboard action: only displayed local connection URLs, trusted renderer only. */
export function createAddressCopyHandler<TEvent>(trusted: (event: TEvent) => boolean, addresses: () => Promise<NetworkAddresses>, copy: (text: string) => void) {
  return async (event: TEvent, value: unknown): Promise<boolean> => {
    if (!trusted(event)) throw new Error('UNTRUSTED_RENDERER')
    if (typeof value !== 'string') return false
    const current = await addresses()
    if (!['http://127.0.0.1:4310', ...current.lan, ...current.tailscale].includes(value)) return false
    copy(value)
    return true
  }
}
