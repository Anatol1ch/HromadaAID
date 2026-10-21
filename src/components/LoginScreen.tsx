import { Eye, EyeOff, HeartHandshake, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ClientAuthState } from '../../shared/auth-contract'

export default function LoginScreen({ state, onLogin }: { state: ClientAuthState; onLogin: (username: string, password: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
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
      <div className="auth-mark"><HeartHandshake size={28} aria-hidden="true"/></div>
      <div className="auth-brand">Hromada<span>Aid</span></div>
      <p className="auth-caption">Автоматизована система обліку матеріальних допомог</p>
      <h1 id="auth-title">Вхід до системи</h1>
      <p className="auth-description">Використайте облікові дані, надані адміністратором.</p>
      {(error || message) && <div className="auth-message" role="alert">{error || message}</div>}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label><span>Логін</span><input autoComplete="username" autoFocus disabled={busy || unavailable} value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3}/></label>
        <label><span>Пароль</span><div className="auth-password"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" disabled={busy || unavailable} value={password} onChange={(event) => setPassword(event.target.value)} required/><button type="button" className="icon-button" disabled={busy || unavailable} aria-label={showPassword ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
        <button type="submit" className="primary-button auth-submit" disabled={busy || unavailable}><LogIn size={18} aria-hidden="true"/>{busy ? 'Входимо…' : 'Увійти'}</button>
      </form>
    </section>
  </main>
}
