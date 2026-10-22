import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, createReadStream, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { secureBackupDirectory } from './backup.js'

const archiveMagic = Buffer.from('HRAIDBKP', 'ascii')
const archiveVersion = 1
const nonceLength = 12
const tagLength = 16
const headerLength = archiveMagic.length + 1 + nonceLength

async function* readFileChunks(path: string, range?: { start?: number; end?: number }): AsyncGenerator<Buffer> {
  const stream = createReadStream(path, range)
  try { for await (const chunk of stream) yield chunk as Buffer }
  finally {
    stream.destroy()
    if (!stream.closed) await new Promise<void>((resolveClose) => stream.once('close', () => resolveClose()))
  }
}

export type DriveSecrets = {
  version: 1
  encryptionKey: string
  google: { refreshToken: string; folderId: string }
}

function transformWithDpapi(value: Buffer, action: 'protect' | 'unprotect'): Buffer {
  if (process.platform !== 'win32') throw new Error('Захищене сховище секретів доступне лише у Windows.')
  const expression = action === 'protect' ? 'Protect' : 'Unprotect'
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $raw=[Convert]::FromBase64String($inputText); $result=[System.Security.Cryptography.ProtectedData]::${expression}($raw,$null,[System.Security.Cryptography.DataProtectionScope]::LocalMachine); [Console]::Out.Write([Convert]::ToBase64String($result))`
  try {
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      input: value.toString('base64'), encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1024 * 1024,
    }).trim()
    return Buffer.from(output, 'base64')
  } catch {
    throw new Error('Не вдалося використати Windows DPAPI для захисту секретів резервування.')
  }
}

export class DriveSecretsStore {
  readonly directory: string
  readonly path: string
  private prepared = false

  constructor(directory: string) {
    this.directory = resolve(directory)
    this.path = join(this.directory, '.hromadaaid-drive-secrets.dpapi')
  }

  exists(): boolean {
    return existsSync(this.path)
  }

  load(): DriveSecrets | null {
    if (!this.exists()) return null
    try {
      const protectedData = readFileSync(this.path)
      const decoded = transformWithDpapi(protectedData, 'unprotect').toString('utf8')
      const value = JSON.parse(decoded) as DriveSecrets
      if (value.version !== 1 || typeof value.encryptionKey !== 'string' || typeof value.google?.refreshToken !== 'string' || typeof value.google?.folderId !== 'string') {
        throw new Error('Invalid backup secret data')
      }
      decodeRecoveryKey(value.encryptionKey)
      return value
    } catch {
      throw new Error('Не вдалося прочитати захищену конфігурацію резервування.')
    }
  }

  save(value: DriveSecrets): void {
    this.prepare()
    const protectedData = transformWithDpapi(Buffer.from(JSON.stringify(value), 'utf8'), 'protect')
    const temporaryPath = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    try {
      writeFileSyncSafe(temporaryPath, protectedData)
      renameSyncSafe(temporaryPath, this.path)
    } catch {
      try { unlinkSyncSafe(temporaryPath) } catch { /* keep the original protected configuration */ }
      throw new Error('Не вдалося атомарно зберегти захищену конфігурацію резервування.')
    }
  }

  create(value: DriveSecrets): void {
    this.prepare()
    if (this.exists()) throw new Error('Захищене сховище резервування вже налаштоване.')
    this.save(value)
  }

  private prepare(): void {
    if (this.prepared) return
    secureBackupDirectory(this.directory)
    this.prepared = true
  }
}

// Small sync wrappers keep the encrypted-secret write atomic and durable before it is renamed.
function writeFileSyncSafe(path: string, data: Buffer): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try { writeFileSync(descriptor, data); fsyncSync(descriptor) } finally { closeSync(descriptor) }
}
function renameSyncSafe(source: string, target: string): void { renameSync(source, target) }
function unlinkSyncSafe(path: string): void { unlinkSync(path) }

export function createRecoveryKey(): { bytes: Buffer; encoded: string } {
  const bytes = randomBytes(32)
  return { bytes, encoded: bytes.toString('base64url') }
}

export function decodeRecoveryKey(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new Error('Ключ відновлення має бути коректним 256-бітним Base64URL значенням.')
  return bytes
}

export async function encryptBackupFile(inputPath: string, outputPath: string, key: Uint8Array): Promise<void> {
  if (key.byteLength !== 32) throw new Error('Ключ резервної копії має бути довжиною 256 біт.')
  const nonce = randomBytes(nonceLength)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const output = await open(outputPath, 'wx', 0o600)
  try {
    const header = Buffer.concat([archiveMagic, Buffer.from([archiveVersion]), nonce])
    await output.writeFile(header)
    for await (const chunk of readFileChunks(inputPath)) {
      const encrypted = cipher.update(chunk)
      if (encrypted.length) await output.writeFile(encrypted)
    }
    const final = cipher.final()
    if (final.length) await output.writeFile(final)
    await output.writeFile(cipher.getAuthTag())
    await output.sync()
  } catch (error) {
    await output.close().catch(() => undefined)
    await rm(outputPath, { force: true }).catch(() => undefined)
    throw error
  }
  await output.close()
}

export async function decryptBackupFile(inputPath: string, outputPath: string, key: Uint8Array): Promise<void> {
  if (key.byteLength !== 32) throw new Error('Ключ резервної копії має бути довжиною 256 біт.')
  const input = await open(inputPath, 'r')
  let output: Awaited<ReturnType<typeof open>> | undefined
  try {
    const { size } = await input.stat()
    if (size < headerLength + tagLength) throw new Error('Зашифрований архів неповний.')
    const header = Buffer.alloc(headerLength)
    await readExactly(input, header, 0)
    if (!header.subarray(0, archiveMagic.length).equals(archiveMagic) || header[archiveMagic.length] !== archiveVersion) {
      throw new Error('Невідомий формат зашифрованого архіву.')
    }
    const tag = Buffer.alloc(tagLength)
    await readExactly(input, tag, size - tagLength)
    const nonce = header.subarray(archiveMagic.length + 1)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    output = await open(outputPath, 'wx', 0o600)
    const encryptedLength = size - headerLength - tagLength
    if (encryptedLength > 0) {
      for await (const chunk of readFileChunks(inputPath, { start: headerLength, end: headerLength + encryptedLength - 1 })) {
        const decrypted = decipher.update(chunk)
        if (decrypted.length) await output.writeFile(decrypted)
      }
    }
    const final = decipher.final()
    if (final.length) await output.writeFile(final)
    await output.sync()
    await output.close()
    output = undefined
  } catch (error) {
    await output?.close().catch(() => undefined)
    await rm(outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await input.close()
  }
}

async function readExactly(handle: Awaited<ReturnType<typeof open>>, target: Buffer, position: number): Promise<void> {
  let offset = 0
  while (offset < target.length) {
    const { bytesRead } = await handle.read(target, offset, target.length - offset, position + offset)
    if (!bytesRead) throw new Error('Зашифрований архів неповний.')
    offset += bytesRead
  }
}

export async function hashFile(path: string): Promise<{ size: number; md5: string; sha256: string }> {
  const md5 = createHash('md5')
  const sha256 = createHash('sha256')
  let size = 0
  for await (const data of readFileChunks(path)) {
    size += data.length
    md5.update(data)
    sha256.update(data)
  }
  return { size, md5: md5.digest('hex'), sha256: sha256.digest('hex') }
}
