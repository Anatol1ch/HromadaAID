import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordValidationMessage } from '../../shared/password-policy'
import Alert from './Alert'

type PasswordFieldName = 'current' | 'next' | 'confirmation'
type FieldErrors = Record<PasswordFieldName, string>

export default function ChangePasswordForm({ onChangePassword, onBusyChange, onCancel }: { onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>; onBusyChange: (busy: boolean) => void; onCancel: () => void }) {
  const [values, setValues] = useState({ current: '', next: '', confirmation: '' })
  const [visible, setVisible] = useState({ current: false, next: false, confirmation: false })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({ current: '', next: '', confirmation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const errors: FieldErrors = {
      current: values.current ? '' : 'Введіть поточний пароль.',
      next: passwordValidationMessage(values.next) ?? '',
      confirmation: values.confirmation ? '' : 'Підтвердіть новий пароль.',
    }
    if (!errors.next && values.next !== values.confirmation) errors.confirmation = 'Новий пароль і підтвердження не збігаються.'
    setFieldErrors(errors)
    if (Object.values(errors).some(Boolean)) return

    setBusy(true); onBusyChange(true); setError('')
    try {
      const result = await onChangePassword(values.current, values.next)
      if (!result.ok) {
        if (result.message === 'Поточний пароль неправильний.') setFieldErrors(current => ({ ...current, current: result.message! }))
        else setError(result.message ?? 'Не вдалося змінити пароль.')
        return
      }
      setValues({ current: '', next: '', confirmation: '' })
      setFieldErrors({ current: '', next: '', confirmation: '' })
    } catch {
      setError('Не вдалося змінити пароль. Перевірте підключення та повторіть спробу.')
    } finally { setBusy(false); onBusyChange(false) }
  }

  const field = (name: PasswordFieldName, label: string, autoComplete: string) => {
    const id = `account-password-${name}`
    const errorId = `${id}-error`
    return <label className="recipient-field" key={name} htmlFor={id}>
      <span>{label}</span>
      <div className="auth-password">
        <input id={id} type={visible[name] ? 'text' : 'password'} autoComplete={autoComplete} value={values[name]} disabled={busy} onChange={event => { setValues(current => ({ ...current, [name]: event.target.value })); setFieldErrors(current => ({ ...current, [name]: '' })); setError('') }} aria-invalid={!!fieldErrors[name]} aria-describedby={fieldErrors[name] ? errorId : name === 'next' ? 'account-password-hint' : undefined}/>
        <button type="button" className="icon-button" title={visible[name] ? 'Приховати пароль' : 'Показати пароль'} aria-label={`${visible[name] ? 'Приховати' : 'Показати'}: ${label.toLocaleLowerCase('uk-UA')}`} disabled={busy} onClick={() => setVisible(current => ({ ...current, [name]: !current[name] }))}>{visible[name] ? <EyeOff size={17} aria-hidden="true"/> : <Eye size={17} aria-hidden="true"/>}</button>
      </div>
      {name === 'next' && <small id="account-password-hint">Від {PASSWORD_MIN_LENGTH} до {PASSWORD_MAX_LENGTH} символів.</small>}
      {fieldErrors[name] && <small className="recipient-field-error" id={errorId} role="alert">{fieldErrors[name]}</small>}
    </label>
  }

  return <form className="auth-change-password account-password-form" noValidate onSubmit={event => void submit(event)}>
    {field('current', 'Поточний пароль', 'current-password')}
    {field('next', 'Новий пароль', 'new-password')}
    {field('confirmation', 'Підтвердження нового пароля', 'new-password')}
    {error && <Alert variant="error">{error}</Alert>}
    <div className="settings-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Скасувати</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Змінюємо пароль…' : 'Змінити пароль'}</button></div>
  </form>
}
