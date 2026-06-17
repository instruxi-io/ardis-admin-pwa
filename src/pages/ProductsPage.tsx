import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, ChevronDown, ChevronUp, Package, Trash2, X } from 'lucide-react'
import { productsApi, type ProductEntry, type ProductPricing, type ProductAddon } from '@/lib/ardisMsClient'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import {
  OrderSchemaBuilder, RawToggle,
  type OrderField, type RawToggleRef,
  orderFieldsToSchemas, schemasToOrderFields,
  ORDER_TEMPLATES,
} from '@/components/ui/schema-builder'
import { PublishConfirmModal } from '@/components/ui/publish-confirm-modal'
import { env } from '@/config/env'

const IS_PROD = env.APP_ENV === 'production'

const productSchema = z.object({
  id: z.string().min(1, 'Required').regex(/^[a-z0-9-]+$/, 'Lowercase, numbers, hyphens only'),
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
  verifier_name: z.string().min(1, 'Required'),
  verifier_id: z.string().min(1, 'Required').regex(/^[a-z0-9-]+$/, 'Lowercase, numbers, hyphens only'),
  price_one_time: z.string().optional().refine(v => !v || !isNaN(Number(v)), 'Must be a number'),
  currency: z.string().optional(),
  schema_version: z.string().optional(),
})

type ProductFormValues = z.infer<typeof productSchema>

