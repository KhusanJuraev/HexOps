import { expect, test, type Page } from '@playwright/test'

// Must match backend/tests/e2e_server.py (throwaway user on a disposable database).
const USER = 'e2e'
const PASSWORD = 'e2e password for disposable db'

// Matches API requests only; a '**/api/**' glob would also catch /src/shared/api/*.ts modules in dev.
const API = (url: URL) => url.pathname.startsWith('/api/')

const WIDTHS = [320, 375, 768, 1024, 1440] as const
const PAGES = ['/', '/reports', '/projects', '/notes', '/settings', '/no-such-page'] as const

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })
  expect(res.status()).toBe(200)
}

/** Elements sticking out past the right edge, for a readable failure message. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders }
  })
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const o = await overflow(page)
  expect(o.scrollWidth, `${label}: page wider than viewport; offenders: ${o.offenders.join(', ')}`).toBeLessThanOrEqual(o.width)
}

/** Short description of the focused element: role/tag plus accessible-ish name. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'body'
    // Text as assistive tech reads it: aria-hidden parts (icons, rail tooltips) left out.
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
    const name = el.getAttribute('aria-label') || el.id || copy.textContent?.trim() || ''
    return `${el.tagName.toLowerCase()}:${name}`
  })
}

/** Whether the focused element draws a visible focus indicator (outline or ring). */
function hasFocusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
    const ring = s.boxShadow !== 'none' && s.boxShadow !== ''
    return outline || ring
  })
}

async function setLanguage(page: Page, code: 'en' | 'ru' | 'uz') {
  await page.addInitScript((lng) => localStorage.setItem('hexops.lang', lng), code)
}

