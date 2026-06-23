import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, isDeveloper, isTenantAdmin } = useAuth()
  if (!ready) return <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">Loading…</div>
  if (!authenticated) return <Navigate to="/login" replace />
  // Only Developers (VPs) and Tenant Admins (IX) may access the portal.
  if (!isDeveloper && !isTenantAdmin) return <Navigate to="/login" replace />
  return <>{children}</>
}
