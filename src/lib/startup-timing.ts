const wait = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))

export async function waitForMinimumDisplay(startedAt: number, minimumMs: number, now = Date.now, sleep = wait): Promise<void> {
  const remaining = minimumMs - (now() - startedAt)
  if (remaining > 0) await sleep(remaining)
}

export async function waitForStartupGate<T>(startedAt: number, minimumMs: number, initialize: () => Promise<T>, now = Date.now, sleep = wait): Promise<T> {
  const operation = initialize().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
  await waitForMinimumDisplay(startedAt, minimumMs, now, sleep)
  const result = await operation
  if (!result.ok) throw result.error
  return result.value
}
