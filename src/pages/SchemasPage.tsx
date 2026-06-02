import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Database, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { schemasApi, type PublishSchemaPayload } from '@/lib/ardisMsClient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import {
  DisplaySchemaBuilder, RawToggle,
  type DisplayField, type DisplayGroup,
  displayFieldsToSchemas, schemasToDisplayFields,
  DISPLAY_TEMPLATES,
} from '@/components/ui/schema-builder'

// ── Form schema ───────────────────────────────────────────────────────────────

const publishSchema = z.object({
  verifier_id: z.string().min(1, 'Required').regex(/^[a-z0-9-]+$/, 'Lowercase, numbers, hyphens only'),
  version: z.string().min(1, 'Required').regex(/^v\d+$/, 'Must be vN (e.g. v1, v2)'),
})

type PublishFormValues = z.infer<typeof publishSchema>

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchemasPage() {
  const [showForm, setShowForm] = useState(false)
  const [displayFields, setDisplayFields] = useState<DisplayField[]>([])
  const [displayGroups, setDisplayGroups] = useState<DisplayGroup[]>([])
  const queryClient = useQueryClient()

  const { data: schemas = [], isLoading } = useQuery({
    queryKey: ['schemas'],
    queryFn: schemasApi.list,
  })

  const publishMutation = useMutation({
    mutationFn: (payload: PublishSchemaPayload) => schemasApi.publish(payload),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ['schemas'] })
      toast.success(`Published ${entry.verifier_id}/${entry.version}`)
      setShowForm(false)
      setDisplayFields([])
      setDisplayGroups([])
      reset()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PublishFormValues>({
    resolver: zodResolver(publishSchema),
  })

  const applyTemplate = (name: string) => {
    const t = DISPLAY_TEMPLATES[name]
    if (t) { setDisplayFields(t.fields); setDisplayGroups(t.groups) }
  }

  const onSubmit = (values: PublishFormValues) => {
    let dataSchema: Record<string, unknown>
    let uiSchema: Record<string, unknown>
    try {
      if (displayFields.some(f => f.key)) {
        const built = displayFieldsToSchemas(displayFields, displayGroups)
        dataSchema = built.dataSchema
        uiSchema = built.uiSchema
      } else {
        dataSchema = {}
        uiSchema = {}
      }
    } catch {
      toast.error('Schema JSON is invalid')
      return
    }
    publishMutation.mutate({
      verifier_id: values.verifier_id,
      version: values.version,
      data_schema: dataSchema,
      ui_schema: uiSchema,
    })
  }

  // Group schemas by verifier_id
  const grouped = schemas.reduce<Record<string, typeof schemas>>((acc, s) => {
    if (!acc[s.verifier_id]) acc[s.verifier_id] = []
    acc[s.verifier_id].push(s)
    return acc
  }, {})

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">View-Model Schemas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Versioned display schemas for each verification provider — stored in Storj, served publicly.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} size="sm">
          {showForm ? <ChevronUp size={14} className="mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
          {showForm ? 'Cancel' : 'Publish Schema'}
        </Button>
      </div>

      {/* Publish form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Publish New Schema Version</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Verifier ID</label>
                  <Input
                    {...register('verifier_id')}
                    placeholder="clear-health"
                    className="font-mono text-sm"
                  />
                  {errors.verifier_id && (
                    <p className="text-xs text-destructive">{errors.verifier_id.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Version</label>
                  <Input
                    {...register('version')}
                    placeholder="v1"
                    className="font-mono text-sm"
                  />
                  {errors.version && (
                    <p className="text-xs text-destructive">{errors.version.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Display Fields &amp; Groups</label>
                  <p className="text-xs text-muted-foreground/70">Define how the fulfilled credential renders in the vault.</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Quick start:</span>
                  {Object.keys(DISPLAY_TEMPLATES).map(t => (
                    <button key={t} type="button" onClick={() => applyTemplate(t)}
                      className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
                <RawToggle
                  onSerialize={() => {
                    const { dataSchema, uiSchema } = displayFieldsToSchemas(displayFields, displayGroups)
                    return JSON.stringify({ data_schema: dataSchema, ui_schema: uiSchema }, null, 2)
                  }}
                  onDeserialize={(raw) => {
                    try {
                      const parsed = JSON.parse(raw)
                      const { fields, groups } = schemasToDisplayFields(
                        parsed.data_schema ?? parsed,
                        parsed.ui_schema ?? {}
                      )
                      setDisplayFields(fields)
                      setDisplayGroups(groups)
                      return true
                    } catch { return false }
                  }}
                >
                  <DisplaySchemaBuilder
                    fields={displayFields}
                    groups={displayGroups}
                    onFieldsChange={setDisplayFields}
                    onGroupsChange={setDisplayGroups}
                  />
                </RawToggle>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" size="sm" disabled={publishMutation.isPending}>
                  {publishMutation.isPending ? 'Publishing…' : 'Publish'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Uploads to Storj as <span className="font-mono">view-models/{'{'}verifier_id{'}'}/{'{'}version{'}'}/schema.json</span> and promotes to <span className="font-mono">/latest</span>.
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Schema registry */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Database size={14} />
            {isLoading ? 'Loading…' : `${schemas.length} published version${schemas.length !== 1 ? 's' : ''} across ${Object.keys(grouped).length} verifier${Object.keys(grouped).length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
          )}
          {!isLoading && schemas.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No schemas published yet. Click "Publish Schema" to add the first one.
            </p>
          )}
          {Object.entries(grouped).map(([verifierId, versions]) => (
            <VerifierGroup
              key={verifierId}
              verifierId={verifierId}
              versions={[...versions].sort((a, b) => b.version.localeCompare(a.version))}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Verifier group ────────────────────────────────────────────────────────────

function VerifierGroup({
  verifierId,
  versions,
}: {
  verifierId: string
  versions: { version: string; published_at: string; published_by: string }[]
}) {
  const [open, setOpen] = useState(true)
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)
  const latestVersion = versions[0]?.version

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium">{verifierId}</span>
          <Badge variant="outline" className="text-xs font-mono">
            latest → {latestVersion}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-xs">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
            {versions.map((v) => (
              <>
                <tr
                  key={v.version}
                  className="border-t border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => setExpandedVersion(expandedVersion === v.version ? null : v.version)}
                >
                  <td className="px-8 py-2.5 font-mono text-sm">{v.version}</td>
                  <td className="px-6 py-2.5 text-sm text-muted-foreground">
                    {format(new Date(v.published_at), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                    {v.published_by || '—'}
                  </td>
                  <td className="px-6 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {v.version === latestVersion && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                          <CheckCircle2 size={12} />
                          latest
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {expandedVersion === v.version ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </span>
                    </div>
                  </td>
                </tr>
                {expandedVersion === v.version && (
                  <tr key={`${v.version}-detail`} className="border-t border-border/50 bg-muted/10">
                    <td colSpan={4} className="px-8 py-4">
                      <SchemaDetail verifierId={verifierId} version={v.version} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Schema detail (fetched on expand) ────────────────────────────────────────

function SchemaDetail({ verifierId, version }: { verifierId: string; version: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schema-detail', verifierId, version],
    queryFn: () => schemasApi.get(verifierId, version),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (error || !data) return <p className="text-xs text-destructive">Failed to load schema</p>

  const props = (data.data_schema?.properties as Record<string, { title?: string; format?: string }>) ?? {}
  const order = (data.ui_schema?.['ui:order'] as string[]) ?? Object.keys(props)
  const groups = (data.ui_schema?.['ui:groups'] as { title: string; fields: string[] }[]) ?? []

  const fieldsByKey: Record<string, { title: string; format?: string }> = {}
  for (const k of order) {
    if (props[k]) fieldsByKey[k] = { title: props[k].title ?? k, format: props[k].format }
  }

  return (
    <div className="space-y-3">
      {groups.length > 0 ? (
        groups.map(g => (
          <div key={g.title}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{g.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.fields.map(k => (
                <FieldChip key={k} label={fieldsByKey[k]?.title ?? k} format={fieldsByKey[k]?.format} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {order.map(k => (
            <FieldChip key={k} label={fieldsByKey[k]?.title ?? k} format={fieldsByKey[k]?.format} />
          ))}
        </div>
      )}
    </div>
  )
}

function FieldChip({ label, format }: { label: string; format?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted border border-border font-mono">
      {label}
      {format && format !== 'text' && (
        <span className="text-muted-foreground/70">{format}</span>
      )}
    </span>
  )
}
