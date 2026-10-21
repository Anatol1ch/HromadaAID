import { withOverviewRefresh } from './overviewUpdates'
import { catalogRepository } from './catalogRepository'
import type { AssignmentInput, AssignmentStatusBatchInput } from '../../electron/api-contract'

export const assignmentRepository = {
  list: (year: number) => window.hromadaAid.assignments.list(year),
  save: (input: AssignmentInput, id?: string, expectedUpdatedAt?: string, requestId?: string) => withOverviewRefresh(window.hromadaAid.assignments.save(input, id, expectedUpdatedAt, requestId)),
  changeStatuses: (input: AssignmentStatusBatchInput) => withOverviewRefresh(window.hromadaAid.assignments.changeStatuses(input)),
  catalogs: () => window.hromadaAid.catalogs.list(),
  saveCatalog: catalogRepository.save,
  recipients: () => window.hromadaAid.recipients.list(),
  decisions: () => window.hromadaAid.decisions.list(),
}
