import { createContext, useContext } from 'react'

export type YearContextValue = { year: number; setYear: (year: number) => void }

export const YearContext = createContext<YearContextValue | null>(null)

export function useReportingYear() {
  const context = useContext(YearContext)
  if (!context) throw new Error('YearContext is not available')
  return context
}
