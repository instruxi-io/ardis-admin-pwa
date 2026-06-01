import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import type { UserListItem, AdminSession } from '@/types/enforcer/admin'
import type { PaginatedResponse, BaseResponse } from '@/types/enforcer/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ArrowLeft, UserCheck, UserX, ShieldCheck } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const userQuery = useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: () =>
      getEnforcerApiClient().get<{ success: boolean; data: UserListItem }>(`admin/users/${id}`),
    enabled: !!id,
  })

  const sessionsQuery = useQuery({
    queryKey: ['admin', 'users', id, 'sessions'],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<AdminSession>>(
        `admin/users/${id}/sessions`,
        { limit: 10 } as Record<string, unknown>
      ),
    enabled: !!id,
  })

  const activateMutation = useMutation({
    mutationFn: () => getEnforcerApiClient().put<BaseResponse>(`admin/users/${id}/activate`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'users', id] }); toast.success('User activated') },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const deactivateMutation = useMutation({
    mutationFn: () => getEnforcerApiClient().put<BaseResponse>(`admin/users/${id}/deactivate`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'users', id] }); toast.success('User deactivated') },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const verifyContactMutation = useMutation({
    mutationFn: () =>
      getEnforcerApiClient().post<BaseResponse>('admin/users/verify-contact', {
        user_id: id,
        email_verified: true,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'users', id] }); toast.success('Email marked as verified') },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const user = userQuery.data?.data
  const statusColor: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    active: 'success', verified: 'success', pending: 'warning',
    expired: 'secondary', revoked: 'secondary', failed: 'destructive',
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/users')}>
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">
            {user ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.email || 'User' : 'Loading…'}
          </h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {user && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Account Details</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Row label="User ID" value={user.id} mono />
                <Row label="Email" value={user.email ?? '—'} />
                <Row label="Username" value={user.username ?? '—'} />
                <Row label="Phone" value={user.phone_number ?? '—'} />
                <Row label="Wallet" value={user.account_address ?? user.wallet_address ?? '—'} mono />
                <Row label="Role" value={<span className="capitalize">{user.role ?? 'user'}</span>} />
                <Row label="Status" value={<Badge variant={user.active ? 'success' : 'secondary'}>{user.active ? 'Active' : 'Inactive'}</Badge>} />
                <Row label="Email Verified" value={<Badge variant={user.email_verified ? 'success' : 'secondary'}>{user.email_verified ? 'Yes' : 'No'}</Badge>} />
                <Row label="KYC" value={<Badge variant={user.kyc_verified ? 'success' : 'secondary'}>{user.kyc_verified ? 'Verified' : 'Unverified'}</Badge>} />
                {user.kyc_expires_at && <Row label="KYC Expires" value={user.kyc_expires_at} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Recent Sessions</CardTitle></CardHeader>
              <CardContent className="p-0">
                {sessionsQuery.data?.data.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No sessions</p>
                )}
                {sessionsQuery.data?.data.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-6 py-3 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium">{s.session_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant={statusColor[s.status] ?? 'secondary'}>{s.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {user.active ? (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-destructive hover:text-destructive" onClick={() => deactivateMutation.mutate()} disabled={deactivateMutation.isPending}>
                    <UserX size={14} /> Deactivate user
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending}>
                    <UserCheck size={14} /> Activate user
                  </Button>
                )}
                {!user.email_verified && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => verifyContactMutation.mutate()} disabled={verifyContactMutation.isPending}>
                    <ShieldCheck size={14} /> Mark email verified
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={mono ? 'font-mono text-xs break-all text-right' : 'text-right'}>{value}</span>
    </div>
  )
}
