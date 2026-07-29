import { describe, expect, it } from 'vitest'
import {
  parseMultipleJsonObjects,
  parseBundle,
  kindOf,
  type ViewModelBundle,
} from './bundleFormat'

const productFile = `
{
  "x-publishes": "product",
  "$id": "ardis/license-verification",
  "title": "Medical Licence Verification",
  "description": "Primary-source verification.",
  "x-verifier-id": "ardis",
  "x-verifier-name": "Ardis Data",
  "x-sku": "license-verification",
  "x-credential-type": "license",
  "x-order-type": "license",
  "x-price-one-time": 4500,
  "type": "object",
  "required": ["first_name"],
  "properties": { "first_name": { "type": "string", "title": "First Name" } }
}
{ "ui:order": ["first_name"] }
{ "first_name": "Bhavana" }
`

const credentialFile = `
{
  "x-publishes": "credential-schema",
  "$id": "ardis/license/v2",
  "title": "Licence Credential",
  "x-verifier-id": "ardis",
  "x-credential-type": "license",
  "x-version": "v2",
  "type": "object",
  "properties": { "reference_id": { "type": "string" } }
}
{ "ui:groups": [{ "title": "Records", "fields": ["reference_id"] }] }
{ "reference_id": "abc" }
`

describe('parseMultipleJsonObjects', () => {
  it('splits concatenated objects', () => {
    expect(parseMultipleJsonObjects('{"a":1}\n{"b":2}\n{"c":3}')).toEqual([
      { a: 1 }, { b: 2 }, { c: 3 },
    ])
  })

  // Braces inside strings must not open or close an object, or a schema whose
  // description mentions JSON would split in the wrong place.
  it('ignores braces inside strings', () => {
    const raw = '{"desc":"a { brace } inside"}\n{"b":2}'
    expect(parseMultipleJsonObjects(raw)).toEqual([
      { desc: 'a { brace } inside' }, { b: 2 },
    ])
  })

  it('ignores escaped quotes', () => {
    expect(parseMultipleJsonObjects('{"q":"say \\"hi\\" {"}')).toEqual([{ q: 'say "hi" {' }])
  })

  it('handles nesting', () => {
    expect(parseMultipleJsonObjects('{"a":{"b":{"c":1}}}')).toEqual([{ a: { b: { c: 1 } } }])
  })

  it('returns nothing for input with no objects', () => {
    expect(parseMultipleJsonObjects('')).toEqual([])
    expect(parseMultipleJsonObjects('not json at all')).toEqual([])
  })
})

describe('parseBundle', () => {
  it('reads a product file and does not invent a credential schema', () => {
    const b = parseBundle(productFile) as ViewModelBundle
    expect(kindOf(b)).toBe('product')
    expect(b.name).toBe('Medical Licence Verification')
    expect(b.verifier_id).toBe('ardis')
    expect(b.sku).toBe('license-verification')
    expect(b.credential_type).toBe('license')
    expect(b['x-price-one-time']).toBe(4500)
    // The regression that mattered: a product file used to fall through to
    // `data_schema: schema` and publish its own order form as the credential
    // display schema, silently.
    expect(b.data_schema).toBeUndefined()
    // A product carries no version: it is edited in place.
    expect(b.version).toBeUndefined()
  })

  it('reads a credential file and does not invent a product', () => {
    const b = parseBundle(credentialFile) as ViewModelBundle
    expect(kindOf(b)).toBe('credential-schema')
    expect(b.credential_type).toBe('license')
    expect(b.version).toBe('v2')
    expect(b.data_schema).toBeDefined()
    // Would previously have become a Stripe product named after the schema.
    expect(b.order_schema).toBeUndefined()
    expect(b['x-pricing']).toBeUndefined()
  })

  it('treats a file with no x-publishes as the legacy combined bundle', () => {
    const legacy = `
      {
        "title": "Old Product",
        "x-verifier-id": "ardis",
        "x-credential-type": "license",
        "x-version": "v1",
        "type": "object",
        "properties": { "a": { "type": "string" } },
        "x-data-schema": { "type": "object", "properties": { "b": { "type": "string" } } }
      }
      { "ui:order": ["a"] }
      { "a": "x" }
    `
    const b = parseBundle(legacy) as ViewModelBundle
    expect(kindOf(b)).toBe('bundle')
    expect(b.order_schema).toBeDefined()
    // The legacy nesting is where the credential schema lived.
    expect((b.data_schema as Record<string, unknown>).properties).toEqual({ b: { type: 'string' } })
  })

  it('accepts the legacy single-object format', () => {
    const b = parseBundle('{"name":"X","verifier_id":"ardis","credential_type":"license"}')
    expect(b).not.toBeNull()
    expect(kindOf(b as ViewModelBundle)).toBe('bundle')
    expect((b as ViewModelBundle).name).toBe('X')
  })

  it('returns null rather than throwing on unusable input', () => {
    expect(parseBundle('')).toBeNull()
    expect(parseBundle('{ not json }')).toBeNull()
    // Two objects is neither the triple nor the legacy single form.
    expect(parseBundle('{"a":1}\n{"b":2}')).toBeNull()
  })

  it('defaults kind to bundle when the field is absent', () => {
    expect(kindOf({} as ViewModelBundle)).toBe('bundle')
  })

  // A file could claim a kind we do not implement; it must not be trusted into
  // one of the real paths.
  it('an unknown x-publishes value falls back to the legacy reading', () => {
    const odd = productFile.replace('"x-publishes": "product"', '"x-publishes": "something-else"')
    const b = parseBundle(odd) as ViewModelBundle
    expect(kindOf(b)).toBe('bundle')
  })
})
