import { useEffect, useState } from 'react'

interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  integer?: boolean
  /** Visually hide the label (it is still read by screen readers). */
  hideLabel?: boolean
  disabled?: boolean
}

/**
 * Number input that only reports values that are complete and in range.
 *
 * It keeps its own draft text so an admin can clear the box and type "12" without the project
 * briefly holding 0 or 1 — each of which could flash a validation error or reset a grid.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = true,
  hideLabel,
  disabled,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft((current) => (Number(current) === value && current.trim() !== '' ? current : String(value)))
  }, [value])

  const accept = (text: string): number | null => {
    if (text.trim() === '') return null
    const n = Number(text)
    if (!Number.isFinite(n)) return null
    if (integer && !Number.isInteger(n)) return null
    if (min !== undefined && n < min) return null
    if (max !== undefined && n > max) return null
    return n
  }

  const input = (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={accept(draft) === null}
      onChange={(event) => {
        setDraft(event.target.value)
        const n = accept(event.target.value)
        if (n !== null && n !== value) onChange(n)
      }}
      onBlur={() => setDraft(String(value))}
    />
  )

  if (hideLabel) return input
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  )
}
