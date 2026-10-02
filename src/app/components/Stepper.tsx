import { STEPS, type StepId, type StepState } from '../steps'
import { Icon } from './ui/Icon'

interface StepperProps {
  /** `null` on pages outside the steps, such as Settings. */
  current: StepId | null
  states: Record<StepId, StepState>
  onSelect: (step: StepId) => void
}

/** The five steps as a numbered trail. Any step can be opened directly; the marks only guide. */
export function Stepper({ current, states, onSelect }: StepperProps) {
  return (
    <nav className="stepper" aria-label="Steps">
      <ol>
        {STEPS.map((step, i) => {
          const state = states[step.id]
          const active = step.id === current
          const label = `${step.label}${state === 'done' ? ', done' : state === 'attention' ? ', needs attention' : ''}`
          return (
            <li key={step.id} className={`step step--${state}${active ? ' is-current' : ''}`}>
              <button
                type="button"
                className="step-button"
                aria-current={active ? 'step' : undefined}
                aria-label={label}
                title={label}
                onClick={() => onSelect(step.id)}
              >
                <span className="step-marker" aria-hidden="true">
                  {state === 'done' && !active ? <Icon name="check" size={12} /> : i + 1}
                </span>
                <span className="step-label">{step.label}</span>
                {state === 'attention' && <span className="step-alert" aria-hidden="true" />}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Back and Next at the foot of each step, named for where they lead. */
export function StepFooter({ current, onSelect }: { current: StepId; onSelect: (step: StepId) => void }) {
  const index = STEPS.findIndex((s) => s.id === current)
  const prev = STEPS[index - 1]
  const next = STEPS[index + 1]
  return (
    <div className="step-footer">
      {prev && (
        <button type="button" className="btn" onClick={() => onSelect(prev.id)}>
          <Icon name="arrowLeft" size={14} /> {prev.label}
        </button>
      )}
      <span className="spacer" />
      {next && (
        <button type="button" className="btn btn--primary" onClick={() => onSelect(next.id)}>
          Next: {next.label} <Icon name="arrowRight" size={14} />
        </button>
      )}
    </div>
  )
}
