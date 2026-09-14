import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'

interface CardProps {
  title?: string
  description?: ReactNode
  /** Longer explanation, tucked behind an ⓘ next to the title. */
  info?: ReactNode
  actions?: ReactNode
  /** Drop the body padding, for tables and lists that run edge to edge. */
  flush?: boolean
  className?: string
  children?: ReactNode
}

export function Card({ title, description, info, actions, flush, className, children }: CardProps) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="card-header">
          <div className="card-heading">
            {title && (
              <div className="card-title-row">
                <h2 className="card-title">{title}</h2>
                {info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
              </div>
            )}
            {description && <p className="card-description">{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children && <div className={`card-body${flush ? ' card-body--flush' : ''}`}>{children}</div>}
    </section>
  )
}
