/**
 * The bundle file format: three concatenated JSON objects, and what a file says
 * it publishes.
 *
 * Extracted from SchemasPage so it can be tested. It could not be before: these
 * were unexported in a 2,000-line file that imports React, so the parsing every
 * publish depends on had no way to be exercised outside a browser.
 */

export function parseMultipleJsonObjects(raw: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escape)          { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"')      { inString = !inString; continue }
    if (inString)        continue
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        results.push(JSON.parse(raw.slice(start, i + 1)))
        start = -1
      }
    }
  }
  return results
}

export function parseBundle(raw: string): ViewModelBundle | null {
  try {
    const objects = parseMultipleJsonObjects(raw)

    if (objects.length === 3) {
      // Standard triple format: schema | uiSchema | data
      const [schema, uiSchema, data] = objects
      const publishes = (schema['x-publishes'] as string)?.trim() ?? ''

      // A credential schema stands alone. It describes what the vendor returns,
      // is immutable per version, and has no order form, pricing or sku. Object
      // 1 IS the schema, so it round-trips through an RJSF editor untouched.
      if (publishes === 'credential-schema') {
        return {
          kind:            'credential-schema',
          name:            (schema['title'] as string)             ?? '',
          verifier_id:     (schema['x-verifier-id'] as string)     ?? '',
          credential_type: (schema['x-credential-type'] as string) ?? '',
          version:         (schema['x-version'] as string)         ?? '',
          description:     (schema['description'] as string)       ?? '',
          data_schema:     schema,
          ui_schema:       uiSchema,
          data,
        }
      }

      // A product is the mutable half: order form, pricing, and the
      // credential_type naming the schema its results render with. It carries no
      // version deliberately — re-publishing edits the product in place, where a
      // credential schema would have to be a new version.
      if (publishes === 'product') {
        return {
          kind:            'product',
          name:            (schema['title'] as string)             ?? '',
          verifier_id:     (schema['x-verifier-id'] as string)     ?? '',
          sku:             (schema['x-sku'] as string)             ?? '',
          verifier_name:   (schema['x-verifier-name'] as string)   ?? '',
          credential_type: (schema['x-credential-type'] as string) ?? '',
          order_type:      (schema['x-order-type'] as string)      ?? 'license',
          description:     (schema['description'] as string)       ?? '',
          order_schema:    schema,
          order_ui_schema: uiSchema,
          'x-pricing':          schema['x-pricing'],
          'x-product-role':     (schema['x-product-role'] as string) ?? '',
          'x-price-one-time':   (schema['x-price-one-time'] as number) ?? 0,
          'x-price-currency':   (schema['x-price-currency'] as string) ?? '',
          data,
        }
      }

      // No x-publishes: a legacy combined bundle, where the credential schema is
      // nested under x-data-schema.
      return {
        kind: 'bundle',
        // Extract manifest fields from x- extensions in the JSON Schema
        name:            (schema['title'] as string)           ?? '',
        verifier_id:     (schema['x-verifier-id'] as string)   ?? '',
        // Optional. The server falls back to a slug of the name, so an absent
        // x-sku is normal — but identity is (verifier_id, sku) either way, which
        // is why the product index below must key on it and not credential_type.
        sku:             (schema['x-sku'] as string)            ?? '',
        verifier_name:   (schema['x-verifier-name'] as string) ?? '',
        credential_type: (schema['x-credential-type'] as string) ?? '',
        order_type:      (schema['x-order-type'] as string)    ?? 'license',
        version:         (schema['x-version'] as string)       ?? 'v1',
        description:     (schema['description'] as string)     ?? '',
        order_schema:    schema,
        order_ui_schema: uiSchema,
        // Use x-data-schema / x-data-ui-schema when present — these describe
        // what the VP returns (credential output), which can differ from the
        // order form schema. Falls back to order schema if not provided.
        data_schema:     (schema['x-data-schema'] as Record<string, unknown>) ?? schema,
        ui_schema:       (schema['x-data-ui-schema'] as Record<string, unknown>) ?? uiSchema,
        'x-pricing':          schema['x-pricing'],
        'x-product-role':     (schema['x-product-role'] as string) ?? '',
        'x-price-one-time':   (schema['x-price-one-time'] as number) ?? 0,
        'x-price-currency':   (schema['x-price-currency'] as string) ?? '',
        data,
      }
    }

    if (objects.length === 1) {
      // Legacy single-object format
      return { kind: 'bundle', ...(objects[0] as ViewModelBundle) }
    }

    return null
  } catch {
    return null
  }
}

export type ViewModelBundle = Record<string, unknown>

/// One file waiting to be published. Files are dropped together and published in
/// dependency order, so each carries its own edit state and outcome.

// What a file publishes. The two-file layout says so explicitly via x-publishes,
// so an order form and a credential schema can never be taken for one another.
// Files without it are the older combined bundle and keep working.
export type BundleKind = 'product' | 'credential-schema' | 'bundle'

export function kindOf(b: ViewModelBundle): BundleKind {
  return (b.kind as BundleKind) ?? 'bundle'
}

export const KIND_LABEL: Record<BundleKind, string> = {
  product: 'Product (order form + pricing)',
  'credential-schema': 'Credential schema',
  bundle: 'Combined bundle (legacy)',
}
