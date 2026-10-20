import type { BankRecord } from '../../electron/api-contract'

export const onlyBankDetail = (bank: BankRecord | undefined) => bank?.details.length === 1 ? bank.details[0].id : ''
export const bankForDetail = (banks: BankRecord[], detailId: string) => banks.find(bank => bank.details.some(detail => detail.id === detailId))
export const bankSearchText = (bank: BankRecord) => bank.details.map(detail => `${detail.mfo} ${detail.edrpou}`).join(' ')
