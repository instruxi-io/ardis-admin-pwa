/**
 * Product pricing as declared in a bundle, and how it reads as money.
 *
 * The currency field was missing from these types while validateBundle, 1,400
 * lines away in the same file, required every tier to declare one. Money and
 * the rules about money now live together.
 */

// currency was missing from both, which is why every amount rendered with a
// hardcoded "$" and nobody noticed — even though validateBundle requires each
// tier and add-on to set one explicitly, and the server reconciles on it.
export interface XPricingOption { value: string; label?: string; amount?: number; interval?: string; currency?: string; stripe_price_id?: string }

export interface XPricingAddon  { field: string; label?: string; amount?: number; interval?: string; currency?: string; stripe_price_id?: string }

export interface XPricingConfig { model?: string; field?: string; options?: XPricingOption[]; addons?: XPricingAddon[] }

// PricingMapper shows what prices will be auto-created in Stripe when the
// bundle is published. No manual input needed — ardis-ms creates prices from
// the amounts defined in x-pricing and stores the IDs back in Stripe metadata.
// Money, in the currency it will actually charge in. This formatted every amount
// with a hardcoded "$", which became wrong the moment a flat price could declare
// x-price-currency, and was already wrong for any tier priced in gbp.
export function money(amount: number, currency?: string, interval?: string): string {
  // Blank counts as absent, matching defaultCurrency() in ardis-ms. A vendor can
  // write "currency": "" on a tier, and `?? 'usd'` accepts that as a real value:
  // Intl then throws, the fallback prints an empty code, and the amount renders
  // with no currency at all.
  const code = (currency ?? '').trim() ? currency!.trim().toUpperCase() : 'USD'
  let text: string
  try {
    text = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .format(amount / 100)
  } catch {
    // An unrecognised code must still show the number rather than throwing away
    // the one fact the vendor came to this step for.
    text = `${(amount / 100).toFixed(2)} ${code}`
  }
  return interval ? `${text}/${interval}` : `${text} one-time`
}
