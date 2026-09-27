import { Languages, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { LANGUAGES } from '@/shared/i18n'
import { THEME_ICONS } from '@/shared/theme/icons'
import { THEMES, type Theme } from '@/shared/theme/theme'
import { useTheme } from '@/shared/theme/ThemeProvider'

/** Compact theme + language picker, used where the full settings page is unavailable. */
export function AppearanceMenu() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* One neutral "settings" glyph for both choices, rather than a sun or moon that
            reads as a theme toggle and hides that the language is also here. */}
        <Button variant="ghost" size="icon" aria-label={`${t('theme.label')} / ${t('language.label')}`} data-appearance-menu>
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map((value) => {
            const ItemIcon = THEME_ICONS[value]
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <ItemIcon className="text-muted-foreground" />
                {t(`theme.${value}`)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Languages className="text-muted-foreground size-4" />
          {t('language.label')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={i18n.resolvedLanguage}
          onValueChange={(code) => void i18n.changeLanguage(code)}
        >
          {LANGUAGES.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code} lang={lang.code}>
              {lang.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
