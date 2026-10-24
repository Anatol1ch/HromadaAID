import type { InspectionSnapshot } from './inspection-types.js'

export function createInspectionRequestHandler<TEvent>(run: () => Promise<InspectionSnapshot>, isTrusted: (event: TEvent) => boolean, onError: () => InspectionSnapshot): (event: TEvent) => Promise<InspectionSnapshot> {
  let inFlight: Promise<InspectionSnapshot> | null = null
  return async event => {
    if (!isTrusted(event)) throw new Error('UNTRUSTED_RENDERER')
    if (!inFlight) inFlight = run().catch(onError).finally(() => { inFlight = null })
    return inFlight
  }
}
