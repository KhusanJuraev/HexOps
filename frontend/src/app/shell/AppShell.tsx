import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserRound } from 'lucide-react'
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'

import { useToast } from '@/shared/components/toast'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { useLogout, useSession } from '@/features/auth'
import { ConnectionBanner, ConnectionStatus } from '@/features/connection'
import { isUnreachable } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { cn } from '@/shared/lib/utils'

import { AppearanceMenu } from '@/shared/layout/AppearanceMenu'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { Logo } from '@/shared/layout/Logo'

import { navItems, type NavItem } from '../modules'
import { useSidebarCollapsed } from './sidebar'

const PRIMARY_NAV = navItems('primary')
const SECONDARY_NAV = navItems('secondary')

/**
 * full: labels (phone drawer). responsive: icon rail on tablets, labels from 1024 px
 * (the desktop default). rail: icons only at every width (desktop, collapsed by choice).
 */
type NavMode = 'full' | 'responsive' | 'rail'

function NavList({ items, mode, onNavigate }: { items: NavItem[]; mode: NavMode; onNavigate?: () => void }) {
  const { t } = useTranslation()
  return (
    <ul className="grid gap-1">
      {items.map(({ to, labelKey, icon: Icon }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                'text-muted-foreground hover:bg-accent hover:text-foreground',
                isActive && 'bg-accent text-foreground',
                mode === 'responsive' && 'justify-center px-0 lg:justify-start lg:px-3',
                mode === 'rail' && 'justify-center px-0',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* The current page: highlighted row, accent icon and an edge marker. */}
                {isActive && <span aria-hidden="true" className="bg-primary absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full" />}
                <Icon className={cn('size-4 shrink-0', isActive && 'text-primary')} aria-hidden="true" />
                <span className={cn(mode === 'responsive' && 'sr-only lg:not-sr-only', mode === 'rail' && 'sr-only')}>{t(labelKey)}</span>
                {mode !== 'full' && (
                  // Visible label for the icon rail, on hover and on keyboard focus.
                  // The accessible name comes from the text above, so this is hidden from AT.
                  <span
                    aria-hidden="true"
                    data-nav-tooltip
                    className={cn(
                      'bg-foreground text-background pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap shadow-md',
                      'invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100',
                      mode === 'responsive' && 'lg:hidden',
                    )}
                  >
                    {t(labelKey)}
                  </span>
                )}
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

interface SidebarProps {
  mode: NavMode
  onNavigate?: () => void
  /** Desktop only: the collapse/expand control and its state. */
  toggle?: { collapsed: boolean; onToggle: () => void }
}

function SidebarContents({ mode, onNavigate, toggle }: SidebarProps) {
  const { t } = useTranslation()
  const toggleLabel = toggle?.collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')
  const ToggleIcon = toggle?.collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <nav aria-label={t('nav.main')} className="flex h-full flex-col gap-6 p-3">
      <div
        className={cn(
          'flex items-center gap-2.5 px-2',
          mode === 'full' && 'h-10',
          mode === 'responsive' && 'h-10 justify-center px-0 lg:justify-start lg:px-2',
          mode === 'rail' && 'min-h-10 flex-col justify-center gap-2 px-0',
        )}
      >
        <Logo />
        <span className={cn('text-base font-semibold tracking-tight', mode === 'responsive' && 'hidden lg:inline', mode === 'rail' && 'hidden')}>
          {t('app.name')}
        </span>
        {toggle && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('text-muted-foreground hidden size-8 lg:inline-flex', mode === 'responsive' && 'ml-auto')}
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={!toggle.collapsed}
            aria-controls="app-sidebar"
            data-sidebar-toggle
            onClick={toggle.onToggle}
          >
            <ToggleIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      <NavList items={PRIMARY_NAV} mode={mode} onNavigate={onNavigate} />
      <div className="mt-auto">
        <NavList items={SECONDARY_NAV} mode={mode} onNavigate={onNavigate} />
      </div>
    </nav>
  )
}

function UserMenu() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const logout = useLogout()
  const toast = useToast()
  // Local data is always dropped (see useLogout); tell the user if the server did not confirm.
  const signOut = () =>
    logout.mutate(undefined, {
      onError: (err) =>
        toast({ tone: 'error', message: isUnreachable(err) ? t('auth.signedOutOffline') : apiErrorMessage(t, err) }),
    })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('auth.signedInAs')}>
          <UserRound />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <span className="text-muted-foreground block text-xs">{t('auth.signedInAs')}</span>
          <span className="block truncate font-medium">{session?.user.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} disabled={logout.isPending}>
          <LogOut />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, toggleSidebar] = useSidebarCollapsed()

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="bg-card text-foreground focus-visible:ring-ring/50 sr-only z-50 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm outline-none focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-[3px]"
      >
        {t('nav.skipToContent')}
      </a>
      {/* Tablet: icon rail. Desktop: full sidebar, or an icon rail by choice (saved).
          Mobile: sheet from the top bar. The desktop choice never applies below 1024 px. */}
      <aside
        id="app-sidebar"
        data-collapsed={collapsed}
        className={cn('bg-sidebar sticky top-0 hidden h-dvh w-16 shrink-0 border-r transition-[width] md:block', !collapsed && 'lg:w-60')}
      >
        <SidebarContents mode={collapsed ? 'rail' : 'responsive'} toggle={{ collapsed, onToggle: toggleSidebar }} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur-md md:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.openMenu')}>
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-72 p-0">
              <SheetTitle className="sr-only">{t('nav.main')}</SheetTitle>
              <SheetDescription className="sr-only">{t('app.tagline')}</SheetDescription>
              <SidebarContents mode="full" onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold tracking-tight md:hidden">{t('app.name')}</span>
          <div className="ml-auto flex items-center gap-1">
            <ConnectionStatus />
            <AppearanceMenu />
            <UserMenu />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none md:px-8 md:py-10">
          <ConnectionBanner className="mb-6" />
          <Suspense fallback={<FullPageStatus kind="loading" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
