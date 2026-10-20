import type { KeyboardEvent } from 'react'

/** Automatic activation for horizontal tab lists, preserving DOM order. */
export function navigateTabs(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter(tab => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true' && !tab.closest('[hidden], [inert]'))
  const index = tabs.indexOf(event.target as HTMLButtonElement)
  if (index < 0 || !tabs.length) return
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next].focus()
  tabs[next].click()
}
