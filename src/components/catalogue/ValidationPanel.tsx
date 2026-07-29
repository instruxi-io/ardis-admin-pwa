/** The check list a file must pass, and why each one exists. */

import type { ValidationResult } from '@/lib/catalogue/bundleValidation'
import { CheckCircle2, ChevronDown, ChevronUp, XCircle } from 'lucide-react'
import { useState } from 'react'

export function ValidationPanel({ result }: { result: ValidationResult }) {
  const [open, setOpen] = useState(false)
  const passed = result.checks.filter(c => c.pass).length

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {result.pass
            ? <CheckCircle2 size={14} className="text-emerald-500" />
            : <XCircle size={14} className="text-destructive" />}
          <span className="text-sm font-medium">
            {result.pass ? 'All checks passed' : 'Validation failed'}
          </span>
          <span className="text-xs text-muted-foreground">{passed}/{result.checks.length} checks</span>
        </div>
        {open ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {result.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5 bg-muted/10">
              {c.pass
                ? <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                : <XCircle size={12} className="text-destructive mt-0.5 shrink-0" />}
              <div>
                <p className="text-xs">{c.label}</p>
                {!c.pass && c.message && (
                  <p className="text-xs text-destructive mt-0.5">{c.message}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ── Page ──────────────────────────────────────────────────────────────────────

// ── Preview error boundary ────────────────────────────────────────────────────
// Catches RJSF render errors (e.g. ui:order missing properties) and shows a
// clean message rather than crashing the import flow.
