import { useId, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type FocusEventHandler, type ChangeEventHandler, type FormEventHandler } from 'react'

type FieldEvents<T> = { onBlur?: FocusEventHandler<T>; onChange?: ChangeEventHandler<T>; onInvalid?: FormEventHandler<T> }

/** Presents native constraints consistently; domain validation stays with the form. */
function useNativeFieldValidation<T extends HTMLInputElement | HTMLTextAreaElement>(events: FieldEvents<T>) {
  const id = useId()
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')
  const validate = (element: T) => setError(element.validity.valid ? '' : element.validity.valueMissing ? 'Заповніть обов’язкове поле.' : element.validationMessage)
  const handlers: Required<FieldEvents<T>> = {
    onBlur: event => { setTouched(true); validate(event.currentTarget); events.onBlur?.(event) },
    onChange: event => { if (touched) validate(event.currentTarget); events.onChange?.(event) },
    onInvalid: event => { event.preventDefault(); setTouched(true); validate(event.currentTarget); events.onInvalid?.(event) },
  }
  return { id, error, handlers }
}

export default function ValidatedInput({ onBlur, onChange, onInvalid, 'aria-describedby': describedBy, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const { id, error, handlers } = useNativeFieldValidation<HTMLInputElement>({onBlur,onChange,onInvalid})
  return <><input {...props} {...handlers} aria-invalid={Boolean(error) || props['aria-invalid']} aria-describedby={[describedBy, error ? id : ''].filter(Boolean).join(' ') || undefined}/>
    {error && <span className="recipient-field-error" id={id} role="alert">{error}</span>}</>
}

export function ValidatedTextarea({ onBlur, onChange, onInvalid, 'aria-describedby': describedBy, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { id, error, handlers } = useNativeFieldValidation<HTMLTextAreaElement>({onBlur,onChange,onInvalid})
  return <><textarea {...props} {...handlers} aria-invalid={Boolean(error) || props['aria-invalid']} aria-describedby={[describedBy, error ? id : ''].filter(Boolean).join(' ') || undefined}/>
    {error && <span className="recipient-field-error" id={id} role="alert">{error}</span>}</>
}
