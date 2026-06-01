import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import type { AdminGroup, UserListItem } from '@/types/enforcer/admin'
import type { PaginatedResponse, BaseResponse } from '@/types/enforcer/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ArrowLeft, UserMinus } from 'lucide-react'

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const groupQuery = useQuery({
    queryKey: ['admin', 'groups', id],
    queryFn: () =>
      getEnforcerApiClient().get<{ success: boolean; data: AdminGroup }>(`admin/groups/${id}`),
    enabled: !!id,
  })

  const membersQuery = useQuery({
    queryKey: ['admin', 'groups', id, 'users'],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<UserListItem>>(
        `admin/groups/${id}/users`,
        { limit: 100 }
      ),
    enabled: !!id,
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      getEnforcerApiClient().delete<BaseResponse>(`admin/groups/${id}/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups', id, 'users'] })
      toast.success('User removed from group')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const group = groupQuery.data?.data

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/groups')}>
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{group?.name ?? 'Loading…'}</h1>
          {group?.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Members {membersQuery.data ? `(${membersQuery.data.total})` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {membersQuery.isLoading && (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          )}
          {membersQuery.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No members</p>
          )}
          {membersQuery.data?.data.map((user) => (
            <div key={user.id} className="flex items-center justify-between px-6 py-3 border-b border-border last:border-0">
              <div>
                <p className="text-sm font-medium">
                  {[user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.email || '—'}
                </p>
                <p className="text-xs text-muted-foreground">{user.email ?? user.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={user.active ? 'success' : 'secondary'}>
                  {user.active ? 'Active' : 'Inactive'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeMutation.mutate(user.id)}
                  disabled={removeMutation.isPending}
                >
                  <UserMinus size={14} />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
