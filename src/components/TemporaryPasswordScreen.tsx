import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import type { ClientAuthState } from '../../shared/auth-contract'
import { passwordValidationMessage } from '../../shared/password-policy'

export default function TemporaryPasswordScreen({ state, onChangePassword }: { state: Extract<ClientAuthState, { status: 'password-change-required' }>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showRepeat, setShowRepeat] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError(''); const passwordError = passwordValidationMessage(newPassword); if (passwordError) { setError(passwordError); return }
    if (newPassword !== repeatPassword) { setError('Нові паролі не збігаються.'); return }
    setBusy(true)
    try { const result = await onChangePassword(currentPassword, newPassword); if (!result.ok) setError(result.message ?? 'Не вдалося змінити пароль.') }
    finally { setBusy(false) }
  }
  return <main className="auth-screen" aria-busy={busy || undefined}><section className="auth-card" aria-labelledby="temporary-password-title">
    <div className="auth-identity"><div className="auth-mark"><KeyRound size={28} aria-hidden="true"/></div><div className="auth-brand">Hromada<span>AID</span></div><p className="auth-caption">Автоматизована система обліку матеріальних допомог</p></div>
    <h1 id="temporary-password-title">Встановіть новий пароль</h1><p className="auth-description">Адміністратор скинув пароль для облікового запису «{state.user.username}». Перш ніж продовжити, встановіть власний пароль.</p>
    {error && <div className="auth-message" role="alert">{error}</div>}
    <form onSubmit={(event) => void submit(event)}><PasswordField label="Тимчасовий пароль" value={currentPassword} onChange={setCurrentPassword} show={showCurrent} setShow={setShowCurrent} autoComplete="current-password" autoFocus disabled={busy}/><PasswordField label="Новий пароль" value={newPassword} onChange={setNewPassword} show={showNew} setShow={setShowNew} autoComplete="new-password" disabled={busy}/><PasswordField label="Підтвердіть новий пароль" value={repeatPassword} onChange={setRepeatPassword} show={showRepeat} setShow={setShowRepeat} autoComplete="new-password" disabled={busy}/><button className="primary-button auth-submit" disabled={busy}>{busy ? 'Збереження…' : 'Змінити пароль'}</button></form>
  </section></main>
}

function PasswordField({ label, value, onChange, show, setShow, autoComplete, autoFocus = false, disabled }: { label: string; value: string; onChange: (value: string) => void; show: boolean; setShow: (value: boolean | ((current: boolean) => boolean)) => void; autoComplete: string; autoFocus?: boolean; disabled: boolean }) {
  return <label>{label}<div className="auth-password"><input type={show ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} disabled={disabled}/><button type="button" className="icon-button" aria-label={show ? 'Приховати пароль' : 'Показати пароль'} title={show ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShow((current) => !current)} disabled={disabled}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
}
