import type { ReactNode } from 'react'
import { Icon } from './Icon'

type Tone = 'good' | 'warning' | 'critical'

interface CalloutProps {
  tone: Tone
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  role?: 'alert' | 'status'
}

export function Callout({ tone, title, children, actions, role }: CalloutProps) {
  return (
    <div className={`callout callout--${tone}`} role={role}>
      <Icon name={tone === 'good' ? 'check' : 'alert'} />
      <div className="callout-content">
        <div className="callout-title">{title}</div>
        {children}
        {actions && <div className="callout-actions">{actions}</div>}
      </div>
    </div>
  )
}
