/**
 * The server re-marshals every schema through a Go map, which alphabetises
 * properties at EVERY depth. Lists survive, so ui:order is the only thing that
 * preserves an author's field order once a file round-trips. Pinning only the
 * root (the first version of this fix) let everything inside a nested object
 * come back alphabetical, which is exactly what the vendor saw after
 * republishing: top-level order held, the fields inside provider_info did not.
 *
 * pinAuthoredOrder walks the schema and returns a ui schema with ui:order at
 * every object level: the root, each nested object, and the item schema of
 * every array of objects (RJSF nests those under ui[key].items). Where the
 * author set a ui:order it is kept, not replaced.
 *
 * It also sanitises hand-written orders. RJSF throws on a ui:order naming a
 * field the schema no longer has (the phone's own renderer just skips it), and
 * the app's credential card renders through RJSF in a webview, so one stale
 * name in a published ui:order would take the card down. Names not in the
 * schema are dropped; properties missing from the list are appended in
 * authored order, unless the author used the '*' wildcard, which already
 * means "everything else here".
 */

type Dict = Record<string, unknown>

const isDict = (v: unknown): v is Dict =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function sanitizeOrder(order: unknown[], propKeys: string[]): string[] {
  const known = new Set(propKeys)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const k of order) {
    // Duplicates render the field twice on the phone and give RJSF duplicate
    // React keys, so only the first occurrence of a name survives.
    if ((k === '*' || (typeof k === 'string' && known.has(k))) && !seen.has(k as string)) {
      seen.add(k as string)
      kept.push(k as string)
    }
  }
  if (kept.includes('*')) return kept
  return [...kept, ...propKeys.filter(k => !seen.has(k)), '*']
}

export function pinAuthoredOrder(schema: unknown, ui: unknown): Dict {
  const out: Dict = isDict(ui) ? { ...ui } : {}
  if (!isDict(schema) || !isDict(schema.properties)) return out
  const props = schema.properties
  const keys = Object.keys(props)
  if (keys.length === 0) return out

  // Every order ends in '*'. RJSF stubs undeclared payload keys into
  // properties wherever a schema level carries additionalProperties, and
  // orderProperties THROWS if the order list has no place for them — one
  // extra key in a credential payload would blank the whole card. The phone
  // renderers filter '*' out, so it costs nothing there.
  out['ui:order'] = Array.isArray(out['ui:order'])
    ? sanitizeOrder(out['ui:order'], keys)
    : [...keys, '*']

  for (const key of keys) {
    const field = props[key]
    if (!isDict(field)) continue
    if (isDict(field.properties)) {
      out[key] = pinAuthoredOrder(field, out[key])
    } else if (isDict(field.items) && isDict(field.items.properties)) {
      const fieldUi: Dict = isDict(out[key]) ? { ...out[key] } : {}
      fieldUi.items = pinAuthoredOrder(field.items, fieldUi.items)
      out[key] = fieldUi
    }
  }
  return out
}
