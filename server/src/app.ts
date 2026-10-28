import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { bankDetails, getBank, listBanks, removeBank, saveBank } from '../../electron/bank-store.js'
import { getDecision, listAssignments, listDecisions, listRecipientAssignmentHistory } from '../../electron/assignment-data.js'
import { resolveAccountingYear } from '../../electron/accounting-year.js'
import { listCatalogs } from '../../electron/catalog-data.js'
import { reorderCatalog } from '../../electron/catalog-order.js'
import { saveCatalog } from '../../electron/catalog-store.js'
import { dashboardSummary, reportSummary } from '../../electron/financial-summary.js'
import { getRecipient, listRecipients } from '../../electron/recipient-data.js'
import { saveRecipient } from '../../electron/recipient-store.js'
import { listAnnualPlans, saveAnnualPlan, syncLegacyPlan } from '../../electron/annual-plans.js'
import { listAnnualPlanEntries, listProgramApprovals, listReportSourceRows } from '../../electron/report-read-data.js'
import { saveProgramApproval } from '../../electron/program-approval-store.js'
import { addDecisionAssignments, saveDecision } from '../../electron/decision-store.js'
import { saveAssignment } from '../../electron/assignment-store.js'
import { changeAssignmentStatuses } from '../../electron/assignment-status.js'
import { listStatementAssignments } from '../../electron/statement-list-data.js'
import { readStatementRows } from '../../electron/statement-data.js'
import { executeDeletion, isDeleteEntity, previewDeletion } from '../../electron/deletion-service.js'
import { HROMADAAID_API_CONTRACT_VERSION } from '../../shared/api-compatibility.js'
import type { AnnualAidPlan, AnnualPlanEntry, AssignmentListResult, AssignmentRecord, BankDetail, BankRecord, BankSaveResult, CatalogList, DashboardData, DecisionRecord, DecisionSummary, HealthResponse, ProgramApproval, RecipientRecord, RecipientSaveResult, RecipientSummary, ReportPeriod, ReportSourceRow, ReportSummary } from '../../shared/api-contract.js'
import type { ChangePasswordInput, LoginInput } from '../../shared/auth-contract.js'
import { hasPermission } from '../../shared/authorization.js'
import { changePassword, login, logout } from './auth.js'
import { requireAuthenticated } from './auth-http.js'
import { currentApiSession, installApiAuthorization } from './api-authorization.js'
import { LoginRateLimiter } from './login-rate-limit.js'
import type { BackupAdministration } from './backup-admin.js'
import { registerBackupAdministration } from './backup-admin-http.js'
import { createManagedUser, getManagedUser, listManagedUsers, removeManagedUser, resetManagedUserPassword, setManagedUserStatus, updateManagedUser } from './user-admin.js'

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const saveStatus = (result: { ok: boolean; reason?: string }) => result.ok ? 200 : result.reason === 'conflict' ? 409 : result.reason === 'storage' ? 500 : 400

function readJsonQuery(value: string | undefined): unknown {
  if (value === undefined) return undefined
  try { return JSON.parse(value) }
  catch { return undefined }
}

function requestsPaidStatus(value: unknown): boolean {
  return isRecord(value) && value.status === 'Виплачено'
}

