import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Copy, Network, Pencil } from 'lucide-react'
import type { AddressResult, ServerAddressKey } from '../electron/server-address-contract'
import { IconButton, Modal, Toast } from './ManagerUI'

const rows: { key: ServerAddressKey; title: string }[] = [
  { key: 'loopback', title: 'Loopback' }, { key: 'lan', title: 'LAN' }, { key: 'tailscale', title: 'Tailscale' },
]

export default function ServerAddresses() {
  const [state, setState] = useState<AddressResult | null>(null)
  const [editing, setEditing] = useState<ServerAddressKey | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const inFlight = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  useEffect(() => {
    let mounted = true
    window.hromadaManager.getServerAddresses().then(result => { if (mounted) setState(result) }).catch(() => {
      if (mounted) setState({ ok: false, storageError: true, message: 'Не вдалося прочитати налаштування адрес. Перезапустіть Server Manager.' })
    })
    return () => { mounted = false }
  }, [])
  useEffect(() => { if (editing) input.current?.focus() }, [editing])
  const close = () => { if (!inFlight.current) { setEditing(null); setError('') } }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing || inFlight.current || !state?.ok) return
    inFlight.current = true; setSaving(true); setError('')
    try {
      const result = await window.hromadaManager.saveServerAddress(editing, draft)
      if (result.ok) { setState(result); setEditing(null) }
      else { setError(result.message); if (result.storageError) setState(result) }
    } catch { setError('Не вдалося зберегти адресу. Повторіть спробу.') }
    finally { inFlight.current = false; setSaving(false) }
  }
  const copy = async (key: ServerAddressKey) => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const result = await window.hromadaManager.copyServerAddress(key)
      setNotice({ tone: result.ok ? 'success' : 'error', message: result.ok ? 'Адресу скопійовано.' : result.message })
    } catch { setNotice({ tone: 'error', message: 'Не вдалося скопіювати адресу.' }) }
    finally { inFlight.current = false }
  }
  return <section className="dashboard-panel sm-panel">
    <header className="sm-panel-header"><h2><Network size={21} aria-hidden="true"/><span>Адреси підключення</span></h2></header>
    <dl className="sm-details sm-setting-rows sm-address-rows">{rows.map(row => {
      const address = state?.ok ? state.addresses[row.key] : null
      return <div key={row.key}><dt>{row.title}</dt><dd><div className="sm-connection-address">
        <span className="sm-address-value">{address ?? (state === null ? 'Завантаження…' : state.ok ? 'Не задано' : 'Недоступно')}</span>
        <span className="sm-address-actions">
          <IconButton label={`Копіювати адресу ${row.title}`} disabled={!address || saving} onClick={() => void copy(row.key)}><Copy size={16} aria-hidden="true"/></IconButton>
          <IconButton label={`Редагувати адресу ${row.title}`} disabled={!state?.ok || saving} onClick={() => {
            if (!state?.ok || inFlight.current) return
            setDraft(state.addresses[row.key] ?? ''); setError(''); setEditing(row.key)
          }}><Pencil size={16} aria-hidden="true"/></IconButton>
        </span>
      </div></dd></div>
    })}</dl>
    {state && !state.ok && <p role="alert" className="sm-address-error">{state.message}</p>}
    {editing && <Modal title={`Адреса ${rows.find(row => row.key === editing)!.title}`} icon={<Pencil size={20} aria-hidden="true"/>} className="sm-address-modal" busy={saving} onClose={close} footer={<>
      <button type="button" className="secondary-button" disabled={saving} onClick={close}>Скасувати</button>
      <button type="submit" form={`${id}-form`} className="primary-button" disabled={saving || !state?.ok}>{saving ? 'Зберігаємо…' : 'Зберегти'}</button>
    </>}>
      <form id={`${id}-form`} noValidate onSubmit={event => void save(event)}>
        <label className="sm-install-control" htmlFor={`${id}-address`}>Адреса
          <input ref={input} id={`${id}-address`} type="text" autoComplete="off" spellCheck={false} value={draft} disabled={saving || !state?.ok} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setDraft(event.target.value); setError('') }}/>
        </label>
        {error && <p id={`${id}-error`} role="alert" className="sm-address-error">{error}</p>}
      </form>
    </Modal>}
    {notice && <Toast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)}/>}
  </section>
}
