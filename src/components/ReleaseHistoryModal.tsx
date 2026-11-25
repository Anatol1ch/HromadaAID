import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, History, LoaderCircle } from 'lucide-react'
import type { ReleaseHistoryEntry, ReleaseHistorySnapshot } from '../../shared/api-contract'
import Modal from './Modal'
import { ReleaseNotes } from './ReleaseUpdateDetails'

function formatPublishedDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('uk-UA') : null
}

function withoutDuplicateTitle(body: string, name: string, version: string) {
  const lines = body.replace(/\r/g, '').split('\n')
  const first = lines.findIndex(line => line.trim())
  if (first < 0) return ''
  const heading = /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(lines[first].trim())
  if (!heading) return body
  const normalize = (value: string) => value.trim().replace(/^HromadaAID\s+/i, '').replace(/^Stable\s+/i, '').toLocaleLowerCase('uk-UA')
  const candidates = [name, version, `Stable ${version}`, `HromadaAID Stable ${version}`].filter(Boolean).map(normalize)
  if (!candidates.includes(normalize(heading[1]))) return body
  lines.splice(first, 1)
  return lines.join('\n').replace(/^\s*\n/, '')
}

function defaultVersion(entries: ReleaseHistoryEntry[], currentVersion: string) {
  return entries.some(entry => entry.version === currentVersion) ? currentVersion : entries[0]?.version ?? ''
}

export default function ReleaseHistoryModal({ currentVersion, onClose }: { currentVersion: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<ReleaseHistorySnapshot | null>(null)
  const [selectedVersion, setSelectedVersion] = useState('')
  const [refreshing, setRefreshing] = useState(true)
  const [loadError, setLoadError] = useState('')
  const selectionChanged = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const applySnapshot = (next: ReleaseHistorySnapshot) => {
    setSnapshot(next)
    setSelectedVersion(current => {
      if (selectionChanged.current && next.entries.some(entry => entry.version === current)) return current
      return defaultVersion(next.entries, currentVersion)
    })
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const local = await window.hromadaAid.releaseHistory.getLocal()
        if (active) applySnapshot(local)
      } catch { if (active) setLoadError('Не вдалося прочитати локальну історію релізів.') }
      try {
        const latest = await window.hromadaAid.releaseHistory.refresh()
        if (active) applySnapshot(latest)
      } catch { if (active) setLoadError('Історія доступна з локальних джерел, але не вдалося оновити її з GitHub.') }
      finally { if (active) setRefreshing(false) }
    }
    void load()
    return () => { active = false }
  }, [currentVersion])

  const selected = useMemo(() => snapshot?.entries.find(entry => entry.version === selectedVersion), [snapshot, selectedVersion])
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [selectedVersion])

  const sourceLabel = snapshot?.source === 'github'
    ? snapshot.refreshedAt ? `Оновлено ${new Date(snapshot.refreshedAt).toLocaleString('uk-UA')}` : 'Оновлено з GitHub'
    : snapshot?.source === 'cache' ? `Локальний кеш${snapshot.refreshedAt ? ` · ${new Date(snapshot.refreshedAt).toLocaleDateString('uk-UA')}` : ''}`
      : snapshot?.source === 'embedded' ? 'Вбудована історія релізів' : 'Історія релізів недоступна'

  return <Modal title="Історія оновлень" description="Нові можливості, вдосконалення та виправлення HromadaAID." headerIcon={<History size={20} aria-hidden="true"/>} onClose={onClose} size="large" className="release-history-modal" footer={<><span className="release-history-source" role="status">{refreshing ? <><LoaderCircle size={14} className="release-history-spinner" aria-hidden="true"/>Оновлюємо історію…</> : snapshot?.refreshError && snapshot.entries.length ? 'Показано локальну історію; GitHub тимчасово недоступний.' : sourceLabel}</span><button type="button" className="secondary-button" onClick={onClose}>Закрити</button></>}>
    <div className="release-history-layout">
      <nav className="release-history-list" aria-label="Опубліковані стабільні версії">
        {snapshot?.entries.map(entry => {
          const installed = entry.version === currentVersion
          const selectedItem = entry.version === selectedVersion
          const date = formatPublishedDate(entry.publishedAt)
          return <button type="button" key={entry.version} className={`release-history-version${selectedItem ? ' is-selected' : ''}`} aria-current={selectedItem ? 'true' : undefined} onClick={() => { selectionChanged.current = true; setSelectedVersion(entry.version) }}>
            <span className="release-history-version-heading"><strong>{entry.version}</strong>{installed && <span className="release-history-installed"><Check size={12} aria-hidden="true"/>Встановлено</span>}</span>
            {date && <span className="release-history-date"><CalendarDays size={13} aria-hidden="true"/>{date}</span>}
          </button>
        })}
        {!snapshot?.entries.length && <p className="release-history-empty">{refreshing ? 'Завантажуємо доступну історію…' : loadError || 'Опубліковану історію релізів поки не знайдено.'}</p>}
      </nav>
      <div className="release-history-content" ref={contentRef} aria-live="polite">
        {selected ? <>
          <header className="release-history-entry-heading"><div><h3>{selected.name || `HromadaAID ${selected.version}`}</h3>{formatPublishedDate(selected.publishedAt) && <span className="release-history-entry-date"><CalendarDays size={14} aria-hidden="true"/>{formatPublishedDate(selected.publishedAt)}</span>}</div>{selected.version === currentVersion && <span className="release-history-installed"><Check size={13} aria-hidden="true"/>Встановлено</span>}</header>
          {selected.body ? <ReleaseNotes notes={withoutDuplicateTitle(selected.body, selected.name, selected.version)} heading=""/> : <p className="release-history-empty">Для цієї версії опублікований опис відсутній.</p>}
        </> : <div className="release-history-empty release-history-content-empty">Виберіть версію, щоб переглянути опис змін.</div>}
      </div>
    </div>
  </Modal>
}
