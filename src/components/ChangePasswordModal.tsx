import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import Modal from './Modal'
import Alert from './Alert'

export default function ChangePasswordModal({ onClose, onChangePassword }: { onClose: () => void; onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (newPassword !== confirmation) { setError('Новий пароль і підтвердження не збігаються.'); return }
    setBusy(true); setError('')
    try {
      const result = await onChangePassword(currentPassword, newPassword)
      if (!result.ok) { setError(result.message ?? 'Не вдалося змінити пароль.'); return }
      onClose()
    } finally { setBusy(false) }
  }
  return <Modal title="Змінити пароль" description="Після зміни пароля потрібно увійти повторно." headerIcon={<KeyRound size={21} aria-hidden="true"/>} busy={busy} onClose={onClose} size="compact" className="change-password-modal">
    <form className="auth-change-password" onSubmit={(event) => void submit(event)}>
      <label className="recipient-field"><span>Поточний пароль</span><input type="password" autoComplete="current-password" autoFocus required value={currentPassword} disabled={busy} onChange={(event) => setCurrentPassword(event.target.value)}/></label>
      <label className="recipient-field"><span>Новий пароль</span><input type="password" autoComplete="new-password" required minLength={12} value={newPassword} disabled={busy} onChange={(event) => setNewPassword(event.target.value)}/><small>Від 12 символів.</small></label>
      <label className="recipient-field"><span>Підтвердження нового пароля</span><input type="password" autoComplete="new-password" required value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)}/></label>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="recipient-form-actions"><div><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Змінюємо…' : 'Змінити пароль'}</button></div></div>
    </form>
  </Modal>
}
