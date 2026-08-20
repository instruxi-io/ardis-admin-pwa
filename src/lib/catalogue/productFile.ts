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
  if (p.price_one_time)         obj1['x-price-one-time'] = p.price_one_time

  const files = [obj1, p.order_ui_schema ?? {}, {}]
  return files.map(o => JSON.stringify(o, null, 2)).join('\n')
}
