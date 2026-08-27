import { describe, it, expect } from 'vitest'
import { productToFileText } from './productFile'
import { parseBundle, kindOf } from './bundleFormat'
import type { ProductEntry } from '../ardisMsClient'

// The whole feature is one invariant: what Edit order form loads is exactly
// what publish consumes, with nothing dropped in between. Broken silently,
// this recreates the week Dylan just had, so it is pinned as a round trip
// through the same parser the import flow uses.
const product: ProductEntry = {
  name: 'License Verification',
  description: 'Primary-source licence check',
  verifier_id: 'ardis',
  verifier_name: 'Ardis',
  sku: 'license-verification',
  credential_type: 'license',
  order_type: 'license',
  price_one_time: 45,
  order_schema: {
    type: 'object',
    properties: {
      records: { type: 'array', title: 'Records' },
      reference_id: { type: 'string', title: 'Reference' },
    },
    required: ['records'],
  },
  order_ui_schema: { 'ui:order': ['reference_id', 'records'] },
}

describe('Edit order form round trip', () => {
  const parsed = parseBundle(productToFileText(product))

  it('parses back as a product, never a schema or legacy bundle', () => {
    expect(parsed).not.toBeNull()
    expect(kindOf(parsed!)).toBe('product')
  })

  it('keeps identity: verifier, sku, credential type', () => {
    expect(parsed!.verifier_id).toBe('ardis')
    expect(parsed!.sku).toBe('license-verification')
    expect(parsed!.credential_type).toBe('license')
  })

  it('keeps the order form fields and requirements', () => {
    const os = parsed!.order_schema as Record<string, unknown>
    expect(Object.keys(os.properties as object)).toEqual(['records', 'reference_id'])
    expect(os.required).toEqual(['records'])
  })

  it('keeps the ui schema, including a chosen field order', () => {
    expect((parsed!.order_ui_schema as Record<string, unknown>)['ui:order'])
      .toEqual(['reference_id', 'records'])
  })

  it('keeps the price, converted to the unit publishing sends', () => {
    // The fixture's product reports 45, meaning $45.00, because the server
    // reports this field in dollars. Publishing sends it back as cents, so the
    // file has to carry 4500. It used to carry 45 and quietly republished the
    // product at forty five pence.
    expect(parsed!['x-price-one-time']).toBe(4500)
  })
})

// The server reports a flat price in dollars but reads it back in cents, so
// copying the reported number into an editable file unchanged republished a
// $25.00 product at $0.25 and archived the real price. The file must carry
// cents, the unit publishing actually sends.
describe('flat price units', () => {
  it('writes a reported $25.00 into the file as 2500 cents', () => {
    const text = productToFileText({
      id: 'prod_x', name: 'Example Check', verifier_id: 'ardis',
      sku: 'example-check', credential_type: 'example-check',
      order_schema: { type: 'object', properties: { a: { type: 'string' } } },
      price_one_time: 25,
    } as never)
    const first = JSON.parse(text.slice(0, text.indexOf('\n{', 1)))
    expect(first['x-price-one-time']).toBe(2500)
  })

  it('leaves a product with no flat price alone', () => {
    const text = productToFileText({
      id: 'prod_y', name: 'Subscription', verifier_id: 'ardis',
      sku: 'sub', credential_type: 'license',
      order_schema: { type: 'object', properties: {} },
    } as never)
    expect(text).not.toContain('x-price-one-time')
  })
})
