import { Download, HardDriveDownload, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BackupArchive, RestorePreview, ServerBackupList } from '../shared/backup-contract'
import Alert from './components/Alert'
import DictionaryTable from './components/DictionaryTable'
import Modal from './components/Modal'

const date = (value: string | null) => value ? new Date(value).toLocaleString('uk-UA') : 'Не збережена в архіві формату 1'
const errorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Операцію не виконано. Перевірте підключення до сервера.'

export default function ServerBackupPanel() {
  const [list, setList] = useState<ServerBackupList | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const running = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    let active = true
    mounted.current = true
    void window.hromadaAid.backups.listServer().then(value => { if (active) setList(value) }).catch(error => { if (active) setError(errorMessage(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; mounted.current = false }
  }, [])
  const run = async (operation: () => Promise<void>) => {
    if (running.current || maintenance || loading) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try { await operation() } catch (error) { if (mounted.current) setError(errorMessage(error)) }
    finally { running.current = false; if (mounted.current) setBusy(false) }
  }
  const prepare = async (item?: BackupArchive) => {
    const value = item ? await window.hromadaAid.backups.prepareServerRestore(item.id) : await window.hromadaAid.backups.prepareFileRestore()
    if (value && mounted.current) { setPreview(value); setConfirmed(false) }
  }
  return <section className="dashboard-panel settings-account">
    <div className="settings-card-heading"><span className="settings-icon"><HardDriveDownload size={20} aria-hidden="true"/></span><div><h2>Серверні резервні копії</h2><p>{list?.schedule ?? 'Автоматичне резервування — щодня о 12:00 за локальним часом сервера.'}</p></div></div>
    <p className="settings-profile-note">Ручні копії не замінюють щоденні й зберігаються окремо. Відновлення завершується в серверному терміналі після зупинення Fastify. Перед заміною створюється страхова копія.</p>
    {error && <Alert variant="error">{error}</Alert>}
    {message && <p role="status">{message}</p>}
    <div className="backup-settings-actions">
      <button className="primary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run(async () => { const value = await window.hromadaAid.backups.createServer(); if (mounted.current) { setList(value); const newest = value.archives.find(item => item.kind === 'manual'); setMessage(newest ? `Копію створено: ${date(newest.createdAt)}.` : 'Резервну копію створено.') } })}><HardDriveDownload size={17}/>Створити резервну копію</button>
      <button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run(() => prepare())}><Upload size={17}/>Відновити з файлу</button>
      <button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run(async () => { const value = await window.hromadaAid.backups.listServer(); if (mounted.current) setList(value) })}>Оновити список</button>
    </div>
    <DictionaryTable loading={loading} label="Серверні резервні копії" columns={[{ label: 'Дата й час' }, { label: 'Тип' }, { label: 'Розмір' }, { label: 'Цілісність' }, { label: 'Дії' }]} empty={!list?.archives.length ? 'Серверних архівів поки немає.' : undefined}>
      {list?.archives.map(item => <tr key={item.id}><td>{date(item.createdAt)}</td><td>{item.kind === 'manual' ? 'Ручна' : 'Автоматична'}</td><td>{(item.size / 1024 / 1024).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} МіБ</td><td>Перевірено</td><td><div className="backup-settings-actions"><button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run(async () => { const result = await window.hromadaAid.backups.downloadServer(item.id); if (mounted.current) setMessage(result.ok ? 'Зашифрований архів збережено.' : result.message ?? 'Збереження скасовано.') })}><Download size={16}/>Завантажити</button><button className="secondary-button" type="button" disabled={busy || loading || maintenance} onClick={() => void run(() => prepare(item))}><RotateCcw size={16}/>Відновити</button></div></td></tr>)}
    </DictionaryTable>
    {preview && <Modal title="Відновлення резервної копії" description="Уважно перевірте дату копії перед підтвердженням." busy={busy} onClose={() => { if (!busy) setPreview(null) }}>
      <p><strong>Дата копії: {date(preview.createdAt)}</strong></p>
      <Alert variant="error">{preview.message}</Alert>
      <p>Підтвердження чинне до {date(preview.expiresAt)}. Усі користувачі мають увійти повторно після відновлення.</p>
      {error && <Alert variant="error">{error}</Alert>}
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/> Я розумію, що зміни після дати копії буде втрачено, й підтверджую відновлення.</label>
      <div className="settings-form-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setPreview(null)}>Скасувати</button><button className="primary-button" type="button" disabled={busy || !confirmed} onClick={() => void run(async () => { const result = await window.hromadaAid.backups.confirmRestore(preview.id, preview.confirmationToken); if (mounted.current) { setMessage(result.message); setPreview(null); setMaintenance(true) } })}>Підтвердити відновлення</button></div>
    </Modal>}
  </section>
}
