import { NavLink } from 'react-router-dom'
import { LogOut, Building2, Layers, Users, Shield, ScrollText, Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// Items visible to all authenticated operators (VPs and admins).
const vpNavItems = [
  { to: '/schemas', icon: Layers, label: 'View Models' },
]

// Items visible to Tenant Admins (IX operators) only.
const adminNavItems = [
  { to: '/users', icon: Users, label: 'Professionals' },
  { to: '/verifiers', icon: Shield, label: 'Verifiers' },
  { to: '/audit', icon: ScrollText, label: 'Audit Log' },
]

export function Sidebar() {
  const { account, claims, activeTenantId, role, username, isDeveloper, isTenantAdmin, logout } = useAuth()

  const displayName = account?.first_name && account?.last_name
    ? `${account.first_name} ${account.last_name}`
    : account?.username ?? claims?.email ?? 'Admin'

  const roleLabel = isTenantAdmin ? 'Tenant Admin' : isDeveloper ? 'Developer' : role ?? 'User'

  return (
    <aside className="flex flex-col h-full w-60 shrink-0 border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-sidebar-border">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
          C
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-sidebar-foreground leading-tight truncate">
            CredPass Admin
          </span>
          {activeTenantId && (
            <span className="text-xs text-muted-foreground truncate">{activeTenantId}</span>
          )}
        </div>
      </div>

      {isTenantAdmin && (
        <div className="px-3 py-2 border-b border-sidebar-border">
          <NavLink
            to="/tenants"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors',
                isActive && 'bg-sidebar-accent text-sidebar-accent-foreground'
              )
            }
          >
            <Building2 size={14} />
            Switch Tenant
          </NavLink>
        </div>
      )}

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {/* VP + admin items */}
        {vpNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}

        {/* Tenant admin platform management */}
        {isTenantAdmin && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                Platform
              </p>
            </div>
            <NavLink
              to="/platform"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-amber-500/15 text-amber-600 font-medium'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                )
              }
            >
              <Crown size={16} />
              Platform Subscription
            </NavLink>
          </>
        )}

        {/* Admin-only ecosystem items */}
        {isTenantAdmin && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                Ecosystem
              </p>
            </div>
            {adminNavItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                  )
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
        <div className="px-3 py-2 rounded-md bg-muted/40 space-y-1">
          <p className="text-xs font-medium text-sidebar-foreground truncate">{displayName}</p>
          <Badge
            variant="outline"
            className={cn(
              'text-xs px-1.5 py-0',
              isTenantAdmin && 'border-purple-400 text-purple-400',
              isDeveloper && 'border-green-500 text-green-500',
            )}
          >
            {roleLabel}
          </Badge>
          {isDeveloper && username && (
            <p className="text-xs text-muted-foreground pt-0.5">
              <span className="text-muted-foreground/60">verifier_id: </span>
              <span className="font-mono">{username}</span>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={logout}
        >
          <LogOut size={14} />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