export function createApp(database: DatabaseSync, administration?: BackupAdministration): FastifyInstance {
  const app = Fastify({ logger: true })
  administration?.install(app)
  const loginRateLimiter = new LoginRateLimiter()

  app.post<{ Body: unknown }>('/auth/login', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : undefined
    const input: LoginInput = { username: typeof body?.username === 'string' ? body.username : '', password: typeof body?.password === 'string' ? body.password : '' }
    if (loginRateLimiter.isBlocked(request.ip, input.username)) {
      return reply.status(429).send({ message: 'Забагато невдалих спроб входу. Повторіть пізніше.' })
    }
    const result = await login(database, input)
    if (!result.ok) {
      if (result.status === 401) loginRateLimiter.failed(request.ip, input.username)
      return reply.status(result.status).send({ message: result.message })
    }
    loginRateLimiter.succeeded(request.ip, input.username)
    return reply.status(200).send(result.value)
  })

  app.get('/auth/me', async (request, reply) => {
    const session = requireAuthenticated(database, request, reply)
    if (!session) return reply
    return reply.status(200).send(session.user)
  })

  app.post('/auth/logout', async (request, reply) => {
    const session = requireAuthenticated(database, request, reply)
    if (!session) return reply
    logout(database, session.tokenHash)
    return reply.status(204).send()
  })

  app.post<{ Body: unknown }>('/auth/change-password', async (request, reply) => {
    const session = requireAuthenticated(database, request, reply)
    if (!session) return reply
    const body = isRecord(request.body) ? request.body : undefined
    const input: ChangePasswordInput = {
      currentPassword: typeof body?.currentPassword === 'string' ? body.currentPassword : '',
      newPassword: typeof body?.newPassword === 'string' ? body.newPassword : '',
    }
    const result = await changePassword(database, session, input)
    if (!result.ok) return reply.status(result.status).send({ message: result.message })
    return reply.status(204).send()
  })

  app.get('/health', async (): Promise<HealthResponse> => {
    database.prepare('SELECT 1 AS ready').get()
    return { status: 'ok', service: 'hromada-aid-api', apiContractVersion: HROMADAAID_API_CONTRACT_VERSION }
  })

  installApiAuthorization(app, database)
  if (administration) registerBackupAdministration(app, administration)

  app.get('/api/users', async () => listManagedUsers(database))
  app.get<{ Params: { id: string } }>('/api/users/:id', async (request) => getManagedUser(database, request.params.id))
  app.post<{ Body: unknown }>('/api/users', async (request, reply) => {
    const result = await createManagedUser(database, isRecord(request.body) ? request.body.input : undefined)
    return reply.status(result.ok ? 200 : result.reason === 'conflict' ? 409 : 400).send(result)
  })
  app.put<{ Params: { id: string }; Body: unknown }>('/api/users/:id', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const result = updateManagedUser(database, request.params.id, body.input, body.expectedUpdatedAt)
    return reply.status(result.ok ? 200 : result.reason === 'not-found' ? 404 : result.reason === 'conflict' ? 409 : 400).send(result)
  })
  app.post<{ Params: { id: string }; Body: unknown }>('/api/users/:id/status', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const result = setManagedUserStatus(database, currentApiSession(request).user.id, request.params.id, body.status, body.expectedUpdatedAt)
    return reply.status(result.ok ? 200 : result.reason === 'not-found' ? 404 : result.reason === 'conflict' ? 409 : 400).send(result)
  })
  app.post<{ Params: { id: string }; Body: unknown }>('/api/users/:id/reset-password', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const result = await resetManagedUserPassword(database, request.params.id, body.newPassword, body.expectedUpdatedAt)
    return reply.status(result.ok ? 200 : result.reason === 'not-found' ? 404 : result.reason === 'conflict' ? 409 : 400).send(result)
  })
  app.delete<{ Params: { id: string }; Body: unknown }>('/api/users/:id', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const result = removeManagedUser(database, currentApiSession(request).user.id, request.params.id, body.expectedUpdatedAt)
    return reply.status(result.ok ? 200 : result.reason === 'not-found' ? 404 : 409).send(result)
  })

  app.get<{ Querystring: { includeInactive?: string } }>('/api/catalogs', async (request): Promise<CatalogList> =>
    listCatalogs(database, request.query.includeInactive === 'true'))
  app.post<{ Body: unknown }>('/api/catalogs/save', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body ? saveCatalog(database, request.body.input) : { ok: false as const, reason: 'validation' as const, message: 'Некоректні дані довідника.' }
    return reply.status(saveStatus(result)).send(result)
  })
  app.post<{ Body: unknown }>('/api/catalogs/reorder', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body ? reorderCatalog(database, request.body.input) : { ok: false as const, reason: 'validation' as const, message: 'Некоректний порядок довідника.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.get('/api/recipients', async (): Promise<RecipientSummary[]> => listRecipients(database))

  app.get<{ Params: { id: string } }>('/api/recipients/:id', async (request): Promise<RecipientRecord | null> =>
    getRecipient(database, request.params.id))

  app.get<{ Params: { id: string } }>('/api/recipients/:id/assignment-history', async (request): Promise<AssignmentRecord[]> =>
    listRecipientAssignmentHistory(database, request.params.id))

  app.post<{ Body: unknown }>('/api/recipients', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body)) return reply.status(400).send({ message: 'Некоректні дані картки отримувача.' })
    const result = saveRecipient(database, request.body.input)
    return reply.status(saveStatus(result)).send(result satisfies RecipientSaveResult)
  })

  app.put<{ Params: { id: string; }; Body: unknown }>('/api/recipients/:id', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body) || typeof request.body.expectedUpdatedAt !== 'string' || !request.body.expectedUpdatedAt) {
      return reply.status(400).send({ message: 'Для редагування потрібна початкова версія картки отримувача.' })
    }
    const result = saveRecipient(database, request.body.input, request.params.id, request.body.confirmSameName, request.body.expectedUpdatedAt)
    return reply.status(saveStatus(result)).send(result satisfies RecipientSaveResult)
  })

  app.get<{ Querystring: { query?: string } }>('/api/banks', async (request): Promise<BankRecord[]> =>
    listBanks(database, request.query.query ?? ''))

  app.get<{ Params: { id: string } }>('/api/banks/:id', async (request): Promise<BankRecord | null> =>
    getBank(database, request.params.id))

  app.get<{ Params: { id: string } }>('/api/banks/:id/details', async (request): Promise<BankDetail[]> =>
    bankDetails(database, request.params.id))

  app.delete<{ Params: { id: string }; Body: { expectedUpdatedAt?: unknown } }>('/api/banks/:id', async (request, reply) => { const result = removeBank(database, request.params.id, request.body?.expectedUpdatedAt); return reply.status(result.ok ? 200 : result.message?.includes('вже змінив') ? 409 : 400).send(result) })

  app.post<{ Body: unknown }>('/api/banks', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body)) return reply.status(400).send({ message: 'Некоректні дані банку.' })
    const result = saveBank(database, request.body.input)
    return reply.status(saveStatus(result)).send(result satisfies BankSaveResult)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/api/banks/:id', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body) || typeof request.body.expectedUpdatedAt !== 'string' || !request.body.expectedUpdatedAt) {
      return reply.status(400).send({ message: 'Для редагування потрібна початкова версія картки банку.' })
    }
    const result = saveBank(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
    return reply.status(saveStatus(result)).send(result satisfies BankSaveResult)
  })

  app.get('/api/decisions', async (): Promise<DecisionSummary[]> => listDecisions(database))

  app.get<{ Params: { id: string } }>('/api/decisions/:id', async (request): Promise<DecisionRecord | null> =>
    getDecision(database, request.params.id))

  app.post<{ Body: unknown }>('/api/decisions', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body
      ? saveDecision(database, request.body.input)
      : { ok: false as const, reason: 'validation' as const, message: 'Некоректні дані рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/api/decisions/:id', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body && typeof request.body.expectedUpdatedAt === 'string' && request.body.expectedUpdatedAt
      ? saveDecision(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
      : { ok: false as const, reason: 'validation' as const, message: 'Для редагування потрібна початкова версія рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.post<{ Params: { id: string }; Body: unknown }>('/api/decisions/:id/assignments', async (request, reply) => {
    const result = isRecord(request.body) && Array.isArray(request.body.assignments) && typeof request.body.requestId === 'string'
      ? addDecisionAssignments(database, request.params.id, request.body.assignments, request.body.requestId)
      : { ok: false as const, reason: 'validation' as const, message: 'Некоректний пакет призначень.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.get<{ Querystring: { year?: string } }>('/api/assignments', async (request): Promise<AssignmentListResult> =>
    listAssignments(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.post<{ Body: unknown }>('/api/assignments/change-statuses', async (request, reply) => { const result = isRecord(request.body) && 'input' in request.body ? changeAssignmentStatuses(database, request.body.input, request.body.requestId) : { ok: false as const, reason: 'validation' as const, message: 'Некоректні дані пакетної зміни.' }; return reply.status(saveStatus(result)).send(result) })

  app.post<{ Body: unknown }>('/api/assignments', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body)) return reply.status(400).send({ ok: false, reason: 'validation', message: 'Некоректні дані призначення.' })
    if (requestsPaidStatus(request.body.input) && !hasPermission(currentApiSession(request).user.roles, 'assignments.change_financial_status')) {
      return reply.status(403).send({ message: 'Недостатньо прав для встановлення статусу «Виплачено».' })
    }
    const result = saveAssignment(database, request.body.input, undefined, undefined, request.body.requestId)
    return reply.status(saveStatus(result)).send(result)
  })
  app.put<{ Params: { id: string }; Body: unknown }>('/api/assignments/:id', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body) || typeof request.body.expectedUpdatedAt !== 'string' || !request.body.expectedUpdatedAt) {
      return reply.status(400).send({ ok: false, reason: 'validation', message: 'Для редагування потрібна початкова версія призначення.' })
    }
    const previous = database.prepare('SELECT status FROM assignments WHERE id=?').get(request.params.id) as { status?: unknown } | undefined
    if ((requestsPaidStatus(request.body.input) || previous?.status === 'Виплачено') && !hasPermission(currentApiSession(request).user.roles, 'assignments.change_financial_status')) {
      return reply.status(403).send({ message: 'Недостатньо прав для зміни призначення зі статусом «Виплачено».' })
    }
    const result = saveAssignment(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
    return reply.status(saveStatus(result)).send(result)
  })

  app.get<{ Querystring: { year?: string } }>('/api/statements', async (request): Promise<AssignmentListResult> =>
    listStatementAssignments(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.post<{ Body: { ids?: unknown; year?: unknown } }>('/api/statements/snapshot', async (request, reply) => { const ids=request.body?.ids, year=request.body?.year; if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'||!id)||!Number.isInteger(year)||Number(year)<2000||Number(year)>2200)return reply.status(400).send({message:'Некоректний склад відомості.'}); const unique=[...new Set(ids as string[])], rows=readStatementRows(database,unique,String(year)); if(rows.length!==unique.length)return reply.status(409).send({message:'Частина призначень змінилася. Оновіть список.'}); return rows })
  app.post<{ Body: { ids?: unknown; year?: unknown } }>('/api/statements/bank-snapshot', async (request, reply) => { const ids=request.body?.ids, year=request.body?.year; if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'||!id)||!Number.isInteger(year)||Number(year)<2000||Number(year)>2200)return reply.status(400).send({message:'Некоректний склад відомості.'}); const unique=[...new Set(ids as string[])], marks=unique.map(()=>'?').join(','); const rows=database.prepare(`SELECT a.id,a.amount_minor,r.last_name,r.first_name,r.patronymic,r.rnokpp,r.bank_account FROM assignments a JOIN recipients r ON r.id=a.recipient_id JOIN decisions d ON d.id=a.decision_id WHERE a.id IN (${marks}) AND substr(d.decision_date,1,4)=? AND a.status IN ('Призначено','В роботі','Передано до казначейства') ORDER BY d.decision_date,a.created_at,a.id`).all(...unique,String(year)); if(rows.length!==unique.length)return reply.status(409).send({message:'Частина призначень змінилася. Оновіть список.'}); return rows })

  app.get<{ Params: { entity: string; id: string } }>('/api/deletion/:entity/:id', async (request) => isDeleteEntity(request.params.entity) ? previewDeletion(database, request.params.entity, request.params.id) : null)
  app.post<{ Params: { entity: string; id: string }; Body: { confirmationToken?: unknown } }>('/api/deletion/:entity/:id', async (request, reply) => { if (!isDeleteEntity(request.params.entity)) return reply.status(400).send({ ok:false,message:'Некоректний тип запису.' }); const result=executeDeletion(database, request.params.entity, request.params.id, request.body?.confirmationToken); return reply.status(result.ok?200:409).send(result) })

  app.get('/api/program-approvals', async (): Promise<ProgramApproval[]> => listProgramApprovals(database))
  app.post<{ Body: unknown }>('/api/program-approvals', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body ? saveProgramApproval(database, request.body.input) : { ok: false as const, reason: 'validation' as const, message: 'Некоректні реквізити рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })
  app.put<{ Params: { id: string }; Body: unknown }>('/api/program-approvals/:id', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body && typeof request.body.expectedUpdatedAt === 'string' && request.body.expectedUpdatedAt
      ? saveProgramApproval(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
      : { ok: false as const, reason: 'validation' as const, message: 'Для редагування потрібна початкова версія рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.get<{ Querystring: { year?: string } }>('/api/dashboard', async (request): Promise<DashboardData> =>
    dashboardSummary(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.get<{ Querystring: { sheet?: string } }>('/api/reports/source-rows', async (request): Promise<ReportSourceRow[]> =>
    listReportSourceRows(database, request.query.sheet))

  app.get<{ Querystring: { year?: string; period?: string } }>('/api/reports/summary', async (request): Promise<ReportSummary> =>
    reportSummary(database, request.query.year === undefined ? undefined : Number(request.query.year), readJsonQuery(request.query.period) as ReportPeriod))

  app.get<{ Querystring: { year?: string } }>('/api/reports/annual-plans', async (request): Promise<AnnualAidPlan[]> =>
    listAnnualPlans(database, resolveAccountingYear(request.query.year === undefined ? undefined : Number(request.query.year))))

  app.get<{ Querystring: { year?: string } }>('/api/reports/plan-entries', async (request): Promise<AnnualPlanEntry[]> =>
    listAnnualPlanEntries(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.post<{ Body: unknown }>('/api/reports/annual-plans', async (request, reply) => { const result = isRecord(request.body) && 'input' in request.body ? saveAnnualPlan(database, request.body.input, request.body.expectedUpdatedAt) : { ok: false, message: 'Некоректні дані плану.' }; return reply.status(result.ok ? 200 : 400).send(result) })
  app.post<{ Body: unknown }>('/api/reports/plan-entries', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body)) return reply.status(400).send({ ok:false, message:'Некоректні дані плану.' })
    const input=request.body.input as Record<string,unknown>; if (!Number.isInteger(Number(input.year))||typeof String(input.aidTypeId)!=='string'||typeof input.referenceLabel!=='string'||!String(input.referenceLabel).trim()||!Number.isInteger(Number(input.plannedAmountMinor))||(input.plannedRecipientCount as number | null!==null&&!Number.isInteger(input.plannedRecipientCount as number | null))) return reply.status(400).send({ok:false,message:'Заповніть підставу, вид допомоги та коректні планові показники.'})
    try { database.exec('BEGIN IMMEDIATE'); if(!database.prepare('SELECT 1 FROM aid_types WHERE id=? AND is_active=1').get(String(input.aidTypeId))){database.exec('ROLLBACK');return reply.status(400).send({ok:false,message:'Цей вид допомоги неактивний і недоступний для нового плану.'})} const now=new Date().toISOString(), id=typeof request.body.id==='string'&&request.body.id?request.body.id:null; if(id){const previous=database.prepare('SELECT year,aid_type_id FROM annual_plan_entries WHERE id=?').get(id) as Record<string,unknown>|undefined;if(!previous){database.exec('ROLLBACK');return reply.status(400).send({ok:false,message:'Плановий рядок не знайдено. Оновіть звіт.'})}database.prepare('UPDATE annual_plan_entries SET year=?,aid_type_id=?,reference_label=?,planned_recipient_count=?,planned_amount_minor=?,updated_at=? WHERE id=?').run(Number(input.year),String(input.aidTypeId),String(input.referenceLabel).trim(),input.plannedRecipientCount as number | null,Number(input.plannedAmountMinor),now,id);if(previous.aid_type_id!==String(input.aidTypeId))syncLegacyPlan(database,Number(previous.year),String(previous.aid_type_id))}else{const { randomUUID }=await import('node:crypto');database.prepare('INSERT INTO annual_plan_entries(id,year,aid_type_id,reference_label,planned_recipient_count,planned_amount_minor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(year,aid_type_id,reference_label) DO UPDATE SET planned_recipient_count=excluded.planned_recipient_count,planned_amount_minor=excluded.planned_amount_minor,updated_at=excluded.updated_at').run(randomUUID(),Number(input.year),String(input.aidTypeId),String(input.referenceLabel).trim(),input.plannedRecipientCount as number | null,Number(input.plannedAmountMinor),now,now)}syncLegacyPlan(database,Number(Number(input.year)),String(String(input.aidTypeId)));database.exec('COMMIT');return {ok:true} } catch { try{database.exec('ROLLBACK')}catch{};return reply.status(500).send({ok:false,message:'Не вдалося зберегти плановий показник.'}) }
  })
  app.delete<{ Params: { id: string } }>('/api/reports/plan-entries/:id', async (request, reply) => { try { database.exec('BEGIN IMMEDIATE'); const previous=database.prepare('SELECT year,aid_type_id FROM annual_plan_entries WHERE id=?').get(request.params.id) as Record<string,unknown>|undefined; if(!previous){database.exec('ROLLBACK');return reply.status(400).send({ok:false,message:'Плановий рядок не знайдено.'})}database.prepare('DELETE FROM annual_plan_entries WHERE id=?').run(request.params.id);syncLegacyPlan(database,Number(previous.year),String(previous.aid_type_id));database.exec('COMMIT');return {ok:true} }catch{try{database.exec('ROLLBACK')}catch{};return reply.status(500).send({ok:false,message:'Не вдалося видалити плановий рядок.'})} })

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ status: 'error', message: 'Запитаний ресурс сервера не знайдено.' }))

  app.setErrorHandler((error, _request, reply) => {
    const details = error as { statusCode?: unknown; code?: unknown }
    const status = typeof details.statusCode === 'number' && details.statusCode >= 400 && details.statusCode < 500 ? details.statusCode : 500
    if (status >= 500) app.log.error(error)
    else app.log.warn({ status, code: details.code }, 'Некоректний HTTP-запит')
    return reply.status(status).send({ status: 'error', message: status === 500 ? 'Внутрішня помилка сервера.' : 'Некоректний запит до сервера.' })
  })

  return app
}

