import type { HromadaAidApi } from '../electron/api-contract'

declare global {
  interface Window {
    hromadaAid: HromadaAidApi
  }
}

export {}
