import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Ban, ChevronDown, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, UserCheck, UserMinus } from 'lucide-react'
import type { ManagedUser, ManagedUserInput } from '../shared/api-contract'
import { passwordValidationMessage } from '../shared/password-policy'
import { USER_ROLE_LABELS, USER_ROLES, type UserRole } from '../shared/authorization'
import Alert from './components/Alert'
import ConfirmDialog from './components/ConfirmDialog'
import DictionaryTable, { DictionaryToolbar } from './components/DictionaryTable'
import Modal from './components/Modal'

type Draft = ManagedUserInput & { id?: string; expectedUpdatedAt?: string }
type Confirmation = { kind: 'block' | 'deactivate' | 'delete'; user: ManagedUser }
type MenuPosition = { top: number; left: number }
const blank = (): Draft => ({ username: '', firstName: '', lastName: '', roles: [], password: '' })
const statusLabel: Record<ManagedUser['status'], string> = { active: 'Активний', inactive: 'Неактивний', blocked: 'Заблокований' }

function UserActionsMenu({ user, currentUserId, busy, onEdit, onResetPassword, onStatus, onRequest }: { user: ManagedUser; currentUserId: string; busy: boolean; onEdit: () => void; onResetPassword: () => void; onStatus: (status: ManagedUser['status']) => void; onRequest: (kind: Confirmation['kind']) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0 })
  const close = () => setOpen(false)
  const updatePosition = () => {
    const anchor = trigger.current, popup = menu.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect(), width = popup?.offsetWidth ?? 208, height = popup?.offsetHeight ?? 250
    const opensUp = window.innerHeight - rect.bottom < height + 12 && rect.top > height + 12
    setPosition({ top: Math.max(8, Math.min(opensUp ? rect.top - height - 6 : rect.bottom + 6, window.innerHeight - height - 8)), left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) })
  }
  useLayoutEffect(() => { if (open) updatePosition() }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close() }
    const reposition = () => updatePosition()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') { close(); trigger.current?.focus(); return }
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current?.focus(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !menu.current) return
      const buttons = [...menu.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (!buttons.length) return
      event.preventDefault(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (index < 0 && event.key === 'ArrowUp') { buttons.at(-1)?.focus(); return }
      if (event.key === 'Home') buttons[0].focus(); else if (event.key === 'End') buttons.at(-1)?.focus(); else buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) % buttons.length].focus()
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [open])
  const action = (callback: () => void) => { close(); callback() }
  return <><button ref={trigger} type="button" className="secondary-button user-actions-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} disabled={busy}>Дії<ChevronDown size={15}/></button>{open && createPortal(<div ref={menu} className="user-actions-popover user-actions-popover-portal" style={position} role="menu" data-keyboard-popup aria-label={`Дії для ${user.username}`}><button type="button" role="menuitem" onClick={() => action(onEdit)}><Pencil size={16}/>Редагувати</button><button type="button" role="menuitem" onClick={() => action(onResetPassword)}><KeyRound size={16}/>Скинути пароль</button>{user.status === 'active' ? <><button type="button" role="menuitem" onClick={() => action(() => onRequest('block'))} disabled={user.id === currentUserId}><Ban size={16}/>Заблокувати</button><button type="button" role="menuitem" onClick={() => action(() => onRequest('deactivate'))} disabled={user.id === currentUserId}><UserMinus size={16}/>Деактивувати</button></> : <button type="button" role="menuitem" onClick={() => action(() => onStatus('active'))}><UserCheck size={16}/>{user.status === 'blocked' ? 'Розблокувати' : 'Активувати'}</button>}<hr/><button type="button" role="menuitem" className="danger" onClick={() => action(() => onRequest('delete'))} disabled={user.id === currentUserId}><Trash2 size={16}/>Видалити</button></div>, document.body)}</>
}

