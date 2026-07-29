import { describe, expect, it } from 'vitest'
import { exampleFiles } from './exampleFiles'
import { parseBundle, kindOf } from './bundleFormat'
import { validateBundle } from './bundleValidation'

describe('the first-run example', () => {
  const files = exampleFiles('ardis')

  it('is a credential schema and a product, schema first', () => {
    expect(files).toHaveLength(2)
    expect(kindOf(parseBundle(files[0].raw)!)).toBe('credential-schema')
    expect(kindOf(parseBundle(files[1].raw)!)).toBe('product')
  })

  // The whole point of handing someone an example: it has to be publishable as
  // given. The previous starter emitted the legacy combined shape and nothing
  // would have noticed.
  it('passes every check without being edited', () => {
    for (const f of files) {
      const b = parseBundle(f.raw)
      expect(b, `${f.name} should parse`).not.toBeNull()
      const failures = validateBundle(b!).checks.filter(c => !c.pass).map(c => c.label)
      expect(failures, `failing checks in ${f.name}`).toEqual([])
    }
  })

  it('declares x-publishes on both, so neither reads as legacy', () => {
    for (const f of files) {
      expect(kindOf(parseBundle(f.raw)!)).not.toBe('bundle')
    }
  })

  // The pair must actually be a pair: the product has to name the credential type
  // the schema publishes, or the server refuses it and the example teaches the
  // wrong lesson on someone's first attempt.
  it('the product names the credential type the schema publishes', () => {
    const schema = parseBundle(files[0].raw)!
    const product = parseBundle(files[1].raw)!
    expect(product.credential_type).toBe(schema.credential_type)
    expect(product.verifier_id).toBe(schema.verifier_id)
  })

  it('carries the caller’s own verifier id through', () => {
    const mine = exampleFiles('vendor1')
    expect(parseBundle(mine[0].raw)!.verifier_id).toBe('vendor1')
    expect(mine[0].name).toContain('vendor1')
  })

  // A vendor with nothing published has no id we can know, so the placeholder has
  // to be visible rather than a guess that fails authorisation later.
  it('falls back to a visible placeholder when the id is unknown', () => {
    const anon = exampleFiles('')
    expect(parseBundle(anon[0].raw)!.verifier_id).toBe('your-verifier-id')
  })

  it('prices in a stated currency rather than relying on the USD default', () => {
    const product = parseBundle(files[1].raw)!
    expect(product['x-price-one-time']).toBe(2500)
    expect(product['x-price-currency']).toBe('usd')
  })

  // Demonstrates the only way to keep a field off the card: declare it and leave
  // it out of ui:groups.
  it('shows how a field is deliberately hidden', () => {
    const schema = parseBundle(files[0].raw)!
    const props = (schema.data_schema as Record<string, unknown>).properties as Record<string, unknown>
    expect(props).toHaveProperty('reference_id')
    const groups = (schema.ui_schema as Record<string, unknown>)['ui:groups'] as { fields: string[] }[]
    expect(groups.flatMap(g => g.fields)).not.toContain('reference_id')
  })
})
