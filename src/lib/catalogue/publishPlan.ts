/**
 * What is queued for publishing, in what order, and how a re-publish compares
 * with what is already live.
 */

import type { BundleKind, ViewModelBundle } from './bundleFormat'

export interface DroppedFile {
  id: string
  name: string
  raw: string
  edited: string | null
}

export interface PublishStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
}

// Credential schemas must land before the products that name them: the server
// refuses a product whose credential type has no published schema. Sorting here
// rather than asking the operator to drop them in order is the entire point.
export const PUBLISH_ORDER: Record<BundleKind, number> = {
  'credential-schema': 0,
  bundle: 1,
  product: 2,
}

// A 409 from the credential-schema endpoint means that version is already
// published. Immutability is deliberate, so this is a normal outcome when only
// the product changed, not a failure.
export function isConflict(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 409
}

// Structural comparison of two published schemas. Key order is irrelevant, so
// JSON.stringify would report false differences on an unchanged schema and send
// the user off to bump a version for no reason.
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a !== 'object') return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every(k =>
    Object.prototype.hasOwnProperty.call(b as object, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

// "v1" -> "v2", so the error message can name the version to bump to.
export function nextVersion(v: string): string {
  const m = /^v(\d+)$/.exec(v)
  return m ? `v${Number(m[1]) + 1}` : 'v2'
}

// Mirrors ardis-ms slugify(): the server derives a sku from the product name when
// the bundle omits x-sku. Reproduced here so the product index finds an existing
// product whether or not its bundle declared one.
export function skuFor(bundle: ViewModelBundle): string {
  const explicit = (bundle.sku as string)?.trim()
  if (explicit) return explicit
  return ((bundle.name as string) ?? '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
