import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { MAX_SCOPE_ITEMS, SCOPE_KINDS, type ScopeItem } from '../types'

export interface ScopeRow extends ScopeItem {
  key: number // stable React key; never sent to the API
}

interface Props {
  rows: ScopeRow[]
  onChange: (rows: ScopeRow[]) => void
  /** Translated error per row index, for the value field. */
  errors: Record<number, string | undefined>
  newKey: () => number
}

/**
 * Ordered list of in-scope assets. Values are sent exactly as typed; order is the
 * position saved on the server. Every control is a real button or field, so the
 * editor works with a keyboard and on phones.
 */
export function ScopeEditor({ rows, onChange, errors, newKey }: Props) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLOListElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)

  const focusValue = (index: number) =>
    // After React re-renders the list.
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('[data-scope-value]')[index]?.focus())

  const update = (index: number, patch: Partial<ScopeItem>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const add = () => {
    onChange([...rows, { key: newKey(), kind: 'domain', value: '', note: '' }])
    focusValue(rows.length)
  }

  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    onChange(next)
    if (next.length === 0) requestAnimationFrame(() => addRef.current?.focus())
    else focusValue(Math.min(index, next.length - 1))
  }

  const move = (index: number, by: -1 | 1) => {
    const target = index + by
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    // Keep focus on the same arrow of the moved row.
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelectorAll<HTMLButtonElement>(`[data-move="${by}"]`)
        [target]?.focus(),
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {rows.length === 0 && <p className="text-muted-foreground text-sm">{t('projects.form.noScope')}</p>}
      <ol ref={listRef} className="grid grid-cols-1 gap-3">
        {rows.map((row, i) => {
          const n = i + 1
          const id = `scope-${row.key}`
          const error = errors[i]
          return (
            <li key={row.key}>
              <fieldset className="bg-muted/40 grid min-w-0 grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <legend className="sr-only">{t('projects.form.item', { n })}</legend>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-kind`}>{t('projects.form.kind')}</Label>
                  <NativeSelect
                    id={`${id}-kind`}
                    value={row.kind}
                    onChange={(e) => update(i, { kind: e.target.value as ScopeItem['kind'] })}
                  >
                    {SCOPE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`projects.kind.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-value`}>{t('projects.form.value')}</Label>
                  <Input
                    id={`${id}-value`}
                    data-scope-value
                    value={row.value}
                    maxLength={512}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="font-mono"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-note`}>{t('projects.form.note')}</Label>
                  <Input
                    id={`${id}-note`}
                    value={row.note}
                    maxLength={1000}
                    onChange={(e) => update(i, { note: e.target.value })}
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-move="-1"
                    disabled={i === 0}
                    aria-label={t('projects.form.moveUp', { n })}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-move="1"
                    disabled={i === rows.length - 1}
                    aria-label={t('projects.form.moveDown', { n })}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('projects.form.remove', { n })}
                    onClick={() => remove(i)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {error && (
                  <p id={`${id}-error`} className="text-danger text-sm md:col-span-4">
                    {error}
                  </p>
                )}
              </fieldset>
            </li>
          )
        })}
      </ol>
      <Button
        ref={addRef}
        type="button"
        variant="outline"
        className="w-fit"
        disabled={rows.length >= MAX_SCOPE_ITEMS}
        onClick={add}
      >
        <Plus aria-hidden="true" />
        {t('projects.form.addScope')}
      </Button>
    </div>
  )
}
