import type { DatabaseSync } from 'node:sqlite'
import { resolveAccountingYear } from './accounting-year.js'
import { ASSIGNMENT_STATUSES } from './assignment-model.js'
import type { DashboardData, ReportPeriod, ReportSummary } from './api-contract.js'
type Row = Record<string, string | number | null>

export function dashboardSummary(database: DatabaseSync, yearValue: unknown): DashboardData {
  const year = resolveAccountingYear(yearValue)
  const yearText = String(year)
  const allRows = database.prepare(`SELECT a.recipient_id, r.is_demo, a.amount_minor, a.status, d.decision_date,
    t.id AS aid_type_id, t.short_name AS aid_type_name, p.id AS program_id, p.short_name AS program_name
    FROM assignments a JOIN recipients r ON r.id = a.recipient_id JOIN decisions d ON d.id = a.decision_id
    JOIN aid_types t ON t.id = a.aid_type_id JOIN programs p ON p.id = t.program_id
    WHERE substr(d.decision_date, 1, 4) = ?`).all(yearText) as Row[]
  // Keep the existing legally assigned cohort for every established financial indicator.
  const rows = allRows.filter(row => row.status !== 'Очікує рішення')
  const statusCounts = ASSIGNMENT_STATUSES.map(status => ({ status, count: 0 }))
  for (const row of allRows) {
    const item = statusCounts.find(item => item.status === row.status)
    if (item) item.count++
  }
  const monthlyAmountMinor = Array.from({ length: 12 }, () => 0)
  const monthlyAssignmentCount = Array.from({ length: 12 }, () => 0)
  const aidMap = new Map<string, { aidTypeName: string; programId: string; amountMinor: number; count: number }>()
  const programMap = new Map<string, { programName: string; plannedMinor: number | null; amountMinor: number; paidMinor: number }>(
    (database.prepare('SELECT id, short_name FROM programs WHERE is_active = 1').all() as Row[])
      .map((row) => [String(row.id), { programName: String(row.short_name), plannedMinor: null, amountMinor: 0, paidMinor: 0 }]))
  for (const row of rows) {
    const month = Number(String(row.decision_date).slice(5, 7)) - 1
    if (month >= 0 && month < 12) { monthlyAmountMinor[month] += Number(row.amount_minor); monthlyAssignmentCount[month]++ }
    const typeId = String(row.aid_type_id)
    const item = aidMap.get(typeId) ?? { aidTypeName: String(row.aid_type_name), programId: String(row.program_id), amountMinor: 0, count: 0 }
    item.amountMinor += Number(row.amount_minor); item.count += 1; aidMap.set(typeId, item)
    const key = String(row.program_id)
    const program = programMap.get(key) ?? { programName: String(row.program_name), plannedMinor: null, amountMinor: 0, paidMinor: 0 }
    program.amountMinor += Number(row.amount_minor); programMap.set(key, program)
  }
  const paidRows = database.prepare(`SELECT a.amount_minor, t.program_id, p.short_name AS program_name, r.sex, r.is_vpo
    FROM assignments a JOIN aid_types t ON t.id=a.aid_type_id JOIN programs p ON p.id=t.program_id
    LEFT JOIN recipients r ON r.id=a.recipient_id
    WHERE a.status='Виплачено' AND a.paid_on>=? AND a.paid_on<?
      AND length(a.paid_on)=10 AND date(a.paid_on,'+0 days')=a.paid_on`).all(`${year}-01-01`, `${year + 1}-01-01`) as Row[]
  const paidBySex = { male: 0, female: 0, unknown: 0 }, paidVpo = { count: 0, amountMinor: 0 }
  for (const row of paidRows) {
    // One paid assignment is one statistical unit, even for the same recipient.
    if (row.sex === 'Чоловік') paidBySex.male++
    else if (row.sex === 'Жінка') paidBySex.female++
    else paidBySex.unknown++
    if (Number(row.is_vpo) === 1) { paidVpo.count++; paidVpo.amountMinor += Number(row.amount_minor) }
    const key = String(row.program_id)
    const program = programMap.get(key) ?? { programName: String(row.program_name), plannedMinor: null, amountMinor: 0, paidMinor: 0 }
    program.paidMinor += Number(row.amount_minor); programMap.set(key, program)
  }
  const plannedByProgram = database.prepare(`SELECT p.id AS program_id, SUM(e.planned_amount_minor) AS planned_minor
    FROM annual_aid_plans e JOIN aid_types t ON t.id=e.aid_type_id JOIN programs p ON p.id=t.program_id
    WHERE e.year=? GROUP BY p.id`).all(year) as Row[]
  for (const row of plannedByProgram) {
    const item = programMap.get(String(row.program_id))
    if (item) item.plannedMinor = Number(row.planned_minor)
  }
  return {
    year, assignmentCount: rows.length, paidCount: paidRows.length, paidTotalMinor: paidRows.reduce((sum, row) => sum + Number(row.amount_minor), 0),
    totalMinor: rows.reduce((sum, row) => sum + Number(row.amount_minor), 0), monthlyAmountMinor, monthlyAssignmentCount, statusCounts, paidBySex, paidVpo,
    programExecution: [...programMap.entries()].map(([programId, values]) => ({ programId, ...values })),
    aidTypeDistribution: [...aidMap.entries()].map(([aidTypeId, values]) => ({ aidTypeId, ...values })).sort((a, b) => b.amountMinor - a.amountMinor),
    demo: rows.some((row) => Number(row.is_demo) === 1),
  }
}

