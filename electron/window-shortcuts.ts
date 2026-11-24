export type ClientWindowAction = 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'selectAll' | 'copy' | 'paste' | 'cut' | 'undo' | 'redo'

export interface ClientWindowInput {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export function getClientWindowAction(input: ClientWindowInput): ClientWindowAction | undefined {
  if (input.type !== 'keyDown') return undefined

  const primary = input.control || input.meta
  if (!primary || input.alt) return undefined

  if (input.code === 'Digit0' || input.code === 'Numpad0' || input.key === '0') return 'zoom-reset'
  if (input.code === 'Equal' || input.code === 'NumpadAdd' || ['=', '+', 'Add'].includes(input.key)) return 'zoom-in'
  if (input.code === 'Minus' || input.code === 'NumpadSubtract' || ['-', 'Subtract'].includes(input.key)) return 'zoom-out'

  const key = input.key.toLowerCase()
  if (key === 'z' && input.shift) return 'redo'
  const editActions: Record<string, ClientWindowAction> = {
    a: 'selectAll',
    c: 'copy',
    v: 'paste',
    x: 'cut',
    z: 'undo',
  }
  return editActions[key]
}
