import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {'directory' | 'file' | 'symbolic-link' | 'other'} UpdateArtifactKind */
/** @typedef {{ name: string; path: string; kind: UpdateArtifactKind; modifiedAt?: string }} UpdateArtifactDiagnostic */
/** @typedef {{ name: string; path: string; exists: boolean; kind?: UpdateArtifactKind; modifiedAt?: string }} UpdateJournalDiagnostic */
export const UPDATE_ARTIFACT_NAMES = ['Server.next', 'Server.previous', 'Server.failed']
export const UPDATE_JOURNAL_NAME = '.hromadaaid-update-state.json'

/** @returns {Promise<UpdateArtifactDiagnostic | null>} */
async function inspectPath(path, name, lstatPath = lstat) {
  try {
    const info = await lstatPath(path)
    /** @type {UpdateArtifactKind} */
    const kind = info.isSymbolicLink() ? 'symbolic-link' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
    const modifiedAt = Number.isFinite(info.mtimeMs) ? new Date(info.mtimeMs).toISOString() : undefined
    return { name, path, kind, ...(modifiedAt ? { modifiedAt } : {}) }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error?.code ?? '')) return null
    throw error
  }
}

/** Performs only lstat on the expected transaction objects; it never traverses their contents. */
/** @returns {Promise<{ journal: UpdateJournalDiagnostic; artifacts: UpdateArtifactDiagnostic[] }>} */
export async function inspectUpdateArtifacts(programDirectory, dataDirectory, lstatPath = lstat) {
  const journalPath = join(dataDirectory, UPDATE_JOURNAL_NAME)
  const journalObject = await inspectPath(journalPath, UPDATE_JOURNAL_NAME, lstatPath)
  const journal = journalObject ? { ...journalObject, exists: true } : { name: UPDATE_JOURNAL_NAME, path: journalPath, exists: false }
  const artifacts = (await Promise.all(UPDATE_ARTIFACT_NAMES.map(name => inspectPath(join(programDirectory, name), name, lstatPath)))).filter(item => item !== null)
  return { journal, artifacts }
}

/** Returns the installation directory only when a known, direct-child artifact exists safely. */
/** @returns {Promise<string>} */
export async function validateUpdateArtifactsDirectory(programDirectory, lstatPath = lstat) {
  const root = await inspectPath(programDirectory, 'installation-directory', lstatPath)
  if (!root || root.kind !== 'directory') throw new Error('Каталог інсталяції не підтверджено для відкриття.')
  const artifacts = (await Promise.all(UPDATE_ARTIFACT_NAMES.map(name => inspectPath(join(programDirectory, name), name, lstatPath)))).filter(item => item !== null && item.kind === 'directory')
  if (!artifacts.length) throw new Error('Не знайдено службового каталогу оновлення для відкриття.')
  return programDirectory
}
