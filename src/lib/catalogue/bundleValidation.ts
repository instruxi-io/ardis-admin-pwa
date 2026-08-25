/**
 * Every check a file must pass before it can be published.
 *
 * These ran on every import and could not be tested: unexported, inside a file
 * that imports React. That is how a rule requiring each tier to declare a
 * currency coexisted, in the same file, with a type that had no currency field.
 */

import { kindOf, type ViewModelBundle } from './bundleFormat'
import type { XPricingConfig } from './pricing'
import { checkSchema } from './schemaChecks'

export interface CheckResult {
  label: string
  pass: boolean
  message?: string
}

export interface ValidationResult {
  pass: boolean
  checks: CheckResult[]
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateBundle(obj: ViewModelBundle): ValidationResult {
  const kind = kindOf(obj)
  // A product file carries the order form and pricing; a credential-schema file
  // carries the display schema. Only a legacy combined bundle has both, so
  // checking a file against the half it does not contain would fail every time.
  const hasOrder      = kind === 'product' || kind === 'bundle'
  const hasCredential = kind === 'credential-schema' || kind === 'bundle'

  const orderSchema = (obj.order_schema as Record<string, unknown>) ?? {}
  const dataSchema  = (obj.data_schema  as Record<string, unknown>) ?? {}
  const orderUi     = (obj.order_ui_schema as Record<string, unknown>) ?? {}
  const displayUi   = (obj.ui_schema as Record<string, unknown>) ?? {}

  const checks: CheckResult[] = [
    // ── Manifest ──
    {
      label: 'Has required fields: name, verifier_id, credential_type',
      pass: typeof obj.name === 'string' && (obj.name as string).trim() !== '' &&
            typeof obj.verifier_id === 'string' && typeof obj.credential_type === 'string',
      message: 'name, verifier_id, and credential_type must be present as strings — a product takes its name from the schema title',
    },
    {
      label: 'verifier_id is lowercase alphanumeric (a-z, 0-9, hyphens)',
      pass: /^[a-z0-9-]+$/.test((obj.verifier_id as string) ?? ''),
      message: 'verifier_id must be lowercase letters, numbers, and hyphens only',
    },
    {
      // credential_type is interpolated into the schema's storage path and is how
      // a product finds the schema its results render with.
      label: 'credential_type is a valid slug',
      pass: /^[a-z0-9-]+$/.test((obj.credential_type as string) ?? ''),
      message: 'credential_type must be lowercase letters, numbers, and hyphens only',
    },
    // ── Credential schema version (its identity; immutable once published) ──
    ...(kind === 'credential-schema' ? [{
      label: 'x-version is set and looks like v1, v2, …',
      pass: /^v\d+$/.test((obj.version as string) ?? ''),
      message: 'A credential schema needs an explicit x-version — it is immutable once published, so the version IS its identity',
    }] as CheckResult[] : []),
    ...(hasOrder ? [{
      label: 'order_type is a valid slug (product-agnostic — vendors define their own)',
      pass: !obj.order_type || /^[a-z0-9-]+$/.test(obj.order_type as string),
      message: 'order_type must be lowercase letters, numbers, and hyphens only (no fixed list)',
    }] as CheckResult[] : []),
    // ── Order schema ──
    ...(hasOrder ? [
      {
        label: 'order_schema.type is "object"',
        pass: orderSchema.type === 'object',
        message: 'order_schema must have type: "object"',
      },
      {
        label: 'order_schema has a properties field',
        pass: typeof orderSchema.properties === 'object' && orderSchema.properties !== null,
        message: 'order_schema must define properties',
      },
      {
        label: 'order_ui_schema ui:order references valid fields',
        pass: (() => {
          const order = (orderUi['ui:order'] as string[]) ?? []
          const props = Object.keys((orderSchema.properties as object) ?? {})
          // "*" is RJSF's wildcard for "everything not named above", and is the
          // only legal way to write a partial ui:order. Rejecting it forced
          // authors into listing every field or dropping ui:order entirely.
          return order.every(f => f === '*' || props.includes(f))
        })(),
        message: 'order_ui_schema ui:order references fields not defined in order_schema.properties',
      },
      {
        // The point of the split: object 3 is the formData pane, so it must be
        // valid against object 1 or the file did not come from a working editor.
        label: 'sample order data only uses fields the order form defines',
        pass: (() => {
          const props = Object.keys((orderSchema.properties as object) ?? {})
          const sample = (obj.data as Record<string, unknown>) ?? {}
          return Object.keys(sample).every(k => props.includes(k))
        })(),
        message: 'The third object is sample order data — every key must be a property of the order form',
      },
    ] as CheckResult[] : []),
    // ── Display schema ──
    ...(hasCredential ? [
      {
        label: 'data_schema.type is "object"',
        pass: dataSchema.type === 'object',
        message: 'data_schema must have type: "object"',
      },
      {
        label: 'data_schema has a properties field',
        pass: typeof dataSchema.properties === 'object' && dataSchema.properties !== null,
        message: 'data_schema must define properties',
      },
      {
        label: 'ui_schema ui:groups references valid fields (if present)',
        pass: (() => {
          const groups = (displayUi['ui:groups'] as { fields: string[] }[]) ?? []
          const props = Object.keys((dataSchema.properties as object) ?? {})
          return groups.every(g => g.fields.every(f => props.includes(f)))
        })(),
        message: 'ui_schema ui:groups references fields not defined in data_schema.properties',
      },
      {
        label: 'sample credential data only uses fields the schema defines',
        pass: (() => {
          const props = Object.keys((dataSchema.properties as object) ?? {})
          const sample = (obj.data as Record<string, unknown>) ?? {}
          return Object.keys(sample).every(k => props.includes(k))
        })(),
        message: 'The third object is sample credential data — every key must be a property of the schema',
      },
    ] as CheckResult[] : []),
    // ── Engine-backed checks ──
    // Everything above compares keys. These compile the schema and validate the
    // sample against it, using the same AJV the preview uses, so a file cannot
    // pass validation here and then fail in the pane beside it.
    ...(() => {
      const out: CheckResult[] = []
      const halves: { label: string; schema: Record<string, unknown>; form: boolean }[] = []
      if (hasOrder) halves.push({ label: 'order form', schema: orderSchema, form: true })
      if (hasCredential) halves.push({ label: 'credential schema', schema: dataSchema, form: false })

      for (const half of halves) {
        if (!half.schema || Object.keys(half.schema).length === 0) continue
        const sample = (obj.data as Record<string, unknown>) ?? undefined
        // Sample data belongs to whichever half the file carries; a legacy bundle
        // has both halves but one sample, which describes the order form.
        const r = checkSchema(half.schema, half.form || !hasOrder ? sample : undefined, {
          flagNestedObjects: half.form,
        })

        out.push({
          label: `${half.label} is a valid JSON Schema`,
          pass: r.schemaValid,
          message: r.schemaError ?? '',
        })

        if (r.sampleValid !== undefined) {
          out.push({
            label: `sample data validates against the ${half.label}`,
            pass: r.sampleValid,
            message: r.sampleError
              ? `The third object does not fit the first: ${r.sampleError}`
              : '',
          })
        }

        out.push({
          label: `${half.label} required fields all exist`,
          pass: r.missingRequired.length === 0,
          message: r.missingRequired.length
            ? `required names fields that are not defined (${r.missingRequired.join(', ')}), so nobody could ever complete it`
            : '',
        })

        out.push({
          label: `${half.label} avoids constructs the app cannot render`,
          pass: r.unsupported.length === 0,
          message: r.unsupported.length
            ? `The portal preview renders these, the mobile app does not: ${r.unsupported.join(', ')}`
            : '',
        })
      }
      return out
    })(),
    // ── Format mixing ──
    ...(kind === 'product' ? [{
      // A product file is parsed as the order-form half only; an embedded
      // x-data-schema is not published, not warned about, just dropped. A
      // vendor who pasted their combined file and added x-publishes: product
      // shipped believing their new credential schema went live with it.
      label: 'product file does not embed a credential schema',
      pass: !('x-data-schema' in ((obj.order_schema as Record<string, unknown>) ?? {})),
      message: 'This product file embeds x-data-schema, which a product file does not publish — the schema would be silently dropped. Move it to its own file with x-publishes: credential-schema',
    }] : []),
    // ── Pricing (only checked if x-pricing is present) ──
    ...(() => {
      if (!hasOrder) return []
      const xp = (obj['x-pricing'] ?? obj['x_pricing']) as XPricingConfig | undefined
      if (!xp) return [] // no pricing = free product, valid

      const orderProps = Object.keys((orderSchema.properties as object) ?? {})

      return [
        {
          label: 'x-pricing field exists in order_schema',
          pass: !!xp.field && orderProps.includes(xp.field),
          message: `x-pricing.field "${xp.field}" must be a property defined in order_schema`,
        },
        {
          label: 'x-pricing options all have amounts defined (> 0; tiers cannot be free)',
          pass: (xp.options ?? []).length > 0 &&
                (xp.options ?? []).every(o => typeof o.amount === 'number' && o.amount > 0),
          message: 'Every pricing tier must have a positive amount in cents — tiers cannot be free',
        },
        {
          // The first thing the server checks, and until now the one thing this
          // panel did not: checkout finds a tier by matching the buyer's answer
          // in the pricing field against each option's value, so an option
          // without one can never be bought. A file with title/label but no
          // value passed here as "valid" and came back 400 from the server.
          label: 'x-pricing options each declare a value (the order-form answer that selects the tier)',
          pass: (xp.options ?? []).every(
            o => typeof (o as { value?: string }).value === 'string' &&
                 ((o as { value?: string }).value as string).trim() !== ''),
          message: 'Every pricing option needs "value": the answer in the pricing field that selects it (e.g. "monthly"). "title" or "name" alone cannot be matched at checkout',
        },
        {
          // Reachability, not just presence: when the pricing field is an enum,
          // an option value outside that enum is a price no form answer can
          // ever select.
          label: 'x-pricing option values are answers the pricing field accepts',
          pass: (() => {
            const fieldSchema = ((orderSchema.properties as Record<string, unknown>) ?? {})[xp.field ?? ''] as Record<string, unknown> | undefined
            const allowed = Array.isArray(fieldSchema?.enum)
              ? (fieldSchema!.enum as unknown[]).map(v => `${v}`)
              : null
            if (!allowed) return true
            return (xp.options ?? []).every(o => {
              const v = (o as { value?: string }).value
              return !v || allowed.includes(v)
            })
          })(),
          message: `x-pricing.field "${xp.field}" is an enum, and at least one option's value is not among its choices — that tier could never be selected`,
        },
        {
          label: 'x-pricing addons all have amounts defined (0 = free is allowed)',
          pass: (xp.addons ?? []).every(a => typeof a.amount === 'number' && a.amount >= 0),
          message: 'Every add-on must have an amount defined in cents (use 0 for a free add-on)',
        },
        {
          // The server cross-checks add-on fields too. Only the tier field was
          // checked here, so a bundle could pass every check and still come back
          // 400 invalid_bundle — the worst kind of validation gap.
          label: 'x-pricing addon fields all exist in order_schema',
          pass: (xp.addons ?? []).every(a => !!a.field && orderProps.includes(a.field)),
          message: 'Every add-on field must be a property defined in order_schema',
        },
        {
          // A missing currency silently becomes usd server-side, so one omitted
          // add-on in a GBP product yields a mixed-currency Stripe product.
          label: 'every tier and addon sets an explicit currency',
          pass: [...(xp.options ?? []), ...(xp.addons ?? [])]
            .every(e => !!(e as { currency?: string }).currency),
          message: 'Set currency explicitly on every tier and add-on — a missing one defaults to usd',
        },
        {
          label: 'order_schema has properties for pricing fields to reference',
          pass: orderProps.length > 0,
          message: 'Parameterised pricing needs order_schema properties, or checkout can never resolve a price',
        },
      ] as CheckResult[]
    })(),
    ...(hasOrder ? [{
      // The tier/addon currency check below does not cover x-price-one-time,
      // which had no currency of its own and was hardcoded to usd server-side.
      // A flat-priced product in any other currency has to say so explicitly.
      label: 'x-price-currency is a three-letter code when set (flat price defaults to usd)',
      pass: !obj['x-price-currency'] || /^[a-zA-Z]{3}$/.test(obj['x-price-currency'] as string),
      message: 'x-price-currency must be a three-letter currency code such as gbp or eur',
    }] as CheckResult[] : []),
    ...(hasOrder ? [{
      label: 'sku is lowercase alphanumeric (a-z, 0-9, hyphens) when set',
      pass: !obj.sku || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(obj.sku as string),
      message: 'x-sku must be lowercase letters, numbers, and hyphens only',
    }] as CheckResult[] : []),
    // ── Security ──
    {
      label: 'No external URL references',
      pass: !JSON.stringify(obj).match(/https?:\/\//),
      message: 'File contains external URLs — potential injection risk',
    },
    {
      label: 'No script injection patterns',
      // Deliberately the same pattern as reActiveContent in ardis-ms, which is
      // the authority. Two differences mattered: `on\w+=` without a word
      // boundary matches "conversion=1", blocking a legitimate description here
      // that the server would accept; and data:text/html was missing entirely,
      // so the portal passed a payload the server then refused.
      pass: !JSON.stringify(obj).match(/<script|javascript:|data:text\/html|eval\(|\bon\w+\s*=/i),
      message: 'File contains potentially dangerous script patterns',
    },
  ]

  return { pass: checks.every(c => c.pass), checks }
}

// ── Single file drop zone ─────────────────────────────────────────────────────
