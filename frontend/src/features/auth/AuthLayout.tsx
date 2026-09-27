import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ConnectionBanner } from '@/features/connection'
import { AppearanceMenu } from '@/shared/layout/AppearanceMenu'
import { Logo } from '@/shared/layout/Logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

/** Centered card used by the sign-in and first-run setup pages. */
export function AuthLayout({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <AppearanceMenu />
      </div>
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Logo className="size-12" />
        <p className="text-muted-foreground text-sm">{t('app.tagline')}</p>
      </div>
      <ConnectionBanner className="mb-4 w-full max-w-sm" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription className={description ? undefined : 'sr-only'}>{description ?? t('app.tagline')}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  )
}
