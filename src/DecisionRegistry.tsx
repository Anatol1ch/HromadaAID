import { useCatalogUpdates } from './services/catalogRepository'
import { ASSIGNMENT_STATUSES, assignmentStatusColor } from '../electron/assignment-model'
import Select from './components/Select'
import { useReportingYear } from './context/YearContext'
import { paymentYearError } from '../electron/accounting-year'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, ClipboardList, Eye, Pencil, Plus, Save, Trash2, UserPlus, X } from 'lucide-react'
import type {
  AssignmentDraft, AssignmentStatus, AidTypeOption, DeletePreview, DecisionInput, DecisionRecord,
  DecisionSummary, ProgramOption, RecipientSummary,
} from '../electron/api-contract'
import { focusFirstInvalid } from './lib/keyboardNavigation'
import { recipientRepository } from './services/recipientRepository'
import { RecipientFormModal } from './RecipientRegistry'
import { decisionRepository } from './services/decisionRepository'
import Modal from './components/Modal'
import { confirmModalClose } from './components/Modal'
import DateField from './components/DateField'
import DecisionFields from './components/DecisionFields'
import { formatDate, formatDateInput, parseDateInput, todayIsoDate } from './lib/dates'
import DeleteConfirmation from './components/DeleteConfirmation'
import ValidatedInput from './components/ValidatedInput'

type AssignmentRowDraft = { recipientId: string; programId: string; aidTypeId: string; amount: string; status: AssignmentStatus; paidOn: string }

const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const blankDecision = (year: number): DecisionInput => ({ decisionNumber: '', decisionDate: today.slice(0, 4) === String(year) ? today : '', title: '' })


