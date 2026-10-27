import type { spawn } from 'node:child_process'
export function windowsPowerShellPath(systemRoot?: string): string
export function quoteWindowsArgument(value: string): string
export const bootstrapScript: string
export function launchUpdatePowerShell(options: {
  updateDirectory: string; launcherPath: string; launcherArguments: string[];
  logEvent: (stage: string, details?: Record<string, unknown>) => Promise<void>;
  spawnProcess?: typeof spawn; readyTimeoutMs?: number;
}): Promise<{ status: 'ready'; launcherProcessId: number; diagnosticDirectory: string }>
