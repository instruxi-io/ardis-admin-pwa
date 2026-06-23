import { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'

interface PublishConfirmModalProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  /** What the user must type exactly to confirm */
  confirmText: string
  /** Action label — shown in the title and button */
  action?: 'Publish' | 'Delete' | 'Archive'
  /** One-liner describing what's being actioned */
  description: string
}

/**
 * Production safeguard modal. Shown before any destructive or live-affecting
 * action in the production admin portal. Requires the user to type a specific
 * identifier before the action fires.
 *
 * Only render this when VITE_APP_ENV === 'production'. In dev/staging the
 * action should fire immediately.
 */
export function PublishConfirmModal({
  open,
  onConfirm,
  onCancel,
  confirmText,
  action = 'Publish',
  description,
}: PublishConfirmModalProps) {
  const [typed, setTyped] = useState('')

  // Reset input whenever modal opens.
  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  if (!open) return null

  const matches = typed.trim() === confirmText.trim()
  const isDelete = action === 'Delete'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className={`flex items-start gap-3 rounded-t-xl p-5 ${isDelete ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
          <AlertTriangle
            size={22}
            className={`mt-0.5 flex-shrink-0 ${isDelete ? 'text-destructive' : 'text-amber-500'}`}
          />
          <div className="flex-1">
            <p className={`text-sm font-bold tracking-wide uppercase ${isDelete ? 'text-destructive' : 'text-amber-500'}`}>
              Production — {action}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            This will take effect immediately in the{' '}
            <span className="font-semibold text-foreground">live production app</span>.
            Type the following to confirm:
          </p>

          <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm font-semibold text-foreground select-all">
            {confirmText}
          </div>

          <Input
            autoFocus
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches) onConfirm() }}
            placeholder={`Type "${confirmText}" to confirm`}
            className={typed.length > 0 && !matches ? 'border-destructive focus-visible:ring-destructive' : ''}
          />

          {typed.length > 0 && !matches && (
            <p className="text-xs text-destructive">Doesn't match — check for typos.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!matches}
            onClick={onConfirm}
            className={isDelete
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40'
              : 'bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40'
            }
          >
            {action} to Production
          </Button>
        </div>
      </div>
    </div>
  )
}
