import { Download, Package, RefreshCw, ShieldCheck } from 'lucide-react'
import Alert from '../../src/components/Alert'
import type { InspectionSnapshot } from '../electron/inspection-types'
import type { ServerUpdatePreview, ServerUpdateProgress, ServerUpdateResult } from '../electron/server-update-contract'
import { apiDisplay, serviceDisplay } from './inspection-presentation'
import { Modal, OperationProgress, OperationResult, StatusBadge } from './ManagerUI'

const stages = [{ id: 'package', label: 'Перевірка ZIP' }, { id: 'compatibility', label: 'Сумісність' }, { id: 'prepare', label: 'Підготовка' }, { id: 'stop', label: 'Зупинка служби' }, { id: 'switch', label: 'Активація пакета' }, { id: 'start', label: 'Запуск служби' }, { id: 'health', label: 'Перевірка API' }]

export default function UpdateManagement({ inspection, preview, busy, progress, result, lastResult, error, errorDetails, disabled, choose, cancel, apply, refresh }: { inspection: InspectionSnapshot | null; preview: ServerUpdatePreview | null; busy: boolean; progress: ServerUpdateProgress | null; result: ServerUpdateResult | null; lastResult: ServerUpdateResult | null; error: string; errorDetails: string; disabled: boolean; choose: () => void; cancel: () => void; apply: () => void; refresh: () => void }) {
  const service = inspection ? serviceDisplay(inspection.service.status) : { label: 'Не перевірено', tone: 'info' }
  const api = inspection ? apiDisplay(inspection.api.status) : { label: 'Не перевірено', tone: 'info' }
  const modalOpen = busy || preview || result || error
  return <>
    <section className="dashboard-panel sm-package-summary"><span className="sm-card-icon"><Package size={25}/></span><div><h2>HromadaAID API Server</h2><dl><div><dt>Версія</dt><dd>{inspection?.configuration.serverVersion ?? 'Не визначено'}</dd></div><div><dt>API Contract</dt><dd>{inspection?.api.contractVersion ?? 'Не отримано'}</dd></div><div><dt>Windows Service</dt><dd><StatusBadge tone={service.tone}>{service.label}</StatusBadge></dd></div><div><dt>API</dt><dd><StatusBadge tone={api.tone}>{api.label}</StatusBadge></dd></div></dl></div></section>
    <section className="dashboard-panel sm-update-source"><Download size={28}/><div><h2>Оновити сервер</h2><p>Виберіть серверний ZIP. Перевірка цілісності та сумісності виконується до зупинки служби.</p></div><button className="primary-button" type="button" disabled={disabled || busy || inspection?.updateReadiness?.ready !== true} onClick={choose}><Package size={17}/>Вибрати ZIP-файл</button>{inspection?.updateReadiness?.ready !== true && <p className="sm-update-readiness">{inspection?.updateReadiness?.reason ?? 'Спочатку перевірте стан сервера.'}</p>}</section>
    {!modalOpen && lastResult?.manualRecoveryRequired && inspection?.updateReadiness?.ready !== true && <Alert variant="warning">Останнє оновлення потребує ручного відновлення. Збережіть службові каталоги й журнал транзакції та перевірте діагностику.</Alert>}
    {modalOpen && <Modal title="Оновлення сервера" icon={<Download size={21}/>} wide busy={busy} onClose={cancel} footer={busy ? <span className="sm-muted">Дочекайтеся завершення операції.</span> : <>
      <button className="secondary-button" type="button" onClick={cancel}>{preview ? 'Скасувати' : 'Готово'}</button>
      {preview && !result && !error && <button className="primary-button" type="button" onClick={apply} disabled={disabled || preview.sameVersion}><RefreshCw size={16}/>Встановити оновлення</button>}
      {(result || error) && <button className="secondary-button" type="button" onClick={refresh} disabled={disabled}><RefreshCw size={16}/>Перевірити стан</button>}
    </>}>
      {busy ? <OperationProgress message={progress?.message ?? 'Перевірка пакета…'} stages={stages} current={progress?.stage}/> : result ? <OperationResult success={result.success} title={result.success ? 'Оновлення завершено' : result.rolledBack ? 'Попередню версію відновлено' : result.manualRecoveryRequired ? 'Потрібне ручне відновлення' : 'Оновлення не розпочато'} message={result.message} details={result.details}>
        {result.manualRecoveryRequired && <Alert variant="warning">Не видаляйте Server.next, Server.previous, Server.failed або журнал оновлення.</Alert>}
      </OperationResult> : error ? <OperationResult success={false} title="Операцію не завершено" message={error} details={errorDetails}/> : preview && <>
        <div className="sm-version-comparison"><div><span>Поточна версія</span><strong>{preview.currentVersion}</strong></div><div><span>Версія пакета</span><strong>{preview.newVersion}</strong></div></div>
        <dl className="sm-details sm-summary-rows"><div><dt>Пакет</dt><dd className="sm-archive-name">{preview.sourceName}</dd></div><div><dt>Цілісність</dt><dd><StatusBadge tone="success"><ShieldCheck size={14}/>Перевірено</StatusBadge></dd></div><div><dt>API Contract</dt><dd>{preview.apiContract}</dd></div><div><dt>Сумісність бази</dt><dd>Схема {preview.currentSchema} підтримується (діапазон {preview.sqliteRange.minimum}–{preview.sqliteRange.maximum})</dd></div></dl>
        {preview.sameVersion ? <Alert variant="info">Ця версія сервера вже встановлена. Оновлення не потрібне.</Alert> : <Alert variant="warning">Пакет не має цифрового підпису. Продовжуйте лише з ZIP, отриманим із довіреного джерела.</Alert>}
        <p className="sm-muted">Під час оновлення сервер буде тимчасово недоступний.</p>
      </>}
      {!busy && (result || error) && <dl className="sm-details sm-summary-rows"><div><dt>Windows Service</dt><dd><StatusBadge tone={service.tone}>{service.label}</StatusBadge></dd></div><div><dt>API</dt><dd><StatusBadge tone={api.tone}>{api.label}</StatusBadge></dd></div><div><dt>Остання перевірка</dt><dd>{inspection ? new Date(inspection.checkedAt).toLocaleString('uk-UA') : 'Не виконувалася'}</dd></div></dl>}
    </Modal>}
  </>
}
