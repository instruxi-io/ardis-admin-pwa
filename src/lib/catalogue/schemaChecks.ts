/**
 * Checks that need a real JSON Schema engine, rather than key comparisons.
 *
 * The portal previously confirmed only that a schema had `type: "object"` and a
 * `properties` map, and that the sample's keys were a subset of those
 * properties. So `"type": "objekt"` on a nested field passed, a malformed
 * `items` passed, and a sample with a number where a date string was declared
 * passed here and then failed in the RJSF preview — backwards, since the checks
 * exist to catch it before the preview does.
 *
 * Uses the AJV instance exposed by @rjsf/validator-ajv8, which is the same
 * engine the preview validates with. Importing `ajv` directly would resolve to
 * the hoisted v6 that eslint pulls in, which is a different major with a
 * different API.
 */

import validator from '@rjsf/validator-ajv8'

/** Constructs the Flutter renderer does not implement, so the preview over-promises. */
const UNSUPPORTED = ['oneOf', 'anyOf', 'allOf', 'not', '$ref', 'if', 'then', 'else'] as const

export interface SchemaCheckResult {
  /** The schema itself compiles as a JSON Schema. */
  schemaValid: boolean
  schemaError?: string
  /** The sample data validates against it. Undefined when the schema is invalid. */
  sampleValid?: boolean
  sampleError?: string
  /** `required` entries that name no property. */
  missingRequired: string[]
  /** Paths using keywords the app cannot render. */
  unsupported: string[]
}

/** Recursively finds unsupported keywords, and objects nested inside a form. */
function findUnsupported(
  node: unknown,
  path: string,
  opts: { flagNestedObjects: boolean },
  out: string[],
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return
  const obj = node as Record<string, unknown>

  for (const key of UNSUPPORTED) {
    if (key in obj) out.push(`${path || 'root'}: ${key}`)
  }

  const props = obj.properties as Record<string, unknown> | undefined
  if (props && typeof props === 'object') {
    for (const [name, spec] of Object.entries(props)) {
      const here = path ? `${path}.${name}` : name
      const s = spec as Record<string, unknown> | undefined
      // A nested object renders as a single text box on the phone: the order
      // form branches on enum, boolean, array, date, then falls through to text.
      if (opts.flagNestedObjects && s && s.type === 'object') {
        out.push(`${here}: nested object`)
      }
      findUnsupported(spec, here, opts, out)
    }
  }

  const items = obj.items
  if (items && typeof items === 'object') {
    // Array items are rendered as rows of sub-fields, so an object here is fine.
    findUnsupported(items, `${path}[]`, { ...opts, flagNestedObjects: false }, out)
  }
}

/** Strips empty strings, recursively: in form data they mean "not filled in". */
function withoutEmpties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEmpties)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() === '') continue
      out[k] = withoutEmpties(v)
    }
    return out
  }
  return value
}

export function checkSchema(
  schema: Record<string, unknown>,
  sample: Record<string, unknown> | undefined,
  opts: { flagNestedObjects: boolean },
): SchemaCheckResult {
  const missingRequired = (Array.isArray(schema.required) ? schema.required : [])
    .filter((r): r is string => typeof r === 'string')
    .filter(r => !(r in ((schema.properties as Record<string, unknown>) ?? {})))

  const unsupported: string[] = []
  findUnsupported(schema, '', opts, unsupported)

  let compiled: (((data: unknown) => boolean) & { errors?: unknown[] | null }) | null = null
  let schemaValid = true
  let schemaError: string | undefined
  try {
    // Compiled without $id. AJV caches by $id in the instance, and this is the
    // same instance the preview validates with, so compiling a schema that
    // declares one registers it — and the next compile fails with "schema with
    // key or id already exists", which is what a vendor saw in place of a result.
    // Nothing here resolves references, so the id is not needed.
    const { $id: _ignored, ...standalone } = schema
    compiled = validator.ajv.compile(standalone) as unknown as (data: unknown) => boolean
  } catch (err) {
    schemaValid = false
    // AJV's message names the offending path, which is the useful part.
    schemaError = err instanceof Error ? err.message : String(err)
  }

  const result: SchemaCheckResult = { schemaValid, schemaError, missingRequired, unsupported }
  // An empty object means no sample was supplied, which is how the RJSF
  // playground's form-data pane starts and is not something to punish. A sample
  // that is present but incomplete is a different matter and is checked.
  if (!schemaValid || !compiled || !sample || Object.keys(sample).length === 0) {
    return result
  }

  // An empty string in form data means "not filled in", which is how both
  // renderers treat it — RJSF strips empties and the Flutter form removes the key
  // outright. Validating them would fail every optional date or email field for
  // being blank, which is a sample of an unfilled form, not a broken one.
  result.sampleValid = compiled(withoutEmpties(sample))
  if (!result.sampleValid) {
    // Errors attach to the compiled function, not the Ajv instance. Reading
    // validator.ajv.errors gives null, so every message came out blank.
    const errs = (compiled.errors ?? []) as { instancePath?: string; message?: string }[]
    result.sampleError = errs
      .slice(0, 3)
      .map(e => `${e.instancePath || 'root'} ${e.message}`)
      .join('; ')
  }
  return result
}
