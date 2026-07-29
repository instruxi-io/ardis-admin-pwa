/**
 * Shared device frame for the catalogue previews. Extracted so the order form
 * and credential card previews can live in their own files without duplicating
 * it — the last time a widget was duplicated across two files, a fix landed on
 * one of them for a month.
 */

export function PhoneFrame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </p>
      <div
        className="relative bg-[#0a0a0a] rounded-[2.5rem] border-4 border-[#2a2a2a] shadow-2xl"
        style={{ width: 320, minHeight: 580 }}
      >
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0a0a0a] rounded-b-2xl z-10" />
        {/* Screen */}
        <div className="rounded-[2rem] overflow-hidden bg-[#111111]" style={{ minHeight: 572 }}>
          {/* Status bar */}
          <div className="h-8 bg-[#0f0f0f] flex items-end justify-between px-6 pb-1">
            <span className="text-[10px] text-[#6b7280]">9:41</span>
            <span className="text-[10px] text-[#6b7280]">●●●</span>
          </div>
          {/* Content — forced dark so the CSS variables resolve to their
              dark-mode values against the dark phone background. */}
          <div className="dark px-4 py-3 overflow-y-auto" style={{ maxHeight: 524 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
