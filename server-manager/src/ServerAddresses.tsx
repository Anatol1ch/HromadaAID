import { useRef, useState } from 'react'
import { Copy, Wifi } from 'lucide-react'
import type { NetworkAddresses } from '../electron/inspection-types'
import { IconButton } from './ManagerUI'

export default function ServerAddresses({ addresses }: { addresses?: NetworkAddresses }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const copying = useRef(false)
  const copy = async (address: string) => {
    if (copying.current) return
    copying.current = true
    setBusy(true)
    setMessage('')
    try {
      const copied = await window.hromadaManager.copyServerAddress(address)
      setMessage(copied ? 'Адресу скопійовано.' : 'Адреса більше не доступна. Оновіть перевірку середовища.')
    } catch { setMessage('Не вдалося скопіювати адресу.') }
    finally { copying.current = false; setBusy(false) }
  }
  const rows = [
    { title: 'Локальне підключення', urls: ['http://127.0.0.1:4310'], empty: '' },
    { title: 'Локальна мережа', urls: addresses?.lan ?? [], empty: 'Активні фізичні IPv4-інтерфейси не визначено.' },
    { title: 'Tailscale', urls: addresses?.tailscale ?? [], empty: 'Tailscale-інтерфейс не визначено. За потреби введіть його адресу в Client вручну.' },
  ]
  return <section className="dashboard-panel sm-panel">
    <header className="sm-panel-header"><h2><Wifi size={21} aria-hidden="true"/><span>Адреси підключення</span></h2></header>
    <dl className="sm-details sm-setting-rows">{rows.map(row => <div key={row.title}><dt>{row.title}</dt><dd>{row.urls.length ? row.urls.map(url => <div key={url} className="sm-connection-address"><code>{url}</code><IconButton label={`Копіювати ${url}`} disabled={busy} onClick={() => void copy(url)}><Copy size={16} aria-hidden="true"/></IconButton></div>) : row.empty}</dd></div>)}</dl>
    {addresses?.unavailable && <p className="sm-form-intro">Мережеві відомості Windows недоступні. Адресу сервера можна ввести в Client вручну.</p>}
    <p className="sm-form-intro">Список інформаційний: доступ з іншого комп’ютера залежить від Windows Firewall і маршрутизації. Оновлення списку — через перевірку середовища.</p>
    <p className="sm-form-intro" role="status">{message}</p>
  </section>
}
