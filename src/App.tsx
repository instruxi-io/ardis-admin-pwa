import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/context/AuthContext'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { RequireOperator } from '@/components/auth/RequireOperator'
import { AppShell } from '@/components/layout/AppShell'
import LoginPage from '@/pages/LoginPage'
import TenantPickerPage from '@/pages/TenantPickerPage'
import DashboardPage from '@/pages/DashboardPage'
import UsersPage from '@/pages/UsersPage'
import UserDetailPage from '@/pages/UserDetailPage'
import GroupsPage from '@/pages/GroupsPage'
import GroupDetailPage from '@/pages/GroupDetailPage'
import SessionsPage from '@/pages/SessionsPage'
import TermsPage from '@/pages/TermsPage'
import SchemasPage from '@/pages/SchemasPage'
import VerifiersPage from '@/pages/VerifiersPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <AuthProvider>
          <TooltipProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <ProtectedRoute>
                    <RequireOperator />
                  </ProtectedRoute>
                }
              >
                <Route path="/tenants" element={<TenantPickerPage />} />
              </Route>
              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/schemas" replace />} />
                <Route path="/schemas" element={<SchemasPage mode="vendor" />} />
                {/* Everything below hits Enforcer admin/* endpoints a vendor
                    key would 403 on; RequireOperator sends vendors back to
                    their Catalogue instead of a page of dead admin calls. */}
                <Route element={<RequireOperator />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/users/:id" element={<UserDetailPage />} />
                  <Route path="/groups" element={<GroupsPage />} />
                  <Route path="/groups/:id" element={<GroupDetailPage />} />
                  <Route path="/sessions" element={<SessionsPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/platform" element={<SchemasPage mode="platform" />} />
                  <Route path="/verifiers" element={<VerifiersPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </BrowserRouter>
          </TooltipProvider>
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
