import { useMemo } from 'react'
import { useLocation } from 'react-router'

export interface ImportDraft {
  title: string
  body_md: string
}

/** What /reports/new and /notes/new accept as router state to start from a PDF draft. */
export interface ImportDraftState {
  importDraft: ImportDraft
}

/** The draft passed by the import page, if the router state really holds one. */
export function readImportDraft(state: unknown): ImportDraft | undefined {
  if (typeof state !== 'object' || state === null || !('importDraft' in state)) return undefined
  const draft = (state as { importDraft: unknown }).importDraft
  if (typeof draft !== 'object' || draft === null) return undefined
  const { title, body_md } = draft as Record<string, unknown>
  return typeof title === 'string' && typeof body_md === 'string' ? { title, body_md } : undefined
}

export function useImportDraft(): ImportDraft | undefined {
  const { state } = useLocation()
  return useMemo(() => readImportDraft(state), [state])
}
