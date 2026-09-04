import { describe, it, expect } from 'vitest'
import { loginDestination } from './LoginPage'

// ProtectedRoute sends anything that is neither developer nor tenant admin back
// to /login. If this ever hands one of those accounts a route again, the two
// redirects loop and the user can never reach the Sign out button.
describe('loginDestination', () => {
  it.each([
    ['admin', false, true, '/tenants'],
    ['tenant_admin', false, true, '/schemas'],
    ['developer', true, false, '/schemas'],
  ] as const)('%s -> %s', (role, isDeveloper, isTenantAdmin, expected) => {
    expect(loginDestination(role, isDeveloper, isTenantAdmin)).toBe(expected)
  })

  it.each([['viewer'], ['holder'], [null]] as const)('%s has nowhere to go', (role) => {
    expect(loginDestination(role, false, false)).toBeNull()
  })
})
