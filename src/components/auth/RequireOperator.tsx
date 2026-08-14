import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

// Operator-only route guard. Vendors (Developer role) get sent to their
// Catalogue instead of admin surfaces whose admin/* calls would 403 anyway.
// Used as a layout route: renders <Outlet /> when access is allowed.
export function RequireOperator() {
  const { isTenantAdmin } = useAuth()
  if (!isTenantAdmin) return <Navigate to="/schemas" replace />
  return <Outlet />
}