export default function UsersAdmin({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null), [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null), [newPassword, setNewPassword] = useState('')
  const [showCreatePassword, setShowCreatePassword] = useState(false), [showResetPassword, setShowResetPassword] = useState(false), [confirmation, setConfirmation] = useState<Confirmation | null>(null), [busy, setBusy] = useState(false)
  const refresh = async () => { setLoading(true); try { setUsers(await window.hromadaAid.users.list()); setLoadError('') } catch { setLoadError('Не вдалося завантажити користувачів.') } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [])
  const edit = (user: ManagedUser) => { setError(''); setShowCreatePassword(false); setDraft({ id: user.id, expectedUpdatedAt: user.updatedAt, username: user.username, firstName: user.firstName ?? '', lastName: user.lastName ?? '', roles: user.roles }) }
  const toggleRole = (role: UserRole) => setDraft(value => value ? { ...value, roles: value.roles.includes(role) ? value.roles.filter(item => item !== role) : [...value.roles, role] } : value)
  const save = async (event: FormEvent) => { event.preventDefault(); if (!draft || busy) return; const passwordError = !draft.id ? passwordValidationMessage(draft.password) : undefined; if (passwordError) { setError(passwordError); return }; setBusy(true); setError(''); try { const result = draft.id ? await window.hromadaAid.users.update(draft.id, draft, draft.expectedUpdatedAt ?? '') : await window.hromadaAid.users.create(draft); if (!result.ok) { setError(result.message); return }; setDraft(null); await refresh() } catch { setError('Не вдалося зберегти обліковий запис.') } finally { setBusy(false) } }
  const changeStatus = async (user: ManagedUser, status: ManagedUser['status']) => { setBusy(true); try { const result = await window.hromadaAid.users.setStatus(user.id, status, user.updatedAt); if (!result.ok) setError(result.message); else await refresh() } catch { setError('Не вдалося змінити статус користувача.') } finally { setBusy(false) } }
  const remove = async (user: ManagedUser) => { setBusy(true); try { const result = await window.hromadaAid.users.remove(user.id, user.updatedAt); if (!result.ok) setError(result.message); else await refresh() } catch { setError('Не вдалося видалити користувача. Спробуйте деактивувати обліковий запис.') } finally { setBusy(false) } }
  const resetPassword = async (event: FormEvent) => { event.preventDefault(); if (!passwordUser || busy) return; const passwordError = passwordValidationMessage(newPassword); if (passwordError) { setError(passwordError); return }; setBusy(true); try { const result = await window.hromadaAid.users.resetPassword(passwordUser.id, newPassword, passwordUser.updatedAt); if (!result.ok) { setError(result.message); return }; setPasswordUser(null); setNewPassword(''); await refresh() } catch { setError('Не вдалося скинути пароль.') } finally { setBusy(false) } }
  const request = (kind: Confirmation['kind'], user: ManagedUser) => setConfirmation({ kind, user })
  const confirm = async () => { if (!confirmation) return; const item = confirmation; setConfirmation(null); if (item.kind === 'delete') await remove(item.user); else await changeStatus(item.user, item.kind === 'block' ? 'blocked' : 'inactive') }
  const prompt = confirmation?.kind === 'block' ? ['Заблокувати користувача?', `«${confirmation.user.username}» не зможе увійти до системи, а всі його активні сесії буде відкликано.`, 'Заблокувати'] : confirmation?.kind === 'deactivate' ? ['Деактивувати користувача?', `«${confirmation.user.username}» втратить доступ до системи до повторної активації. Усі активні сесії буде відкликано.`, 'Деактивувати'] : confirmation ? ['Видалити користувача?', `Обліковий запис «${confirmation.user.username}» буде безповоротно видалено. Це не впливає на дані матеріальних допомог.`, 'Видалити'] : null
  return <div className="page-content users-admin"><DictionaryToolbar title="Користувачі" count={users.length ? `Усього: ${users.length}` : 'Облікових записів поки немає'} loading={loading}><button className="primary-button" type="button" onClick={() => { setShowCreatePassword(false); setDraft(blank()); setError('') }}><Plus size={18}/>Додати користувача</button></DictionaryToolbar>
    {error && !draft && !passwordUser && <Alert variant="error" onDismiss={() => setError('')}>{error}</Alert>}
    <DictionaryTable label="Користувачі" className="dictionary-users" loading={loading} error={loadError} onRetry={() => void refresh()} empty={!users.length ? 'Користувачів поки немає. Додайте перший обліковий запис.' : undefined} columns={[{ label: 'Логін', width: '17%' }, { label: 'Ім’я та прізвище', width: '24%' }, { label: 'Ролі', width: '33%' }, { label: 'Статус', width: '16%' }, { label: 'Дії', width: '106px', className: 'dictionary-actions-cell' }]}>
      {users.map(user => <tr key={user.id}><td className="dictionary-nowrap"><strong className="registry-name">{user.username}</strong></td><td>{user.displayName || '—'}</td><td><div className="user-roles">{user.roles.map(role => <span key={role}>{USER_ROLE_LABELS[role]}</span>)}</div></td><td><span className={`status-badge status-${user.status}`}>{statusLabel[user.status]}</span>{user.mustChangePassword && <small className="user-password-note">Потрібна зміна пароля</small>}</td><td className="dictionary-actions-cell"><div className="user-action-menu"><UserActionsMenu user={user} currentUserId={currentUserId} busy={busy} onEdit={() => edit(user)} onResetPassword={() => { setError(''); setShowResetPassword(false); setPasswordUser(user); setNewPassword('') }} onStatus={status => void changeStatus(user, status)} onRequest={kind => request(kind, user)}/></div></td></tr>)}
    </DictionaryTable>
    {draft && <Modal title={draft.id ? 'Редагування користувача' : 'Новий користувач'} description={draft.id ? 'Зміна ролей одразу завершує поточні сесії користувача.' : 'Задайте логін, початковий пароль та щонайменше одну роль.'} onClose={() => !busy && setDraft(null)} busy={busy} size="wide"><form className="user-form" onSubmit={event => void save(event)}><div className="user-form-fields"><label>Ім’я<input value={draft.firstName ?? ''} onChange={event => setDraft({ ...draft, firstName: event.target.value })} disabled={busy}/></label><label>Прізвище<input value={draft.lastName ?? ''} onChange={event => setDraft({ ...draft, lastName: event.target.value })} disabled={busy}/></label><label>Логін<input value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} autoComplete="off" required disabled={busy}/></label>{!draft.id && <label className="user-password-field">Початковий пароль<div className="auth-password"><input type={showCreatePassword ? 'text' : 'password'} value={draft.password ?? ''} onChange={event => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" required disabled={busy}/><button type="button" className="icon-button" title={showCreatePassword ? 'Приховати пароль' : 'Показати пароль'} aria-label={showCreatePassword ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShowCreatePassword(value => !value)} disabled={busy}>{showCreatePassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>}</div><fieldset><legend>Ролі користувача</legend><div className="role-checkboxes">{USER_ROLES.map(role => <label key={role}><input type="checkbox" checked={draft.roles.includes(role)} onChange={() => toggleRole(role)} disabled={busy}/><span>{USER_ROLE_LABELS[role]}</span></label>)}</div></fieldset>{error && <Alert variant="error">{error}</Alert>}<div className="modal-actions user-form-actions"><button type="button" className="secondary-button" onClick={() => setDraft(null)} disabled={busy}>Скасувати</button><button className="primary-button" disabled={busy}>{busy ? 'Збереження…' : 'Зберегти'}</button></div></form></Modal>}
    {passwordUser && <Modal title="Скинути пароль" description={`Новий тимчасовий пароль для «${passwordUser.username}». Після входу користувач обов’язково встановить власний пароль.`} onClose={() => !busy && setPasswordUser(null)} busy={busy} size="compact"><form className="user-form" onSubmit={event => void resetPassword(event)}><label className="user-password-field">Тимчасовий пароль<div className="auth-password"><input type={showResetPassword ? 'text' : 'password'} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" required disabled={busy} autoFocus/><button type="button" className="icon-button" title={showResetPassword ? 'Приховати пароль' : 'Показати пароль'} aria-label={showResetPassword ? 'Приховати пароль' : 'Показати пароль'} onClick={() => setShowResetPassword(value => !value)} disabled={busy}>{showResetPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>{error && <Alert variant="error">{error}</Alert>}<div className="modal-actions user-form-actions"><button type="button" className="secondary-button" onClick={() => setPasswordUser(null)} disabled={busy}>Скасувати</button><button className="primary-button" disabled={busy}>{busy ? 'Збереження…' : 'Скинути пароль'}</button></div></form></Modal>}
    {confirmation && prompt && <ConfirmDialog title={prompt[0]} message={prompt[1]} variant="danger" confirmLabel={prompt[2]} confirmIcon={confirmation.kind === 'delete' ? <Trash2 size={17}/> : confirmation.kind === 'block' ? <Ban size={17}/> : <UserMinus size={17}/>} onCancel={() => setConfirmation(null)} onConfirm={confirm}/>}
  </div>
}
