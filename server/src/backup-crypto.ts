import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, createReadStream, existsSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { securePrivateDirectory as secureBackupDirectory } from '../../electron/protected-directory.js'

const archiveMagic = Buffer.from('HRAIDBKP', 'ascii')
const archiveVersion = 1
const nonceLength = 12
const tagLength = 16
const headerLength = archiveMagic.length + 1 + nonceLength

export type ArchiveMetadata = { id: string; createdAt: string; sourceSha256: string }
function validMetadata(value: unknown): value is ArchiveMetadata {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && /^[a-f0-9]{64}$/.test(v.id) && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt)) && typeof v.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sourceSha256)
}

export async function readArchiveMetadata(path: string): Promise<ArchiveMetadata> {
  const file = await open(path, 'r')
  try {
    const prefix = Buffer.alloc(13)
    await readExactly(file, prefix, 0)
    const length = prefix.readUInt32BE(9)
    if (!prefix.subarray(0, 8).equals(archiveMagic) || prefix[8] !== 2 || length < 2 || length > 4096) throw new Error('Невідомий формат метаданих архіву.')
    const json = Buffer.alloc(length)
    await readExactly(file, json, 13)
    const value: unknown = JSON.parse(json.toString('utf8'))
    if (!validMetadata(value)) throw new Error('Некоректні метадані архіву.')
    return value
  } finally { await file.close() }
}

async function* readFileChunks(path: string, range?: { start?: number; end?: number }): AsyncGenerator<Buffer> {
  const stream = createReadStream(path, range)
  try { for await (const chunk of stream) yield chunk as Buffer }
  finally {
    stream.destroy()
    if (!stream.closed) await new Promise<void>((resolveClose) => stream.once('close', () => resolveClose()))
  }
}

