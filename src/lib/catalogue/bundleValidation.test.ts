import { describe, expect, it } from 'vitest'
import { validateBundle } from './bundleValidation'
import type { ViewModelBundle } from './bundleFormat'

/** Names of the checks that failed, so a test can name what it expects. */
function failed(b: ViewModelBundle): string[] {
  return validateBundle(b).checks.filter(c => !c.pass).map(c => c.label)
}

const product = (over: Partial<ViewModelBundle> = {}): ViewModelBundle => ({
  kind: 'product',
  name: 'Medical Licence Verification',
  verifier_id: 'ardis',
  credential_type: 'license',
  sku: 'license-verification',
  order_type: 'license',
  order_schema: {
    type: 'object',
    required: ['first_name'],
    properties: {
      first_name: { type: 'string', title: 'First Name' },
      tier: { type: 'string', enum: ['standard', 'express'] },
      rush: { type: 'boolean' },
    },
  },
  order_ui_schema: { 'ui:order': ['first_name', 'tier', 'rush'] },
  data: { first_name: 'Bhavana', tier: 'standard', rush: false },
  ...over,
})

const credential = (over: Partial<ViewModelBundle> = {}): ViewModelBundle => ({
  kind: 'credential-schema',
  name: 'Licence Credential',
  verifier_id: 'ardis',
  credential_type: 'license',
  version: 'v2',
  data_schema: {
    type: 'object',
    properties: { reference_id: { type: 'string' }, records: { type: 'array' } },
  },
  ui_schema: { 'ui:groups': [{ title: 'Records', fields: ['records'] }] },
  data: { reference_id: 'abc' },
  ...over,
})

describe('validateBundle: a file is only checked against the half it contains', () => {
  it('passes a well-formed product', () => {
    expect(failed(product())).toEqual([])
  })

  it('passes a well-formed credential schema', () => {
    expect(failed(credential())).toEqual([])
  })

  // The reason validation had to become kind-aware: checking a product for a
  // display schema, or a credential for an order form, failed every time.
  it('does not ask a product for a display schema', () => {
    expect(failed(product()).join(' ')).not.toMatch(/data_schema/)
  })

  it('does not ask a credential schema for an order form or a sku', () => {
    const f = failed(credential()).join(' ')
    expect(f).not.toMatch(/order_schema/)
    expect(f).not.toMatch(/sku/)
    expect(f).not.toMatch(/order_type/)
  })
})

describe('validateBundle: identity', () => {
  it('requires a non-empty name', () => {
    expect(failed(product({ name: '' })).join(' ')).toMatch(/required fields/i)
    expect(failed(product({ name: '   ' })).join(' ')).toMatch(/required fields/i)
  })

  it('requires verifier_id and credential_type to be slugs', () => {
    expect(failed(product({ verifier_id: 'Ardis Data' })).join(' ')).toMatch(/verifier_id/)
    expect(failed(product({ credential_type: 'License Type' })).join(' ')).toMatch(/credential_type/)
  })

  it('rejects an invalid sku but allows none at all', () => {
    expect(failed(product({ sku: 'Not A Sku' })).join(' ')).toMatch(/sku/)
    expect(failed(product({ sku: undefined }))).toEqual([])
  })
})

describe('validateBundle: credential schema versions', () => {
  // A published version is immutable, so the version IS the schema's identity.
  it('requires an explicit vN', () => {
    expect(failed(credential({ version: undefined })).join(' ')).toMatch(/x-version/)
    expect(failed(credential({ version: '' })).join(' ')).toMatch(/x-version/)
    expect(failed(credential({ version: 'latest' })).join(' ')).toMatch(/x-version/)
    expect(failed(credential({ version: '2' })).join(' ')).toMatch(/x-version/)
  })

  it('accepts any vN', () => {
    for (const v of ['v1', 'v2', 'v10']) {
      expect(failed(credential({ version: v }))).toEqual([])
    }
  })
})

describe('validateBundle: sample data must match its own schema', () => {
  // This is the point of the three-object layout: object 3 is the formData pane,
  // so if it does not fit object 1 the file did not come from a working editor.
  it('rejects a sample order field the form does not define', () => {
    const b = product({ data: { first_name: 'X', not_a_field: 'Y' } })
    expect(failed(b).join(' ')).toMatch(/sample order data/i)
  })

  it('rejects sample credential data the schema does not declare', () => {
    const b = credential({ data: { reference_id: 'a', mystery: 1 } })
    expect(failed(b).join(' ')).toMatch(/sample credential data/i)
  })

  it('accepts an empty sample', () => {
    expect(failed(product({ data: {} }))).toEqual([])
  })
})

describe('validateBundle: ui references', () => {
  it('rejects a ui:order naming an undefined field', () => {
    const b = product({ order_ui_schema: { 'ui:order': ['first_name', 'ghost'] } })
    expect(failed(b).join(' ')).toMatch(/ui:order/)
  })

  it('rejects ui:groups naming an undeclared field', () => {
    const b = credential({ ui_schema: { 'ui:groups': [{ title: 'X', fields: ['ghost'] }] } })
    expect(failed(b).join(' ')).toMatch(/ui:groups/)
  })
})

describe('validateBundle: format mixing', () => {
  it('rejects a product file that embeds x-data-schema', () => {
    // The parser drops the embedded schema without a word; the vendor ships
    // believing their new credential schema went live with the product.
    const b = product()
    ;(b.order_schema as Record<string, unknown>)['x-data-schema'] = { type: 'object' }
    expect(failed(b).join(' ')).toMatch(/does not embed a credential schema/)
  })
})