export function reportSummary(database: DatabaseSync, yearValue: unknown, periodValue: unknown): ReportSummary {
  const year = resolveAccountingYear(yearValue)
  const period = periodValue as ReportPeriod
  let start = `${year}-01-01`, end = `${year + 1}-01-01`, periodLabel = `${year} року`
  if (period?.kind === 'month' && Number.isInteger(period.value) && period.value >= 1 && period.value <= 12) {
    start = `${year}-${String(period.value).padStart(2, '0')}-01`
    const next = new Date(Date.UTC(year, period.value, 1))
    end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
    periodLabel = `${new Intl.DateTimeFormat('uk-UA', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, period.value - 1, 1)))} ${year} року`
  } else if (period?.kind === 'year-to-month' && Number.isInteger(period.value) && period.value >= 1 && period.value <= 12) {
    const next = new Date(Date.UTC(year, period.value, 1))
    end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
    periodLabel = `Наростаючим підсумком станом на ${String(new Date(Date.UTC(year, period.value, 0)).getUTCDate()).padStart(2, '0')}.${String(period.value).padStart(2, '0')}.${year}`
  } else if (period?.kind === 'quarter' && Number.isInteger(period.value) && period.value >= 1 && period.value <= 4) {
    const firstMonth = (period.value - 1) * 3
    const next = new Date(Date.UTC(year, firstMonth + 3, 1))
    start = `${year}-${String(firstMonth + 1).padStart(2, '0')}-01`
    end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
    periodLabel = `${['I', 'II', 'III', 'IV'][period.value - 1]} квартал ${year} року`
  }
  if (period?.kind === 'year-to-date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period.endDate)
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]))) : null
    if (!date || date.toISOString().slice(0,10) !== period.endDate || !period.endDate.startsWith(`${year}-`)) throw new Error('Кінцева дата має бути коректною датою обраного облікового року.')
    date.setUTCDate(date.getUTCDate()+1); end=date.toISOString().slice(0,10)
    periodLabel=`З 01.01.${year} по ${period.endDate.slice(8,10)}.${period.endDate.slice(5,7)}.${year}`
  } else if (!period || !['month','quarter','annual','year-to-month'].includes(period.kind) ||
    (period.kind === 'month' && (!Number.isInteger(period.value) || period.value<1 || period.value>12)) ||
    (period.kind === 'quarter' && (!Number.isInteger(period.value) || period.value<1 || period.value>4)) ||
    (period.kind === 'year-to-month' && (!Number.isInteger(period.value) || period.value<1 || period.value>12))) throw new Error('Некоректний звітний період.')
  const assignments = database.prepare(`SELECT a.aid_type_id, COUNT(*) AS count, SUM(a.amount_minor) AS amount
    FROM assignments a JOIN decisions d ON d.id = a.decision_id
    WHERE a.status<>'Очікує рішення' AND d.decision_date >= ? AND d.decision_date < ? GROUP BY a.aid_type_id`).all(start, end) as Row[]
  const assignmentMap = new Map(assignments.map((row) => [String(row.aid_type_id), row]))
  const paid = database.prepare(`SELECT a.aid_type_id, COUNT(*) AS count, SUM(a.amount_minor) AS amount
    FROM assignments a WHERE a.status='Виплачено' AND a.paid_on>=? AND a.paid_on<?
      AND length(a.paid_on)=10 AND date(a.paid_on,'+0 days')=a.paid_on GROUP BY a.aid_type_id`).all(start, end) as Row[]
  const paidMap = new Map(paid.map((row) => [String(row.aid_type_id), row]))
  const catalogRows = database.prepare(`SELECT t.id AS aid_type_id, t.official_name, p.id AS program_id,p.official_name AS program_official_name,
    COALESCE(plan.planned_recipient_count,0) AS planned_count,COALESCE(plan.planned_amount_minor,0) AS planned_amount
    FROM aid_types t JOIN programs p ON p.id=t.program_id LEFT JOIN annual_aid_plans plan ON plan.aid_type_id=t.id AND plan.year=?
    ORDER BY p.sort_order,p.id,t.sort_order,t.id`).all(year) as Row[]
  const programs=database.prepare('SELECT id,short_name AS shortName,official_name AS officialName FROM programs ORDER BY sort_order,id').all() as {id:string;shortName:string;officialName:string}[]

  return { year, periodLabel, programs, rows: catalogRows.map((type) => {
    const typeId = String(type.aid_type_id), assignment = assignmentMap.get(typeId), payment = paidMap.get(typeId)
    return { programId: String(type.program_id), plannedRecipientCount: Number(type.planned_count), plannedAmountMinor: Number(type.planned_amount), aidTypeId: typeId, officialName: String(type.official_name), programOfficialName: String(type.program_official_name),
      assignmentCount: assignment ? Number(assignment.count) : 0, amountMinor: assignment ? Number(assignment.amount) : 0, paidCount: payment ? Number(payment.count) : 0, paidAmountMinor: payment ? Number(payment.amount) : 0 }
  }) }
}
