import { expect, test, type Page } from '@playwright/test'

import { apiCall, createNote, createProject, createReport, expectNoHorizontalOverflow, signIn } from './helpers.ts'

const UNSAFE = [
  '# Payloads',
  '',
  'Text <img src=x onerror="window.__xss=1"> and <svg onload="window.__xss=1"></svg>',
  '',
  '<script>window.__xss = 1</script>',
  '',
  '[click](javascript:window.__xss=1) [data](data:text/html,<script>window.__xss=1</script>)',
  '',
  '![pixel](https://tracker.invalid/p.png)',
  '',
  '```html',
  '<script>window.__xss = 1</script>',
  '```',
].join('\n')

/** Fails the test if anything tries to run script or open a dialog. */
async function watchForScript(page: Page) {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.type())
    void d.dismiss()
  })
  const remote: string[] = []
  page.on('request', (r) => r.url().includes('tracker.invalid') && remote.push(r.url()))
  return async () => {
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
    expect(dialogs).toEqual([])
    expect(remote).toEqual([]) // the image was never fetched
  }
}

test('create a note with the keyboard: tags, project, Markdown; it persists', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  const project = await createProject(page, `Notes ${Date.now()}`)
  await page.goto(`/projects/${project.id}`)
  await page.getByRole('link', { name: 'New note for this project' }).click()
  await page.getByLabel('Title').fill('Recon of api.example.com')
  await expect(page.getByLabel('Project (optional)')).toHaveValue(String(project.id))
  await page.getByLabel('Tags').focus()
  await page.keyboard.type('Recon')
  await page.keyboard.press('Enter') // adds, does not submit
  await page.keyboard.type('todo,')
  await expect(page.getByRole('button', { name: 'Remove tag recon' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove tag todo' })).toBeVisible()
  await page.getByLabel('Note').fill('## Hosts\n\n| host | port |\n|---|---|\n| api | 443 |\n\n```bash\nnmap -sV -p- api.example.com --script vuln --min-rate 5000 --max-retries 1 -oA scan-results-with-a-long-name\n```')
  const preview = page.getByRole('region', { name: 'Preview' })
  await expect(preview.getByRole('heading', { name: 'Hosts' })).toBeVisible()
  await expect(preview.locator('table')).toBeVisible()
  await page.getByRole('button', { name: 'Create note' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Recon of api.example.com' })).toBeVisible()
  await page.reload()
  const body = page.getByRole('region', { name: 'Note' })
  await expect(body.locator('pre code.hljs')).toContainText('nmap -sV')
  await expect(page.getByRole('link', { name: '#recon' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Activity' }).getByText('Note created')).toBeVisible()

  // The long code line scrolls inside its block; the page does not widen.
  const pre = body.locator('pre')
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expectNoHorizontalOverflow(page, 'note with long code line')

  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole('region', { name: 'Notes' }).getByRole('link', { name: 'Recon of api.example.com' })).toBeVisible()
})

test('unsafe Markdown never runs script, loads images or follows unsafe links', async ({ page }) => {
  await signIn(page)
  const check = await watchForScript(page)
  const note = await createNote(page, { title: 'XSS payloads', body_md: UNSAFE })
  await page.goto(`/notes/${note.id}`)
  const body = page.getByRole('region', { name: 'Note' })
  await expect(body.getByRole('heading', { name: 'Payloads' })).toBeVisible()
  await expect(body.locator('script, img, svg[onload], iframe')).toHaveCount(0)
  await expect(body.getByText('<script>window.__xss = 1</script>').first()).toBeVisible() // shown, not run
  await body.getByText('click', { exact: true }).click() // a dead link: nothing happens
  await expect(page).toHaveURL(`/notes/${note.id}`)
  // The editor's live preview is just as safe.
  await page.goto(`/notes/${note.id}/edit`)
  await expect(page.getByRole('region', { name: 'Preview' }).getByRole('heading', { name: 'Payloads' })).toBeVisible()
  await check()
})

test('editor modes: desktop Markdown/Split/Preview with the keyboard; phone Edit/Preview tabs', async ({ page }) => {
  await signIn(page)
  const note = await createNote(page, { title: 'Modes', body_md: '**bold** text' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/notes/${note.id}/edit`)
  const modes = page.getByRole('radiogroup', { name: 'Editor view' })
  await expect(modes.getByRole('radio', { name: 'Split' })).toHaveAttribute('aria-checked', 'true')
  const textarea = page.getByLabel('Note')
  const preview = page.getByRole('region', { name: 'Preview' })
  await expect(textarea).toBeVisible()
  await expect(preview.locator('strong')).toHaveText('bold')

  const radio = (name: string) => modes.getByRole('radio', { name })
  await radio('Split').focus()
  await page.keyboard.press('ArrowRight')
  await expect(radio('Preview')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(radio('Preview')).toHaveAttribute('aria-checked', 'true')
  await expect(textarea).toBeHidden()
  await page.keyboard.press('ArrowLeft')
  await expect(radio('Split')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(radio('Markdown')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(modes.getByRole('radio', { name: 'Markdown' })).toHaveAttribute('aria-checked', 'true')
  await expect(preview).toHaveCount(0)
  await expect(textarea).toHaveValue('**bold** text') // nothing lost

  await page.setViewportSize({ width: 375, height: 800 })
  await expect(page.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Edit' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Preview' }).locator('strong')).toHaveText('bold')
  await expect(textarea).toBeHidden()
  await expectNoHorizontalOverflow(page, 'phone preview tab')
})

test('unsaved edits: in-app warning and the browser prompt on reload', async ({ page }) => {
  await signIn(page)
  const note = await createNote(page, { title: 'Guarded', body_md: 'original' })
  await page.goto(`/notes/${note.id}/edit`)
  await page.getByLabel('Note').fill('changed but not saved')
  await page.getByRole('link', { name: 'Reports' }).first().click()
  const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page).toHaveURL(`/notes/${note.id}/edit`)
  await expect(page.getByLabel('Note')).toHaveValue('changed but not saved')

  // Reload: the browser's own "leave site?" prompt. Dismissing it stays on the page.
  const prompts: string[] = []
  const onDialog = (d: import('@playwright/test').Dialog) => {
    prompts.push(d.type())
    void d.dismiss()
  }
  page.on('dialog', onDialog)
  void page.evaluate(() => window.location.reload()).catch(() => {}) // does not resolve while blocked
  await expect.poll(() => prompts).toEqual(['beforeunload'])
  page.off('dialog', onDialog)
  await expect(page.getByLabel('Note')).toHaveValue('changed but not saved')

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page).toHaveURL(`/notes/${note.id}`) // saved: no warning
  await expect(page.getByRole('region', { name: 'Note' })).toContainText('changed but not saved')
})

test('tag and keyword filters with server-side pagination', async ({ page }) => {
  await signIn(page)
  const tag = `t${Date.now()}`
  for (let i = 1; i <= 25; i++) {
    await createNote(page, { title: `${tag} note ${String(i).padStart(2, '0')}`, tags: i % 5 === 0 ? [tag, 'special'] : [tag], body_md: i === 7 ? 'needle-in-body' : '' })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/notes?tag=${tag}&sort=title&order=asc`)
  await expect(page.getByText('1–20 of 25')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('21–25 of 25')).toBeVisible()
  await page.getByLabel('Tag', { exact: true }).selectOption('special')
  await expect(page.getByRole('main').getByRole('link', { name: new RegExp(`^${tag} note`) })).toHaveCount(5)
  await page.getByRole('button', { name: `Remove tag filter ${tag}` }).click()
  await page.getByLabel('Search title and text').fill('needle-in-body')
  await expect(page.getByRole('main').getByRole('link', { name: new RegExp(`^${tag} note`) })).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove tag filter special' }).click()
  await expect(page.getByRole('main').getByRole('link', { name: `${tag} note 07` })).toBeVisible()
})

test('deleting a project keeps its notes, unlinked', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `Temp ${Date.now()}`)
  const note = await createNote(page, { title: 'Survivor', project_id: project.id })
  expect((await apiCall(page, 'DELETE', `/api/projects/${project.id}`)).status()).toBe(204)
  await page.goto(`/notes/${note.id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Survivor' })).toBeVisible()
  expect((await (await page.request.get(`/api/notes/${note.id}`)).json()).project_id).toBeNull()
})

test('reports use the same editor and safe rendering', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  const check = await watchForScript(page)
  const project = await createProject(page, `RepEd ${Date.now()}`)
  const report = await createReport(page, project.id, { body_md: UNSAFE })
  await page.goto(`/reports/${report.id}/edit`)
  await expect(page.getByRole('radiogroup', { name: 'Editor view' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Preview' }).getByRole('heading', { name: 'Payloads' })).toBeVisible()
  await page.goto(`/reports/${report.id}`)
  const body = page.getByRole('region', { name: 'Report' })
  await expect(body.getByRole('heading', { name: 'Payloads' })).toBeVisible()
  await expect(body.locator('script, img, iframe')).toHaveCount(0)
  await check()
})

test('notes and editors fit 320/375/768/1024 px in all three languages', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page)
  const project = await createProject(page, `Lay ${'P'.repeat(50)}`)
  const long = `${'x'.repeat(300)}\n\n| ${'c'.repeat(80)} | ${'d'.repeat(80)} |\n|---|---|\n| 1 | 2 |\n\n\`\`\`\n${'y'.repeat(400)}\n\`\`\``
  const note = await createNote(page, { title: `Long ${'N'.repeat(100)}`, body_md: long, tags: ['a'.repeat(32), 'recon'], project_id: project.id })
  const report = await createReport(page, project.id, { body_md: long })
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const width of [320, 375, 768, 1024] as const) {
      await page.setViewportSize({ width, height: 800 })
      for (const path of ['/notes', '/notes/new', `/notes/${note.id}`, `/notes/${note.id}/edit`, `/reports/${report.id}/edit`, `/reports/${report.id}`]) {
        await page.goto(path)
        await expect(page.locator('main h1')).toBeVisible()
        await expectNoHorizontalOverflow(page, `${lang} ${width}px ${path}`)
      }
      if (width === 320 || width === 1024) {
        await page.goto(`/notes/${note.id}/edit`)
        await expect(page.getByLabel(/^(Note|Заметка|Qayd)$/)).toBeAttached()
        await page.screenshot({ path: `test-results/screens/note-edit-${lang}-${width}.png`, fullPage: true })
      }
    }
  }
})
