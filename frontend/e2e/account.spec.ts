import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createProject, expectNoHorizontalOverflow, PASSWORD, signIn, USER } from './helpers.ts'

/** Settings → Account: change username (D-91), on the disposable E2E database only. */

const RENAMED = 'e2e.renamed'

async function login(request: APIRequestContext, username: string) {
  return (await request.post('/api/auth/login', { data: { username, password: PASSWORD } })).status()
}

/** Put the shared E2E account back to "e2e", whatever happened in the test. */
async function restoreName(page: Page) {
  const ctx = page.request
  if ((await login(ctx, RENAMED)) !== 200) return
  const csrf = (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value
  const res = await ctx.post('/api/auth/username', {
    data: { new_username: USER, current_password: PASSWORD },
    headers: { 'X-CSRF-Token': csrf },
  })
  expect(res.status()).toBe(204)
}

test('rename through the UI: sessions end, the old name fails, the new one works, history follows', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  const project = await createProject(page, `Renamed owner ${Date.now()}`)
  // A second browser, signed in too: it must be signed out by the rename.
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5174' })
  expect(await login(other.request, USER)).toBe(200)
  expect((await other.request.get('/api/auth/me')).status()).toBe(200)

  try {
    await page.goto('/settings')
    const form = page.getByRole('form', { name: 'Change username' })
    await expect(form.getByText(USER, { exact: true })).toBeVisible()
    // Keyboard only: type the name, tab to the password, Enter to save.
    await form.getByLabel('New username').fill(RENAMED)
    await form.getByLabel('New username').press('Tab')
    await expect(form.getByLabel('Current password')).toBeFocused()
    await page.keyboard.type('not the password')
    await page.keyboard.press('Enter')
    await expect(form.getByText('The current password is incorrect.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible() // still signed in

    await form.getByLabel('Current password').fill(PASSWORD)
    await form.getByRole('button', { name: 'Save username' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Username changed. Sign in with the new username and your current password.')).toBeVisible()
    expect((await page.request.get('/api/auth/me')).status()).toBe(401) // this session ended
    expect((await other.request.get('/api/auth/me')).status()).toBe(401) // and the other browser's
    await other.close()

    expect(await login(page.request, USER)).toBe(401) // old name
    await page.getByLabel('Username').fill(RENAMED.toUpperCase()) // any letter case
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Back where the user was (Settings), now with the new name.
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Change username' }).getByText(RENAMED, { exact: true })).toBeVisible()

    // History is attributed to the account, shown with its current name.
    await page.goto(`/projects/${project.id}`)
    await expect(page.getByRole('region', { name: 'Activity' }).getByText(`by ${RENAMED}`).first()).toBeVisible()
  } finally {
    await restoreName(page)
  }
  expect(await login(page.request, USER)).toBe(200)
})

test('the account form fits a 320 px phone in all three languages, in light and dark', async ({ page }) => {
  await signIn(page)
  const cases = [
    ['en', 'Change username'],
    ['ru', 'Сменить имя пользователя'],
    ['uz', 'Foydalanuvchi nomini oʻzgartirish'],
  ] as const
  for (const [lang, formName] of cases) {
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript(
        ([l, t]) => {
          localStorage.setItem('hexops.lang', l)
          localStorage.setItem('hexops.theme', t)
        },
        [lang, theme],
      )
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/settings')
      await expect(page.getByRole('form', { name: formName })).toBeVisible()
      await expectNoHorizontalOverflow(page, `${lang} ${theme} 320 /settings`)
    }
  }
})

test('the username route needs a session, the CSRF token and a trusted origin', async ({ page }) => {
  const body = { new_username: 'someone', current_password: PASSWORD }
  expect((await page.request.post('/api/auth/username', { data: body })).status()).toBe(401)
  await signIn(page)
  expect((await page.request.post('/api/auth/username', { data: body })).status()).toBe(403) // no token
  const csrf = (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value
  const evil = await page.request.post('/api/auth/username', {
    data: body,
    headers: { 'X-CSRF-Token': csrf, Origin: 'http://evil.example' },
  })
  expect(evil.status()).toBe(403)
  expect((await (await page.request.get('/api/auth/me')).json()).user.username).toBe(USER)
})
