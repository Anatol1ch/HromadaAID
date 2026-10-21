import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import type { ClientAuthState } from '../../shared/auth-contract'

export default function TemporaryPasswordScreen({ state, onChangePassword }: { state: Extract<ClientAuthState, { status: 'password-change-required' }>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (newPassword !== repeatPassword) { setError('Нові паролі не збігаються.'); return }
    setBusy(true)
    try { const result = await onChangePassword(currentPassword, newPassword); if (!result.ok) setError(result.message ?? 'Не вдалося змінити пароль.') }
    finally { setBusy(false) }
  }
  return <main className="auth-screen" aria-busy={busy || undefined}><section className="auth-card" aria-labelledby="temporary-password-title">
    <div className="auth-identity"><div className="auth-mark"><KeyRound size={28} aria-hidden="true"/></div><div className="auth-brand">Hromada<span>AID</span></div><p className="auth-caption">Автоматизована система обліку матеріальних допомог</p></div>
    <h1 id="temporary-password-title">Встановіть новий пароль</h1><p className="auth-description">Адміністратор скинув пароль для облікового запису «{state.user.username}». Перш ніж продовжити, встановіть власний пароль.</p>
    {error && <div className="auth-message" role="alert">{error}</div>}
    <form onSubmit={(event) => void submit(event)}><label>Тимчасовий пароль<input type={show ? 'text' : 'password'} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" autoFocus disabled={busy}/></label><label>Новий пароль<input type={show ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" disabled={busy}/></label><label>Підтвердіть новий пароль<div className="auth-password"><input type={show ? 'text' : 'password'} value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} autoComplete="new-password" disabled={busy}/><button type="button" className="icon-button" aria-label={show ? 'Приховати пароль' : 'Показати пароль'} title={show ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShow((value) => !value)} disabled={busy}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label><button className="primary-button auth-submit" disabled={busy}>{busy ? 'Збереження…' : 'Змінити пароль'}</button></form>
  </section></main>
}
