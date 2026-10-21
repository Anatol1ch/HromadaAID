import DataState from './components/DataState'
import { TableSkeleton } from './components/Skeleton'
import Alert from './components/Alert'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import type { AidTypeOption, AnnualAidPlan, ProgramOption } from '../electron/api-contract'
import { useReportingYear } from './context/YearContext'
import { notifyCatalogsChanged, useCatalogUpdates } from './services/catalogRepository'
import Modal, { confirmModalClose } from './components/Modal'
import { parsePlanMoney, reportMoney } from './lib/reporting'

export default function AnnualPlanning({ programs, aidTypes, readOnly = false }: { programs: ProgramOption[]; aidTypes: AidTypeOption[]; readOnly?: boolean }) {
  const { year } = useReportingYear()
  const [plans, setPlans] = useState<AnnualAidPlan[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ year: number; type: AidTypeOption; program: ProgramOption; plan?: AnnualAidPlan } | null>(null)
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++sequence.current; setLoading(true); setError('')
    try { const next = await window.hromadaAid.reports.annualPlanList(year); if (request === sequence.current) setPlans(next) }
    catch { if (request === sequence.current) setError('Не вдалося завантажити планові показники.') }
    finally { if (request === sequence.current) setLoading(false) }
  }, [year])
  useEffect(() => { setPlans([]); void refresh(); return () => { ++sequence.current } }, [refresh])
  useCatalogUpdates(() => { void refresh() })
  const byType = new Map(plans.map(plan => [plan.aidTypeId, plan]))
  const totals = (types: AidTypeOption[]) => types.reduce((sum,type) => {
    const plan = byType.get(type.id)
    return { count: sum.count + (plan?.plannedRecipientCount ?? 0), amount: sum.amount + (plan?.plannedAmountMinor ?? 0) }
  }, { count: 0, amount: 0 })
  const total = totals(aidTypes)
  return <section className="dashboard-panel planning-panel">
    <header className="dictionary-toolbar"><div className="dictionary-toolbar-heading"><h2>Планові показники</h2><p>Річний план за {year} рік. Незаповнені значення відрізняються від встановлених нулів.</p></div><span className="planning-year">{year} рік</span></header>
    {loading ? <TableSkeleton columns={4} label="Завантажуємо планові показники…"/> : error ? <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити завантаження</button>}>{error}</Alert> : programs.length ? programs.map(program => {
      const programTotal = totals(aidTypes.filter(type => type.programId === program.id))
      return <section className="planning-program" key={program.id}><header><h3>{program.shortName}</h3></header>
      <div className="planning-table-wrap"><table className="planning-table" aria-label={`План: ${program.shortName}`}><PlanningColumns/><thead><tr><th scope="col">Вид допомоги</th><th scope="col">План отримувачів</th><th scope="col">Планова сума</th><th scope="col">Дії</th></tr></thead><tbody>{aidTypes.filter(type => type.programId === program.id).map(type => {
        const plan = byType.get(type.id)
        return <tr key={type.id}><td><strong>{type.shortName}</strong></td><td>{plan?.plannedRecipientCount ?? <span className="planning-unset">Не встановлено</span>}</td><td>{plan ? reportMoney(plan.plannedAmountMinor) : <span className="planning-unset">Не встановлено</span>}</td><td>{!readOnly && <button type="button" className="secondary-button" onClick={() => setEditing({year,type,program,plan})}>{plan ? <Pencil size={15}/> : <Plus size={15}/>} {plan ? 'Редагувати план' : 'Встановити план'}</button>}</td></tr>
      })}</tbody><tfoot><tr><th scope="row">Разом за програмою</th><td>{programTotal.count}</td><td>{reportMoney(programTotal.amount)}</td><td/></tr></tfoot></table></div>{!aidTypes.some(type => type.programId === program.id) && <DataState kind="empty" compact message="У програмі поки немає видів допомоги."/>}
    </section>}) : <DataState kind="empty" message="Програм поки немає" description="Додайте програму та вид допомоги, щоб встановити річний план."/>}
    {!loading && !error && programs.length > 0 && <section className="planning-total" aria-label="Загальний підсумок плану"><div className="planning-table-wrap"><table className="planning-table planning-total-table" aria-label={`Річний план за ${year} рік`}><PlanningColumns/><thead className="visually-hidden"><tr><th scope="col">Вид допомоги</th><th scope="col">План отримувачів</th><th scope="col">Планова сума</th><th scope="col">Дії</th></tr></thead><tbody><tr><th scope="row">Загалом за {year} рік</th><td>{total.count}</td><td>{reportMoney(total.amount)}</td><td/></tr></tbody></table></div></section>}
    {editing && <PlanModal key={`${editing.year}-${editing.type.id}`} {...editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notifyCatalogsChanged() }}/>}
  </section>
}

