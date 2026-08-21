/**
 * One credential type: its published versions, the products that render with
 * them, drift against what the vendor actually sends, and version history.
 */

import type { ReactNode } from 'react'
import { pinAuthoredOrder } from '@/lib/catalogue/uiOrderInjection'
import type { ProductEntry, SchemaDriftRecord, SchemaIndexEntry } from '@/lib/ardisMsClient'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Database, Eye, Package, Upload, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Component, useState } from 'react'
import { CredentialPreview } from '@/components/ui/schema-preview'
import { format } from 'date-fns'
import { schemasApi } from '@/lib/ardisMsClient'

export class PreviewErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { error: string | null }
> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  // Nothing to report: the boundary exists so a malformed schema shows a
  // message instead of blanking the page.
  componentDidCatch() {}
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

// One calm sentence by default; the field-level detail lives behind Details.
// The vendor needs to know THAT display can be improved and how to fix it,
// not to be met with a wall of field paths (which stays one click away for
// whoever wants to act on it).
function DriftNotice({ d }: { d: SchemaDriftRecord }) {
  const [open, setOpen] = useState(false)
  const never = d.unused_fields.length
  const extra = d.undeclared_fields.length
  const summary = [
    never ? `${never} promised field${never === 1 ? '' : 's'} never arrive${never === 1 ? 's' : ''} in real results` : '',
    extra ? `${extra} arriving field${extra === 1 ? '' : 's'} ${extra === 1 ? 'is' : 'are'} not described yet` : '',
  ].filter(Boolean).join(' and ')

  return (
    <div className="mx-6 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <AlertCircle size={13} className="text-amber-500 shrink-0" />
        <span className="text-xs font-semibold text-amber-600">
          This credential's display can be improved
        </span>
        <span className="text-[11px] text-muted-foreground flex-1">
          {summary}. Only how cards display is affected.
        </span>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="text-[11px] text-amber-600 hover:text-amber-500 transition-colors shrink-0 inline-flex items-center gap-1"
        >
          {open ? 'Hide details' : 'Details'}
          <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>
      {open && (
        <>
          <p className="text-[11px] text-muted-foreground">
            Noticed {d.reports} {d.reports === 1 ? 'time' : 'times'}, most recently{' '}
            {format(new Date(d.last_seen), 'MMM d, HH:mm')}. Only field names are compared,
            never the data inside a credential.
          </p>
          {d.unused_fields.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">
                Declared in the schema but never arrives, or always empty:
              </p>
              <div className="flex flex-wrap gap-1">
                {d.unused_fields.map(f => (
                  <span key={f} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{f}</span>
                ))}
              </div>
            </div>
          )}
          {d.undeclared_fields.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">
                Arrives in results but not described, so cards guess the label from the field name:
              </p>
              <div className="flex flex-wrap gap-1">
                {d.undeclared_fields.map(f => (
                  <span key={f} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">{f}</span>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            To fix: use New Version on the row below, adjust the fields to match what you
            really send, and publish. Cards already issued pick up the improved display
            automatically.
          </p>
        </>
      )}
    </div>
  )
}

export function SchemaGroup({ verifierId, credentialType, versions, products, drift, isPlatform, onArchive, onDownload, onNewVersion, onStartProduct, onEditProduct }: {
  verifierId: string
  credentialType: string
  versions: SchemaIndexEntry[]
  // Every product that renders with this schema. More than one is normal now that
  // the halves are separate files: a free check and a paid check can share one.
  products: ProductEntry[]
  // Keyed verifier/type/version. A schema's live version is the one that matters,
  // but an older version can drift too if credentials issued against it are still
  // being opened.
  drift?: Record<string, SchemaDriftRecord>
  isPlatform?: boolean
  onArchive?: (id: string) => void
  onDownload?: (verifierId: string, credentialType: string, version: string, name: string) => void
  onNewVersion?: (verifierId: string, credentialType: string, version: string, name: string) => void
  onStartProduct?: (verifierId: string, credentialType: string) => void
  // Loads this product's order form into the editor. The order form is the
  // product's, not the schema's, and this is the only button that edits it.
  onEditProduct?: (product: ProductEntry) => void
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
              {onEditProduct && (
                <button
                  type="button"
                  onClick={() => onEditProduct(p)}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
                  title="Load this product's order form into the editor"
                >
                  Edit order form
                </button>
              )}
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

      {/* ── Drift ──
          The only signal that a schema has stopped describing what the vendor
          sends. Nothing else in the system compares the two: a product's publish
          checks the schema exists, and an arriving credential picks its schema by
          the version it carries, but neither asks whether they agree. */}
      {live && (() => {
        const d = drift?.[`${verifierId}/${credentialType}/${live.version}`]
          ?? drift?.[`${verifierId}/${credentialType}/latest`]
        if (!d) return null
        return <DriftNotice d={d} />
      })()}

      {/* A schema nothing sells is not an error — it may be published ahead of
          its product — but it should be visible rather than looking published
          and in use. */}
      {products.length === 0 && (
        <div className="mx-6 mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2 flex items-center justify-between gap-4">
          <p className="text-xs text-amber-600">
            Published, but nothing sells it yet. One product file away from being orderable in the app.
          </p>
          {onStartProduct && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
              onClick={() => onStartProduct(verifierId, credentialType)}
            >
              Start the product file
            </Button>
          )}
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
                title="Create a new version of this credential schema"
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
              uiSchema={pinAuthoredOrder(previewSchema.data_schema, previewSchema.ui_schema)}
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
