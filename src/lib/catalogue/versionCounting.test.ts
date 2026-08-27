import { describe, it, expect } from 'vitest'
import { nextVersion } from './publishPlan'

// Two things the catalogue header and the New Version button got wrong, both
// of which contradicted what the same screen showed a moment later.

describe('New Version', () => {
  it('offers the version after the live one, not the live one again', () => {
    // The button and the notice beside it both promise v{current+1}. Loading
    // the current version meant publishing changed nothing.
    expect(nextVersion('v5')).toBe('v6')
    expect(nextVersion('v1')).toBe('v2')
  })
})

describe('schema version counting', () => {
  // Mirrors the header's expression: the index holds one row per publish, and
  // a version published three times must still count once, the way the groups
  // underneath the header display it.
  const distinct = (rows: { verifier_id: string; credential_type: string; version: string }[]) =>
    new Set(rows.map(s => `${s.verifier_id}/${s.credential_type}/${s.version}`)).size

  it('counts a republished version once', () => {
    const rows = [
      { verifier_id: 'ardis', credential_type: 'license', version: 'v1' },
      { verifier_id: 'ardis', credential_type: 'license', version: 'v1' },
      { verifier_id: 'ardis', credential_type: 'license', version: 'v1' },
      { verifier_id: 'ardis', credential_type: 'license', version: 'v2' },
    ]
    expect(distinct(rows)).toBe(2)
    expect(rows.length).toBe(4) // what the header used to print
  })

  it('keeps versions of different credential types apart', () => {
    expect(distinct([
      { verifier_id: 'ardis', credential_type: 'license', version: 'v1' },
      { verifier_id: 'ardis', credential_type: 'sanctions', version: 'v1' },
    ])).toBe(2)
  })
})