function DecisionRegistry() {
  const { year } = useReportingYear()
  const loadSequence = useRef(0)
  const [decisions, setDecisions] = useState<DecisionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<DecisionInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null)
  const [savingDecision, setSavingDecision] = useState(false)
  const [selected, setSelected] = useState<DecisionRecord | null>(null)
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [rows, setRows] = useState<AssignmentRowDraft[]>([])
  const [recipients, setRecipients] = useState<RecipientSummary[]>([])
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [aidTypes, setAidTypes] = useState<AidTypeOption[]>([])
  const [assignmentError, setAssignmentError] = useState('')
  const [loadingChoices, setLoadingChoices] = useState(false)
  const [savingAssignments, setSavingAssignments] = useState(false)
  const assignmentRequestId = useRef<string | null>(null)
  const [quickRecipient, setQuickRecipient] = useState<number | null>(null)
  const initialEditor = useRef('')

  const loadDecisions = async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError('')
    try { const rows = await decisionRepository.list(); if (sequence === loadSequence.current) setDecisions(rows.filter(item => item.decisionDate.slice(0, 4) === String(year))) }
    catch { if (sequence === loadSequence.current) setError('Не вдалося завантажити реєстр рішень. Перевірте локальне сховище й повторіть спробу.') }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }

  useEffect(() => { setSelected(null); setEditor(null); setEditingUpdatedAt(null); setRows([]); assignmentRequestId.current = null; setQuickRecipient(null); void loadDecisions() }, [year])

  const openDecision = async (id: string) => {
    setError('')
    try {
      const decision = await decisionRepository.get(id)
      if (decision) { setSelected(decision); setAssignmentError('') }
      else setError('Рішення не знайдено. Оновіть список.')
    } catch { setError('Не вдалося відкрити рішення. Спробуйте оновити список.') }
  }

  const beginCreate = () => { const initial = blankDecision(year); initialEditor.current = JSON.stringify(initial); setSelected(null); setEditor(initial); setEditingId(null); setEditingUpdatedAt(null); setError('') }

  const saveDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor || savingDecision) return
    setSavingDecision(true)
    setError('')
    try {
      const result = await decisionRepository.save(editor, editingId ?? undefined, editingUpdatedAt ?? undefined)
      if (!result.ok) { setError(result.message); return }
      setEditor(null)
      setEditingId(null); setEditingUpdatedAt(null)
      await loadDecisions()
      await openDecision(result.decision.id)
    } catch { setError('Не вдалося зберегти рішення. Дані у формі залишилися — спробуйте ще раз.') }
    finally { setSavingDecision(false) }
  }

  const startEdit = () => {
    if (!selected) return
    setEditor({ decisionNumber: selected.decisionNumber, decisionDate: selected.decisionDate, title: selected.title ?? '' })
    initialEditor.current = JSON.stringify({ decisionNumber: selected.decisionNumber, decisionDate: selected.decisionDate, title: selected.title ?? '' })
    setEditingId(selected.id)
    setEditingUpdatedAt(selected.updatedAt)
    setError('')
  }

  const closeEditor = () => { setEditor(null); setEditingId(null); setEditingUpdatedAt(null); setError('') }

  useCatalogUpdates(() => {
    void decisionRepository.catalogs().then(catalog => { setPrograms(catalog.programs); setAidTypes(catalog.aidTypes) }).catch(() => setAssignmentError('Не вдалося оновити довідники.'))
  })

  const prepareAssignments = async () => {
    if (!selected) return
    setAssignmentError('')
    setLoadingChoices(true)
    try {
      // Re-read on every opening: a previous visit must not cache deleted/renamed choices.
      const [catalog, people] = await Promise.all([decisionRepository.catalogs(), recipientRepository.list()])
      setPrograms(catalog.programs); setAidTypes(catalog.aidTypes); setRecipients(people)
      setRows(current => {
        if (current.length) return current
        assignmentRequestId.current = crypto.randomUUID()
        return [makeAssignmentRow(catalog.programs[0]?.id ?? '', catalog.aidTypes)]
      })
    } catch {
      setAssignmentError('Не вдалося завантажити отримувачів або довідники. Перевірте локальне сховище.')
    } finally { setLoadingChoices(false) }
  }

  const addRow = () => { setRows((current) => [...current, makeAssignmentRow(programs[0]?.id ?? '', aidTypes)]) }

  const updateRow = (index: number, patch: Partial<AssignmentRowDraft>) => {
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const updated = { ...row, ...patch }
      if (patch.programId) updated.aidTypeId = aidTypes.find((type) => type.programId === patch.programId)?.id ?? ''
      return updated
    }))
  }

  const addAssignments = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || savingAssignments) return
    const drafts: AssignmentDraft[] = []
    for (const [index, row] of rows.entries()) {
      const amountMinor = parseAmountMinor(row.amount)
      if (!row.recipientId || !row.programId || !row.aidTypeId || amountMinor === null) {
        setAssignmentError('Для кожного рядка виберіть отримувача, програму, вид допомоги та введіть додатну суму з точністю до копійок.')
        focusFirstInvalid(event.currentTarget, `.assignment-draft-row:nth-child(${index + 2}) input[inputmode="decimal"]`)
        return
      }
      if (row.status === 'Виплачено' && !parseDateInput(formatDateInput(row.paidOn))) { setAssignmentError('Для кожного виплаченого призначення вкажіть коректну дату фактичної виплати.'); return }
      if (row.status === 'Виплачено') { const message = paymentYearError(row.paidOn, selected.decisionDate); if (message) { setAssignmentError(message); return } }
      drafts.push({ recipientId: row.recipientId, aidTypeId: row.aidTypeId, amountMinor, status: row.status, paidOn: row.paidOn })
    }
    if (!drafts.length) { setAssignmentError('Додайте щонайменше одного отримувача.'); return }
    setSavingAssignments(true)
    setAssignmentError('')
    try {
      const requestId = assignmentRequestId.current
      if (!requestId) { setAssignmentError('Не вдалося підготувати операцію збереження. Закрийте форму та відкрийте її повторно.'); return }
      const result = await decisionRepository.addAssignments(selected.id, drafts, requestId)
      if (!result.ok) { setAssignmentError(result.message); return }
      setRows([]); assignmentRequestId.current = null
      await openDecision(selected.id)
      await loadDecisions()
    } catch { setAssignmentError('Не вдалося зберегти призначення. Дані форми залишилися — спробуйте ще раз.') }
    finally { setSavingAssignments(false) }
  }

  const openQuickAdd = (rowIndex: number) => setQuickRecipient(rowIndex)

  const sorted = useMemo(() => decisions, [decisions])

  const deleteDecision = async () => {
    if (!selected) return
    try { const preview = await window.hromadaAid.deletion.preview('decision', selected.id); if (preview) setDeletePreview(preview); else setError('Рішення не знайдено.') }
    catch { setError('Не вдалося перевірити пов’язані записи рішення.') }
  }

  return <>
    <section className="page-heading registry-heading">
      <div><div className="eyebrow">ОБЛІК ПРИЗНАЧЕНЬ • ЛОКАЛЬНІ ДАНІ</div><h1>Реєстр рішень</h1><p className="subtitle">Рішення виконкому та пов’язані з ними призначення допомоги</p></div>
      <button className="primary-button" onClick={beginCreate}><Plus size={19}/>Додати рішення</button>
    </section>

    {error && !editor && !selected && <div className="registry-alert" role="alert">{error}<button type="button" onClick={() => void loadDecisions()}>Оновити список</button></div>}

    {editor && <Modal title={editingId ? 'Редагувати рішення' : 'Нове рішення виконкому'} description="Укажіть номер і дату рішення. Примітка необов’язкова." onClose={closeEditor} dirty={JSON.stringify(editor) !== initialEditor.current}><DecisionEditor editor={editor} onChange={setEditor} onSubmit={saveDecision} onCancel={closeEditor} saving={savingDecision} error={error} dirty={JSON.stringify(editor) !== initialEditor.current}/></Modal>}

    <section className="dashboard-panel registry-panel decision-list-panel">
      <div className="registry-toolbar"><div><h2>Рішення виконкому</h2><p>{loading ? 'Завантаження…' : `${sorted.length} ${pluralize(sorted.length)}`}</p></div><span className="decision-list-hint"><ClipboardList size={18}/> Відкрийте рішення, щоб переглянути призначення</span></div>
      {loading ? <div className="registry-empty">Завантажуємо рішення із сервера…</div> : sorted.length ? <div className="registry-table-wrap"><table className="registry-table decision-table"><thead><tr><th>Номер і дата</th><th>Призначень</th><th>Загальна призначена сума</th><th><span className="visually-hidden">Дії</span></th></tr></thead><tbody>{sorted.map((decision) => <tr key={decision.id}>
        <td><span className="registry-name">№ {decision.decisionNumber}</span><span className="decision-date-cell">{formatDate(decision.decisionDate)}</span></td>
        <td>{decision.assignmentCount}</td><td className="assignment-amount">{formatMoneyMinor(decision.assignedTotalMinor)}</td>
        <td><button type="button" className="table-action" onClick={() => void openDecision(decision.id)}><Eye size={17}/><span>Відкрити</span></button></td>
      </tr>)}</tbody></table></div> : <div className="registry-empty"><ClipboardList size={24}/><strong>Рішень поки немає</strong><span>Додайте рішення виконкому, щоб зареєструвати його реквізити та призначення.</span><button type="button" className="secondary-button" onClick={beginCreate}><Plus size={17}/>Додати рішення</button></div>}
    </section>

    {selected && <Modal title={`Рішення виконкому № ${selected.decisionNumber}`} description={`${formatDate(selected.decisionDate)}${selected.title ? ` • ${selected.title}` : ''}`} onClose={() => { setSelected(null); setRows([]); assignmentRequestId.current = null }} size="large">
      <div className="decision-detail-heading"><div><div className="eyebrow">ПОВ’ЯЗАНІ ПРИЗНАЧЕННЯ</div></div><div className="decision-detail-actions"><button className="secondary-button" onClick={startEdit}><Pencil size={16}/>Редагувати реквізити</button><button className="secondary-button danger-action" onClick={() => void deleteDecision()}><Trash2 size={16}/>Видалити рішення</button></div></div>
      {error && <div className="registry-alert" role="alert">{error}</div>}
      <div className="decision-assignment-summary"><span>{selected.assignments.length} записів</span><strong>{formatMoneyMinor(selected.assignedTotalMinor)}</strong><span>загальна призначена сума</span></div>
      {selected.assignments.length ? <div className="registry-table-wrap"><table className="registry-table decision-assignment-table"><thead><tr><th>Отримувач</th><th>Програма / вид допомоги</th><th>Сума</th><th>Статус</th></tr></thead><tbody>{selected.assignments.map((assignment) => <tr key={assignment.id}><td><span className="registry-name">{assignment.recipientName}</span></td><td><span className="registry-name">{assignment.aidTypeName}</span><span className="decision-date-cell">{assignment.programName}</span></td><td className="assignment-amount">{formatMoneyMinor(assignment.amountMinor)}</td><td><StatusBadge status={assignment.status}/></td></tr>)}</tbody></table></div> : <div className="registry-empty decision-no-assignments">Для цього рішення ще не додано призначень.</div>}
      {!rows.length ? <div className="decision-add-action"><p>Додавайте призначення до вибраного рішення.</p><button className="primary-button" onClick={() => void prepareAssignments()} disabled={loadingChoices}><Plus size={18}/>{loadingChoices ? 'Завантаження…' : 'Додати призначення'}</button></div> : <Modal title="Додати призначення до рішення" description="Додавайте одного або кількох отримувачів до цього рішення." onClose={() => { setRows([]); assignmentRequestId.current = null; setAssignmentError('') }} dirty={rows.length > 1 || rows.some((row) => !!row.recipientId || !!row.amount)} size="large"><form className="assignment-builder" onSubmit={addAssignments}>
        <div className="assignment-builder-heading"><div><h3>Нові призначення</h3><p>Додавайте одного або кількох отримувачів до цього рішення.</p></div><button type="button" className="icon-button" aria-label="Закрити додавання призначень" onClick={() => confirmModalClose(true, () => { setRows([]); assignmentRequestId.current = null; setAssignmentError('') })}><X size={18}/></button></div>
        {rows.map((row, index) => <div className="assignment-draft-row" key={index}>
          <div className="recipient-field assignment-recipient-field"><span>Отримувач *</span><div className="assignment-recipient-select"><Select label="Отримувач" required searchable value={row.recipientId} placeholder="Знайдіть за ПІБ або РНОКПП" options={recipients.map((person) => ({ value: person.id, label: person.fullName + (person.isDemo ? ' • демо' : ''), description: person.rnokpp ? `РНОКПП ${person.rnokpp}` : 'РНОКПП не вказано', searchText: person.rnokpp ?? '' }))} onChange={(value) => updateRow(index, { recipientId: value })}/><button type="button" className="table-action" onClick={() => openQuickAdd(index)}><UserPlus size={16}/><span>Створити</span></button></div></div>
          <label className="recipient-field"><span>Програма *</span><Select label="Програма" required value={row.programId} placeholder="Оберіть програму" options={programs.map((program) => ({ value: program.id, label: program.shortName }))} onChange={(value) => updateRow(index, { programId: value })}/></label>
          <label className="recipient-field"><span>Вид допомоги *</span><Select label="Вид допомоги" required value={row.aidTypeId} placeholder="Оберіть вид допомоги" options={aidTypes.filter((type) => type.programId === row.programId).map((type) => ({ value: type.id, label: type.shortName }))} onChange={(value) => updateRow(index, { aidTypeId: value })}/></label>
          <label className="recipient-field"><span>Сума, ₴ *</span><ValidatedInput required inputMode="decimal" placeholder="Наприклад, 5000" value={row.amount} onChange={(event) => updateRow(index, { amount: event.target.value })}/></label>
          <label className="recipient-field"><span>Статус</span><Select label="Статус" value={row.status} options={ASSIGNMENT_STATUSES.map((status) => ({ value: status, label: status }))} onChange={(value) => {
            const status = value as AssignmentStatus
            updateRow(index, { status, paidOn: status === 'Виплачено' ? row.paidOn || (todayIsoDate().slice(0, 4) === String(year) ? todayIsoDate() : '') : '' })
          }}/></label>
          {row.status === 'Виплачено' && <label className="recipient-field"><span>Дата фактичної виплати *</span><DateField required min={`${year}-01-01`} max={`${year}-12-31`} value={row.paidOn} onChange={(paidOn) => updateRow(index, { paidOn })}/></label>}
          <button type="button" className="icon-button assignment-remove" aria-label={`Вилучити рядок ${index + 1}`} onClick={() => { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)) }}><Trash2 size={18}/></button>
        </div>)}
        {assignmentError && <div className="registry-alert" role="alert">{assignmentError}</div>}
        <div className="assignment-builder-actions"><button type="button" className="secondary-button" onClick={addRow}><Plus size={16}/>Додати ще отримувача</button><button type="submit" className="primary-button" disabled={savingAssignments}>{savingAssignments ? 'Збереження…' : <><Save size={17}/>Зберегти призначення</>}</button></div>
      </form></Modal>}
    </Modal>}

    {quickRecipient !== null && <RecipientFormModal onClose={() => setQuickRecipient(null)} onSaved={(recipient) => {
      setRecipients((current) => [...current.filter((item) => item.id !== recipient.id), toSummary(recipient)].sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk')))
      updateRow(quickRecipient, { recipientId: recipient.id }); setQuickRecipient(null)
    }} onUseExisting={(id) => { updateRow(quickRecipient, { recipientId: id }); setQuickRecipient(null) }}/>}
    <p className="registry-storage-note"><CalendarDays size={16}/> До обліку включаються всі призначення за датою рішення.</p>
    {deletePreview && <DeleteConfirmation preview={deletePreview} onClose={() => setDeletePreview(null)} onDeleted={async () => { setDeletePreview(null); setSelected(null); await loadDecisions() }}/>}
  </>
}

