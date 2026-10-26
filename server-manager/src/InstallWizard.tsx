import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, Eye, EyeOff, Folder, LockKeyhole, ShieldAlert } from 'lucide-react'
import Alert from '../../src/components/Alert'
import { Modal, OperationProgress, OperationResult } from './ManagerUI'
import type { InspectionSnapshot } from '../electron/inspection-types'
import type { InstallDirectoryKind, ServerInstallRequest, ServerInstallUpdate } from '../electron/installation-contract'
import { installationVerificationIssues } from '../electron/installation-contract'

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
  const pathId = useId()
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
  const installationCompleted = useRef(false)
  const installInFlight = useRef(false)
  const keyActionInFlight = useRef(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const verificationInFlight = useRef(false)
  const [update, setUpdate] = useState<ServerInstallUpdate | null>(null)
  const [recovery, setRecovery] = useState<RecoveryPrompt | null>(null)
  const [savedPath, setSavedPath] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const parsedPort = Number(port)
  const request = useMemo<ServerInstallRequest>(() => ({ ...paths, host, port: parsedPort, administrator: { displayName, username, password, confirmation } }), [paths, host, parsedPort, displayName, username, password, confirmation])

  useEffect(() => {
    const stopUpdates = window.hromadaManager.onInstallationUpdate(value => {
      if (value.status === 'succeeded' || value.status === 'verification-required') installationCompleted.current = true
      setUpdate(value)
    })
    const stopRecovery = window.hromadaManager.onRecoveryKeyRequired(value => { setRecovery(value); setShowKey(false); setSavedPath(''); setSaveMessage('') })
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
    if (installationCompleted.current || installInFlight.current) return
    if (!validateCurrentStep()) return
    installInFlight.current = true
    setBusy(true); setError(''); setUpdate({ operationId: 'pending', stage: 'validation', status: 'running', message: 'Підготовка до встановлення.' })
    try {
      const result = await window.hromadaManager.installServer(request)
      if (!result.success) { setError(cleanMessage(result.message ?? 'Встановлення не завершено. Перевірте повідомлення й безпечно повторіть після усунення причини.')); setBusy(false); return }
      setBusy(false)
    } catch (failure) {
      setError(cleanMessage(failure instanceof Error ? failure.message : 'Встановлення не завершено.'))
      setBusy(false)
    } finally {
      installInFlight.current = false
      setPassword(''); setConfirmation('')
    }
  }

  const recheck = async () => {
    if (!installationCompleted.current || verificationInFlight.current || !update) return
    verificationInFlight.current = true
    setBusy(true)
    setUpdate({ ...update, stage: 'health', message: 'Повторно перевіряємо стан служби, конфігурацію, пакет і доступність API.' })
    try {
      const snapshot = await window.hromadaManager.inspectEnvironment()
      const issues = installationVerificationIssues(snapshot)
      setUpdate(issues.length === 0 && snapshot.configuration.serverVersion && snapshot.configuration.apiAddress
        ? { operationId: update.operationId, stage: 'complete', status: 'succeeded', message: 'Встановлення та готовність сервера підтверджено.', result: { service: 'running', api: 'available', serverVersion: snapshot.configuration.serverVersion, apiAddress: snapshot.configuration.apiAddress } }
        : { operationId: update.operationId, stage: 'health', status: 'verification-required', message: `Встановлення виконано. ${issues.join(' ')} Повторна ініціалізація не потрібна; повторіть перевірку після усунення причини.` })
    } catch {
      setUpdate({ operationId: update.operationId, stage: 'health', status: 'verification-required', message: 'Встановлення виконано. Додаткова діагностика недоступна. Повторіть перевірку; дані повторно не ініціалізуються.' })
    } finally { verificationInFlight.current = false; setBusy(false) }
  }

  const saveKey = async () => {
    if (keyActionInFlight.current) return
    keyActionInFlight.current = true; setKeyBusy(true); setSaveMessage('')
    try {
      const result = await window.hromadaManager.saveRecoveryKey()
      if (result.saved) { setSavedPath(result.path ?? ''); setSaveMessage('Ключ збережено у вибраному файлі.') }
      else if (result.message) setSaveMessage(result.message)
    } catch { setSaveMessage('Не вдалося зберегти ключ. Виберіть інше безпечне місце.') }
    finally { keyActionInFlight.current = false; setKeyBusy(false) }
  }
  const confirmKey = async () => {
    if (keyActionInFlight.current || !savedPath) return
    keyActionInFlight.current = true; setKeyBusy(true)
    try { if (await window.hromadaManager.confirmRecoveryKeySaved()) { setRecovery(null); setShowKey(false) } }
    catch { setSaveMessage('Підтвердження не отримано. Повторіть дію; ключ залишається на цьому екрані.') }
    finally { keyActionInFlight.current = false; setKeyBusy(false) }
  }
  const copyKey = () => {
    if (!recovery) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const input = document.createElement('textarea')
    input.value = recovery.key; input.readOnly = true; input.className = 'sm-clipboard-input'
    document.body.append(input); input.select()
    try { setSaveMessage(document.execCommand('copy') ? 'Ключ скопійовано. Для продовження також збережіть його у файл.' : 'Не вдалося скопіювати ключ. Скористайтеся збереженням у файл.') }
    catch { setSaveMessage('Копіювання недоступне. Збережіть ключ у файл.') }
    finally { input.remove(); previous?.focus() }
  }

  const wizardFooter = busy ? undefined : update?.status === 'succeeded' ? <button className="primary-button" type="button" onClick={onInstalled}>Готово</button> : update?.status === 'verification-required' ? <><button type="button" className="secondary-button" onClick={onInstalled}>Перейти до огляду</button><button type="button" className="primary-button" onClick={() => void recheck()}>Повторити перевірку</button></> : <><button className="secondary-button" type="button" onClick={onClose}>Скасувати</button>{step > 0 && <button className="secondary-button" type="button" onClick={() => { setError(''); setStep(value => value - 1) }}><ArrowLeft size={16}/>Назад</button>}{step < 3 ? <button className="primary-button" type="button" onClick={() => { if (validateCurrentStep()) setStep(value => value + 1) }}>Далі<ArrowRight size={16}/></button> : <button className="primary-button" type="button" onClick={() => void start()}><ShieldAlert size={16}/>Встановити сервер</button>}</>

  if (recovery) return <Modal title="Збережіть аварійний ключ" icon={<LockKeyhole size={22}/>} busy onClose={onClose} footer={<button type="button" className="primary-button" disabled={!savedPath || keyBusy} onClick={() => void confirmKey()}><Check size={17}/>Я зберіг ключ</button>}>
    <div className="sm-recovery-content"><p>Ключ дозволяє відновити резервні копії, якщо ключ сервера буде втрачено. Збережіть його зараз.</p><Alert variant="warning">Зберігайте ключ окремо від сервера та резервних копій у безпечному місці.</Alert>
    <div className="sm-key-display"><pre className="sm-recovery-key" aria-label="Аварійний ключ відновлення">{showKey ? recovery.key : '•••• •••• •••• •••• •••• ••••'}</pre><button type="button" className="secondary-button" onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={16}/> : <Eye size={16}/>}{showKey ? 'Приховати ключ' : 'Показати ключ'}</button></div>
    <div className="sm-form-actions"><button type="button" className="secondary-button" onClick={copyKey} disabled={keyBusy}><Copy size={17}/>Копіювати</button><button type="button" className="secondary-button" autoFocus onClick={() => void saveKey()} disabled={keyBusy}><LockKeyhole size={17}/>{keyBusy ? 'Збереження…' : 'Зберегти у файл'}</button></div>
    {savedPath && <p className="sm-saved-path">Файл: {savedPath}</p>}{saveMessage && <p className="sm-muted" role="status">{saveMessage}</p>}
    {!savedPath && <p className="sm-muted">Для продовження потрібно зберегти ключ у файл. Вікно залишатиметься відкритим до підтвердження.</p>}</div>
  </Modal>

  return <Modal title="Налаштування сервера" icon={<ShieldAlert size={22}/>} wide busy={busy} onClose={onClose} footer={wizardFooter}><section className="sm-install-wizard" aria-labelledby="install-title">
    <header className="sm-install-header"><div><span className="sm-install-step-count">Налаштування сервера · крок {step + 1} з {steps.length}</span><h2 id="install-title">{steps[step]}</h2><p>Початкове підключення працюватиме на цьому комп’ютері.</p></div></header>
    <ol className="sm-install-steps" aria-label="Кроки встановлення">{steps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''}><span>{index < step ? <Check size={14}/> : index + 1}</span>{label}</li>)}</ol>

    {!busy && update?.status !== 'succeeded' && update?.status !== 'verification-required' && <>
      {step === 0 && <div className="sm-install-fields">
        <p className="sm-form-intro">Каталоги можна розмістити на різних локальних дисках NTFS. Вони не створюються, доки ви не натиснете «Встановити сервер».</p>
        {([['programDirectory', 'Каталог програми', 'Виконувані файли сервера та WinSW.'], ['dataDirectory', 'Каталог серверних даних', 'server.json, SQLite, журнали й захищені службові файли.'], ['backupDirectory', 'Каталог резервних копій', 'Архіви .hraid зберігатимуться окремо.']] as const).map(([field, label, hint]) => <div className="sm-install-path" key={field}><label htmlFor={`${pathId}-${field}`}><span>{label}<small>{hint}</small></span></label><input id={`${pathId}-${field}`} title={paths[field]} value={paths[field]} onChange={event => { directoriesEdited.current = true; setPaths(current => ({ ...current, [field]: event.target.value })) }}/><button className="secondary-button" type="button" onClick={() => void choose(field === 'programDirectory' ? 'program' : field === 'dataDirectory' ? 'data' : 'backups', field)} aria-label={`Вибрати: ${label}`}><Folder size={16}/>Огляд</button></div>)}
        {rootNotice && <Alert variant="info">{rootNotice}</Alert>}
      </div>}
      {step === 1 && <div className="sm-install-fields"><p className="sm-form-intro">Початкове налаштування доступне лише на цьому комп’ютері. Пізніше мережевий доступ потребуватиме HTTPS-сертифіката.</p><label className="sm-install-control">Адреса сервера<select value={host} onChange={event => setHost(event.target.value as typeof host)}><option value="127.0.0.1">127.0.0.1 · IPv4 loopback</option><option value="::1">::1 · IPv6 loopback</option></select></label><label className="sm-install-control">Порт<input type="number" min={1024} max={65535} value={port} onChange={event => setPort(event.target.value)}/></label><div className="sm-transport-note"><ShieldAlert size={18}/>HTTP дозволений лише для loopback. Відкриття доступу до локальної мережі тут не налаштовується.</div></div>}
      {step === 2 && <div className="sm-install-fields"><p className="sm-form-intro">Створіть перший обліковий запис адміністратора системи.</p><label className="sm-install-control">Ім’я користувача<input autoComplete="name" value={displayName} maxLength={150} onChange={event => setDisplayName(event.target.value)}/></label><label className="sm-install-control">Логін<input autoComplete="username" value={username} maxLength={80} onChange={event => setUsername(event.target.value)}/></label><label className="sm-install-control">Пароль<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/><small>Від 8 до 256 символів.</small></label><label className="sm-install-control">Підтвердження пароля<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label></div>}
      {step === 3 && <div className="sm-install-review"><p className="sm-form-intro">Перевірте параметри. Пароль не показується в підсумку.</p><dl className="sm-details sm-summary-rows"><div><dt>Каталог програми</dt><dd>{paths.programDirectory}</dd></div><div><dt>Серверні дані</dt><dd>{paths.dataDirectory}</dd></div><div><dt>Резервні копії</dt><dd>{paths.backupDirectory}</dd></div><div><dt>Адреса</dt><dd>{host}:{port} · HTTP loopback</dd></div><div><dt>Перший адміністратор</dt><dd>{displayName.trim()} ({username.trim()})</dd></div></dl><Alert variant="warning">Встановлення створить SQLite лише за відсутності бази та ключа. Наявні або неповні серверні дані зупинять чисте встановлення без очищення.</Alert></div>}
      {error && <Alert variant="error">{error}</Alert>}

    </>}

    {busy && <OperationProgress message={update?.message ?? stageLabels[update?.stage ?? 'validation']}/>}
    {!busy && update?.status === 'verification-required' && <div className="sm-install-review" role="status"><h3>Встановлення виконано. Потрібна перевірка</h3><Alert variant="warning">{update.message}</Alert></div>}
    {!busy && update?.status === 'succeeded' && update.result && <div className="sm-install-success"><OperationResult success title="Сервер встановлено" message={update.message}/><dl className="sm-details sm-summary-rows"><div><dt>Windows Service</dt><dd>HromadaAIDApi · працює</dd></div><div><dt>API</dt><dd>{update.result.apiAddress} · доступний</dd></div><div><dt>Версія сервера</dt><dd>{update.result.serverVersion}</dd></div></dl></div>}
  </section></Modal>
}
