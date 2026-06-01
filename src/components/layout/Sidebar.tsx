import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  ShieldCheck,
  ScrollText,
  FileText,
  LogOut,
  Building2,
  Layers,
  Package,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/groups', icon: FolderOpen, label: 'Groups' },
  { to: '/sessions', icon: ShieldCheck, label: 'Sessions' },
  { to: '/audit', icon: ScrollText, label: 'Audit Log' },
  { to: '/terms', icon: FileText, label: 'Terms' },
  { to: '/products', icon: Package, label: 'Products' },
  { to: '/schemas', icon: Layers, label: 'Schemas' },
]

export function Sidebar() {
  const { claims, activeTenantId, logout } = useAuth()
  const isAdmin = claims?.role === 'admin' || claims?.role === 'tenant_admin'

  return (
    <aside className="flex flex-col h-full w-60 shrink-0 border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-sidebar-border">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
          A
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-sidebar-foreground leading-tight truncate">
            Ardis Admin
          </span>
          {activeTenantId && (
            <span className="text-xs text-muted-foreground truncate">{activeTenantId}</span>
          )}
        </div>
      </div>

      {isAdmin && (
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
        {navItems.map(({ to, icon: Icon, label }) => (
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
      </nav>

      <div className="px-3 py-3 border-t border-sidebar-border">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs text-muted-foreground truncate">{claims?.email ?? 'Admin'}</p>
          <p className="text-xs text-muted-foreground capitalize">{claims?.role ?? 'admin'}</p>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive" onClick={logout}>
          <LogOut size={14} />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
