import { Download, LoaderCircle, RefreshCw, ServerOff, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ClientUpdateState, ServerConnectionCheckResult } from '../../shared/api-contract'
import type { ConnectionFailureReason } from '../../shared/system-state'
import { reconnectDelay, SingleFlightProbe } from '../../shared/system-state'
import { notifySystemToast } from './SystemToastHost'

export default function ConnectionStateOverlay({ status, failureReason, apiUrl, clientVersion, check, checkUpdates, onRestored }: { status: 'unavailable' | 'maintenance'; failureReason?: ConnectionFailureReason; apiUrl: string | null; clientVersion?: string; check: (apiUrl: string) => Promise<ServerConnectionCheckResult>; checkUpdates: () => Promise<ClientUpdateState>; onRestored: () => void }) {
  const [checking, setChecking] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [clientUpdate, setClientUpdate] = useState<ClientUpdateState | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const probe = useRef(new SingleFlightProbe<ServerConnectionCheckResult>())
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    void window.hromadaAid.clientUpdates.getState().then(value => { if (active) setClientUpdate(value) }).catch(() => undefined)
    const unsubscribe = window.hromadaAid.clientUpdates.onStateChange(value => { if (active) setClientUpdate(value) })
    return () => { active = false; unsubscribe() }
  }, [])
  useEffect(() => {
    const since = Date.now()
    const elapsedTimer = window.setInterval(() => setElapsed(Math.floor((Date.now() - since) / 1_000)), 1_000)
    let timer: number | undefined
    let index = 0
    let stopped = false
    const run = async () => {
      if (!apiUrl || stopped) return
      setChecking(true)
      try {
        const result = await probe.current.run(() => check(apiUrl))
        if (stopped) return
        if (result.ok) { onRestored(); return }
      } catch { /* The main process publishes the normalized unreachable state. */ }
      finally { if (!stopped) setChecking(false) }
      if (!stopped) {
        setAttempt(value => value + 1)
        timer = window.setTimeout(() => void run(), reconnectDelay(index++))
      }
    }
    timer = window.setTimeout(() => void run(), 1_500)
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); window.clearInterval(elapsedTimer) }
  }, [apiUrl, check, onRestored])

  const retry = async () => {
    if (checking || !apiUrl) return
    setChecking(true)
    try {
      const result = await probe.current.run(() => check(apiUrl))
      if (result.ok) onRestored()
    } catch { /* A later scheduled check will retry. */ }
    finally { if (mounted.current) setChecking(false) }
  }
  const retryUpdates = async () => {
    if (checkingUpdates || clientUpdate?.status === 'checking' || clientUpdate?.confirmed) return
    setCheckingUpdates(true)
    try {
      const result = await checkUpdates()
      setClientUpdate(result)
      if (result.confirmed && result.targetVersion) return
      if (result.status === 'up-to-date') notifySystemToast('info', 'Оновлень не знайдено', 'Ви використовуєте актуальну версію HromadaAID.')
      else if (result.status === 'error' && result.error === 'Перевірка оновлень недоступна в режимі розробки.') notifySystemToast('info', 'Перевірка оновлень недоступна', 'У режимі розробки перевірити стабільні випуски неможливо.')
      else if (result.status === 'error') notifySystemToast('error', 'Не вдалося перевірити оновлення', result.error || 'Перевірка не завершилася. Спробуйте ще раз.')
    } catch { notifySystemToast('error', 'Не вдалося перевірити оновлення', 'Перевірка не завершилася. Спробуйте ще раз.') }
    finally { if (mounted.current) setCheckingUpdates(false) }
  }
  const maintenance = status === 'maintenance'
  const incompatible = !maintenance && failureReason === 'incompatible'
  const visibleClientUpdate = clientUpdate
  const title = maintenance ? 'Триває технічне обслуговування' : incompatible ? 'Несумісна версія сервера' : 'Відсутнє з’єднання із сервером'
  const message = maintenance
    ? 'Сервер тимчасово недоступний через виконання технічних робіт. Спробуйте підключитися пізніше.'
    : incompatible
      ? 'Версія програми несумісна з установленою версією сервера. Для продовження роботи необхідно оновити відповідні компоненти HromadaAID.'
      : 'Не вдалося зв’язатися із сервером HromadaAID. Перевірте мережеве підключення або зверніться до адміністратора.'
  const Icon = maintenance ? Wrench : ServerOff
  return <main className="connection-state-overlay" role="alert" aria-live="assertive" aria-labelledby="connection-state-title">
    <section className="connection-state-card">
      <div className={`connection-state-icon${maintenance ? ' is-maintenance' : ''}`}><Icon size={30} aria-hidden="true"/></div>
      <h1 id="connection-state-title">{title}</h1>
      <p>{message}</p>
      {status === 'unavailable' && (failureReason === 'timeout' || failureReason === 'http') && <p className="connection-state-detail">{failureReason === 'timeout' ? 'Сервер не відповів у відведений час.' : 'Сервер відповів помилкою перевірки доступності.'}</p>}
      {incompatible && clientVersion && <div className="connection-state-versions"><span>Версія Client</span><strong>{clientVersion}</strong></div>}
      <div className="connection-state-progress" role="status" aria-live="polite">
        {checking ? <LoaderCircle size={16} className="connection-state-spin" aria-hidden="true"/> : <span className="connection-state-dot" aria-hidden="true"/>}
        <span>{checking ? 'Перевіряємо з’єднання…' : `Автоматична перевірка триває${elapsed >= 60 ? ` · ${Math.floor(elapsed / 60)} хв` : ''}`}</span>
        {attempt > 0 && <span className="visually-hidden">Кількість повторних перевірок: {attempt}</span>}
      </div>
      <div className={`connection-state-actions${incompatible ? ' is-incompatible' : ''}`}>
        {incompatible && <button type="button" className="primary-button" onClick={() => void retryUpdates()} disabled={checkingUpdates || visibleClientUpdate?.status === 'checking' || visibleClientUpdate?.confirmed}><Download size={17} aria-hidden="true"/>{checkingUpdates || visibleClientUpdate?.status === 'checking' ? 'Перевірка…' : 'Перевірити наявність оновлень'}</button>}
        <button type="button" className={incompatible ? 'secondary-button' : 'primary-button'} onClick={() => void retry()} disabled={checking || !apiUrl}><RefreshCw size={17} aria-hidden="true"/>{checking ? 'Перевіряємо з’єднання…' : 'Спробувати знову'}</button>
      </div>
      {status === 'unavailable' && !incompatible && <div className="connection-state-update-panel">
        <div className="connection-state-update-version"><strong>HromadaAID{clientVersion ? ` ${clientVersion}` : ''}</strong><span>Поточна версія програми</span></div>
        <button type="button" className="connection-state-update-button" onClick={() => void retryUpdates()} disabled={checkingUpdates || visibleClientUpdate?.status === 'checking' || visibleClientUpdate?.confirmed}>
          {checkingUpdates || visibleClientUpdate?.status === 'checking' ? <LoaderCircle size={15} className="connection-state-spin" aria-hidden="true"/> : <Download size={15} aria-hidden="true"/>}
          {checkingUpdates || visibleClientUpdate?.status === 'checking' ? 'Перевірка…' : 'Перевірити оновлення'}
        </button>
      </div>}
    </section>
  </main>
}
