import { DatabaseBackup } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { PageHeader } from '@/shared/layout/PageHeader'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { LANGUAGES } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { THEME_ICONS } from '@/shared/theme/icons'
import { THEMES } from '@/shared/theme/theme'
import { useTheme } from '@/shared/theme/ThemeProvider'

import { ChangePasswordForm } from './ChangePasswordForm'
import { ChangeUsernameForm } from './ChangeUsernameForm'

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | undefined
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }>; lang?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-muted inline-flex flex-wrap gap-1 rounded-lg p-1">
      {options.map(({ value: v, label: text, icon: Icon, lang }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          lang={lang}
          onClick={() => onChange(v)}
          className={cn(
            'flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
            'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
            value === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {Icon && <Icon className="size-4" />}
          {text}
        </button>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="grid max-w-2xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('theme.label')}</CardTitle>
            <CardDescription>{t('settings.appearanceHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Segmented
              label={t('theme.label')}
              value={theme}
              onChange={setTheme}
              options={THEMES.map((v) => ({ value: v, label: t(`theme.${v}`), icon: THEME_ICONS[v] }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('language.label')}</CardTitle>
            <CardDescription>{t('settings.languageHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Segmented
              label={t('language.label')}
              value={i18n.resolvedLanguage}
              onChange={(code) => void i18n.changeLanguage(code)}
              options={LANGUAGES.map((l) => ({ value: l.code as string, label: l.label, lang: l.code }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('settings.account')}</h2>
            </CardTitle>
            <CardDescription>{t('account.hint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangeUsernameForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('settings.dataTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('settings.dataHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Long translations (uz) wrap instead of widening a phone screen. */}
            <Button asChild variant="outline" className="h-auto min-h-9 max-w-full py-2 text-left whitespace-normal">
              <Link to="/settings/data">
                <DatabaseBackup aria-hidden="true" />
                {t('settings.dataOpen')}
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('security.title')}</h2>
            </CardTitle>
            <CardDescription>{t('security.changeHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
