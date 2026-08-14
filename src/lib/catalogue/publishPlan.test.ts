import { describe, expect, it } from 'vitest'
import { PUBLISH_ORDER, compareVersionsDesc, deepEqual, isConflict, nextVersion, skuFor } from './publishPlan'

describe('PUBLISH_ORDER', () => {
  // The server refuses a product whose credential type has no published schema,
  // so a batch must send schemas first. Sorting here is what lets a vendor drop
  // both files in whatever order they grabbed them.
  it('puts credential schemas ahead of the products that name them', () => {
    expect(PUBLISH_ORDER['credential-schema']).toBeLessThan(PUBLISH_ORDER.product)
    expect(PUBLISH_ORDER['credential-schema']).toBeLessThan(PUBLISH_ORDER.bundle)
  })

  it('sorts a mixed batch correctly', () => {
    const dropped = ['product', 'credential-schema', 'product', 'bundle'] as const
    const sorted = [...dropped].sort((a, b) => PUBLISH_ORDER[a] - PUBLISH_ORDER[b])
    expect(sorted[0]).toBe('credential-schema')
    expect(sorted.at(-1)).toBe('product')
  })
})

describe('skuFor', () => {
  it('prefers an explicit sku', () => {
    expect(skuFor({ sku: 'license-verification', name: 'Anything Else' })).toBe('license-verification')
  })

  // Mirrors ardis-ms slugify(): the server derives a sku from the name when the
  // file omits one, and the portal must reach the same answer or it looks up the
  // wrong product and hands its Stripe id to a different one.
  it('falls back to a slug of the name, as the server does', () => {
    expect(skuFor({ name: 'Medical Licence Verification' })).toBe('medical-licence-verification')
    expect(skuFor({ name: 'Sanctions & Discipline Check' })).toBe('sanctions-discipline-check')
    expect(skuFor({ name: '  Padded  Name  ' })).toBe('padded-name')
  })

  it('trims punctuation from the ends rather than leaving hyphens', () => {
    expect(skuFor({ name: '!!Weird!!' })).toBe('weird')
    expect(skuFor({ name: '---' })).toBe('')
  })

  it('ignores a blank sku instead of returning it', () => {
    expect(skuFor({ sku: '   ', name: 'Fallback Name' })).toBe('fallback-name')
  })
})

describe('nextVersion', () => {
  it('increments, so the error can name the version to bump to', () => {
    expect(nextVersion('v1')).toBe('v2')
    expect(nextVersion('v2')).toBe('v3')
    expect(nextVersion('v9')).toBe('v10')
    expect(nextVersion('v10')).toBe('v11')
  })

  it('suggests v2 for anything it cannot parse', () => {
    expect(nextVersion('latest')).toBe('v2')
    expect(nextVersion('')).toBe('v2')
    expect(nextVersion('1.0')).toBe('v2')
  })
})

describe('compareVersionsDesc', () => {
  it('sorts numerically, so v10 outranks v9 as the live version', () => {
    expect(['v9', 'v10', 'v1'].sort(compareVersionsDesc)).toEqual(['v10', 'v9', 'v1'])
  })

  it('falls back to reverse lexical for unparseable versions', () => {
    expect(['alpha', 'beta'].sort(compareVersionsDesc)).toEqual(['beta', 'alpha'])
  })
})

describe('deepEqual', () => {
  // Used to decide whether a 409 is benign. JSON.stringify would report false
  // differences on key order and send someone off to bump a version for nothing.
  it('ignores key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } })).toBe(true)
  })

  it('respects array order, which is meaningful in ui:order', () => {
    expect(deepEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(deepEqual(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('detects a real difference at any depth', () => {
    expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })

  it('does not confuse null, undefined and absent', () => {
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual({ a: null }, {})).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
  })

  it('does not treat an array as an object with numeric keys', () => {
    expect(deepEqual(['a'], { 0: 'a' })).toBe(false)
  })

  it('distinguishes types that stringify alike', () => {
    expect(deepEqual(1, '1')).toBe(false)
    expect(deepEqual(true, 1)).toBe(false)
  })
})

describe('isConflict', () => {
  // A 409 means the version already exists, which is normal when only the
  // product changed. Anything else must not be swallowed as benign.
  it('recognises a 409 and nothing else', () => {
    expect(isConflict({ response: { status: 409 } })).toBe(true)
    expect(isConflict({ response: { status: 403 } })).toBe(false)
    expect(isConflict({ response: { status: 500 } })).toBe(false)
  })

  it('is safe on errors with no response at all', () => {
    expect(isConflict(new Error('network down'))).toBe(false)
    expect(isConflict(undefined)).toBe(false)
    expect(isConflict(null)).toBe(false)
    expect(isConflict({})).toBe(false)
  })
})
