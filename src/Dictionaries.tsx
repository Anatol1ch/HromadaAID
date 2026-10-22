import { navigateTabs } from './lib/tabNavigation'
import DataState from './components/DataState'
import Alert from './components/Alert'
import AnnualPlanning from './AnnualPlanning'
import { catalogRepository, useCatalogUpdates } from './services/catalogRepository'
import type { CatalogOrderInput } from '../electron/api-contract'
import Select from './components/Select'
import { useReportingYear } from './context/YearContext'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, FileCheck2, HandCoins, Landmark, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import type { AidTypeOption, CatalogEditInput, DecisionInput, DecisionSummary, DeletePreview, ProgramOption } from '../electron/api-contract'
import RecipientRegistry from './RecipientRegistry'
import DictionaryTable, { DictionaryToolbar } from './components/DictionaryTable'
import ProgramsCatalog from './components/ProgramsCatalog'
import BankRegistry from './BankRegistry'
import Modal from './components/Modal'
import { confirmModalClose } from './components/Modal'
import DateField from './components/DateField'
import DecisionFields from './components/DecisionFields'
import ValidatedInput, { ValidatedTextarea } from './components/ValidatedInput'
import { formatDate } from './lib/dates'
import DeleteConfirmation from './components/DeleteConfirmation'
import ConfirmDialog from './components/ConfirmDialog'
import type { LucideIcon } from 'lucide-react'

type CatalogData = Awaited<ReturnType<typeof window.hromadaAid.catalogs.list>>
export type DictionarySection = 'people' | 'programs' | 'decisions' | 'banks' | 'plans'
type Section = DictionarySection
type DecisionDraft = DecisionInput & { id?: string; expectedUpdatedAt?: string }
type DictionaryTab = { key: Section; label: string; icon: LucideIcon }
const dictionaryTabGroups: readonly (readonly DictionaryTab[])[] = [
  [{ key: 'people', label: 'Отримувачі', icon: Users }, { key: 'decisions', label: 'Рішення виконкому', icon: FileCheck2 }, { key: 'banks', label: 'Банки', icon: Landmark }],
  [{ key: 'programs', label: 'Програми та допомоги', icon: HandCoins }, { key: 'plans', label: 'Планові показники', icon: FileCheck2 }],
]
const blankCatalog = (kind: 'program' | 'aidType', programId = ''): CatalogEditInput => ({ kind, shortName: '', officialName: '', programId, direction: '', fundingSource: '', isActive: true, approvalId: null })

function DictionaryTabGroup({ tabs, section, onSelect, management }: { tabs: readonly DictionaryTab[]; section: Section; onSelect: (section: Section) => void; management?: boolean }) {
  return <div role="presentation" className={`dictionary-tabs dictionary-navigation-group${management ? ' dictionary-management-group' : ''}`}>
    {tabs.map(({ key, label, icon: Icon }) => <button key={key} id={`dictionary-tab-${key}`} type="button" data-tab-key={key} className={section === key ? 'active' : ''} role="tab" aria-selected={section === key} aria-controls="dictionary-content" tabIndex={section === key ? 0 : -1} onClick={() => onSelect(key)}><Icon size={17}/>{label}</button>)}
  </div>
}

