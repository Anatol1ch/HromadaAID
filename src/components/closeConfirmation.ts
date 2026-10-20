type CloseConfirmation = { close: () => void; owner: HTMLElement | null }

let pending: CloseConfirmation | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export const getCloseConfirmation = () => pending
export function subscribeCloseConfirmation(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Retain the existing callback contract: only an explicit confirmation runs close.
export function confirmModalClose(dirty: boolean, close: () => void, owner?: HTMLElement | null) {
  if (!dirty) { close(); return }
  if (pending) return
  pending = {
    close,
    owner: owner ?? (document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.app-modal') : null),
  }
  notify()
}

export function finishCloseConfirmation(request: CloseConfirmation, discard: boolean) {
  if (pending !== request) return
  pending = null
  notify()
  if (discard && (!request.owner || request.owner.isConnected)) request.close()
}

export function cancelCloseConfirmation(owner: HTMLElement) {
  if (pending?.owner === owner) finishCloseConfirmation(pending, false)
}
