import { HeartHandshake, RotateCw, LogOut } from 'lucide-react'
import type { AuthenticatedUser } from '../../shared/auth-contract'
import { welcomeHeading } from '../lib/welcome-name'

export default function WelcomeScreen({ user, loading, error, onRetry, onSignOut }: {
  user: AuthenticatedUser
  loading: boolean
  error?: string
  onRetry: () => void
  onSignOut: () => void
}) {
  return <main className="app-welcome" aria-busy={loading} aria-label="Підготовка робочого середовища">
    <section className="app-welcome-content" aria-live="polite">
      <div className="app-startup-mark"><HeartHandshake size={34} strokeWidth={2} aria-hidden="true"/></div>
      <div className="app-startup-name">Hromada<span>Aid</span></div>
      <h1>{welcomeHeading(user)}</h1>
      {loading ? <><p>Готуємо робоче середовище…</p><span className="app-startup-loader" aria-hidden="true"/><span className="visually-hidden">Перевіряємо обліковий запис і готуємо робоче середовище…</span></> : <>
        <p className="app-welcome-error" role="alert">{error ?? 'Не вдалося підготувати робоче середовище.'}</p>
        <div className="app-welcome-actions"><button type="button" className="primary-button" onClick={onRetry}><RotateCw size={17} aria-hidden="true"/>Спробувати знову</button><button type="button" className="secondary-button" onClick={onSignOut}><LogOut size={17} aria-hidden="true"/>Повернутися до входу</button></div>
      </>}
    </section>
  </main>
}
