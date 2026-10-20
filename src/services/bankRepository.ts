import type { BankInput } from '../../electron/api-contract'

export const bankRepository = {
  list: (query = '') => window.hromadaAid.banks.list(query),
  get: (id: string) => window.hromadaAid.banks.get(id),
  details: (bankId: string) => window.hromadaAid.banks.details(bankId),
  save: (input: BankInput, id?: string) => window.hromadaAid.banks.save(input, id),
  remove: (id: string) => window.hromadaAid.banks.remove(id),
}
