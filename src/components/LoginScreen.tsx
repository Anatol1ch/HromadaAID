import { Eye, EyeOff, HeartHandshake, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ClientAuthState } from '../../shared/auth-contract'

export default function LoginScreen({ state, onLogin }: { state: ClientAuthState; onLogin: (username: string, password: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const loginMessage = !username ? 'Введіть логін.' : username.length < 3 ? 'Логін має містити щонайменше 3 символи.' : ''
    const passwordMessage = password ? '' : 'Введіть пароль.'
    setUsernameError(loginMessage); setPasswordError(passwordMessage)
    if (loginMessage || passwordMessage) return
    setBusy(true); setError('')
    try {
      const result = await onLogin(username, password)
      if (!result.ok) setError(result.message ?? 'Не вдалося виконати вхід.')
    } finally { setBusy(false) }
  }
  const unavailable = state.mode === 'remote' && state.status === 'unavailable'
  const message = state.mode === 'remote' && 'message' in state ? state.message : undefined
  return <main className="auth-screen" aria-busy={busy || undefined}>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-identity">
        <div className="auth-mark"><HeartHandshake size={28} aria-hidden="true"/></div>
        <div className="auth-brand">Hromada<span>AID</span></div>
        <p className="auth-caption">Автоматизована система обліку матеріальних допомог</p>
      </div>
      <h1 id="auth-title">Вхід до системи</h1>
      <p className="auth-description">Використайте облікові дані, надані адміністратором.</p>
      {(error || message) && <div className="auth-message" role="alert">{error || message}</div>}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label><span>Логін</span><input id="login-username" autoComplete="username" autoFocus disabled={busy || unavailable} value={username} onChange={(event) => { setUsername(event.target.value); setUsernameError('') }} onBlur={() => setUsernameError(!username ? 'Введіть логін.' : username.length < 3 ? 'Логін має містити щонайменше 3 символи.' : '')} aria-invalid={!!usernameError} aria-describedby={usernameError ? 'login-username-error' : undefined} required minLength={3}/>{usernameError && <small className="recipient-field-error" id="login-username-error" role="alert">{usernameError}</small>}</label>
        <label><span>Пароль</span><div className="auth-password"><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" disabled={busy || unavailable} value={password} onChange={(event) => { setPassword(event.target.value); setPasswordError('') }} onBlur={() => setPasswordError(password ? '' : 'Введіть пароль.')} aria-invalid={!!passwordError} aria-describedby={passwordError ? 'login-password-error' : undefined} required/><button type="button" className="icon-button" disabled={busy || unavailable} aria-label={showPassword ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>{passwordError && <small className="recipient-field-error" id="login-password-error" role="alert">{passwordError}</small>}</label>
        <button type="submit" className="primary-button auth-submit" disabled={busy || unavailable}><LogIn size={18} aria-hidden="true"/>{busy ? 'Входимо…' : 'Увійти'}</button>
      </form>
    </section>
  </main>
}
