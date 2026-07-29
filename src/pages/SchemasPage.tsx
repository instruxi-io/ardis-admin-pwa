import { useCallback, useRef, useState, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload, CheckCircle2, XCircle, AlertCircle, ChevronDown,
  ChevronUp, Database, FileJson, Eye, Package
} from 'lucide-react'
import { OrderFormPreview, CredentialPreview } from '@/components/ui/schema-preview'
import { schemasApi, productsApi, type SchemaIndexEntry, type ProductEntry } from '@/lib/ardisMsClient'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PublishConfirmModal } from '@/components/ui/publish-confirm-modal'
import { format } from 'date-fns'
import { env } from '@/config/env'

// ── Bundle file format (Andy / standard JSON Forms convention) ────────────────
//
// One file, three JSON objects stacked vertically:
//
//   { JSON Schema }    ← data structure + x- metadata fields
//   { UI Schema }      ← layout: ui:order, ui:groups, widget hints
//   { JSON Data }      ← sample payload for preview
//
// Manifest metadata is embedded in the JSON Schema using x- extension fields:
//   x-verifier-id, x-verifier-name, x-credential-type, x-order-type, x-version
//
// Also accepts the legacy single-object format for backwards compatibility.

// ── Multi-JSON parser ─────────────────────────────────────────────────────────

