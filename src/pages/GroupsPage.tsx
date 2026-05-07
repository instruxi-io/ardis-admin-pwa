import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import type { AdminGroup } from '@/types/enforcer/admin'
import type { PaginatedResponse } from '@/types/enforcer/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FolderOpen, Users, ArrowRight } from 'lucide-react'

export default function GroupsPage() {
  const { activeTenantId } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'groups', activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<AdminGroup>>('/api/v1/enforcer/admin/groups', { limit: 100 }),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold">Groups</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data ? `${data.total} groups` : 'Loading…'}
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.data.map((group) => (
          <button key={group.id} onClick={() => navigate(`/groups/${group.id}`)} className="text-left group">
            <Card className="hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                      <FolderOpen size={15} className="text-primary" />
                    </div>
                    <CardTitle className="text-sm">{group.name}</CardTitle>
                  </div>
                  <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors mt-0.5" />
                </div>
              </CardHeader>
              <CardContent>
                {group.description && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{group.description}</p>
                )}
                {group.member_count !== undefined && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users size={12} />
                    {group.member_count} members
                  </div>
                )}
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {data?.data.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">No groups found</div>
      )}
    </div>
  )
}
