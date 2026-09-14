import { useEffect, useRef, type PointerEvent } from 'react'
import { fmtHour } from '../../core/config'
import { DAY_NAMES, DAYS_PER_WEEK, slotIndex } from '../../core/types'

export interface CellAppearance {
  className: string
  /** Short text drawn inside the cell (e.g. a headcount). */
  text?: string
  /** Full description, shown on hover and read by screen readers. */
  title: string
  disabled?: boolean
}

interface WeekGridProps {
  hours: { from: number; to: number }
  describe: (slot: number, day: number, hour: number) => CellAppearance
  /** Called for each cell a paint stroke touches. Omit for a read-only grid. */
  onPaint?: (slot: number) => void
  label: string
  /** Column headers; defaults to the bare day names. */
  dayLabels?: readonly string[]
}

/**
 * A days × hours grid that can be painted by click-dragging.
 *
 * Strokes are tracked with `pointermove` + `elementFromPoint` rather than per-cell
 * `pointerenter`, because touch input implicitly captures the pointer to the first cell
 * touched — `pointerenter` would never fire on the rest of the stroke.
 */
export function WeekGrid({ hours, describe, onPaint, label, dayLabels = DAY_NAMES }: WeekGridProps) {
  const painting = useRef(false)
  const lastSlot = useRef(-1)

  useEffect(() => {
    const stop = () => {
      painting.current = false
      lastSlot.current = -1
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const paintAt = (x: number, y: number) => {
    const cell = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-slot]')
    if (!cell || cell.dataset.disabled === 'true') return
    const slot = Number(cell.dataset.slot)
    if (slot === lastSlot.current) return
    lastSlot.current = slot
    onPaint?.(slot)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPaint || event.button !== 0) return
    ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
    painting.current = true
    paintAt(event.clientX, event.clientY)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (painting.current) paintAt(event.clientX, event.clientY)
  }

  const rows = []
  for (let hour = hours.from; hour < hours.to; hour++) {
    const cells = []
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const slot = slotIndex(day, hour)
      const look = describe(slot, day, hour)
      cells.push(
        <div
          key={day}
          role="gridcell"
          className={`week-cell ${look.className}`}
          data-slot={slot}
          data-disabled={look.disabled ? 'true' : undefined}
          title={look.title}
          aria-label={look.title}
        >
          {look.text}
        </div>,
      )
    }
    rows.push(
      <div role="row" className="week-row" key={hour}>
        <div role="rowheader" className="week-hour">
          {fmtHour(hour)}
        </div>
        {cells}
      </div>,
    )
  }

  return (
    <div className="week-grid-scroll">
      <div
        role="grid"
        aria-label={label}
        className={`week-grid ${onPaint ? 'is-paintable' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <div role="row" className="week-row week-head">
          <div className="week-hour" />
          {dayLabels.map((name) => (
            <div role="columnheader" key={name} className="week-day">
              {name}
            </div>
          ))}
        </div>
        {rows}
      </div>
    </div>
  )
}
