/** Every close attempt is blocked while a critical operation owns the window. */
export function createOperationCloseGuard(isBusy: () => boolean, showWarning: () => Promise<unknown>) {
  let warningOpen = false
  return (event: { preventDefault(): void }) => {
    if (!isBusy()) return
    event.preventDefault()
    if (warningOpen) return
    warningOpen = true
    void showWarning().catch(() => undefined).finally(() => { warningOpen = false })
  }
}
