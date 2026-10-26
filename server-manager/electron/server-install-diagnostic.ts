export type InstallerDiagnostic = {
  stage: string
  type: string
  line: number
  hresult: number
  childExitCode: number | null
  detailFile: string
  detailWritten: boolean
  message: string
}

/** Decodes only the ASCII-safe UTF-8 marker emitted by install-server-service.ps1. */
export function parseInstallerDiagnostic(text: string): InstallerDiagnostic | null {
  const marker = /^HROMADAAID_INSTALL_ERROR_B64\|([A-Za-z0-9+/=]+)$/m.exec(text)?.[1]
  if (!marker) return null
  try {
    const value = JSON.parse(Buffer.from(marker, 'base64').toString('utf8')) as Record<string, unknown>
    if (typeof value.stage !== 'string' || typeof value.type !== 'string' || typeof value.line !== 'number' || typeof value.hresult !== 'number' || !(typeof value.childExitCode === 'number' || value.childExitCode === null) || typeof value.detailFile !== 'string' || typeof value.detailWritten !== 'boolean' || typeof value.message !== 'string') return null
    return value as InstallerDiagnostic
  } catch { return null }
}
