import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, CircleX, LoaderCircle, Server, Wifi } from 'lucide-react'
import type { ServerConnectionCheckResult, ServerConnectionSaveResult, ServerConnectionState } from '../../shared/api-contract'
import Modal from './Modal'

type Props = {
  onClose: () => void
  getState: () => Promise<ServerConnectionState>
  check: (apiUrl: string) => Promise<ServerConnectionCheckResult>
  save: (apiUrl: string) => Promise<ServerConnectionSaveResult>
  onSaved: (state: ServerConnectionState, message?: string) => void
}

export default function ServerConnectionDialog({ onClose, getState, check, save, onSaved }: Props) {
  const [state, setState] = useState<ServerConnectionState | null>(null)
  const [address, setAddress] = useState('')
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ServerConnectionCheckResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void getState().then((value) => {
      if (!active) return
      setState(value)
      setAddress(value.apiUrl ?? '')
    }).catch(() => { if (active) setError('Не вдалося прочитати налаштування підключення.') })
    return () => { active = false }
  }, [])

  const busy = checking || saving
  const checkAddress = async () => {
    if (busy) return
    setChecking(true); setResult(null); setError('')
    try { setResult(await check(address)) }
    catch { setResult({ ok: false, status: 'unavailable', failureReason: 'network', message: 'Не вдалося виконати перевірку підключення.' }) }
    finally { setChecking(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !result?.ok || !sameServerAddress(result.apiUrl, address)) return
    setSaving(true); setError('')
    try {
      const response = await save(address)
      setState(response.state)
      if (!response.ok) { setError(response.message); return }
      onSaved(response.state, response.message)
      onClose()
    } catch { setError('Не вдалося зберегти адресу сервера.') }
    finally { setSaving(false) }
  }

  const changedSinceCheck = !result?.ok || !sameServerAddress(result.apiUrl, address)
  const activeLabel = state?.active ? 'Адреса використовується в цьому запуску.' : state?.mode === 'local' && state.apiUrl ? 'Адресу збережено для наступного запуску remote mode.' : 'Адреса ще не налаштована.'
  return <Modal title="Налаштування підключення" description="Укажіть базову адресу сервера HromadaAID." headerIcon={<Server size={21} aria-hidden="true"/>} onClose={onClose} busy={busy} size="compact" className="server-connection-modal">
    <form className="server-connection-form" onSubmit={(event) => void submit(event)}>
      <label className="recipient-field" htmlFor="server-connection-address"><span>Адреса сервера</span><input id="server-connection-address" type="text" inputMode="url" autoComplete="url" spellCheck={false} disabled={!state?.editable || busy} readOnly={state?.editable === false} value={address} placeholder="https://server.example" aria-describedby="server-connection-hint" onChange={(event) => { setAddress(event.target.value); setResult(null); setError('') }}/></label>
      <small id="server-connection-hint" className="server-connection-hint">{state?.lockedReason ?? 'Віддалені адреси мають використовувати HTTPS. HTTP дозволено лише для localhost.'}</small>
      {state && <p className="server-connection-current">{activeLabel}{state.message && state.status !== 'unknown' ? ` ${state.message}` : ''}</p>}
      {result && <p className={`server-connection-result${result.ok ? ' is-success' : ' is-error'}`} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CircleCheck size={17} aria-hidden="true"/> : <CircleX size={17} aria-hidden="true"/>}{result.message}</p>}
      {error && <p className="server-connection-result is-error" role="alert"><CircleX size={17} aria-hidden="true"/>{error}</p>}
      <div className="server-connection-actions">
        <button type="button" className="secondary-button" disabled={busy || !address.trim()} onClick={() => void checkAddress()}>{checking ? <LoaderCircle className="server-connection-spin" size={17} aria-hidden="true"/> : <Wifi size={17} aria-hidden="true"/>}{checking ? 'Перевіряємо…' : 'Перевірити підключення'}</button>
        <div><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Скасувати</button><button type="submit" className="primary-button" disabled={busy || !state?.editable || changedSinceCheck}>{saving ? 'Зберігаємо…' : 'Зберегти адресу'}</button></div>
      </div>
    </form>
  </Modal>
}

function sameServerAddress(checked: string, candidate: string): boolean {
  try { return new URL(candidate.trim()).origin === checked } catch { return false }
}