function transformWithDpapi(value: Buffer, action: 'protect' | 'unprotect'): Buffer {
  if (process.platform !== 'win32') throw new Error('Захищене сховище секретів доступне лише у Windows.')
  const expression = action === 'protect' ? 'Protect' : 'Unprotect'
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $raw=[Convert]::FromBase64String($inputText); $result=[System.Security.Cryptography.ProtectedData]::${expression}($raw,$null,[System.Security.Cryptography.DataProtectionScope]::LocalMachine); [Console]::Out.Write([Convert]::ToBase64String($result))`
  try {
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      input: value.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1024 * 1024,
    }).trim()
    return Buffer.from(output, 'base64')
  } catch {
    throw new Error('Не вдалося використати Windows DPAPI для захисту секретів резервування.')
  }
}

export class BackupKeyStore {
  readonly directory: string
  readonly path: string
  private prepared = false

  constructor(directory: string) {
    this.directory = resolve(directory)
    this.path = join(this.directory, '.hromadaaid-backup-key.dpapi')
  }

  exists(): boolean {
    return existsSync(this.path)
  }

  load(): { version: 1; encryptionKey: string } | null {
    if (!this.exists()) return null
    try {
      const protectedData = readFileSync(this.path)
      const decoded = transformWithDpapi(protectedData, 'unprotect').toString('utf8')
      const value = JSON.parse(decoded) as { version: 1; encryptionKey: string }
      if (value.version !== 1 || typeof value.encryptionKey !== 'string') {
        throw new Error('Invalid backup secret data')
      }
      decodeRecoveryKey(value.encryptionKey)
      return value
    } catch {
      throw new Error('Не вдалося прочитати захищену конфігурацію резервування.')
    }
  }

  create(value: { version: 1; encryptionKey: string }): void {
    this.prepare()
    if (this.exists()) throw new Error('Захищене сховище резервування вже налаштоване.')
    decodeRecoveryKey(value.encryptionKey)
    const temporaryPath = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    try {
      writeFileSyncSafe(temporaryPath, transformWithDpapi(Buffer.from(JSON.stringify(value), 'utf8'), 'protect'))
      linkSync(temporaryPath, this.path) // Atomic publication; EEXIST never replaces an existing key.
    } finally { try { unlinkSync(temporaryPath) } catch { /* An interrupted unpublished key is never used. */ } }
  }

  private prepare(): void {
    if (this.prepared) return
    secureBackupDirectory(this.directory)
    this.prepared = true
  }
}

// Flush the protected key before publishing its final name.
function writeFileSyncSafe(path: string, data: Buffer): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try { writeFileSync(descriptor, data); fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

export function createRecoveryKey(): { bytes: Buffer; encoded: string } {
  const bytes = randomBytes(32)
  return { bytes, encoded: bytes.toString('base64url') }
}

export function decodeRecoveryKey(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new Error('Ключ відновлення має бути коректним 256-бітним Base64URL значенням.')
  return bytes
}

export async function encryptBackupFile(inputPath: string, outputPath: string, key: Uint8Array, metadata?: ArchiveMetadata): Promise<void> {
  if (key.byteLength !== 32) throw new Error('Ключ резервної копії має бути довжиною 256 біт.')
  if (metadata && !validMetadata(metadata)) throw new Error('Некоректні метадані архіву.')
  const nonce = randomBytes(nonceLength)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const output = await open(outputPath, 'wx', 0o600)
  try {
    const json = metadata ? Buffer.from(JSON.stringify(metadata), 'utf8') : undefined
    const jsonLength = Buffer.alloc(4)
    if (json) jsonLength.writeUInt32BE(json.length)
    const header = json ? Buffer.concat([archiveMagic, Buffer.from([2]), jsonLength, json, nonce]) : Buffer.concat([archiveMagic, Buffer.from([archiveVersion]), nonce])
    if (json) cipher.setAAD(header)
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
    const prefix = Buffer.alloc(9)
    await readExactly(input, prefix, 0)
    if (!prefix.subarray(0, archiveMagic.length).equals(archiveMagic) || ![1, 2].includes(prefix[8])) {
      throw new Error('Невідомий формат зашифрованого архіву.')
    }
    let actualHeaderLength = headerLength
    let metadata: ArchiveMetadata | undefined
    if (prefix[8] === 2) {
      const length = Buffer.alloc(4)
      await readExactly(input, length, 9)
      const count = length.readUInt32BE()
      if (count < 2 || count > 4096) throw new Error('Некоректний заголовок архіву.')
      actualHeaderLength = 13 + count + nonceLength
      const json = Buffer.alloc(count)
      await readExactly(input, json, 13)
      const parsed: unknown = JSON.parse(json.toString('utf8'))
      if (!validMetadata(parsed)) throw new Error('Некоректні метадані архіву.')
      metadata = parsed
    }
    if (size < actualHeaderLength + tagLength) throw new Error('Зашифрований архів неповний.')
    const header = Buffer.alloc(actualHeaderLength)
    await readExactly(input, header, 0)
    const tag = Buffer.alloc(tagLength)
    await readExactly(input, tag, size - tagLength)
    const nonce = header.subarray(actualHeaderLength - nonceLength)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    if (metadata) decipher.setAAD(header)
    decipher.setAuthTag(tag)
    const sourceHash = createHash('sha256')
    output = await open(outputPath, 'wx', 0o600)
    const encryptedLength = size - actualHeaderLength - tagLength
    if (encryptedLength > 0) {
      for await (const chunk of readFileChunks(inputPath, { start: actualHeaderLength, end: actualHeaderLength + encryptedLength - 1 })) {
        const decrypted = decipher.update(chunk)
        sourceHash.update(decrypted)
        if (decrypted.length) await output.writeFile(decrypted)
      }
    }
    const final = decipher.final()
    sourceHash.update(final)
    if (metadata && sourceHash.digest('hex') !== metadata.sourceSha256) throw new Error('Контрольна сума вмісту архіву не збігається.')
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
