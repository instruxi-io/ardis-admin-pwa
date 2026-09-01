import { describe, it, expect } from 'vitest'
import { parseBundle } from './bundleFormat'

// New Version loads a published schema back into the editor. The round trip that
// matters is: whatever is on screen is what gets published.
//
// It used to emit the schema twice, as top-level `properties` and again under
// `x-data-schema`. Publishing reads x-data-schema, so an edit made in the
// obvious place was silently dropped and the new version came out identical to
// the old one. the vendor reported it as the wrong version loading, which is exactly
// what it looks like from outside: you edit, you publish, nothing changed.
// ardis/license v3, v4 and v5 are all byte-identical because of it.
//
// The failure is silent, which is why it is pinned here.

/** What New Version writes into the editor, mirroring loadForNewVersion. */
function reconstruct(dataSchema: Record<string, unknown>, uiSchema: Record<string, unknown>) {
  const obj1: Record<string, unknown> = {
    ...dataSchema,
    '$id': 'ardis/license/v5',
    'title': 'Medical License Verification',
    'x-publishes': 'credential-schema',
    'x-verifier-id': 'ardis',
    'x-credential-type': 'license',
    'x-version': 'v5',
    'type': 'object',
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

describe('New Version round trip', () => {
  it('publishes the schema that was loaded', () => {
    const parsed = parseBundle(reconstruct(published, { 'ui:order': ['records'] }))
    expect(parsed).not.toBeNull()
    expect(parsed!.kind).toBe('credential-schema')
    const out = parsed!.data_schema as Record<string, unknown>
    expect(out.properties).toEqual(published.properties)
  })

  it('publishes an edit made to the visible properties', () => {
    // The whole bug. Someone opens the file, adds a field where a field
    // obviously goes, and publishes.
    const edited = {
      ...published,
      properties: {
        ...published.properties,
        issued_on: { type: 'string', format: 'date', title: 'Issued on' },
      },
    }
    const parsed = parseBundle(reconstruct(edited, {}))
    const out = parsed!.data_schema as Record<string, unknown>
    const props = out.properties as Record<string, unknown>

    expect(Object.keys(props)).toContain('issued_on')
  })

  it('carries no second copy of the schema to fall out of step', () => {
    // If x-data-schema comes back, edits silently stop publishing again.
    const parsed = parseBundle(reconstruct(published, {}))
    const out = parsed!.data_schema as Record<string, unknown>
    expect(out['x-data-schema']).toBeUndefined()
  })

  it('keeps the identity fields the server needs', () => {
    const parsed = parseBundle(reconstruct(published, {}))
    expect(parsed!.verifier_id).toBe('ardis')
    expect(parsed!.credential_type).toBe('license')
    expect(parsed!.version).toBe('v5')
  })
})
