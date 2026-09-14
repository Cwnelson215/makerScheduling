import type { ReactNode } from 'react'

export interface SegmentedOption<T> {
  value: T
  label: ReactNode
  title?: string
}

interface SegmentedProps<T> {
  label: string
  options: SegmentedOption<T>[]
  /** The pressed option; a value matching none of them leaves the whole group unpressed. */
  value: T | null
  onChange: (value: T) => void
}

export function Segmented<T extends string | number>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-item"
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
