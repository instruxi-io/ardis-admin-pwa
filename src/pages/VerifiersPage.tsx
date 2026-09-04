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
  // The vendor's own name, which is what the group represents. Previously
  // display_name was filled from first_name/last_name for want of anywhere else
  // to get it, so a vendor group ended up named after whoever the contact was.
  company_name: z.string().min(2, 'Required'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
})

type OnboardValues = z.infer<typeof onboardSchema>

export default function VerifiersPage() {
  const [showForm, setShowForm] = useState(false)
  const queryClient = useQueryClient()

  const { activeTenantId, ready } = useAuth()

  const { data: verifiers = [], isLoading, isError, error } = useQuery<Verifier[]>({
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
    // Not retried into silence: if this fails the page must say so.
    retry: 1,
  })


  const { register, handleSubmit, reset, formState: { errors } } = useForm<OnboardValues>({
    resolver: zodResolver(onboardSchema),
  })

  const onboardMutation = useMutation({
    // Four sequential writes with no transaction across them. There is no
    // rollback available — Enforcer has no compound endpoint for this — so the
    // steps are ordered cheapest-to-undo first and every failure names exactly
    // what already exists. Silence here is how the tenant ends up with a group
    // that has no metadata and no members: invisible to FindVendorGroup, which
    // matches on verifier_id, and so invisible to everything downstream.
    mutationFn: async (values: OnboardValues) => {
      if (!activeTenantId) throw new Error('No active tenant selected')
      const client = getEnforcerApiClient()
      const done: string[] = []
      const failed = (step: string, e: unknown): never => {
        const why = e instanceof Error ? e.message : String(e)
        const already = done.length
          ? ` Already created: ${done.join(', ')} — finish or remove these before retrying.`
          : ''
        throw new Error(`${step} failed: ${why}.${already}`)
      }

      // 0. Refuse a verifier_id that is already claimed. Two groups carrying the
      // same one makes identity depend on which FindVendorGroup happens to
      // return first, so this must be checked before anything is created.
      try {
        const existing = await client.get<{ data: { metadata?: Record<string, unknown> }[] }>(
          'admin/groups', { limit: 500 })
        const clash = (existing.data ?? []).some(
          g => (g.metadata ?? {}).verifier_id === values.verifier_id)
        if (clash) {
          throw new Error(`verifier_id "${values.verifier_id}" already belongs to a group`)
        }
      } catch (e) {
        // A genuine clash must stop; an unreadable list must also stop, because
        // creating a duplicate is worse than refusing to proceed.
        failed('Checking whether the verifier_id is free', e)
      }

      // 1. The developer account. Username is a human handle and deliberately
      // NOT the verifier_id: those are different things, they diverge in
      // practice (ardis-vp holds verifier_id ardis), and conflating them is what
      // hid a vendor's own catalogue from them.
      let userId = ''
      try {
        const res = await client.post<{ data: { id: string } }>('admin/users', {
          email: values.email,
          username: values.verifier_id,
          first_name: values.first_name || undefined,
          last_name: values.last_name || undefined,
          role_id: DEVELOPER_ROLE_ID,
          active: true,
        })
        userId = res.data.id
        done.push(`user ${values.email}`)
      } catch (e) {
        failed('Creating the developer account', e)
      }

      // 2. The vendor's group. verifier_id lives in the METADATA, not the slug,
      // which Enforcer derives from the name and will not let us set. Named for
      // the company so it reads like the groups already in the tenant.
      let groupId = ''
      try {
        const res = await client.post<{ data: { id: string } }>('admin/groups', {
          name: values.company_name,
          description: `Vendor group for verifier_id "${values.verifier_id}"`,
          tenant_id: activeTenantId,
        })
        groupId = res.data.id
        done.push(`group "${values.company_name}"`)
      } catch (e) {
        failed('Creating the vendor group', e)
      }

      // 3. The identity itself. Until this lands the group is inert: membership
      // authorises nothing, because what is read is the verifier_id on it.
      try {
        await client.patch(`admin/groups/${groupId}/metadata`, {
          add: {
            verifier_id: values.verifier_id,
            status: 'active',
            display_name: values.company_name,
          },
        })
        done.push('group metadata')
      } catch (e) {
        failed('Stamping verifier_id onto the group', e)
      }

      // 4. Membership, which is what ties the developer to the verifier_id.
      try {
        await client.post(`admin/groups/${groupId}/users`, {
          group_id: groupId,
          user_id: userId,
        })
      } catch (e) {
        failed('Adding the developer to the vendor group', e)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-members-verifiers', activeTenantId] })
      toast.success('Verifier onboarded — user and vendor group created; they can log in and publish under their verifier_id.')
      setShowForm(false)
      reset()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Onboarding failed'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => getEnforcerApiClient().patch(`admin/users/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-members-verifiers', activeTenantId] })
      toast.success('Verifier deactivated')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => getEnforcerApiClient().patch(`admin/users/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-members-verifiers', activeTenantId] })
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
                    Permanent. Goes in their group metadata, and every product and
                    schema they publish must carry it as x-verifier-id. Not their
                    username: those diverge in practice.
                  </p>
                  {errors.verifier_id && <p className="text-xs text-destructive">{errors.verifier_id.message}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Company name</label>
                  <Input {...register('company_name')} placeholder="Ardis Data" />
                  <p className="text-xs text-muted-foreground/70">
                    Names the vendor group and shows as the issuer on credentials.
                  </p>
                  {errors.company_name && <p className="text-xs text-destructive">{errors.company_name.message}</p>}
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
            {(!ready || isLoading) ? 'Loading…' : `${verifiers.length} verifier${verifiers.length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(!ready || isLoading) && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {isError && (
            <div className="mx-6 my-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
              <p className="text-xs font-semibold text-destructive">Could not load from Enforcer</p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Tenant {activeTenantId ?? 'not resolved'}
              </p>
            </div>
          )}
          {ready && !isLoading && !isError && verifiers.length === 0 && (
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
