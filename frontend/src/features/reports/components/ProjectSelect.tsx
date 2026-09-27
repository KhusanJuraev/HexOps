import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SearchSelect } from '@/shared/components/SearchSelect'

import { useProjectOptions } from '../api'

interface Props {
  id: string
  value: number | null
  currentName?: string
  error?: string | null
  onChange: (id: number | null) => void
}

/** Required project for a report (projects come from the Projects HTTP API). */
export function ProjectSelect({ id, value, currentName, error, onChange }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { data } = useProjectOptions(search)
  return (
    <SearchSelect
      id={id}
      label={t('reports.form.project')}
      searchLabel={t('reports.form.projectSearch')}
      noneLabel={t('reports.form.projectNone')}
      value={value}
      options={data?.items ?? []}
      currentName={currentName}
      search={search}
      onSearch={setSearch}
      onChange={onChange}
      error={error}
    />
  )
}
