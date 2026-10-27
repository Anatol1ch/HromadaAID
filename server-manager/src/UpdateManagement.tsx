import { Download, Package, RefreshCw, ShieldCheck } from 'lucide-react'
import Alert from '../../src/components/Alert'
import type { InspectionSnapshot } from '../electron/inspection-types'
import type { ServerUpdatePreview, ServerUpdateProgress, ServerUpdateResult } from '../electron/server-update-contract'
import { apiDisplay, serviceDisplay } from './inspection-presentation'
import { releaseUpdateDisplay } from './release-update-presentation'
import { Modal, OperationProgress, OperationResult, StatusBadge } from './ManagerUI'
import type { ReleaseUpdateState, ServerReleaseState } from '../electron/server-update-contract'
import { ReleaseNotes, ReleaseUpdateProgress } from '../../src/components/ReleaseUpdateDetails'

const stages = [
  { id: 'package', label: 'Перевірка ZIP' },
  { id: 'compatibility', label: 'Сумісність' },
  { id: 'prepare', label: 'Підготовка' },
  { id: 'stop', label: 'Зупинка служби' },
  { id: 'switch', label: 'Активація пакета' },
  { id: 'start', label: 'Запуск служби' },
  { id: 'health', label: 'Перевірка API' },
]

function UpdateStatus({ state, checking = false }: { state: ReleaseUpdateState | ServerReleaseState | null; checking?: boolean }) {
  const display = releaseUpdateDisplay(state, checking)
  return <div className="sm-release-status" role={display.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
    <StatusBadge tone={display.tone}>{display.label}</StatusBadge>
    {state?.error && <span className="sm-release-status-detail">{state.error}</span>}
  </div>
}

export default function UpdateManagement({ inspection, preview, busy, progress, result, lastResult, error, errorDetails, disabled, choose, cancel, apply, refresh, managerUpdate, serverUpdate, checkingReleases = false, checkReleases, downloadManager, installManager, downloadServer }: {
  inspection: InspectionSnapshot | null
  preview: ServerUpdatePreview | null
  busy: boolean
  progress: ServerUpdateProgress | null
  result: ServerUpdateResult | null
  lastResult: ServerUpdateResult | null
  error: string
  errorDetails: string
  disabled: boolean
  choose: () => void
  cancel: () => void
  apply: () => void
  refresh: () => void
  managerUpdate: ReleaseUpdateState | null
  serverUpdate: ServerReleaseState | null
  checkingReleases?: boolean
  checkReleases: () => void
  downloadManager: () => void
  installManager: () => void
  downloadServer: () => void
}) {
  const service = inspection ? serviceDisplay(inspection.service.status) : { label: 'Не перевірено', tone: 'info' }
  const api = inspection ? apiDisplay(inspection.api.status) : { label: 'Не перевірено', tone: 'info' }
  const modalOpen = busy || preview || result || error
  const downloadingServerPackage = busy && progress?.operationId === 'release-download'
  const managerDownloading = managerUpdate?.status === 'downloading' || managerUpdate?.status === 'verifying'
  const managerOperationBusy = checkingReleases || managerUpdate?.status === 'checking' || managerDownloading || managerUpdate?.status === 'installing' || managerUpdate?.status === 'restarting'

  return <>
    <section className="dashboard-panel sm-package-summary">
      <span className="sm-card-icon"><Download size={25}/></span>
      <div className="sm-package-summary-content">
        <h2>Server Manager</h2>
        <dl>
          <div><dt>Встановлена версія</dt><dd>{managerUpdate?.installedVersion ?? 'Не визначено'}</dd></div>
          <div><dt>Доступна версія</dt><dd>{managerUpdate?.availableVersion ?? '—'}</dd></div>
          <div><dt>Стан оновлення</dt><dd><UpdateStatus state={managerUpdate} checking={checkingReleases}/></dd></div>
          <div><dt>Остання перевірка</dt><dd>{managerUpdate?.checkedAt ? new Date(managerUpdate.checkedAt).toLocaleString('uk-UA') : 'Не виконувалася'}</dd></div>
        </dl>
        {managerDownloading && <ReleaseUpdateProgress
          label={managerUpdate.status === 'verifying' ? 'Перевірка завантаженого файла' : 'Завантаження Setup'}
          receivedBytes={managerUpdate.receivedBytes}
          totalBytes={managerUpdate.totalBytes}
          indeterminate={managerUpdate.status === 'verifying'}
        />}
      </div>
      <div className="sm-card-actions">
        <button className="primary-button" type="button" disabled={disabled || busy || managerOperationBusy} onClick={checkReleases} aria-busy={checkingReleases}>
          <RefreshCw size={16}/>{checkingReleases ? 'Перевіряємо…' : 'Перевірити оновлення'}
        </button>
        {(managerUpdate?.status === 'available' || managerUpdate?.status === 'error') && <button className="secondary-button" type="button" disabled={busy} onClick={downloadManager}><Download size={16}/>Завантажити оновлення Manager</button>}
        {managerUpdate?.status === 'ready' && <button className="secondary-button" type="button" disabled={busy} onClick={installManager}>Оновити зараз</button>}
      </div>
    </section>

    <section className="dashboard-panel sm-package-summary">
      <span className="sm-card-icon"><Package size={25}/></span>
      <div className="sm-package-summary-content">
        <h2>HromadaAID API Server</h2>
        <dl>
          <div><dt>Встановлена версія</dt><dd>{inspection?.configuration.serverVersion ?? 'Не визначено'}</dd></div>
          <div><dt>Доступна версія</dt><dd>{serverUpdate?.availableVersion ?? '—'}</dd></div>
          <div><dt>Стан Windows Service</dt><dd><StatusBadge tone={service.tone}>{service.label}</StatusBadge></dd></div>
          <div><dt>Стан API</dt><dd><StatusBadge tone={api.tone}>{api.label}</StatusBadge></dd></div>
          <div><dt>Стан оновлення</dt><dd><UpdateStatus state={serverUpdate}/></dd></div>
          <div><dt>Остання перевірка</dt><dd>{serverUpdate?.checkedAt ? new Date(serverUpdate.checkedAt).toLocaleString('uk-UA') : 'Не виконувалася'}</dd></div>
        </dl>
        {serverUpdate?.notes && <details className="sm-release-notes-toggle">
          <summary>Що нового</summary>
          <ReleaseNotes notes={serverUpdate.notes} heading="" preserveLineBreaks/>
        </details>}
        {!busy && (serverUpdate?.status === 'downloading' || serverUpdate?.status === 'verifying') && <ReleaseUpdateProgress
          label={serverUpdate.status === 'verifying' ? 'Перевірка цілісності Server ZIP' : 'Завантаження оновлення сервера'}
          receivedBytes={serverUpdate.receivedBytes}
          totalBytes={serverUpdate.totalBytes}
          indeterminate={serverUpdate.status === 'verifying'}
        />}
      </div>
      <div className="sm-card-actions">
        {serverUpdate?.status === 'available' && <button className="primary-button" type="button" disabled={disabled || busy || managerUpdate?.confirmed || managerUpdate?.installedVersion !== serverUpdate.availableVersion} onClick={downloadServer}>
          <Download size={17}/>Завантажити оновлення
        </button>}
      </div>
    </section>

    <section className="dashboard-panel sm-update-source">
      <Download size={28}/>
      <div><h2>Оновити сервер</h2><p>Виберіть серверний ZIP. Перевірка цілісності та сумісності виконується до зупинки служби.</p></div>
      <button className="primary-button" type="button" disabled={disabled || busy || inspection?.updateReadiness?.ready !== true} onClick={choose}><Package size={17}/>Вибрати ZIP-файл</button>
      {inspection?.updateReadiness?.ready !== true && <p className="sm-update-readiness">{inspection?.updateReadiness?.reason ?? 'Спочатку перевірте стан сервера.'}</p>}
    </section>

    {!modalOpen && lastResult?.manualRecoveryRequired && inspection?.updateReadiness?.ready !== true && <Alert variant="warning">Останнє оновлення потребує ручного відновлення. Збережіть службові каталоги й журнал транзакції та перевірте діагностику.</Alert>}
    {modalOpen && <Modal title="Оновлення сервера" icon={<Download size={21}/>} wide busy={busy} onClose={cancel} footer={busy ? <span className="sm-muted">Дочекайтеся завершення операції.</span> : <>
      <button className="secondary-button" type="button" onClick={cancel}>{preview ? 'Скасувати' : 'Готово'}</button>
      {preview && !result && !error && <button className="primary-button" type="button" onClick={apply} disabled={disabled || preview.sameVersion}><RefreshCw size={16}/>Встановити оновлення</button>}
      {(result || error) && <button className="secondary-button" type="button" onClick={refresh} disabled={disabled}><RefreshCw size={16}/>Перевірити стан</button>}
    </>}>
      {busy ? downloadingServerPackage
        ? <ReleaseUpdateProgress
          label={serverUpdate?.status === 'verifying' || serverUpdate?.status === 'ready' ? 'Перевірка цілісності Server ZIP' : 'Завантаження оновлення сервера'}
          receivedBytes={serverUpdate?.receivedBytes}
          totalBytes={serverUpdate?.totalBytes}
          indeterminate={serverUpdate?.status === 'verifying' || serverUpdate?.status === 'ready' || !serverUpdate?.totalBytes}
        />
        : <OperationProgress message={progress?.message ?? 'Перевірка пакета…'} stages={stages} current={progress?.stage}/>
        : result ? <OperationResult success={result.success} title={result.success ? 'Оновлення завершено' : result.rolledBack ? 'Попередню версію відновлено' : result.manualRecoveryRequired ? 'Потрібне ручне відновлення' : 'Оновлення не розпочато'} message={result.message} details={result.details}>
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
