import { useQuery } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import type { PaginatedResponse } from '@/types/enforcer/common'
import type { UserListItem, AdminSession } from '@/types/enforcer/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, ShieldCheck, ScrollText, Activity } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

function StatCard({ title, value, icon: Icon, sub }: { title: string; value: string | number; icon: React.ElementType; sub?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon size={16} className="text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { activeTenantId } = useAuth()

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', 'summary', activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<UserListItem>>('/api/v1/enforcer/admin/users', { limit: 1 }),
    refetchInterval: 60_000,
  })

  const activeUsersQuery = useQuery({
    queryKey: ['admin', 'users', 'active', activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<UserListItem>>('/api/v1/enforcer/admin/users', { limit: 1 }),
    refetchInterval: 60_000,
  })

  const sessionsQuery = useQuery({
    queryKey: ['admin', 'sessions', 'recent', activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<AdminSession>>('/api/v1/enforcer/admin/sessions', {
        limit: 10,
        offset: 0,
      }),
    refetchInterval: 30_000,
  })

  const statusColor: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    active: 'success',
    verified: 'success',
    pending: 'warning',
    expired: 'secondary',
    revoked: 'secondary',
    failed: 'destructive',
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Users"
          value={usersQuery.data?.total ?? '—'}
          icon={Users}
          sub="Registered accounts"
        />
        <StatCard
          title="Active Sessions"
          value={sessionsQuery.data?.data.filter((s) => s.status === 'active').length ?? '—'}
          icon={Activity}
          sub="Currently active"
        />
        <StatCard
          title="Pending Sessions"
          value={sessionsQuery.data?.data.filter((s) => s.status === 'pending').length ?? '—'}
          icon={ShieldCheck}
          sub="Awaiting verification"
        />
        <StatCard
          title="Recent Activity"
          value={sessionsQuery.data?.total ?? '—'}
          icon={ScrollText}
          sub="Total sessions"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsQuery.isLoading && (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          )}
          {sessionsQuery.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No sessions found</p>
          )}
          <div className="space-y-2">
            {sessionsQuery.data?.data.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{session.session_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(session.created_at), { addSuffix: true })}
                  </p>
                </div>
                <Badge variant={statusColor[session.status] ?? 'secondary'}>
                  {session.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {activeUsersQuery.isLoading === false && usersQuery.isLoading === false && (
        <p className="text-xs text-muted-foreground text-right">
          Tenant: {activeTenantId ?? 'unknown'} · Auto-refreshes every 30s
        </p>
      )}
    </div>
  )
}
