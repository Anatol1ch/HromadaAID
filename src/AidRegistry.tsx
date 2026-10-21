import SearchField from './components/SearchField'
import DataState from './components/DataState'
import { TableSkeleton } from './components/Skeleton'
import Alert from './components/Alert'
import { useCatalogUpdates } from './services/catalogRepository'
import { ASSIGNMENT_STATUSES, assignmentStatusColor, assignmentStatusOrder as statusOrder, isAssignedStatus } from '../electron/assignment-model'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, FilterX, ListRestart, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { AssignmentInput, AssignmentRecord, AssignmentStatus, DecisionSummary, DeletePreview, RecipientRecord, RecipientSummary } from '../electron/api-contract'
import Modal from './components/Modal'
import { confirmModalClose } from './components/Modal'
import { focusFirstInvalid } from './lib/keyboardNavigation'
import { assignmentRepository } from './services/assignmentRepository'
import { recipientRepository } from './services/recipientRepository'
import { RecipientFormModal, recipientInputFromRecord } from './RecipientRegistry'
import DecisionFormModal from './components/DecisionFormModal'
import Select from './components/Select'
import { paymentYearError } from '../electron/accounting-year'
import DateField from './components/DateField'
import ValidatedInput from './components/ValidatedInput'
import { formatDate, formatDateInput, parseDateInput, todayIsoDate } from './lib/dates'
import { useReportingYear } from './context/YearContext'
import DeleteConfirmation from './components/DeleteConfirmation'
import BatchAssignmentStatusModal from './components/BatchAssignmentStatusModal'
import { eligibleAssignmentIds, keepEligibleSelection, selectionForYear, selectionState, toggleEligibleSelection } from './lib/assignmentSelection'

type Catalogs = Awaited<ReturnType<typeof assignmentRepository.catalogs>>
type Draft = { recipientId: string; recipientSearch: string; decisionId: string; decisionNumber: string; decisionDate: string; programId: string; aidTypeId: string; amount: string; status: AssignmentStatus; paidOn: string }
type SortKey = 'createdAt' | 'decision' | 'programName' | 'aidTypeName' | 'recipientName' | 'sex' | 'amountMinor' | 'vpo' | 'status'
type SortState = { key: SortKey; direction: 'asc' | 'desc' }
const defaultSort: SortState = { key: 'createdAt', direction: 'desc' }
type RegistryFilters = { programId: string; aidTypeId: string; decisionId: string; status: string; sex: string; vpo: string }
const emptyFilters = (): RegistryFilters => ({ programId: '', aidTypeId: '', decisionId: '', status: '', sex: '', vpo: '' })
const blank = (): Draft => ({ recipientId: '', recipientSearch: '', decisionId: '', decisionNumber: '', decisionDate: '', programId: '', aidTypeId: '', amount: '', status: 'Призначено', paidOn: '' })
const money = (minor: number) => `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ₴`
const tableColumns: { key: SortKey; label: string }[] = [
  { key: 'createdAt', label: '№' },
  { key: 'decision', label: 'Рішення' },
  { key: 'programName', label: 'Програма' },
  { key: 'aidTypeName', label: 'Вид допомоги' },
  { key: 'recipientName', label: 'ПІБ' },
  { key: 'sex', label: 'Стать' },
  { key: 'amountMinor', label: 'Розмір, грн' },
  { key: 'vpo', label: 'ВПО' },
  { key: 'status', label: 'Статус' },
]

