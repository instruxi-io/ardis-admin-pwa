import { describe, it, expect } from 'vitest'
import { routeKey } from './ardisMsClient'

// The server turns a credential type into a metadata key the same way. If these
// two rules drift, a hyphenated type like "portable-verification" shows as
// unrouted in the portal while its orders are in fact being routed, or the
// portal writes a key the order dispatcher never reads. Both are silent.
describe('routeKey matches the server normaliser', () => {
  it.each([
    ['license', 'license'],
    ['sanctions', 'sanctions'],
    ['portable-verification', 'portable_verification'],
    ['Portable Verification', 'portable_verification'],
    ['  license  ', 'license'],
    ['example.check', 'example_check'],
  ])('%s -> %s', (input, expected) => {
    expect(routeKey(input)).toBe(expected)
  })
})
