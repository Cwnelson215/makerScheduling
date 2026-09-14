import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type MenuEntry =
  | { label: string; icon?: IconName; danger?: boolean; onSelect: () => void }
  | { heading: string }
  | 'separator'

interface MenuProps {
  /** Accessible name for the trigger. */
  label: string
  trigger: ReactNode
  triggerClassName?: string
  entries: MenuEntry[]
  align?: 'start' | 'end'
}

const items = (list: HTMLElement | null) => Array.from(list?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

/** A button that opens a list of actions. Closes on selection, Escape, Tab, or a click elsewhere. */
export function Menu({ label, trigger, triggerClassName = 'btn', entries, align = 'end' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    items(list.current)[0]?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items(list.current)
    const at = all.indexOf(document.activeElement as HTMLElement)
    const move = (index: number) => {
      event.preventDefault()
      all[(index + all.length) % all.length]?.focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        return move(at + 1)
      case 'ArrowUp':
        return move(at - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(all.length - 1)
      case 'Escape':
        event.preventDefault()
        return close(true)
      case 'Tab':
        return close(false)
    }
  }

  return (
    <div className="menu-root" ref={root}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div ref={list} className={`menu menu--${align}`} role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {entries.map((entry, i) => {
            if (entry === 'separator') return <div key={i} className="menu-separator" role="separator" />
            if ('heading' in entry) {
              return (
                <div key={i} className="menu-heading section-label" role="presentation">
                  {entry.heading}
                </div>
              )
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`menu-item${entry.danger ? ' menu-item--danger' : ''}`}
                onClick={() => {
                  close(true)
                  entry.onSelect()
                }}
              >
                {entry.icon && <Icon name={entry.icon} />}
                {entry.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
