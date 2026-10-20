import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'
import { activeKeyboardScope, advanceField, clearKeyboardHighlight, focusFirstInvalid, resetKeyboardMode, submitCurrentForm, updateKeyboardHighlight } from '../lib/keyboardNavigation'

/** One React event boundary also covers portals, without overriding popup handlers. */
export default function KeyboardNavigation({ children }: { children: ReactNode }) {
  const saveHeld = useRef(false)
  useEffect(() => {
    const pointer = () => resetKeyboardMode()
    const keyup = (event: globalThis.KeyboardEvent) => { if (event.key === 'Enter' || event.key === 'Control') saveHeld.current = false }
    const blur = () => { saveHeld.current = false; clearKeyboardHighlight() }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('focusin', updateKeyboardHighlight)
    document.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('focusin', updateKeyboardHighlight)
      document.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
      clearKeyboardHighlight()
    }
  }, [])
  const saveShortcut = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return
    event.preventDefault(); event.stopPropagation()
    if (event.repeat || saveHeld.current || !(event.target instanceof HTMLElement)) return
    saveHeld.current = true
    submitCurrentForm(event.target)
  }
  const navigate = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey
      || event.shiftKey || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return
    const input = event.target
    if (!activeKeyboardScope().contains(input) || input.closest('[data-keyboard-popup]')
      || input.readOnly || !['text', 'search', 'email', 'tel', 'url', 'number', 'password', 'checkbox', 'radio'].includes(input.type)) return
    event.preventDefault()
    if (!event.repeat) advanceField(input)
  }
  return <div className="keyboard-navigation-root" onKeyDownCapture={saveShortcut} onKeyDown={navigate}
    onInvalidCapture={event => {
      const form = (event.target as HTMLElement).closest('form')
      if (form) requestAnimationFrame(() => focusFirstInvalid(form))
    }}>{children}</div>
}
