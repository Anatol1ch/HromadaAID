import { useEffect, useState } from 'react'
import { CircleAlert, Download, RefreshCw, ShieldCheck } from 'lucide-react'
import type { ClientUpdateState } from '../../shared/api-contract'
import Modal from './Modal'
import { ReleaseUpdateDetails, ReleaseUpdateProgress } from './ReleaseUpdateDetails'

const phaseLabel: Record<ClientUpdateState['status'], string> = {
  idle: 'Очікування перевірки', checking: 'Перевірка оновлень…', 'up-to-date': 'Використовується актуальна версія.', 'waiting-for-server': 'Очікується оновлення сервера.',
  available: 'Доступне обов’язкове оновлення.', downloading: 'Завантаження інсталятора…', verifying: 'Перевірка цілісності інсталятора…',
  ready: 'Інсталятор перевірено. Можна продовжити.', preparing: 'Підготовка до запуску інсталятора…',
  installing: 'Виконується встановлення…', restarting: 'Перезапуск HromadaAID…', error: 'Оновлення не завершено.',
}

export default function ClientUpdateGate() {
  const [state, setState] = useState<ClientUpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void window.hromadaAid.clientUpdates.getState().then(value => { if (active) setState(value) }).catch(() => {})
    const unsubscribe = window.hromadaAid.clientUpdates.onStateChange(value => { if (active) setState(value) })
    return () => { active = false; unsubscribe() }
  }, [])
  const visibleState = state
  if (!visibleState?.confirmed || !visibleState.targetVersion) return null
  const runDownload = async () => {
    if (busy) return
    setBusy(true)
    try { setState(await window.hromadaAid.clientUpdates.download()) }
    catch { setState(current => current ? { ...current, status: 'error', error: 'Не вдалося завантажити інсталятор.' } : current) }
    finally { setBusy(false) }
  }
  const launchInstaller = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.hromadaAid.clientUpdates.install()
      if (!result.ok) setState(current => result.state ?? (current ? { ...current, status: 'error', error: result.message } : current))
    } catch { setState(current => current ? { ...current, status: 'error', error: 'Не вдалося запустити NSIS Setup.' } : current) }
    finally { setBusy(false) }
  }
  const downloading = visibleState.status === 'downloading' || visibleState.status === 'verifying'
  const installing = visibleState.status === 'preparing' || visibleState.status === 'installing' || visibleState.status === 'restarting'
  return <Modal title="Потрібно оновити HromadaAID" description="Щоб продовжити роботу, встановіть останню стабільну версію." onClose={() => {}} dismissible={false} busy={busy || downloading || installing} size="compact" className="client-update-modal" backdropClassName="client-update-gate-backdrop" headerIcon={<Download size={20} aria-hidden="true" />}>
    <ReleaseUpdateDetails currentVersion={visibleState.currentVersion} targetVersion={visibleState.targetVersion} notes={visibleState.notes}/>
    <p className={`client-update-status${visibleState.status === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
      {visibleState.status === 'error' ? <CircleAlert size={17} aria-hidden="true"/> : visibleState.status === 'ready' ? <ShieldCheck size={17} aria-hidden="true"/> : null}
      {visibleState.error || phaseLabel[visibleState.status]}
    </p>
    {downloading && <ReleaseUpdateProgress label={visibleState.status === 'verifying' ? 'Перевірка завантаженого файла' : 'Завантаження Setup'} receivedBytes={visibleState.receivedBytes} totalBytes={visibleState.totalBytes} indeterminate={visibleState.status === 'verifying'}/>}
    {installing && <ReleaseUpdateProgress label={visibleState.status === 'preparing' ? 'Підготовка до запуску Setup' : visibleState.status === 'restarting' ? 'Перезапуск HromadaAID' : 'Встановлення через Windows Setup'} indeterminate/>}
    {visibleState.status === 'ready' && <div className="client-update-warning"><strong>Перед закриттям Client збережіть відкриті зміни.</strong><span>Після підтвердження Client закриється. Windows може показати запит UAC для чинного інсталятора HromadaAID.</span></div>}
    <div className="client-update-actions">
      {(visibleState.status === 'available' || visibleState.status === 'error') && <button type="button" className="primary-button" disabled={busy} onClick={() => void runDownload()}><Download size={17}/>{visibleState.status === 'error' ? 'Повторити завантаження' : 'Оновити зараз'}</button>}
      {visibleState.status === 'ready' && <button type="button" className="primary-button" disabled={busy} onClick={() => void launchInstaller()}>Закрити Client і продовжити</button>}
      {installing && <span className="client-update-retry"><RefreshCw size={15} aria-hidden="true"/>Зачекайте на завершення встановлення</span>}
    </div>
  </Modal>
}
