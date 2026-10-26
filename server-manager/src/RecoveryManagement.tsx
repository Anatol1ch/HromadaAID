import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import Alert from '../../src/components/Alert'
import type { InspectionSnapshot } from '../electron/inspection-types'
import type { RecoveryKind, RecoveryStatus } from '../electron/recovery-contract'
import { Modal, OperationProgress, OperationResult } from './ManagerUI'
import { apiDisplay, serviceDisplay } from './inspection-presentation'

const labels: Record<RecoveryKind, string> = { update: 'Відновити сервер', 'resume-restore': 'Продовжити відновлення', 'return-database': 'Повернути попередню базу' }
const explanations: Record<RecoveryKind, string> = {
  update: 'Сервер буде тимчасово недоступний. Буде перевірено транзакцію, пакети й стан служби. Працездатний новий пакет буде збережено; повернення попереднього виконується лише за підтвердженої сумісності SQLite.',
  'resume-restore': 'Буде продовжено вже підтверджену операцію за її журналом. Сервер буде тимчасово недоступний. Новий архів не обирається.',
  'return-database': 'Поточну базу буде замінено збереженою попередньою базою. Повернення виконається лише якщо повторна офлайн-перевірка підтвердить відсутність змін після restore. Обидві бази залишаться збереженими.',
}

export default function RecoveryManagement({ inspection, section, externalBusy, onBusyChange, onInspection }: { inspection: InspectionSnapshot | null; section: string; externalBusy: boolean; onBusyChange: (value: boolean) => void; onInspection: (value: InspectionSnapshot) => void }) {
  const api = window.hromadaManager
  const [status, setStatus] = useState<RecoveryStatus | null>(null)
  const [kind, setKind] = useState<RecoveryKind | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    if (externalBusy || inFlight.current || !api.recoveryStatus) return
    let active = true
    void api.recoveryStatus().then(value => { if (active) setStatus(value) }).catch(() => { if (active) setStatus(null) })
    return () => { active = false }
  }, [api, inspection?.checkedAt, externalBusy])
  useEffect(() => api.onRecoveryProgress?.(value => setMessage(value.message)), [api])
  const close = () => { if (!inFlight.current) { setKind(null); setResult(null); setMessage('') } }
  const run = async () => {
    if (!kind || inFlight.current || externalBusy) return
    inFlight.current = true; setBusy(true); onBusyChange(true); setMessage('Повторна перевірка передумов аварійного відновлення.')
    try { setResult(await api.recoverOperation(kind, true)) }
    catch (error) { setResult({ success: false, message: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Результат операції не підтверджено. Артефакти збережено.' }) }
    finally {
      try { onInspection(await api.inspectEnvironment()); setStatus(await api.recoveryStatus()) } catch { setResult(current => current && ({ ...current, message: current.message + ' Повторну діагностику не завершено; нижче наведено останні відомі дані.' })) }
      inFlight.current = false; setBusy(false); onBusyChange(false)
    }
  }
  const choose = (value: RecoveryKind) => { if (!externalBusy && !inFlight.current) { setKind(value); setResult(null); setMessage('') } }
  const showUpdate = ['updates', 'overview'].includes(section)
  const showRestore = ['backups', 'overview'].includes(section)
  return <>
    {showUpdate && status?.update.pending && <Alert variant="warning"><p>{status.update.reason}</p><button className="secondary-button" type="button" disabled={externalBusy || !status.update.canRecover || status.restore.pending} onClick={() => choose('update')}><RotateCcw size={16}/>Відновити сервер</button></Alert>}
    {showRestore && status?.restore.pending && <Alert variant="warning"><p>{status.restore.reason}</p><button className="secondary-button" type="button" disabled={externalBusy || status.update.pending} onClick={() => choose('resume-restore')}><RotateCcw size={16}/>Продовжити відновлення</button></Alert>}
    {showRestore && !status?.restore.pending && status?.restore.canReturn && <Alert variant="warning"><p>{status.restore.reason}</p><button className="danger-button" type="button" disabled={externalBusy || status.update.pending} onClick={() => choose('return-database')}><RotateCcw size={16}/>Повернути попередню базу</button></Alert>}
    {showRestore && status?.restore.reason && !status.restore.pending && !status.restore.canReturn && <Alert variant="warning">{status.restore.reason}</Alert>}
    {kind && <Modal title={labels[kind]} icon={<RotateCcw size={21}/>} busy={busy} onClose={close} footer={busy ? <span>Операція триває. Закриття тимчасово недоступне.</span> : result ? <button className="secondary-button" type="button" onClick={close}>Готово</button> : <><button className="secondary-button" type="button" onClick={close}>Скасувати</button><button className={kind === 'return-database' ? 'danger-button' : 'primary-button'} type="button" disabled={externalBusy} onClick={() => void run()}>{labels[kind]}</button></>}>
      {busy ? <OperationProgress message={message}/> : result ? <><OperationResult success={result.success} title={result.success ? 'Відновлення завершено' : 'Потрібна перевірка адміністратора'} message={result.message}/><dl className="sm-details sm-summary-rows"><div><dt>Windows Service</dt><dd>{inspection ? serviceDisplay(inspection.service.status).label : 'Не перевірено'}</dd></div><div><dt>API</dt><dd>{inspection ? apiDisplay(inspection.api.status).label : 'Не перевірено'}</dd></div><div><dt>Остання перевірка</dt><dd>{inspection ? new Date(inspection.checkedAt).toLocaleString('uk-UA') : 'Не виконувалася'}</dd></div></dl></> : <Alert variant="warning">{explanations[kind]}</Alert>}
    </Modal>}
  </>
}
