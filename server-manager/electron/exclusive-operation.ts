/** Reject overlapping requests synchronously; never release on UI navigation or
 * a timeout notification. Only the operation promise can release ownership. */
export function createExclusiveOperation(isBusy: () => boolean, setBusy: (value: boolean) => void) {
  let owned = false
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (owned || isBusy()) throw new Error('Зачекайте завершення іншої системної операції.')
    owned = true; setBusy(true)
    try { return await operation() } finally { owned = false; setBusy(false) }
  }
}
