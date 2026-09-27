import { FileText, FolderKanban, LayoutDashboard, NotebookPen, Search, Settings, type LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * The one place where pages and navigation are registered. Routes (routes.tsx)
 * and the sidebar (shell/AppShell.tsx) are both built from this list, so adding
 * a page is one entry here (see docs/ADDING_A_MODULE.md).
 */
export interface PageEntry {
  /** Absolute path inside the signed-in shell, e.g. '/projects' or '/projects/:projectId'. */
  path: string
  /** Lazy import of the page; each page becomes its own chunk. */
  page: () => Promise<{ default: ComponentType }>
  /** Present only for pages that appear in the sidebar. */
  nav?: { labelKey: string; icon: LucideIcon; section: 'primary' | 'secondary' }
}

export const PAGES: PageEntry[] = [
  {
    path: '/',
    page: () => import('@/features/dashboard/DashboardPage'),
    nav: { labelKey: 'nav.dashboard', icon: LayoutDashboard, section: 'primary' },
  },
  {
    path: '/search',
    page: () => import('@/features/search/SearchPage'),
    nav: { labelKey: 'nav.search', icon: Search, section: 'primary' },
  },
  {
    path: '/reports',
    page: () => import('@/features/reports/ReportsPage'),
    nav: { labelKey: 'nav.reports', icon: FileText, section: 'primary' },
  },
  { path: '/reports/new', page: () => import('@/features/reports/ReportNewPage') },
  { path: '/reports/:reportId', page: () => import('@/features/reports/ReportDetailPage') },
  { path: '/reports/:reportId/edit', page: () => import('@/features/reports/ReportEditPage') },
  {
    path: '/projects',
    page: () => import('@/features/projects/ProjectsPage'),
    nav: { labelKey: 'nav.projects', icon: FolderKanban, section: 'primary' },
  },
  { path: '/projects/new', page: () => import('@/features/projects/ProjectNewPage') },
  { path: '/projects/:projectId', page: () => import('@/features/projects/ProjectDetailPage') },
  { path: '/projects/:projectId/edit', page: () => import('@/features/projects/ProjectEditPage') },
  {
    path: '/notes',
    page: () => import('@/features/notes/NotesPage'),
    nav: { labelKey: 'nav.notes', icon: NotebookPen, section: 'primary' },
  },
  { path: '/notes/new', page: () => import('@/features/notes/NoteNewPage') },
  { path: '/notes/:noteId', page: () => import('@/features/notes/NoteDetailPage') },
  { path: '/notes/:noteId/edit', page: () => import('@/features/notes/NoteEditPage') },
  // PDF import (Stage 7): reached from the Reports and Notes lists, not the sidebar.
  { path: '/import', page: () => import('@/features/pdf/ImportPage') },
  // Full-data export and import (D-90): reached from Settings.
  { path: '/settings/data', page: () => import('@/features/transfer/DataPage') },
  {
    path: '/settings',
    page: () => import('@/features/settings/SettingsPage'),
    nav: { labelKey: 'nav.settings', icon: Settings, section: 'secondary' },
  },
]

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
}

export function navItems(section: 'primary' | 'secondary', pages: PageEntry[] = PAGES): NavItem[] {
  return pages.flatMap(({ path, nav }) =>
    nav?.section === section ? [{ to: path, labelKey: nav.labelKey, icon: nav.icon }] : [],
  )
}