export default function ProductsPage() {
  const { isDeveloper, username } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [editProduct, setEditProduct] = useState<ProductEntry | null>(null)
  const [orderFields, setOrderFields] = useState<OrderField[]>([])
  const [pricing, setPricing] = useState<ProductPricing | null>(null)
  const [addons, setAddons] = useState<ProductAddon[]>([])
  const orderToggleRef = useRef<RawToggleRef | null>(null)
  const queryClient = useQueryClient()
  const [pendingProduct, setPendingProduct] = useState<ProductEntry | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: productsApi.list,
  })

  const publishMutation = useMutation({
    mutationFn: (product: ProductEntry) => productsApi.publish(product),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Published ${p.name}`)
      setShowForm(false)
      setEditProduct(null)
      reset()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product removed')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { currency: 'USD' },
  })

  useEffect(() => {
    if (isDeveloper && username) setValue('verifier_id', username)
  }, [isDeveloper, username, setValue])

  const openEdit = (p: ProductEntry) => {
    setEditProduct(p)
    setValue('id', p.id)
    setValue('name', p.name)
    setValue('description', p.description ?? '')
    setValue('verifier_name', p.verifier_name ?? '')
    setValue('verifier_id', p.verifier_id ?? '')
    setValue('price_one_time', p.price_one_time != null ? String(p.price_one_time) : '')
    setValue('currency', p.currency ?? 'USD')
    setValue('schema_version', p.schema_version ?? '')
    const parsed = schemasToOrderFields(p.order_schema ?? {}, p.order_ui_schema ?? {})
    setOrderFields(parsed)
    setPricing(p.pricing ?? null)
    setAddons(p.addons ?? [])
    setShowForm(true)
  }

  const applyTemplate = (name: string) => {
    const t = ORDER_TEMPLATES[name]
    if (t) setOrderFields(t)
  }

  const onSubmit = (values: ProductFormValues) => {
    let orderSchema: Record<string, unknown>
    let orderUiSchema: Record<string, unknown>
    try {
      const rawText = orderToggleRef.current?.getRawText()
      if (rawText != null) {
        // Still in raw mode — parse directly from the textarea
        const parsed = JSON.parse(rawText)
        orderSchema = parsed.order_schema ?? parsed
        orderUiSchema = parsed.order_ui_schema ?? {}
      } else if (orderFields.some(f => f.key)) {
        const built = orderFieldsToSchemas(orderFields)
        orderSchema = built.orderSchema
        orderUiSchema = built.orderUiSchema
      } else {
        orderSchema = {}
        orderUiSchema = {}
      }
    } catch {
      toast.error('Order schema JSON is invalid')
      return
    }

    const product: ProductEntry = {
      ...editProduct,
      id: values.id,
      name: values.name,
      description: values.description,
      verifier_name: values.verifier_name,
      verifier_id: values.verifier_id,
      currency: values.currency || 'USD',
      active: true,
      order_schema: orderSchema,
      order_ui_schema: orderUiSchema,
      ...(pricing ? { pricing } : {}),
      ...(addons.length ? { addons } : {}),
      ...(values.price_one_time ? { price_one_time: Number(values.price_one_time) } : {}),
      ...(values.schema_version ? { schema_version: values.schema_version } : {}),
    }
    if (IS_PROD) {
      setPendingProduct(product)
    } else {
      publishMutation.mutate(product)
    }
  }

  const cancelForm = () => { setShowForm(false); setEditProduct(null); reset(); setOrderFields([]); setPricing(null); setAddons([]) }

  return (
    <>
    <PublishConfirmModal
      open={!!pendingProduct}
      action="Publish"
      confirmText={pendingProduct?.id ?? ''}
      description={pendingProduct ? `Publishing product "${pendingProduct.name}" (${pendingProduct.id}) to production.` : ''}
      onConfirm={() => { if (pendingProduct) { publishMutation.mutate(pendingProduct); setPendingProduct(null) } }}
      onCancel={() => setPendingProduct(null)}
    />
    <PublishConfirmModal
      open={!!pendingDelete}
      action="Delete"
      confirmText={pendingDelete ?? ''}
      description={pendingDelete ? `Permanently deleting product "${pendingDelete}" from production.` : ''}
      onConfirm={() => { if (pendingDelete) { deleteMutation.mutate(pendingDelete); setPendingDelete(null) } }}
      onCancel={() => setPendingDelete(null)}
    />
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dynamic product catalogue — VPs manage their own products and pricing.
          </p>
        </div>
        <Button onClick={() => showForm ? cancelForm() : setShowForm(true)} size="sm">
          {showForm ? <X size={14} className="mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
          {showForm ? 'Cancel' : 'New Product'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{editProduct ? `Editing ${editProduct.name}` : 'Publish New Product'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Product ID" error={errors.id?.message}>
                  <Input {...register('id')} placeholder="medical-license-check" className="font-mono text-sm" disabled={!!editProduct} />
                </Field>
                <Field label="Name" error={errors.name?.message}>
                  <Input {...register('name')} placeholder="Medical License Verification" />
                </Field>
              </div>
              <Field label="Description" error={errors.description?.message}>
                <Input {...register('description')} placeholder="Primary-source verification of active medical licenses" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Verifier Name" error={errors.verifier_name?.message}>
                  <Input {...register('verifier_name')} placeholder="CLEAR Health" />
                </Field>
                <Field label="Verifier ID" error={errors.verifier_id?.message}>
                  <Input
                    {...register('verifier_id')}
                    placeholder="clear-health"
                    className="font-mono text-sm"
                    disabled={isDeveloper || !!editProduct}
                    title={isDeveloper ? `Locked to your account: ${username}` : editProduct ? 'Cannot change verifier ID after creation' : undefined}
                  />
                  {isDeveloper && <p className="text-xs text-muted-foreground">Locked to your account: <span className="font-mono">{username}</span></p>}
                  {!isDeveloper && editProduct && <p className="text-xs text-muted-foreground">Verifier ID cannot be changed after creation.</p>}
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="One-Time Price ($)" error={errors.price_one_time?.message}>
                  <Input {...register('price_one_time')} placeholder="29.99" type="number" step="0.01" />
                </Field>
                <Field label="Currency" error={errors.currency?.message}>
                  <Input {...register('currency')} placeholder="USD" />
                </Field>
                <Field label="Schema Version" error={errors.schema_version?.message}>
                  <Input {...register('schema_version')} placeholder="clear-health/v1" className="font-mono text-sm" />
                </Field>
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Order Form Fields</label>
                  <p className="text-xs text-muted-foreground/70">Fields the professional fills in when placing this order.</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Quick start:</span>
                  {Object.keys(ORDER_TEMPLATES).map(t => (
                    <button key={t} type="button" onClick={() => applyTemplate(t)}
                      className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
                <RawToggle
                  toggleRef={orderToggleRef}
                  onSerialize={() => {
                    const { orderSchema, orderUiSchema } = orderFieldsToSchemas(orderFields)
                    return JSON.stringify({ order_schema: orderSchema, order_ui_schema: orderUiSchema }, null, 2)
                  }}
                  onDeserialize={(raw) => {
                    try {
                      const parsed = JSON.parse(raw)
                      const src = parsed.order_schema ?? parsed
                      const uiSrc = parsed.order_ui_schema ?? {}
                      setOrderFields(schemasToOrderFields(src, uiSrc))
                      return true
                    } catch { return false }
                  }}
                >
                  <OrderSchemaBuilder fields={orderFields} onChange={setOrderFields} />
                </RawToggle>
              </div>
              <div className="space-y-2 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Pricing</label>
                  <p className="text-xs text-muted-foreground/70">Configure Stripe prices for tiers and add-on toggles. Leave blank for free / invoice-only products.</p>
                </div>
                <PricingBuilder
                  orderFields={orderFields}
                  pricing={pricing}
                  addons={addons}
                  onPricingChange={setPricing}
                  onAddonsChange={setAddons}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button type="submit" size="sm" disabled={publishMutation.isPending}>
                  {publishMutation.isPending ? 'Publishing…' : editProduct ? 'Update' : 'Publish'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={cancelForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Package size={14} />
            {isLoading ? 'Loading…' : `${products.length} product${products.length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {!isLoading && products.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No products yet. Click "New Product" to add the first one.</p>
          )}
          {products.map(p => (
            <ProductRow
              key={p.id}
              product={p}
              onEdit={openEdit}
              onDelete={id => IS_PROD ? setPendingDelete(id) : deleteMutation.mutate(id)}
              deleting={deleteMutation.isPending}
            />
          ))}
        </CardContent>
      </Card>
    </div>
    </>
  )
}

