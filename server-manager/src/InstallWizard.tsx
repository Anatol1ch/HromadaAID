import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Folder, LockKeyhole, ShieldAlert } from 'lucide-react'
import Alert from '../../src/components/Alert'
import type { InspectionSnapshot } from '../electron/inspection-types'
import type { InstallDirectoryKind, ServerInstallRequest, ServerInstallUpdate } from '../electron/installation-contract'

type Props = { onClose: () => void; onInstalled: () => void; initial?: Partial<Pick<InspectionSnapshot['configuration'], 'programDirectory' | 'dataDirectory' | 'backupDirectory' | 'host' | 'port'>> }
type RecoveryPrompt = { operationId: string; key: string }
const steps = ['Каталоги', 'Параметри', 'Адміністратор', 'Підсумок']
const stageLabels: Record<ServerInstallUpdate['stage'], string> = {
  validation: 'Перевірка параметрів', preflight: 'Перевірка дисків і наявних даних', directories: 'Підготовка серверного пакета',
  configuration: 'Налаштування серверного середовища', 'recovery-key': 'Аварійний ключ', database: 'Ініціалізація серверних даних',
  administrator: 'Створення адміністратора', service: 'Windows Service', health: 'Перевірка API', complete: 'Завершено',
}
const defaults = {
  programDirectory: 'C:\\Program Files\\HromadaAID',
  dataDirectory: 'C:\\ProgramData\\HromadaAID\\Data',
  backupDirectory: 'C:\\ProgramData\\HromadaAID\\Backups',
}

