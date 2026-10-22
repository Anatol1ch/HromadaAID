import { FolderOpen, HardDriveDownload, Monitor, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AuthenticatedUser } from '../shared/auth-contract'
import type { BackupInstallation, ClientBackupState } from '../shared/backup-contract'
import Alert from './components/Alert'
import DictionaryTable from './components/DictionaryTable'
import ServerBackupPanel from './ServerBackupPanel'

const date = (value?: string | null) => value ? new Date(value).toLocaleString('uk-UA') : 'Ще немає'

export default function BackupSettings({ user }: { user: AuthenticatedUser | null }) {
  const administrator = !!user?.permissions.includes('backups.manage')
  const userId = user?.id
  const [state, setState] = useState<ClientBackupState>({ status: 'checking' })
  const [computers, setComputers] = useState<BackupInstallation[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(administrator)
  useEffect(() => {
    let active = true
    const poll = () => { void window.hromadaAid.backups.getState().then(value => { if (active) setState(value) }).catch(() => { if (active) setError('Не вдалося прочитати стан резервування.') }) }
    poll()
    if (administrator) void window.hromadaAid.backups.listComputers().then(value => { if (active) setComputers(value) }).catch(() => { if (active) setError('Не вдалося завантажити комп’ютери.') }).finally(() => { if (active) setLoading(false) })
    const timer = setInterval(poll, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [administrator, userId])

  const refresh = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const [value, list] = await Promise.all([window.hromadaAid.backups.refresh(), administrator ? window.hromadaAid.backups.listComputers() : Promise.resolve(null)])
      setState(value); if (list) setComputers(list)
    } catch { setError('Не вдалося оновити резервування. Перевірте підключення.') }
    finally { setBusy(false) }
  }
  const setAllowed = async (computer: BackupInstallation) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const value = await window.hromadaAid.backups.setAllowed(computer.id, !computer.allowed, computer.updatedAt)
      setComputers(current => current.map(item => item.id === value.id ? value : item))
      await window.hromadaAid.backups.refresh()
    } catch { setError('Не вдалося змінити дозвіл. Оновіть список: його міг змінити інший адміністратор.') }
    finally { setBusy(false) }
  }
  const openFolder = async () => {
    const result = await window.hromadaAid.backups.openFolder().catch(() => ({ ok: false, message: 'Не вдалося відкрити папку копій.' }))
    if (!result.ok) setError(result.message ?? 'Папка копій поки недоступна.')
  }
  return <div className="backup-settings">
    <section className="dashboard-panel settings-account">
      <div className="settings-card-heading"><span className="settings-icon"><HardDriveDownload size={20} aria-hidden="true"/></span><div><h2>Резервне копіювання</h2><p>Зашифровані копії центральної бази на дозволених комп’ютерах.</p></div></div>
      <p role="status">{!user ? 'У локальному режимі розподілене резервування не використовується.' : state.message ?? (state.status === 'checking' ? 'Перевірка резервування…' : 'Стан резервування визначається після входу.')}</p>
      {user && <><dl className="settings-profile-grid"><div><dt>Цей комп’ютер</dt><dd>{state.status === 'disabled' ? 'Заборонено' : state.status === 'enabled' ? 'Дозволено' : state.status === 'checking' ? 'Перевірка…' : 'Тимчасово недоступно'}</dd></div><div><dt>Остання успішна копія</dt><dd>{date(state.lastBackupAt)}</dd></div></dl><p className="settings-profile-note">Зберігаються останні 7 перевірених копій. Після відкликання дозволу наявні архіви залишаються на комп’ютері.</p><div className="backup-settings-actions"><button className="secondary-button" type="button" onClick={() => void openFolder()}><FolderOpen size={17}/>Відкрити папку копій</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={17}/>Оновити стан</button></div></>}
    </section>
    {error && <Alert variant="error">{error}</Alert>}
    {administrator && <ServerBackupPanel key={userId}/>}
    {administrator && <section className="dashboard-panel settings-account">
      <div className="settings-card-heading"><span className="settings-icon"><Monitor size={20} aria-hidden="true"/></span><div><h2>Клієнтські комп’ютери</h2><p>Нові інсталяції з’являються після входу й спочатку не мають дозволу. Для цього комп’ютера дозвіл також потрібно надати.</p></div></div>
      <DictionaryTable label="Дозволи клієнтських комп’ютерів" columns={[{ label: 'Комп’ютер' }, { label: 'Останнє підключення' }, { label: 'Статус' }, { label: 'Остання копія' }, { label: 'Дії' }]} loading={loading} empty={!computers.length ? loading ? 'Завантаження…' : 'Зареєстрованих комп’ютерів поки немає.' : undefined}>
        {computers.map(computer => <tr key={computer.id}><td><strong>{computer.computerName}</strong></td><td>{date(computer.lastSeenAt)}</td><td>{computer.allowed ? 'Дозволено' : 'Заборонено'}</td><td>{date(computer.lastBackupAt)}</td><td><button type="button" className="secondary-button" disabled={busy} onClick={() => void setAllowed(computer)}>{computer.allowed ? 'Заборонити' : 'Дозволити'}</button></td></tr>)}
      </DictionaryTable>
    </section>}
  </div>
}
