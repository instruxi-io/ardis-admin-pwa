import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import type { AdminSession, SessionStatus, ListSessionsParams } from '@/types/enforcer/admin'
import type { PaginatedResponse } from '@/types/enforcer/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const STATUSES: { label: string; value: SessionStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Pending', value: 'pending' },
  { label: 'Verified', value: 'verified' },
  { label: 'Expired', value: 'expired' },
  { label: 'Failed', value: 'failed' },
  { label: 'Revoked', value: 'revoked' },
]

const PAGE_SIZE = 25

const statusColor: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  active: 'success', verified: 'success', pending: 'warning',
  expired: 'secondary', revoked: 'secondary', failed: 'destructive',
}

export default function SessionsPage() {
  const { activeTenantId } = useAuth()
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all')

  const params: ListSessionsParams = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'sessions', params, activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<AdminSession>>(
        'admin/sessions',
        params as Record<string, unknown>
      ),
    refetchInterval: 30_000,
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data ? `${data.total} sessions` : 'Loading…'} · Auto-refreshes every 30s
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map(({ label, value }) => (
          <Button
            key={value}
            variant={statusFilter === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setStatusFilter(value); setPage(0) }}
          >
            {label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Type</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Attempts</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Created</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Expires</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((session) => (
                <tr key={session.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-3">
                    <p className="font-medium">{session.session_type}</p>
                    <p className="text-xs text-muted-foreground font-mono">{session.user_id}</p>
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={statusColor[session.status] ?? 'secondary'}>{session.status}</Badge>
                    {session.last_error && (
                      <p className="text-xs text-destructive mt-1 truncate max-w-[200px]">{session.last_error}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{session.attempt_count}</td>
                  <td className="px-6 py-3 text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(session.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(session.expires_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                  <ChevronLeft size={14} />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
