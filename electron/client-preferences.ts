import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthActionResult } from '../shared/auth-contract.js'

const preferencesFile = 'client-preferences.json'

export async function readLastLogin(userDataPath: string): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(userDataPath, preferencesFile), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const username = (value as Record<string, unknown>).lastLogin
    return typeof username === 'string' && username.length >= 3 && username.length <= 80 && !/[\u0000-\u001f\u007f]/.test(username) ? username : null
  } catch { return null }
}

/** Stores only the username after a successful server login. */
export async function saveLastLogin(userDataPath: string, username: string): Promise<void> {
  if (username.length < 3 || username.length > 80 || /[\u0000-\u001f\u007f]/.test(username)) throw new Error('Некоректний логін.')
  const destination = join(userDataPath, preferencesFile)
  const temporary = join(userDataPath, `.client-preferences-${randomUUID()}.tmp`)
  try {
    await mkdir(userDataPath, { recursive: true })
    await writeFile(temporary, JSON.stringify({ lastLogin: username }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, destination)
  } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}

export async function saveLastLoginAfterSuccessfulLogin(userDataPath: string, result: AuthActionResult): Promise<void> {
  if (result.ok && result.state.user) await saveLastLogin(userDataPath, result.state.user.username)
}
