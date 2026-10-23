import { LoaderCircle, RefreshCw, ServerOff, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ServerConnectionCheckResult } from '../../shared/api-contract'
import type { ConnectionFailureReason } from '../../shared/system-state'
import { reconnectDelay, SingleFlightProbe } from '../../shared/system-state'

export default function ConnectionStateOverlay({ status, failureReason, apiUrl, check, onRestored }: { status: 'unavailable' | 'maintenance'; failureReason?: ConnectionFailureReason; apiUrl: string | null; check: (apiUrl: string) => Promise<ServerConnectionCheckResult>; onRestored: () => void }) {
  const [checking, setChecking] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const probe = useRef(new SingleFlightProbe<ServerConnectionCheckResult>())
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
  const maintenance = status === 'maintenance'
  const title = maintenance ? 'Триває технічне обслуговування' : 'З’єднання із сервером втрачено'
  const message = maintenance
    ? 'Сервер тимчасово недоступний через виконання технічних робіт. Спробуйте підключитися пізніше.'
    : 'Не вдалося зв’язатися із сервером HromadaAID. Перевірте мережеве підключення або зверніться до адміністратора.'
  const Icon = maintenance ? Wrench : ServerOff
  return <main className="connection-state-overlay" role="alert" aria-live="assertive" aria-labelledby="connection-state-title">
    <section className="connection-state-card">
      <div className={`connection-state-icon${maintenance ? ' is-maintenance' : ''}`}><Icon size={30} aria-hidden="true"/></div>
      <h1 id="connection-state-title">{title}</h1>
      <p>{message}</p>
      {status === 'unavailable' && failureReason && failureReason !== 'incompatible' && <p className="connection-state-detail">{failureReason === 'timeout' ? 'Сервер не відповів у відведений час.' : failureReason === 'http' ? 'Сервер відповів помилкою перевірки доступності.' : 'Немає мережевого з’єднання із сервером.'}</p>}
      <div className="connection-state-progress" role="status" aria-live="polite">
        {checking ? <LoaderCircle size={16} className="connection-state-spin" aria-hidden="true"/> : <span className="connection-state-dot" aria-hidden="true"/>}
        <span>{checking ? 'Перевіряємо з’єднання…' : `Автоматична перевірка триває${elapsed >= 60 ? ` · ${Math.floor(elapsed / 60)} хв` : ''}`}</span>
        {attempt > 0 && <span className="visually-hidden">Кількість повторних перевірок: {attempt}</span>}
      </div>
      <button type="button" className="primary-button" onClick={() => void retry()} disabled={checking || !apiUrl}><RefreshCw size={17} aria-hidden="true"/>Спробувати знову</button>
    </section>
  </main>
}
