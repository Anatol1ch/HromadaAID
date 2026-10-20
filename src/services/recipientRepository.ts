import { withOverviewRefresh } from './overviewUpdates'
import type { RecipientInput } from '../../electron/api-contract'

export const recipientRepository = {
  list: (includeArchived = false) => window.hromadaAid.recipients.list(includeArchived),
  get: (id: string) => window.hromadaAid.recipients.get(id),
  assignmentHistory: (id: string) => window.hromadaAid.recipients.assignmentHistory(id),
  save: (input: RecipientInput, id?: string, confirmSameName = false) =>
    withOverviewRefresh(window.hromadaAid.recipients.save(input, id, confirmSameName)),
}
