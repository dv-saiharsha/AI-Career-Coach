import { useMemo } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronsLeft, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/shared/Logo'
import { ConicRing } from '@/components/shared/ConicRing'
import { useAuth } from '@/context/AuthContext'
import { allNavItems, navGroups } from '@/config/navigation'
import { useDashboardHome } from '@/hooks/useDashboardHome'
import { computeReadinessScore } from '@/lib/readiness'
import { getScoreTone, scoreToneClass } from '@/lib/scoreTone'

interface SidebarProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
  onItemClick?: () => void
}

export function Sidebar({ collapsed = false, onToggleCollapse, onItemClick }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { data } = useDashboardHome()
  const readiness = computeReadinessScore(data)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const initials = (user?.fullName || user?.email || '?')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  // A plain per-item startsWith highlighted every ancestor path at once —
  // e.g. on /resume/tailor, both "ATS Check" (/resume) and "Resume Tailor"
  // (/resume/tailor) matched simultaneously, since the former is a prefix of
  // the latter. Only the single longest-matching nav path should ever be
  // active, so this picks the best match across every nav item once instead
  // of testing each item against the same ambiguous rule in isolation.
  const activePath = useMemo(() => {
    let best: string | null = null
    for (const item of allNavItems) {
      const matches = item.path === '/dashboard' ? location.pathname === '/dashboard' : location.pathname.startsWith(item.path)
      if (matches && (best === null || item.path.length > best.length)) best = item.path
    }
    return best
  }, [location.pathname])

  const isActiveRoute = (path: string) => path === activePath

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col justify-between border-r border-border bg-card transition-[width] duration-[240ms] ease-out',
        collapsed ? 'w-[72px]' : 'w-[248px]'
      )}
    >
      <div
        className={cn(
          'flex min-h-[74px] items-center justify-between border-b border-border px-[21px]',
          collapsed && 'justify-center px-0'
        )}
      >
        <NavLink to="/dashboard" onClick={onItemClick}>
          <Logo compact={collapsed} />
        </NavLink>
        {onToggleCollapse && !collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="h-[29px] w-[29px] text-muted-foreground"
            aria-label="Collapse sidebar"
            onClick={onToggleCollapse}
          >
            <ChevronsLeft size={18} />
          </Button>
        )}
      </div>
      {onToggleCollapse && collapsed && (
        <Button
          variant="outline"
          size="icon"
          className="absolute -right-[15px] top-[87px] h-[29px] w-[29px] rounded-full shadow-soft"
          aria-label="Expand sidebar"
          onClick={onToggleCollapse}
        >
          <ChevronsLeft size={18} className="rotate-180" />
        </Button>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-[17px]">
        {navGroups.map((group) => (
          <div className="mb-[17px]" key={group.label}>
            {!collapsed && (
              <span className="block px-2.5 pb-[7px] text-[9px] font-extrabold uppercase tracking-[0.13em] text-muted-foreground">
                {group.label}
              </span>
            )}
            {group.items.map(({ label, path, icon: Icon }) => {
              const active = isActiveRoute(path)
              return (
                <NavLink
                  key={path}
                  to={path}
                  title={collapsed ? label : undefined}
                  onClick={onItemClick}
                  className={cn(
                    'my-0.5 flex min-h-[39px] items-center gap-[11px] rounded-md px-2.5 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground',
                    collapsed && 'justify-center px-0',
                    active && 'bg-accent font-bold text-accent-foreground'
                  )}
                >
                  <Icon size={19} className="shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className={cn('mb-[9px] rounded-[10px] bg-secondary p-[13px]', collapsed && 'bg-transparent p-1')}>
          {collapsed ? (
            <ConicRing value={readiness} size={40} toneClassName={scoreToneClass(getScoreTone(readiness))}>
              <span className="font-heading text-[10px] font-extrabold text-primary">{readiness}</span>
            </ConicRing>
          ) : (
            <>
              <div className="flex justify-between text-[10px] text-primary">
                <span>Career Readiness</span>
                <strong className="font-heading">{readiness}%</strong>
              </div>
              <div className="my-[9px] h-[5px] overflow-hidden rounded-full bg-card">
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${readiness}%` }}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-[9px] font-extrabold text-primary hover:bg-transparent"
                onClick={() => navigate('/progress')}
              >
                View progress
              </Button>
            </>
          )}
        </div>

        <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
          <Button
            variant="ghost"
            className={cn(
              'h-auto flex-1 justify-start gap-2.5 rounded-md p-2 text-left hover:bg-background',
              collapsed && 'flex-none justify-center'
            )}
            onClick={() => navigate('/profile')}
          >
            <Avatar className="h-8 w-8 shrink-0 rounded-[9px]">
              <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.fullName} />
              <AvatarFallback className="rounded-[9px] bg-gradient-to-br from-coral-tint to-coral/70 text-[10px] font-extrabold text-coral-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <span className="grid min-w-0 flex-1 text-left">
                <strong className="truncate text-[11px] font-semibold text-foreground">
                  {user?.fullName || 'My Account'}
                </strong>
                <small className="truncate text-[9px] text-muted-foreground">{user?.email}</small>
              </span>
            )}
            {!collapsed && <ChevronDown size={16} className="shrink-0 text-muted-foreground" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label="Sign out"
            onClick={handleLogout}
          >
            <LogOut size={15} />
          </Button>
        </div>
      </div>
    </aside>
  )
}
