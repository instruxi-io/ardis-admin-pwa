import { describe, it, expect } from 'vitest'
import { failedBeforeSending } from './vendor-orders'

// The panel used to tell a vendor "your endpoint turned it away" for failures
// that never reached their endpoint, sending them into their own logs after a
// misconfiguration on our side. These are the cases that told them apart.
describe('failedBeforeSending', () => {
  it('is true when a failure recorded no attempt', () => {
    expect(failedBeforeSending({ state: 'failed', attempts: 0, last_error: 'vendor has no order_url configured' }))
      .toBe(true)
  })

  it('is false once the order was actually posted to them', () => {
    expect(failedBeforeSending({ state: 'failed', attempts: 3, last_error: 'HTTP 400 bad product' }))
      .toBe(false)
  })

  it('is false for deliveries that have not failed', () => {
    expect(failedBeforeSending({ state: 'pending', attempts: 0, last_error: '' })).toBe(false)
    expect(failedBeforeSending({ state: 'delivered', attempts: 1, last_error: '' })).toBe(false)
    expect(failedBeforeSending(undefined)).toBe(false)
  })
})
