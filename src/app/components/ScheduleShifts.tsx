import { useState } from 'react'
import { ShiftTable, type ShiftTableRow } from './ShiftTable'
import { ShiftTimeline } from './ShiftTimeline'
import { Segmented } from './ui/Segmented'

interface ScheduleShiftsProps {
  dayLabels: readonly string[]
  rows: ShiftTableRow[]
  /** Hours the timeline spans; defaults to the span of the shifts. */
  hours?: { from: number; to: number }
}

/** A schedule's shifts, as a timeline or as the table, whichever the reader picks. */
export function ScheduleShifts({ dayLabels, rows, hours }: ScheduleShiftsProps) {
  const [view, setView] = useState<'timeline' | 'table'>('timeline')
  return (
    <div className="stack-sm">
      <div className="row">
        <Segmented
          label="Show shifts as"
          options={[
            { value: 'timeline', label: 'Timeline' },
            { value: 'table', label: 'Table' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>
      {view === 'timeline' ? (
        <ShiftTimeline dayLabels={dayLabels} rows={rows} hours={hours} />
      ) : (
        <ShiftTable dayLabels={dayLabels} rows={rows} />
      )}
    </div>
  )
}
