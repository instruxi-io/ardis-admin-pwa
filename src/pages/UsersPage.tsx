import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { useAuth } from '@/context/AuthContext'
import type { UserListItem, UsersListParams } from '@/types/enforcer/admin'
import type { PaginatedResponse } from '@/types/enforcer/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Search, ChevronLeft, ChevronRight, UserCheck, UserX } from 'lucide-react'

const PAGE_SIZE = 25

export default function UsersPage() {
  const { activeTenantId } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')

  const params: UsersListParams = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(search ? { username: search } : {}),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', params, activeTenantId],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<UserListItem>>('admin/users', params as Record<string, unknown>),
    refetchInterval: 60_000,
  })

  const activateMutation = useMutation({
    mutationFn: (userId: string) =>
      getEnforcerApiClient().put(`admin/users/${userId}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success('User activated')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) =>
      getEnforcerApiClient().put(`admin/users/${userId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success('User deactivated')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data ? `${data.total} registered users` : 'Loading…'}
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by username…"
          className="pl-9"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
        />
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Name / Email</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">KYC</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground">Role</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {data?.data.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/users/${user.id}`)}
                >
                  <td className="px-6 py-3">
                    <p className="font-medium">
                      {[user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">{user.email ?? '—'}</p>
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={user.active ? 'success' : 'secondary'}>
                      {user.active ? 'Active' : 'Inactive'}
                    </Badge>
                    {user.deleted_at && <Badge variant="destructive" className="ml-1">Deleted</Badge>}
                  </td>
                  <td className="px-6 py-3">
                    <Badge variant={user.kyc_verified ? 'success' : 'secondary'}>
                      {user.kyc_verified ? 'Verified' : 'Unverified'}
                    </Badge>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-xs capitalize text-muted-foreground">{user.role ?? 'user'}</span>
                  </td>
                  <td className="px-6 py-3" onClick={(e) => e.stopPropagation()}>
                    {user.active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => deactivateMutation.mutate(user.id)}
                        disabled={deactivateMutation.isPending}
                      >
                        <UserX size={14} />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-primary"
                        onClick={() => activateMutation.mutate(user.id)}
                        disabled={activateMutation.isPending}
                      >
                        <UserCheck size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
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
