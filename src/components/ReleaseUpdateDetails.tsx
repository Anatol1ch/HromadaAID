import type { ReactNode } from 'react'

function inline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|(?<!\*)\*[^*]+\*|(?<!_)_[^_]+_|\[[^\]]+\]\([^)]+\))/g
  const output: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const value = match[0], index = match.index ?? 0
    if (index > cursor) output.push(text.slice(cursor, index))
    if (value.startsWith('**') || value.startsWith('__')) output.push(<strong key={`${keyPrefix}-${index}`}>{value.slice(2, -2)}</strong>)
    else if (value.startsWith('`')) output.push(<code key={`${keyPrefix}-${index}`}>{value.slice(1, -1)}</code>)
    else if (value.startsWith('*') || value.startsWith('_')) output.push(<em key={`${keyPrefix}-${index}`}>{value.slice(1, -1)}</em>)
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value)
      output.push(link ? <span key={`${keyPrefix}-${index}`} title={link[2]}>{link[1]}</span> : value)
    }
    cursor = index + value.length
  }
  if (cursor < text.length) output.push(text.slice(cursor))
  return output
}

export function ReleaseUpdateDetails({ currentVersion, targetVersion, notes }: { currentVersion: string; targetVersion: string; notes?: string }) {
  return <>
    <div className="release-version-summary" aria-label="Порівняння версій">
      <div><span>Поточна версія</span><strong>{currentVersion}</strong></div>
      <span className="release-version-arrow" aria-hidden="true">→</span>
      <div><span>Нова версія</span><strong>{targetVersion}</strong></div>
    </div>
    <ReleaseNotes notes={notes} />
  </>
}

export function ReleaseNotes({ notes }: { notes?: string }) {
  const source = notes?.replace(/\r/g, '') || 'Опис змін для цього випуску не надано.'
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join(' '), `p-${blocks.length}`)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inline(item, `li-${blocks.length}-${index}`)}</li>)}</ul>)
    list = []
  }
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line.trim())
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph(); flushList()
      blocks.push(<h3 key={`h-${blocks.length}`}>{inline(heading[2], `h-${blocks.length}`)}</h3>)
    } else if (bullet || ordered) {
      flushParagraph()
      list.push((bullet ?? ordered)![1])
    } else if (!line.trim() || /^\s*[-*_]{3,}\s*$/.test(line)) {
      flushParagraph(); flushList()
    } else {
      flushList(); paragraph.push(line.trim())
    }
  }
  flushParagraph(); flushList()
  return <section className="release-notes-section" aria-label="Опис змін">
    <h3>Що змінилося</h3>
    <div className="release-notes" tabIndex={0}>{blocks}</div>
  </section>
}

export function ReleaseUpdateProgress({ label, receivedBytes, totalBytes, indeterminate = false }: { label: string; receivedBytes?: number; totalBytes?: number; indeterminate?: boolean }) {
  const received = Math.max(0, receivedBytes ?? 0)
  const total = Math.max(0, totalBytes ?? 0)
  const percent = total ? Math.min(100, Math.floor(received / total * 100)) : null
  const format = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return <div className="release-update-progress" role="status" aria-live="polite">
    <div><span>{label}</span>{!indeterminate && total > 0 && <strong>{percent}%</strong>}</div>
    <progress aria-label={label} max={total || undefined} value={indeterminate || !total ? undefined : Math.min(received, total)} />
    {!indeterminate && total > 0 && <small>{format(received)} з {format(total)}</small>}
  </div>
}
