import type { ReleaseUpdateState, ServerReleaseState } from '../electron/server-update-contract'

type ReleaseState = Pick<ReleaseUpdateState | ServerReleaseState, 'status' | 'availableVersion' | 'error'>
type ReleaseStatus = { label: string; tone: 'success' | 'warning' | 'error' | 'info' }

export function releaseUpdateDisplay(state: ReleaseState | null | undefined, checking = false): ReleaseStatus {
  if (checking || state?.status === 'checking') return { label: 'Перевірка…', tone: 'info' }
  if (!state) return { label: 'Перевірка ще не завершена', tone: 'info' }

  switch (state.status) {
    case 'up-to-date': return { label: 'Встановлено останню перевірену версію', tone: 'success' }
    case 'available': return { label: state.availableVersion ? `Доступна версія ${state.availableVersion}` : 'Доступне оновлення', tone: 'warning' }
    case 'downloading': return { label: 'Завантаження оновлення…', tone: 'info' }
    case 'verifying': return { label: 'Перевірка цілісності…', tone: 'info' }
    case 'ready': return { label: 'Оновлення завантажено й перевірено', tone: 'success' }
    case 'installing': return { label: 'Встановлення оновлення…', tone: 'info' }
    case 'restarting': return { label: 'Перезапуск Server Manager…', tone: 'info' }
    case 'error': return { label: state.error || 'Не вдалося перевірити оновлення', tone: 'error' }
    case 'unknown': return { label: 'Перевірка ще не виконувалася', tone: 'info' }
    default: return { label: 'Перевірка ще не завершена', tone: 'info' }
  }
}