test.describe('sign-in', () => {
  test('keyboard-only sign-in with visible focus', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/login')
    await expect(page.getByLabel('Username')).toBeVisible()

    const order: string[] = []
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab')
      order.push(await focused(page))
      expect(await hasFocusIndicator(page), `no focus indicator on ${order.at(-1)}`).toBe(true)
    }
    expect(order).toEqual(['button:Appearance / Language', 'input:username', 'input:password', 'button:Sign in'])

    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type(USER)
    await page.keyboard.press('Tab')
    await page.keyboard.type(PASSWORD)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${USER}` })).toBeVisible()
  })

  test('translated validation, not browser-native bubbles', async ({ page }) => {
    await setLanguage(page, 'ru')
    await page.goto('/login')
    await page.getByRole('button', { name: 'Войти' }).click()
    const username = page.getByLabel('Имя пользователя')
    await expect(username).toBeFocused()
    await expect(username).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#username-error')).toHaveText('Обязательное поле.')
    await expect(page.locator('#password-error')).toHaveText('Обязательное поле.')

    await username.fill('bad name')
    await page.getByLabel('Пароль').fill('x')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.locator('#username-error')).toContainText('От 3 до 64 символов')
  })

  test('wrong password reads as bad credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Username').fill(USER)
    await page.getByLabel('Password').fill('definitely wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Incorrect username or password.')).toBeVisible()
  })
})

test.describe('connection state', () => {
  test('shell shows Connected, then an outage banner and recovery', async ({ page }) => {
    await signIn(page)
    await page.goto('/')
    await expect(page.locator('[data-connection="online"]')).toBeVisible()

    await page.route('**/api/health', (route) => route.abort('connectionrefused'))
    // Returning to the tab re-checks the connection.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await expect(page.getByRole('alert').filter({ hasText: 'Can’t reach the HexOps server' })).toBeVisible()
    await expect(page.locator('[data-connection="offline"]')).toBeVisible()
    await expect(page).toHaveURL('/') // still signed in, not bounced to /login

    await page.unroute('**/api/health')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.locator('[data-connection="online"]')).toBeVisible()
    await expect(page.getByText('Connection restored')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Can’t reach' })).toHaveCount(0)
  })

  test('unreachable backend on load is an outage screen, not the login page', async ({ page }) => {
    await signIn(page)
    await page.route(API, (route) => route.abort('connectionrefused'))
    await page.goto('/projects')
    await expect(page.getByText('Can’t reach the HexOps server').first()).toBeVisible()
    await expect(page).toHaveURL('/projects')
    await expect(page.getByLabel('Password')).toHaveCount(0)

    await page.unroute(API)
    await page.getByRole('button', { name: 'Try again' }).first().click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  })

  test('API down behind the dev proxy (bare 500) is also an outage', async ({ page }) => {
    await page.route(API, (route) => route.fulfill({ status: 500, body: '' }))
    await page.goto('/')
    await expect(page.getByText('Can’t reach the HexOps server').first()).toBeVisible()
    await expect(page).not.toHaveURL(/login/)
  })
})

test.describe('keyboard navigation in the shell', () => {
  test('desktop: skip link, sidebar links with focus rings, menus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${USER}` })).toBeVisible()

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('main#main')).toBeFocused()

    // From the top again: skip link, the sidebar toggle, then the sidebar links in order.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${USER}` })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    const seen: string[] = []
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab')
      seen.push(await focused(page))
      expect(await hasFocusIndicator(page), `no focus indicator on ${seen.at(-1)}`).toBe(true)
    }
    expect(seen).toEqual(['button:Collapse sidebar', 'a:Dashboard', 'a:Search', 'a:Reports', 'a:Projects', 'a:Notes', 'a:Settings'])
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('/settings')

    // Header menus open and close with the keyboard, returning focus.
    const appearance = page.getByRole('button', { name: 'Appearance / Language' })
    await appearance.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(appearance).toBeFocused()
  })

  test('phone: menu drawer traps focus, closes on Escape and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await signIn(page)
    await page.goto('/')
    const menuButton = page.getByRole('button', { name: 'Open menu' })
    await expect(menuButton).toBeVisible()

    await page.keyboard.press('Tab') // skip link
    await page.keyboard.press('Tab')
    await expect(menuButton).toBeFocused()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'Main navigation' })
    await expect(drawer).toBeVisible()
    await expectNoHorizontalOverflow(page, 'drawer open at 320')

    // Focus stays inside the drawer while tabbing.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(menuButton).toBeFocused()

    // Following a link closes the drawer.
    await menuButton.click()
    await page.getByRole('dialog').getByRole('link', { name: 'Notes' }).click()
    await expect(page).toHaveURL('/notes')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('layout at 320 / 375 / 768 / 1024 / 1440 px', () => {
  // One test per language and width: each does 8 full page loads (~0.5 s each on the
  // Vite dev server), so it stays well inside the default 30 s budget. Measured before
  // the split: one test per language took 28–31 s and timed out on the Stage 6 dashboard.
  for (const lang of ['en', 'ru', 'uz'] as const) {
    for (const width of WIDTHS) {
      test(`no horizontal overflow on any page (${lang}, ${width}px)`, async ({ page }) => {
        await setLanguage(page, lang)
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/login')
        await expect(page.locator('#username')).toBeVisible()
        await expectNoHorizontalOverflow(page, `${lang} ${width}px /login`)
        if (lang === 'en') await page.screenshot({ path: `test-results/screens/login-${width}.png`, fullPage: true })

        await signIn(page)
        for (const path of PAGES) {
          await page.goto(path)
          await expect(page.locator('main h1')).toBeVisible()
          await expect(page.locator('[data-connection="online"]')).toBeVisible()
          await expectNoHorizontalOverflow(page, `${lang} ${width}px ${path}`)
        }
        if (lang !== 'en' || width <= 375) {
          await page.goto('/settings')
          await expect(page.locator('main h1')).toBeVisible()
          await page.screenshot({ path: `test-results/screens/settings-${lang}-${width}.png`, fullPage: true })
        }
      })
    }
  }

  test('sidebar form factor per width', async ({ page }) => {
    await signIn(page)
    const expectations = { 320: 'drawer', 375: 'drawer', 768: 'rail', 1024: 'full', 1440: 'full' } as const
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      const aside = page.locator('aside')
      const kind = expectations[width]
      if (kind === 'drawer') {
        await expect(aside).toBeHidden()
        await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
      } else {
        await expect(aside).toBeVisible()
        const box = await aside.boundingBox()
        expect(box!.width).toBe(kind === 'rail' ? 64 : 240)
      }
      await page.screenshot({ path: `test-results/screens/dashboard-${width}.png` })
    }
  })
})

