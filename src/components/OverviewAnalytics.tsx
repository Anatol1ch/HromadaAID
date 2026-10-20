import DataState from './DataState'
import { useId, useState } from 'react'
import { Banknote, ChartNoAxesCombined, Users } from 'lucide-react'
import type { AidTypeOption, DashboardData, ProgramOption } from '../../electron/api-contract'
import { ASSIGNMENT_STATUSES, assignmentStatusColor } from '../../electron/assignment-model'
import { overviewMoney as money, overviewPercent as percent, overviewRows, overviewTypeGroups } from '../lib/overview'

const monthNames = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const fullMonthNames = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
type Props = {
  data: DashboardData
  catalogs: { programs: ProgramOption[]; aidTypes: AidTypeOption[] }
  programs: ReturnType<typeof overviewRows>['programs']
  types: ReturnType<typeof overviewRows>['types']
  year: number
}

export default function OverviewAnalytics({ data, catalogs, programs, types, year }: Props) {
  const maxType = Math.max(...types.map(type => type.amountMinor), 1)
  const matched = new Set<Props['programs'][number]>()
  const distribution = catalogs.programs.map(program => {
    const value = programs.find(item => item.programId === program.id || (!item.programId && item.programName === program.shortName))
    if (value) matched.add(value)
    return { id: program.id, name: program.shortName, amount: value?.amountMinor ?? 0 }
  })
  distribution.push(...programs.filter(program => !matched.has(program)).map((program, index) => ({ id: program.programId ?? `legacy-${index}`, name: program.programName, amount: program.amountMinor })))
  const statuses = ASSIGNMENT_STATUSES.map(status => ({ status, count: data.statusCounts?.find(item => item.status === status)?.count ?? 0 }))
  const statusTotal = statuses.reduce((sum, item) => sum + item.count, 0)
  const sex = data.paidBySex ?? { male: 0, female: 0, unknown: 0 }
  const knownSexCount = sex.male + sex.female
  const vpo = data.paidVpo ?? { count: 0, amountMinor: 0 }
  const genderRows = [{ label: 'Чоловіки', count: sex.male }, { label: 'Жінки', count: sex.female }]

  return <div className="overview-analytics">
    <div className="overview-analysis-grid">
      <section className="dashboard-panel overview-types" aria-labelledby="overview-types-title">
        <header className="overview-section-heading"><div><h2 id="overview-types-title">Структура допомог</h2><p>Призначення за програмами та видами допомоги.</p></div></header>
        {catalogs.programs.length || types.length ? <div className="overview-type-list">{overviewTypeGroups(types, catalogs).map(group => <section className="overview-type-group" key={group.id}>
          <header><h3>{group.name}</h3><strong>{money(group.amountMinor)}</strong></header>
          <div>{group.types.map((type, index) => <article className="overview-type-row" key={type.aidTypeId ?? `${index}-${type.aidTypeName}`}>
            <div><strong>{type.aidTypeName}</strong><span>{money(type.amountMinor)}</span></div>
            <div className="overview-type-meta"><small>Призначень: {type.count}</small><div className="overview-track" aria-hidden="true"><span style={{ width: `${type.amountMinor / maxType * 100}%` }}/></div></div>
          </article>)}</div>
        </section>)}</div> : <Empty text="Видів допомоги поки немає"/>}
      </section>

    </div>

    <div className="overview-summary-grid">
        <section className="dashboard-panel overview-distribution" aria-labelledby="overview-distribution-title">
          <header className="overview-section-heading"><div><h2 id="overview-distribution-title">Розподіл за програмами</h2><p>Частка у загальній призначеній сумі.</p></div><ChartNoAxesCombined size={19} aria-hidden="true"/></header>
          {distribution.length ? <div className="overview-distribution-list">{distribution.map(program => <article key={program.id}>
            <strong>{program.name}</strong><div><span>{money(program.amount)}</span><b>{percent(program.amount, data.totalMinor)}</b></div>
            <div className="overview-track" aria-hidden="true"><span style={{ width: `${data.totalMinor > 0 ? Math.min(program.amount / data.totalMinor * 100, 100) : 0}%` }}/></div>
          </article>)}</div> : <Empty text="Програм для відображення поки немає"/>}
        </section>
        <section className="dashboard-panel overview-dynamics" aria-labelledby="overview-dynamics-title">
          <header className="overview-section-heading"><div><h2 id="overview-dynamics-title">Динаміка призначень</h2><p>За місяцем рішення у {year} році.</p></div></header>
          <MonthlyChart amounts={data.monthlyAmountMinor} counts={data.monthlyAssignmentCount ?? Array(12).fill(0)}/>
          {!data.assignmentCount && <p className="overview-chart-note">За {year} рік призначень немає.</p>}
        </section>
      <section className="dashboard-panel overview-statuses" aria-labelledby="overview-status-title">
        <header className="overview-section-heading"><div><h2 id="overview-status-title">Виконання за статусами</h2><p>Усі статуси за роком рішення.</p></div></header>
        <div className="overview-status-stack" role="img" aria-label={statusTotal ? statuses.map(item => `${item.status}: ${item.count}`).join('; ') : 'Призначень немає'}>
          {statuses.filter(item => item.count > 0).map(item => <span key={item.status} className={`status-${assignmentStatusColor[item.status]}`} style={{ width: `${item.count / statusTotal * 100}%` }} title={`${item.status}: ${item.count} (${percent(item.count, statusTotal)})`} aria-hidden="true"/>)}
        </div>
        <ul className="overview-status-legend">{statuses.map(item => <li key={item.status}><span className={`status-badge status-${assignmentStatusColor[item.status]}`}>{item.status}</span><strong>{item.count}</strong></li>)}</ul>
        <p className="overview-chart-note">Усього у реєстрі: {statusTotal}</p>
      </section>

      <section className="dashboard-panel overview-gender" aria-labelledby="overview-gender-title">
        <header className="overview-section-heading"><div><h2 id="overview-gender-title">Виплачені допомоги за статтю</h2><p>За датою фактичної виплати.</p></div><Users size={19} aria-hidden="true"/></header>
        <div className="overview-sex-chart" role="img" aria-label={genderRows.map(row => `${row.label}: ${row.count} (${percent(row.count, knownSexCount)})`).join('; ')}>
          {genderRows.map(row => <span key={row.label} style={{ width: `${knownSexCount ? row.count / knownSexCount * 100 : 0}%` }} aria-hidden="true"/>)}
        </div>
        <dl className="overview-gender-values">{genderRows.map((row, index) => <div key={row.label}><dt><i className={`overview-gender-dot overview-gender-dot-${index}`} aria-hidden="true"/>{row.label}</dt><dd><strong>{row.count}</strong><span>{percent(row.count, knownSexCount)}</span></dd></div>)}</dl>
        {sex.unknown > 0 && <p className="overview-chart-note">Без зазначеної статі: {sex.unknown}</p>}
        {!data.paidCount && <p className="overview-chart-note">Виплачених допомог за {year} рік немає.</p>}
      </section>

      <section className="dashboard-panel overview-vpo" aria-labelledby="overview-vpo-title">
        <header className="overview-section-heading"><div><h2 id="overview-vpo-title">Виплачені допомоги ВПО</h2><p>За датою фактичної виплати.</p></div><Banknote size={19} aria-hidden="true"/></header>
        <dl className="overview-vpo-values"><div><dt>Кількість допомог</dt><dd>{vpo.count}</dd></div><div><dt>Фактично виплачено</dt><dd>{money(vpo.amountMinor)}</dd></div></dl>
        <div className="overview-vpo-share"><span>Частка виплачених допомог</span><strong>{percent(vpo.count, data.paidCount)}</strong></div>
        <div className="overview-track" aria-hidden="true"><span style={{ width: `${data.paidCount ? vpo.count / data.paidCount * 100 : 0}%` }}/></div>
      </section>
    </div>
  </div>
}

function Empty({ text }: { text: string }) { return <DataState kind="empty" compact message={text}/> }

function MonthlyChart({ amounts, counts }: { amounts: number[]; counts: number[] }) {
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const maximum = Math.max(...amounts, 1)
  return <div className="overview-month-chart" role="group" aria-label="Призначення за місяцями">{fullMonthNames.map((month, index) => {
    const amount = amounts[index] ?? 0, count = counts[index] ?? 0
    return <div key={month} className="overview-month-column" role="img" tabIndex={0}
      aria-label={`${month}: призначень ${count}, ${money(amount)}`} aria-describedby={active === index ? `${id}-${index}` : undefined}
      onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setActive(null) } }}>
      <div className="overview-month-bar-space" aria-hidden="true"><span style={{ height: `${amount / maximum * 100}%` }}/></div><span aria-hidden="true">{monthNames[index]}</span>
      {active === index && <span className="overview-month-tooltip" id={`${id}-${index}`} role="tooltip"><strong>{month}</strong><span>Призначень: {count}</span><span>{money(amount)}</span></span>}
    </div>
  })}</div>
}
