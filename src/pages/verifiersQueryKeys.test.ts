import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// React Query matches invalidation keys by prefix from element 0, so an
// invalidate whose first element names no registered query is silently a
// no-op: the write lands and the list keeps showing the old row. That is
// exactly what deactivate and activate did against the dead key 'verifiers'.
// ponytail: this reads the source text rather than rendering the page, which
// only catches keys written as literals here. Rendering needs jsdom and
// testing-library, neither of which this project has; add them and assert on a
// real refetch if the page ever grows keys built at runtime.
describe('VerifiersPage query keys', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./VerifiersPage.tsx', import.meta.url)),
    'utf8',
  )
  const heads = (text: string, re: RegExp) =>
    [...text.matchAll(re)].map(m => m[1])

  it('invalidates only keys the page registers', () => {
    const invalidateCall = /invalidateQueries\([^)]*\)/g
    const firstElement = /queryKey:\s*\[\s*'([^']+)'/g
    const registered = heads(src.replace(invalidateCall, ''), firstElement)
    const invalidated = heads(src, /invalidateQueries\(\{\s*queryKey:\s*\[\s*'([^']+)'/g)

    expect(registered).toContain('tenant-members-verifiers')
    expect(invalidated.length).toBeGreaterThan(0)
    for (const key of invalidated) {
      expect(registered, `invalidate '${key}' matches no query on this page`).toContain(key)
    }
  })
})
