import { navigateTabs } from './lib/tabNavigation'
import DataState from './components/DataState'
import { ContentSkeleton } from './components/Skeleton'
import Alert from './components/Alert'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileText, LoaderCircle } from 'lucide-react'
import { flushSync } from 'react-dom'
import ReportPreviewModal from './components/ReportPreviewModal'
import type { PreparedReport, ReportExportSnapshot, ReportPeriod, ReportSummary } from '../electron/api-contract'
import Select from './components/Select'
import DatePicker from './components/DatePicker'
import ConfirmDialog from './components/ConfirmDialog'
import { useReportingYear } from './context/YearContext'
import { useCatalogUpdates } from './services/catalogRepository'
import { isIsoCalendarDate, parseDateInput } from './lib/dates'
import { reportBudgetCode, reportTitle, reportCount, reportGroups, reportInstitution, reportPeriodText, reportMoney, reportNumbers, reportTotals } from './lib/reporting'

const months = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
const modes = [{id:'month',label:'Місяць'},{id:'quarter',label:'Квартал'},{id:'annual',label:'Рік'},{id:'cumulative',label:'Від початку року'}] as const
type Mode = typeof modes[number]['id']
type ReportFit = { font: number; fits: boolean; ready: boolean; widths: number[] }
type FrozenReport = { snapshot: ReportExportSnapshot; fit: ReportFit }
// A4 portrait with 13 mm margins; reserve a further 2 mm for print rounding.
const printAreaMm = { width: 184, height: 269 }

function ReportTable({ summary, cumulative, footer = true, footerLabel = 'Загальний підсумок', printLayout = false, printWidths }: { summary: ReportSummary; cumulative: boolean; footer?: boolean; footerLabel?: string; printLayout?: boolean; printWidths?: number[] }) {
  const columns = cumulative ? 7 : 3
  const cells = (values: number[]) => (cumulative ? values : values.slice(2,4)).map((value,index) => <td key={index} className={printLayout ? 'report-number' : undefined}>{printLayout ? <span className="report-number-value">{(index % 2 ? reportMoney(value) : reportCount(value)).replace(/ /g, '\u00a0')}</span> : index % 2 ? reportMoney(value) : reportCount(value)}</td>)
  return <table className={`aid-report-table ${cumulative ? 'aid-report-cumulative' : ''}`}><colgroup><col style={printLayout && printWidths ? {width:printWidths[0]} : undefined}/>{Array.from({length:columns-1},(_,index)=><col key={index} style={printLayout && printWidths ? {width:printWidths[index+1]} : undefined}/>)}</colgroup><thead>{cumulative ? <><tr><th rowSpan={2} scope="col">Вид допомоги</th>{['ПЛАН','ФАКТ','РІЗНИЦЯ'].map(label=><th key={label} colSpan={2} scope="colgroup">{label}</th>)}</tr><tr>{Array.from({length:3},(_,index)=><FragmentHead key={index}/>)}</tr></> : <tr><th scope="col">Вид допомоги</th><th scope="col">Кількість виплачених допомог</th><th scope="col">Фактично виплачена сума</th></tr>}</thead>
    {reportGroups(summary).map(group=><tbody key={group.id}><tr className="aid-report-program"><th scope="row">{group.name}</th>{cells(reportTotals(group.rows))}</tr>{group.rows.map(row=><tr key={row.aidTypeId}><th scope="row">{row.officialName}</th>{cells(reportNumbers(row))}</tr>)}</tbody>)}
    {footer && <tfoot><tr><th scope="row">{footerLabel}</th>{cells(reportTotals(summary.rows))}</tr></tfoot>}</table>
}
function FragmentHead() { return <><th scope="col">Отримувачі</th><th scope="col">Сума</th></> }


