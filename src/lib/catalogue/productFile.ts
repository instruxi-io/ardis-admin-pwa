import type { ProductEntry } from '../ardisMsClient'

/**
 * Reconstructs the two-file product text from a live product record, so the
 * portal can load an existing order form back into the editor.
 *
 * This existed for credential schemas (New Version) but not for products, and
 * the gap sent a vendor to the wrong file for a week: the buttons all edited
 * the credential schema, while the order form lives on the product. Editing
 * "all the files" from the portal was the reasonable expectation; this makes
 * it true.
 *
 * Round-trips through parseBundle's `x-publishes: product` branch, so what
 * this emits is exactly what publishing consumes.
 */
export function productToFileText(p: ProductEntry): string {
  const orderSchema = (p.order_schema ?? {}) as Record<string, unknown>
  const obj1: Record<string, unknown> = {
    'x-publishes':       'product',
    '$id':               `${p.verifier_id}/${p.sku ?? p.credential_type ?? ''}`,
    'title':             p.name,
    'description':       p.description ?? '',
    'x-verifier-id':     p.verifier_id ?? '',
    'x-verifier-name':   p.verifier_name ?? p.verifier_id ?? '',
    'x-sku':             p.sku ?? '',
    'x-credential-type': p.credential_type ?? '',
    'x-order-type':      p.order_type ?? 'license',
    'type':              'object',
    // The served schema's own fields win over the scaffold above, so nothing
    // authored is lost; x-publishes and identity fields are ours to assert.
    ...orderSchema,
  }
  if (p.x_pricing)              obj1['x-pricing'] = p.x_pricing
  if (p.product_role)           obj1['x-product-role'] = p.product_role
  // Cents, because that is what publishing sends and what the server stores.
  // The server REPORTS this field in dollars (buildPricingResponse divides by
  // 100) while parseDesiredPrices reads it back as cents, so copying the
  // reported number into the file straight turned a $25.00 product into a
  // $0.25 one the next time it was published, archiving the real price on the
  // way. Convert once, here, where the two units meet.
  if (p.price_one_time) {
    obj1['x-price-one-time'] = Math.round(Number(p.price_one_time) * 100)
    // Publishing defaults a blank currency to usd, so a GBP flat price that
    // comes back without its currency is republished as a new USD price and
    // the real one is archived. Only written when the record actually carries
    // a currency: left out, PricingMapper still shows its "so USD" note, which
    // is honest, where baking in 'usd' here would not be.
    // ponytail: the product response does not report the flat price's currency
    // yet (buildPricingResponse drops it in the one_time branch), so this is
    // inert until that lands; the upgrade is server-side, not here.
    if (p.price_currency) obj1['x-price-currency'] = p.price_currency
  }

  const files = [obj1, p.order_ui_schema ?? {}, {}]
  return files.map(o => JSON.stringify(o, null, 2)).join('\n')
}
