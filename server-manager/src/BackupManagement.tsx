import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Download, Eye, EyeOff, FolderOpen, HardDrive, LogIn, LogOut, Plus, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import type { InspectionSnapshot } from '../electron/inspection-types'
import type { BackupArchive, ServerBackupList } from '../electron/backup-contract'
import Alert from '../../src/components/Alert'
import { IconButton, Modal, OperationProgress, OperationResult, StatusBadge, Toast } from './ManagerUI'
import { apiDisplay, serviceDisplay } from './inspection-presentation'

type User = { username: string; displayName: string | null }
type Archive = { id: string; name: string; createdAt: string | null; size: number; kind: string }
type DialogState = { kind: 'import' | 'verify' | 'restore'; phase: 'review' | 'running' | 'success' | 'error'; archive?: Archive; message?: string; details?: string; attempted?: boolean }
const restoreStages = [{ id: 'verify', label: 'Перевірка архіву' }, { id: 'confirm', label: 'Підготовка' }, { id: 'stop', label: 'Зупинка сервера' }, { id: 'restore', label: 'Відновлення бази' }, { id: 'start', label: 'Запуск служби' }, { id: 'health', label: 'Перевірка API' }]
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('uk-UA') : 'Дата невідома'
const size = (value: number) => value < 1024 ** 2 ? `${(value / 1024).toFixed(0)} КіБ` : `${(value / 1024 ** 2).toFixed(1)} МіБ`
const asArchive = (item: BackupArchive): Archive => ({ id: item.id, name: item.fileName, createdAt: item.createdAt, size: item.size, kind: item.kind === 'manual' ? 'Ручна' : 'Автоматична' })

