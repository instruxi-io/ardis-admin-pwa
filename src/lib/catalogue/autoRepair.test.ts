import { describe, it, expect } from 'vitest'
import { autoRepair, type ExistingProduct } from './autoRepair'
import { parseBundle, kindOf } from './bundleFormat'
import { validateBundle } from './bundleValidation'

// A structurally faithful copy of the file a vendor actually sent: a product
// file with the credential schema still embedded, the sku copied from the
// licence product it was cloned from, and pricing options carrying titles but
// no values. It rendered as valid and came back 400 — and had the pricing
// passed, the sku would have overwritten the licence product and the embedded
// schema would have been dropped without a word. Intake repairs all three.
const dylanShaped = () => JSON.stringify({
  'x-publishes': 'product',
  $id: 'ardis/sanctions/v6',
  title: 'Sanctions Monitoring',
  description: 'Primary-source sanctions monitoring.',
  'x-verifier-id': 'ardis',
  'x-verifier-name': 'Ardis Data',
  'x-sku': 'license-verification',
  'x-credential-type': 'sanctions',
  'x-order-type': 'sanctions',
  type: 'object',
  properties: {
    records: {
      type: 'array',
      minItems: 1,
      title: 'Verification Records',
      items: {
        type: 'object',
        required: ['provider_info'],
        properties: {
          provider_info: {
            type: 'object',
            title: 'Provider',
            required: ['first_name', 'last_name'],
            properties: {
              first_name: { title: 'First Name', type: 'string' },
              last_name: { title: 'Last Name', type: 'string' },
            },
          },
        },
      },
    },
    reference_id: { title: 'Verifier Reference', type: 'string' },
  },
  'x-data-schema': {
    $id: 'ardis/sanctions/v3',
    title: 'License Verification Credential',
    type: 'object',
    required: ['reference_id', 'records'],
    properties: {
      records: { type: 'array', items: { type: 'object', properties: { record_id: { type: 'integer' } } } },
      reference_id: { type: 'string' },
    },
    'x-credential-type': 'sanctions',
    'x-publishes': 'credential-schema',
    'x-verifier-id': 'ardis',
    'x-version': 'v2',
  },
  'x-data-ui-schema': { records: { items: { 'ui:order': ['record_id', '*'] } } },
  'x-pricing': {
    field: 'records',
    title: 'Essential Portable Verification',
    options: [
      { title: 'Monthly', amount: 3900, currency: 'usd', interval: 'month' },
      { name: 'Yearly', amount: 39000, currency: 'usd', interval: 'year' },
    ],
  },
  'x-version': 'v6',
}, null, 2) + '\n' + JSON.stringify({
  'ui:order': ['records', 'reference_id', '*'],
}, null, 2) + '\n{}'

const registry: ExistingProduct[] = [
  { verifier_id: 'ardis', sku: 'license-verification', name: 'License Verification', credential_type: 'license' },
]

