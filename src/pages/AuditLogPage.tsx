import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface AuditMessage {
  id: string
  topic: string
  key?: string
  payload?: Record<string, unknown>
  status: string
  created_at: string
  retry_count?: number
}

interface AuditResponse {
  success: boolean
  data: AuditMessage[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

export default function AuditLogPage() {
  const { activeTenantId } = useAuth()
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['messages', 'audit', page, activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<AuditResponse>('/api/v1/enforcer/messages/audit', {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 30_000,
  })

  const statsQuery = useQuery({
    queryKey: ['messages', 'stats', activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<{ success: boolean; data: Record<string, number> }>('/api/v1/enforcer/messages/stats'),
    refetchInterval: 60_000,
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data ? `${data.total} events` : 'Loading…'} · Auto-refreshes every 30s
        </p>
      </div>

      {statsQuery.data?.data && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(statsQuery.data.data).map(([key, val]) => (
            <div key={key} className="bg-muted rounded-lg px-3 py-2 text-xs">
              <span className="text-muted-foreground">{key}: </span>
              <span className="font-semibold">{val}</span>
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">Events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No audit events found</p>
          )}
          <div>
            {data?.data.map((msg) => (
              <div key={msg.id} className="flex items-start justify-between px-6 py-4 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium font-mono">{msg.topic}</span>
                    {msg.key && <span className="text-xs text-muted-foreground">· {msg.key}</span>}
                  </div>
                  {msg.payload && (
                    <p className="text-xs text-muted-foreground truncate max-w-lg">
                      {JSON.stringify(msg.payload)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                    {msg.retry_count ? ` · ${msg.retry_count} retries` : ''}
                  </p>
                </div>
                <Badge variant={msg.status === 'delivered' ? 'success' : msg.status === 'failed' ? 'destructive' : 'secondary'}>
                  {msg.status}
                </Badge>
              </div>
            ))}
          </div>

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
