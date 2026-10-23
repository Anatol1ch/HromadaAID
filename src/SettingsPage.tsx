import { CircleCheck, CircleUserRound, Code2, HardDriveDownload, Info, KeyRound, MapPin, Server, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AuthenticatedUser } from '../shared/auth-contract'
import type { ServerConnectionCheckResult, ServerConnectionSaveResult, ServerConnectionState } from '../shared/api-contract'
import { USER_ROLE_LABELS } from '../shared/authorization'
import hromadaAidLogo from '../assets/hromadaaid.svg'
import ChangePasswordForm from './components/ChangePasswordForm'
import Modal from './components/Modal'
import ServerConnectionDialog from './components/ServerConnectionDialog'
import BackupSettings from './BackupSettings'

type ConnectionActions = { getState: () => Promise<ServerConnectionState>; check: (apiUrl: string) => Promise<ServerConnectionCheckResult>; save: (apiUrl: string) => Promise<ServerConnectionSaveResult> }

export default function SettingsPage({ user, onChangePassword, connectionActions }: { user: AuthenticatedUser | null; onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>; connectionActions: ConnectionActions }) {
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [activeSection, setActiveSection] = useState<'account' | 'connection' | 'about' | 'backup'>('account')
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connection, setConnection] = useState<ServerConnectionState | null>(null)
  const [connectionMessage, setConnectionMessage] = useState('')
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const structuredName = [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean).join(' ')
  const displayName = structuredName || user?.displayName?.trim() || user?.username || 'Локальний режим'
  const roles = user?.roles.map(role => USER_ROLE_LABELS[role]).join(', ') || 'Автономна робота'

  useEffect(() => {
    let active = true
    void window.hromadaAid.appInfo.getVersion().then(version => { if (active) setAppVersion(version) }).catch(() => { if (active) setAppVersion(null) })
    void connectionActions.getState().then(value => { if (active) setConnection(value) }).catch(() => { if (active) setConnectionMessage('Не вдалося прочитати стан підключення.') })
    const unsubscribe = window.hromadaAid.connection.onStateChange(value => { if (active) setConnection(value) })
    return () => { active = false; unsubscribe() }
  }, [])

  const checkCurrentConnection = async () => {
    if (connectionBusy || !connection?.apiUrl) return
    setConnectionBusy(true); setConnectionMessage('Перевірка підключення…')
    try {
      const result = await connectionActions.check(connection.apiUrl)
      setConnectionMessage(result.message)
      const latest = await connectionActions.getState()
      setConnection(latest)
    } catch { setConnectionMessage('Не вдалося підключитися до сервера.') }
    finally { setConnectionBusy(false) }
  }

  return <div className="settings-page">
    <header className="page-heading settings-heading"><div><div className="eyebrow">СИСТЕМА</div><h1>Налаштування</h1><p className="subtitle">Керування обліковим записом і параметрами застосунку.</p></div></header>
    <nav className="settings-section-nav" aria-label="Розділи налаштувань">
      <button type="button" className={`settings-section-current${activeSection === 'account' ? ' is-selected' : ''}`} aria-current={activeSection === 'account' ? 'page' : undefined} onClick={() => setActiveSection('account')}><CircleUserRound size={17} aria-hidden="true"/>Мій обліковий запис</button>
      <button type="button" className={`settings-section-current${activeSection === 'connection' ? ' is-selected' : ''}`} aria-current={activeSection === 'connection' ? 'page' : undefined} onClick={() => setActiveSection('connection')}><Server size={16} aria-hidden="true"/><span>Підключення до сервера</span></button>
      <button type="button" className={`settings-section-current${activeSection === 'about' ? ' is-selected' : ''}`} aria-current={activeSection === 'about' ? 'page' : undefined} onClick={() => setActiveSection('about')}><Info size={16} aria-hidden="true"/><span>Про застосунок</span></button>
      <button type="button" className={`settings-section-current${activeSection === 'backup' ? ' is-selected' : ''}`} aria-current={activeSection === 'backup' ? 'page' : undefined} onClick={() => setActiveSection('backup')}><HardDriveDownload size={16} aria-hidden="true"/><span>Резервне копіювання</span></button>
    </nav>
    {activeSection === 'backup' && <BackupSettings user={user}/>}
    {activeSection === 'account' && <>
    <section className="dashboard-panel settings-account" aria-labelledby="settings-account-title">
      <div className="settings-card-heading"><span className="settings-icon"><CircleUserRound size={20} aria-hidden="true"/></span><div><h2 id="settings-account-title">Мій обліковий запис</h2><p>Ваші дані профілю та призначені ролі.</p></div></div>
      <dl className="settings-profile-grid">
        <div><dt>Ім'я та прізвище</dt><dd>{displayName}</dd></div>
        <div><dt>Логін</dt><dd>{user?.username || 'Не застосовується'}</dd></div>
        <div className="settings-profile-roles"><dt>Ролі</dt><dd>{user ? user.roles.map(role => <span className="settings-role-chip" key={role}>{USER_ROLE_LABELS[role]}</span>) : roles}</dd></div>
      </dl>
      {user && <p className="settings-profile-note">Ім'я, прізвище, логін і ролі змінює адміністратор у розділі «Користувачі».</p>}
    </section>
    <section className="dashboard-panel settings-security settings-security-summary" aria-labelledby="settings-security-title">
      <div className="settings-card-heading"><span className="settings-icon"><KeyRound size={19} aria-hidden="true"/></span><div><h2 id="settings-security-title">Безпека</h2><p>{user ? 'Керуйте паролем для входу до системи.' : 'У локальному режимі окремий обліковий запис не використовується.'}</p></div></div>
      {user && <button type="button" className="secondary-button" onClick={() => setPasswordModalOpen(true)}>Змінити пароль</button>}
    </section>
    {user && passwordModalOpen && <Modal title="Зміна пароля" description="Після успішної зміни потрібно увійти повторно." headerIcon={<KeyRound size={21} aria-hidden="true"/>} onClose={() => setPasswordModalOpen(false)} busy={passwordBusy} size="compact" className="change-password-modal">
      <ChangePasswordForm onChangePassword={onChangePassword} onBusyChange={setPasswordBusy} onCancel={() => setPasswordModalOpen(false)}/>
    </Modal>}
    </>}
    {activeSection === 'connection' && <section className="dashboard-panel server-connection-panel" aria-labelledby="server-connection-title">
      <div className="settings-card-heading"><span className="settings-icon"><Server size={19} aria-hidden="true"/></span><div><h2 id="server-connection-title">Підключення до сервера</h2><p>Адреса застосовується лише на цьому комп’ютері.</p></div></div>
      <div className="server-connection-overview"><div><span>Поточна адреса</span><strong>{connection?.apiUrl ?? 'Не налаштовано'}</strong><small>{connection?.active ? 'Використовується в цьому запуску.' : connection?.apiUrl ? 'Збережена адреса; наразі активний local mode.' : 'Стан підключення визначається перевіркою сервера.'}</small></div><div className={`server-connection-status status-${connection?.status ?? 'unknown'}`} role="status">{connection?.status === 'available' ? <><CircleCheck size={16}/>Сервер доступний</> : connection?.status === 'checking' || connectionBusy ? <><Wifi size={16}/>Перевірка підключення…</> : connection?.status === 'maintenance' ? 'Триває технічне обслуговування' : connection?.status === 'unavailable' ? 'Не вдалося підключитися до сервера' : 'Підключення не перевірено'}</div></div>
      {(connectionMessage || connection?.message) && <p className={`server-connection-panel-message${connection?.status === 'unavailable' ? ' is-error' : ''}`} role="status">{connectionMessage || connection?.message}</p>}
      {connection?.lockedReason && <p className="server-connection-panel-message">{connection.lockedReason}</p>}
      <div className="server-connection-panel-actions"><button type="button" className="secondary-button" disabled={connectionBusy || !connection?.apiUrl} onClick={() => void checkCurrentConnection()}><Wifi size={17} aria-hidden="true"/>Перевірити з'єднання</button><button type="button" className="primary-button" disabled={!connection?.editable} onClick={() => setConnectionModalOpen(true)}>Змінити адресу</button></div>
    </section>}
    {activeSection === 'about' && <div className="settings-about-page">
      <section className="dashboard-panel settings-about-identity" aria-label="Про HromadaAID">
        <img src={hromadaAidLogo} alt="" width="64" height="64" />
        <div className="settings-about-brand">HromadaAID</div>
        <p>Автоматизована система обліку матеріальних допомог</p>
        <span className="settings-about-version">Версія {appVersion ?? '—'}</span>
      </section>
      <section className="dashboard-panel settings-about-details" aria-label="Інформація про застосунок">
        <div className="settings-card-heading"><span className="settings-icon"><Info size={19} aria-hidden="true"/></span><div><h2>Відомості про програму</h2><p>Основна інформація про HromadaAID.</p></div></div>
        <dl className="settings-about-grid">
          <div><dt>Версія застосунку</dt><dd>{appVersion ?? 'Не вдалося визначити'}</dd></div>
          <div><dt>Тип застосунку</dt><dd>Настільний застосунок для Windows</dd></div>
          <div className="settings-about-purpose"><dt>Призначення</dt><dd>Облік, призначення та супровід виплат матеріальних допомог</dd></div>
        </dl>
      </section>
      <section className="dashboard-panel settings-about-details" aria-label="Технічна інформація">
        <div className="settings-card-heading"><span className="settings-icon"><Server size={19} aria-hidden="true"/></span><div><h2>Технічна інформація</h2><p>Поточний режим роботи та стан підключення.</p></div></div>
        <dl className="settings-about-grid">
          <div><dt>Режим роботи</dt><dd>{connection?.mode === 'remote' ? 'Клієнт-серверний' : connection?.mode === 'local' ? 'Локальний' : 'Визначається…'}</dd></div>
          <div><dt>Стан підключення</dt><dd>{!connection ? 'Визначається…' : connection.mode === 'local' ? 'Серверне підключення не використовується' : connection.status === 'available' ? 'Сервер доступний' : connection.status === 'checking' ? 'Перевірка підключення…' : connection.status === 'maintenance' ? 'Триває технічне обслуговування' : connection.status === 'unavailable' ? 'Не вдалося підключитися до сервера' : 'Підключення не перевірено'}</dd></div>
          {connection?.mode === 'remote' && <div className="settings-about-address"><dt>Адреса сервера</dt><dd>{connection.apiUrl ?? 'Не налаштовано'}</dd></div>}
        </dl>
      </section>
      <section className="dashboard-panel settings-about-details" aria-labelledby="settings-origin-title">
        <div className="settings-card-heading"><span className="settings-icon"><Code2 size={19} aria-hidden="true"/></span><div><h2 id="settings-origin-title">Розробка та походження</h2><p>Розробник системи та громада, для потреб якої її створено.</p></div></div>
        <dl className="settings-origin-grid">
          <div><dt><Code2 size={15} aria-hidden="true"/>Розробник системи</dt><dd>Анатолій Мироненко</dd></div>
          <div><dt><MapPin size={15} aria-hidden="true"/>Громада, для потреб якої створено систему</dt><dd>Вишнівська селищна територіальна громада, Кам'янський район, Дніпропетровська область</dd></div>
        </dl>
      </section>
    </div>}
    {connectionModalOpen && <ServerConnectionDialog onClose={() => setConnectionModalOpen(false)} {...connectionActions} onSaved={(state, message) => { setConnection(state); setConnectionMessage(message ?? state.message ?? 'Адресу сервера збережено.') }} />}
  </div>
}
