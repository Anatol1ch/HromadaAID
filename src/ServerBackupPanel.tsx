import { Download, HardDriveDownload, LoaderCircle, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BackupArchive, RestorePreview, ServerBackupList } from '../shared/backup-contract'
import Alert from './components/Alert'
import DictionaryTable from './components/DictionaryTable'
import Modal from './components/Modal'
import SystemToast, { type SystemNoticeKind } from './components/SystemToast'
import { beginExclusiveOperation, restorePendingNotice, safeBackupErrorMessage } from './lib/backup-operations'

const date = (value: string | null) => value ? new Date(value).toLocaleString('uk-UA') : 'Дата в архіві не зазначена'
const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} МіБ`
type Notice = { kind: SystemNoticeKind; title: string; message: string }

export default function ServerBackupPanel() {
  const [list, setList] = useState<ServerBackupList | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [operationLabel, setOperationLabel] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    let active = true
    mounted.current = true
    void window.hromadaAid.backups.listServer()
      .then(value => { if (active) setList(value) })
      .catch(error => { if (active) setNotice({ kind: 'error', title: 'Не вдалося завантажити копії', message: safeBackupErrorMessage(error) }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; mounted.current = false }
  }, [])

  const run = async (label: string, operation: () => Promise<void>) => {
    if (maintenance || loading) return
    const task = beginExclusiveOperation(running, operation)
    if (!task.started) return
    setBusy(true); setOperationLabel(label); setNotice(null)
    try { await task.result }
    catch (error) { if (mounted.current) setNotice({ kind: 'error', title: 'Операцію не виконано', message: safeBackupErrorMessage(error) }) }
    finally { if (mounted.current) { setBusy(false); setOperationLabel('') } }
  }

  const prepare = async (item?: BackupArchive) => {
    const value = item
      ? await window.hromadaAid.backups.prepareServerRestore(item.id)
      : await window.hromadaAid.backups.prepareFileRestore()
    if (value && mounted.current) {
      setPreview(value)
      setConfirmed(false)
      setNotice({ kind: 'success', title: 'Архів перевірено', message: 'Резервна копія пройшла перевірку та готова до підтвердження відновлення.' })
    }
  }

  return <section className="dashboard-panel server-backup-panel" aria-labelledby="server-backup-title">
    <div className="settings-card-heading"><span className="settings-icon"><HardDriveDownload size={20} aria-hidden="true"/></span><div><h2 id="server-backup-title">Серверні резервні копії</h2><p>{list?.schedule ?? 'Автоматичне резервування — щодня о 12:00 за локальним часом сервера.'}</p></div></div>
    <p className="server-backup-intro">Ручні копії зберігаються окремо від щоденних. Перед відновленням система перевіряє архів і створює страхову копію поточної бази.</p>

    <section className="server-backup-group" aria-labelledby="server-backup-actions-title">
      <div className="server-backup-group-heading"><h3 id="server-backup-actions-title">Керування копіями</h3><p>Створіть копію або перевірте архів для подальшого відновлення.</p></div>
      <div className="backup-settings-actions">
        <button className="primary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run('Створюємо резервну копію на сервері…', async () => {
          const value = await window.hromadaAid.backups.createServer()
          if (!mounted.current) return
          setList(value)
          const newest = value.archives.find(item => item.kind === 'manual')
          setNotice({ kind: 'success', title: 'Резервну копію створено', message: newest ? `Копію успішно збережено на сервері: ${date(newest.createdAt)}.` : 'Резервну копію успішно збережено на сервері.' })
        })}><HardDriveDownload size={17} aria-hidden="true"/>Створити копію</button>
        <button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run('Завантажуємо й перевіряємо файл…', () => prepare())}><Upload size={17} aria-hidden="true"/>Перевірити файл .hraid</button>
        <button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run('Оновлюємо перелік архівів…', async () => {
          const value = await window.hromadaAid.backups.listServer()
          if (mounted.current) { setList(value); setNotice({ kind: 'success', title: 'Перелік оновлено', message: 'Список серверних резервних копій оновлено.' }) }
        })}><RotateCcw size={17} aria-hidden="true"/>Оновити перелік</button>
      </div>
      {operationLabel && <div className="backup-operation-status" role="status" aria-live="polite"><LoaderCircle size={17} aria-hidden="true"/>{operationLabel}</div>}
      {maintenance && <div className="backup-admin-instruction"><Alert variant="warning"><strong>Триває технічне обслуговування.</strong> Сервер очікує завершення адміністративної процедури відновлення. Операції з копіями тимчасово недоступні.</Alert><div><strong>Для адміністратора сервера</strong><p>Зупиніть Fastify, виконайте <code>pnpm server:backup-restore</code> у серверному терміналі й дочекайтеся завершення команди. Запустіть Fastify після успішного завершення.</p></div></div>}
    </section>

    <section className="server-backup-group" aria-labelledby="server-backup-list-title">
      <div className="server-backup-group-heading"><h3 id="server-backup-list-title">Архіви на сервері</h3><p>Доступні завершені копії, які можна завантажити або підготувати до відновлення.</p></div>
      <DictionaryTable loading={loading} label="Серверні резервні копії" columns={[{ label: 'Дата й час' }, { label: 'Тип' }, { label: 'Розмір' }, { label: 'Цілісність' }, { label: 'Дії' }]} empty={!list?.archives.length ? 'Серверних архівів поки немає.' : undefined}>
        {list?.archives.map(item => <tr key={item.id}>
          <td><time dateTime={item.createdAt}>{date(item.createdAt)}</time><span className="backup-archive-name" title={item.fileName}>{item.fileName}</span></td>
          <td>{item.kind === 'manual' ? 'Ручна' : 'Автоматична'}</td>
          <td>{size(item.size)}</td>
          <td>{item.integrity === 'verified' ? 'Перевірено' : 'Не перевірено'}</td>
          <td><div className="backup-settings-actions backup-row-actions">
            <button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run('Завантажуємо архів на комп’ютер…', async () => {
              const result = await window.hromadaAid.backups.downloadServer(item.id)
              if (!mounted.current || !result.ok) {
                if (mounted.current && result.message) setNotice({ kind: 'info', title: 'Завантаження не завершено', message: result.message })
                return
              }
              setNotice({ kind: 'success', title: 'Архів завантажено', message: 'Резервну копію збережено на вашому комп’ютері.' })
            })}><Download size={16} aria-hidden="true"/>Завантажити</button>
            <button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run('Перевіряємо архів і готуємо відновлення…', () => prepare(item))}><RotateCcw size={16} aria-hidden="true"/>Перевірити для відновлення</button>
          </div></td>
        </tr>)}
      </DictionaryTable>
    </section>

    {notice && <SystemToast key={`${notice.title}-${notice.message}`} kind={notice.kind} title={notice.title} message={notice.message} onClose={() => setNotice(null)} duration={notice.kind === 'warning' ? 0 : 5_000}/>}
    {preview && <Modal title="Відновлення резервної копії" description="Перевірте дату архіву та наслідки перед підтвердженням." busy={busy} onClose={() => { if (!busy) setPreview(null) }}>
      <div className="backup-restore-warning"><strong>Увага! Відновлення замінить поточні дані системи.</strong><span>Дата копії: {date(preview.createdAt)}</span><Alert variant="error">{preview.message}</Alert><p>Усі зміни, внесені після дати створення резервної копії, буде втрачено. Після підтвердження система перейде в режим технічного обслуговування. Для завершення відновлення необхідно виконати адміністративну процедуру на сервері.</p><p>Підготовка відновлення не означає, що дані вже відновлено. Після завершення процедури всім користувачам потрібно буде увійти до системи повторно.</p></div>
      <p className="server-backup-expiry">Підтвердження чинне до {date(preview.expiresAt)}. Після відновлення всі користувачі мають увійти повторно.</p>
      <label className="backup-restore-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/> Я розумію, що зміни після дати копії буде втрачено, й підтверджую підготовку відновлення.</label>
      <div className="settings-form-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setPreview(null)}>Скасувати</button><button className="danger-button" type="button" disabled={busy || !confirmed} onClick={() => void run('Передаємо підтвердження серверу…', async () => {
        const result = await window.hromadaAid.backups.confirmRestore(preview.id, preview.confirmationToken)
        if (mounted.current) { setPreview(null); setMaintenance(true); setNotice({ ...restorePendingNotice, message: `${result.message} ${restorePendingNotice.message}` }) }
      })}>Підтвердити підготовку</button></div>
    </Modal>}
  </section>
}
