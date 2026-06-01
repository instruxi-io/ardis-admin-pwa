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

// ── Form schema ───────────────────────────────────────────────────────────────

const publishSchema = z.object({
  verifier_id: z.string().min(1, 'Required').regex(/^[a-z0-9-]+$/, 'Lowercase, numbers, hyphens only'),
  version: z.string().min(1, 'Required').regex(/^v\d+$/, 'Must be vN (e.g. v1, v2)'),
  data_schema: z.string().min(2, 'Required').refine((v) => {
    try { JSON.parse(v); return true } catch { return false }
  }, 'Must be valid JSON'),
  ui_schema: z.string().refine((v) => {
    if (!v.trim()) return true
    try { JSON.parse(v); return true } catch { return false }
  }, 'Must be valid JSON or empty'),
})

type PublishFormValues = z.infer<typeof publishSchema>

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchemasPage() {
  const [showForm, setShowForm] = useState(false)
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
      reset()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PublishFormValues>({
    resolver: zodResolver(publishSchema),
    defaultValues: { ui_schema: '{}' },
  })

  const onSubmit = (values: PublishFormValues) => {
    publishMutation.mutate({
      verifier_id: values.verifier_id,
      version: values.version,
      data_schema: JSON.parse(values.data_schema),
      ui_schema: values.ui_schema.trim() ? JSON.parse(values.ui_schema) : {},
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

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Data Schema <span className="text-muted-foreground/60">(JSON Schema — field types, rules)</span>
                </label>
                <textarea
                  {...register('data_schema')}
                  rows={8}
                  placeholder='{"type":"object","properties":{"license_number":{"type":"string","title":"License Number"}}}'
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {errors.data_schema && (
                  <p className="text-xs text-destructive">{errors.data_schema.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  UI Schema <span className="text-muted-foreground/60">(optional — field order, labels, widgets)</span>
                </label>
                <textarea
                  {...register('ui_schema')}
                  rows={4}
                  placeholder='{}'
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {errors.ui_schema && (
                  <p className="text-xs text-destructive">{errors.ui_schema.message}</p>
                )}
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
              <tr key={v.version} className="border-t border-border/50">
                <td className="px-8 py-2.5 font-mono text-sm">{v.version}</td>
                <td className="px-6 py-2.5 text-sm text-muted-foreground">
                  {format(new Date(v.published_at), 'MMM d, yyyy HH:mm')}
                </td>
                <td className="px-6 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                  {v.published_by || '—'}
                </td>
                <td className="px-6 py-2.5 text-right">
                  {v.version === latestVersion && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                      <CheckCircle2 size={12} />
                      latest
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