function DecisionEditor({ editor, onChange, onSubmit, onCancel, saving, error, dirty }: {
  editor: DecisionInput; onChange: (input: DecisionInput) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void; saving: boolean; error: string; dirty: boolean
}) {
  const { year } = useReportingYear()
  return <form className="decision-editor" onSubmit={onSubmit}><DecisionFields year={year} value={editor} onChange={onChange}/>
      {error && <div className="registry-alert" role="alert">{error}</div>}
      <div className="recipient-form-actions"><span>Номер і дата використовуються для ідентифікації рішення.</span><div><button type="button" className="secondary-button" onClick={() => confirmModalClose(dirty, onCancel)} disabled={saving}>Скасувати</button><button className="primary-button" disabled={saving}>{saving ? 'Збереження…' : 'Зберегти рішення'}</button></div></div>
    </form>
}

function StatusBadge({ status }: { status: AssignmentStatus }) {
  return <span className={`status-badge status-${assignmentStatusColor[status]}`}>{status}</span>
}

function makeAssignmentRow(programId: string, aidTypes: AidTypeOption[]): AssignmentRowDraft {
  return { recipientId: '', programId, aidTypeId: aidTypes.find((type) => type.programId === programId)?.id ?? '', amount: '', status: 'Призначено', paidOn: '' }
}

function toSummary(recipient: { id: string; fullName: string; rnokpp: string | null; phone: string | null; registeredAddress: string | null; updatedAt: string; isDemo: boolean; isVpo?: boolean | null; sex?: 'Жінка' | 'Чоловік' | null }): RecipientSummary {
  return { id: recipient.id, fullName: recipient.fullName, rnokpp: recipient.rnokpp, phone: recipient.phone, registeredAddress: recipient.registeredAddress, sex: recipient.sex ?? null, updatedAt: recipient.updatedAt, isDemo: recipient.isDemo, isVpo: recipient.isVpo ?? null }
}

function parseAmountMinor(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 100) return null
  return Math.round(amount * 100)
}

function formatMoneyMinor(value: number) { return `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)} ₴` }
function pluralize(value: number) { const n = value % 100; const d = value % 10; if (n >= 11 && n <= 14) return 'рішень'; if (d === 1) return 'рішення'; if (d >= 2 && d <= 4) return 'рішення'; return 'рішень' }

export default DecisionRegistry
