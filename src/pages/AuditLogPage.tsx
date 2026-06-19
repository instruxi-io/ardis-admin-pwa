import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

// Actual shape returned by GET /messages/audit
interface AuditEntry {
  id: string
  message_id?: string
  action: string
  details?: string // base64 JSON
  created_at: string
}

interface AuditPagedResponse {
  success: boolean
  data: {
    data: AuditEntry[]
    total: number
    limit: number
    offset: number
  }
}

const PAGE_SIZE = 25

function decodeDetails(b64?: string): string | null {
  if (!b64) return null
  try {
    return atob(b64)
  } catch {
    return null
  }
}

function actionColor(action: string) {
  if (action.includes('fail') || action.includes('error')) return 'destructive'
  if (action.includes('deliver') || action.includes('success')) return 'success'
  return 'secondary'
}

export default function AuditLogPage() {
  const { activeTenantId } = useAuth()
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery<AuditPagedResponse>({
    queryKey: ['messages', 'audit', page, activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return { success: true, data: { data: [], total: 0, limit: PAGE_SIZE, offset: 0 } }
      return getEnforcerApiClient().get<AuditPagedResponse>('messages/audit', {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
    },
    refetchInterval: 30_000,
    refetchOnMount: true,
  })

  const entries = data?.data?.data ?? []
  const total = data?.data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isLoading ? 'Loading…' : `${total} event${total !== 1 ? 's' : ''}`} · Auto-refreshes every 30s
        </p>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ScrollText size={14} />
            Events
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {!isLoading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No audit events found.</p>
          )}
          {entries.map((entry) => {
            const details = decodeDetails(entry.details)
            let parsedDetails: Record<string, unknown> | null = null
            try { if (details) parsedDetails = JSON.parse(details) } catch { /* ignore */ }

            return (
              <div key={entry.id} className="px-6 py-4 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium font-mono">{entry.action}</span>
                      {entry.message_id && (
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-xs">{entry.message_id}</span>
                      )}
                    </div>
                    {parsedDetails && (
                      <p className="text-xs text-muted-foreground truncate max-w-lg">
                        {Object.entries(parsedDetails).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <Badge variant={actionColor(entry.action) as 'destructive' | 'secondary'} className="shrink-0 text-xs">
                    {entry.action.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </div>
            )
          })}

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
