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

  it('keeps the price', () => {
    expect(parsed!['x-price-one-time']).toBe(45)
  })
})