test.describe('collapsible desktop sidebar', () => {
  const aside = (page: Page) => page.locator('aside#app-sidebar')
  const width = async (page: Page) => (await aside(page).boundingBox())!.width
  const content = (page: Page) => page.locator('main#main').locator('xpath=..')

  test('keyboard toggle, tooltips, active page, route changes, reload; tablet and phone unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${USER}` })).toBeVisible()
    expect(await width(page)).toBe(240)
    const before = (await content(page).boundingBox())!

    // Keyboard: skip link, then the toggle.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const toggle = page.getByRole('button', { name: 'Collapse sidebar' })
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    const expand = page.getByRole('button', { name: 'Expand sidebar' })
    await expect(expand).toBeFocused()
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => width(page)).toBe(64)
    // The content column grows into the freed space; nothing sticks out or is covered.
    const after = (await content(page).boundingBox())!
    expect(after.x).toBe(64)
    expect(after.width).toBe(before.width + 176)
    await expectNoHorizontalOverflow(page, 'collapsed 1440')

    // Icons only, each with a name and a tooltip on hover and on keyboard focus.
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    for (const name of ['Dashboard', 'Search', 'Reports', 'Projects', 'Notes', 'Settings']) {
      const link = nav.getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      expect((await link.boundingBox())!.width).toBeLessThanOrEqual(40)
    }
    await nav.getByRole('link', { name: 'Reports' }).hover()
    await expect(nav.getByRole('link', { name: 'Reports' }).locator('[data-nav-tooltip]')).toBeVisible()
    await page.keyboard.press('Tab') // from the toggle to the first link
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeFocused()
    await expect(nav.getByRole('link', { name: 'Dashboard' }).locator('[data-nav-tooltip]')).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

    // Route change keeps the rail; the active mark moves.
    await nav.getByRole('link', { name: 'Notes' }).click()
    await expect(page).toHaveURL('/notes')
    await expect(nav.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page')
    expect(await width(page)).toBe(64)

    // Reload keeps the choice; so does 1024 px.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    expect(await width(page)).toBe(64)
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect.poll(() => width(page)).toBe(64)
    await expectNoHorizontalOverflow(page, 'collapsed 1024')

    // Tablet keeps its rail and has no toggle; the phone drawer keeps its labels.
    await page.setViewportSize({ width: 800, height: 800 })
    await expect.poll(() => width(page)).toBe(64)
    await expect(page.locator('[data-sidebar-toggle]')).toBeHidden()
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(aside(page)).toBeHidden()
    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Main navigation' })
    await expect(drawer.getByText('Reports', { exact: true })).toBeVisible()
    await expect(drawer.locator('[data-sidebar-toggle]')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Expand again with a click: back to the full sidebar, remembered.
    await page.setViewportSize({ width: 1920, height: 900 })
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect.poll(() => width(page)).toBe(240)
    const label = nav.locator('a[href="/reports"] span:not([aria-hidden])')
    await expect(label).toHaveText('Reports')
    expect((await label.boundingBox())!.width).toBeGreaterThan(20) // a real label again, not sr-only
    await page.reload()
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
    expect(await width(page)).toBe(240)
  })

  test('labels and tooltips in UZ/RU/EN, in Light and Dark', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    const cases = {
      en: ['Expand sidebar', 'Reports'],
      ru: ['Развернуть боковую панель', 'Отчёты'],
      uz: ['Yon panelni yoyish', 'Hisobotlar'],
    } as const
    for (const [lang, [expandLabel, reports]] of Object.entries(cases)) {
      for (const theme of ['light', 'dark'] as const) {
        await page.addInitScript(
          ([l, t]) => {
            localStorage.setItem('hexops.lang', l)
            localStorage.setItem('hexops.theme', t)
            localStorage.setItem('hexops.sidebar', 'collapsed')
          },
          [lang, theme],
        )
        await page.goto('/reports')
        await expect(page.locator('html')).toHaveAttribute('lang', lang)
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/)
        await expect(page.getByRole('button', { name: expandLabel })).toBeVisible()
        const link = page.locator('aside#app-sidebar nav').getByRole('link', { name: reports })
        await expect(link).toHaveAttribute('aria-current', 'page')
        await link.hover()
        await expect(link.locator('[data-nav-tooltip]')).toHaveText(reports)
        await expect(link.locator('[data-nav-tooltip]')).toBeVisible()
        await expectNoHorizontalOverflow(page, `${lang} ${theme} collapsed`)
        await page.screenshot({ path: `test-results/screens/sidebar-collapsed-${lang}-${theme}.png` })
      }
    }
  })
})

