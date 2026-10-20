/** DOM order is the form's reading order. Popups own their internal keyboard controls. */
const focusSelector = 'input, select, textarea, button, a[href], [tabindex]'
const fieldSelector = 'input, select, textarea, button[role="combobox"], [data-address-edit]'
const popupSelector = '[data-keyboard-popup]'
const keyboardScopes = new WeakSet<HTMLElement>()
let highlighted: HTMLElement | null = null

export function activeKeyboardScope(): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('.app-modal')].filter(isAvailable).at(-1)
    ?? document.body
}

export function isAvailable(element: HTMLElement): boolean {
  return !element.matches(':disabled, [aria-disabled="true"], [hidden], [aria-hidden="true"]')
    && !element.closest('[inert], [hidden], [aria-hidden="true"]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
}

export function focusableElements(scope: HTMLElement, excludePopups = false): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(focusSelector)].filter(element =>
    element.tabIndex >= 0 && isAvailable(element) && (!excludePopups || !element.closest(popupSelector) || element.closest(popupSelector) === scope))
}

export function primaryFields(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(fieldSelector)].filter(element =>
    element.tabIndex >= 0 && isAvailable(element) && !element.closest(popupSelector)
    && !element.matches('input[readonly], textarea[readonly], input[type="hidden"], input[type="submit"], input[type="button"], input[type="reset"], input[type="image"]'))
}

export function clearKeyboardHighlight() {
  highlighted?.removeAttribute('data-keyboard-active')
  highlighted = null
}

export function resetKeyboardMode(scope = activeKeyboardScope()) {
  keyboardScopes.delete(scope)
  clearKeyboardHighlight()
}

export function updateKeyboardHighlight() {
  clearKeyboardHighlight()
  const scope = activeKeyboardScope()
  const element = document.activeElement
  if (keyboardScopes.has(scope) && element instanceof HTMLElement && scope.contains(element)
    && element.matches(fieldSelector) && isAvailable(element)) {
    highlighted = element
    element.setAttribute('data-keyboard-active', '')
  }
}

export function advanceField(from: HTMLElement) {
  const scope = activeKeyboardScope()
  if (!scope.contains(from) || !isAvailable(from)) return
  keyboardScopes.add(scope)
  const region = from.closest<HTMLFormElement>('form') ?? from.closest<HTMLElement>('.content, .topbar') ?? scope
  const fields = primaryFields(region)
  const index = fields.indexOf(from)
  if (index < 0) return
  const submit = region instanceof HTMLFormElement
    ? focusableElements(region, true).find(element => element.matches('button[type="submit"], button:not([type]), input[type="submit"]'))
    : undefined
  ;(fields[index + 1] ?? submit ?? from).focus()
  updateKeyboardHighlight()
}

/** Wait for conditional/disabled fields to reflect the newly selected value. */
export function advanceAfterSelection(from: HTMLElement | null) {
  if (!from) return
  const scope = activeKeyboardScope()
  requestAnimationFrame(() => { if (activeKeyboardScope() === scope) advanceField(from) })
}

export function tabFromPopup(from: HTMLElement, backwards: boolean) {
  const scope = from.closest<HTMLElement>('.calendar-popover') ?? activeKeyboardScope()
  if (!scope.contains(from)) return false
  const fields = focusableElements(scope, true)
  const index = fields.indexOf(from)
  const next = fields[index + (backwards ? -1 : 1)]
  // A modal wraps; the main page leaves the browser's edge untouched.
  const target = next ?? (scope !== document.body ? backwards ? fields.at(-1) : fields[0] : undefined)
  target?.focus()
  return !!target
}

export function popupOwner(element: HTMLElement): HTMLElement {
  const owner = element.closest<HTMLElement>(popupSelector)?.dataset.keyboardPopup
  return owner ? document.getElementById(owner) ?? element : element
}

export function focusFirstInvalid(form: HTMLFormElement, fallbackSelector?: string) {
  if (!activeKeyboardScope().contains(form)) return
  const invalid = [...form.querySelectorAll<HTMLElement>(':invalid, [aria-invalid="true"]')]
    .map(element => element.closest('.app-select')?.querySelector<HTMLElement>('[role="combobox"]') ?? element)
    .find(isAvailable)
  const target = invalid ?? (fallbackSelector ? form.querySelector<HTMLElement>(fallbackSelector) : null)
  if (target && isAvailable(target)) target.focus()
}

export function submitCurrentForm(from: HTMLElement) {
  const scope = activeKeyboardScope()
  const owner = popupOwner(from)
  // Confirmation dialogs intentionally never acquire a save shortcut.
  if (!scope.contains(owner) || scope.matches('.confirm-dialog, [role="alertdialog"]')) return
  const form = owner.closest('form') ?? scope.querySelector('form')
  if (!form || !scope.contains(form) || form.closest('.app-modal') !== owner.closest('.app-modal')
    || scope.getAttribute('aria-busy') === 'true') return
  const submit = [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]')]
    .find(isAvailable)
  if (!submit) return
  form.requestSubmit(submit)
  requestAnimationFrame(() => focusFirstInvalid(form))
}
