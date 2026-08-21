import { describe, it, expect } from 'vitest'
import { pinAuthoredOrder } from './uiOrderInjection'

// The server alphabetises properties at every depth when it re-marshals a
// file, so the author's order survives only where a ui:order pins it. The
// original pin covered the root alone; the vendor reordered his fields,
// republished, and everything inside his nested objects still came back
// alphabetical. These tests hold the pin to every level.
//
// Every emitted order ends in '*': RJSF stubs undeclared payload keys into
// properties wherever a schema level carries additionalProperties, then
// throws if the order list has no place for them. The phone renderers filter
// '*' out, so it costs nothing there.

const licenceShaped = {
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          provider_info: {
            type: 'object',
            properties: {
              first_name: {}, middle_name: {}, last_name: {}, dob: {},
            },
          },
          license_info: {
            type: 'object',
            properties: { license_type: {}, license_number: {}, jurisdiction: {} },
          },
        },
      },
    },
    reference_id: { type: 'string' },
  },
}

describe('pinAuthoredOrder', () => {
  it('pins the authored order at the root', () => {
    const out = pinAuthoredOrder({ properties: { zeta: {}, alpha: {}, mid: {} } }, {})
    expect(out['ui:order']).toEqual(['zeta', 'alpha', 'mid', '*'])
  })

  it('pins inside array items and inside each nested object', () => {
    const out = pinAuthoredOrder(licenceShaped, {}) as any
    expect(out['ui:order']).toEqual(['records', 'reference_id', '*'])
    expect(out.records.items['ui:order']).toEqual(['provider_info', 'license_info', '*'])
    expect(out.records.items.provider_info['ui:order'])
      .toEqual(['first_name', 'middle_name', 'last_name', 'dob', '*'])
    expect(out.records.items.license_info['ui:order'])
      .toEqual(['license_type', 'license_number', 'jurisdiction', '*'])
  })

  it('never replaces an order the author chose, at any level', () => {
    const ui = {
      'ui:order': ['reference_id', 'records'],
      records: { items: { provider_info: { 'ui:order': ['dob', 'first_name', 'middle_name', 'last_name'] } } },
    }
    const out = pinAuthoredOrder(licenceShaped, ui) as any
    expect(out['ui:order']).toEqual(['reference_id', 'records', '*'])
    expect(out.records.items.provider_info['ui:order'])
      .toEqual(['dob', 'first_name', 'middle_name', 'last_name', '*'])
    // Levels the author left alone still get pinned.
    expect(out.records.items['ui:order']).toEqual(['provider_info', 'license_info', '*'])
  })

  it('drops stale names and appends missing ones — the real published file', () => {
    // The live product's items ui:order names record_id and miscellaneous,
    // fields its schema no longer has. RJSF throws on those; the pin must
    // heal the list rather than republish the crash.
    const ui = {
      records: {
        items: {
          'ui:order': ['record_id', 'provider_info', 'license_info', 'miscellaneous'],
        },
      },
    }
    const out = pinAuthoredOrder(licenceShaped, ui) as any
    expect(out.records.items['ui:order']).toEqual(['provider_info', 'license_info', '*'])
  })

  it('appends properties a hand-written order forgot', () => {
    const out = pinAuthoredOrder(
      { properties: { a: {}, b: {}, c: {} } },
      { 'ui:order': ['c'] },
    )
    expect(out['ui:order']).toEqual(['c', 'a', 'b', '*'])
  })

  it("keeps an author's '*' where they put it and does not append behind it", () => {
    const out = pinAuthoredOrder(
      { properties: { a: {}, b: {}, c: {} } },
      { 'ui:order': ['c', 'gone', '*'] },
    )
    expect(out['ui:order']).toEqual(['c', '*'])
  })

  it('drops duplicate names an author typed twice', () => {
    // Duplicates render the field twice on the phone and hand RJSF duplicate
    // React keys.
    const out = pinAuthoredOrder(
      { properties: { name: {}, email: {} } },
      { 'ui:order': ['name', 'name', 'email'] },
    )
    expect(out['ui:order']).toEqual(['name', 'email', '*'])
  })

  it("every emitted order ends in '*', hand-written or injected", () => {
    const out = pinAuthoredOrder(licenceShaped, {
      records: { items: { provider_info: { 'ui:order': ['dob', 'first_name', 'middle_name', 'last_name'] } } },
    }) as any
    for (const order of [
      out['ui:order'],
      out.records.items['ui:order'],
      out.records.items.provider_info['ui:order'],
      out.records.items.license_info['ui:order'],
    ]) expect(order[order.length - 1]).toBe('*')
  })

  it('keeps unrelated ui keys intact at every level', () => {
    const ui = {
      'ui:widget': 'textarea',
      records: { items: { provider_info: { 'ui:help': 'as licensed' } } },
    }
    const out = pinAuthoredOrder(licenceShaped, ui) as any
    expect(out['ui:widget']).toBe('textarea')
    expect(out.records.items.provider_info['ui:help']).toBe('as licensed')
    expect(out.records.items.provider_info['ui:order']).toBeDefined()
  })

  it('leaves an empty or non-object schema alone', () => {
    expect(pinAuthoredOrder({}, {})['ui:order']).toBeUndefined()
    expect(pinAuthoredOrder(null, { 'ui:help': 'x' })).toEqual({ 'ui:help': 'x' })
    expect(pinAuthoredOrder({ properties: {} }, {})['ui:order']).toBeUndefined()
  })

  it('pins an object nested directly inside another object', () => {
    const out = pinAuthoredOrder(
      { properties: { outer: { type: 'object', properties: { inner: { type: 'object', properties: { z: {}, a: {} } } } } } },
      {},
    ) as any
    expect(out.outer.inner['ui:order']).toEqual(['z', 'a', '*'])
  })
})
