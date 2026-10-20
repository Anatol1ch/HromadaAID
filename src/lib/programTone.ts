/** Stable program identity only: names and manual ordering never choose a colour. */
export function programTone(id: string) {
  if (id === 'program-social') return 'program-tone-social'
  if (id === 'program-veterans') return 'program-tone-veterans'
  return 'program-tone-neutral'
}
