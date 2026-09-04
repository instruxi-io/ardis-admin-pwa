import { describe, it, expect } from 'vitest'
import { unroutedDestination } from './order-delivery'

// The panel used to assert that unrouted orders are swallowed by our test
// service, whatever the account default actually was. These are the two cases
// where that assertion was a lie to the vendor.
describe('unroutedDestination', () => {
  it('says nothing is delivered when no account default is set', () => {
    for (const empty of [undefined, '', '   ']) {
      expect(unroutedDestination(empty).fate).toContain('not delivered anywhere')
    }
  })

  it('names the test service only for the stand-in host', () => {
    expect(unroutedDestination('https://ardis-demo-fulfiller.fly.dev/orders').fate)
      .toContain("Instruxi's test service")
  })

  it('points at the account address when the default is the vendor own', () => {
    const d = unroutedDestination('https://pgfzcddej9.execute-api.us-east-2.amazonaws.com/prod/order')
    expect(d.fate).not.toContain('Instruxi')
    expect(d.fate).toContain('pgfzcddej9.execute-api.us-east-2.amazonaws.com')
  })

  it('still describes a default it cannot parse as a URL', () => {
    const d = unroutedDestination('not-a-url')
    expect(d.fate).toContain('your whole account')
    expect(d.fate).not.toContain('(')
  })
})
