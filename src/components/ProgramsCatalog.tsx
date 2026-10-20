import Alert from './Alert'
import DataState from './DataState'
import { ContentSkeleton } from './Skeleton'
import { useId, useRef, useState, type DragEvent } from 'react'
import { ChevronDown, GripVertical, HandCoins, Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import type { AidTypeOption, CatalogOrderInput, ProgramOption } from '../../electron/api-contract'
import Modal from './Modal'
import { programTone } from '../lib/programTone'
import { formatDate } from '../lib/dates'

type Props = {
  loading?: boolean
  error?: string
  onRetry?: () => void
  programs: ProgramOption[]
  aidTypes: AidTypeOption[]
  onEditProgram: (program?: ProgramOption) => void
  onEditAid: (aid?: AidTypeOption, programId?: string) => void
  ordering: boolean
  onReorder: (input: CatalogOrderInput) => Promise<boolean>
  onDelete: (entity: 'program' | 'aidType', id: string) => void
}

export default function ProgramsCatalog({ programs, aidTypes, onEditProgram, onEditAid, onDelete, ordering, onReorder, loading = false, error, onRetry }: Props) {
  const id = useId()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [viewId, setViewId] = useState<string | null>(null)
  type DragItem = { kind: 'program' | 'aidType'; id: string; programId?: string }
  const dragging = useRef<DragItem | null>(null)
  const [dragId, setDragId] = useState('')
  const [overId, setOverId] = useState('')
  const [notice, setNotice] = useState('')
  const moving = useRef(false)
  const allowed = (target: DragItem) => dragging.current?.kind === target.kind && dragging.current?.programId === target.programId
  const finish = () => { dragging.current = null; setDragId(''); setOverId('') }
  const move = async (source: DragItem, targetId: string) => {
    if (ordering || moving.current || source.id === targetId) return
    const ids = (source.kind === 'program' ? programs : aidTypes.filter(type => type.programId === source.programId)).map(item => item.id)
    const from = ids.indexOf(source.id), to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    moving.current = true; setNotice('Зберігаємо порядок…')
    try { setNotice(await onReorder({ kind: source.kind, programId: source.programId, ids }) ? 'Порядок збережено.' : 'Порядок не змінено.') }
    finally { moving.current = false }
  }
  const dropProps = (target: DragItem) => ({
    onDragOver: (event: DragEvent) => { if (allowed(target) && !ordering) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setOverId(target.id) } },
    onDrop: (event: DragEvent) => { if (!allowed(target)) return; event.preventDefault(); event.stopPropagation(); const source = dragging.current!; finish(); void move(source, target.id) },
  })
  const handle = (item: DragItem, name: string) => <button type="button" className="catalog-sort-handle" draggable={!ordering} aria-disabled={ordering}
    aria-label={`Змінити порядок: ${name}`} aria-describedby={`${id}-sort-help`} title="Перетягніть або натисніть Alt + ↑ / ↓"
    onDragStart={event => { if (ordering) { event.preventDefault(); return }; event.stopPropagation(); dragging.current = item; setDragId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }}
    onDragEnd={finish} onKeyDown={event => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const ids = (item.kind === 'program' ? programs : aidTypes.filter(type => type.programId === item.programId)).map(value => value.id)
      const next = ids[ids.indexOf(item.id) + (event.key === 'ArrowUp' ? -1 : 1)]
      if (next) void move(item, next)
    }}><GripVertical size={17} aria-hidden="true"/></button>
  const viewed = aidTypes.find(type => type.id === viewId)
  const viewedProgram = programs.find(program => program.id === viewed?.programId)
  const grouped = new Map<string, AidTypeOption[]>()
  for (const type of aidTypes) {
    const group = grouped.get(type.programId) ?? []
    group.push(type); grouped.set(type.programId, group)
  }
  const toggle = (programId: string) => setCollapsed(current => {
    const next = new Set(current)
    if (next.has(programId)) next.delete(programId)
    else next.add(programId)
    return next
  })
  return <div className="programs-catalog" aria-busy={ordering || loading}>
    <span id={`${id}-sort-help`} className="visually-hidden">Перетягніть за ручку або використовуйте Alt зі стрілками вгору та вниз. Види допомоги можна переміщувати лише в межах своєї програми.</span><span role="status" aria-label="Порядок довідника" className="visually-hidden">{notice}</span>
    <header className="registry-toolbar"><div><h2>Програми та допомоги</h2><p>Види матеріальної допомоги, згруповані за програмами.</p></div><button type="button" className="primary-button" disabled={ordering || loading || Boolean(error)} onClick={() => onEditProgram()}><Plus size={17}/>Додати програму</button></header>
    {loading && !programs.length ? <ContentSkeleton label="Завантажуємо програми та види допомоги…" lines={6}/> : error ? <Alert variant="error" action={onRetry && <button type="button" onClick={onRetry}>Повторити завантаження</button>}>{error}</Alert> : !loading && !programs.length && <DataState kind="empty" message="Програм ще немає" description="Додайте програму, щоб створити її види допомоги."/>}
    {!error && programs.map(program => {
      const types = grouped.get(program.id) ?? []
      const expanded = !collapsed.has(program.id)
      return <section className={`program-catalog-block ${programTone(program.id)}${dragId === program.id ? ' catalog-dragging' : ''}${overId === program.id ? ' catalog-drag-over' : ''}`} key={program.id} {...dropProps({ kind: 'program', id: program.id })} aria-labelledby={`${id}-${program.id}-title`}>
        <header className="program-catalog-header">
          <div className="program-catalog-title">{handle({ kind: 'program', id: program.id }, program.shortName)}<span className="program-catalog-icon"><Landmark size={20}/></span><div><h3 id={`${id}-${program.id}-title`}>{program.shortName}{!program.isActive && <small className="catalog-inactive">Неактивна</small>}</h3><p>{program.approvalNumber ? `Рішення № ${program.approvalNumber} від ${formatDate(program.approvalDate)}` : 'Види матеріальної допомоги в межах програми'}</p><span className="program-type-count">Видів допомоги: {types.length}</span></div></div>
          <div className="program-catalog-actions"><button type="button" className="table-action" disabled={ordering} aria-label={`Редагувати програму «${program.shortName}»`} title="Редагувати програму" onClick={() => onEditProgram(program)}><Pencil size={17}/></button><button type="button" className="table-action danger-action" disabled={ordering} aria-label={`Видалити програму «${program.shortName}»`} title="Видалити програму" onClick={() => onDelete('program', program.id)}><Trash2 size={17}/></button><button type="button" className="program-collapse" aria-label={`${expanded ? 'Згорнути' : 'Розгорнути'} види допомоги: ${program.shortName}`} aria-expanded={expanded} aria-controls={`${id}-${program.id}-list`} onClick={() => toggle(program.id)}><ChevronDown size={18}/></button></div>
        </header>
        <div id={`${id}-${program.id}-list`} hidden={!expanded}>
          {types.length ? <ul className="program-aid-list">{types.map(type => <li key={type.id} className={`${dragId === type.id ? 'catalog-dragging' : ''}${overId === type.id ? ' catalog-drag-over' : ''}`} {...dropProps({ kind: 'aidType', id: type.id, programId: program.id })}>
            {handle({ kind: 'aidType', id: type.id, programId: program.id }, type.shortName)}
            <button type="button" className="program-aid-open" onClick={() => setViewId(type.id)}><HandCoins size={17}/><span>{type.shortName}{!type.isActive && <small className="catalog-inactive">Неактивний</small>}</span></button>
            <span className="program-aid-count">Призначень: <strong>{type.assignmentCount}</strong></span>
            <div className="program-catalog-actions"><button type="button" className="table-action" disabled={ordering} aria-label={`Редагувати вид допомоги «${type.shortName}»`} title="Редагувати вид допомоги" onClick={() => onEditAid(type)}><Pencil size={16}/></button><button type="button" className="table-action danger-action" disabled={ordering} aria-label={`Видалити вид допомоги «${type.shortName}»`} title="Видалити вид допомоги" onClick={() => onDelete('aidType', type.id)}><Trash2 size={16}/></button></div>
          </li>)}</ul> : <DataState kind="empty" compact message="У програмі поки немає видів допомоги."/>}
        </div>
        <footer className="program-catalog-footer" hidden={!expanded}><button type="button" className="secondary-button" disabled={ordering || !program.isActive} title={!program.isActive ? 'У неактивну програму не можна додавати нові види допомоги' : undefined} onClick={() => onEditAid(undefined, program.id)}><Plus size={16}/>Додати вид допомоги</button></footer>
      </section>
    })}
    {viewed && <Modal title="Вид допомоги" description="Відомості довідника та зв’язок із програмою." headerIcon={<HandCoins size={22}/>} size="large" onClose={() => setViewId(null)} className="catalog-details-modal">
      <dl className="catalog-details"><div><dt>Коротка назва</dt><dd>{viewed.shortName}</dd></div><div><dt>Повна офіційна назва</dt><dd>{viewed.officialName}</dd></div><div><dt>Програма</dt><dd>{viewedProgram?.shortName ?? 'Програму не знайдено'}</dd></div><div><dt>Кількість пов’язаних призначень</dt><dd>{viewed.assignmentCount}</dd></div>{viewed.direction && <div><dt>Напрям</dt><dd>{viewed.direction}</dd></div>}{viewed.fundingSource && <div><dt>Джерело фінансування</dt><dd>{viewed.fundingSource}</dd></div>}</dl>
      <div className="recipient-form-actions recipient-card-actions"><div><button type="button" className="secondary-button" onClick={() => setViewId(null)}>Закрити</button><button type="button" className="primary-button" onClick={() => { setViewId(null); onEditAid(viewed) }}><Pencil size={17}/>Редагувати</button></div></div>
    </Modal>}
  </div>
}
