import type { RouteObject } from 'react-router'

import { RequireAuth } from '@/features/auth'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { RouteError } from '@/shared/layout/RouteError'

import { lazyPage } from './lazyPage'
import { PAGES, type PageEntry } from './modules'
import { AppShell } from './shell/AppShell'

/** Builds the route tree from the page registry (app/modules.ts). */
export function buildRoutes(pages: PageEntry[] = PAGES): RouteObject[] {
  // Every page gets its own error boundary, rendered inside the shell.
  const shellPages: RouteObject[] = [
    ...pages.map(({ path, page }) => ({
      ...(path === '/' ? { index: true } : { path: path.slice(1) }),
      lazy: lazyPage(page),
      errorElement: <RouteError />,
    })),
    { path: '*', lazy: lazyPage(() => import('@/app/NotFoundPage')), errorElement: <RouteError /> },
  ]

  return [
    {
      // Fallback shown while the first lazy chunk loads.
      HydrateFallback: () => <FullPageStatus kind="loading" />,
      errorElement: <RouteError fullPage />,
      children: [
        { path: '/login', lazy: lazyPage(() => import('@/features/auth/LoginPage')), errorElement: <RouteError fullPage /> },
        { path: '/setup', lazy: lazyPage(() => import('@/features/auth/SetupPage')), errorElement: <RouteError fullPage /> },
        { element: <RequireAuth />, children: [{ element: <AppShell />, children: shellPages }] },
      ],
    },
  ]
}

export const routes = buildRoutes()
