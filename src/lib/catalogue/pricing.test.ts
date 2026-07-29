import { describe, expect, it } from 'vitest'
import { money } from './pricing'

describe('money', () => {
  // Every amount used to format with a hardcoded "$", so a gbp tier read as
  // "$29/month" and a flat price that declared x-price-currency was simply
  // misreported on the one step whose job is saying what it charges.
  it('formats in the currency it will charge in', () => {
    expect(money(4500, 'usd')).toMatch(/45\.00/)
    expect(money(4500, 'usd')).toMatch(/\$/)
    expect(money(4500, 'gbp')).toMatch(/45\.00/)
    expect(money(4500, 'gbp')).not.toMatch(/\$/)
    expect(money(2900, 'eur')).toMatch(/29\.00/)
    expect(money(2900, 'eur')).not.toMatch(/\$/)
  })

  it('accepts either case, since Stripe stores lowercase', () => {
    expect(money(1000, 'GBP')).toEqual(money(1000, 'gbp'))
  })

  it('defaults to USD, matching every product published before the field existed', () => {
    expect(money(4500)).toEqual(money(4500, 'usd'))
    expect(money(4500, '')).toEqual(money(4500, 'usd'))
  })

  it('labels an interval, or says one-time', () => {
    expect(money(2900, 'usd', 'month')).toMatch(/\/month$/)
    expect(money(4500, 'usd')).toMatch(/one-time$/)
  })

  it('converts from the smallest unit', () => {
    expect(money(1, 'usd')).toMatch(/0\.01/)
    expect(money(100, 'usd')).toMatch(/1\.00/)
    expect(money(123456, 'usd')).toMatch(/1,?234\.56/)
  })

  // An unrecognised code must still show the number. Throwing away the amount
  // would hide the only fact the vendor came to this step for.
  it('still shows the amount for an unknown currency code', () => {
    const out = money(4500, 'zzz')
    expect(out).toContain('45.00')
    expect(out).toContain('ZZZ')
  })

  it('handles zero without pretending it is missing', () => {
    expect(money(0, 'usd')).toMatch(/0\.00/)
  })
})
