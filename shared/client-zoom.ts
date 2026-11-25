export const CLIENT_ZOOM_PRESETS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const
export const MIN_CLIENT_ZOOM_FACTOR = 0.5
export const MAX_CLIENT_ZOOM_FACTOR = 2

export function isValidClientZoomFactor(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_CLIENT_ZOOM_FACTOR && value <= MAX_CLIENT_ZOOM_FACTOR
}
