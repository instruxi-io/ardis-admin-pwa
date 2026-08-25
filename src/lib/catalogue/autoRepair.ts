/**
 * Repairs a dropped file on intake, before validation ever sees it.
 *
 * Vendors copy an existing file and edit it, so the same three mistakes keep
 * arriving: the credential schema left embedded in a product file (which the
 * product publish silently drops), a copied x-sku still naming the product it
 * was copied from (which would overwrite it), and pricing options written as
 * labels with no value for checkout to match. Each has exactly one correct
 * interpretation, so instead of bouncing the file back with an error — or a
 * human mailing corrected JSON around — the portal rewrites it and says what
 * it changed. The vendor sees the repaired text in the editor, which is also
 * how they learn the shape.
 *
 * Anything without a single correct interpretation is deliberately NOT
 * repaired here; it falls through to validation and gets an error message.
 */

import { parseMultipleJsonObjects } from './bundleFormat'

type Dict = Record<string, unknown>

export interface RepairedFile {
  name: string
  raw: string
  notes: string[]
}

export interface ExistingProduct {
  verifier_id?: string
  sku?: string
  name?: string
  credential_type?: string
}

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const stringify = (objs: unknown[]) =>
  objs.map(o => JSON.stringify(o, null, 2)).join('\n') + '\n'

export function autoRepair(
  name: string,
  raw: string,
  existingProducts: ExistingProduct[],
): RepairedFile[] {
  let objects: Dict[]
  try {
    objects = parseMultipleJsonObjects(raw) as Dict[]
  } catch {
    return [{ name, raw, notes: [] }]
  }
  // Only the three-object format is understood well enough to rewrite. A
  // legacy combined bundle (no x-publishes) embeds its schema on purpose.
  if (objects.length !== 3) return [{ name, raw, notes: [] }]
  const [schema, ui, data] = objects
  if ((schema['x-publishes'] as string)?.trim() !== 'product') {
    return [{ name, raw, notes: [] }]
  }

  const out: RepairedFile[] = []
  const notes: string[] = []
  const product: Dict = { ...schema }
  let productUi: Dict = { ...ui }

  // ── 1. An embedded credential schema becomes its own file ──────────────────
  if (product['x-data-schema'] && typeof product['x-data-schema'] === 'object') {
    const cred: Dict = { ...(product['x-data-schema'] as Dict) }
    const credUi: Dict = (product['x-data-ui-schema'] as Dict) ?? {}
    delete product['x-data-schema']
    delete product['x-data-ui-schema']

    cred['x-publishes'] = 'credential-schema'
    if (!cred['x-verifier-id']) cred['x-verifier-id'] = product['x-verifier-id']
    if (!cred['x-credential-type']) cred['x-credential-type'] = product['x-credential-type']
    // The version is the schema's identity; $id is a mirror of it. When the
    // two disagree the version wins, because that is the one the publish uses.
    const v = (cred['x-version'] as string)?.trim()
    if (v && cred['x-verifier-id'] && cred['x-credential-type']) {
      const id = `${cred['x-verifier-id']}/${cred['x-credential-type']}/${v}`
      if (cred['$id'] !== id) {
        if (cred['$id']) notes.push(`Matched the credential schema $id to its x-version (${v}).`)
        cred['$id'] = id
      }
    }
    const base = name.replace(/\.json$/i, '').replace(/\.product$/i, '')
    out.push({
      name: `${base}.credential-schema.json`,
      raw: stringify([cred, credUi, {}]),
      notes: ['Split out of the product file: a product publish does not carry a credential schema, so embedded it would have been dropped.'],
    })
    notes.push('Moved the embedded credential schema into its own file, queued to publish first.')
  }

  // ── 2. A sku copied from a different product gets its own ──────────────────
  const sku = (product['x-sku'] as string)?.trim()
  const verifier = (product['x-verifier-id'] as string)?.trim()
  const credType = (product['x-credential-type'] as string)?.trim()
  if (sku && verifier && credType) {
    const owner = existingProducts.find(
      p => p.verifier_id === verifier && (p.sku ?? '').trim() === sku &&
           p.credential_type && p.credential_type !== credType)
    if (owner) {
      const own = slug((product['title'] as string) ?? '')
      if (own && own !== sku) {
        product['x-sku'] = own
        notes.push(`Changed x-sku from "${sku}" (it belongs to "${owner.name}") to "${own}", so publishing cannot overwrite that product.`)
      }
    }
  }

  // ── 3. Pricing labels become values the order form can match ───────────────
  const xp = product['x-pricing'] as Dict | undefined
  const rawOptions = Array.isArray(xp?.options) ? (xp!.options as Dict[]) : []
  if (xp && rawOptions.length > 0) {
    const missingValue = rawOptions.some(
      o => typeof o.value !== 'string' || (o.value as string).trim() === '')
    const props = (product.properties as Dict) ?? {}
    const fieldName = (xp.field as string)?.trim()
    const fieldSchema = fieldName ? (props[fieldName] as Dict | undefined) : undefined
    const fieldEnum = Array.isArray(fieldSchema?.enum)
      ? (fieldSchema!.enum as unknown[]).map(v => `${v}`)
      : null

    if (missingValue) {
      const values = rawOptions.map((o, i) => {
        const label = (o.label ?? o.title ?? o.name) as string | undefined
        const value = typeof o.value === 'string' && o.value.trim() !== ''
          ? o.value as string
          : slug(label ?? (o.interval as string) ?? `option-${i + 1}`)
        return { ...o, value, ...(label && !o.label ? { label } : {}) }
      })
      xp.options = values

      const covered = fieldEnum && values.every(o => fieldEnum.includes(o.value as string))
      if (!covered) {
        // No field can answer these prices, so the form gains one. This is the
        // one repair that adds something visible: a choice the buyer must make,
        // because a price the form cannot select can never be charged.
        const planKey = 'plan' in props ? 'billing_plan' : 'plan'
        product.properties = {
          ...props,
          [planKey]: { title: 'Billing Plan', type: 'string', enum: values.map(o => o.value) },
        }
        const required = Array.isArray(product.required) ? (product.required as string[]) : []
        if (!required.includes(planKey)) product.required = [...required, planKey]
        xp.field = planKey
        const order = Array.isArray(productUi['ui:order']) ? (productUi['ui:order'] as string[]) : null
        if (order && !order.includes(planKey)) {
          const star = order.indexOf('*')
          productUi = {
            ...productUi,
            'ui:order': star >= 0
              ? [...order.slice(0, star), planKey, ...order.slice(star)]
              : [...order, planKey],
          }
        }
        notes.push(`Gave each price a value and added a Billing Plan choice (${planKey}) to the form — checkout finds a price by matching the buyer's answer, so pricing needs a question.`)
      } else {
        notes.push('Gave each pricing option a value matching the pricing field, derived from its label.')
      }
    }
  }

  // The credential schema was pushed first, and stays first: it publishes
  // before the product that renders with it.
  out.push({ name, raw: notes.length > 0 ? stringify([product, productUi, data]) : raw, notes })
  return out
}
