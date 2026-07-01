import { useCallback, useRef, useState, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload, CheckCircle2, XCircle, AlertCircle, ChevronDown,
  ChevronUp, Database, FileJson, Eye
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
      return {
        // Extract manifest fields from x- extensions in the JSON Schema
        name:            (schema['title'] as string)           ?? '',
        verifier_id:     (schema['x-verifier-id'] as string)   ?? '',
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
        data,
      }
    }

    if (objects.length === 1) {
      // Legacy single-object format
      return objects[0] as ViewModelBundle
    }

    return null
  } catch {
    return null
  }
}

type ViewModelBundle = Record<string, unknown>

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

function validateBundle(obj: ViewModelBundle): ValidationResult {
  const orderSchema = (obj.order_schema as Record<string, unknown>) ?? {}
  const dataSchema  = (obj.data_schema  as Record<string, unknown>) ?? {}
  const orderUi     = (obj.order_ui_schema as Record<string, unknown>) ?? {}
  const displayUi   = (obj.ui_schema as Record<string, unknown>) ?? {}

  const checks: CheckResult[] = [
    // ── Manifest ──
    {
      label: 'Has required fields: name, verifier_id, credential_type',
      pass: typeof obj.name === 'string' && typeof obj.verifier_id === 'string' && typeof obj.credential_type === 'string',
      message: 'name, verifier_id, and credential_type must be present as strings',
    },
    {
      label: 'verifier_id is lowercase alphanumeric (a-z, 0-9, hyphens)',
      pass: /^[a-z0-9-]+$/.test((obj.verifier_id as string) ?? ''),
      message: 'verifier_id must be lowercase letters, numbers, and hyphens only',
    },
    {
      label: 'order_type is valid (license, sanction, or subscription)',
      pass: !obj.order_type || ['license', 'sanction', 'subscription'].includes(obj.order_type as string),
      message: 'order_type must be "license", "sanction", or "subscription"',
    },
    // ── Order schema ──
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
    // ── Display schema ──
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
    // ── Pricing (only checked if x-pricing is present) ──
    ...(() => {
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
      ] as CheckResult[]
    })(),
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

function DropZone({ file, onFile }: { file: string | null; onFile: (raw: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const read = useCallback((f: File) => {
    const reader = new FileReader()
    reader.onload = e => onFile(e.target?.result as string)
    reader.readAsText(f)
  }, [onFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) read(f)
  }, [read])

  const parsed  = file ? parseBundle(file) : null
  const isValid = parsed !== null

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-10 transition-all cursor-pointer text-center
        ${dragging     ? 'border-primary bg-primary/5'
        : isValid      ? 'border-emerald-500/50 bg-emerald-500/5'
        : file && !isValid ? 'border-destructive/50 bg-destructive/5'
        :                'border-border hover:border-primary/40 hover:bg-muted/30'}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) read(f) }}
      />
      <div className="flex flex-col items-center gap-3">
        <div className={`p-3 rounded-full ${isValid ? 'bg-emerald-500/10 text-emerald-500' : file && !isValid ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
          {isValid ? <CheckCircle2 size={24} /> : file && !isValid ? <XCircle size={24} /> : <FileJson size={24} />}
        </div>
        <div>
          <p className="text-sm font-medium">
            {isValid ? (parsed as any).name ?? 'Bundle loaded'
              : file && !isValid ? 'Invalid JSON'
              : 'Drop view model JSON here'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {isValid
              ? `${(parsed as any).verifier_id} · ${(parsed as any).credential_type} · ${(parsed as any).version ?? 'v1'}`
              : 'Single .json file containing manifest, order schema, and display schema'}
          </p>
        </div>
        {!file && (
          <p className="text-xs text-muted-foreground/60">or click to browse</p>
        )}
        {isValid && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onFile('') }}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ── Validation panel ──────────────────────────────────────────────────────────

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
  const { isDeveloper, username } = useAuth()
  const queryClient = useQueryClient()

  const [showImport, setShowImport] = useState(false)
  const [fileRaw, setFileRaw] = useState<string | null>(null)
  const [editedRaw, setEditedRaw] = useState<string | null>(null)
  const [pendingBundle, setPendingBundle] = useState<ViewModelBundle | null>(null)
  const [publishConfirmed, setPublishConfirmed] = useState(false)

  const IS_PROD = env.APP_ENV === 'production'

  // Parse from editedRaw (user edits) if present, otherwise from uploaded fileRaw
  const activeRaw = editedRaw ?? fileRaw
  const bundle: ViewModelBundle | null = activeRaw ? parseBundle(activeRaw) : null

  const validation = bundle ? validateBundle(bundle) : null

  // For developers, lock verifier_id to their username
  const effectiveBundle = bundle && isDeveloper && username
    ? { ...bundle, verifier_id: username }
    : bundle

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
    if (p.verifier_id && p.credential_type) {
      acc[`${p.verifier_id}/${p.credential_type}`] = p
    }
    return acc
  }, {})

  const publishMutation = useMutation({
    mutationFn: async (b: ViewModelBundle) => {
      const verifierId     = isDeveloper && username ? username : b.verifier_id as string
      const credentialType = b.credential_type as string
      const version        = (b.version as string) ?? 'v1'

      // 1. Upload display schema to Storj (include sample data for portal preview)
      await schemasApi.publish({
        verifier_id:     verifierId,
        credential_type: credentialType,
        version,
        data_schema:  (b.data_schema  as Record<string, unknown>),
        ui_schema:    (b.ui_schema    as Record<string, unknown>) ?? {},
        sample_data:  (b.data as Record<string, unknown>) ?? undefined,
      })

      // 2. Publish product to Stripe. Pass the existing Stripe product ID if one
      // already exists for this verifier/credential_type so ardis-ms updates it
      // instead of creating a duplicate.
      const existingProduct = productIndex[`${verifierId}/${credentialType}`]
      await productsApi.publish({
        stripe_product_id: existingProduct?.id,
        name:              b.name as string,
        description:       b.description as string | undefined,
        verifier_id:       verifierId,
        verifier_name:     (b.verifier_name as string) ?? verifierId,
        order_type:        (b.order_type as string) ?? 'license',
        credential_type:   credentialType,
        version,
        active:            true,
        order_schema:      b.order_schema as Record<string, unknown>,
        order_ui_schema:   (b.order_ui_schema as Record<string, unknown>) ?? {},
        display_schema_path: `display-schemas/${verifierId}/${credentialType}/${version}/schema.json`,
        x_pricing:      (b['x-pricing'] ?? (b as any).x_pricing),
        product_role:   (b as any)['x-product-role'] ?? '',
        price_one_time: (b as any)['x-price-one-time'] ?? 0,
      } as any)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schemas'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('View model published')
      resetImport()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  })

  const resetImport = () => {
    setShowImport(false)
    setFileRaw(null)
    setEditedRaw(null)
    setPendingBundle(null)
    setPublishConfirmed(false)
  }

  const handlePublish = () => {
    if (!effectiveBundle) return
    if (!publishConfirmed) return
    // Developers may never publish platform-role products.
    if (isDeveloper && (effectiveBundle as any)['x-product-role'] === 'platform') {
      toast.error('Platform subscription products may only be published by a tenant admin.')
      return
    }
    if (IS_PROD) setPendingBundle(effectiveBundle)
    else { publishMutation.mutate(effectiveBundle); setPublishConfirmed(false) }
  }

  // ── Download helpers ─────────────────────────────────────────────────────

  const downloadStarterBundle = () => {
    const starter = [
      {
        "$id": "your-verifier-id/credential-type/v1",
        "title": "Product Name",
        "description": "What this verification does.",
        "x-verifier-id": isDeveloper && username ? username : "your-verifier-id",
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

      setFileRaw(text)
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
    return (productIndex[key] as any)?.product_role ?? ''
  }

  const visibleSchemas = isPlatformMode
    ? schemas.filter(s => schemaProductRole(s) === 'platform')
    : isDeveloper
      ? schemas.filter(s => s.verifier_id === username && schemaProductRole(s) !== 'platform')
      : schemas.filter(s => schemaProductRole(s) !== 'platform')

  const grouped = visibleSchemas.reduce<Record<string, typeof schemas>>((acc, s) => {
    const key = `${s.verifier_id}/${s.credential_type}`
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  return (
    <>
      <PublishConfirmModal
        open={!!pendingBundle}
        action="Publish"
        confirmText={pendingBundle ? `${pendingBundle.verifier_id}/${pendingBundle.credential_type}` : ''}
        description={pendingBundle ? `Publishing view model "${pendingBundle.name}" to Storj and Stripe.` : ''}
        onConfirm={() => { if (pendingBundle) { publishMutation.mutate(pendingBundle); setPendingBundle(null) } }}
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
                : 'Import a vendor-supplied JSON bundle — validated, previewed, then published to Storj.'}
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
                Import View Model Bundle
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                The vendor provides a single JSON file containing the manifest, order schema, and display schema.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Step 1 — Upload */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">1 — Upload</p>
                <DropZone
                  file={fileRaw}
                  onFile={raw => { setFileRaw(raw || null); setEditedRaw(null); setPublishConfirmed(false) }}
                />
              </div>

              {/* Raw JSON editor — always shown after upload */}
              {fileRaw && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bundle JSON</p>
                    {editedRaw && editedRaw !== fileRaw && (
                      <button
                        type="button"
                        onClick={() => { setEditedRaw(null); setPublishConfirmed(false) }}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        Reset to original
                      </button>
                    )}
                  </div>
                  <textarea
                    className="w-full h-64 font-mono text-xs bg-muted/20 border border-border rounded-lg p-3 text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    value={editedRaw ?? fileRaw}
                    onChange={e => { setEditedRaw(e.target.value); setPublishConfirmed(false) }}
                    spellCheck={false}
                  />
                  <p className="text-[11px] text-muted-foreground">Edit directly above — validation and preview update automatically.</p>
                </div>
              )}

              {/* Step 2 — Preview (always visible as soon as bundle parses) */}
              {bundle && effectiveBundle && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">2 — Preview</p>

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
                      <p className="font-mono mt-0.5 text-primary">{(effectiveBundle.version as string) ?? 'v1'}</p>
                    </div>
                  </div>

                  {/* Always-on preview */}
                  <div className="grid grid-cols-2 gap-6 py-6 px-4 bg-muted/20 rounded-xl border border-border overflow-x-auto">
                    <PreviewErrorBoundary label="Order form">
                      <OrderFormPreview
                        schema={(effectiveBundle.order_schema as Record<string, unknown>) ?? {}}
                        uiSchema={(effectiveBundle.order_ui_schema as Record<string, unknown>) ?? {}}
                      />
                    </PreviewErrorBoundary>
                    <PreviewErrorBoundary label="Credential">
                      <CredentialPreview
                        schema={(effectiveBundle.data_schema as Record<string, unknown>) ?? {}}
                        uiSchema={(effectiveBundle.ui_schema as Record<string, unknown>) ?? {}}
                        data={(effectiveBundle.data as Record<string, unknown>) ?? {}}
                        verifierName={effectiveBundle.verifier_name as string}
                        credentialType={effectiveBundle.credential_type as string}
                      />
                    </PreviewErrorBoundary>
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

              {/* Step 4 — Stripe Pricing (auto-created on publish) */}
              {validation?.pass && effectiveBundle && (
                <PricingMapper bundle={effectiveBundle} />
              )}

              {/* Step 5 — Publish gate */}
              {validation?.pass && effectiveBundle && (
                <div className="space-y-4 pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">5 — Publish</p>

                  {/* Confirmation details */}
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-600">Review before publishing</p>
                        <p className="text-xs text-muted-foreground">
                          Publishing will create or update the following in Stripe and Storj. This cannot be undone — a new version must be published to make changes.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="bg-background/60 rounded p-2">
                        <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Verifier ID</span>
                        <span className="font-mono font-semibold text-foreground">{effectiveBundle.verifier_id as string}</span>
                      </div>
                      <div className="bg-background/60 rounded p-2">
                        <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Schema</span>
                        <span className="font-mono font-semibold text-foreground">{effectiveBundle.credential_type as string}/{(effectiveBundle.version as string) ?? 'v1'}</span>
                      </div>
                      <div className="bg-background/60 rounded p-2">
                        <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Product</span>
                        <span className="font-mono font-semibold text-foreground truncate block">{effectiveBundle.name as string}</span>
                      </div>
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
                      {publishMutation.isPending ? 'Publishing…' : 'Publish to Storj & Stripe'}
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
                : `${Object.keys(grouped).length} product${Object.keys(grouped).length !== 1 ? 's' : ''} · ${schemas.length} schema version${schemas.length !== 1 ? 's' : ''}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
            {!isLoading && schemas.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No view models published yet. Import a bundle above to get started.
              </p>
            )}
            {(() => {
              const entries = Object.entries(grouped)
              const platformEntries = entries.filter(([key]) => (productIndex[key] as any)?.product_role === 'platform')
              const vendorEntries   = entries.filter(([key]) => (productIndex[key] as any)?.product_role !== 'platform')
              const renderGroup = ([key, versions]: [string, typeof schemas]) => {
                const [verifierId, credentialType] = key.split('/')
                return (
                  <SchemaGroup
                    key={key}
                    verifierId={verifierId}
                    credentialType={credentialType}
                    versions={[...versions].sort((a, b) => b.version.localeCompare(a.version))}
                    product={productIndex[key]}
                    isPlatform={(productIndex[key] as any)?.product_role === 'platform'}
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

function SchemaGroup({ verifierId, credentialType, versions, product, isPlatform, onArchive, onDownload, onNewVersion }: {
  verifierId: string
  credentialType: string
  versions: SchemaIndexEntry[]
  product?: ProductEntry
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
    onNewVersion?.(verifierId, credentialType, live.version, product?.name ?? credentialType)
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

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-sm font-medium shrink-0">{verifierId}</span>
          <Badge variant="secondary" className="text-xs font-mono shrink-0">{credentialType}</Badge>
          {product ? (
            <>
              <span className="text-sm truncate text-foreground/80">{product.name}</span>
              {isPlatform && (
                <Badge className="text-xs shrink-0 bg-amber-500/15 text-amber-600 border border-amber-500/40">
                  Platform Gate
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-xs shrink-0 ${product.active !== false
                  ? 'border-emerald-500/40 text-emerald-600'
                  : 'border-destructive/40 text-destructive'}`}
              >
                {product.active !== false ? 'Active in Stripe' : 'Archived'}
              </Badge>
            </>
          ) : (
            <Badge variant="outline" className="text-xs shrink-0 border-amber-500/40 text-amber-600">
              No Stripe product
            </Badge>
          )}
        </div>
        {product?.id && onArchive && product.active !== false && (
          <button
            type="button"
            onClick={() => onArchive(product.id!)}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-4 shrink-0"
          >
            Archive
          </button>
        )}
      </div>

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
                onClick={() => onDownload(verifierId, credentialType, live.version, product?.name ?? credentialType)}
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
              verifierName={product?.verifier_name as string}
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
