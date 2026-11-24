const SIDEBAR_PREFERENCE_KEY = 'hromadaAid.sidebar.compact'

export function readCompactSidebar(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(SIDEBAR_PREFERENCE_KEY) === 'compact' } catch { return false }
}

export function writeCompactSidebar(storage: Pick<Storage, 'setItem'>, compact: boolean): void {
  try { storage.setItem(SIDEBAR_PREFERENCE_KEY, compact ? 'compact' : 'expanded') } catch { /* UI preference is optional. */ }
}

export function getSidebarToggleLabel(compact: boolean): string {
  return `${compact ? 'Розгорнути' : 'Згорнути'} бічну панель`
}
