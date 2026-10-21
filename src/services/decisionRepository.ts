import { withOverviewRefresh } from './overviewUpdates'
import type { AssignmentDraft, DecisionInput } from '../../electron/api-contract'

export const decisionRepository = {
  list: () => window.hromadaAid.decisions.list(),
  get: (id: string) => window.hromadaAid.decisions.get(id),
  save: (input: DecisionInput, id?: string, expectedUpdatedAt?: string) => withOverviewRefresh(window.hromadaAid.decisions.save(input, id, expectedUpdatedAt)),
  addAssignments: (decisionId: string, assignments: AssignmentDraft[], requestId: string) =>
    withOverviewRefresh(window.hromadaAid.decisions.addAssignments(decisionId, assignments, requestId)),
  catalogs: () => window.hromadaAid.catalogs.list(),
}
