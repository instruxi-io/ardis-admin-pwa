import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { getEnforcerApiClient } from '@/lib/enforcerApiClient'
import type { AdminTenant } from '@/types/enforcer/admin'
import type { PaginatedResponse } from '@/types/enforcer/common'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Building2, ArrowRight } from 'lucide-react'

export default function TenantPickerPage() {
  const { setActiveTenant } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () =>
      getEnforcerApiClient().get<PaginatedResponse<AdminTenant>>('/api/v1/enforcer/admin/tenants', { limit: 100 }),
  })

  const handlePick = (tenant: AdminTenant) => {
    setActiveTenant(tenant.id)
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground text-xl font-bold mb-2">
            A
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Select a tenant</h1>
          <p className="text-sm text-muted-foreground">Choose which industry tenant to manage</p>
        </div>

        {isLoading && (
          <div className="text-center text-sm text-muted-foreground py-8">Loading tenants…</div>
        )}
        {error && (
          <div className="text-center text-sm text-destructive py-8">
            Failed to load tenants. Check your connection.
          </div>
        )}

        <div className="space-y-2">
          {data?.data.map((tenant) => (
            <button
              key={tenant.id}
              onClick={() => handlePick(tenant)}
              className="w-full text-left group"
            >
              <Card className="hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer">
                <CardHeader className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 size={18} className="text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{tenant.name}</CardTitle>
                        <CardDescription className="text-xs">{tenant.code}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={tenant.active ? 'success' : 'secondary'}>
                        {tenant.active ? 'Active' : 'Inactive'}
                      </Badge>
                      {tenant.account_count !== undefined && (
                        <span className="text-xs text-muted-foreground">{tenant.account_count} users</span>
                      )}
                      <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
