import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import type { AdminTerm, CreateTermRequest } from '@/types/enforcer/admin'
import type { PaginatedResponse, BaseResponse } from '@/types/enforcer/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Plus, Trash2, FileText, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const createSchema = z.object({
  type: z.string().min(1),
  version: z.string().min(1),
  content: z.string().min(1),
})
type CreateForm = z.infer<typeof createSchema>

export default function TermsPage() {
  const { activeTenantId } = useAuth()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'terms', activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<AdminTerm>>('admin/terms', { limit: 100 }),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
  })

  const createMutation = useMutation({
    mutationFn: (body: CreateTermRequest) =>
      getEnforcerApiClient().post<BaseResponse>('admin/terms', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'terms'] })
      toast.success('Term created')
      reset()
      setShowCreate(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      getEnforcerApiClient().delete<BaseResponse>(`admin/terms/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'terms'] })
      toast.success('Term deleted')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data ? `${data.total} terms documents` : 'Loading…'}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <X size={14} /> : <Plus size={14} />}
          {showCreate ? 'Cancel' : 'New term'}
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">Create term</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => createMutation.mutate(v))} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Input placeholder="Type (e.g. tos, privacy_policy)" {...register('type')} />
                  {errors.type && <p className="text-xs text-destructive mt-1">{errors.type.message}</p>}
                </div>
                <div>
                  <Input placeholder="Version (e.g. 1.0)" {...register('version')} />
                  {errors.version && <p className="text-xs text-destructive mt-1">{errors.version.message}</p>}
                </div>
              </div>
              <div>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Terms content…"
                  {...register('content')}
                />
                {errors.content && <p className="text-xs text-destructive mt-1">{errors.content.message}</p>}
              </div>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-3">
        {data?.data.map((term) => (
          <Card key={term.id}>
            <CardHeader className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                    <FileText size={15} className="text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium capitalize">{term.type.replace(/_/g, ' ')}</span>
                      <Badge variant="secondary">v{term.version}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDistanceToNow(new Date(term.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(term.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground line-clamp-3">{term.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data?.data.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">No terms documents yet</div>
      )}
    </div>
  )
}