function ScreenReport({ summary, cumulative }: { summary: ReportSummary; cumulative: boolean }) {
  const totals = reportTotals(summary.rows)
  const values = cumulative ? totals : totals.slice(2, 4)
  return <div className="screen-report-groups">{reportGroups(summary).map(group => <section className="screen-report-program" key={group.id} aria-label={group.name}>
    <div className="reporting-table-scroll"><ReportTable summary={{...summary, programs: [{id: group.id, officialName: group.name, shortName: group.name}], rows: group.rows}} cumulative={cumulative} footerLabel="Разом за програмою"/></div>
  </section>)}<section className="screen-report-total" aria-label="Загальний підсумок звіту"><div className="reporting-table-scroll"><table className={`aid-report-table ${cumulative ? 'aid-report-cumulative' : ''}`}><colgroup><col/>{values.map((_, index) => <col key={index}/>)}</colgroup><tfoot><tr><th scope="row">Загальний підсумок</th>{values.map((value, index) => <td key={index}>{index % 2 ? reportMoney(value) : reportCount(value)}</td>)}</tr></tfoot></table></div></section></div>
}

export default function Reports() {
  const {year} = useReportingYear()
  const [mode,setMode] = useState<Mode>('month'), [value,setValue] = useState(1)
  const [date,setDate] = useState({year,value:`${year}-12-31`})
  const [dateInvalid,setDateInvalid] = useState(false)
  useEffect(()=>setDateInvalid(false),[year])
  const endDate = date.year === year ? date.value : `${year}-12-31`
  const validDate = !dateInvalid && isIsoCalendarDate(endDate) && endDate.startsWith(`${year}-`)
  const period = useMemo<ReportPeriod>(()=>mode === 'month' ? {kind:'month',value} : mode === 'quarter' ? {kind:'quarter',value} : mode === 'annual' ? {kind:'annual'} : {kind:'year-to-date',endDate},[mode,value,endDate])
  const periodText = reportPeriodText(year,period)
  const [summary,setSummary] = useState<ReportSummary|null>(null), [error,setError] = useState(''), [loading,setLoading] = useState(true)
  const [loadedSelection, setLoadedSelection] = useState('')
  const selectionKey = JSON.stringify([year, period])
  const sequence = useRef(0)
  const refresh = useCallback(async()=>{
    const request = ++sequence.current; setSummary(null); setError('')
    if (mode === 'cumulative' && !validDate) { setLoading(false); return }
    setLoading(true)
    try { const result = await window.hromadaAid.reports.summary(year,period); if(request===sequence.current) { setSummary(result); setLoadedSelection(JSON.stringify([year,period])) } }
    catch { if(request===sequence.current) setError('Не вдалося завантажити звіт. Повторіть спробу.') }
    finally { if(request===sequence.current) setLoading(false) }
  },[year,period,mode,validDate])
  useEffect(()=>{void refresh();return()=>{++sequence.current}},[refresh])
  useCatalogUpdates(()=>void refresh())
  const [printSnapshot, setPrintSnapshot] = useState<FrozenReport | null>(null)
  const [preview, setPreview] = useState<PreparedReport | null>(null)
  const documentRef = useRef<PreparedReport | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode replays effects synchronously; release only after a real unmount.
      queueMicrotask(() => {
        if (!mounted.current && documentRef.current) {
          void window.hromadaAid.reports.release(documentRef.current.id).catch(() => {})
          documentRef.current = null
        }
      })
    }
  }, [])
  const paper = useRef<HTMLElement>(null)
  const [fit,setFit] = useState({font:9.5,fits:true,ready:false,widths:[] as number[]})
  useLayoutEffect(()=>{
    if (printSnapshot) return
    let current=true
    setFit(previous=>({...previous,ready:false}))
    void document.fonts.ready.then(()=>{
      if(!current || !paper.current || !summary) return
      const element=paper.current
      const table=element.querySelector<HTMLTableElement>('table')
      if(!table) return
      const cols=Array.from(table.querySelectorAll<HTMLTableColElement>('col'))
      const context=document.createElement('canvas').getContext('2d')
      let font=7.5,fits=false,widths:number[]=[]
      for(const size of [9.5,9,8.5,8,7.5]) {
        element.style.fontSize=`${size}pt`; font=size
        const header=table.querySelector(mode==='cumulative'?'thead tr:nth-child(2) th':'thead th')!
        if(context) { const style=getComputedStyle(header); context.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}` }
        // Reserve each numeric column's actual unbroken text width, including bold totals.
        const numbers=cols.slice(1).map((_,index)=>{
          const cells=Array.from(table.querySelectorAll<HTMLTableCellElement>(`tbody tr > td:nth-child(${index+2}), tfoot tr > td:nth-child(${index+2})`))
          const content=Math.max(0,...cells.map(cell=>{
            const style=getComputedStyle(cell)
            return (cell.querySelector('.report-number-value')?.getBoundingClientRect().width??0)+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+3
          }))
          const caption=mode==='cumulative' && index%2===0 ? (context?.measureText('Отримувачі').width??50)+7 : 0
          return Math.ceil(Math.max(content,caption,mode==='cumulative'?0:index===0?88:112))
        })
        const available=table.parentElement!.clientWidth
        widths=[available-numbers.reduce((sum,width)=>sum+width,0),...numbers]
        cols.forEach((col,index)=>{col.style.width=`${Math.max(1,widths[index])}px`})
        const values=Array.from(table.querySelectorAll<HTMLElement>('.report-number-value'))
        const noOverflow=values.every(span=>span.getBoundingClientRect().width+3<=span.parentElement!.clientWidth) && Array.from(table.querySelectorAll<HTMLElement>('thead th')).every(cell=>getComputedStyle(cell).whiteSpace!=='nowrap'||cell.scrollWidth<=cell.clientWidth+1)
        // Leave 2 mm for print rounding; never shrink below 7.5 pt.
        if(widths[0]>=180 && noOverflow && element.getBoundingClientRect().height<=printAreaMm.height*96/25.4 && element.scrollWidth<=Math.ceil(printAreaMm.width*96/25.4)) {fits=true;break}
      }
      setFit({font,fits,ready:true,widths})
    })
    return()=>{current=false}
  },[summary,mode,printSnapshot])
  const [busy,setBusy]=useState(false), inFlight=useRef(false)
  const [pending,setPending]=useState<FrozenReport|null>(null)
  const generate = async (frozen: FrozenReport) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    // Commit the frozen paper before Chromium captures it. Background catalog/year
    // refreshes may update the screen, but cannot alter this print stage.
    flushSync(() => { setPrintSnapshot(frozen); setPending(null) })
    try {
      await document.fonts.ready
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!mounted.current) return
      const result = await window.hromadaAid.reports.generate(frozen.snapshot)
      if (!mounted.current) {
        if (result.ok) void window.hromadaAid.reports.release(result.document.id).catch(() => {})
        return
      }
      if (!result.ok) { setError(result.message); setPrintSnapshot(null); return }
      documentRef.current = result.document; setPreview(result.document)
    } catch {
      if (mounted.current) { setError('Не вдалося сформувати звіт. Повторіть спробу.'); setPrintSnapshot(null) }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  const request = () => {
    if (!summary || loading || !fit.ready || busy || inFlight.current || loadedSelection !== selectionKey) return
    const frozen: FrozenReport = {
      snapshot: { kind: mode, period: structuredClone(period), periodRange: periodText.range, summary: structuredClone(summary) },
      fit: structuredClone(fit),
    }
    if (!fit.fits) setPending(frozen)
    else void generate(frozen)
  }
  const closePreview = () => {
    const id = documentRef.current?.id
    documentRef.current = null; setPreview(null); setPrintSnapshot(null)
    if (id) void window.hromadaAid.reports.release(id).catch(() => {})
  }
  const cumulative=mode==='cumulative'
  const title=reportTitle(mode)
  const printSummary=printSnapshot?.snapshot.summary ?? summary
  const printKind=printSnapshot?.snapshot.kind ?? mode
  const printFit=printSnapshot?.fit ?? fit
  const printRange=printSnapshot?.snapshot.periodRange ?? periodText.range
  return <div className="reporting-page">
    <section className="page-heading"><div><div className="eyebrow">МАТЕРІАЛЬНА ДОПОМОГА • ФАКТИЧНІ ВИПЛАТИ</div><h1>Звітність</h1><p className="subtitle">Усі програми та види допомоги, включно з нульовими показниками.</p></div></section>
    <div className="dictionary-tabs report-mode-segments" role="tablist" aria-label="Період звіту" onKeyDown={navigateTabs}>{modes.map(item=><button key={item.id} id={`report-tab-${item.id}`} data-tab-key={item.id} aria-controls="report-content" tabIndex={mode===item.id?0:-1} role="tab" aria-selected={mode===item.id} className={mode===item.id?'active':''} disabled={busy} onClick={()=>{setMode(item.id);setValue(1);setDateInvalid(false)}}>{item.label}</button>)}</div>
    <section className="reporting-controls recipient-card-form"><div className="reporting-toolbar"><div className="reporting-period">{mode==='month'&&<label className="recipient-field"><span>Місяць</span><Select label="Місяць" searchable={false} value={String(value)} options={months.map((label,index)=>({value:String(index+1),label}))} onChange={next=>setValue(Number(next))} disabled={busy}/></label>}{mode==='quarter'&&<label className="recipient-field"><span>Квартал</span><Select label="Квартал" searchable={false} value={String(value)} options={[1,2,3,4].map(quarter=>({value:String(quarter),label:`${quarter} квартал`}))} onChange={next=>setValue(Number(next))} disabled={busy}/></label>}{cumulative&&<label htmlFor="report-end-date" className="recipient-field" onChangeCapture={event=>{if(event.target instanceof HTMLInputElement){const iso=parseDateInput(event.target.value);setDateInvalid(!iso||!iso.startsWith(`${year}-`))}}}><span>Кінцева дата</span><fieldset disabled={busy}><DatePicker disabled={busy} id="report-end-date" value={endDate} onChange={next=>{setDateInvalid(false);setDate({year,value:next})}} min={`${year}-01-01`} max={`${year}-12-31`} required/></fieldset>{!validDate&&<small className="recipient-field-error">Вкажіть коректну дату в межах {year} року.</small>}</label>}</div><div className="reporting-actions"><button type="button" className="primary-button" disabled={busy||loading||!summary||!fit.ready||loadedSelection!==selectionKey} aria-busy={busy} onClick={request}>{busy ? <LoaderCircle size={17} className="formation-spinner" aria-hidden="true"/> : <FileText size={17} aria-hidden="true"/>}{busy?'Формуємо звіт…':'Сформувати звіт'}</button></div></div>
    </section>
    {error&&<Alert variant="error" action={<button onClick={()=>void refresh()}>Повторити</button>}>{error}</Alert>}
    {summary&&fit.ready&&!fit.fits&&<Alert variant="warning" role="status">Звіт не вміщується на одному А4 із читабельним шрифтом. Друк та PDF міститимуть усі дані на кількох сторінках.</Alert>}
    <article className="reporting-screen tab-content-enter" key={mode} id="report-content" role="tabpanel" aria-labelledby={`report-tab-${mode}`}><header><p>{reportInstitution}</p><h2>{title}</h2><span>{summary ? mode === 'annual' ? `за ${year} рік` : periodText.label : ''}</span></header>{loading?<ContentSkeleton label="Завантажуємо звіт…" lines={6}/>:summary?<ScreenReport summary={summary} cumulative={cumulative}/>:error ? null : <DataState kind="empty" message="Оберіть коректний звітний період."/>}</article>
    {printSummary&&<div className="report-print-stage" aria-hidden="true"><article ref={paper} className="report-paper" style={{fontSize:`${printFit.font}pt`}}><header><strong className="report-paper-institution">{reportInstitution.toLocaleUpperCase('uk')}</strong><h2>{reportTitle(printKind).toLocaleUpperCase('uk')}</h2><p className="report-paper-code">{reportBudgetCode.toLocaleUpperCase('uk')}</p><p className="report-paper-period">{printRange}</p></header><div className="report-paper-table"><ReportTable summary={printSummary} cumulative={printKind==='cumulative'} printLayout printWidths={printFit.widths.length ? printFit.widths : undefined}/></div></article></div>}
    {pending&&<ConfirmDialog variant="warning" title="Звіт потребує кількох сторінок" message="Усі програми та види допомоги буде збережено без скорочення назв. На одному аркуші А4 звіт не вміщується з мінімальним шрифтом 7,5 пт." confirmLabel="Сформувати всі сторінки" onCancel={()=>setPending(null)} onConfirm={()=>generate(pending)}/>}
    {preview&&<ReportPreviewModal document={preview} onClose={closePreview}/>}
  </div>
}
