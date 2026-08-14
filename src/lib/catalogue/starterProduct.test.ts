import { describe, expect, it } from 'vitest'
import { starterProductFile, humanise } from './starterProduct'
import { parseBundle, kindOf } from './bundleFormat'
import { validateBundle } from './bundleValidation'

describe('starterProductFile', () => {
  it('hands the vendor a product file that is already valid for their schema', () => {
    const file = starterProductFile('ardis', 'sanctions', 'Ardis Data')
    const bundle = parseBundle(file.raw)
    expect(bundle).not.toBeNull()
    expect(kindOf(bundle!)).toBe('product')
    expect(bundle!.verifier_id).toBe('ardis')
    expect(bundle!.credential_type).toBe('sanctions')
    expect(bundle!.verifier_name).toBe('Ardis Data')
    const result = validateBundle(bundle!)
    expect(result.checks.filter(c => !c.pass)).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('publishes as free until the vendor sets a price', () => {
    const bundle = parseBundle(starterProductFile('ardis', 'compliance').raw)!
    expect(bundle['x-pricing']).toBeUndefined()
    // parseBundle normalises a missing one-time price to 0, which is "free".
    expect((bundle['x-price-one-time'] as number) || 0).toBe(0)
  })

  it('humanises slugs for the product title', () => {
    expect(humanise('provider-background-check')).toBe('Provider Background Check')
    expect(humanise('sanctions')).toBe('Sanctions')
  })
})
