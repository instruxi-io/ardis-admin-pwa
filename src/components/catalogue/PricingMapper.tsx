/**
 * What a product will charge, in the currency it will charge in.
 *
 * Read only x-pricing for months, so a product priced with x-price-one-time
 * reported itself as free on the one step whose job is saying what it costs.
 */

import type { ViewModelBundle } from '@/lib/catalogue/bundleFormat'
import type { XPricingConfig } from '@/lib/catalogue/pricing'
import { money } from '@/lib/catalogue/pricing'

export function PricingMapper({ bundle }: { bundle: ViewModelBundle }) {
  const rawXPricing = (bundle['x-pricing'] ?? (bundle as any).x_pricing) as XPricingConfig | undefined
  const oneTime = (bundle['x-price-one-time'] as number) ?? 0
  const oneTimeCurrency = (bundle['x-price-currency'] as string) || 'usd'
  const hasTiers = !!rawXPricing && (!!rawXPricing.options?.length || !!rawXPricing.addons?.length)

  // A flat price is the common case and was reported as free: PricingMapper only
  // ever looked at x-pricing, so the two paid ardis products showed "will
  // publish as free" on the one step whose job is to say what it charges.
  if (!hasTiers) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pricing</p>
        {oneTime > 0 ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
            <span className="text-sm font-semibold">{money(oneTime, oneTimeCurrency)}</span>
            <span className="text-xs text-muted-foreground">
              charged once per order · created in Stripe on publish
            </span>
            {!bundle['x-price-currency'] && (
              <span className="text-[11px] text-muted-foreground ml-auto">
                no <span className="font-mono">x-price-currency</span> set, so USD
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No <span className="font-mono">x-price-one-time</span> or <span className="font-mono">x-pricing</span>,
            so this publishes as free.
          </p>
        )}
      </div>
    )
  }

  const fmt = (amount?: number, interval?: string, currency?: string) =>
    !amount ? '—' : money(amount, currency, interval)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">4 — Stripe Pricing</p>
        <span className="text-xs text-emerald-500 font-medium">Prices created automatically on publish</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Stripe prices are created automatically from the amounts in the bundle.
        No manual configuration needed.
      </p>

      {rawXPricing.options && rawXPricing.options.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Subscription Tiers — field: <span className="font-mono text-primary">{rawXPricing.field}</span></p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Option</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {rawXPricing.options.map(opt => (
                  <tr key={opt.value} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono">{opt.value}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(opt.amount, opt.interval, opt.currency)}</td>
                    <td className="px-3 py-2">
                      {opt.stripe_price_id && !opt.stripe_price_id.startsWith('price_REPLACE')
                        ? <span className="font-mono text-emerald-500">{opt.stripe_price_id}</span>
                        : <span className="text-muted-foreground italic">auto-created on publish</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rawXPricing.addons && rawXPricing.addons.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Add-ons</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Add-on</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {rawXPricing.addons.map(addon => (
                  <tr key={addon.field} className="border-t border-border/50">
                    <td className="px-3 py-2">
                      <p className="font-mono">{addon.field}</p>
                      {addon.label && <p className="text-muted-foreground">{addon.label}</p>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(addon.amount, addon.interval, addon.currency)}</td>
                    <td className="px-3 py-2">
                      {addon.stripe_price_id && !addon.stripe_price_id.startsWith('price_REPLACE')
                        ? <span className="font-mono text-emerald-500">{addon.stripe_price_id}</span>
                        : <span className="text-muted-foreground italic">auto-created on publish</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Registry group ────────────────────────────────────────────────────────────
