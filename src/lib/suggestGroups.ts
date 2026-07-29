/**
 * Proposes `ui:groups` for an order form, so a vendor gets a multi-step wizard
 * without having to learn where the key goes.
 *
 * `ui:groups` is our extension, so the RJSF playground neither renders it nor
 * offers a way to author it. Documenting the syntax would put the work back on
 * the vendor and give them nothing to look at while they got it wrong; deriving
 * a starting point from their own schema gives them something to edit.
 *
 * The grouping is a heuristic and is meant to be edited. It follows the shape
 * the fields already have rather than guessing at meaning:
 *
 *   required scalars   the step that must be completed, so it comes first
 *   arrays             a step each, since a repeating list fills a screen alone
 *   enums              choices, which read as a set
 *   booleans           toggles, which read as a set
 *   terms              last, because an acknowledgement belongs after the thing
 *                      being acknowledged
 */

export interface UiGroup {
  title: string
  fields: string[]
}

const TERMS = /terms|acknowledg|consent|agree|confirm/i

type Kind = 'array' | 'enum' | 'boolean' | 'scalar'

function schemaType(spec: Record<string, unknown>): string | undefined {
  const raw = spec.type
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    const names = raw.filter((t): t is string => typeof t === 'string')
    return names.find(t => t === 'array' || t === 'object') ?? names[0]
  }
  return undefined
}

function kindOf(spec: Record<string, unknown>): Kind {
  if (Array.isArray(spec.enum)) return 'enum'
  const t = schemaType(spec)
  if (t === 'array') return 'array'
  if (t === 'boolean') return 'boolean'
  return 'scalar'
}

/**
 * Ordered field list: `ui:order` when the author gave one, otherwise the
 * schema's own key order, with anything omitted from ui:order appended so a
 * partial ui:order cannot silently drop fields from every step.
 */
function orderedFields(
  properties: Record<string, unknown>,
  uiSchema: Record<string, unknown>,
): string[] {
  const keys = Object.keys(properties)
  const declared = Array.isArray(uiSchema['ui:order'])
    ? (uiSchema['ui:order'] as unknown[]).filter(
        (f): f is string => typeof f === 'string' && f in properties,
      )
    : []
  return [...declared, ...keys.filter(k => !declared.includes(k))]
}

export function suggestGroups(
  schema: Record<string, unknown>,
  uiSchema: Record<string, unknown>,
): UiGroup[] {
  const properties = (schema.properties as Record<string, unknown>) ?? {}
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((f): f is string => typeof f === 'string')
    : []
  const fields = orderedFields(properties, uiSchema)
  if (fields.length === 0) return []

  // A short form is better as one page: paging through four fields adds taps
  // without reducing what is on screen. Split when there is enough to scroll
  // past, or when a repeating list is present — an array of objects fills a
  // phone screen on its own whatever else the form asks for.
  const hasArray = fields.some(
    f => kindOf((properties[f] as Record<string, unknown>) ?? {}) === 'array',
  )
  if (fields.length < 8 && !hasArray) return []

  const buckets: Record<string, string[]> = {
    required: [],
    enums: [],
    scalars: [],
    booleans: [],
    terms: [],
  }
  // Arrays get a step each, keyed by field so the title can use their own.
  const arrays: { field: string; title: string }[] = []

  for (const f of fields) {
    const spec = (properties[f] as Record<string, unknown>) ?? {}
    const kind = kindOf(spec)

    if (TERMS.test(f) && kind === 'boolean') {
      buckets.terms.push(f)
      continue
    }
    if (kind === 'array') {
      arrays.push({ field: f, title: (spec.title as string)?.trim() || f })
      continue
    }
    // A required field belongs in the step that has to be completed, whatever
    // its type — splitting it out would let someone reach the end with a
    // required box untouched two steps back.
    if (required.includes(f)) {
      buckets.required.push(f)
      continue
    }
    if (kind === 'enum') buckets.enums.push(f)
    else if (kind === 'boolean') buckets.booleans.push(f)
    else buckets.scalars.push(f)
  }

  const groups: UiGroup[] = []
  if (buckets.required.length) groups.push({ title: 'Required information', fields: buckets.required })
  for (const a of arrays) groups.push({ title: a.title, fields: [a.field] })
  if (buckets.enums.length) groups.push({ title: 'Options', fields: buckets.enums })
  if (buckets.scalars.length) groups.push({ title: 'Additional details', fields: buckets.scalars })
  if (buckets.booleans.length) groups.push({ title: 'Add-ons', fields: buckets.booleans })
  if (buckets.terms.length) groups.push({ title: 'Terms', fields: buckets.terms })

  // One group is not a wizard, and the app only switches at two. Returning a
  // single group would produce a step rail with one segment and no way forward.
  return groups.length >= 2 ? groups : []
}
