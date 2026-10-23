const wait = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))

export async function waitForMinimumDisplay(startedAt: number, minimumMs: number, now = Date.now, sleep = wait): Promise<void> {
  const remaining = minimumMs - (now() - startedAt)
  if (remaining > 0) await sleep(remaining)
}

export async function waitForStartupGate<T>(startedAt: number, minimumMs: number, initialize: () => Promise<T>, now = Date.now, sleep = wait, skipMinimum?: (value: T) => boolean): Promise<T> {
  const value = await initialize()
  if (skipMinimum?.(value)) return value
  await waitForMinimumDisplay(startedAt, minimumMs, now, sleep)
  return value
}
