import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * An ⓘ button that reveals a longer explanation. Built on `<details>` so it works without
 * script; the effect only adds closing on an outside click or Escape.
 *
 * The panel positions against the nearest positioned ancestor (a card header), not the icon.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current
      if (details?.open && !details.contains(event.target as Node)) details.open = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const details = ref.current
      if (event.key !== 'Escape' || !details?.open) return
      details.open = false
      details.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <details ref={ref} className="infotip">
      <summary aria-label={label} title={label}>
        <Icon name="info" size={14} />
      </summary>
      <div className="infotip-panel">{children}</div>
    </details>
  )
}
