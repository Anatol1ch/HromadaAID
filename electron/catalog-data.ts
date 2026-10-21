import type { DatabaseSync } from 'node:sqlite'
import type { AidTypeOption, CatalogList, ProgramOption } from './api-contract.js'

type Row = Record<string, string | number | null>

/** Shared catalog read model for local IPC and the standalone API. */
export function listCatalogs(database: DatabaseSync, includeInactive = false): CatalogList {
  const programs = database.prepare(`SELECT p.id, p.short_name AS shortName, p.official_name AS officialName, p.is_active AS isActive, p.updated_at AS updatedAt,
    p.approval_id AS approvalId, COALESCE(p.approval_number,pa.document_number) AS approvalNumber, COALESCE(p.approval_date,pa.document_date) AS approvalDate, COALESCE(p.approval_title,pa.title) AS approvalTitle,
    COUNT(a.id) AS assignmentCount FROM programs p LEFT JOIN program_approvals pa ON pa.id=p.approval_id
    LEFT JOIN aid_types t ON t.program_id=p.id LEFT JOIN assignments a ON a.aid_type_id=t.id
    ${includeInactive ? '' : 'WHERE p.is_active=1'} GROUP BY p.id ORDER BY p.sort_order,p.id`).all() as Row[]

  const aidTypes = database.prepare(`SELECT t.id, t.code, t.program_id AS programId, t.short_name AS shortName, t.official_name AS officialName, t.updated_at AS updatedAt,
    t.direction, t.funding_source AS fundingSource, t.is_active AS isActive, COUNT(a.id) AS assignmentCount
    FROM aid_types t JOIN programs p ON p.id=t.program_id LEFT JOIN assignments a ON a.aid_type_id=t.id
    ${includeInactive ? '' : 'WHERE t.is_active=1'} GROUP BY t.id ORDER BY p.sort_order,p.id,t.sort_order,t.id`).all() as Row[]

  const revisions = database.prepare("SELECT scope,revision FROM catalog_order_revisions").all() as { scope: string; revision: string }[]
  const revisionByScope = new Map(revisions.map((row) => [row.scope, row.revision]))
  return {
    programs: programs.map((row) => ({ ...row, isActive: Number(row.isActive) === 1 }) as ProgramOption),
    aidTypes: aidTypes.map((row) => ({ ...row, isActive: Number(row.isActive) === 1 }) as AidTypeOption),
    programOrderRevision: revisionByScope.get('programs') ?? '',
    aidTypeOrderRevisions: Object.fromEntries(programs.map((row) => [String(row.id), revisionByScope.get('aid-types:' + String(row.id)) ?? ''])),
  }
}
