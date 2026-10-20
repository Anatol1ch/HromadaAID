import { MetricSkeleton } from './components/Skeleton'
import Alert from './components/Alert'
import OverviewAnalytics from './components/OverviewAnalytics'
import { Activity, ArrowDownToLine, Banknote, ClipboardCheck, HandCoins, RefreshCw, Users } from 'lucide-react'
import { useReportingYear } from './context/YearContext'
import { useOverviewData } from './components/useOverviewData'
import { overviewMoney as money, overviewRows } from './lib/overview'

export default function Dashboard() {
  const { year } = useReportingYear()
  const { data, catalogs, loading, error, refresh } = useOverviewData(year)
  const { programs, types } = data ? overviewRows(data, catalogs) : { programs: [], types: [] }
  const cards = data ? [
    { label: 'Призначено допомог', value: String(data.assignmentCount), note: 'За роком рішення, без очікування', icon: ClipboardCheck },
    { label: 'Фактично отримали', value: String(data.paidCount), note: 'Кількість виплачених призначень', icon: Users },
    { label: 'Призначено на суму', value: money(data.totalMinor), note: 'Без статусу «Очікує рішення»', icon: HandCoins },
    { label: 'Фактично витрачено', value: money(data.paidTotalMinor), note: 'Лише «Виплачено», за датою виплати', icon: Banknote },
  ] : []
  const comparisonMax = Math.max(data?.totalMinor ?? 0, data?.paidTotalMinor ?? 0, 1)
  return <div className="overview-page">
    <section className="page-heading overview-heading"><div><div className="eyebrow">АНАЛІТИКА • {year} РІК</div><h1>Огляд</h1><p className="subtitle">Призначена допомога та фактичні видатки за обраний обліковий рік.</p></div><button type="button" className="secondary-button overview-refresh-button" disabled={loading} aria-busy={loading} onClick={() => void refresh()}><RefreshCw className={loading ? 'overview-refresh-icon is-spinning' : 'overview-refresh-icon'} size={16} aria-hidden="true"/>{loading ? 'Оновлення…' : 'Оновити'}</button></section>
    {error && <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити</button>}>{error}</Alert>}
    {loading && !data && <MetricSkeleton/>}
    {data && <div className="overview-body" aria-busy={loading}>
      <section className="overview-kpis" aria-label={`Показники за ${year} рік`}>{cards.map(({ label, value, note, icon: Icon }) => <article className="overview-kpi" key={label}><div><span>{label}</span><Icon size={19} aria-hidden="true"/></div><strong>{value}</strong><small>{note}</small></article>)}</section>
      {!data.assignmentCount && !data.paidCount && <Alert variant="info"><div><strong>За {year} рік фінансових призначень немає</strong><span>Після внесення призначень показники оновляться. Записи зі статусом «Очікує рішення» не включаються до підсумків.</span></div></Alert>}
      <section className="dashboard-panel overview-programs" aria-labelledby="overview-programs-title"><header className="overview-section-heading"><div><h2 id="overview-programs-title">Виконання програм</h2><p>Призначені суми, фактичні видатки та річний план.</p></div><span>Програм: {programs.length}</span></header>
        {programs.length ? <div className="overview-program-list">{programs.map((program, index) => {
          const percent = program.plannedMinor && program.plannedMinor > 0 ? Math.round(program.paidMinor / program.plannedMinor * 100) : null
          return <article className="overview-program-row" key={program.programId ?? `${index}-${program.programName}`}><div className="overview-program-name"><strong>{program.programName}</strong><span>{percent !== null ? `${percent}% річного плану виконано` : program.plannedMinor === 0 ? 'Річний план: 0,00 ₴' : 'Планові дані не налаштовано'}</span></div><dl><div><dt>Річний план</dt><dd>{program.plannedMinor === null ? '—' : money(program.plannedMinor)}</dd></div><div><dt>Призначено</dt><dd>{money(program.amountMinor)}</dd></div><div><dt>Фактично витрачено</dt><dd>{money(program.paidMinor)}</dd></div></dl>{percent !== null && <div className="overview-track overview-program-track" role="progressbar" aria-label={`Виконання програми ${program.programName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-valuetext={`${percent}% річного плану`}><span style={{ width: `${Math.min(percent, 100)}%` }}/></div>}</article>
        })}</div> : <Empty text="Програм для відображення поки немає"/>}
      </section>
      <section className="dashboard-panel overview-comparison" aria-labelledby="overview-comparison-title"><header className="overview-section-heading"><div><h2 id="overview-comparison-title">Призначено та виплачено</h2><p>Окремі показники обсягу призначень і фактичних видатків.</p></div><ArrowDownToLine size={19} aria-hidden="true"/></header><div className="overview-comparison-rows">{[{ label: 'Призначено', amount: data.totalMinor }, { label: 'Фактично витрачено', amount: data.paidTotalMinor }].map(item => <div className="overview-comparison-row" key={item.label}><div><span>{item.label}</span><strong>{money(item.amount)}</strong></div><div className="overview-track" aria-hidden="true"><span style={{ width: `${item.amount / comparisonMax * 100}%` }}/></div></div>)}</div></section>
      <OverviewAnalytics data={data} catalogs={catalogs} programs={programs} types={types} year={year}/>
      <p className="overview-accounting-note">Призначення враховано за датою рішення, фактичні видатки — за датою виплати. {data.demo && 'У показниках є демонстраційні картки.'}</p>
    </div>}
  </div>
}

function Empty({ text }: { text: string }) { return <div className="overview-section-empty"><Activity size={22} aria-hidden="true"/><span>{text}</span></div> }

