import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** A modal on the native `<dialog>`, which brings focus trapping and Escape with it. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      // The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop.
      onClick={(event) => event.target === ref.current && onCancel()}
    >
      <div className="modal-body">
        <h2 id={titleId} className="modal-title">{title}</h2>
        {children}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  )
}
