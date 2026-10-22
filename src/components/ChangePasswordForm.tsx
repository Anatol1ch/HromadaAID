import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PASSWORD_MIN_LENGTH, passwordValidationMessage } from '../../shared/password-policy'
import Alert from './Alert'

type PasswordFieldName = 'current' | 'next' | 'confirmation'

export default function ChangePasswordForm({ onChangePassword }: { onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [values, setValues] = useState({ current: '', next: '', confirmation: '' })
  const [visible, setVisible] = useState({ current: false, next: false, confirmation: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!values.current) { setError('Введіть поточний пароль.'); return }
    const passwordError = passwordValidationMessage(values.next)
    if (passwordError) { setError(passwordError); return }
    if (values.next !== values.confirmation) { setError('Новий пароль і підтвердження не збігаються.'); return }

    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await onChangePassword(values.current, values.next)
      if (!result.ok) { setError(result.message ?? 'Не вдалося змінити пароль.'); return }
      setValues({ current: '', next: '', confirmation: '' })
      setSuccess(result.message ?? 'Пароль змінено. Увійдіть з новим паролем.')
    } catch {
      setError('Не вдалося змінити пароль. Перевірте підключення та повторіть спробу.')
    } finally { setBusy(false) }
  }

  const field = (name: PasswordFieldName, label: string, autoComplete: string) => {
    const id = `account-password-${name}`
    return <label className="recipient-field" key={name} htmlFor={id}>
      <span>{label}</span>
      <div className="auth-password">
        <input id={id} type={visible[name] ? 'text' : 'password'} autoComplete={autoComplete} value={values[name]} disabled={busy} onChange={event => { setValues(current => ({ ...current, [name]: event.target.value })); setError(''); setSuccess('') }} aria-invalid={!!error} aria-describedby={error ? 'account-password-error' : name === 'next' ? 'account-password-hint' : undefined}/>
        <button type="button" className="icon-button" title={visible[name] ? 'Приховати пароль' : 'Показати пароль'} aria-label={`${visible[name] ? 'Приховати' : 'Показати'}: ${label.toLocaleLowerCase('uk-UA')}`} disabled={busy} onClick={() => setVisible(current => ({ ...current, [name]: !current[name] }))}>{visible[name] ? <EyeOff size={17} aria-hidden="true"/> : <Eye size={17} aria-hidden="true"/>}</button>
      </div>
      {name === 'next' && <small id="account-password-hint">Від {PASSWORD_MIN_LENGTH} до 256 символів.</small>}
    </label>
  }

  return <section className="dashboard-panel settings-security" aria-labelledby="settings-security-title">
    <div className="settings-card-heading"><span className="settings-icon"><KeyRound size={19} aria-hidden="true"/></span><div><h2 id="settings-security-title">Безпека</h2><p>Змініть пароль для входу до системи.</p></div></div>
    <form className="account-password-form" noValidate onSubmit={event => void submit(event)}>
      {field('current', 'Поточний пароль', 'current-password')}
      {field('next', 'Новий пароль', 'new-password')}
      {field('confirmation', 'Підтвердження нового пароля', 'new-password')}
      {error && <div id="account-password-error"><Alert variant="error">{error}</Alert></div>}
      {success && <Alert variant="success">{success}</Alert>}
      <div className="settings-form-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Змінюємо пароль…' : 'Змінити пароль'}</button></div>
    </form>
  </section>
}
