import { describe, it, expect } from 'vitest'
import { parseBundle } from './bundleFormat'

// The Download button hands out a file the vendor is expected to re-import. It
// declared no x-publishes, so it came back as a legacy combined bundle: that
// path publishes the product too, with the credential display schema as the
// order form, no pricing, and a sku that slugs down onto the live product. The
// server then archives every price as no longer in the bundle.
//
// With x-publishes: credential-schema the re-import can only ever reach the
// immutable-version check. Nothing about the failure is visible from the PWA,
// which is why it is pinned here.

/** What Download writes to disk, mirroring downloadPublishedBundle. */
function reconstruct(dataSchema: Record<string, unknown>, uiSchema: Record<string, unknown> = {}) {
  const obj1 = {
    '$id': 'ardis/license/v5',
    'title': 'Medical License Verification',
    'x-verifier-id': 'ardis',
    'x-credential-type': 'license',
    'x-version': 'v5',
    'type': 'object',
    'properties': {},
    ...dataSchema,
    'x-publishes': 'credential-schema',
  }
  return [obj1, uiSchema, {}].map(o => JSON.stringify(o, null, 2)).join('\n')
}

const published = {
  type: 'object',
  properties: {
    records: { type: 'array', title: 'Records' },
    reference_id: { type: 'string', title: 'Reference' },
  },
}

describe('Download round trip', () => {
  it('re-imports as a credential schema, never as a product-touching bundle', () => {
    const parsed = parseBundle(reconstruct(published))
    expect(parsed).not.toBeNull()
    expect(parsed!.kind).toBe('credential-schema')
  })

  it('holds the declaration against a stored schema that carries its own', () => {
    // A schema published from a legacy combined file has x-publishes stored in
    // it. Spread last, that value would decide the re-import.
    const parsed = parseBundle(reconstruct({ ...published, 'x-publishes': 'product' }))
    expect(parsed!.kind).toBe('credential-schema')
  })

  it('keeps the identity fields the server needs', () => {
    const parsed = parseBundle(reconstruct(published))
    expect(parsed!.verifier_id).toBe('ardis')
    expect(parsed!.credential_type).toBe('license')
    expect(parsed!.version).toBe('v5')
  })
})
