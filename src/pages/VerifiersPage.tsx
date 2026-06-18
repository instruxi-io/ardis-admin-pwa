import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Shield, X, UserX, UserCheck } from 'lucide-react'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { env } from '@/config/env'

// Well-known role IDs — sequential UUIDs assigned by Enforcer at setup.
const DEVELOPER_ROLE_ID = '00000000-0000-0000-0000-000000000004'
const IS_PROD = env.APP_ENV === 'production'

interface Verifier {
  user_id: string
  email?: string
  username?: string
  first_name?: string
  last_name?: string
  active?: boolean
  role?: string
  created_at?: string
}

const onboardSchema = z.object({
  email: z.string().email('Valid email required'),
  verifier_id: z.string()
    .min(2, 'Required')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens only'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
})

type OnboardValues = z.infer<typeof onboardSchema>

export default function VerifiersPage() {
  const [showForm, setShowForm] = useState(false)
  const queryClient = useQueryClient()

  const { activeTenantId } = useAuth()

  const { data: verifiers = [], isLoading } = useQuery<Verifier[]>({
    queryKey: ['tenant-members-verifiers', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return []
      const res = await getEnforcerApiClient().get<{ data: Verifier[] }>(
        `admin/tenants/${activeTenantId}/members`,
        { limit: 200 }
      )
      return (res.data ?? []).filter(v => v.role?.toLowerCase() === 'developer')
    },
    refetchOnMount: true,
  })

  const isReady = true

  const { register, handleSubmit, reset, formState: { errors } } = useForm<OnboardValues>({
    resolver: zodResolver(onboardSchema),
  })

  const onboardMutation = useMutation({
    mutationFn: async (values: OnboardValues) => {
      // Create the user with Developer role and their verifier_id as username.
      await getEnforcerApiClient().post('admin/users', {
        email: values.email,
        username: values.verifier_id,
        first_name: values.first_name || undefined,
        last_name: values.last_name || undefined,
        role_id: DEVELOPER_ROLE_ID,
        active: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifiers'] })
      toast.success('Verifier onboarded — they can now log in and publish products/schemas.')
      setShowForm(false)
      reset()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Onboarding failed'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => getEnforcerApiClient().patch(`admin/users/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifiers', activeTenantId] })
      toast.success('Verifier deactivated')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => getEnforcerApiClient().patch(`admin/users/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifiers', activeTenantId] })
      toast.success('Verifier activated')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Verifiers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Verification Providers authorised to publish products and write credentials.
          </p>
        </div>
        <Button size="sm" onClick={() => showForm ? (setShowForm(false), reset()) : setShowForm(true)}>
          {showForm ? <><X size={14} className="mr-1.5" />Cancel</> : <><Plus size={14} className="mr-1.5" />Onboard VP</>}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Onboard New Verification Provider</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => {
              if (IS_PROD) {
                if (!confirm(`Onboard verifier "${v.verifier_id}" in production?`)) return
              }
              onboardMutation.mutate(v)
            })} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Verifier ID</label>
                  <Input
                    {...register('verifier_id')}
                    placeholder="ardis"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground/70">
                    Permanent — must match the verifier_id in their products and schemas.
                  </p>
                  {errors.verifier_id && <p className="text-xs text-destructive">{errors.verifier_id.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Email</label>
                  <Input {...register('email')} placeholder="vp@example.com" />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">First Name (optional)</label>
                  <Input {...register('first_name')} placeholder="Jane" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Last Name (optional)</label>
                  <Input {...register('last_name')} placeholder="Smith" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                The VP will receive an activation email. Once activated they can log in, publish products under their verifier_id, and upload credentials via the fulfillment API.
              </p>
              <Button type="submit" size="sm" disabled={onboardMutation.isPending}>
                {onboardMutation.isPending ? 'Onboarding…' : 'Onboard Verifier'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Shield size={14} />
            {(!isReady || isLoading) ? 'Loading…' : `${verifiers.length} verifier${verifiers.length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(!isReady || isLoading) && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {isReady && !isLoading && verifiers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No verifiers yet. Click "Onboard VP" to add the first one.
            </p>
          )}
          {verifiers.map(v => (
            <div key={v.user_id} className="flex items-center justify-between px-6 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-medium">{v.username ?? '—'}</p>
                    <Badge
                      variant="outline"
                      className={v.active !== false ? 'border-green-500 text-green-500 text-xs' : 'text-xs'}
                    >
                      {v.active !== false ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {[v.first_name, v.last_name].filter(Boolean).join(' ') || v.email || v.user_id}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                {v.active !== false ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                    onClick={() => {
                      if (IS_PROD && !confirm(`Deactivate verifier "${v.username}"?`)) return
                      deactivateMutation.mutate(v.user_id)
                    }}
                    disabled={deactivateMutation.isPending}
                  >
                    <UserX size={13} className="mr-1" />
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-primary h-7 px-2 text-xs"
                    onClick={() => activateMutation.mutate(v.user_id)}
                    disabled={activateMutation.isPending}
                  >
                    <UserCheck size={13} className="mr-1" />
                    Activate
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
