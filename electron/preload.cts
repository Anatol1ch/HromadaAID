import { contextBridge, ipcRenderer } from 'electron'
import type { HromadaAidApi } from './api-contract.js'

const api: HromadaAidApi = {
  appName: 'HromadaAid',
  platform: process.platform,
  appInfo: {
    getVersion: () => invoke('app:get-version'),
  },
  auth: {
    getState: () => invoke('auth:get-state'),
    login: (username, password) => invoke('auth:login', username, password),
    logout: () => invoke('auth:logout'),
    changePassword: (currentPassword, newPassword) => invoke('auth:change-password', currentPassword, newPassword),
    onStateChange: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on('auth:state', receive)
      return () => ipcRenderer.removeListener('auth:state', receive)
    },
  },
  connection: {
    getState: () => invoke('connection:get-state'),
    check: (apiUrl) => invoke('connection:check', apiUrl),
    save: (apiUrl) => invoke('connection:save', apiUrl),
    onStateChange: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on('connection:state', receive)
      return () => ipcRenderer.removeListener('connection:state', receive)
    },
  },
  users: {
    list: () => invoke('users:list'),
    get: (id) => invoke('users:get', id),
    create: (input) => invoke('users:create', input),
    update: (id, input, expectedUpdatedAt) => invoke('users:update', id, input, expectedUpdatedAt),
    setStatus: (id, status, expectedUpdatedAt) => invoke('users:set-status', id, status, expectedUpdatedAt),
    resetPassword: (id, newPassword, expectedUpdatedAt) => invoke('users:reset-password', id, newPassword, expectedUpdatedAt),
    remove: (id, expectedUpdatedAt) => invoke('users:remove', id, expectedUpdatedAt),
  },
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
    remove: (id, expectedUpdatedAt) => invoke('banks:remove', id, expectedUpdatedAt),
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
    execute: (entity, id, confirmationToken) => invoke('deletion:execute', entity, id, confirmationToken),
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

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // ipcRenderer stays inside the preload; the renderer receives only these fixed operations.
  const result = await ipcRenderer.invoke(channel, ...args)
  if (result?.__hromadaAuthError === true) throw new Error(result.message)
  return result as T
}
