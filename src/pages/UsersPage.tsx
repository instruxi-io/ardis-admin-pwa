import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search, Users } from 'lucide-react'

interface Member {
  user_id: string
  username?: string
  first_name?: string
  last_name?: string
  role: string
  active: boolean
  created_at: string
}

export default function UsersPage() {
  const { activeTenantId } = useAuth()
  const [search, setSearch] = useState('')

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ['tenant-members-users', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return []
      const res = await getEnforcerApiClient().get<{ data: Member[] }>(
        `admin/tenants/${activeTenantId}/members`,
        { limit: 200 }
      )
      return (res.data ?? []).filter(m => m.role?.toLowerCase() === 'user')
    },
    refetchOnMount: true,
    refetchInterval: 60_000,
  })

  const loading = isLoading

  const filtered = members.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.username?.toLowerCase().includes(q) ||
      m.first_name?.toLowerCase().includes(q) ||
      m.last_name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Professionals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLoading ? 'Loading…' : `${members.length} registered professional${members.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or username…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Users size={14} />
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No professionals found.</p>
          )}
          {filtered.map(user => (
            <div key={user.user_id} className="flex items-center justify-between px-6 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {[user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '—'}
                </p>
                <p className="text-xs text-muted-foreground font-mono">{user.user_id}</p>
              </div>
              <div className="flex items-center gap-3 ml-4 shrink-0">
                <Badge variant="outline" className={user.active ? 'border-green-500 text-green-500 text-xs' : 'text-xs'}>
                  {user.active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
