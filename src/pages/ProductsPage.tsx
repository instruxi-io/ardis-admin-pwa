import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Package, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { productsApi, type ProductEntry } from '@/lib/ardisMsClient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PublishConfirmModal } from '@/components/ui/publish-confirm-modal'
import { env } from '@/config/env'

const IS_PROD = env.APP_ENV === 'production'

// Products are managed in Stripe (source of truth for name, pricing, active state)
// and schemas live in Storj. Use the Catalogue page to publish a product.
// This page shows the live Stripe product list with archive controls.

export default function ProductsPage() {
  const queryClient = useQueryClient()
  const [pendingArchive, setPendingArchive] = useState<string | null>(null)

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: productsApi.list,
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Product archived in Stripe')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Archive failed'),
  })

  return (
    <>
      <PublishConfirmModal
        open={!!pendingArchive}
        action="Archive"
        confirmText={pendingArchive ?? ''}
        description={`Archiving product "${pendingArchive}" in Stripe. It will no longer appear in the app catalogue.`}
        onConfirm={() => { if (pendingArchive) { archiveMutation.mutate(pendingArchive); setPendingArchive(null) } }}
        onCancel={() => setPendingArchive(null)}
      />

      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Products</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live product catalogue from Stripe. To add a new product, import a bundle on the{' '}
              <a href="/schemas" className="text-primary hover:underline">Catalogue</a> page.
            </p>
          </div>
          <a
            href="https://dashboard.stripe.com/products"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink size={12} />
            Stripe Dashboard
          </a>
        </div>

        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package size={14} />
              {isLoading ? 'Loading…' : `${products.length} active product${products.length !== 1 ? 's' : ''}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <p className="text-sm text-muted-foreground text-center py-8">Loading from Stripe…</p>
            )}
            {!isLoading && products.length === 0 && (
              <div className="text-center py-10 space-y-2">
                <p className="text-sm text-muted-foreground">No active products.</p>
                <p className="text-xs text-muted-foreground">
                  Import a JSON bundle on the{' '}
                  <a href="/schemas" className="text-primary hover:underline">Catalogue</a> page to publish your first product.
                </p>
              </div>
            )}
            {products.map(p => (
              <ProductRow
                key={p.id}
                product={p}
                onArchive={id => IS_PROD ? setPendingArchive(id) : archiveMutation.mutate(id)}
                archiving={archiveMutation.isPending}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ProductRow({ product, onArchive, archiving }: {
  product: ProductEntry
  onArchive: (id: string) => void
  archiving: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors">
        <button onClick={() => setOpen(v => !v)} className="flex items-center gap-3 text-left min-w-0 flex-1">
          {open ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{product.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{product.id}</p>
          </div>
          {product.verifier_name && (
            <Badge variant="outline" className="text-xs shrink-0">{product.verifier_name}</Badge>
          )}
          {product.verifier_id && (
            <Badge variant="secondary" className="text-xs font-mono shrink-0">{product.verifier_id}</Badge>
          )}
          {!product.active && (
            <Badge variant="destructive" className="text-xs shrink-0">Archived</Badge>
          )}
        </button>
        <div className="flex items-center gap-3 ml-4 shrink-0">
          {product.price_one_time != null && (
            <span className="text-xs text-muted-foreground">${product.price_one_time.toFixed(2)}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onArchive(product.id!)}
            disabled={archiving}
          >
            Archive
          </Button>
        </div>
      </div>

      {open && (
        <div className="px-12 pb-4 space-y-3 text-xs text-muted-foreground border-t border-border/50 bg-muted/10">
          {product.description && (
            <p className="pt-3">{product.description}</p>
          )}
          <div className="grid grid-cols-3 gap-4 pt-1">
            {product.credential_type && (
              <div>
                <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Credential type</span>
                <p className="font-mono mt-0.5">{product.credential_type}</p>
              </div>
            )}
            {product.order_type && (
              <div>
                <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Order type</span>
                <p className="font-mono mt-0.5">{product.order_type}</p>
              </div>
            )}
            {product.display_schema_path && (
              <div>
                <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Display schema</span>
                <p className="font-mono mt-0.5 truncate">{product.display_schema_path}</p>
              </div>
            )}
          </div>
          {product.order_schema && (
            <details className="pt-1">
              <summary className="cursor-pointer hover:text-foreground">Order schema fields</summary>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Object.entries((product.order_schema as any)?.properties ?? {}).map(([k, v]: [string, any]) => (
                  <span key={k} className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted border border-border font-mono text-[10px]">
                    {v.title ?? k}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