export default function AidRegistry({ createOnOpen = false }: { createOnOpen?: boolean }) {
  const { year, setYear } = useReportingYear()
  const [rows, setRows] = useState<AssignmentRecord[]>([])
  const [recipients, setRecipients] = useState<RecipientSummary[]>([])
  const [decisions, setDecisions] = useState<DecisionSummary[]>([])
  const [catalogs, setCatalogs] = useState<Catalogs>({ programs: [], aidTypes: [], programOrderRevision: '', aidTypeOrderRevisions: {} })
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<RegistryFilters>(emptyFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersPanelId = useId()
  const activeFilterCount = Object.values(filters).filter(Boolean).length
  const [sort, setSort] = useState<SortState>(defaultSort)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPersonForm, setShowPersonForm] = useState(false)
  const [recipientEditor, setRecipientEditor] = useState<RecipientRecord | null>(null)
  const [recipientEditorLoading, setRecipientEditorLoading] = useState(false)
  const initialDraft = useRef('')
  const assignmentFormRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const saveAndContinueRef = useRef(false)
  const refreshSequence = useRef(0)
  const [showDecisionForm, setShowDecisionForm] = useState(false)
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [selection, setSelection] = useState<{ year: number; ids: Set<string> }>(() => ({ year, ids: new Set() }))
  const [batchIds, setBatchIds] = useState<string[] | null>(null)
  const [batchNotice, setBatchNotice] = useState('')
  const paidSelectionReasonId = useId()
  useEffect(() => { setSelection({ year, ids: new Set() }); setBatchIds(null); setBatchNotice('') }, [year])

  const refresh = async (selectedYear = year) => {
    const sequence = ++refreshSequence.current
    setLoading(true); setLoadError(''); setError('')
    try {
      const [list, people, decisionsList, catalogData] = await Promise.all([
        assignmentRepository.list(selectedYear), assignmentRepository.recipients(), assignmentRepository.decisions(), window.hromadaAid.catalogs.list(true),
      ])
      if (sequence !== refreshSequence.current) return
      setRows(list.assignments)
      setRecipients(people); setDecisions(decisionsList); setCatalogs(catalogData)
    } catch { if (sequence === refreshSequence.current) setLoadError('Не вдалося завантажити реєстр допомог із локального сховища.') }
    finally { if (sequence === refreshSequence.current) setLoading(false) }
  }
  useEffect(() => { void refresh(year) }, [year])

  useCatalogUpdates(() => {
    void window.hromadaAid.catalogs.list(true).then(setCatalogs).catch(() => setError('Не вдалося оновити довідники.'))
  })

  const filterDecisions = useMemo(() => decisions.filter((decision) => Number(decision.decisionDate.slice(0, 4)) === year), [decisions, year])
  useEffect(() => {
    setFilters((current) => !current.decisionId || filterDecisions.some((decision) => decision.id === current.decisionId)
      ? current : { ...current, decisionId: '' })
  }, [filterDecisions])
  useEffect(() => {
    setFilters(current => {
      if (current.programId && !catalogs.programs.some(item => item.id === current.programId)) return { ...current, programId: '', aidTypeId: '' }
      if (current.aidTypeId && !catalogs.aidTypes.some(item => item.id === current.aidTypeId && (!current.programId || item.programId === current.programId))) return { ...current, aidTypeId: '' }
      return current
    })
  }, [catalogs])
  const filterProgramName = catalogs.programs.find((item) => item.id === filters.programId)?.shortName ?? ''
  const filterAidTypeName = catalogs.aidTypes.find((item) => item.id === filters.aidTypeId)?.shortName ?? ''
  const filterDecision = filterDecisions.find((item) => item.id === filters.decisionId)
  const filterDecisionName = filterDecision ? `№ ${filterDecision.decisionNumber} від ${formatDate(filterDecision.decisionDate)}` : ''

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('uk')
    const filtered = rows.filter((row) => {
      if (query && !row.recipientName.toLocaleLowerCase('uk').includes(query)) return false
      if (filters.programId && row.programId !== filters.programId) return false
      if (filters.aidTypeId && row.aidTypeId !== filters.aidTypeId) return false
      if (filters.decisionId && row.decisionId !== filters.decisionId) return false
      if (filters.status && row.status !== filters.status) return false
      if (filters.sex && row.recipientSex !== filters.sex) return false
      if (filters.vpo === 'yes' && row.recipientIsVpo !== true) return false
      if (filters.vpo === 'no' && row.recipientIsVpo !== false) return false
      return true
    })
    const collator = new Intl.Collator('uk', { numeric: true, sensitivity: 'base' })
    const compare = (left: AssignmentRecord, right: AssignmentRecord) => {
      let result = 0
      switch (sort.key) {
        case 'createdAt': result = (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0); break
        case 'decision': result = left.decisionDate.localeCompare(right.decisionDate) || collator.compare(left.decisionNumber, right.decisionNumber); break
        case 'programName': result = collator.compare(left.programName, right.programName); break
        case 'aidTypeName': result = collator.compare(left.aidTypeName, right.aidTypeName); break
        case 'recipientName': result = collator.compare(left.recipientName, right.recipientName); break
        case 'sex': result = collator.compare(left.recipientSex ?? '', right.recipientSex ?? ''); break
        case 'amountMinor': result = left.amountMinor - right.amountMinor; break
        case 'vpo': result = Number(left.recipientIsVpo === true) - Number(right.recipientIsVpo === true); break
        case 'status': result = statusOrder[left.status] - statusOrder[right.status]; break
      }
      if (result === 0) result = left.id.localeCompare(right.id)
      return sort.direction === 'asc' ? result : -result
    }
    return filtered.sort(compare)
  }, [rows, search, filters, sort])
  const assignedTotalMinor = useMemo(() => visible.reduce((sum, row) => sum + (isAssignedStatus(row.status) ? row.amountMinor : 0), 0), [visible])
  const assignedCount = visible.filter((row) => isAssignedStatus(row.status)).length
  const eligibleIds = useMemo(() => eligibleAssignmentIds(visible), [visible])
  const selectedIds = useMemo(() => selectionForYear(selection, year, eligibleIds), [selection, year, eligibleIds])
  const headerSelection = selectionState(eligibleIds, selectedIds)
  useEffect(() => {
    setSelection((current) => {
      if (current.year !== year) return { year, ids: new Set() }
      const ids = keepEligibleSelection(current.ids, eligibleIds)
      return ids.size === current.ids.size ? current : { year, ids }
    })
  }, [year, eligibleIds])
  const toggleAssignment = (id: string) => setSelection((current) => {
    const ids = keepEligibleSelection(current.year === year ? current.ids : new Set(), eligibleIds)
    if (!eligibleIds.includes(id)) return current
    if (ids.has(id)) ids.delete(id); else ids.add(id)
    return { year, ids }
  })


  const sortBy = (key: SortKey) => setSort((current) => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' })
  const sortHeader = (label: string, key: SortKey) => <button type="button" className="registry-sort-button" title={key === 'createdAt' ? 'Сортувати за точним часом створення' : `Сортувати: ${label}`} onClick={() => sortBy(key)}><span className="registry-sort-label">{label}</span><span aria-hidden="true">{sort.key === key ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>

  const startCreate = () => { const initial = blank(); initialDraft.current = JSON.stringify(initial); setDraft(initial); setEditingId(undefined); setError(''); saveAndContinueRef.current = false }
  useEffect(() => { if (createOnOpen) startCreate() }, [createOnOpen])
  const startEdit = (row: AssignmentRecord) => {
    const initial = { recipientId: row.recipientId, recipientSearch: row.recipientName, decisionId: row.decisionId, decisionNumber: row.decisionNumber, decisionDate: row.decisionDate, programId: row.programId, aidTypeId: row.aidTypeId, amount: (row.amountMinor / 100).toFixed(2), status: row.status, paidOn: row.status === 'Виплачено' ? row.paidOn ?? '' : '' }
    initialDraft.current = JSON.stringify(initial)
    setDraft(initial)
    setEditingId(row.id); setError(''); saveAndContinueRef.current = false
  }
  const requestDelete = async (row: AssignmentRecord) => {
    try { const preview = await window.hromadaAid.deletion.preview('assignment', row.id); if (preview) setDeletePreview(preview); else setError('Призначення не знайдено. Оновіть список.') }
    catch { setError('Не вдалося перевірити залежні дані призначення.') }
  }
  const close = () => { setDraft(null); setEditingId(undefined); setError(''); setShowPersonForm(false); setRecipientEditor(null); setShowDecisionForm(false); saveAndContinueRef.current = false }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || savingRef.current) return
    if (!draft.recipientId) { setError('Знайдіть отримувача та виберіть картку або створіть нового отримувача.'); saveAndContinueRef.current = false; return }
    if (!formDecisions.some((decision) => decision.id === draft.decisionId)) { setError('Оберіть рішення за поточний робочий рік.'); saveAndContinueRef.current = false; return }
    if (!recipients.some((person) => person.id === draft.recipientId)) { setError('Обрана картка отримувача недоступна. Оновіть дані.'); saveAndContinueRef.current = false; return }
    if (!programs.some((program) => program.id === draft.programId) || !formAidTypes.some((type) => type.id === draft.aidTypeId)) { setError('Оберіть доступну програму та відповідний вид допомоги.'); saveAndContinueRef.current = false; return }
    const normalized = draft.amount.trim().replace(',', '.')
    if (!/^\d+(\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) { setError('Вкажіть додатну суму з точністю до копійок.'); saveAndContinueRef.current = false; focusFirstInvalid(event.currentTarget, 'input[inputmode="decimal"]'); return }
    if (draft.status === 'Виплачено' && !parseDateInput(formatDateInput(draft.paidOn))) { setError('Вкажіть коректну дату фактичної виплати.'); saveAndContinueRef.current = false; return }
    if (draft.status === 'Виплачено') { const message = paymentYearError(draft.paidOn, draft.decisionDate); if (message) { setError(message); saveAndContinueRef.current = false; return } }
    const input: AssignmentInput = { recipientId: draft.recipientId, decisionId: draft.decisionId || undefined, decisionNumber: draft.decisionNumber, decisionDate: draft.decisionDate, aidTypeId: draft.aidTypeId, amountMinor: Math.round(Number(normalized) * 100), status: draft.status, paidOn: draft.paidOn }
    savingRef.current = true; setSaving(true); setError('')
    try {
      const result = await assignmentRepository.save(input, editingId)
      if (!result.ok) { setError(result.message); saveAndContinueRef.current = false; return }
      if (saveAndContinueRef.current && !editingId) {
        const next = { ...blank(), decisionId: draft.decisionId, decisionNumber: draft.decisionNumber, decisionDate: draft.decisionDate }
        initialDraft.current = JSON.stringify(next); setDraft(next); setError(''); saveAndContinueRef.current = false
      } else { setDraft(null); setEditingId(undefined); saveAndContinueRef.current = false }
      const savedYear = Number(result.assignment.decisionDate.slice(0, 4))
      if (Number.isInteger(savedYear) && savedYear !== year) setYear(savedYear)
      await refresh(savedYear)
    } catch { setError('Не вдалося зберегти призначення. Дані у формі залишилися.'); saveAndContinueRef.current = false }
    finally { savingRef.current = false; setSaving(false) }
  }

  const update = (patch: Partial<Draft>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const openRecipientEditor = async () => {
    const recipientId = draft?.recipientId
    if (!recipientId || saving || recipientEditorLoading) return
    setRecipientEditorLoading(true)
    try {
      const recipient = await recipientRepository.get(recipientId)
      if (!recipient) { setError('Картку отримувача не знайдено. Оновіть список.'); return }
      setRecipientEditor(recipient)
    } catch {
      setError('Не вдалося відкрити картку отримувача. Спробуйте ще раз.')
    } finally {
      setRecipientEditorLoading(false)
    }
  }
  const selectedAidType = catalogs.aidTypes.find((type) => type.id === draft?.aidTypeId)
  const programs = catalogs.programs.filter((program) => program.isActive || (editingId && program.id === selectedAidType?.programId))
  const formAidTypes = catalogs.aidTypes.filter((type) => type.programId === draft?.programId && (type.isActive || (editingId && type.id === draft?.aidTypeId)))
  const formDecisions = decisions.filter((decision) => Number(decision.decisionDate.slice(0, 4)) === year)

  return <>
    <section className="page-heading registry-heading"><div><div className="eyebrow">ЩОДЕННИЙ ОБЛІК • БАЗА ДАНИХ</div><h1>Реєстр допомог</h1><p className="subtitle">Кожен рядок — окреме призначення отримувачу за рішенням виконкому.</p></div></section>
    {error && !draft && <Alert variant="error" action={<button onClick={() => void refresh()}>Оновити</button>}>{error}</Alert>}
    <section className="dashboard-panel registry-panel aid-registry-panel">
      <div className="aid-toolbar">
        <SearchField value={search} onChange={setSearch} label="Пошук за ПІБ" placeholder="Пошук за ПІБ отримувача"/>
        <button type="button" className={`secondary-button aid-filter-toggle${filtersOpen ? ' expanded' : ''}`} aria-expanded={filtersOpen} aria-controls={filtersPanelId} onClick={() => setFiltersOpen((current) => !current)}><SlidersHorizontal size={18} aria-hidden="true"/>Фільтри{activeFilterCount > 0 && <span className="aid-filter-count" aria-label={`Застосовано фільтрів: ${activeFilterCount}`}>{activeFilterCount}</span>}</button>
        <button type="button" className="secondary-button aid-filter-reset" aria-label="Очистити пошук і всі фільтри" onClick={() => { setSearch(''); setFilters(emptyFilters()) }} disabled={!search && !activeFilterCount}><FilterX size={18} aria-hidden="true"/>Очистити фільтри</button>
        <button type="button" className="secondary-button aid-sort-reset" title="Скинути сортування" aria-label="Скинути сортування" onClick={() => setSort(defaultSort)} disabled={sort.key === defaultSort.key && sort.direction === defaultSort.direction}><ListRestart size={18} aria-hidden="true"/>Скинути сортування</button>
        <button className="primary-button" onClick={startCreate}><Plus size={19}/>Додати призначення</button>
      </div>
      <div id={filtersPanelId} className="aid-filter-panel" hidden={!filtersOpen}><div className="aid-filter-grid">
        <label><span>Програма</span><Select label="Фільтр: програма" value={filters.programId} placeholder="Усі програми" options={[{ value: '', label: 'Усі програми' }, ...catalogs.programs.map((item) => ({ value: item.id, label: item.shortName }))]} onChange={(value) => setFilters((current) => ({ ...current, programId: value, aidTypeId: '' }))}/>{filterProgramName.length > 32 && <small className="aid-filter-value">{filterProgramName}</small>}</label>
        <label><span>Вид допомоги</span><Select label="Фільтр: вид допомоги" value={filters.aidTypeId} placeholder="Усі види" options={[{ value: '', label: 'Усі види' }, ...catalogs.aidTypes.filter((item) => !filters.programId || item.programId === filters.programId).map((item) => ({ value: item.id, label: item.shortName }))]} onChange={(value) => setFilters((current) => ({ ...current, aidTypeId: value }))}/>{filterAidTypeName.length > 32 && <small className="aid-filter-value">{filterAidTypeName}</small>}</label>
        <label><span>Номер рішення</span><Select label="Фільтр: номер рішення" value={filters.decisionId} placeholder="Усі рішення" options={[{ value: '', label: 'Усі рішення' }, ...filterDecisions.map((decision) => ({ value: decision.id, label: `№ ${decision.decisionNumber} від ${formatDate(decision.decisionDate)}` }))]} onChange={(value) => setFilters((current) => ({ ...current, decisionId: value }))}/>{filterDecisionName.length > 32 && <small className="aid-filter-value">{filterDecisionName}</small>}</label>
        <label><span>Статус</span><Select label="Фільтр: статус" value={filters.status} placeholder="Усі статуси" options={[{ value: '', label: 'Усі статуси' }, ...ASSIGNMENT_STATUSES.map((value) => ({ value, label: value }))]} onChange={(value) => setFilters((current) => ({ ...current, status: value }))}/></label>
        <label><span>Стать</span><Select label="Фільтр: стать" value={filters.sex} placeholder="Усі" options={[{ value: '', label: 'Усі' }, { value: 'Жінка', label: 'Жінка' }, { value: 'Чоловік', label: 'Чоловік' }]} onChange={(value) => setFilters((current) => ({ ...current, sex: value }))}/></label>
        <label><span>ВПО</span><Select label="Фільтр: ВПО" value={filters.vpo} placeholder="Усі" options={[{ value: '', label: 'Усі' }, { value: 'yes', label: 'Так' }, { value: 'no', label: 'Ні' }]} onChange={(value) => setFilters((current) => ({ ...current, vpo: value }))}/></label>
      </div></div>
      <span id={paidSelectionReasonId} className="visually-hidden">Виплачене призначення можна змінити лише індивідуально</span>
      {batchNotice && <Alert variant="success">{batchNotice}</Alert>}
      {!loading && !loadError && selectedIds.size > 0 && <div className="aid-batch-toolbar"><strong>Вибрано призначень: {selectedIds.size}</strong><div><button type="button" className="primary-button" onClick={() => setBatchIds([...selectedIds])}>Змінити статус</button><button type="button" className="secondary-button" onClick={() => setSelection({ year, ids: new Set() })}>Скасувати вибір</button></div></div>}
      {loading && !rows.length ? <TableSkeleton columns={11} label="Завантажуємо призначення…"/> : loadError ? <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити завантаження</button>}>{loadError}</Alert> : <div className="aid-table-wrap" role="region" aria-label="Таблиця реєстру допомог — горизонтальна прокрутка за потреби" tabIndex={0}><table className="aid-table" aria-label="Призначення матеріальної допомоги" aria-busy={loading || undefined}><colgroup><col className="aid-col-selection"/>{tableColumns.map(({ key }) => <col className={`aid-col-${key}`} key={key}/>)}<col className="aid-col-actions"/></colgroup><thead><tr><th scope="col" className="aid-selection-cell"><SelectAllAssignments checked={headerSelection.checked} indeterminate={headerSelection.indeterminate} disabled={!eligibleIds.length} onChange={() => setSelection({ year, ids: toggleEligibleSelection(eligibleIds, selectedIds) })}/></th>{tableColumns.map(({ key, label }) => <th scope="col" key={key} aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>{sortHeader(label, key)}</th>)}<th scope="col">Дії</th></tr></thead><tbody>{!visible.length && <tr><td colSpan={tableColumns.length + 2} className="aid-empty-cell"><DataState kind={rows.length ? "search" : "empty"} message={rows.length ? 'За заданими параметрами нічого не знайдено' : `За ${year} рік призначень немає`} description={rows.length ? 'Очистіть пошук або фільтри, щоб переглянути призначення.' : 'Створіть перше призначення, щоб розпочати облік'}/></td></tr>}{visible.map((row, index) => <tr key={row.id} className={selectedIds.has(row.id) ? 'aid-row-selected' : undefined}><td className="aid-selection-cell"><span className="aid-selection-control" title={row.status === 'Виплачено' ? 'Виплачене призначення можна змінити лише індивідуально' : undefined}><input type="checkbox" aria-label={`Вибрати призначення: ${row.recipientName}, рішення № ${row.decisionNumber}`} aria-describedby={row.status === 'Виплачено' ? paidSelectionReasonId : undefined} checked={selectedIds.has(row.id)} disabled={row.status === 'Виплачено'} onChange={() => toggleAssignment(row.id)}/></span></td><td data-label="№">{index + 1}</td><td data-label="Рішення"><strong className="registry-name">№ {row.decisionNumber}</strong><span className="decision-date-cell">{formatDate(row.decisionDate)}</span></td><td data-label="Програма">{row.programName}</td><td data-label="Вид допомоги">{row.aidTypeName}</td><td data-label="ПІБ"><strong className="registry-name">{row.recipientName}</strong>{row.recipientIsDemo && <span className="demo-recipient-badge">Демо</span>}</td><td data-label="Стать">{row.recipientSex ?? '—'}</td><td data-label="Сума призначення" className="assignment-amount"><strong>{money(row.amountMinor)}</strong></td><td data-label="ВПО">{row.recipientIsVpo === null ? 'Не зазначено' : row.recipientIsVpo ? 'Так' : 'Ні'}</td><td data-label="Статус"><span className={`status-badge status-${assignmentStatusColor[row.status]}`}>{row.status}</span></td><td data-label="Дії"><div className="registry-row-actions"><button className="table-action" aria-label={`Редагувати призначення ${row.recipientName}`} onClick={() => startEdit(row)}><Pencil size={17}/></button><button className="table-action danger-action" aria-label={`Видалити призначення ${row.recipientName}`} onClick={() => void requestDelete(row)}><Trash2 size={17}/></button></div></td></tr>)}</tbody><tfoot aria-live="polite"><tr><td colSpan={7} className="aid-total-count">{visible.length ? 'Призначено:' : 'Всього:'} <strong>{assignedCount}</strong></td><td className="assignment-amount" data-label="Сума призначень">{!visible.length && <span className="aid-empty-total-label">Сума призначень:</span>}<strong>{money(assignedTotalMinor)}</strong></td><td colSpan={3} className="aid-total-spacer" aria-hidden="true"/></tr></tfoot></table></div>}

    </section>
    {batchIds && <BatchAssignmentStatusModal assignmentIds={batchIds} year={year} onClose={() => setBatchIds(null)} onSaved={(result) => {
      setBatchIds(null); setSelection({ year, ids: new Set() })
      setBatchNotice(`Оновлено статусів: ${result.updatedCount}.${result.unchangedCount ? ` Без змін: ${result.unchangedCount}.` : ''}`)
      void refresh(year)
    }}/>}
    {deletePreview && <DeleteConfirmation preview={deletePreview} onClose={() => setDeletePreview(null)} onDeleted={async () => { setDeletePreview(null); await refresh() }}/>}

    {draft && <Modal title={editingId ? 'Редагувати призначення' : 'Нове призначення'} description="Оберіть отримувача й рішення та заповніть відомості про допомогу." onClose={() => { if (!savingRef.current) close() }} busy={saving} dirty={JSON.stringify(draft) !== initialDraft.current} size="wide">
      <form ref={assignmentFormRef} onSubmit={(event) => void submit(event)} className="assignment-modal-form"><div className="assignment-modal-grid">
        <div className="assignment-section-title">Отримувач і підстава</div>
        <div className="recipient-field assignment-choice-field">
          <span>Отримувач *</span>
          <div className="assignment-field-control">
            <Select label="Отримувач" required searchable disabled={saving} value={draft.recipientId} placeholder="Знайдіть за ПІБ або РНОКПП" options={recipients.map((person) => ({ value: person.id, label: person.fullName, description: person.rnokpp ? `РНОКПП ${person.rnokpp}` : 'РНОКПП не вказано', searchText: person.rnokpp ?? '' }))} onChange={(id) => { const person = recipients.find((item) => item.id === id); update({ recipientId: person?.id ?? '', recipientSearch: person?.fullName ?? '' }) }} onClear={() => update({ recipientId: '', recipientSearch: '' })}/>
            {draft.recipientId ? <button type="button" className="secondary-button assignment-create-button" title="Переглянути та редагувати отримувача" aria-label="Переглянути та редагувати отримувача" disabled={saving || recipientEditorLoading} aria-busy={recipientEditorLoading || undefined} onClick={() => void openRecipientEditor()}><Pencil size={17} aria-hidden="true"/></button> : <button type="button" className="secondary-button assignment-create-button" title="Створити нового отримувача" aria-label="Створити нового отримувача" disabled={saving} onClick={() => setShowPersonForm(true)}><Plus size={18} aria-hidden="true"/></button>}
          </div>
          {draft.recipientId && <small className="assignment-choice-note">Використовуються персональні та банківські дані обраної картки.</small>}
        </div>
        <div className="recipient-field assignment-choice-field">
          <span>Рішення виконкому *</span>
          <div className="assignment-field-control"><Select label="Рішення виконкому" required disabled={saving} value={draft.decisionId} placeholder="Оберіть рішення" options={formDecisions.map((decision) => ({ value: decision.id, label: `№ ${decision.decisionNumber} від ${formatDate(decision.decisionDate)}` }))} onChange={(id) => { const decision = formDecisions.find((item) => item.id === id); update({ decisionId: decision?.id ?? '', decisionNumber: decision?.decisionNumber ?? '', decisionDate: decision?.decisionDate ?? '' }) }}/><button type="button" className="secondary-button assignment-create-button" title="Створити нове рішення" aria-label="Створити нове рішення" disabled={saving} onClick={() => setShowDecisionForm(true)}><Plus size={18} aria-hidden="true"/></button></div>
        </div>
        <div className="assignment-section-title">Відомості про допомогу</div>
        <label className="recipient-field"><span>Програма *</span><Select label="Програма" required disabled={saving} value={draft.programId} placeholder="Оберіть програму" options={programs.map((program) => ({ value: program.id, label: program.shortName }))} onChange={(programId) => update({ programId, aidTypeId: '' })}/></label>
        <label className="recipient-field"><span>Вид допомоги *</span><Select label="Вид допомоги" required disabled={saving || !draft.programId} value={draft.aidTypeId} placeholder={draft.programId ? 'Оберіть вид допомоги' : 'Спочатку оберіть програму'} options={formAidTypes.map((type) => ({ value: type.id, label: type.shortName + (!type.isActive ? ' • історичний' : '') }))} onChange={(aidTypeId) => update({ aidTypeId })}/></label>
        <label className="recipient-field"><span>Сума призначення, ₴ *</span><ValidatedInput disabled={saving} required inputMode="decimal" placeholder="Наприклад, 5000" value={draft.amount} onChange={(event) => update({ amount: event.target.value })}/></label>
        <label className="recipient-field"><span>Статус *</span><Select label="Статус" required disabled={saving} value={draft.status} options={ASSIGNMENT_STATUSES.map((status) => ({ value: status, label: status }))} onChange={(value) => { const status = value as AssignmentStatus; update({ status, paidOn: status === 'Виплачено' ? draft.paidOn || (todayIsoDate().slice(0, 4) === String(year) ? todayIsoDate() : '') : '' }) }}/></label>
        {draft.status === 'Виплачено' && <label className="recipient-field"><span>Дата фактичної виплати *</span><DateField disabled={saving} required min={`${year}-01-01`} max={`${year}-12-31`} value={draft.paidOn} onChange={(paidOn) => update({ paidOn })}/></label>}
      </div>{error && <Alert variant="error">{error}</Alert>}<div className="recipient-form-actions assignment-form-actions"><div><button type="button" className="secondary-button assignment-cancel-button" onClick={() => confirmModalClose(JSON.stringify(draft) !== initialDraft.current, close)} disabled={saving}><X size={17} aria-hidden="true"/>Скасувати</button>{!editingId && <button type="button" className="secondary-button green-outline-button" disabled={saving} onClick={() => { if (savingRef.current || !assignmentFormRef.current?.reportValidity()) return; saveAndContinueRef.current = true; assignmentFormRef.current?.requestSubmit() }}><Plus size={17} aria-hidden="true"/>Зберегти та додати ще</button>}<button type="submit" className="primary-button" disabled={saving}><Check size={17} aria-hidden="true"/>{saving ? 'Збереження…' : 'Зберегти призначення'}</button></div></div></form>
    </Modal>}
    {draft && showPersonForm && <RecipientFormModal onClose={() => setShowPersonForm(false)} onSaved={(person) => {
      setRecipients((current) => [...current.filter((item) => item.id !== person.id), person].sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk')))
      update({ recipientId: person.id, recipientSearch: person.fullName }); setShowPersonForm(false)
    }}/>}
    {draft && recipientEditor && <RecipientFormModal key={recipientEditor.id} initial={recipientInputFromRecord(recipientEditor)} editingId={recipientEditor.id} expectedUpdatedAt={recipientEditor.updatedAt} onClose={() => setRecipientEditor(null)} onSaved={(person) => {
      setRecipients((current) => [...current.filter((item) => item.id !== person.id), person].sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk')))
      update({ recipientId: person.id, recipientSearch: person.fullName }); setRecipientEditor(null)
    }}/>}
    {draft && showDecisionForm && <DecisionFormModal year={year} onClose={() => setShowDecisionForm(false)} onSaved={(decision) => {
      setDecisions((current) => [decision, ...current.filter((item) => item.id !== decision.id)].sort((a, b) => b.decisionDate.localeCompare(a.decisionDate)))
      update({ decisionId: decision.id, decisionNumber: decision.decisionNumber, decisionDate: decision.decisionDate }); setShowDecisionForm(false)
    }}/>}
  </>
}


function SelectAllAssignments({ checked, indeterminate, disabled, onChange }: { checked: boolean; indeterminate: boolean; disabled: boolean; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current) input.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={input} type="checkbox" aria-label="Вибрати всі доступні призначення відфільтрованого набору" aria-checked={indeterminate ? 'mixed' : checked} checked={checked} disabled={disabled} onChange={onChange}/>
}