describe('autoRepair: the file a vendor actually sent', () => {
  it('splits, re-skus, and prices it into two files that pass validation', () => {
    const out = autoRepair('ardis_sanctions.product.json', dylanShaped(), registry)
    expect(out).toHaveLength(2)

    const [credFile, prodFile] = out
    const cred = parseBundle(credFile.raw)!
    expect(kindOf(cred)).toBe('credential-schema')
    expect(cred.version).toBe('v2')
    // $id said v3 while x-version said v2; the version wins.
    expect((cred.data_schema as Record<string, unknown>).$id).toBe('ardis/sanctions/v2')
    expect(validateBundle(cred).checks.filter(c => !c.pass)).toEqual([])

    const prod = parseBundle(prodFile.raw)!
    expect(kindOf(prod)).toBe('product')
    expect(prod.sku).toBe('sanctions-monitoring')
    expect(validateBundle(prod).checks.filter(c => !c.pass)).toEqual([])

    // Pricing became matchable: values derived from titles, a plan field to
    // answer them, required, and placed before the '*' in ui:order.
    const schema = prod.order_schema as Record<string, unknown>
    const props = schema.properties as Record<string, Record<string, unknown>>
    expect(props.plan.enum).toEqual(['monthly', 'yearly'])
    expect(schema.required).toContain('plan')
    const xp = schema['x-pricing'] as { field: string; options: { value: string }[] }
    expect(xp.field).toBe('plan')
    expect(xp.options.map(o => o.value)).toEqual(['monthly', 'yearly'])
    const order = (prod.order_ui_schema as Record<string, unknown>)['ui:order'] as string[]
    expect(order.indexOf('plan')).toBeLessThan(order.indexOf('*'))

    // Every repair is named for the vendor to read.
    const allNotes = out.flatMap(f => f.notes).join(' ')
    expect(allNotes).toMatch(/own file/)
    expect(allNotes).toMatch(/x-sku/)
    expect(allNotes).toMatch(/Billing Plan/)
  })

  it('publishes the credential schema before the product', () => {
    const out = autoRepair('f.json', dylanShaped(), registry)
    expect(out[0].name).toMatch(/credential-schema/)
  })
})

describe('autoRepair: leaves what it does not understand alone', () => {
  it('passes a correct product file through untouched', () => {
    const clean = JSON.stringify({
      'x-publishes': 'product',
      title: 'Sanctions Monitoring',
      'x-verifier-id': 'ardis',
      'x-sku': 'sanctions-monitoring',
      'x-credential-type': 'sanctions',
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'object', properties: { a: {} } } } },
    }) + '\n{}\n{}'
    const out = autoRepair('clean.json', clean, registry)
    expect(out).toHaveLength(1)
    expect(out[0].raw).toBe(clean)
    expect(out[0].notes).toEqual([])
  })

  it('keeps a sku that legitimately updates the same product', () => {
    const sameType = JSON.stringify({
      'x-publishes': 'product',
      title: 'License Verification',
      'x-verifier-id': 'ardis',
      'x-sku': 'license-verification',
      'x-credential-type': 'license',
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'object', properties: { a: {} } } } },
    }) + '\n{}\n{}'
    const out = autoRepair('f.json', sameType, registry)
    expect(out[0].notes).toEqual([])
  })

  it('does not touch credential-schema files or legacy bundles', () => {
    const cred = JSON.stringify({ 'x-publishes': 'credential-schema', title: 'X' }) + '\n{}\n{}'
    expect(autoRepair('c.json', cred, registry)[0].raw).toBe(cred)
    const legacy = JSON.stringify({ title: 'X', 'x-data-schema': { type: 'object' } }) + '\n{}\n{}'
    expect(autoRepair('l.json', legacy, registry)[0].raw).toBe(legacy)
  })

  it('keeps values a vendor already wrote and only fills the gaps', () => {
    const partial = JSON.stringify({
      'x-publishes': 'product',
      title: 'Thing',
      'x-verifier-id': 'ardis',
      'x-sku': 'thing',
      'x-credential-type': 'thing',
      type: 'object',
      properties: { tier: { type: 'string', enum: ['standard', 'express'] } },
      'x-pricing': {
        field: 'tier',
        options: [
          { value: 'standard', amount: 100, currency: 'usd' },
          { title: 'Express', amount: 200, currency: 'usd' },
        ],
      },
    }) + '\n{}\n{}'
    const out = autoRepair('f.json', partial, registry)
    const prod = parseBundle(out[0].raw)!
    const xp = (prod.order_schema as Record<string, unknown>)['x-pricing'] as { field: string; options: { value: string }[] }
    expect(xp.options.map(o => o.value)).toEqual(['standard', 'express'])
    // Both values sit in tier's enum, so no plan field is invented.
    expect(xp.field).toBe('tier')
    expect('plan' in ((prod.order_schema as Record<string, unknown>).properties as object)).toBe(false)
  })
})