function rootPath(path: string): boolean { return /^[A-Za-z]:\\?$/.test(path.trim()) }
function childForRoot(path: string, kind: InstallDirectoryKind): string {
  const folder = kind === 'program' ? 'HromadaAID' : kind === 'data' ? 'HromadaAID-Data' : 'HromadaAID-Backups'
  return `${path.replace(/[\\]+$/, '')}\\${folder}`
}
function cleanMessage(value: string): string { return value.replace(/(?:password|token|secret|recovery.?key|private.?key|dpapi.?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1[приховано]') }

export default function InstallWizard({ onClose, onInstalled, initial }: Props) {
  const [step, setStep] = useState(0)
  const [paths, setPaths] = useState({
    programDirectory: initial?.programDirectory ?? defaults.programDirectory,
    dataDirectory: initial?.dataDirectory ?? defaults.dataDirectory,
    backupDirectory: initial?.backupDirectory ?? defaults.backupDirectory,
  })
  const directoriesEdited = useRef(false)
  const [rootNotice, setRootNotice] = useState('')
  const [port, setPort] = useState(String(initial?.port ?? 4310))
  const [host, setHost] = useState<'127.0.0.1' | '::1'>(initial?.host === '::1' ? '::1' : '127.0.0.1')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [update, setUpdate] = useState<ServerInstallUpdate | null>(null)
  const [recovery, setRecovery] = useState<RecoveryPrompt | null>(null)
  const [savedPath, setSavedPath] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const parsedPort = Number(port)
  const request = useMemo<ServerInstallRequest>(() => ({ ...paths, host, port: parsedPort, administrator: { displayName, username, password, confirmation } }), [paths, host, parsedPort, displayName, username, password, confirmation])

  useEffect(() => {
    const stopUpdates = window.hromadaManager.onInstallationUpdate(setUpdate)
    const stopRecovery = window.hromadaManager.onRecoveryKeyRequired(value => { setRecovery(value); setSavedPath(''); setSaveMessage('') })
    if (!initial) void window.hromadaManager.getInstallDefaults().then(value => {
      if (!directoriesEdited.current) setPaths(value)
    }).catch(() => undefined)
    return () => { stopUpdates(); stopRecovery() }
  }, [initial])

  const choose = async (kind: InstallDirectoryKind, field: keyof typeof paths) => {
    setError(''); setRootNotice('')
    try {
      const selected = await window.hromadaManager.selectInstallDirectory(kind)
      if (!selected) return
      directoriesEdited.current = true
      if (rootPath(selected)) {
        const adjusted = childForRoot(selected, kind)
        setPaths(current => ({ ...current, [field]: adjusted }))
        setRootNotice(`Вибрано корінь диска. Для захисту дані буде розміщено в підкаталозі ${adjusted}.`)
      } else setPaths(current => ({ ...current, [field]: selected }))
    } catch { setError('Не вдалося відкрити вибір каталогу. Перевірте права доступу та повторіть спробу.') }
  }

  function validateCurrentStep(): boolean {
    setError('')
    if (step === 0 && Object.values(paths).some(value => !value.trim())) { setError('Вкажіть усі три каталоги.'); return false }
    if (step === 0 && Object.values(paths).some(rootPath)) { setError('Каталог не може бути коренем диска. Виберіть або введіть окремий підкаталог.') ; return false }
    if (step === 1 && (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535)) { setError('Порт має бути цілим числом від 1024 до 65535.'); return false }
    if (step === 2) {
      if (!displayName.trim() || displayName.trim().length > 150) { setError('Вкажіть ім’я користувача (до 150 символів).'); return false }
      if (username.trim().length < 3 || username.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(username)) { setError('Логін має містити від 3 до 80 символів.'); return false }
      if (Array.from(password).length < 8 || Array.from(password).length > 256) { setError('Пароль має містити від 8 до 256 символів.'); return false }
      if (password !== confirmation) { setError('Паролі не збігаються.'); return false }
    }
    return true
  }

  const start = async () => {
    if (!validateCurrentStep()) return
    setBusy(true); setError(''); setUpdate({ operationId: 'pending', stage: 'validation', status: 'running', message: 'Підготовка до встановлення.' })
    try {
      const result = await window.hromadaManager.installServer(request)
      if (!result.success) { setError(cleanMessage(result.message ?? 'Встановлення не завершено. Перевірте повідомлення й безпечно повторіть після усунення причини.')); setBusy(false); return }
      setBusy(false)
    } catch (failure) {
      setError(cleanMessage(failure instanceof Error ? failure.message : 'Встановлення не завершено.'))
      setBusy(false)
    } finally {
      setPassword(''); setConfirmation('')
    }
  }

  const saveKey = async () => {
    setSaveMessage('')
    const result = await window.hromadaManager.saveRecoveryKey()
    if (result.saved) { setSavedPath(result.path ?? ''); setSaveMessage('Ключ збережено у вибраному файлі. Зберігайте його окремо від комп’ютера та резервних копій.') }
    else if (result.message) setSaveMessage(result.message)
  }
  const confirmKey = async () => {
    const confirmed = await window.hromadaManager.confirmRecoveryKeySaved()
    if (confirmed) setRecovery(null)
  }
  const cancelKey = async () => { await window.hromadaManager.cancelRecoveryKey(); setRecovery(null) }

  if (recovery) return <section className="sm-install-wizard" aria-labelledby="recovery-key-title">
    <header><span className="sm-install-step-count">Крок 5 · захист даних</span><h2 id="recovery-key-title">Збережіть аварійний ключ</h2><p>Цей ключ потрібний для відновлення резервних копій, якщо локальний DPAPI-файл буде втрачено. Ми покажемо його лише зараз.</p></header>
    <Alert variant="warning">Не надсилайте ключ електронною поштою та не зберігайте поруч із сервером або архівами. Збережіть його в доступному лише уповноваженим особам безпечному місці.</Alert>
    <pre className="sm-recovery-key" aria-label="Аварійний ключ відновлення">{recovery.key}</pre>
    <div className="sm-form-actions"><button type="button" className="secondary-button" onClick={() => void saveKey()}><LockKeyhole size={17}/>Зберегти у файл</button>{savedPath && <span className="sm-muted">Файл: {savedPath}</span>}</div>
    {saveMessage && <p className="sm-local-notice" role="status">{saveMessage}</p>}
    <div className="sm-form-actions"><button type="button" className="primary-button" disabled={!savedPath} onClick={() => void confirmKey()}><Check size={17}/>Я зберіг ключ</button><button type="button" className="secondary-button" onClick={() => void cancelKey()}>Скасувати встановлення</button></div>
  </section>

  return <section className="sm-install-wizard" aria-labelledby="install-title">
    <header className="sm-install-header"><div><span className="sm-install-step-count">Налаштування сервера · крок {step + 1} з {steps.length}</span><h2 id="install-title">Встановлення сервера HromadaAID</h2><p>Виконується локальна конфігурація HTTP на loopback. Мережевий режим HTTPS поки недоступний у майстрі.</p></div><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Закрити майстер</button></header>
    <ol className="sm-install-steps" aria-label="Кроки встановлення">{steps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''}><span>{index < step ? <Check size={14}/> : index + 1}</span>{label}</li>)}</ol>

    {!busy && !update?.status.includes('succeeded') && <>
      {step === 0 && <div className="sm-install-fields">
        <p className="sm-form-intro">Каталоги можна розмістити на різних локальних дисках NTFS. Вони не створюються, доки ви не натиснете «Встановити сервер».</p>
        {([['programDirectory', 'Каталог програми', 'Виконувані файли сервера та WinSW.'], ['dataDirectory', 'Каталог серверних даних', 'server.json, SQLite, журнали й захищені службові файли.'], ['backupDirectory', 'Каталог резервних копій', 'Архіви .hraid зберігатимуться окремо.']] as const).map(([field, label, hint]) => <label className="sm-install-path" key={field}><span>{label}<small>{hint}</small></span><input value={paths[field]} onChange={event => { directoriesEdited.current = true; setPaths(current => ({ ...current, [field]: event.target.value })) }}/><button className="secondary-button" type="button" onClick={() => void choose(field === 'programDirectory' ? 'program' : field === 'dataDirectory' ? 'data' : 'backups', field)}><Folder size={16}/>Огляд</button></label>)}
        {rootNotice && <Alert variant="info">{rootNotice}</Alert>}
      </div>}
      {step === 1 && <div className="sm-install-fields"><p className="sm-form-intro">Початкове налаштування доступне лише на цьому комп’ютері. Пізніше мережевий доступ потребуватиме HTTPS-сертифіката.</p><label className="sm-install-control">Адреса сервера<select value={host} onChange={event => setHost(event.target.value as typeof host)}><option value="127.0.0.1">127.0.0.1 · IPv4 loopback</option><option value="::1">::1 · IPv6 loopback</option></select></label><label className="sm-install-control">Порт<input type="number" min={1024} max={65535} value={port} onChange={event => setPort(event.target.value)}/></label><div className="sm-transport-note"><ShieldAlert size={18}/>HTTP дозволений лише для loopback. Відкриття доступу до локальної мережі тут не налаштовується.</div></div>}
      {step === 2 && <div className="sm-install-fields"><p className="sm-form-intro">Цей обліковий запис буде першим адміністратором системи. Пароль передається серверній CLI через stdin і не додається до журналів або аргументів запуску.</p><label className="sm-install-control">Ім’я користувача<input autoComplete="name" value={displayName} maxLength={150} onChange={event => setDisplayName(event.target.value)}/></label><label className="sm-install-control">Логін<input autoComplete="username" value={username} maxLength={80} onChange={event => setUsername(event.target.value)}/></label><label className="sm-install-control">Пароль<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/><small>Від 8 до 256 символів.</small></label><label className="sm-install-control">Підтвердження пароля<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label></div>}
      {step === 3 && <div className="sm-install-review"><p className="sm-form-intro">Перевірте параметри. Пароль не показується в підсумку.</p><dl className="sm-details sm-summary-rows"><div><dt>Каталог програми</dt><dd>{paths.programDirectory}</dd></div><div><dt>Серверні дані</dt><dd>{paths.dataDirectory}</dd></div><div><dt>Резервні копії</dt><dd>{paths.backupDirectory}</dd></div><div><dt>Адреса</dt><dd>{host}:{port} · HTTP loopback</dd></div><div><dt>Перший адміністратор</dt><dd>{displayName.trim()} ({username.trim()})</dd></div></dl><Alert variant="warning">Встановлення створить SQLite лише за відсутності бази та ключа. Наявні або неповні серверні дані зупинять чисте встановлення без очищення.</Alert></div>}
      {error && <Alert variant="error">{error}</Alert>}
      <footer className="sm-install-footer"><button className="secondary-button" type="button" onClick={onClose}>Скасувати</button><span/>{step > 0 && <button className="secondary-button" type="button" onClick={() => { setError(''); setStep(value => value - 1) }}><ArrowLeft size={16}/>Назад</button>}{step < 3 ? <button className="primary-button" type="button" onClick={() => { if (validateCurrentStep()) setStep(value => value + 1) }}>Далі<ArrowRight size={16}/></button> : <button className="primary-button" type="button" onClick={() => void start()}><ShieldAlert size={16}/>Встановити сервер</button>}</footer>
    </>}

    {busy && <div className="sm-install-progress" role="status" aria-live="polite"><div className="sm-install-progress-icon"><Folder size={24}/></div><h3>{stageLabels[update?.stage ?? 'validation']}</h3><p>{update?.message ?? 'Виконується встановлення серверного середовища.'}</p><div className="sm-progress-track"><span/></div><small>Не закривайте Server Manager до завершення перевірки.</small></div>}
    {!busy && update?.status === 'succeeded' && update.result && <div className="sm-install-success"><span><Check size={26}/></span><h3>Сервер встановлено</h3><p>{update.message}</p><dl className="sm-details sm-summary-rows"><div><dt>Windows Service</dt><dd>HromadaAIDApi · працює</dd></div><div><dt>API</dt><dd>{update.result.apiAddress} · доступний</dd></div><div><dt>Версія сервера</dt><dd>{update.result.serverVersion}</dd></div></dl><button className="primary-button" type="button" onClick={onInstalled}>Перейти до огляду</button></div>}
  </section>
}
