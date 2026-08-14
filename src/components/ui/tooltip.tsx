import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md',
        'animate-in fade-in-0 zoom-in-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/**
 * InfoDot: the "explain this" affordance. A small ? that answers, on hover
 * or tap, the question a vendor would otherwise have to email us. Body copy
 * should be written in the vendor's vocabulary, not ours.
 */
export function InfoDot({
  title,
  children,
  side = 'top',
  className,
}: {
  title?: string
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  // Radix tooltips are hover-only; onClick toggle covers touch and the
  // instinct to click things that look clickable.
  const [open, setOpen] = React.useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={title ? `About ${title}` : 'More information'}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full align-middle',
            'border border-muted-foreground/40 text-[10px] font-semibold leading-none text-muted-foreground/70',
            'transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {title && <p className="mb-1 font-semibold text-foreground">{title}</p>}
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
