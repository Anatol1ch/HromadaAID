import { Archive, Copy, Folder, FolderOpen, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import Alert from '../../src/components/Alert'
import type { RecoveryStatus, UpdateArtifactDiagnostic } from '../electron/recovery-contract'
import { Modal } from './ManagerUI'

export const UPDATE_ARTIFACTS_WARNING_TITLE = 'Виявлено залишкові файли оновлення'
export const UPDATE_ARTIFACTS_WARNING_MESSAGE = 'Виявлено службові каталоги, але журнал відповідної операції відсутній. Автоматичне відновлення недоступне. Файли залишено без змін з міркувань безпеки. Перед наступним серверним оновленням необхідно перевірити стан службових каталогів.'

type DiagnosticData = {
  journal: RecoveryStatus['update']['journal']
  artifacts: UpdateArtifactDiagnostic[]
}

function formatDate(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('uk-UA') : null
}

export function formatUpdateDiagnostics(managerVersion: string, serverVersion: string | null | undefined, data: DiagnosticData): string {
  const lines = [
    UPDATE_ARTIFACTS_WARNING_TITLE,
    `Версія Server Manager: ${managerVersion}`,
    `Версія API Server: ${serverVersion || 'не визначено'}`,
    UPDATE_ARTIFACTS_WARNING_MESSAGE,
    'Службові об’єкти:',
  ]
  for (const artifact of data.artifacts) {
    const modified = formatDate(artifact.modifiedAt)
    lines.push(`- ${artifact.name} (${artifact.kind}): ${artifact.path}${modified ? `; змінено: ${modified}` : ''}`)
  }
  const journal = data.journal
  lines.push(`Журнал оновлення: ${journal?.exists ? 'наявний' : 'відсутній'}${journal ? `; ${journal.path}${formatDate(journal.modifiedAt) ? `; змінено: ${formatDate(journal.modifiedAt)}` : ''}` : ''}`)
  return lines.join('\n')
}

export default function UpdateArtifactsNotice({ status, managerVersion, serverVersion, onOpenDirectory, onCopyDiagnostics, onPrepareResolution, onResolveResidues, onResolutionComplete }: {
  status: RecoveryStatus['update']
  managerVersion: string
  serverVersion?: string | null
  onOpenDirectory: () => Promise<unknown>
  onCopyDiagnostics: (text: string) => Promise<unknown>
  onPrepareResolution?: () => Promise<{ eligible: boolean; artifacts: UpdateArtifactDiagnostic[]; archiveDirectory?: string; reason?: string }>
  onResolveResidues?: () => Promise<{ success: boolean; message: string }>
  onResolutionComplete?: () => void
}) {
  const [actionMessage, setActionMessage] = useState('')
  const [resolutionPlan, setResolutionPlan] = useState<{ artifacts: UpdateArtifactDiagnostic[]; archiveDirectory: string } | null>(null)
  const [resolutionBusy, setResolutionBusy] = useState(false)
  const details = status.journal !== undefined && status.artifacts !== undefined ? { journal: status.journal, artifacts: status.artifacts } : null
  const canOpen = Boolean(details?.artifacts.some(item => item.kind === 'directory'))
  const copy = async () => {
    if (!details) return
    try {
      await onCopyDiagnostics(formatUpdateDiagnostics(managerVersion, serverVersion, details))
      setActionMessage('Діагностику скопійовано.')
    } catch { setActionMessage('Не вдалося скопіювати діагностику.') }
  }
  const open = async () => {
    try { await onOpenDirectory(); setActionMessage('Каталог інсталяції відкрито.') }
    catch { setActionMessage('Не вдалося відкрити підтверджений каталог інсталяції.') }
  }
  const prepareResolution = async () => {
    setResolutionBusy(true); setActionMessage('')
    try {
      const plan = await onPrepareResolution?.()
      if (!plan?.eligible || !plan.archiveDirectory) { setActionMessage(plan?.reason || 'Безпечні передумови не підтверджено. Файли залишено.'); return }
      setResolutionPlan({ artifacts: plan.artifacts, archiveDirectory: plan.archiveDirectory })
    } catch (error) { setActionMessage(error instanceof Error ? error.message : 'Не вдалося перевірити можливість архівування.') }
    finally { setResolutionBusy(false) }
  }
  const resolveResidues = async () => {
    if (!resolutionPlan || resolutionBusy) return
    setResolutionBusy(true)
    try {
      const result = await onResolveResidues?.()
      setActionMessage(result?.message || 'Результат операції не підтверджено; файли збережено.')
      if (result?.success) onResolutionComplete?.()
    } catch (error) { setActionMessage(error instanceof Error ? error.message : 'Не вдалося завершити операцію; файли збережено.') }
    finally { setResolutionBusy(false); setResolutionPlan(null) }
  }

  return <Alert variant="warning" className="sm-update-artifacts-notice">
    <h2>{UPDATE_ARTIFACTS_WARNING_TITLE}</h2>
    <p>{UPDATE_ARTIFACTS_WARNING_MESSAGE}</p>
    <div className="sm-update-artifact-details">
      <strong>Службові каталоги</strong>
      {details?.artifacts.length ? <ul>{details.artifacts.map(item => <li key={item.name}>
        <strong>{item.name}</strong><code>{item.path}</code>
        {formatDate(item.modifiedAt) && <small>Змінено: {formatDate(item.modifiedAt)}</small>}
      </li>)}</ul> : <p>Не вдалося отримати перелік об’єктів.</p>}
      <p className="sm-update-journal-state"><strong>Журнал операції:</strong> {details?.journal ? details.journal.exists ? 'наявний' : 'відсутній' : 'стан не перевірено'}{details?.journal && <> · <code>{details.journal.path}</code>{formatDate(details.journal.modifiedAt) && <small> · змінено {formatDate(details.journal.modifiedAt)}</small>}</>}</p>
    </div>
    <div className="sm-update-artifact-actions">
      <button className="secondary-button" type="button" disabled={!canOpen} onClick={() => void open()}><FolderOpen size={16} aria-hidden="true"/>Відкрити каталог</button>
      <button className="secondary-button" type="button" disabled={!details} onClick={() => void copy()}><Copy size={16} aria-hidden="true"/>Копіювати діагностику</button>
      <button className="secondary-button" type="button" disabled={!details || resolutionBusy || !onPrepareResolution} onClick={() => void prepareResolution()}><Archive size={16} aria-hidden="true"/>{resolutionBusy ? 'Перевірка…' : 'Усунути залишкові файли оновлення'}</button>
    </div>
    {actionMessage && <p className="sm-update-artifact-feedback" role="status">{actionMessage}</p>}
    {resolutionPlan && <Modal className="sm-residue-confirmation" title="Архівувати залишкові файли?" icon={<Archive size={20} aria-hidden="true"/>} busy={resolutionBusy} onClose={() => { if (!resolutionBusy) setResolutionPlan(null) }} footer={<><button className="secondary-button" type="button" disabled={resolutionBusy} onClick={() => setResolutionPlan(null)}><X size={16} aria-hidden="true"/>Скасувати</button><button className="primary-button" type="button" disabled={resolutionBusy} onClick={() => void resolveResidues()}><Archive size={16} aria-hidden="true"/>{resolutionBusy ? 'Архівування…' : 'Архівувати'}</button></>}>
      <div className="sm-residue-confirmation-content">
        <p className="sm-residue-intro">Перед архівуванням буде повторно перевірено стан сервера та безпечність виконання операції.</p>
        <section className="sm-residue-section" aria-labelledby="sm-residue-artifacts-title">
          <h3 id="sm-residue-artifacts-title">Каталоги для архівування</h3>
          <ul className="sm-residue-artifact-list">{resolutionPlan.artifacts.map(item => <li key={item.name}><Folder size={17} aria-hidden="true"/><span className="sm-residue-artifact-text"><strong>{item.name}</strong><code>{item.path}</code></span></li>)}</ul>
        </section>
        <section className="sm-residue-section" aria-labelledby="sm-residue-archive-title">
          <h3 id="sm-residue-archive-title">Розташування архіву</h3>
          <div className="sm-residue-path"><FolderOpen size={17} aria-hidden="true"/><code>{resolutionPlan.archiveDirectory}</code></div>
        </section>
        <section className="sm-residue-preservation" aria-labelledby="sm-residue-preservation-title">
          <ShieldCheck size={18} aria-hidden="true"/><div><h3 id="sm-residue-preservation-title">Збереження даних</h3><p>Файли буде переміщено до архіву без видалення. Активний сервер, база даних та конфігурація залишаться без змін.</p></div>
        </section>
      </div>
    </Modal>}
  </Alert>
}
