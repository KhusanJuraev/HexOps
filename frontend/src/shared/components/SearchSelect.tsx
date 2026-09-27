import { useTranslation } from 'react-i18next'

import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

export interface SelectOption {
  id: number
  name: string
}

interface Props {
  id: string
  label: string
  searchLabel: string
  value: number | null
  options: SelectOption[]
  /** Shown for the current value when it is not among the (filtered) options. */
  currentName?: string | null
  noneLabel: string
  search: string
  onSearch: (text: string) => void
  onChange: (id: number | null) => void
  error?: string | null
}

/** A server-side search box next to a native select of the matching options. */
export function SearchSelect({ id, label, searchLabel, value, options, currentName, noneLabel, search, onSearch, onChange, error }: Props) {
  const { t } = useTranslation()
  const missing = value !== null && !options.some((o) => o.id === value)
  return (
    <div className="grid grid-cols-1 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          maxLength={200}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <NativeSelect
          id={id}
          value={value ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{noneLabel}</option>
          {missing && <option value={value}>{currentName ?? t('common.loading')}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
