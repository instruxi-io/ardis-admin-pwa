import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { parseBundle, kindOf } from './bundleFormat'
import { validateBundle } from './bundleValidation'

// The shipped example files, validated by the real code rather than by a fixture
// that agrees with it. If the extraction changed behaviour, or an example drifts
// from the rules, this fails.
// ardis-vp-tools is a sibling checkout, not a dependency, so the path is
// environment-specific. Overridable, and skipped rather than failed when absent:
// a fresh clone running `npm test` should not fail on a directory it never had.
const DIR = process.env.ARDIS_EXAMPLES ?? '../ardis-vp-tools/examples'

describe('the shipped example files', () => {
  const files = existsSync(DIR)
    ? readdirSync(DIR).filter((f: string) => f.endsWith('.json'))
    : []

  it.skipIf(files.length === 0)('are present to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const f of files) {
    it.skipIf(files.length === 0)(`${f} parses and passes every check`, () => {
      const b = parseBundle(readFileSync(`${DIR}/${f}`, 'utf8'))
      expect(b, 'should parse').not.toBeNull()

      // Each file must declare which half it is; nothing should read as legacy.
      const kind = kindOf(b!)
      expect(kind, 'x-publishes should be explicit').not.toBe('bundle')
      expect(f.includes('.credential.') ? 'credential-schema' : 'product').toBe(kind)

      const result = validateBundle(b!)
      const failures = result.checks.filter(c => !c.pass).map(c => c.label)
      expect(failures, `failing checks in ${f}`).toEqual([])
      expect(result.pass).toBe(true)
    })
  }
})