function ProductRow({ product, onEdit, onDelete, deleting }: {
  product: ProductEntry
  onEdit: (p: ProductEntry) => void
  onDelete: (id: string) => void
  deleting: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => setOpen(v => !v)} className="flex items-center gap-3 text-left min-w-0">
            {open ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{product.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{product.id}</p>
            </div>
          </button>
          <Badge variant="outline" className="text-xs shrink-0">{product.verifier_name}</Badge>
          {product.price_one_time != null && (
            <Badge variant="secondary" className="text-xs shrink-0">${product.price_one_time.toFixed(2)}</Badge>
          )}
          {!product.active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-2 ml-4">
          {product.published_at && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {format(new Date(product.published_at), 'MMM d, yyyy')}
            </span>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary" onClick={() => onEdit(product)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(product.id!)} disabled={deleting}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {open && (
        <div className="px-12 pb-4 space-y-2 text-xs text-muted-foreground">
          {product.description && <p>{product.description}</p>}
          {product.schema_version && <p>Display schema: <span className="font-mono">{product.schema_version}</span></p>}
          {product.order_schema && (
            <details>
              <summary className="cursor-pointer hover:text-foreground">Order schema</summary>
              <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto">{JSON.stringify(product.order_schema, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ── PricingBuilder ────────────────────────────────────────────────────────────

const INTERVALS = [
  { value: 'month', label: '/month' },
  { value: 'year',  label: '/year'  },
  { value: '',      label: 'one-time' },
]

function PriceRow({
  priceId, amount, interval, currency,
  onPriceId, onAmount, onInterval,
}: {
  priceId: string; amount: number; interval: string; currency: string
  onPriceId: (v: string) => void; onAmount: (v: number) => void; onInterval: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_90px_80px] gap-1.5 items-center">
      <Input value={priceId} onChange={e => onPriceId(e.target.value.trim())} placeholder="price_xxx" className="font-mono text-xs h-7" />
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currency === 'USD' ? '$' : currency}</span>
        <Input
          value={amount > 0 ? (amount / 100).toString() : ''}
          onChange={e => onAmount(Math.round((Number(e.target.value) || 0) * 100))}
          placeholder="0.00" type="number" step="0.01" className="pl-5 text-xs h-7"
        />
      </div>
      <select value={interval} onChange={e => onInterval(e.target.value)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
        {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
      </select>
    </div>
  )
}

interface PricingBuilderProps {
  orderFields: OrderField[]
  pricing: ProductPricing | null
  addons: ProductAddon[]
  onPricingChange: (p: ProductPricing | null) => void
  onAddonsChange: (a: ProductAddon[]) => void
}

function PricingBuilder({ orderFields, pricing, addons, onPricingChange, onAddonsChange }: PricingBuilderProps) {
  const enumFields = orderFields.filter(f => f.type === 'enum' && f.key)
  const boolFields = orderFields.filter(f => f.type === 'boolean' && f.key)
  const currency = 'USD'

  const selectTierField = (fieldKey: string) => {
    if (!fieldKey) { onPricingChange(null); return }
    const field = enumFields.find(f => f.key === fieldKey)
    if (!field) return
    const existingOptions = pricing?.field === fieldKey ? pricing.options : []
    onPricingChange({
      model: 'tiered',
      field: fieldKey,
      options: (field.enumOptions ?? []).map(val => {
        const existing = existingOptions.find(o => o.value === val)
        return existing ?? { value: val, price_id: '', amount: 0, currency: currency.toLowerCase(), interval: 'month' }
      }),
    })
  }

  const updateTierOption = (val: string, patch: Partial<ProductPricing['options'][0]>) => {
    if (!pricing) return
    onPricingChange({
      ...pricing,
      options: pricing.options.map(o => o.value === val ? { ...o, ...patch } : o),
    })
  }

  const toggleAddon = (field: OrderField) => {
    const exists = addons.find(a => a.field === field.key)
    if (exists) {
      onAddonsChange(addons.filter(a => a.field !== field.key))
    } else {
      onAddonsChange([...addons, { field: field.key, label: field.title, price_id: '', amount: 0, currency: currency.toLowerCase(), interval: 'month' }])
    }
  }

  const updateAddon = (fieldKey: string, patch: Partial<ProductAddon>) => {
    onAddonsChange(addons.map(a => a.field === fieldKey ? { ...a, ...patch } : a))
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-3 bg-muted/20">
      {/* Tiered pricing */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium">Subscription Tier</p>
          <select
            value={pricing?.field ?? ''}
            onChange={e => selectTierField(e.target.value)}
            className="h-6 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">— none —</option>
            {enumFields.map(f => <option key={f.key} value={f.key}>{f.title || f.key}</option>)}
          </select>
        </div>
        {pricing && (
          <div className="space-y-1.5 pl-2 border-l-2 border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_90px_80px] gap-1.5 mb-0.5">
              <p className="text-xs text-muted-foreground">Option</p>
              <p className="text-xs text-muted-foreground">Stripe Price ID</p>
              <p className="text-xs text-muted-foreground">Amount</p>
            </div>
            {pricing.options.map(opt => (
              <div key={opt.value} className="space-y-1">
                <p className="text-xs text-muted-foreground truncate" title={opt.value}>{opt.value}</p>
                <PriceRow
                  priceId={opt.price_id} amount={opt.amount} interval={opt.interval} currency={currency}
                  onPriceId={v => updateTierOption(opt.value, { price_id: v })}
                  onAmount={v => updateTierOption(opt.value, { amount: v })}
                  onInterval={v => updateTierOption(opt.value, { interval: v })}
                />
              </div>
            ))}
          </div>
        )}
        {enumFields.length === 0 && <p className="text-xs text-muted-foreground italic">Add a Dropdown field to the order form to enable tiered pricing.</p>}
      </div>

      {/* Add-on toggles */}
      {boolFields.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium">Add-on Toggles</p>
          <div className="space-y-2">
            {boolFields.map(f => {
              const addon = addons.find(a => a.field === f.key)
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={!!addon} onChange={() => toggleAddon(f)}
                      className="h-3.5 w-3.5 rounded border-border" id={`addon-${f.key}`} />
                    <label htmlFor={`addon-${f.key}`} className="text-xs cursor-pointer">{f.title || f.key}</label>
                  </div>
                  {addon && (
                    <div className="pl-5">
                      <PriceRow
                        priceId={addon.price_id} amount={addon.amount} interval={addon.interval} currency={currency}
                        onPriceId={v => updateAddon(f.key, { price_id: v })}
                        onAmount={v => updateAddon(f.key, { amount: v })}
                        onInterval={v => updateAddon(f.key, { interval: v })}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