function parseMultipleJsonObjects(raw: string): Record<string, unknown>[] {
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

// ── Normalise any import format into a flat bundle object ─────────────────────

function parseBundle(raw: string): ViewModelBundle | null {
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

type ViewModelBundle = Record<string, unknown>

/// One file waiting to be published. Files are dropped together and published in
/// dependency order, so each carries its own edit state and outcome.
interface DroppedFile {
  id: string
  name: string
  raw: string
  edited: string | null
}

interface PublishStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
}

// Credential schemas must land before the products that name them: the server
// refuses a product whose credential type has no published schema. Sorting here
// rather than asking the operator to drop them in order is the entire point.
const PUBLISH_ORDER: Record<BundleKind, number> = {
  'credential-schema': 0,
  bundle: 1,
  product: 2,
}

// What a file publishes. The two-file layout says so explicitly via x-publishes,
// so an order form and a credential schema can never be taken for one another.
// Files without it are the older combined bundle and keep working.
type BundleKind = 'product' | 'credential-schema' | 'bundle'

function kindOf(b: ViewModelBundle): BundleKind {
  return (b.kind as BundleKind) ?? 'bundle'
}

const KIND_LABEL: Record<BundleKind, string> = {
  product: 'Product (order form + pricing)',
  'credential-schema': 'Credential schema',
  bundle: 'Combined bundle (legacy)',
}

interface CheckResult {
  label: string
  pass: boolean
  message?: string
}

interface ValidationResult {
  pass: boolean
  checks: CheckResult[]
}

// ── Validation ────────────────────────────────────────────────────────────────

// A 409 from the credential-schema endpoint means that version is already
// published. Immutability is deliberate, so this is a normal outcome when only
// the product changed, not a failure.
function isConflict(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 409
}

// Structural comparison of two published schemas. Key order is irrelevant, so
// JSON.stringify would report false differences on an unchanged schema and send
// the user off to bump a version for no reason.
function deepEqual(a: unknown, b: unknown): boolean {
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
function nextVersion(v: string): string {
  const m = /^v(\d+)$/.exec(v)
  return m ? `v${Number(m[1]) + 1}` : 'v2'
}

// Mirrors ardis-ms slugify(): the server derives a sku from the product name when
// the bundle omits x-sku. Reproduced here so the product index finds an existing
// product whether or not its bundle declared one.
function skuFor(bundle: ViewModelBundle): string {
  const explicit = (bundle.sku as string)?.trim()
  if (explicit) return explicit
  return ((bundle.name as string) ?? '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validateBundle(obj: ViewModelBundle): ValidationResult {
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
          return order.every(f => props.includes(f))
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
    // ── Pricing (only checked if x-pricing is present) ──
    ...(() => {
      if (!hasOrder) return []
      const xp = (obj['x-pricing'] ?? (obj as any).x_pricing) as XPricingConfig | undefined
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
      pass: !JSON.stringify(obj).match(/<script|javascript:|eval\(|on\w+=/i),
      message: 'File contains potentially dangerous script patterns',
    },
  ]

  return { pass: checks.every(c => c.pass), checks }
}

// ── Single file drop zone ─────────────────────────────────────────────────────

function DropZone({ count, onFiles }: {
  count: number
  onFiles: (dropped: { name: string; raw: string }[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // Reads every dropped file before handing them over as one batch. Calling back
  // per file would append them in whatever order the reads happened to finish.
  const read = useCallback((list: FileList) => {
    const chosen = Array.from(list)
    if (chosen.length === 0) return
    Promise.all(chosen.map(f => new Promise<{ name: string; raw: string }>(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve({ name: f.name, raw: (e.target?.result as string) ?? '' })
      reader.onerror = () => resolve({ name: f.name, raw: '' })
      reader.readAsText(f)
    }))).then(read => onFiles(read.filter(r => r.raw)))
  }, [onFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) read(e.dataTransfer.files)
  }, [read])

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer text-center
        ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) read(e.target.files); e.target.value = '' }}
      />
      <div className="flex flex-col items-center gap-2">
        <div className="p-3 rounded-full bg-muted text-muted-foreground">
          <FileJson size={22} />
        </div>
        <p className="text-sm font-medium">
          {count === 0 ? 'Drop this product’s files here' : 'Drop another file'}
        </p>
        <p className="text-xs text-muted-foreground">
          Credential schema and product together, in any order &mdash; each says which it is
        </p>
        <p className="text-xs text-muted-foreground/60">or click to browse</p>
      </div>
    </div>
  )
}
function ValidationPanel({ result }: { result: ValidationResult }) {
  const [open, setOpen] = useState(false)
  const passed = result.checks.filter(c => c.pass).length

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {result.pass
            ? <CheckCircle2 size={14} className="text-emerald-500" />
            : <XCircle size={14} className="text-destructive" />}
          <span className="text-sm font-medium">
            {result.pass ? 'All checks passed' : 'Validation failed'}
          </span>
          <span className="text-xs text-muted-foreground">{passed}/{result.checks.length} checks</span>
        </div>
        {open ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {result.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5 bg-muted/10">
              {c.pass
                ? <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                : <XCircle size={12} className="text-destructive mt-0.5 shrink-0" />}
              <div>
                <p className="text-xs">{c.label}</p>
                {!c.pass && c.message && (
                  <p className="text-xs text-destructive mt-0.5">{c.message}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ── Page ──────────────────────────────────────────────────────────────────────

// ── Preview error boundary ────────────────────────────────────────────────────
// Catches RJSF render errors (e.g. ui:order missing properties) and shows a
// clean message rather than crashing the import flow.

class PreviewErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { error: string | null }
> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  componentDidCatch(_e: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
          <XCircle size={20} className="text-destructive" />
          <p className="text-xs font-semibold text-destructive">{this.props.label} render error</p>
          <p className="text-xs text-muted-foreground text-center max-w-xs">{this.state.error}</p>
          <p className="text-xs text-muted-foreground/60 text-center">Fix the schema and re-import to resolve.</p>
        </div>
      )
    }
    return this.props.children
  }
}

export default function SchemasPage({ mode = 'vendor' }: { mode?: 'vendor' | 'platform' }) {
  const isPlatformMode = mode === 'platform'
  // No username here on purpose: it is not a verifier_id and treating it as one
  // is what broke the visibility filter and the starter file.
  const { isDeveloper } = useAuth()
  const queryClient = useQueryClient()

  const [showImport, setShowImport] = useState(false)
  // A product is two files, so the panel holds a set of them rather than one.
  // `edited` is the operator's in-place JSON edit, kept per file so switching
  // between them does not discard changes.
  const [files, setFiles] = useState<DroppedFile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [publishLog, setPublishLog] = useState<PublishStep[]>([])
  // The whole queue awaiting confirmation in production, not a single bundle.
  const [pendingBundle, setPendingBundle] = useState<{ file: DroppedFile; bundle: ViewModelBundle }[] | null>(null)
  const [publishConfirmed, setPublishConfirmed] = useState(false)
  // Set after publishing a credential schema, to prompt for the product half.
  const [awaitingProduct, setAwaitingProduct] = useState<
    { verifierId: string; credentialType: string; version: string } | null>(null)
  // What happened to the credential schema half of a publish: published, or
  // already published and unchanged. Surfaced so a product-only update does not
  // look like it silently skipped the schema.
  const [schemaOutcome, setSchemaOutcome] = useState<string | null>(null)

  const IS_PROD = env.APP_ENV === 'production'

  // The selected file drives the review panes below. Everything downstream reads
  // activeRaw, so the review is unchanged whether one file was dropped or four.
  const selected = files.find(f => f.id === selectedId) ?? files[0] ?? null
  const activeRaw = selected ? (selected.edited ?? selected.raw) : null
  const bundle: ViewModelBundle | null = activeRaw ? parseBundle(activeRaw) : null

  // Each dropped file with its parse and validation result, in the order they
  // will be published.
  const queue = files
    .map(f => {
      const parsed = parseBundle(f.edited ?? f.raw)
      return { file: f, bundle: parsed, validation: parsed ? validateBundle(parsed) : null }
    })
    .sort((a, b) =>
      (PUBLISH_ORDER[a.bundle ? kindOf(a.bundle) : 'product'] ?? 9) -
      (PUBLISH_ORDER[b.bundle ? kindOf(b.bundle) : 'product'] ?? 9))

  const queueReady = queue.length > 0 && queue.every(q => q.validation?.pass)

  const setSelectedRaw = (text: string) => {
    if (!selected) return
    setFiles(prev => prev.map(f => (f.id === selected.id ? { ...f, edited: text } : f)))
    setPublishConfirmed(false)
  }

  const addFiles = (dropped: { name: string; raw: string }[]) => {
    if (dropped.length === 0) return
    const entries: DroppedFile[] = dropped.map((d, i) => ({
      // Names can repeat across drops; the index keeps ids unique without a uuid.
      id: `${d.name}-${files.length + i}-${d.raw.length}`,
      name: d.name,
      raw: d.raw,
      edited: null,
    }))
    setFiles(prev => [...prev, ...entries])
    setSelectedId(prev => prev ?? entries[0].id)
    setPublishConfirmed(false)
    setPublishLog([])
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    if (selectedId === id) setSelectedId(null)
    setPublishConfirmed(false)
  }

  const validation = bundle ? validateBundle(bundle) : null

  // The bundle's own verifier_id is authoritative. This used to be overwritten
  // with the developer's username, from when verifier_id was the account username
  // by convention. It no longer is: a verifier_id lives in the metadata of the
  // Enforcer group an account belongs to, and the server authorises against that
  // group membership. Usernames and verifier ids routinely differ (ardis-vp vs
  // ardis), so overwriting produced a bundle the server would reject, or worse
  // publish under the wrong verifier.
  //
  // Sending the bundle as authored means the server's group-membership check is
  // the single place authorisation is decided, and a mismatch surfaces as an
  // explicit 403 rather than silently rewritten data.
  const effectiveBundle = bundle

  const { data: schemas = [], isLoading: schemasLoading } = useQuery({
    queryKey: ['schemas'],
    queryFn: schemasApi.list,
  })

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: productsApi.list,
  })

  const isLoading = schemasLoading || productsLoading

  // Index products by verifier_id/credential_type for fast lookup
  const productIndex = products.reduce<Record<string, ProductEntry>>((acc, p) => {
    // Keyed by the product's real identity. This was verifier_id/credential_type,
    // which collides the moment a vendor sells two products of the same type — the
    // second overwrote the first, so stripe_product_id was handed to the wrong
    // product and publishing edited someone else's entry.
    const sku = p.sku?.trim() || skuFor({ name: p.name })
    if (p.verifier_id && sku) {
      acc[`${p.verifier_id}/${sku}`] = p
    }
    return acc
  }, {})

  // Products that render with a given credential schema, keyed
  // verifier_id/credential_type.
  //
  // This is a many-to-one relation and the list has to treat it as one: since the
  // product and credential schema became separate files, ardis/license/v2 is used
  // by both license-verification and provider-background-check. The list used to
  // read productIndex — keyed by SKU — with a credential_type key, so it matched
  // only when a product's sku happened to equal its credential type and otherwise
  // showed "No Stripe product" for a product that existed.
  const productsByType = products.reduce<Record<string, ProductEntry[]>>((acc, p) => {
    if (!p.verifier_id || !p.credential_type) return acc
    const key = `${p.verifier_id}/${p.credential_type}`
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  // Products naming a credential_type that has no published schema. They would
  // otherwise be invisible here — the list is grouped by schema, so a product
  // without one has no group to appear under.
  const publishedTypes = new Set(schemas.map(s => `${s.verifier_id}/${s.credential_type}`))
  const orphanProducts = products.filter(p =>
    p.verifier_id && !publishedTypes.has(`${p.verifier_id}/${p.credential_type ?? ''}`))

  // Publishes one file. Extracted from the mutation so a single drop and a whole
  // queue run through identical code — a two-file product must not take a
  // different path from a one-file one.
  const publishBundle = async (b: ViewModelBundle) => {
    {
      const kind = kindOf(b)
      // Authored value, not the username — see effectiveBundle above.
      const verifierId     = b.verifier_id as string
      const credentialType = b.credential_type as string
      const version        = (b.version as string) || 'v1'

      // 1. Publish the credential schema.
      //
      // Credential schemas are immutable per version, so re-publishing an
      // existing version returns 409. That is expected whenever someone is
      // editing only the product side — a price, the name, the order form — and
      // it must NOT abort the publish, or a price change becomes impossible
      // without minting a credential schema version nobody asked for.
      //
      // But a 409 can mean two different things, and they need opposite
      // outcomes: the schema is unchanged (fine, carry on to the product), or
      // the schema was edited and the version wasn't bumped (a real error, and
      // silently proceeding would leave the bundle and the published schema
      // disagreeing). So on 409 we fetch what is published and compare.
      const desiredSchema = {
        data_schema: (b.data_schema as Record<string, unknown>),
        ui_schema:   (b.ui_schema   as Record<string, unknown>) ?? {},
        sample_data: (b.data        as Record<string, unknown>) ?? undefined,
      }

      const publishCredentialSchema = async () => {
        try {
          await schemasApi.publish({
            verifier_id:     verifierId,
            credential_type: credentialType,
            version,
            ...desiredSchema,
          })
          setSchemaOutcome(`Credential schema ${credentialType}/${version} published.`)
        } catch (err) {
          if (!isConflict(err)) throw err

          const published = await schemasApi.get(verifierId, credentialType, version)
          const changed =
            !deepEqual(published.data_schema, desiredSchema.data_schema) ||
            !deepEqual(published.ui_schema ?? {}, desiredSchema.ui_schema)

          if (changed) {
            throw new Error(
              `Credential schema ${credentialType}/${version} is already published and ` +
              `cannot be changed. Your file's credential schema differs from it — ` +
              `bump x-version to publish the new shape (e.g. ${nextVersion(version)}).`
            )
          }
          setSchemaOutcome(
            `Credential schema ${credentialType}/${version} is already published and unchanged — ` +
            `nothing to do.`
          )
        }
      }

      // Publish the product to Stripe. Pass the existing Stripe product ID if one
      // already exists for this verifier/sku so ardis-ms updates it instead of
      // creating a duplicate.
      //
      // pinSchemaVersion is only true for a legacy combined bundle, where the
      // product and the credential schema were published together and the product
      // pointed at that exact version. A split product names a credential_type and
      // no version: it keeps working when a new schema version is published,
      // which is the whole reason the halves were separated.
      const publishProduct = async (pinSchemaVersion: boolean) => {
        const existingProduct = productIndex[`${verifierId}/${skuFor(b)}`]
        await productsApi.publish({
          stripe_product_id: existingProduct?.id,
          name:              b.name as string,
          description:       b.description as string | undefined,
          verifier_id:       verifierId,
          sku:               skuFor(b),
          verifier_name:     (b.verifier_name as string) || verifierId,
          order_type:        (b.order_type as string) ?? 'license',
          credential_type:   credentialType,
          active:            true,
          order_schema:      b.order_schema as Record<string, unknown>,
          order_ui_schema:   (b.order_ui_schema as Record<string, unknown>) ?? {},
          ...(pinSchemaVersion ? {
            version,
            display_schema_path: `display-schemas/${verifierId}/${credentialType}/${version}/schema.json`,
          } : {}),
          x_pricing:      (b['x-pricing'] ?? (b as any).x_pricing),
          product_role:   (b as any)['x-product-role'] ?? '',
          price_one_time: (b as any)['x-price-one-time'] ?? 0,
          price_currency: (b as any)['x-price-currency'] ?? '',
        } as any)
      }

      if (kind === 'credential-schema') {
        await publishCredentialSchema()
        return
      }
      if (kind === 'product') {
        // No schema publish here. The server refuses a product whose
        // credential_type has no published schema, so the ordering is enforced
        // there rather than guessed at from this side.
        await publishProduct(false)
        return
      }
      await publishCredentialSchema()
      await publishProduct(true)
    }
  }

  const publishMutation = useMutation({
    // Publishes every dropped file in dependency order. Stops at the first
    // failure: a product almost always depends on a schema earlier in the queue,
    // so carrying on would pile a second, misleading error on top of the real one.
    mutationFn: async (items: { file: DroppedFile; bundle: ViewModelBundle }[]) => {
      setPublishLog(items.map(i => ({ id: i.file.id, name: i.file.name, status: 'pending' })))
      for (let i = 0; i < items.length; i++) {
        const { file, bundle: b } = items[i]
        setPublishLog(prev => prev.map(s => s.id === file.id ? { ...s, status: 'running' } : s))
        try {
          await publishBundle(b)
          setPublishLog(prev => prev.map(s => s.id === file.id
            ? { ...s, status: 'done', detail: KIND_LABEL[kindOf(b)] } : s))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Publish failed'
          setPublishLog(prev => prev.map(s =>
            s.id === file.id      ? { ...s, status: 'failed',  detail: msg } :
            s.status === 'pending' ? { ...s, status: 'skipped', detail: 'not attempted' } : s))
          throw new Error(`${file.name}: ${msg}`)
        }
      }
      return items
    },
    onMutate: () => setSchemaOutcome(null),
    onSuccess: (items) => {
      queryClient.invalidateQueries({ queryKey: ['schemas'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })

      const kinds = items.map(i => kindOf(i.bundle))
      const schemaCount  = kinds.filter(k => k === 'credential-schema').length
      const productCount = kinds.filter(k => k !== 'credential-schema').length

      if (items.length > 1) {
        toast.success(`Published ${[
          schemaCount  ? `${schemaCount} credential schema${schemaCount === 1 ? '' : 's'}` : '',
          productCount ? `${productCount} product${productCount === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' and ')}`)
      } else {
        // Single file: say which half changed. "Published" alone is ambiguous when
        // the schema was left alone because its version already exists.
        toast.success(
          kinds[0] === 'credential-schema' ? (schemaOutcome ?? 'Credential schema published')
          : kinds[0] === 'product'         ? 'Product published to Stripe'
          : schemaOutcome                  ? `Product published. ${schemaOutcome}`
          :                                  'Product and credential schema published')
      }

      // A schema published with no product alongside it is half a pair. Hold the
      // panel open and name what is missing, rather than clearing the screen and
      // leaving the operator to remember that a schema alone sells nothing.
      if (productCount === 0 && schemaCount > 0) {
        const last = items[items.length - 1].bundle
        setAwaitingProduct({
          verifierId:     last.verifier_id as string,
          credentialType: last.credential_type as string,
          version:        (last.version as string) || 'v1',
        })
        resetImport(true)
        return
      }
      setAwaitingProduct(null)
      resetImport()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  })

  // keepOpen leaves the import panel up for the second half of a pair. Closing it
  // after publishing a credential schema hid the fact that a product still had to
  // be uploaded, and the two files are almost always uploaded back to back.
  const resetImport = (keepOpen = false) => {
    setShowImport(keepOpen)
    setFiles([])
    setSelectedId(null)
    setPendingBundle(null)
    setPublishConfirmed(false)
  }

  // Everything valid in the queue, in the order it will be published.
  const publishable = queue
    .filter(q => q.bundle && q.validation?.pass)
    .map(q => ({ file: q.file, bundle: q.bundle as ViewModelBundle }))

  const handlePublish = () => {
    if (publishable.length === 0) return
    if (!publishConfirmed) return
    // Developers may never publish platform-role products. Checked across the
    // whole queue, not just the file on screen — the offending one may not be
    // the one being reviewed.
    const platform = publishable.find(p => (p.bundle as any)['x-product-role'] === 'platform')
    if (isDeveloper && platform) {
      toast.error(`${platform.file.name}: platform subscription products may only be published by a tenant admin.`)
      return
    }
    if (IS_PROD) setPendingBundle(publishable)
    else { publishMutation.mutate(publishable); setPublishConfirmed(false) }
  }

  // ── Download helpers ─────────────────────────────────────────────────────

  // A verifier_id the caller is known to own. Everything the server returned is
  // already scoped to their group memberships, so any id in it is authoritative —
  // unlike the account username, which routinely differs from the verifier_id and
  // put a value in the starter file that the server would reject with a 403.
  const ownVerifierId =
    schemas[0]?.verifier_id ?? products.find(p => p.verifier_id)?.verifier_id ?? ''

  const downloadStarterBundle = () => {
    const starter = [
      {
        "$id": "your-verifier-id/credential-type/v1",
        "title": "Product Name",
        "description": "What this verification does.",
        "x-verifier-id": ownVerifierId || "your-verifier-id",
        "x-verifier-name": "Your Company Name",
        "x-credential-type": "credential-type",
        "x-order-type": "license",
        "x-version": "v1",
        "type": "object",
        "required": ["field_one"],
        "properties": {
          "field_one": { "type": "string", "title": "Field One" },
          "field_two": { "type": "string", "title": "Field Two" }
        },
        "x-data-schema": {
          "type": "object",
          "properties": {
            "records": {
              "type": "array",
              "title": "Verification Records",
              "items": {
                "type": "object",
                "properties": {
                  "verified_field": { "type": "string", "title": "Verified Field" },
                  "status":         { "type": "string", "title": "Status" }
                }
              }
            }
          }
        },
        "x-data-ui-schema": {
          "ui:order": ["records"],
          "ui:groups": [{ "title": "Results", "fields": ["records"] }]
        }
      },
      {
        "ui:order": ["field_one", "field_two"],
        "ui:groups": [{ "title": "Details", "fields": ["field_one", "field_two"] }]
      },
      {
        "records": [{ "verified_field": "Example value", "status": "current" }]
      }
    ]
    const text = starter.map(o => JSON.stringify(o, null, 2)).join('\n')
    const blob = new Blob([text], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'starter_bundle.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadPublishedBundle = async (verifierId: string, credentialType: string, version: string, name: string) => {
    try {
      const content = await schemasApi.get(verifierId, credentialType, version)
      const bundle = [
        {
          "$id": `${verifierId}/${credentialType}/${version}`,
          "title": name,
          "x-verifier-id": verifierId,
          "x-credential-type": credentialType,
          "x-version": version,
          "type": "object",
          "properties": {},
          ...(content.data_schema ?? {}),
        },
        content.ui_schema ?? {},
        {}
      ]
      const text = bundle.map(o => JSON.stringify(o, null, 2)).join('\n')
      const blob = new Blob([text], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `${verifierId}_${credentialType}_${version}.bundle.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download schema')
    }
  }

  // Load a published bundle back into the import wizard for creating a new version.
  const loadForNewVersion = async (verifierId: string, credentialType: string, version: string, name: string) => {
    try {
      const content = await schemasApi.get(verifierId, credentialType, version)
      const product = productIndex[`${verifierId}/${credentialType}`]
      // Reconstruct the full bundle JSON with all x- fields from the product
      const obj1: Record<string, unknown> = {
        '$id':             `${verifierId}/${credentialType}/${version}`,
        'title':           name,
        'description':     (product as any)?.description ?? '',
        'x-verifier-id':   verifierId,
        'x-verifier-name': (product as any)?.verifier_name ?? verifierId,
        'x-credential-type': credentialType,
        'x-order-type':    (product as any)?.order_type ?? 'license',
        'x-version':       version,
        'type':            'object',
        'properties':      (content.data_schema as any)?.properties ?? {},
        'x-data-schema':   content.data_schema ?? {},
        'x-data-ui-schema': content.ui_schema ?? {},
      }
      if ((product as any)?.x_pricing) obj1['x-pricing'] = (product as any).x_pricing
      if ((product as any)?.price_one_time) obj1['x-price-one-time'] = (product as any).price_one_time
      if ((product as any)?.product_role) obj1['x-product-role'] = (product as any).product_role

      const bundle = [obj1, content.ui_schema ?? {}, {}]
      const text = bundle.map(o => JSON.stringify(o, null, 2)).join('\n')

      setFiles([{ id: `new-version-${name}`, name: `${name} (new version)`, raw: text, edited: null }])
      setSelectedId(null)
      setPublishLog([])
      setShowImport(true)
      toast.success(`Loaded ${name} — review and publish to create a new version`)
    } catch {
      toast.error('Failed to load schema for editing')
    }
  }

  // product_role lives on the product, not the schema index entry.
  // Use productIndex to check it when filtering schemas.
  const schemaProductRole = (s: typeof schemas[0]) => {
    const key = `${s.verifier_id}/${s.credential_type}`
    // Any product on this schema being the platform gate makes the schema
    // platform-scoped; in practice the gate is the only product on its type.
    return (productsByType[key] ?? []).some(p => (p as any).product_role === 'platform')
      ? 'platform'
      : ''
  }

  // No verifier_id filter here. ListSchemas already scopes the response to the
  // verifier ids of the groups the caller belongs to, so the server is the
  // boundary and anything that arrives is theirs to see.
  //
  // This used to also require s.verifier_id === username, which is the same
  // mistake the publish path was fixed for: a verifier_id lives in group
  // metadata and routinely differs from the account name (ardis-vp vs ardis).
  // A vendor whose names differ published successfully and then saw an empty
  // list — indistinguishable from having lost the work. It only looked correct
  // because the developer test account happens to have username == verifier_id.
  const visibleSchemas = isPlatformMode
    ? schemas.filter(s => schemaProductRole(s) === 'platform')
    : schemas.filter(s => schemaProductRole(s) !== 'platform')

  const grouped = visibleSchemas.reduce<Record<string, typeof schemas>>((acc, s) => {
    const key = `${s.verifier_id}/${s.credential_type}`
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  // The index appends on every publish rather than upserting, so one version can
  // appear many times: ardis/license/v1 is in there seven times. Left as-is a
  // group reports "+6 prior" for a single immutable version, which reads as six
  // superseded schemas that do not exist. Collapse to one entry per version,
  // keeping the most recent publish, since that is the one in storage.
  for (const key of Object.keys(grouped)) {
    const newestByVersion = new Map<string, SchemaIndexEntry>()
    for (const s of grouped[key]) {
      const prev = newestByVersion.get(s.version)
      if (!prev || (s.published_at ?? '') > (prev.published_at ?? '')) {
        newestByVersion.set(s.version, s)
      }
    }
    grouped[key] = [...newestByVersion.values()]
  }

  // Whether the file on screen has its other half already published, answered
  // before the publish rather than by a server error after it. The schema list is
  // loaded anyway, so this costs nothing and is the difference between "publish
  // and find out" and knowing what will happen.
  //
  // Deliberately advisory, not a gate: the server decides, and this can be stale
  // if someone else published a second ago.
  const pairing = (() => {
    if (!effectiveBundle) return null
    const kind = kindOf(effectiveBundle)
    const verifierId = effectiveBundle.verifier_id as string
    const credentialType = effectiveBundle.credential_type as string
    const key = `${verifierId}/${credentialType}`

    if (kind === 'product') {
      const liveVersions = (grouped[key] ?? []).map(s => s.version)
      return liveVersions.length > 0
        ? { ok: true, text: `Renders with ${key} — published (${liveVersions.join(', ')}).` }
        : { ok: false, text: `No credential schema published for ${key}. Publish that file first, or this will be refused.` }
    }

    if (kind === 'credential-schema') {
      const version = (effectiveBundle.version as string) || 'v1'
      if ((grouped[key] ?? []).some(s => s.version === version)) {
        return { ok: false, text: `${key}/${version} is already published. If your file differs, bump x-version to ${nextVersion(version)}.` }
      }
      const users = productsByType[key] ?? []
      return {
        ok: true,
        text: users.length > 0
          ? `Used by ${users.length} existing product${users.length === 1 ? '' : 's'}: ${users.map(p => p.name).join(', ')}.`
          : 'New credential type. Upload its product file next to make it orderable.',
      }
    }
    return null
  })()

  return (
    <>
      <PublishConfirmModal
        open={!!pendingBundle && pendingBundle.length > 0}
        action="Publish"
        confirmText={pendingBundle?.[0]
          ? `${pendingBundle[0].bundle.verifier_id}/${pendingBundle[0].bundle.credential_type}`
          : ''}
        description={pendingBundle
          ? pendingBundle.length === 1
            ? `Publishing ${KIND_LABEL[kindOf(pendingBundle[0].bundle)].toLowerCase()} "${pendingBundle[0].bundle.name}".`
            : `Publishing ${pendingBundle.length} files: ${pendingBundle.map(p => p.file.name).join(', ')}.`
          : ''}
        onConfirm={() => { if (pendingBundle) { publishMutation.mutate(pendingBundle); setPendingBundle(null); setPublishConfirmed(false) } }}
        onCancel={() => setPendingBundle(null)}
      />

      <div className="space-y-6 animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {isPlatformMode ? 'Platform Subscription' : 'View Models'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isPlatformMode
                ? 'Manage the platform subscription that gates vault and catalogue access for all professionals. Tenant admin only.'
                : 'Credential schemas and the products that render with them. Schemas are versioned and immutable; products are edited in place.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadStarterBundle}>
              <FileJson size={14} className="mr-1.5" />New Bundle
            </Button>
            <Button onClick={() => showImport ? resetImport() : setShowImport(true)} size="sm">
              {showImport ? 'Cancel' : <><Upload size={14} className="mr-1.5" />Import</>}
            </Button>
          </div>
        </div>

        {/* Import flow */}
        {showImport && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileJson size={14} />
                Import Credential Schema or Product
              </CardTitle>
              {/* This described the old combined bundle — "a single JSON file" —
                  which is now the opposite of what the operator has to do, on the
                  one screen where they have not yet dropped a file and so have no
                  other signal to go on. */}
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  A product takes two files. Upload the{' '}
                  <span className="font-medium text-foreground/80">credential schema</span> first — what the
                  vendor returns, versioned and immutable — then the{' '}
                  <span className="font-medium text-foreground/80">product</span>, which carries the order
                  form and pricing.
                </p>
                <p>
                  Order matters: a product is refused until the credential schema it renders with exists.
                  Each file declares which it is via <span className="font-mono">x-publishes</span>, and
                  you will be told what it does before anything is published.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Carried over from the schema that was just published: a schema on
                  its own is not orderable, and this is the moment that fact is
                  actionable. */}
              {awaitingProduct && files.length === 0 && (
                <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5">
                  <div className="flex items-start gap-2 min-w-0">
                    <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-semibold text-emerald-600">
                        Published {awaitingProduct.verifierId}/{awaitingProduct.credentialType}/{awaitingProduct.version}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nothing sells it yet. Drop the product file whose{' '}
                        <span className="font-mono">x-credential-type</span> is{' '}
                        <span className="font-mono">{awaitingProduct.credentialType}</span> to make it orderable.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAwaitingProduct(null)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    Later
                  </button>
                </div>
              )}

              {/* Step 1 — Upload */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">1 — Upload</p>
                <DropZone count={files.length} onFiles={addFiles} />

                {/* The batch, in the order it will be published. Schemas sort
                    ahead of products because the server refuses a product whose
                    credential type has no schema — so the operator never has to
                    sequence the uploads themselves. */}
                {files.length > 0 && (
                  <div className="rounded-lg border border-border divide-y divide-border mt-2">
                    {queue.map((q, i) => {
                      const step = publishLog.find(s => s.id === q.file.id)
                      const isSel = selected?.id === q.file.id
                      const kind = q.bundle ? kindOf(q.bundle) : null
                      return (
                        <div
                          key={q.file.id}
                          onClick={() => setSelectedId(q.file.id)}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors
                            ${isSel ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                        >
                          <span className="font-mono text-[11px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">
                              {q.bundle ? (q.bundle.name as string) || q.file.name : q.file.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                              {kind
                                ? `${q.bundle!.verifier_id}/${q.bundle!.credential_type}${
                                    kind === 'credential-schema' ? `/${(q.bundle!.version as string) || 'v1'}` : ''}`
                                : 'could not be parsed'}
                            </p>
                          </div>
                          {kind && (
                            <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                              {kind === 'credential-schema' ? 'schema' : kind === 'product' ? 'product' : 'bundle'}
                            </Badge>
                          )}
                          {step
                            ? <Badge variant="outline" className={`text-[10px] shrink-0 ${
                                step.status === 'done'    ? 'border-emerald-500/40 text-emerald-600' :
                                step.status === 'failed'  ? 'border-destructive/40 text-destructive' :
                                step.status === 'running' ? 'border-primary/40 text-primary' :
                                                            'border-border text-muted-foreground'}`}>
                                {step.status}
                              </Badge>
                            : <Badge variant="outline" className={`text-[10px] shrink-0 ${
                                q.validation?.pass ? 'border-emerald-500/40 text-emerald-600'
                                                   : 'border-destructive/40 text-destructive'}`}>
                                {q.validation?.pass ? 'valid' : 'invalid'}
                              </Badge>}
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); removeFile(q.file.id) }}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            title="Remove from this batch"
                          >
                            &times;
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {files.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    Publishing in this order. {selected ? <>Reviewing <span className="font-mono">{selected.name}</span> below — click another to switch.</> : null}
                  </p>
                )}

                {/* Failures name the file, and anything after the failure is left
                    unattempted rather than piling a dependent error on top. */}
                {publishLog.some(s => s.status === 'failed' || s.status === 'skipped') && (
                  <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 space-y-1">
                    {publishLog.filter(s => s.detail && s.status !== 'done').map(s => (
                      <p key={s.id} className="text-xs text-destructive">
                        <span className="font-mono">{s.name}</span> — {s.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Raw JSON editor — always shown after upload */}
              {selected && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      JSON &middot; <span className="font-mono normal-case">{selected.name}</span>
                    </p>
                    {selected.edited && selected.edited !== selected.raw && (
                      <button
                        type="button"
                        onClick={() => {
                          setFiles(prev => prev.map(f => f.id === selected.id ? { ...f, edited: null } : f))
                          setPublishConfirmed(false)
                        }}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        Reset to original
                      </button>
                    )}
                  </div>
                  <textarea
                    className="w-full h-64 font-mono text-xs bg-muted/20 border border-border rounded-lg p-3 text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    value={selected.edited ?? selected.raw}
                    onChange={e => setSelectedRaw(e.target.value)}
                    spellCheck={false}
                  />
                  <p className="text-[11px] text-muted-foreground">Edit directly above — validation and preview update automatically.</p>
                </div>
              )}

              {/* Step 2 — Preview (always visible as soon as bundle parses) */}
              {bundle && effectiveBundle && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">2 — Preview</p>

                  {/* What this file publishes, stated before anything else: the
                      two halves have different rules, and a credential schema
                      cannot be taken back once published. */}
                  <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg border border-border text-xs">
                    <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Publishes</span>
                    <span className="font-mono font-semibold text-primary">{KIND_LABEL[kindOf(effectiveBundle)]}</span>
                    {kindOf(effectiveBundle) === 'bundle' && (
                      <span className="text-muted-foreground">
                        — no x-publishes, so this is read as the older combined format
                      </span>
                    )}
                  </div>

                  {/* Where this file sits relative to what is already published,
                      before publishing rather than after it fails. */}
                  {pairing && (
                    <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${pairing.ok
                      ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-600'
                      : 'border-amber-500/25 bg-amber-500/5 text-amber-600'}`}>
                      {pairing.ok
                        ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                        : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                      <span>{pairing.text}</span>
                    </div>
                  )}

                  {/* Summary */}
                  <div className="grid grid-cols-4 gap-3 p-3 bg-muted/20 rounded-lg border border-border text-xs">
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Name</span>
                      <p className="font-medium mt-0.5 truncate">{effectiveBundle.name as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Verifier ID</span>
                      <p className="font-mono mt-0.5 text-primary">{effectiveBundle.verifier_id as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Credential Type</span>
                      <p className="font-mono mt-0.5 text-primary">{effectiveBundle.credential_type as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Version</span>
                      <p className="font-mono mt-0.5 text-primary">
                        {kindOf(effectiveBundle) === 'product'
                          ? '— products are mutable'
                          : ((effectiveBundle.version as string) || 'v1')}
                      </p>
                    </div>
                  </div>

                  {/* Preview only the half this file actually carries. Rendering a
                      credential pane for a product file previewed the order form
                      as if it were the credential, which is exactly the confusion
                      the split exists to remove. */}
                  <div className={`grid ${kindOf(effectiveBundle) === 'bundle' ? 'grid-cols-2' : 'grid-cols-1'} gap-6 py-6 px-4 bg-muted/20 rounded-xl border border-border overflow-x-auto`}>
                    {kindOf(effectiveBundle) !== 'credential-schema' && (
                      <PreviewErrorBoundary label="Order form">
                        <OrderFormPreview
                          schema={(effectiveBundle.order_schema as Record<string, unknown>) ?? {}}
                          uiSchema={(effectiveBundle.order_ui_schema as Record<string, unknown>) ?? {}}
                        />
                      </PreviewErrorBoundary>
                    )}
                    {kindOf(effectiveBundle) !== 'product' && (
                      <PreviewErrorBoundary label="Credential">
                        <CredentialPreview
                          schema={(effectiveBundle.data_schema as Record<string, unknown>) ?? {}}
                          uiSchema={(effectiveBundle.ui_schema as Record<string, unknown>) ?? {}}
                          data={(effectiveBundle.data as Record<string, unknown>) ?? {}}
                          verifierName={effectiveBundle.verifier_name as string}
                          credentialType={effectiveBundle.credential_type as string}
                        />
                      </PreviewErrorBoundary>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3 — Validate */}
              {bundle && validation && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">3 — Validate</p>
                  <ValidationPanel result={validation} />
                  {!validation.pass && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-600">
                        Fix the issues above before publishing. Edit the JSON directly or upload a corrected file.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4 — Stripe Pricing (auto-created on publish). A credential
                  schema has no pricing: it is not a thing anyone buys. */}
              {validation?.pass && effectiveBundle && kindOf(effectiveBundle) !== 'credential-schema' && (
                <PricingMapper bundle={effectiveBundle} />
              )}

              {/* Step 5 — Publish gate. Gated on the whole batch: a valid file on
                  screen with an invalid sibling must not look ready to publish. */}
              {queue.length > 0 && queueReady && effectiveBundle && (
                <div className="space-y-4 pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">5 — Publish</p>

                  {/* Confirmation details */}
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-600">Review before publishing</p>
                        <p className="text-xs text-muted-foreground">
                          {publishable.length > 1
                            ? `Publishing ${publishable.length} files in order: credential schemas first, then the products that render with them. Schema versions are immutable once published, and a changed price archives the old one.`
                            : kindOf(effectiveBundle) === 'credential-schema'
                            ? 'This publishes a credential schema. A published version is immutable — correcting it means publishing a new version, and credentials already issued keep rendering with this one.'
                            : kindOf(effectiveBundle) === 'product'
                            ? 'This creates or updates the product in Stripe. Prices are immutable, so a changed amount archives the old price and creates a new one.'
                            : 'This creates or updates the product and its credential schema. A published schema version cannot be edited afterwards.'}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="bg-background/60 rounded p-2">
                        <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Verifier ID</span>
                        <span className="font-mono font-semibold text-foreground">{effectiveBundle.verifier_id as string}</span>
                      </div>
                      {kindOf(effectiveBundle) !== 'product' && (
                        <div className="bg-background/60 rounded p-2">
                          <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Schema</span>
                          <span className="font-mono font-semibold text-foreground">{effectiveBundle.credential_type as string}/{(effectiveBundle.version as string) || 'v1'}</span>
                        </div>
                      )}
                      {kindOf(effectiveBundle) !== 'credential-schema' && (
                        <div className="bg-background/60 rounded p-2">
                          <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Product</span>
                          <span className="font-mono font-semibold text-foreground truncate block">{effectiveBundle.name as string}</span>
                        </div>
                      )}
                      {kindOf(effectiveBundle) === 'product' && (
                        <div className="bg-background/60 rounded p-2">
                          <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Renders with</span>
                          <span className="font-mono font-semibold text-foreground truncate block">{effectiveBundle.credential_type as string}</span>
                        </div>
                      )}
                    </div>
                    {/* Confirmation checkbox */}
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={publishConfirmed}
                        onChange={e => setPublishConfirmed(e.target.checked)}
                        className="mt-0.5 accent-amber-500"
                      />
                      <span className="text-xs text-muted-foreground">
                        I have reviewed the preview above, tested this schema in a dev environment, and confirm this is ready to publish.
                      </span>
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handlePublish}
                      disabled={publishMutation.isPending || !publishConfirmed}
                      size="sm"
                    >
                      {publishMutation.isPending ? 'Publishing…'
                        : publishable.length > 1 ? `Publish ${publishable.length} files`
                        : kindOf(effectiveBundle) === 'credential-schema' ? 'Publish credential schema'
                        : kindOf(effectiveBundle) === 'product' ? 'Publish product to Stripe'
                        : 'Publish to Storj & Stripe'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {!publishConfirmed ? 'Check the box above to enable publish' : 'Ready to publish'}
                    </p>
                  </div>
                </div>
              )}

            </CardContent>
          </Card>
        )}

        {/* Registry */}
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Database size={14} />
              {isLoading
                ? 'Loading…'
                // Was counting credential types and calling them products, which
                // read as a product count and was wrong in both directions once a
                // schema could serve several.
                : [
                    `${products.length} product${products.length === 1 ? '' : 's'}`,
                    `${Object.keys(grouped).length} credential type${Object.keys(grouped).length === 1 ? '' : 's'}`,
                    `${schemas.length} schema version${schemas.length === 1 ? '' : 's'}`,
                    ...(orphanProducts.length > 0 ? [`${orphanProducts.length} without a schema`] : []),
                  ].join(' · ')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
            {!isLoading && schemas.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nothing published yet. Upload a credential schema first, then the product that renders with it.
              </p>
            )}
            {(() => {
              const entries = Object.entries(grouped)
              const isPlatformKey = (key: string) =>
                (productsByType[key] ?? []).some(p => (p as any).product_role === 'platform')
              const platformEntries = entries.filter(([key]) => isPlatformKey(key))
              const vendorEntries   = entries.filter(([key]) => !isPlatformKey(key))
              const renderGroup = ([key, versions]: [string, typeof schemas]) => {
                const [verifierId, credentialType] = key.split('/')
                return (
                  <SchemaGroup
                    key={key}
                    verifierId={verifierId}
                    credentialType={credentialType}
                    versions={[...versions].sort((a, b) => b.version.localeCompare(a.version))}
                    products={productsByType[key] ?? []}
                    isPlatform={isPlatformKey(key)}
                    onArchive={(id) => {
                      productsApi.delete(id).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['products'] })
                        toast.success('Product archived in Stripe')
                      }).catch(() => toast.error('Archive failed'))
                    }}
                    onDownload={downloadPublishedBundle}
                    onNewVersion={loadForNewVersion}
                  />
                )
              }
              return (
                <>
                  {platformEntries.length > 0 && (
                    <>
                      {!isPlatformMode && (
                        <div className="px-6 py-2 border-b border-border bg-amber-500/5 flex items-center gap-2">
                          <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Platform Subscription</span>
                          <span className="text-xs text-muted-foreground">— gates vault + catalogue access for all professionals</span>
                        </div>
                      )}
                      {platformEntries.map(renderGroup)}
                    </>
                  )}
                  {vendorEntries.length > 0 && (
                    <>
                      {platformEntries.length > 0 && (
                        <div className="px-6 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vendor Products</span>
                          <span className="text-xs text-muted-foreground">— orderable from the professional catalogue</span>
                        </div>
                      )}
                      {vendorEntries.map(renderGroup)}
                    </>
                  )}

                  {/* Products naming a credential type with no published schema.
                      The list is grouped by schema, so these had no group to
                      appear under and were invisible — a product live in Stripe
                      and sellable, with nothing to render what it returns. */}
                  {orphanProducts.length > 0 && (
                    <>
                      <div className="px-6 py-2 border-y border-destructive/20 bg-destructive/5 flex items-center gap-2">
                        <AlertCircle size={12} className="text-destructive shrink-0" />
                        <span className="text-xs font-semibold text-destructive uppercase tracking-wide">No credential schema</span>
                        <span className="text-xs text-muted-foreground">
                          — live in Stripe, but nothing renders what they return
                        </span>
                      </div>
                      {orphanProducts.map(p => (
                        <div key={p.id ?? p.name} className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border last:border-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-sm font-medium shrink-0">{p.verifier_id}</span>
                            <Badge variant="outline" className="text-xs font-mono shrink-0 border-destructive/40 text-destructive">
                              {p.credential_type || 'no credential_type'}
                            </Badge>
                            <span className="text-sm truncate text-foreground/80">{p.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            publish {p.verifier_id}/{p.credential_type} to fix
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )
            })()}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ── Pricing mapper ────────────────────────────────────────────────────────────

interface XPricingOption { value: string; label?: string; amount?: number; interval?: string; stripe_price_id?: string }
interface XPricingAddon  { field: string; label?: string; amount?: number; interval?: string; stripe_price_id?: string }
interface XPricingConfig { model?: string; field?: string; options?: XPricingOption[]; addons?: XPricingAddon[] }

// PricingMapper shows what prices will be auto-created in Stripe when the
// bundle is published. No manual input needed — ardis-ms creates prices from
// the amounts defined in x-pricing and stores the IDs back in Stripe metadata.
function PricingMapper({ bundle }: { bundle: ViewModelBundle }) {
  const rawXPricing = (bundle['x-pricing'] ?? (bundle as any).x_pricing) as XPricingConfig | undefined

  if (!rawXPricing || (!rawXPricing.options?.length && !rawXPricing.addons?.length)) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">4 — Stripe Pricing</p>
        <p className="text-xs text-muted-foreground italic">
          No <span className="font-mono">x-pricing</span> found in this bundle. This product will publish as free.
        </p>
      </div>
    )
  }

  const fmt = (amount?: number, interval?: string) => {
    if (!amount) return '—'
    const dollars = (amount / 100).toFixed(2)
    return interval ? `$${dollars}/${interval}` : `$${dollars} one-time`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">4 — Stripe Pricing</p>
        <span className="text-xs text-emerald-500 font-medium">Prices created automatically on publish</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Stripe prices are created automatically from the amounts in the bundle.
        No manual configuration needed.
      </p>

      {rawXPricing.options && rawXPricing.options.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Subscription Tiers — field: <span className="font-mono text-primary">{rawXPricing.field}</span></p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Option</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {rawXPricing.options.map(opt => (
                  <tr key={opt.value} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono">{opt.value}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(opt.amount, opt.interval)}</td>
                    <td className="px-3 py-2">
                      {opt.stripe_price_id && !opt.stripe_price_id.startsWith('price_REPLACE')
                        ? <span className="font-mono text-emerald-500">{opt.stripe_price_id}</span>
                        : <span className="text-muted-foreground italic">auto-created on publish</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rawXPricing.addons && rawXPricing.addons.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Add-ons</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Add-on</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {rawXPricing.addons.map(addon => (
                  <tr key={addon.field} className="border-t border-border/50">
                    <td className="px-3 py-2">
                      <p className="font-mono">{addon.field}</p>
                      {addon.label && <p className="text-muted-foreground">{addon.label}</p>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(addon.amount, addon.interval)}</td>
                    <td className="px-3 py-2">
                      {addon.stripe_price_id && !addon.stripe_price_id.startsWith('price_REPLACE')
                        ? <span className="font-mono text-emerald-500">{addon.stripe_price_id}</span>
                        : <span className="text-muted-foreground italic">auto-created on publish</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Registry group ────────────────────────────────────────────────────────────

function SchemaGroup({ verifierId, credentialType, versions, products, isPlatform, onArchive, onDownload, onNewVersion }: {
  verifierId: string
  credentialType: string
  versions: SchemaIndexEntry[]
  // Every product that renders with this schema. More than one is normal now that
  // the halves are separate files: a free check and a paid check can share one.
  products: ProductEntry[]
  isPlatform?: boolean
  onArchive?: (id: string) => void
  onDownload?: (verifierId: string, credentialType: string, version: string, name: string) => void
  onNewVersion?: (verifierId: string, credentialType: string, version: string, name: string) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSchema, setPreviewSchema] = useState<{ data_schema: Record<string, unknown>; ui_schema: Record<string, unknown>; sample_data?: Record<string, unknown> } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [newVersionConfirm, setNewVersionConfirm] = useState(false)

  const live    = versions[0]   // most recent — always the live version
  const history = versions.slice(1) // older versions

  const handleNewVersion = () => setNewVersionConfirm(true)
  const confirmNewVersion = () => {
    setNewVersionConfirm(false)
    onNewVersion?.(verifierId, credentialType, live.version, credentialType)
  }

  const handlePreview = async () => {
    if (previewOpen) { setPreviewOpen(false); return; }
    if (previewSchema) { setPreviewOpen(true); return; }
    setPreviewLoading(true)
    try {
      const data = await schemasApi.get(verifierId, credentialType, live.version)
      setPreviewSchema(data)
      setPreviewOpen(true)
    } catch { /* silent */ } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div className="border-b border-border last:border-0">

      {/* ── Header: the schema is the subject here, products hang off it ── */}
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-sm font-medium shrink-0">{verifierId}</span>
          <Badge variant="secondary" className="text-xs font-mono shrink-0">{credentialType}</Badge>
          {isPlatform && (
            <Badge className="text-xs shrink-0 bg-amber-500/15 text-amber-600 border border-amber-500/40">
              Platform Gate
            </Badge>
          )}
          <span className="text-xs text-muted-foreground shrink-0">
            {products.length === 0
              ? 'no product uses this schema yet'
              : `${products.length} product${products.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {/* ── Products rendering with this schema ──
          Listed rather than collapsed into one name: a schema serving two
          products is the normal case now, and archiving is per product. */}
      {products.length > 0 && (
        <div className="mx-6 mb-3 rounded-lg border border-border divide-y divide-border">
          {products.map(p => (
            <div key={p.id ?? p.sku ?? p.name} className="flex items-center justify-between gap-4 px-4 py-2">
              <div className="flex items-center gap-3 min-w-0">
                <Package size={12} className="text-muted-foreground shrink-0" />
                <span className="text-sm truncate text-foreground/80">{p.name}</span>
                {p.sku && (
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0">{p.sku}</span>
                )}
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 ${p.active !== false
                    ? 'border-emerald-500/40 text-emerald-600'
                    : 'border-destructive/40 text-destructive'}`}
                >
                  {p.active !== false ? 'Active in Stripe' : 'Archived'}
                </Badge>
              </div>
              {p.id && onArchive && p.active !== false && (
                <button
                  type="button"
                  onClick={() => onArchive(p.id!)}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                >
                  Archive
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* A schema nothing sells is not an error — it may be published ahead of
          its product — but it should be visible rather than looking published
          and in use. */}
      {products.length === 0 && (
        <div className="mx-6 mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2">
          <p className="text-xs text-amber-600">
            Published, but no product renders with it. Upload the matching product file to make it orderable.
          </p>
        </div>
      )}

      {/* ── Live version ── */}
      {live && (
        <div className="mx-6 mb-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500 shrink-0">
              <CheckCircle2 size={12} /> Live
            </span>
            <span className="font-mono text-sm font-semibold shrink-0">{live.version}</span>
            <span className="text-xs text-muted-foreground">
              Published {format(new Date(live.published_at), 'MMM d, yyyy HH:mm')}
            </span>
            {live.published_by && (
              <span className="text-xs text-muted-foreground font-mono truncate hidden sm:block">
                by {live.published_by}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">
              {history.length > 0 ? `+${history.length} prior` : 'first version'}
            </span>
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewLoading}
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
              title="Preview credential rendering"
            >
              <Eye size={12} /> {previewLoading ? 'Loading…' : previewOpen ? 'Hide' : 'Preview'}
            </button>
            {onNewVersion && (
              <button
                type="button"
                onClick={handleNewVersion}
                className="text-xs text-muted-foreground hover:text-amber-500 transition-colors flex items-center gap-1"
                title="Create a new version of this view model"
              >
                <Upload size={12} /> New Version
              </button>
            )}
            {onDownload && (
              <button
                type="button"
                onClick={() => onDownload(verifierId, credentialType, live.version, products[0]?.name ?? credentialType)}
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                title="Download bundle file"
              >
                <Database size={12} /> Load
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── New version confirmation dialog ── */}
      {newVersionConfirm && (
        <div className="mx-6 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-amber-600">View models are immutable</p>
              <p className="text-xs text-muted-foreground">
                Publishing will create a new version (<span className="font-mono">v{(parseInt(live.version.replace('v','')) + 1) || 2}</span>) alongside the existing one.
                The app always fetches <span className="font-mono">/latest</span> so your update applies immediately to all credentials of this type.
                The current version remains in history for reference.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setNewVersionConfirm(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded border border-border"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmNewVersion}
              className="text-xs font-medium text-amber-600 hover:text-amber-500 transition-colors px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10"
            >
              Load for editing → New Version
            </button>
          </div>
        </div>
      )}

      {/* ── Inline credential preview ── */}
      {previewOpen && previewSchema && (
        <div className="mx-6 mb-3 rounded-lg border border-border bg-muted/10 p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Credential Preview</p>
          <PreviewErrorBoundary label="Credential preview">
            <CredentialPreview
              schema={(previewSchema.data_schema as Record<string, unknown>) ?? {}}
              uiSchema={(previewSchema.ui_schema as Record<string, unknown>) ?? {}}
              data={(previewSchema.sample_data as Record<string, unknown>) ?? {}}
              verifierName={products[0]?.verifier_name as string}
              credentialType={credentialType}
            />
          </PreviewErrorBoundary>
        </div>
      )}

      {/* ── Version history (collapsed by default) ── */}
      {history.length > 0 && (
        <div className="mx-6 mb-3">
          <button
            type="button"
            onClick={() => setHistoryOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors pb-1"
          >
            {historyOpen
              ? <ChevronUp size={12} />
              : <ChevronDown size={12} />}
            Version history ({history.length})
          </button>
          {historyOpen && (
            <div className="rounded-lg border border-border overflow-hidden mt-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/20">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Version</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Published</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">By</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(v => (
                    <tr key={v.version} className="border-t border-border/50 text-muted-foreground">
                      <td className="px-4 py-2 font-mono">{v.version}</td>
                      <td className="px-4 py-2">
                        {format(new Date(v.published_at), 'MMM d, yyyy HH:mm')}
                      </td>
                      <td className="px-4 py-2 font-mono truncate max-w-[160px]">
                        {v.published_by || '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="text-muted-foreground/60 italic">superseded</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
