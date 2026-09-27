import { X } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import { useTags } from '../api'
import { normalizeTag } from '../tags'
import { MAX_TAGS } from '../types'

interface Props {
  id: string
  tags: string[]
  onChange: (tags: string[]) => void
  error?: string | null
}

/** Chips + a text field. Enter or comma adds; Backspace on an empty field removes the last. */
export function TagInput({ id, tags, onChange, error }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const { data: known } = useTags()
  const listId = useId()
  const helpId = `${id}-help`

  const add = (raw: string) => {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
    if (!parts.length) return true
    const next = [...tags]
    for (const part of parts) {
      const tag = normalizeTag(part)
      if (!tag) return false
      if (!next.includes(tag) && next.length < MAX_TAGS) next.push(tag)
    }
    onChange(next)
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault() // never submits the form
      if (add(text)) {
        setText('')
        setInvalid(false)
      } else setInvalid(true)
    } else if (e.key === 'Backspace' && !text && tags.length) {
      onChange(tags.slice(0, -1))
    }
  }

  const message = invalid ? t('validation.codes.tag_invalid') : error
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={id}>{t('notes.form.tags')}</Label>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('notes.form.tags')}>
          {tags.map((tag) => (
            <li key={tag} className="bg-muted inline-flex max-w-full items-center gap-1 rounded-full py-0.5 ps-2.5 pe-1 text-xs font-medium">
              <span className="break-all">{tag}</span>
              <button
                type="button"
                onClick={() => onChange(tags.filter((x) => x !== tag))}
                aria-label={t('notes.form.removeTag', { tag })}
                className="hover:bg-accent focus-visible:ring-ring/50 rounded-full p-0.5 outline-none focus-visible:ring-[3px]"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        list={listId}
        value={text}
        maxLength={200}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t('notes.form.tagPlaceholder')}
        disabled={tags.length >= MAX_TAGS}
        aria-invalid={message ? true : undefined}
        aria-describedby={helpId}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
        }}
        // Leaving the field keeps what was typed as a tag, if valid.
        onBlur={() => {
          if (text && add(text)) setText('')
          else if (text) setInvalid(true)
        }}
      />
      <datalist id={listId}>
        {known?.filter((k) => !tags.includes(k.name)).map((k) => <option key={k.name} value={k.name} />)}
      </datalist>
      <p id={helpId} className={message ? 'text-danger text-sm' : 'text-muted-foreground text-xs'}>
        {message ?? t('notes.form.tagsHint')}
      </p>
    </div>
  )
}
