import { Tabs, ToggleGroup } from 'radix-ui'
import { useDeferredValue, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/utils'
import { useMediaQuery } from '@/shared/lib/useMediaQuery'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'

import { MarkdownView } from './MarkdownView'

type DesktopMode = 'markdown' | 'split' | 'preview'
type PhoneTab = 'edit' | 'preview'
const MODE_KEY = 'hexops.editorMode'
const MODES: DesktopMode[] = ['markdown', 'split', 'preview']

function loadMode(): DesktopMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved && (MODES as string[]).includes(saved)) return saved as DesktopMode
  } catch {
    // Storage unavailable: use the default.
  }
  return 'split'
}

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  maxLength: number
  /** Translated error; shown instead of the hint and linked to the textarea. */
  error?: string | null
  hint?: string
}

/**
 * The one Markdown editor, used by Reports and Notes.
 * Desktop (≥ 768 px): Markdown | Split (default) | Preview, remembered per browser.
 * Phones: Edit | Preview tabs. The preview is live and uses the safe MarkdownView.
 * The textarea stays mounted in every mode, so undo history and focus survive.
 */
export function MarkdownEditor({ id, label, value, onChange, maxLength, error, hint }: Props) {
  const { t } = useTranslation()
  const wide = useMediaQuery('(min-width: 768px)')
  const [mode, setMode] = useState<DesktopMode>(loadMode)
  const [tab, setTab] = useState<PhoneTab>('edit')
  // Rendering can lag behind typing on long documents; typing never waits for it.
  const preview = useDeferredValue(value)
  const helpId = useId()

  const changeMode = (next: string) => {
    if (!next) return // ToggleGroup sends "" when the active item is pressed again
    setMode(next as DesktopMode)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // Non-fatal.
    }
  }

  const showEditor = wide ? mode !== 'preview' : tab === 'edit'
  const showPreview = wide ? mode !== 'markdown' : tab === 'preview'
  const split = wide && mode === 'split'
  const pane = 'h-[28rem] min-h-48 max-h-[70vh] rounded-md border'

  const editor = (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      spellCheck={false}
      aria-invalid={error ? true : undefined}
      aria-describedby={helpId}
      hidden={!showEditor}
      className={cn(pane, 'resize-y font-mono text-sm leading-relaxed', !showEditor && 'hidden')}
    />
  )
  const rendered = showPreview && (
    <section
      aria-label={t('editor.preview')}
      tabIndex={0}
      className={cn(pane, 'bg-card focus-visible:ring-ring/50 min-w-0 overflow-auto p-4 outline-none focus-visible:ring-[3px]')}
    >
      {preview.trim() ? <MarkdownView source={preview} /> : <p className="text-muted-foreground text-sm">{t('editor.empty')}</p>}
    </section>
  )

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2" data-editor-mode={wide ? mode : tab}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {wide ? (
          <ToggleGroup.Root
            type="single"
            value={mode}
            onValueChange={changeMode}
            aria-label={t('editor.mode')}
            className="bg-muted inline-flex gap-1 rounded-lg p-1"
          >
            {MODES.map((m) => (
              <ToggleGroup.Item
                key={m}
                value={m}
                className="text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground focus-visible:ring-ring/50 h-7 rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-[3px] data-[state=on]:shadow-sm"
              >
                {t(`editor.modes.${m}`)}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        ) : (
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as PhoneTab)}>
            <Tabs.List aria-label={t('editor.mode')} className="bg-muted inline-flex gap-1 rounded-lg p-1">
              {(['edit', 'preview'] as const).map((v) => (
                <Tabs.Trigger
                  key={v}
                  value={v}
                  className="text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground focus-visible:ring-ring/50 h-8 min-w-20 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] data-[state=active]:shadow-sm"
                >
                  {t(`editor.tabs.${v}`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
        )}
      </div>
      <div className={cn('grid min-w-0 grid-cols-1 gap-3', split && 'grid-cols-2')}>
        {editor}
        {rendered}
      </div>
      <p id={helpId} className={cn('flex flex-wrap justify-between gap-2 text-xs', error ? 'text-danger' : 'text-muted-foreground')}>
        <span>{error ?? hint ?? t('editor.hint')}</span>
        <span className="text-muted-foreground tabular-nums">{t('editor.characters', { count: value.length, max: maxLength })}</span>
      </p>
    </div>
  )
}