export default function Dictionaries({
  allowedSections = ['people', 'programs', 'decisions', 'banks', 'plans'],
  canManageCatalogs = true,
  canManagePlans = true,
  canManageDecisions = true,
  canManagePersonal = true,
}: {
  allowedSections?: readonly DictionarySection[]
  canManageCatalogs?: boolean
  canManagePlans?: boolean
  canManageDecisions?: boolean
  canManagePersonal?: boolean
}) {
  const { year } = useReportingYear()
  const [section, setSection] = useState<Section>(allowedSections[0] ?? 'programs')
  const [data, setData] = useState<CatalogData>({ programs: [], aidTypes: [], programOrderRevision: '', aidTypeOrderRevisions: {} })
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [decisions, setDecisions] = useState<DecisionSummary[]>([])
  const [draft, setDraft] = useState<CatalogEditInput | null>(null)
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(null)
  const [initial, setInitial] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [catalogsLoaded, setCatalogsLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [ordering, setOrdering] = useState(false)
  const orderingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const refreshSequence = useRef(0)
  const [catalogConfirmation, setCatalogConfirmation] = useState<{ input: CatalogEditInput; count: number } | null>(null)
  const activeSection = allowedSections.includes(section) ? section : allowedSections[0] ?? 'programs'
  const selectSection = (next: Section) => { if (allowedSections.includes(next)) setSection(next) }

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    setLoading(true); setLoadError('')
    try {
      const [catalogs, nextDecisions] = await Promise.all([
        catalogRepository.list(true), allowedSections.includes('decisions') ? window.hromadaAid.decisions.list() : Promise.resolve([]),
      ])
      if (sequence !== refreshSequence.current) return
      setCatalogsLoaded(true); setData(catalogs); setDecisions(nextDecisions.filter(item => item.decisionDate.slice(0, 4) === String(year))); setError('')
    } catch { if (sequence === refreshSequence.current) setLoadError('Не вдалося завантажити довідники з локального сховища.') }
    finally { if (sequence === refreshSequence.current) setLoading(false) }
  }, [year, allowedSections])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (!allowedSections.includes(section)) setSection(allowedSections[0] ?? 'programs') }, [allowedSections, section])
  useCatalogUpdates(() => { void refresh() })

  const reorder = async (input: CatalogOrderInput) => {
    if (orderingRef.current) return false
    orderingRef.current = true; setOrdering(true); setError('')
    const before = data
    const positions = new Map(input.ids.map((id, index) => [id, index]))
    setData(current => {
      if (input.kind === 'program') return { ...current, programs: [...current.programs].sort((a, b) => positions.get(a.id)! - positions.get(b.id)!) }
      const byId = new Map(current.aidTypes.map(type => [type.id, type]))
      let index = 0
      return { ...current, aidTypes: current.aidTypes.map(type => type.programId === input.programId ? byId.get(input.ids[index++])! : type) }
    })
    try {
      const expectedOrderRevision = input.kind === 'program' ? data.programOrderRevision : data.aidTypeOrderRevisions[input.programId ?? '']
      const result = await catalogRepository.reorder({ ...input, expectedOrderRevision })
      if (!result.ok) { setData(before); setError(result.message ?? 'Не вдалося зберегти порядок.'); return false }
      return true
    } catch { setData(before); setError('Не вдалося зберегти порядок. Попередню послідовність відновлено.'); return false }
    finally { orderingRef.current = false; setOrdering(false) }
  }

  const editProgram = (program?: ProgramOption) => {
    const next = program ? { kind: 'program' as const, id: program.id, expectedUpdatedAt: program.updatedAt, shortName: program.shortName, officialName: program.officialName, isActive: program.isActive, approvalId: null, approvalNumber: program.approvalNumber ?? '', approvalDate: program.approvalDate ?? '', approvalTitle: program.approvalTitle ?? '' }
      : blankCatalog('program')
    setDraft(next); setInitial(JSON.stringify(next)); setError('')
  }
  const editAidType = (type?: AidTypeOption, programId = '') => {
    const next = type ? { kind: 'aidType' as const, id: type.id, expectedUpdatedAt: type.updatedAt, shortName: type.shortName, officialName: type.officialName, programId: type.programId, direction: type.direction ?? '', fundingSource: type.fundingSource ?? '', isActive: type.isActive }
      : blankCatalog('aidType', programId)
    setDraft(next); setInitial(JSON.stringify(next)); setError('')
  }
  const persistCatalog = async (input: CatalogEditInput) => {
    if (savingRef.current) return false
    savingRef.current = true; setSaving(true); setError('')
    try {
      const result = await catalogRepository.save(input)
      if (!result.ok) { setError(result.message ?? 'Не вдалося зберегти довідник.'); return false }
      setDraft(null); await refresh()
      return true
    } catch { setError('Не вдалося зберегти довідник. Перевірте введені дані.'); return false }
    finally { savingRef.current = false; setSaving(false) }
  }
  const saveCatalog = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft || catalogConfirmation || savingRef.current) return
    const count = draft.kind === 'program' ? data.programs.find((item) => item.id === draft.id)?.assignmentCount ?? 0 : data.aidTypes.find((item) => item.id === draft.id)?.assignmentCount ?? 0
    if (count) { setError(''); setCatalogConfirmation({ input: { ...draft }, count }); return }
    await persistCatalog(draft)
  }
  const saveDecision = async (event: FormEvent) => {
    event.preventDefault(); if (!decisionDraft || savingRef.current) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      const { id, expectedUpdatedAt, ...input } = decisionDraft
      const result = await window.hromadaAid.decisions.save(input, id, expectedUpdatedAt)
      if (!result.ok) { setError(result.message); return }
      setDecisionDraft(null); await refresh()
    } catch { setError('Не вдалося зберегти рішення. Введені дані залишилися у формі.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const update = (patch: Partial<CatalogEditInput>) => setDraft((current) => current ? { ...current, ...patch } : null)
  const openNewDecision = () => { const next = { decisionNumber: '', decisionDate: '', title: '' }; setDecisionDraft(next); setInitial(JSON.stringify(next)); setError('') }
  const requestDelete = async (entity: DeletePreview['entity'], id: string) => {
    try { const preview = await window.hromadaAid.deletion.preview(entity, id); if (preview) setDeletePreview(preview); else setError('Запис не знайдено. Оновіть довідник.') }
    catch { setError('Не вдалося перевірити пов’язані записи.') }
  }


  return <>
    <section className="page-heading"><div><div className="eyebrow">ДОВІДКОВІ ДАНІ</div><h1>Довідники</h1><p className="subtitle">Картки людей, банки, програми, види допомоги та реквізити рішень.</p></div></section>
    <div className="dictionary-navigation"><div className="dictionary-navigation-groups" role="tablist" aria-label="Підрозділи довідників" onKeyDown={navigateTabs}>
      {dictionaryTabGroups.map((group, index) => { const tabs = group.filter((tab) => allowedSections.includes(tab.key)); return tabs.length ? <DictionaryTabGroup key={index} tabs={tabs} section={activeSection} onSelect={selectSection} management={index === 1}/> : null })}
    </div></div>
    {error && !draft && !decisionDraft && <Alert variant="error" action={<button onClick={() => void refresh()}>Оновити</button>}>{error}</Alert>}
    <div id="dictionary-content" role="tabpanel" aria-labelledby={`dictionary-tab-${activeSection}`}>
    {allowedSections.length === 0 ? <DataState kind="empty" message="Немає доступних підрозділів довідників."/> : activeSection === 'people' ? <RecipientRegistry embedded readOnly={!canManagePersonal}/> : activeSection === 'banks' ? <BankRegistry readOnly={!canManagePersonal}/> : activeSection === 'plans' ? <>{!catalogsLoaded ? loading ? <DataState kind="loading" message="Завантажуємо довідники…"/> : <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити завантаження</button>}>{loadError}</Alert> : <>{loadError && <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити завантаження</button>}>{loadError}</Alert>}<AnnualPlanning programs={data.programs} aidTypes={data.aidTypes} readOnly={!canManagePlans}/></>}</> : <section className={`dashboard-panel registry-panel ${activeSection === 'decisions' ? 'dictionary-registry' : 'catalog-panel'}`}>
      {activeSection === 'programs' && <ProgramsCatalog loading={loading} error={loadError} onRetry={() => void refresh()} programs={data.programs} aidTypes={data.aidTypes} ordering={ordering} onReorder={reorder} onEditProgram={editProgram} onEditAid={editAidType} onDelete={(entity, id) => void requestDelete(entity, id)} readOnly={!canManageCatalogs}/>}
      {activeSection === 'decisions' && <>
        <DictionaryToolbar loading={loading} unavailable={Boolean(loadError)} title="Рішення виконкому" count={`Рішень: ${decisions.length}`}>{canManageDecisions && <button className="primary-button" onClick={openNewDecision}><Plus size={17}/>Додати рішення</button>}</DictionaryToolbar>
        <DictionaryTable loading={loading} error={loadError} onRetry={() => void refresh()} label="Рішення виконкому" className="dictionary-decisions" empty={!decisions.length ? `За ${year} рік рішень поки немає. Додайте перше рішення.` : undefined} columns={[{label:'Номер рішення'},{label:'Дата рішення',width:'24%'},{label:'Пов’язаних призначень',width:'30%',className:'dictionary-center'},{label:'Дії',width:'94px',className:'dictionary-actions-cell'}]}>
          {decisions.map(item => <tr key={item.id}><td><strong className="registry-name">№ {item.decisionNumber}</strong></td><td className="dictionary-nowrap">{formatDate(item.decisionDate)}</td><td className="dictionary-center dictionary-number">{item.assignmentCount}</td><td className="dictionary-actions-cell">{canManageDecisions && <div className="registry-row-actions"><button className="table-action" title="Редагувати рішення" aria-label={`Редагувати рішення: № ${item.decisionNumber}`} onClick={() => { const next = { id: item.id, expectedUpdatedAt: item.updatedAt, decisionNumber: item.decisionNumber, decisionDate: item.decisionDate, title: item.title ?? '' }; setDecisionDraft(next); setInitial(JSON.stringify(next)); setError('') }}><Pencil size={16}/></button><button className="table-action danger-action" title="Видалити рішення" onClick={() => void requestDelete('decision', item.id)} aria-label={`Видалити рішення: № ${item.decisionNumber}`}><Trash2 size={16}/></button></div>}</td></tr>)}
        </DictionaryTable>
      </>}
    </section>}
    </div>

    {draft && <Modal title={`${draft.id ? 'Редагувати' : 'Додати'} ${draft.kind === 'program' ? 'програму' : 'вид допомоги'}`} description="Довідкове значення використовується у робочих формах та звітах." busy={saving} onClose={() => { if (!savingRef.current) setDraft(null) }} dirty={JSON.stringify(draft) !== initial} size="large" headerIcon={draft.kind === 'program' ? <Landmark size={22}/> : <HandCoins size={22}/>} className="catalog-edit-modal"><form onSubmit={(event) => void saveCatalog(event)} className="catalog-form recipient-card-form">
      {draft.kind === 'aidType' && <label className="recipient-field"><span>Програма *</span><Select label="Програма" disabled={saving} required value={draft.programId ?? ''} placeholder="Оберіть програму" options={data.programs.filter((item) => item.isActive || item.id === draft.programId).map((item) => ({ value: item.id, label: item.shortName }))} onChange={(value) => update({ programId: value })}/></label>}
      <label className="recipient-field"><span>Коротка назва *</span><ValidatedInput disabled={saving} required maxLength={250} value={draft.shortName} onChange={(event) => update({ shortName: event.target.value })}/></label>
      <label className="recipient-field"><span>Повна офіційна назва *</span><ValidatedTextarea disabled={saving} required maxLength={1500} rows={4} value={draft.officialName} onChange={(event) => update({ officialName: event.target.value })}/></label>
      {draft.kind === 'program' && <><label className="recipient-field"><span>Номер рішення про затвердження</span><ValidatedInput disabled={saving} maxLength={100} value={draft.approvalNumber ?? ''} onChange={(event) => update({ approvalNumber: event.target.value })}/></label><label className="recipient-field"><span>Дата рішення</span><DateField disabled={saving} value={draft.approvalDate ?? ''} onChange={(approvalDate) => update({ approvalDate })}/></label></>}
      {draft.kind === 'aidType' && <><label className="recipient-field"><span>Напрям (за потреби)</span><ValidatedInput disabled={saving} maxLength={300} value={draft.direction ?? ''} onChange={(event) => update({ direction: event.target.value })}/></label><label className="recipient-field"><span>Джерело фінансування (за потреби)</span><ValidatedInput disabled={saving} maxLength={500} value={draft.fundingSource ?? ''} onChange={(event) => update({ fundingSource: event.target.value })}/></label></>}
      <label className="catalog-active-toggle"><input type="checkbox" checked={draft.isActive !== false} disabled={saving || draft.kind === 'aidType' && data.aidTypes.find((type) => type.id === draft.id)?.code === 'SOCIAL_WAR_EMERGENCY'} onChange={(event) => update({ isActive: event.target.checked })}/> Доступний для нових записів і звітів</label>
      {draft.kind === 'aidType' && data.aidTypes.find((type) => type.id === draft.id)?.code === 'SOCIAL_WAR_EMERGENCY' && <small>Цю категорію залишено в історії, але вимкнено через дублювання.</small>}
      {error && <Alert variant="error">{error}</Alert>}
      <div className="recipient-form-actions recipient-card-actions"><span>Неактивні значення залишаються в історії.</span><div><button type="button" className="secondary-button assignment-cancel-button" disabled={saving} onClick={() => confirmModalClose(JSON.stringify(draft) !== initial, () => setDraft(null))}><X size={17}/>Скасувати</button><button type="submit" className="primary-button" disabled={saving}><Check size={17}/>{saving ? 'Зберігаємо…' : 'Зберегти'}</button></div></div>
    </form></Modal>}

    {decisionDraft && <Modal title={decisionDraft.id ? 'Редагувати рішення виконкому' : 'Додати рішення виконкому'} description="Це рішення використовується як підстава призначення допомоги." busy={saving} onClose={() => { if (!savingRef.current) setDecisionDraft(null) }} dirty={JSON.stringify(decisionDraft) !== initial} size="compact"><form className="catalog-form" onSubmit={(event) => void saveDecision(event)}><DecisionFields disabled={saving} year={year} value={decisionDraft} onChange={(value) => setDecisionDraft((current) => current ? { ...current, ...value } : current)}/>{error && <Alert variant="error">{error}</Alert>}<div className="recipient-form-actions"><span>Призначення зберігаються окремими рядками.</span><div><button type="button" className="secondary-button" disabled={saving} onClick={() => confirmModalClose(JSON.stringify(decisionDraft) !== initial, () => setDecisionDraft(null))}>Скасувати</button><button className="primary-button" disabled={saving}>{saving ? 'Збереження…' : 'Зберегти'}</button></div></div></form></Modal>}
    {catalogConfirmation && <ConfirmDialog variant="warning" title="Зберегти зміни довідника?" description="Зміни стосуються наявних призначень."
      message={`Цей довідник пов’язаний із ${catalogConfirmation.count} призначеннями. Зміни відображатимуться в історії. Продовжити?`}
      confirmLabel="Зберегти зміни" busyLabel="Зберігаємо…" error={error} onCancel={() => setCatalogConfirmation(null)}
      onConfirm={async () => { if (await persistCatalog(catalogConfirmation.input)) setCatalogConfirmation(null) }}/>}
    {deletePreview && <DeleteConfirmation preview={deletePreview} onClose={() => setDeletePreview(null)} onDeleted={async () => { setDeletePreview(null); await refresh() }}/>}
  </>
}