/** All program tables and the annual summary use the exact same column widths. */
function PlanningColumns() {
  return <colgroup><col/><col style={{width:'18%'}}/><col style={{width:'23%'}}/><col style={{width:165}}/></colgroup>
}

function PlanModal({ year, type, program, plan, onClose, onSaved }: { year: number; type: AidTypeOption; program: ProgramOption; plan?: AnnualAidPlan; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({ count: plan?.plannedRecipientCount?.toString() ?? '', amount: plan ? (plan.plannedAmountMinor / 100).toFixed(2).replace('.', ',') : '' })
  const baseline = useRef(JSON.stringify(draft)), saving = useRef(false), form = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = baseline.current !== JSON.stringify(draft)
  const update = (key: keyof typeof draft, value: string) => { setDraft(current => ({...current,[key]:value})); setErrors(current => ({...current,[key]:''})); setError('') }
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (saving.current) return
    const count = /^\d+$/.test(draft.count.trim()) ? Number(draft.count.trim()) : NaN, amount = parsePlanMoney(draft.amount)
    const next: Record<string,string> = {}
    if (!Number.isSafeInteger(count) || count < 0) next.count = 'Вкажіть цілу невід’ємну кількість.'
    if (amount === null) next.amount = 'Вкажіть невід’ємну суму, не більше двох знаків після коми.'
    setErrors(next)
    if (Object.keys(next).length) { form.current?.querySelector<HTMLInputElement>(`[data-plan-field="${Object.keys(next)[0]}"]`)?.focus(); return }
    saving.current = true; setBusy(true)
    try { const result = await window.hromadaAid.reports.annualPlanSave({year,aidTypeId:type.id,plannedRecipientCount:count,plannedAmountMinor:amount!}, plan?.updatedAt); if (!result.ok) setError(result.message ?? 'Не вдалося зберегти план.'); else onSaved() }
    catch { setError('Не вдалося зберегти план. Введені дані залишено у формі.') }
    finally { saving.current = false; setBusy(false) }
  }
  return <Modal title={plan ? 'Редагувати план' : 'Встановити план'} description="Річні показники для обраного виду допомоги." busy={busy} dirty={dirty} onClose={onClose} size="large"><form ref={form} className="catalog-form recipient-card-form" noValidate onSubmit={event => void save(event)}>
    <dl className="plan-context"><div><dt>Обліковий рік</dt><dd>{year}</dd></div><div><dt>Програма</dt><dd>{program.shortName}</dd></div><div><dt>Вид допомоги</dt><dd>{type.shortName}</dd></div></dl>
    {([{key:'count',label:'План отримувачів'},{key:'amount',label:'Планова сума, грн'}] as const).map(({key,label}) => <label className="recipient-field" key={key}><span>{label} *</span><input data-plan-field={key} disabled={busy} inputMode={key === 'count' ? 'numeric' : 'decimal'} value={draft[key]} onChange={event => update(key,event.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `plan-error-${key}` : undefined}/>{errors[key] && <small id={`plan-error-${key}`} className="recipient-field-error">{errors[key]}</small>}</label>)}
    {error && <Alert variant="error">{error}</Alert>}
    <div className="recipient-form-actions recipient-card-actions"><div><button type="button" className="secondary-button assignment-cancel-button" disabled={busy} onClick={() => confirmModalClose(dirty,onClose)}><X size={17}/>Скасувати</button><button type="submit" className="primary-button" disabled={busy}><Check size={17}/>{busy ? 'Зберігаємо…' : 'Зберегти план'}</button></div></div>
  </form></Modal>
}