test.describe('appearance button', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`shows the sliders icon in ${scheme} mode, on a phone and a desktop`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await signIn(page)
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/')
        const trigger = page.getByRole('button', { name: 'Appearance / Language' })
        await expect(trigger.locator('svg.lucide-sliders-horizontal')).toBeVisible()
        await expect(trigger.locator('svg.lucide-sun, svg.lucide-moon')).toHaveCount(0)
        const box = (await trigger.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(width) // stays on screen
        await trigger.click()
        await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        await trigger.screenshot({ path: `test-results/screens/appearance-${scheme}-${width}.png` })
      }
    })
  }
})

test.describe('persistence', () => {
  test('language and theme survive a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await signIn(page)
    await page.goto('/settings')
    await page.getByRole('radio', { name: 'Русский' }).click()
    await page.getByRole('radio', { name: 'Тёмное' }).click()
    await page.reload()

    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Русский' })).toHaveAttribute('aria-checked', 'true')

    // System follows the OS preference live.
    await page.getByRole('radio', { name: 'Как в системе' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('sign out ends the session', async ({ page }) => {
    await signIn(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Signed in as' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
    expect((await page.request.get('/api/auth/me')).status()).toBe(401)
  })
})

test.describe('error isolation', () => {
  // A page whose code cannot be downloaded (e.g. the server went away after an
  // update) must fail in place, not blank the whole app.
  // Matches the dev module (/src/features/projects/ProjectsPage.tsx) and the
  // production chunk (/assets/ProjectsPage-<hash>.js), so it works against preview too.
  const blockProjectsChunk = (page: Page) =>
    page.route(/\/ProjectsPage(\.tsx|-[\w-]+\.js)(\?|$)/, (route) => route.abort('connectionrefused'))

  test('a page that fails to load while navigating is contained in the shell', async ({ page }) => {
    await signIn(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: `Welcome, ${USER}` })).toBeVisible()
    await blockProjectsChunk(page)
    await page.getByRole('link', { name: 'Projects' }).first().click()
    await expect(page.getByRole('heading', { name: 'This page could not be displayed' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).first().click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('a page that fails on first load still shows the shell', async ({ page }) => {
    await signIn(page)
    await blockProjectsChunk(page)
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: 'This page could not be displayed' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
  })
})

test.describe('first-run setup with an existing account', () => {
  test('/setup shows the normal sign-in instead', async ({ page }) => {
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Repeat password')).toHaveCount(0)
  })

  test('the setup API is closed and does not touch the account', async ({ page }) => {
    const status = await page.request.get('/api/auth/setup')
    expect(await status.json()).toEqual({ required: false })
    const data = { username: 'intruder', password: 'x'.repeat(16), password_confirm: 'x'.repeat(16) }
    // Without a loopback Origin the request is refused before the account check.
    expect((await page.request.post('/api/auth/setup', { data })).status()).toBe(403)
    const res = await page.request.post('/api/auth/setup', { data, headers: { Origin: 'http://127.0.0.1:5174' } })
    expect(res.status()).toBe(409)
    await signIn(page) // the original account still works
  })
})

test.describe('change password', () => {
  const NEW_PASSWORD = 'e2e brand new passphrase'

  /** Put the original password back so the other tests keep working. */
  async function restore(page: Page) {
    await page.context().clearCookies()
    const login = await page.request.post('/api/auth/login', { data: { username: USER, password: NEW_PASSWORD } })
    if (login.status() !== 200) return // the change never happened
    const csrf = (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value
    const res = await page.request.post('/api/auth/password', {
      headers: { 'X-CSRF-Token': csrf },
      data: { current_password: NEW_PASSWORD, new_password: PASSWORD, new_password_confirm: PASSWORD },
    })
    expect(res.status()).toBe(204)
  }

  test('full flow on a phone: keyboard, show/hide, sign-out everywhere, old password rejected', async ({ page, browser }) => {
    // A second device that is signed in before the change.
    const other = await browser.newContext({ baseURL: `http://127.0.0.1:5174` })
    const otherLogin = await other.request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })
    expect(otherLogin.status()).toBe(200)

    try {
      await page.setViewportSize({ width: 375, height: 812 })
      await signIn(page)
      await page.goto('/settings')
      const form = page.getByRole('form', { name: 'Change password' })
      await expect(form).toBeVisible()
      await expectNoHorizontalOverflow(page, 'settings with security form at 375')

      // Wrong current password: field error, still signed in.
      await form.getByLabel('Current password').fill('definitely not it')
      await form.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
      await form.getByLabel('Repeat new password').fill(NEW_PASSWORD)
      await form.getByRole('button', { name: 'Change password' }).click()
      await expect(page.getByText('The current password is incorrect.')).toBeVisible()
      await expect(form.getByLabel('Current password')).toBeFocused()
      await expect(page).toHaveURL('/settings')

      // Show/hide via keyboard, then submit with Enter.
      await page.keyboard.type(PASSWORD)
      const toggle = form.getByRole('checkbox', { name: 'Show passwords' })
      await toggle.focus()
      await page.keyboard.press('Space')
      await expect(form.getByLabel('Current password')).toHaveAttribute('type', 'text')
      await page.keyboard.press('Space')
      await expect(form.getByLabel('Current password')).toHaveAttribute('type', 'password')
      await form.getByLabel('Repeat new password').focus()
      await page.keyboard.press('Enter')

      // Signed out everywhere, with a translated notice.
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('status').filter({ hasText: 'Password changed. Sign in with your new password.' })).toBeVisible()
      expect((await page.request.get('/api/auth/me')).status()).toBe(401)
      expect((await other.request.get('/api/auth/me')).status()).toBe(401)

      // Old password rejected, new password accepted through the UI.
      const oldLogin = await page.request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })
      expect(oldLogin.status()).toBe(401)
      await page.getByLabel('Username').fill(USER)
      await page.getByLabel('Password').fill(NEW_PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      // Back where the user was when the sessions were revoked.
      await expect(page).toHaveURL('/settings')
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
      await expect(page.getByText('Password changed.')).toHaveCount(0)

      // Nothing sensitive left in browser storage.
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
      expect(stored).not.toContain(NEW_PASSWORD)
      expect(stored).not.toContain(PASSWORD)
    } finally {
      await other.close()
      await restore(page)
    }
  })

  test('the form is translated (ru, uz)', async ({ page }) => {
    for (const [lng, title, toggle] of [
      ['ru', 'Смена пароля', 'Показать пароли'],
      ['uz', 'Parolni almashtirish', 'Parollarni koʻrsatish'],
    ] as const) {
      await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lng)
      await signIn(page)
      await page.goto('/settings')
      await expect(page.getByRole('form', { name: title })).toBeVisible()
      // Settings also has the username form with its own toggle: look inside this form.
      await expect(page.getByRole('form', { name: title }).getByRole('checkbox', { name: toggle })).toBeVisible()
      await page.getByRole('form', { name: title }).getByRole('button').click()
      await expect(page.locator('#current_password-error')).toBeVisible()
    }
  })
})
