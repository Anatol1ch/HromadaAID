import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

type Props = {
  variant: 'success' | 'error' | 'warning' | 'info'
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  className?: string
  role?: 'alert' | 'status'
  icon?: ReactNode
}

/** Local, persistent feedback. No timers, focus changes or global notification state. */
export default function Alert({ variant, children, action, onDismiss, className = '', role, icon }: Props) {
  const Icon = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info }[variant]
  return <div className={`ui-alert ui-alert-${variant}${className ? ` ${className}` : ''}`} role={role ?? (variant === 'error' || variant === 'warning' ? 'alert' : 'status')} aria-atomic="true">
    {icon === undefined ? <Icon className="ui-alert-icon" size={19} aria-hidden="true"/> : icon}
    <div className="ui-alert-content">{children}</div>
    {action && <div className="ui-alert-action">{action}</div>}
    {onDismiss && <button type="button" className="icon-button ui-alert-dismiss" aria-label="Закрити повідомлення" onClick={onDismiss}><X size={17} aria-hidden="true"/></button>}
  </div>
}