export default function BackupManagement({ inspection, onBusyChange, externalBusy = false, onInspection }: { inspection: InspectionSnapshot | null; onBusyChange: (busy: boolean) => void; externalBusy?: boolean; onInspection: (snapshot: InspectionSnapshot) => void }) {
  const passwordId = useId()
  const api = window.hromadaManager
  const [user, setUser] = useState<User | null>(null), [list, setList] = useState<ServerBackupList | null>(null)
  const [imports, setImports] = useState<Archive[]>([]), [login, setLogin] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false), [initializing, setInitializing] = useState(true)
  const [busy, setBusy] = useState(false), [activity, setActivity] = useState(''), [error, setError] = useState(''), [toast, setToast] = useState('')
  const [offlineMode, setOfflineMode] = useState(false), [dialog, setDialog] = useState<DialogState | null>(null)
  const [key, setKey] = useState(''), [useKey, setUseKey] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; message: string } | null>(null)
  const [verified, setVerified] = useState<Set<string>>(() => new Set())
  const inFlight = useRef(false)
  const unavailable = busy || externalBusy
  const apiAvailable = inspection?.api.status === 'available'
  const archives = useMemo(() => [...(list?.archives ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [list])
  const begin = (label: string) => {
    if (inFlight.current || externalBusy) return false
    inFlight.current = true; setBusy(true); setActivity(label); onBusyChange(true); setError(''); setToast(''); return true
  }
  const finish = () => { inFlight.current = false; setBusy(false); setActivity(''); onBusyChange(false) }
  const failureText = (e: unknown) => {
    let message = (e instanceof Error ? e.message : 'Операцію не завершено.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    for (const secret of [key, login.password]) if (secret) message = message.split(secret).join('[приховано]')
    return message
  }
  useEffect(() => {
    let active = true
    void api.backupSession().then(async value => { if (!active) return; setUser(value); if (value) { const result = await api.backupList(); if (active) setList(result) } }).catch(() => { if (active) { setUser(null); setError('Не вдалося перевірити сесію або отримати перелік архівів. Увійдіть повторно.') } }).finally(() => { if (active) setInitializing(false) })
    const unsubscribe = api.onBackupProgress(value => {
      if (value.stage === 'session-cleared') { setUser(null); setList(null); setOfflineMode(false); setVerified(new Set()); return }
      setProgress(value)
    })
    return () => { active = false; unsubscribe() }
  }, [api])

  const refresh = async () => {
    if (!begin('Оновлення переліку')) return
    try { setList(await api.backupList()); setVerified(new Set()); setToast('Перелік архівів оновлено.') }
    catch (e) { setError(failureText(e)) } finally { finish() }
  }
  const signIn = async (event: FormEvent) => {
    event.preventDefault(); if (!begin('Вхід адміністратора')) return
    try { const result = await api.backupLogin(login.username, login.password); setUser(result); setOfflineMode(false); setList(await api.backupList()) }
    catch (e) { setError(failureText(e)) } finally { setLogin(current => ({ ...current, password: '' })); setShowPassword(false); finish() }
  }
  const signOut = async () => {
    if (!begin('Завершення сесії')) return
    try { await api.backupLogout() } catch { /* Local session is cleared by the existing logout handler even if API is unavailable. */ }
    finally { setUser(null); setList(null); setError(''); setShowPassword(false); finish() }
  }
  const create = async () => {
    if (!begin('Створення та перевірка резервної копії')) return
    try { setList(await api.backupCreate()); setVerified(new Set()); setToast('Резервну копію створено й перевірено.') }
    catch (e) { setError(failureText(e)) } finally { finish() }
  }
  const exportArchive = async (item: BackupArchive) => {
    if (!begin('Експорт архіву')) return
    try { const result = await api.backupExport(item.id); if (!result.canceled) setToast(result.message ?? 'Архів експортовано.') }
    catch (e) { setError(failureText(e)) } finally { finish() }
  }
  const openDialog = (kind: DialogState['kind'], archive?: Archive) => {
    if (inFlight.current || externalBusy) return
    setKey(''); setUseKey(false); setProgress(null); setDialog({ kind, archive, phase: 'review' })
  }
  const closeDialog = () => { if (inFlight.current) return; setDialog(null); setKey(''); setUseKey(false); setProgress(null) }
  const verifyOrImport = async () => {
    if (!dialog || !begin(dialog.kind === 'import' ? 'Перевірка імпортованого архіву' : 'Перевірка архіву')) return
    const current = dialog
    setDialog({ ...current, phase: 'running' })
    try {
      if (current.kind === 'import') {
        const result = await api.backupImport(useKey && key ? key : undefined)
        if (!result) { setDialog({ ...current, phase: 'review' }); return }
        const archive = { id: result.id, name: result.fileName, createdAt: result.createdAt, size: result.size, kind: 'Імпортована' }
        setImports(items => [archive, ...items.filter(item => item.id !== result.id)])
        setDialog({ ...current, archive, phase: 'success', message: 'Архів перевірено. Відновлення запускається лише після окремого підтвердження.' })
      } else if (current.archive) {
        const result = await api.backupVerify(current.archive.id, useKey && key ? key : undefined)
        setVerified(items => new Set(items).add(current.archive!.id))
        setDialog({ ...current, archive: { ...current.archive, createdAt: result.createdAt ?? current.archive.createdAt }, phase: 'success', message: 'Формат, можливість розшифрування та цілісність бази перевірено.' })
      }
    } catch (e) { const message = failureText(e); setDialog({ ...current, phase: 'error', message, details: message }) }
    finally { finish() }
  }
  const startRestore = async () => {
    if (!dialog?.archive || dialog.attempted || !begin('Відновлення бази даних')) return
    const current = dialog
    let outcome: DialogState = { ...current, phase: 'error', attempted: true, message: 'Результат операції не підтверджено.' }
    setProgress({ stage: 'verify', message: 'Перевірка архіву перед відновленням.' })
    setDialog({ ...current, phase: 'running', attempted: true })
    try {
      const result = await api.backupRestore(current.archive!.id, true, useKey && key ? key : undefined)
      if (!result.success) throw new Error(result.message)
      outcome = { ...current, phase: 'success', attempted: true, message: result.message }
      setImports(items => items.filter(item => item.id !== current.archive!.id))
      await api.backupLogout().catch(() => undefined); setUser(null); setList(null); setOfflineMode(false)
    } catch (e) { const message = failureText(e); outcome = { ...current, phase: 'error', attempted: true, message, details: message } }
    finally {
      setKey(''); setUseKey(false)
      try { onInspection(await api.inspectEnvironment()) } catch { outcome.message += ' Стан служби та API повторно перевірити не вдалося; нижче наведено останні відомі дані.' }
      finish(); setDialog(outcome)
    }
  }
  const keyControl = <details className="sm-key-option" open={useKey} onToggle={event => setUseKey(event.currentTarget.open)}><summary>Використати аварійний ключ</summary><label>Ключ для цього архіву<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} disabled={busy}/></label><small>Потрібен лише для архіву, який не можна розшифрувати ключем цього сервера.</small></details>
  const dialogBusy = busy
  const modal = dialog && <Modal title={dialog.kind === 'restore' ? 'Відновлення бази даних' : dialog.kind === 'import' ? 'Імпорт архіву' : 'Перевірка архіву'} icon={dialog.kind === 'restore' ? <RotateCcw size={21}/> : <ShieldCheck size={21}/>} busy={dialogBusy} onClose={closeDialog} footer={dialog.phase === 'running' ? <span className="sm-muted">Операція триває. Закриття тимчасово недоступне.</span> : <>
    <button className="secondary-button" type="button" onClick={closeDialog}>{dialog.phase === 'review' ? 'Скасувати' : 'Готово'}</button>
    {dialog.phase === 'review' && <button className={dialog.kind === 'restore' ? 'danger-button' : 'primary-button'} type="button" disabled={unavailable || (useKey && !key.trim())} onClick={() => void (dialog.kind === 'restore' ? startRestore() : verifyOrImport())}>{dialog.kind === 'restore' ? <RotateCcw size={16}/> : dialog.kind === 'import' ? <Upload size={16}/> : <ShieldCheck size={16}/>}{dialog.kind === 'restore' ? 'Відновити базу' : dialog.kind === 'import' ? 'Вибрати файл' : 'Перевірити'}</button>}
    {dialog.phase === 'error' && !dialog.attempted && <button className="primary-button" type="button" disabled={unavailable || (useKey && !key.trim())} onClick={() => void verifyOrImport()}>Повторити перевірку</button>}
    {dialog.phase === 'success' && dialog.kind !== 'restore' && dialog.archive && <button className="danger-button" type="button" onClick={() => setDialog({ ...dialog, kind: 'restore', phase: 'review' })}><RotateCcw size={16}/>До відновлення</button>}
  </>}>
    {dialog.phase === 'running' ? <OperationProgress message={dialog.kind === 'restore' ? progress?.message ?? activity : activity} stages={dialog.kind === 'restore' ? restoreStages : undefined} current={progress?.stage}/> : dialog.phase === 'success' || dialog.phase === 'error' ? <>
      <OperationResult success={dialog.phase === 'success'} title={dialog.phase === 'success' ? dialog.kind === 'restore' ? 'Відновлення завершено' : 'Архів перевірено' : dialog.attempted ? 'Відновлення потребує перевірки' : 'Архів не пройшов перевірку'} message={dialog.message ?? ''} details={dialog.phase === 'error' ? dialog.details : undefined}/>
      {dialog.phase === 'error' && !dialog.attempted && keyControl}
      {dialog.attempted && <dl className="sm-details sm-summary-rows"><div><dt>Windows Service</dt><dd>{inspection ? serviceDisplay(inspection.service.status).label : 'Не перевірено'}</dd></div><div><dt>API</dt><dd>{inspection ? apiDisplay(inspection.api.status).label : 'Не перевірено'}</dd></div><div><dt>Час перевірки</dt><dd>{date(inspection?.checkedAt)}</dd></div></dl>}
    </> : <>
      {dialog.archive && <><dl className="sm-details sm-summary-rows"><div><dt>Дата копії</dt><dd>{date(dialog.archive.createdAt)}</dd></div><div><dt>Тип</dt><dd>{dialog.archive.kind}</dd></div><div><dt>Перевірка</dt><dd>{verified.has(dialog.archive.id) || dialog.archive.kind === 'Імпортована' ? 'Перевірено; перед заміною перевіряється повторно' : 'Буде виконана перед заміною бази'}</dd></div></dl><p className="sm-archive-name">{dialog.archive.name}</p></>}
      {dialog.kind === 'restore' ? <Alert variant="warning">Поточні дані сервера буде замінено даними з вибраної резервної копії. Під час відновлення сервер буде тимчасово недоступний.</Alert> : <p className="sm-muted">{dialog.kind === 'import' ? 'Виберіть архів .hraid. Імпорт перевіряє файл і не замінює базу даних.' : 'Перевіряється архів і цілісність бази. Поточні дані не замінюються.'}</p>}
      {keyControl}
    </>}
  </Modal>

  return <>
    {initializing ? <div className="sm-auth-area"><OperationProgress message="Перевірка адміністративної сесії…"/></div> : !user && !offlineMode ? <div className="sm-auth-area"><section className="dashboard-panel sm-auth-card" aria-labelledby="backup-login-title"><span className="sm-auth-icon"><ShieldCheck size={30}/></span><h2 id="backup-login-title">Вхід адміністратора</h2><p>Увійдіть для керування резервними копіями сервера.</p>{error && <Alert variant="error">{error}</Alert>}<form onSubmit={event => void signIn(event)}><label>Логін<input autoComplete="username" value={login.username} onChange={event => setLogin(current => ({ ...current, username: event.target.value }))} required disabled={unavailable}/></label><div className="sm-auth-field"><label htmlFor={passwordId}>Пароль</label><span className="sm-password-control"><input id={passwordId} type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={login.password} onChange={event => setLogin(current => ({ ...current, password: event.target.value }))} required disabled={unavailable}/><IconButton label={showPassword ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShowPassword(value => !value)} disabled={unavailable}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</IconButton></span></div><button className="primary-button" type="submit" disabled={unavailable} aria-busy={busy}><LogIn size={17}/>{busy ? 'Вхід…' : 'Увійти'}</button></form><button className="secondary-button" type="button" disabled={unavailable} onClick={() => { setOfflineMode(true); setError('') }}><RotateCcw size={16}/>Аварійне відновлення без API</button></section></div> : <div className="sm-backups">
      {(offlineMode || !apiAvailable) && <Alert variant="warning">{offlineMode ? 'Локальне аварійне відновлення. Доступні імпорт, перевірка архіву та відновлення без звернення до API.' : 'API недоступний. Створення, оновлення переліку та експорт тимчасово недоступні. Імпорт і локальне відновлення залишаються доступними.'}</Alert>}
      <div className="sm-backup-toolbar"><div className="sm-backup-user"><ShieldCheck size={17}/><strong>{user ? user.displayName || user.username : 'Локальний адміністратор Windows'}</strong></div><button className="secondary-button" type="button" disabled={unavailable} onClick={() => user ? void signOut() : setOfflineMode(false)}><LogOut size={16}/>{user ? 'Вийти' : 'До входу'}</button></div>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="sm-backup-summary">
        <article><span>Остання копія</span><strong>{offlineMode ? 'Не перевірено' : archives[0] ? date(archives[0].createdAt) : list ? 'Копій ще немає' : 'Не перевірено'}</strong><small>{!offlineMode && archives[0] ? `${archives[0].kind === 'manual' ? 'Ручна' : 'Автоматична'} · доступна` : 'Архіви зберігаються на сервері'}</small></article>
        <article><span>Автоматичне копіювання</span><strong title="Окремий стан планувальника сервер не надає">{!offlineMode && list && apiAvailable ? 'Розклад задано' : 'Стан не підтверджено'}</strong><small title={list?.schedule}>Щодня о 12:00 · час сервера<br/>Зберігаються 14 автоматичних копій</small></article>
        <article><div className="sm-summary-title"><span>Збережено архівів</span><IconButton label={`Відкрити каталог: ${inspection?.configuration.backupDirectory ?? 'не визначено'}`} disabled={unavailable || !inspection?.configuration.backupDirectory} onClick={() => void api.backupOpenFolder().catch(e => setError(failureText(e)))}><FolderOpen size={17}/></IconButton></div><strong>{offlineMode || !list ? '—' : archives.length}</strong><small>{offlineMode ? 'Перелік потребує входу до API' : 'Ручні копії зберігаються без ротації'}</small></article>
      </div>
      <div className="sm-backup-scenarios"><section className="dashboard-panel sm-action-card"><Plus size={26}/><h2>Створити резервну копію</h2><p>Зберегти перевірений зашифрований архів поточних даних.</p>{(offlineMode || !apiAvailable) && <small>Потрібні доступний API та вхід адміністратора.</small>}<button className="primary-button" type="button" onClick={() => void create()} disabled={unavailable || offlineMode || !apiAvailable || inspection?.service.status !== 'running'}><Plus size={17}/>Створити копію</button></section><section className="dashboard-panel sm-action-card"><Upload size={26}/><h2>Імпортувати архів</h2><p>Перевірити файл .hraid з диска або зовнішнього носія.</p><button className="secondary-button" type="button" onClick={() => openDialog('import')} disabled={unavailable}><Upload size={17}/>Вибрати архів</button></section></div>
      {busy && !dialog && <div className="sm-backup-progress" role="status"><RefreshCw size={17}/><strong>{activity}…</strong></div>}
      <section className="dashboard-panel sm-backup-panel"><header className="sm-backup-panel-heading"><h2><HardDrive size={20}/>Архіви резервних копій</h2><IconButton label="Оновити перелік" disabled={unavailable || offlineMode || !apiAvailable} onClick={() => void refresh()}><RefreshCw size={17}/></IconButton></header><div className="sm-table-wrap"><table className="sm-backup-table"><caption className="visually-hidden">Архіви резервних копій, новіші на початку</caption><thead><tr><th>Дата</th><th>Тип</th><th>Розмір</th><th>Стан</th><th>Дії</th></tr></thead><tbody>
        {!offlineMode && archives.map(item => <tr key={item.id}><td title={item.fileName}><time dateTime={item.createdAt}>{date(item.createdAt)}</time></td><td><StatusBadge tone="info">{item.kind === 'manual' ? 'Ручна' : 'Автоматична'}</StatusBadge></td><td>{size(item.size)}</td><td><StatusBadge tone={verified.has(item.id) ? 'success' : 'info'}>{verified.has(item.id) ? 'Перевірена' : 'Доступна'}</StatusBadge></td><td><div className="sm-backup-row-actions"><IconButton label="Перевірити архів" disabled={unavailable} onClick={() => openDialog('verify', asArchive(item))}><ShieldCheck size={16}/></IconButton><IconButton label="Відновити базу" disabled={unavailable} onClick={() => openDialog('restore', asArchive(item))}><RotateCcw size={16}/></IconButton><IconButton label="Експортувати архів" disabled={unavailable || !apiAvailable} onClick={() => void exportArchive(item)}><Download size={16}/></IconButton></div></td></tr>)}
        {imports.map(item => <tr key={item.id}><td title={item.name}>{date(item.createdAt)}</td><td><StatusBadge tone="info">Імпортована</StatusBadge></td><td>{size(item.size)}</td><td><StatusBadge tone="success">Перевірено при імпорті</StatusBadge></td><td><div className="sm-backup-row-actions"><IconButton label="Перевірити імпортований архів" disabled={unavailable} onClick={() => openDialog('verify', item)}><ShieldCheck size={16}/></IconButton><IconButton label="Відновити базу з імпортованого архіву" disabled={unavailable} onClick={() => openDialog('restore', item)}><RotateCcw size={16}/></IconButton></div></td></tr>)}
        {(offlineMode ? imports.length === 0 : archives.length === 0 && imports.length === 0) && <tr><td colSpan={5} className="sm-empty">{busy ? 'Завантаження…' : 'Архівів немає. Створіть копію або імпортуйте файл .hraid.'}</td></tr>}
      </tbody></table></div></section>
    </div>}
    {modal}
    {toast && <Toast message={toast} onDismiss={() => setToast('')}/>}
  </>
}
