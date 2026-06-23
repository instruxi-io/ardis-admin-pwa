import { useCallback, useRef, useState } from 'react'
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
        data_schema:     schema,
        ui_schema:       uiSchema,
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

  const parsed = file ? (() => { try { return JSON.parse(file) } catch { return null } })() : null
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

export default function SchemasPage() {
  const { isDeveloper, username } = useAuth()
  const queryClient = useQueryClient()

  const [showImport, setShowImport] = useState(false)
  const [fileRaw, setFileRaw] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [pendingBundle, setPendingBundle] = useState<ViewModelBundle | null>(null)

  const IS_PROD = env.APP_ENV === 'production'

  const bundle: ViewModelBundle | null = fileRaw ? parseBundle(fileRaw) : null

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

      // 1. Upload display schema to Storj
      await schemasApi.publish({
        verifier_id:     verifierId,
        credential_type: credentialType,
        version,
        data_schema: (b.data_schema  as Record<string, unknown>),
        ui_schema:   (b.ui_schema    as Record<string, unknown>) ?? {},
      })

      // 2. Publish product to Stripe. x-pricing is passed as-is from the bundle —
      // ardis-ms auto-creates Stripe prices for each tier and addon, then stores
      // the price_xxx IDs back in Stripe product metadata. No manual IDs needed.
      await productsApi.publish({
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
        x_pricing:         (b['x-pricing'] ?? (b as any).x_pricing),
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
    setShowPreview(false)
    setPendingBundle(null)
  }

  const handlePublish = () => {
    if (!effectiveBundle) return
    if (IS_PROD) setPendingBundle(effectiveBundle)
    else publishMutation.mutate(effectiveBundle)
  }

  const grouped = schemas.reduce<Record<string, typeof schemas>>((acc, s) => {
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
            <h1 className="text-2xl font-semibold">View Models</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Import a vendor-supplied JSON bundle — validated, previewed, then published to Storj.
            </p>
          </div>
          <Button onClick={() => showImport ? resetImport() : setShowImport(true)} size="sm">
            {showImport ? 'Cancel' : <><Upload size={14} className="mr-1.5" />Import</>}
          </Button>
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
                  onFile={raw => { setFileRaw(raw || null); setShowPreview(false) }}
                />
              </div>

              {/* Step 2 — Validate */}
              {bundle && validation && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">2 — Validate</p>
                  <ValidationPanel result={validation} />
                  {!validation.pass && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-600">
                        Share these validation results with the vendor so they can correct the file before re-submitting.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 — Preview */}
              {validation?.pass && effectiveBundle && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">3 — Preview</p>
                    <button
                      type="button"
                      onClick={() => setShowPreview(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Eye size={12} />
                      {showPreview ? 'Hide preview' : 'Show app preview'}
                    </button>
                  </div>

                  {/* Summary */}
                  <div className="grid grid-cols-4 gap-3 p-3 bg-muted/20 rounded-lg border border-border text-xs">
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Name</span>
                      <p className="font-medium mt-0.5 truncate">{effectiveBundle.name as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Verifier ID</span>
                      <p className="font-mono mt-0.5">{effectiveBundle.verifier_id as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Credential Type</span>
                      <p className="font-mono mt-0.5">{effectiveBundle.credential_type as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Version</span>
                      <p className="font-mono mt-0.5">{(effectiveBundle.version as string) ?? 'v1'}</p>
                    </div>
                  </div>

                  {showPreview && (
                    <div className="grid grid-cols-2 gap-6 py-6 px-4 bg-muted/20 rounded-xl border border-border overflow-x-auto">
                      <OrderFormPreview
                        schema={(effectiveBundle.order_schema as Record<string, unknown>) ?? {}}
                        uiSchema={(effectiveBundle.order_ui_schema as Record<string, unknown>) ?? {}}
                      />
                      <CredentialPreview
                        schema={(effectiveBundle.data_schema as Record<string, unknown>) ?? {}}
                        uiSchema={(effectiveBundle.ui_schema as Record<string, unknown>) ?? {}}
                        data={(effectiveBundle.data as Record<string, unknown>) ?? {}}
                        verifierName={effectiveBundle.verifier_name as string}
                        credentialType={effectiveBundle.credential_type as string}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Step 4 — Stripe Pricing (auto-created on publish) */}
              {validation?.pass && effectiveBundle && (
                <PricingMapper bundle={effectiveBundle} />
              )}

              {/* Step 5 — Publish */}
              {validation?.pass && (
                <div className="flex items-center gap-3 pt-2 border-t border-border">
                  <Button onClick={handlePublish} disabled={publishMutation.isPending} size="sm">
                    {publishMutation.isPending ? 'Publishing…' : 'Publish'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Uploads schemas to Storj · Creates product in Stripe
                  </p>
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
            {Object.entries(grouped).map(([key, versions]) => {
              const [verifierId, credentialType] = key.split('/')
              return (
                <SchemaGroup
                  key={key}
                  verifierId={verifierId}
                  credentialType={credentialType}
                  versions={[...versions].sort((a, b) => b.version.localeCompare(a.version))}
                  product={productIndex[key]}
                  onArchive={(id) => {
                    productsApi.delete(id).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['products'] })
                      toast.success('Product archived in Stripe')
                    }).catch(() => toast.error('Archive failed'))
                  }}
                />
              )
            })}
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

function SchemaGroup({ verifierId, credentialType, versions, product, onArchive }: {
  verifierId: string
  credentialType: string
  versions: SchemaIndexEntry[]
  product?: ProductEntry
  onArchive?: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  const latest = versions[0]?.version

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-sm font-medium shrink-0">{verifierId}</span>
          <Badge variant="secondary" className="text-xs font-mono shrink-0">{credentialType}</Badge>
          {product ? (
            <>
              <span className="text-sm truncate text-foreground/80">{product.name}</span>
              <Badge
                variant="outline"
                className={`text-xs shrink-0 ${product.active !== false ? 'border-emerald-500/40 text-emerald-600' : 'border-destructive/40 text-destructive'}`}
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
        <div className="flex items-center gap-3 ml-4 shrink-0">
          {product?.id && onArchive && product.active !== false && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onArchive(product.id!) }}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Archive
            </button>
          )}
          <span className="text-xs text-muted-foreground">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
          {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/20">
              <th className="text-left px-8 py-2 text-xs font-medium text-muted-foreground">Version</th>
              <th className="text-left px-6 py-2 text-xs font-medium text-muted-foreground">Published</th>
              <th className="text-left px-6 py-2 text-xs font-medium text-muted-foreground">By</th>
              <th className="px-6 py-2" />
            </tr>
          </thead>
          <tbody>
            {versions.map(v => (
              <tr key={v.version} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-8 py-2.5 font-mono text-sm">{v.version}</td>
                <td className="px-6 py-2.5 text-sm text-muted-foreground">
                  {format(new Date(v.published_at), 'MMM d, yyyy HH:mm')}
                </td>
                <td className="px-6 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                  {v.published_by || '—'}
                </td>
                <td className="px-6 py-2.5 text-right">
                  {v.version === latest && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                      <CheckCircle2 size={12} /> latest
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
