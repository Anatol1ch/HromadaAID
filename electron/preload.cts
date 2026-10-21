import { contextBridge, ipcRenderer } from 'electron'
import type { HromadaAidApi } from './api-contract.js'

const api: HromadaAidApi = {
  appName: 'HromadaAid',
  platform: process.platform,
  recipients: {
    list: (includeArchived) => invoke('recipients:list', includeArchived),
    get: (id) => invoke('recipients:get', id),
    save: (input, id, confirmSameName, expectedUpdatedAt) => invoke('recipients:save', input, id, confirmSameName, expectedUpdatedAt),
    assignmentHistory: (id) => invoke('recipients:assignment-history', id),
  },
  banks: {
    list: (query) => invoke('banks:list', query),
    get: (id) => invoke('banks:get', id),
    details: (bankId) => invoke('banks:details', bankId),
    save: (input, id, expectedUpdatedAt) => invoke('banks:save', input, id, expectedUpdatedAt),
    remove: (id) => invoke('banks:remove', id),
  },
  catalogs: {
    list: (includeInactive) => invoke('catalogs:list', includeInactive),
    save: (input) => invoke('catalogs:save', input),
    reorder: (input) => invoke('catalogs:reorder', input),
  },
  programApprovals: {
    list: () => invoke('program-approvals:list'),
    save: (input, id, expectedUpdatedAt) => invoke('program-approvals:save', input, id, expectedUpdatedAt),
  },
  decisions: {
    list: () => invoke('decisions:list'),
    get: (id) => invoke('decisions:get', id),
    save: (input, id, expectedUpdatedAt) => invoke('decisions:save', input, id, expectedUpdatedAt),
    addAssignments: (decisionId, assignments, requestId) => invoke('decisions:add-assignments', decisionId, assignments, requestId),
  },
  assignments: {
    list: (year) => invoke('assignments:list', year),
    save: (input, id, expectedUpdatedAt, requestId) => invoke('assignments:save', input, id, expectedUpdatedAt, requestId),
    changeStatuses: (input, requestId) => invoke('assignments:change-statuses', input, requestId),
  },
  dashboard: {
    get: (year) => invoke('dashboard:get', year),
  },
  reports: {
    get: (sheet) => invoke('reports:get', sheet),
    summary: (year, period) => invoke('reports:summary', year, period),
    annualPlanList: (year) => invoke('reports:annual-plan-list', year),
    annualPlanSave: (input, expectedUpdatedAt) => invoke('reports:annual-plan-save', input, expectedUpdatedAt),
    generate: (snapshot) => invoke('reports:generate', snapshot),
    savePdf: (id) => invoke('reports:save-pdf', id),
    saveExcel: (id) => invoke('reports:save-excel', id),
    release: (id) => invoke('reports:release', id),
    planList: (year) => invoke('reports:plan-list', year),
    planSave: (input, id) => invoke('reports:plan-save', input, id),
    planRemove: (id) => invoke('reports:plan-remove', id),
  },
  deletion: {
    preview: (entity, id) => invoke('deletion:preview', entity, id),
    execute: (entity, id) => invoke('deletion:execute', entity, id),
  },
  statements: {
    list: (year) => invoke('statements:list', year),
    generate: (kind, assignmentIds, year, parameters) => invoke('statements:generate', kind, assignmentIds, year, parameters),
    generateBank: (assignmentIds, year) => invoke('statements:generate-bank', assignmentIds, year),
    save: (documentId) => invoke('statements:save', documentId),
    savePdf: (documentId) => invoke('statements:save-pdf', documentId),
  },
}

contextBridge.exposeInMainWorld('hromadaAid', api)

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // ipcRenderer stays inside the preload; the renderer receives only these fixed operations.
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}
