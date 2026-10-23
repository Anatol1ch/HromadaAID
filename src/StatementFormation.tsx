import SearchField from './components/SearchField'
import DataState from './components/DataState'
import { TableSkeleton } from './components/Skeleton'
import Alert from './components/Alert'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Files, FileSpreadsheet, FileText, Landmark, LoaderCircle, Minus, Printer, X } from 'lucide-react'
import type { GeneratedStatement, GeneratedBankStatement, StatementKind, StatementParameters, AssignmentRecord } from '../electron/api-contract'
import Modal from './components/Modal'
import StatementParametersModal from './components/StatementParametersModal'
import { statementPlan, type StatementPlan } from '../electron/statement-parameters'
import { assignmentStatusColor } from '../electron/assignment-model'
import { useReportingYear } from './context/YearContext'
import { formatDate } from './lib/dates'
import { connectionRestoredEvent } from './services/connectionRefresh'

const money = (minor: number) => `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ₴`
function pdfUrl(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

export default function StatementFormation() {
  const { year } = useReportingYear()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)
  const [error, setError] = useState('')
  const [exportNotice, setExportNotice] = useState('')
  const [parameterRequest, setParameterRequest] = useState<{ kind: StatementKind; ids: string[]; plan: StatementPlan[] } | null>(null)
  const [statementKind, setStatementKind] = useState<StatementKind | null>(null)
  const [bankDocument, setBankDocument] = useState<GeneratedBankStatement | null>(null)
  const [documents, setDocuments] = useState<GeneratedStatement[]>([])
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({})
  const [activeDocumentId, setActiveDocumentId] = useState('')
  const [activeGenerator, setActiveGenerator] = useState<StatementKind | 'bank' | null>(null)
  const generationInProgress = useRef(false)
  const generating = activeGenerator !== null
  const [savingId, setSavingId] = useState('')
  const exportInProgress = useRef(false)
  const exporting = savingId !== ''
  const operationBusy = generating || exporting
  const [savingFormat, setSavingFormat] = useState<'xlsx' | 'pdf' | ''>('')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let mounted = true
    let sequence = 0
    const load = () => {
      const request = ++sequence
      setLoading(true); setLoadError('')
      window.hromadaAid.statements.list(year).then((result) => {
        if (!mounted || request !== sequence) return
        setAssignments(result.assignments)
        const availableIds = new Set(result.assignments.map((row) => row.id))
        setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))))
      }).catch(() => { if (mounted && request === sequence) setLoadError('Не вдалося завантажити призначення із сервера.') })
        .finally(() => { if (mounted && request === sequence) setLoading(false) })
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener(connectionRestoredEvent, load)
    return () => { mounted = false; window.removeEventListener('focus', load); window.removeEventListener(connectionRestoredEvent, load) }
  }, [year, loadRevision])

  useEffect(() => { setSelectedIds(new Set()) }, [year])

  useEffect(() => () => { Object.values(pdfUrls).forEach((url) => URL.revokeObjectURL(url)) }, [pdfUrls])

  const visible = useMemo(() => assignments.filter((row) => row.recipientName.toLocaleLowerCase('uk').includes(search.trim().toLocaleLowerCase('uk'))), [assignments, search])
  const selected = assignments.filter((row) => selectedIds.has(row.id))
  const selectedTotalMinor = selected.reduce((sum, row) => sum + row.amountMinor, 0)
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selectedIds.has(row.id))

  const toggleVisible = () => setSelectedIds((current) => {
    const next = new Set(current)
    if (allVisibleSelected) visible.forEach((row) => next.delete(row.id))
    else visible.forEach((row) => next.add(row.id))
    return next
  })
  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const openParameters = (kind: StatementKind) => {
    if (generationInProgress.current || exportInProgress.current) return
    setError('')
    setParameterRequest({ kind, ids: selected.map(row => row.id), plan: statementPlan(kind, selected) })
  }
  const generate = async (kind: StatementKind, ids: string[], parameters: StatementParameters[]) => {
    if (generationInProgress.current || exportInProgress.current) return
    generationInProgress.current = true
    setActiveGenerator(kind); setError(''); setExportNotice('')
    try {
      const result = await window.hromadaAid.statements.generate(kind, ids, year, parameters)
      if (!result.ok) { setError(result.message); return }
      Object.values(pdfUrls).forEach((url) => URL.revokeObjectURL(url))
      const nextUrls = Object.fromEntries(result.documents.map((document) => [document.id, pdfUrl(document.pdfBase64)]))
      setDocuments(result.documents); setPdfUrls(nextUrls); setActiveDocumentId(result.documents[0]?.id ?? ''); setStatementKind(kind); setParameterRequest(null)
    } catch { setError('Не вдалося отримати результат формування від Electron. Повторіть спробу.') }
    finally { generationInProgress.current = false; setActiveGenerator(null) }
  }
  const generateBank = async (ids: string[]) => {
    if (generationInProgress.current || exportInProgress.current) return
    generationInProgress.current = true
    setActiveGenerator('bank'); setError(''); setExportNotice('')
    try {
      const result = await window.hromadaAid.statements.generateBank(ids, year)
      if (!result.ok) { setError(result.message); return }
      setBankDocument(result.document); setParameterRequest(null)
    } catch { setError('Не вдалося сформувати банківську відомість. Повторіть спробу.') }
    finally { generationInProgress.current = false; setActiveGenerator(null) }
  }
  const saveDocument = async (document: Pick<GeneratedStatement, 'id'>, format: 'xlsx' | 'pdf') => {
    if (generationInProgress.current || exportInProgress.current) return
    exportInProgress.current = true
    setSavingId(document.id); setSavingFormat(format); setError(''); setExportNotice('')
    try {
      const result = format === 'pdf' ? await window.hromadaAid.statements.savePdf(document.id) : await window.hromadaAid.statements.save(document.id)
      if (result.ok) setExportNotice(format === 'pdf' ? 'PDF-файл збережено.' : 'Excel-файл збережено.')
      if (!result.ok && result.message !== 'Збереження скасовано.') setError(result.message ?? `Не вдалося зберегти ${format.toUpperCase()}-файл.`)
    } catch { setError(`Не вдалося зберегти ${format.toUpperCase()}-файл.`) }
    finally { exportInProgress.current = false; setSavingId(''); setSavingFormat('') }
  }
  const activeDocument = documents.find((document) => document.id === activeDocumentId)

  return <>
    <section className="page-heading formation-heading"><div><div className="eyebrow">ДОКУМЕНТИ • ЗАПИСИ ЛОКАЛЬНОЇ БАЗИ</div><h1>Формування відомостей</h1><p className="subtitle">Позначте допомоги за {year} рік. Кожне призначення — окремий запис, навіть коли отримувач повторюється.</p></div></section>
    {error && !parameterRequest && !statementKind && !bankDocument && <Alert variant="error" className="ui-alert-preserve-lines">{error}</Alert>}
    <section className="dashboard-panel formation-panel" aria-label="Вибір призначень для документів">
      <div className="panel-heading formation-panel-heading"><div><h2>Призначення за {year} рік</h2><p>Доступні статуси: «Призначено», «В роботі», «Передано до казначейства». Рік визначається за рішенням.</p></div></div>
      <SearchField className="formation-search" value={search} onChange={setSearch} disabled={operationBusy} placeholder="Пошук за ПІБ отримувача" label="Пошук призначень за ПІБ"/>
      <div className="selection-toolbar"><label className="selection-all"><StatementCheckbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && visible.some((row) => selectedIds.has(row.id))} onChange={toggleVisible} disabled={!visible.length || operationBusy || loading || Boolean(loadError)} label="Вибрати всі видимі записи"/>Вибрати всі видимі записи</label><button type="button" className="selection-link muted" onClick={() => setSelectedIds(new Set())} disabled={!selected.length || operationBusy || loading || Boolean(loadError)}><X size={14} aria-hidden="true"/>Скасувати вибір</button><div className="formation-counters" aria-live="polite"><span>Доступно <strong>{loading ? '…' : loadError ? '—' : visible.length}</strong></span></div></div>
      {loading && !assignments.length ? <TableSkeleton columns={6} label="Завантажуємо призначення…"/> : loadError ? <Alert variant="error" action={<button type="button" onClick={() => setLoadRevision(value => value + 1)}>Повторити завантаження</button>}>{loadError}</Alert> : <div className="recipient-list assignment-statement-list" role="region" aria-label="Доступні призначення" tabIndex={visible.length ? 0 : undefined} aria-busy={loading || undefined}><div className="formation-list-heading"><span className="formation-check-heading">Вибір</span><span className="formation-column-name">Отримувач</span><span className="formation-column-decision">Рішення виконкому</span><span className="formation-column-aid">Вид допомоги</span><span className="formation-column-status">Статус</span><span className="formation-column-amount">Сума</span></div>{visible.map((row) => {
        const checked = selectedIds.has(row.id)
        return <label className={`recipient-option ${checked ? 'selected' : ''}`} key={row.id}>
          <StatementCheckbox disabled={operationBusy} checked={checked} onChange={() => toggle(row.id)} label={`Вибрати призначення: ${row.recipientName}, рішення № ${row.decisionNumber}`}/>
          <strong className="formation-recipient-name">{row.recipientName}</strong>
          <span className="formation-decision" title={`Рішення № ${row.decisionNumber} від ${formatDate(row.decisionDate)}`}>№ {row.decisionNumber} · {formatDate(row.decisionDate)}</span>
          <span className="formation-aid-name" title={row.aidTypeName}>{row.aidTypeName}</span>
          <span className={`formation-row-status status-badge status-${assignmentStatusColor[row.status]}`}>{row.status}</span>
          <span className="recipient-option-total">{money(row.amountMinor)}</span>
        </label>
      })}{!visible.length && <DataState kind={assignments.length ? "search" : "empty"} message={assignments.length ? 'За заданими параметрами нічого не знайдено' : `За ${year} рік немає доступних призначень`} description={assignments.length ? 'Змініть або очистіть пошуковий запит.' : 'Призначення з доступними статусами з’являться тут для формування документів.'}/>}</div>}
      <div className="formation-actions">
        <div className="formation-selection-info" role="status"><div><span>Вибрано призначень</span><strong>{selected.length}</strong></div><div><span>Загальна сума вибраних</span><strong>{money(selectedTotalMinor)}</strong></div></div>
        <div className="statement-actions" aria-label="Формування документів" aria-busy={operationBusy}>
          <button type="button" className="primary-button" onClick={() => openParameters('personal')} disabled={!selected.length || operationBusy || loading || Boolean(loadError)} aria-busy={activeGenerator === 'personal'}>{activeGenerator === 'personal' ? <LoaderCircle className="formation-spinner" size={19} aria-hidden="true"/> : <FileText size={19} aria-hidden="true"/>}<span>{activeGenerator === 'personal' ? 'Формуємо…' : 'Сформувати персональні відомості'}</span></button>
          <button type="button" className="primary-button" onClick={() => openParameters('summary')} disabled={!selected.length || operationBusy || loading || Boolean(loadError)} aria-busy={activeGenerator === 'summary'}>{activeGenerator === 'summary' ? <LoaderCircle className="formation-spinner" size={19} aria-hidden="true"/> : <Files size={19} aria-hidden="true"/>}<span>{activeGenerator === 'summary' ? 'Формуємо…' : 'Сформувати зведені відомості'}</span></button>
          <button type="button" className="primary-button" onClick={() => void generateBank(selected.map(row => row.id))} disabled={!selected.length || operationBusy || loading || Boolean(loadError)} aria-busy={activeGenerator === 'bank'}>{activeGenerator === 'bank' ? <LoaderCircle className="formation-spinner" size={19} aria-hidden="true"/> : <Landmark size={19} aria-hidden="true"/>}<span>{activeGenerator === 'bank' ? 'Формуємо…' : 'Сформувати відомість для ПриватБанку'}</span></button>
        </div>
      </div>
    </section>
    {parameterRequest && <StatementParametersModal kind={parameterRequest.kind} plan={parameterRequest.plan} busy={generating} error={error} onClose={() => { if (!generationInProgress.current) { setParameterRequest(null); setError('') } }} onGenerate={parameters => void generate(parameterRequest.kind, parameterRequest.ids, parameters)}/>}
    {statementKind && <Modal title={statementKind === 'personal' ? 'Персональні відомості' : 'Зведені відомості'} description={`${documents.length} документів · Перегляд і збереження`} className="statement-result-modal document-preview-modal" headerIcon={<FileText size={21} aria-hidden="true"/>} busy={exporting} onClose={() => { if (!exportInProgress.current) setStatementKind(null) }} size="large">
      {exportNotice && <Alert variant="success">{exportNotice}</Alert>}
      {documents.length > 1 && <nav className="statement-document-list" aria-label="Сформовані документи">{documents.map((document) => <button type="button" disabled={exporting} aria-pressed={document.id === activeDocumentId} className={document.id === activeDocumentId ? 'active' : ''} key={document.id} onClick={() => setActiveDocumentId(document.id)}>{document.aidTypeName}<small>№ {document.documentNumber} · {formatDate(document.documentDate)}</small><small>{document.recordCount} записів • {money(document.totalMinor)}</small></button>)}</nav>}
      {activeDocument && <><div className="statement-preview-toolbar"><strong title={activeDocument.fileName}>{activeDocument.aidTypeName} · № {activeDocument.documentNumber}</strong><span>{activeDocument.recordCount} записів • {money(activeDocument.totalMinor)}</span><div className="document-preview-actions" aria-label="Дії зі сформованою відомістю" aria-busy={exporting}><button type="button" className="secondary-button document-preview-action" disabled={operationBusy} onClick={() => { if (!exportInProgress.current) iframeRef.current?.contentWindow?.print() }}><Printer size={17} aria-hidden="true"/>Друк</button><button type="button" className="secondary-button document-preview-action" disabled={operationBusy} onClick={() => void saveDocument(activeDocument, 'xlsx')}><FileSpreadsheet size={17} aria-hidden="true"/>{savingId === activeDocument.id && savingFormat === 'xlsx' ? 'Зберігаємо…' : 'Зберегти Excel'}</button><button type="button" className="secondary-button document-preview-action" disabled={operationBusy} onClick={() => void saveDocument(activeDocument, 'pdf')}><FileText size={17} aria-hidden="true"/>{savingId === activeDocument.id && savingFormat === 'pdf' ? 'Зберігаємо…' : 'Зберегти PDF'}</button></div></div>
        <iframe ref={iframeRef} className="statement-pdf-preview" title={`Попередній перегляд ${activeDocument.fileName}`} src={`${pdfUrls[activeDocument.id]}#toolbar=1&navpanes=0&zoom=page-width`}/>
      </>}

      {error && <Alert variant="error" className="ui-alert-preserve-lines">{error}</Alert>}
    </Modal>}
    {bankDocument && <Modal title="ПриватБанк" className="statement-result-modal" headerIcon={<Landmark size={21}/>} description="Банківська відомість за вибраними призначеннями" busy={exporting} onClose={() => { if (!exportInProgress.current) setBankDocument(null) }}>
      {exportNotice && <Alert variant="success">{exportNotice}</Alert>}
      <div className="statement-preview-toolbar"><strong title={bankDocument.fileName}>Банківська відомість · ПриватБанк</strong><span>{bankDocument.recordCount} записів • {money(bankDocument.totalMinor)}</span><div><button type="button" className="primary-button" disabled={operationBusy} onClick={() => void saveDocument(bankDocument, 'xlsx')}><Download size={16}/>{savingId === bankDocument.id ? 'Зберігаємо…' : 'Зберегти Excel'}</button></div></div>
      {error && <Alert variant="error" className="ui-alert-preserve-lines">{error}</Alert>}
    </Modal>}
  </>
}

function StatementCheckbox({ checked, indeterminate = false, disabled = false, label, onChange }: { checked: boolean; indeterminate?: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current) input.current.indeterminate = indeterminate }, [indeterminate])
  return <span className="formation-checkbox"><input ref={input} type="checkbox" checked={checked} disabled={disabled} aria-label={label} aria-checked={indeterminate ? 'mixed' : checked} onChange={onChange}/><span className="custom-checkbox" aria-hidden="true">{indeterminate ? <Minus size={14}/> : checked ? <Check size={14}/> : null}</span></span>
}
