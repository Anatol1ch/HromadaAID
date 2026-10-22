import { CircleUserRound, Info, KeyRound, Server } from 'lucide-react'
import { useState } from 'react'
import type { AuthenticatedUser } from '../shared/auth-contract'
import { USER_ROLE_LABELS } from '../shared/authorization'
import ChangePasswordForm from './components/ChangePasswordForm'
import Modal from './components/Modal'

export default function SettingsPage({ user, onChangePassword }: { user: AuthenticatedUser | null; onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const structuredName = [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean).join(' ')
  const displayName = structuredName || user?.displayName?.trim() || user?.username || 'Локальний режим'
  const roles = user?.roles.map(role => USER_ROLE_LABELS[role]).join(', ') || 'Автономна робота'

  return <div className="settings-page">
    <header className="page-heading settings-heading"><div><div className="eyebrow">СИСТЕМА</div><h1>Налаштування</h1><p className="subtitle">Керування обліковим записом і параметрами застосунку.</p></div></header>
    <nav className="settings-section-nav" aria-label="Розділи налаштувань">
      <span className="settings-section-current" aria-current="page"><CircleUserRound size={17} aria-hidden="true"/>Мій обліковий запис</span>
      <span className="settings-section-future"><Server size={16} aria-hidden="true"/><span>Підключення до сервера</span><small>Майбутня функція</small></span>
      <span className="settings-section-future"><Info size={16} aria-hidden="true"/><span>Про застосунок</span><small>Майбутня функція</small></span>
    </nav>
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
  </div>
}