describe('validateBundle: pricing', () => {
  const priced = (xp: unknown) => product({ 'x-pricing': xp })

  it('treats no pricing as a free product', () => {
    expect(failed(product())).toEqual([])
  })

  // The check that contradicted its own type for weeks: it demanded a currency
  // on every tier while XPricingOption had no currency field at all.
  it('requires an explicit currency on every tier and add-on', () => {
    const noCurrency = priced({
      field: 'tier',
      options: [{ value: 'standard', amount: 4500 }],
    })
    expect(failed(noCurrency).join(' ')).toMatch(/currency/)

    const withCurrency = priced({
      field: 'tier',
      options: [{ value: 'standard', amount: 4500, currency: 'gbp' }],
    })
    expect(failed(withCurrency)).toEqual([])
  })

  it("requires a value on every option — a title alone can never be bought", () => {
    // The exact file a vendor published: options carrying title/name, amount,
    // currency, interval, and no value. The renderer said valid, the server
    // said 400. Checkout matches the buyer's answer in the pricing field
    // against option values, so an option without one is unreachable.
    const dylanShaped = priced({
      field: 'tier',
      options: [
        { title: 'Monthly', amount: 3900, currency: 'USD', interval: 'month' },
        { name: 'Yearly', amount: 39000, currency: 'USD', interval: 'year' },
      ],
    })
    expect(failed(dylanShaped).join(' ')).toMatch(/value/)
  })

  it('rejects an option value the pricing field cannot answer', () => {
    // tier is an enum of standard/express; a "premium" tier exists in Stripe
    // but no form answer ever selects it.
    const b = priced({
      field: 'tier',
      options: [{ value: 'premium', amount: 9900, currency: 'usd' }],
    })
    expect(failed(b).join(' ')).toMatch(/values are answers/)
  })

  it('accepts option values drawn from the pricing field enum', () => {
    const b = priced({
      field: 'tier',
      options: [
        { value: 'standard', amount: 4500, currency: 'usd' },
        { value: 'express', amount: 9900, currency: 'usd', interval: 'month' },
      ],
    })
    expect(failed(b)).toEqual([])
  })

  it('requires the pricing field to exist in the order form', () => {
    const b = priced({ field: 'nonexistent', options: [{ value: 'a', amount: 100, currency: 'usd' }] })
    expect(failed(b).join(' ')).toMatch(/x-pricing field/)
  })

  it('rejects a free tier, since the reconciler drops it and the form still offers it', () => {
    const b = priced({ field: 'tier', options: [{ value: 'standard', amount: 0, currency: 'usd' }] })
    expect(failed(b).join(' ')).toMatch(/amounts/)
  })

  it('allows a free add-on but requires its field to exist', () => {
    expect(failed(priced({
      field: 'tier',
      options: [{ value: 'standard', amount: 4500, currency: 'usd' }],
      addons: [{ field: 'rush', amount: 0, currency: 'usd' }],
    }))).toEqual([])

    expect(failed(priced({
      field: 'tier',
      options: [{ value: 'standard', amount: 4500, currency: 'usd' }],
      addons: [{ field: 'ghost', amount: 500, currency: 'usd' }],
    })).join(' ')).toMatch(/addon field/i)
  })

  it('validates the flat price currency when set', () => {
    expect(failed(product({ 'x-price-currency': 'gbp' }))).toEqual([])
    expect(failed(product({ 'x-price-currency': 'pounds' })).join(' ')).toMatch(/x-price-currency/)
    // Absent is fine: it means USD, which is what every earlier product is.
    expect(failed(product({ 'x-price-currency': undefined }))).toEqual([])
  })
})

describe('validateBundle: security', () => {
  it('rejects an external URL anywhere in the file', () => {
    const b = product({ description: 'see https://evil.example.com' })
    expect(failed(b).join(' ')).toMatch(/external URL/i)
  })

  it('rejects script injection patterns', () => {
    for (const bad of ['<script>alert(1)</script>', 'javascript:alert(1)', 'eval(1)']) {
      expect(failed(product({ description: bad })).join(' ')).toMatch(/script/i)
    }
  })

  // "conversion=1" matches a naive on\w+= pattern. A legitimate value must not
  // read as an inline event handler.
  it('does not flag ordinary text that resembles an event handler', () => {
    expect(failed(product({ description: 'conversion=1 and ratio=2' }))).toEqual([])
    expect(failed(product({ description: 'version=2' }))).toEqual([])
  })

  // Still catches a genuine handler, with or without spaces around the equals.
  it('catches a real inline handler', () => {
    for (const bad of ['onclick=x()', 'onerror = x()', '<img onload=x>']) {
      expect(failed(product({ description: bad })).join(' ')).toMatch(/script/i)
    }
  })

  // The portal previously omitted this while the server refused it, so a file
  // could pass here and be rejected on publish.
  it('catches a data: URL, as the server does', () => {
    expect(failed(product({ description: 'data:text/html;base64,AAAA' })).join(' ')).toMatch(/script/i)
  })
})

describe('validateBundle: ui:order wildcard', () => {
  // RJSF requires ui:order to name every property or to end with "*". Rejecting
  // the wildcard forced authors to list every field, and a ui:order that had gone
  // stale against its properties became a hard render error in the preview
  // rather than a failed check.
  it('accepts "*" as the catch-all', () => {
    const b = product({ order_ui_schema: { 'ui:order': ['first_name', '*'] } })
    expect(failed(b).join(' ')).not.toMatch(/ui:order/)
  })

  it('still rejects a named field that does not exist', () => {
    const b = product({ order_ui_schema: { 'ui:order': ['first_name', 'ghost', '*'] } })
    expect(failed(b).join(' ')).toMatch(/ui:order/)
  })
})
