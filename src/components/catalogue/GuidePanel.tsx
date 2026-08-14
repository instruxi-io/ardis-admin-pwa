import { useState } from 'react'
import { ChevronDown, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

// Every support question the vendor team has asked was answerable from this
// panel. It exists so the answer is on the page, not in someone's inbox.
// ponytail: localStorage-only persistence; per-browser, resets on clear. Fine
// for a preference this small. Upgrade path: user prefs on the account.
const DISMISS_KEY = 'credpass_admin_guide_open'

export function GuidePanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(DISMISS_KEY) !== 'closed')
  const toggle = () => {
    setOpen(v => {
      localStorage.setItem(DISMISS_KEY, v ? 'closed' : 'open')
      return !v
    })
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <BookOpen size={14} className="text-primary shrink-0" />
        <span className="text-sm font-medium flex-1">How publishing works</span>
        <ChevronDown
          size={14}
          className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 text-xs text-muted-foreground">
          <ol className="grid gap-3 sm:grid-cols-3">
            <li className="rounded-md border border-border bg-background/60 p-3 space-y-1">
              <p className="font-semibold text-foreground">1. Publish the credential schema</p>
              <p>
                How the credential your verification returns renders on the buyer's
                card, and what they can share from it. Versioned
                (<span className="font-mono">x-version</span>) and immutable once
                published.
              </p>
            </li>
            <li className="rounded-md border border-border bg-background/60 p-3 space-y-1">
              <p className="font-semibold text-foreground">2. Publish the product</p>
              <p>
                What a buyer purchases: the order form they fill in and the price.
                Not versioned. Edit and re-publish it whenever you like, prices
                included.
              </p>
            </li>
            <li className="rounded-md border border-border bg-background/60 p-3 space-y-1">
              <p className="font-semibold text-foreground">3. Done. It is live.</p>
              <p>
                The app reads this catalogue directly: a published product appears
                for professionals immediately, no deploy or approval step on our
                side.
              </p>
            </li>
          </ol>

          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">Anatomy of a file</p>
            <p>
              Each file is three JSON objects stacked in one file, in this order:
              the <span className="font-medium text-foreground/80">schema</span> (fields
              plus <span className="font-mono">x-</span> metadata that says what it
              publishes), the <span className="font-medium text-foreground/80">UI
              schema</span> (layout: field order, groups, widgets), and{' '}
              <span className="font-medium text-foreground/80">sample data</span> (drives
              the phone preview below, never published). The first object's{' '}
              <span className="font-mono">x-publishes</span> declares whether the file
              is a credential schema or a product, and the queue sorts itself so
              schemas always publish before the products that need them.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">Three rules worth knowing</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                The app always fetches the latest schema version, so publishing a new
                version updates how already-issued credentials display, without
                re-issuing anything.
              </li>
              <li>
                A product is refused until the credential schema it renders with is
                published. Drop both files together and the order is handled for you.
              </li>
              <li>
                Changing a price re-publishes cleanly: Stripe prices are immutable, so
                the old price is archived and a new one created. Past orders keep what
                they paid.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
