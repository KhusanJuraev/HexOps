# HexOps

A private, local-first workspace for security research: projects, reports and
Markdown notes, running on your own machine and bound to `127.0.0.1` by default.

**Status:** early open-source release. Linux installation is tested (Debian 13); the
Windows installer is **not fully verified on Windows**: it passes static checks and its
own tests, but no complete installation on Windows has been confirmed yet.
What works:
- sign-in, first-run setup, password and username change;
- the app shell, three languages (Oʻzbekcha / Русский / English) and three themes
  (Light / Dark / System);
- **Projects**: type, status, start date, description, an ordered in-scope asset
  list, activity history, and a server-side filtered, sorted and paginated list;
- **Reports**:
  - CVE / BBP / VDP / Pentest types, a manual severity plus an optional CVSS
    score and vector, and an optional bounty;
  - an enforced status workflow with one-step undo;
  - Markdown body and evidence files;
  - a filterable, sortable, paginated list.
- **Notes**: Markdown notes with tags and an optional project, with tag and keyword
  filters.
- **One Markdown editor** for reports and notes:
  - Markdown / Split / Preview on desktop, Edit / Preview tabs on phones;
  - a live, safe preview;
  - a warning before leaving with unsaved changes.

- **Search** across reports and notes (titles and Markdown bodies), with note tags.
- **Dashboard**: findings by severity, findings over time, reports by status, active
  projects, recent activity and paid bounty earnings per currency, all computed live;
  recorded BBP amounts not marked Paid appear separately.
- **PDF export** of reports and notes (rendered, with metadata) and **PDF import** of
  text PDFs into a Markdown draft that you review and save as a new report or note.
- **Full data transfer**: encrypted `.hexops` export and checked, replace-only import
  under Settings → Data (the archive must match the current database schema).

Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).
To add a module or page, follow [docs/ADDING_A_MODULE.md](docs/ADDING_A_MODULE.md).

## Requirements

- Python 3.12+ (with `venv`)
- Node.js 20.19+ and npm
- PostgreSQL 15+ running on this computer (127.0.0.1:5432)
- About 1 GB of disk space (packages, the PDF renderer, the build)

Docker is not required. Everything listens on `127.0.0.1` only.

## Install — Linux (tested on Debian 13)

```bash
git clone https://github.com/KhusanJuraev/HexOps.git hexops && cd hexops
./install-linux.sh --create-database     # first install: creates a PostgreSQL role + database
./start-linux.sh                          # then open http://127.0.0.1:4173
```

- `--create-database` explains and asks before running `sudo -u postgres psql` to create
  the role `hexops` (random password) and database `hexops`; it never drops or changes an
  existing one. Already have a database? Use
  `./install-linux.sh --database-url 'postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/DB'`.
- The installer checks Python, Node.js and PostgreSQL (and tells you what to install if
  something is missing), creates `backend/.env` with a random secret key **only if it
  does not exist**, installs the backend in `backend/.venv` and the PDF renderer
  (Chromium), builds the UI, runs the database migrations, starts HexOps briefly to check
  the API, the UI and the connection between them, and stops it again.
- Run it as your normal user, not root. It is safe to run again (it never touches your
  account, records, evidence files or `.env`). If any step fails it says which one and
  exits with an error — it never reports a failed installation as done.
- Missing packages on Debian/Ubuntu: `sudo apt install python3 python3-venv nodejs npm
  postgresql`. If Chromium cannot start, run once:
  `sudo backend/.venv/bin/python -m playwright install-deps chromium`.

## Install — Windows 10/11 (PowerShell) — not fully verified on Windows

> `install-windows.ps1` was checked on Linux (PowerShell 7 parser and PSScriptAnalyzer,
> PowerShell 5.1 syntax rules). Its Python detection is covered by
> `scripts/test-install-windows.ps1`. A first run on Windows found a Python detection
> bug, now fixed; a complete installation on Windows **has not been confirmed yet**.
> Please report problems.

1. Install the prerequisites, then open a **new** PowerShell window:

   ```powershell
   winget install Python.Python.3.12
   winget install OpenJS.NodeJS.LTS
   winget install PostgreSQL.PostgreSQL.17     # remember the postgres password, keep port 5432
   ```

2. Install and start HexOps (the `-ExecutionPolicy Bypass` flag applies to that one
   command only; the system policy is not changed):

   ```powershell
   cd hexops
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -CreateDatabase
   powershell -ExecutionPolicy Bypass -File .\start-windows.ps1 -Open
   ```

   `-CreateDatabase` runs `psql -U postgres` (it asks for the postgres password) to create
   the role and database, as on Linux. Or pass
   `-DatabaseUrl "postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/DB"`.

## First start

Open http://127.0.0.1:4173. On an empty database HexOps shows **Create the owner
account**: choose your own username and password (12+ characters). There is no default
account and no sign-up — this page only works from this computer and only once; after
that it shows the normal sign-in page. See *First-run setup* below.

## Daily use

```bash
./start-linux.sh           # Linux; --open also opens the browser; Ctrl+C stops everything
```

```powershell
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1       # Windows; -Open opens the browser
```

The start scripts run the API (`127.0.0.1:8000`) and the built UI
(`http://127.0.0.1:4173`, which forwards `/api` to the API) and stop both when you stop
them. Ports come from `HEXOPS_PORT` / `HEXOPS_UI_PORT` in `backend/.env`. Start them as
your own user (see *Run as your own user*).

## Upgrade

```bash
git pull
./install-linux.sh         # Windows: powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

The installer updates the packages, rebuilds the UI and applies new database
migrations; your `.env`, account, records and files stay as they are. Back up first
(*Backup and restore* or Settings → Data) before a big upgrade.

## Manual setup (developers)

The installers do all of this; these are the individual steps, e.g. for development
(which also needs the `dev` extras and the test databases).

### Linux

```bash
# Database (as the postgres superuser)
sudo apt install postgresql python3-venv nodejs npm
sudo -u postgres psql -c "CREATE ROLE hexops LOGIN PASSWORD '<strong password>'"
sudo -u postgres psql -c "CREATE DATABASE hexops OWNER hexops"
sudo -u postgres psql -c "CREATE DATABASE hexops_test OWNER hexops"
sudo -u postgres psql -c "CREATE DATABASE hexops_e2e OWNER hexops"    # optional: browser tests

# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/playwright install --only-shell chromium   # PDF export renderer (~100 MB, once)
cp .env.example .env          # set the DB URLs and HEXOPS_SECRET_KEY
.venv/bin/python -c "import secrets; print(secrets.token_urlsafe(48))"   # → HEXOPS_SECRET_KEY
.venv/bin/alembic upgrade head
.venv/bin/python -m app.cli create-user <username>   # optional: or use first-run setup in the browser

# Frontend
cd ../frontend
npm install
```

### Windows

> These steps follow the Linux procedure, but they **have not been run on Windows
> yet**. If something fails, please report it.

1. Install the prerequisites. Either use the official installers, or:

   ```powershell
   winget install Python.Python.3.12
   winget install OpenJS.NodeJS.LTS
   winget install PostgreSQL.PostgreSQL.17
   ```

   During the PostgreSQL install, set a password for the `postgres` superuser and
   keep port `5432`. Open a new terminal afterwards so that `PATH` is refreshed.
   If `psql` is not found, add `C:\Program Files\PostgreSQL\17\bin` to `PATH`.

2. Create the database role and databases:

   ```powershell
   psql -U postgres -h 127.0.0.1 -c "CREATE ROLE hexops LOGIN PASSWORD '<strong password>'"
   psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE hexops OWNER hexops"
   psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE hexops_test OWNER hexops"
   psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE hexops_e2e OWNER hexops"   # optional: browser tests
   ```

3. Set up the backend:

   ```powershell
   cd backend
   py -3.12 -m venv .venv
   .venv\Scripts\python -m pip install -e ".[dev]"
   .venv\Scripts\playwright install --only-shell chromium   # PDF export renderer
   Copy-Item .env.example .env        # then edit .env: DB URLs and HEXOPS_SECRET_KEY
   .venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))"
   .venv\Scripts\alembic upgrade head
   .venv\Scripts\python -m app.cli create-user <username>   # optional: or first-run setup
   ```

   If PowerShell blocks scripts, you don't need to activate the venv. The commands
   above call `.venv\Scripts\...` directly.

4. Set up the frontend:

   ```powershell
   cd ..\frontend
   npm install
   ```

## Run (development)

Use two terminals.

| | Linux | Windows (PowerShell) | Address |
|-|-------|----------------------|---------|
| API | `cd backend && .venv/bin/python -m app` | `cd backend; .venv\Scripts\python -m app` | http://127.0.0.1:8000 |
| UI  | `cd frontend && npm run dev` | `cd frontend; npm run dev` | http://127.0.0.1:5173 |

Open http://127.0.0.1:5173 and sign in. The dev server forwards `/api` to the backend.

Both servers bind to loopback (`127.0.0.1`). The API port is set with `HEXOPS_PORT`
in `backend/.env`. The UI port is fixed at 5173 (`strictPort`).

## Checks

```bash
# Linux
cd backend  && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

```powershell
# Windows
cd backend;  .venv\Scripts\ruff check .; .venv\Scripts\ruff format --check .; .venv\Scripts\pytest
cd frontend; npm run typecheck; npm run lint; npm test; npm run build
```

The tests use `HEXOPS_TEST_DATABASE_URL` and **wipe that database** on every run.
They refuse to run if it is the same database as `HEXOPS_DATABASE_URL`.

### Browser tests (Playwright)

```bash
cd frontend
npx playwright install chromium firefox   # one-time browser download
npm run e2e                               # Chromium + Firefox
```

`npm run e2e` starts its own API on `127.0.0.1:8001` against `HEXOPS_E2E_DATABASE_URL`
(**wiped on every run**, and it must differ from the dev and test databases), plus a
Vite server on `127.0.0.1:5174`. Your dev servers and dev data are not touched. The
suite covers sign-in, keyboard navigation, the connection indicator and outages,
language and theme persistence, and horizontal overflow at 320/375/768/1024/1440 px
in all three languages.

To run the same suite against the production build instead of the Vite dev server
(D-82):

```bash
npm run build
HEXOPS_E2E_PREVIEW=1 npx playwright test
```

This serves `dist/` with `vite preview` on `127.0.0.1:5174`, proxying `/api` to the same
disposable API on `127.0.0.1:8001`. `npm run dev` and plain `npm run e2e` are unchanged.

If you run it as root inside another user's desktop session, Firefox refuses to
start. Use `env -u XAUTHORITY HOME=/root npm run e2e`.

## First-run setup

On an empty database, opening HexOps shows **Create the owner account** instead of
sign-in. Enter a username, a password of at least 12 characters, and the password
again. The account is created and you are signed in. The page is available in
Uzbek, Russian and English.

Safety rules:
- **This machine only.** Setup is allowed only from a browser on the machine that
  runs HexOps (`http://127.0.0.1:5173`). A request from another computer gets
  `403 setup_local_only`, even when the UI is shared on the LAN. The Vite proxy
  forwards the real client address (`xfwd`), and every hop must be loopback.
- **Exactly once.** A unique database index allows only one row in `users`, so two
  simultaneous submissions cannot create two owners. After setup, the endpoint always
  answers `409 setup_closed`. There is no sign-up.
- **Existing accounts are never changed.** If an account already exists, the normal
  sign-in page is shown.
- **The password is never stored as plain text.** It is hashed with Argon2id. It is
  never written to `.env`, logs, browser storage or source code.

On a server without a browser, use `python -m app.cli create-user <username>` as
before. It follows the same one-account rule.

## Changing the username

**Settings → Account** shows your current username. Enter a new one (3–64 characters:
letters, digits, `.`, `_`, `-`; letter case does not matter and names are stored in
lower case) and your current password, then **Save username**.

- Only the login name changes: the account keeps its id and password, and every
  project, report, note, evidence file and history entry stays linked to it.
- Afterwards **every session is signed out**; sign in with the new name and the same
  password. The old name no longer works.
- Wrong passwords are rate-limited like logins; a name equal to the current one (in any
  letter case) is refused.
- **History shows the account's current name**, not the name at the time: events are
  stored with the account id and the name is looked up when they are displayed.
- `python -m app.cli set-password <username>` takes the new name. Exported `.hexops`
  files record the name at export time for information only; on import, history is
  attributed to the importing account.

## Changing the password

While signed in, go to **Settings → Security → Change password** and enter:
- the current password;
- a new password of at least 12 characters;
- the new password again.

The server checks the current password, rejects reuse of it, and hashes the new one
with Argon2id. After a successful change **every session is signed out**, including
the current browser. You then land on the sign-in page with a confirmation message.

If the change fails, you stay signed in and the problem is shown next to the field.
Wrong current passwords are rate-limited like logins. Passwords are sent only in the
request body, never in URLs, logs, responses or browser storage.

## Markdown safety

Reports and notes are rendered with `react-markdown` + GFM:
- **Raw HTML** in the text is shown as literal text, never run.
- **Links** keep only `http(s)`, `mailto`, `#anchor` and relative targets.
- **Images** are never fetched automatically (that would reveal to a remote server
  that you opened the note). They are shown as links instead.
- **Code** fences are highlighted for about 25 common languages and scroll inside
  their block.

## Run as your own user

Run HexOps as the account that owns the checkout, not as root. Otherwise the
uploads, caches and build files it creates become root-owned and your user cannot
change them. If that has happened, fix only the project:

```bash
sudo chown -R "$USER": ~/hexops
```

## Daily-use guide

1. **Start** the API and the UI (*Daily use* above) and open http://127.0.0.1:4173.
2. **Projects → New project** for each program or client; list the in-scope assets.
3. From a project, **New report for this project**. Write in Markdown (Split view
   shows the preview), attach screenshots and PoCs under **Evidence**, and move the
   status along (**Mark as Submitted**, …). A wrong step can be undone once.
4. **Notes** for recon output, payloads and cheat sheets; tag them (`recon`, `todo`).
5. **Search** (sidebar) finds words in UZ/RU/EN and CVE ids, IPs and domains in both.
6. The **Dashboard** is computed from your records; there is nothing to fill in.
7. **Export PDF** on a report or note; **Import PDF** on the Reports/Notes lists turns
   a text PDF into a draft you review before saving it as a new record.
8. **Back up** the database and `data/uploads/` together (*Backup and restore*),
   e.g. weekly and before upgrades.

## Dates

Dates are shown and typed as **DD/MM/YYYY** — day first — and times as **HH:mm** on a
24-hour clock, in every language: `05/06/2026` is 5 June 2026. Date fields accept
`05/06/2026`, `5/6/2026` or `05.06.2026` (four-digit years only) and have a calendar
button. Times you see are in your computer's time zone; the database stores UTC, and
exported PDFs label their times `UTC`. Dashboard months are UTC calendar months.

## How search matches

- **All words must match.** Words are matched with PostgreSQL full-text search:
  - English and Russian words match their other forms ("exploit" finds "exploits",
    "уязвимость" finds "уязвимости");
  - Uzbek words match as written, with apostrophes optional ("koʻrinish",
    "ko'rinish" and "korinish" are the same).
- **Identifiers match as substrings anywhere in the text,** served by trigram
  indexes. An identifier is anything with a dot, colon, slash, `@`, or a digit next
  to a hyphen: CVE ids, IPs, domains, URLs, e-mails. So `example.com` finds
  `api.example.com`, and `10.0.0.5` also finds `10.0.0.50`.
- **Bounds:** at most 8 terms of 100 characters, 50 results per page, and a 5-second
  time limit per search.

## Evidence files

Report evidence is stored on disk in `data/uploads/` (repo root; change it with
`HEXOPS_UPLOADS_DIR`). The file metadata is in PostgreSQL.

**Stored files:**
- Files get random 32-character names.
- The original name is kept only as display text.
- Allowed types:
  - images (PNG, JPEG, GIF, WebP);
  - PDF;
  - UTF-8 text and source files (`.txt .md .log .json .xml .yaml .csv .har .http .py .js .sh .html …`).
- The type is checked from the file's content, not its name or the browser's claim.

**Limits:** 25 MB per file (`HEXOPS_MAX_UPLOAD_BYTES`) and 100 files per report
(`HEXOPS_MAX_ATTACHMENTS_PER_REPORT`).

**Safety:**
- HexOps never opens, runs or renders an uploaded file.
- Downloads are always `Content-Disposition: attachment` with `nosniff`, and HTML
  PoCs are served as plain text.
- Every file route requires sign-in.

## PDF export and import

**Export.** On a report or note page, **Export PDF** prints what is saved (not unsaved
edits) in the current UI language: title, metadata (project, type, severity, CVSS,
status, dates, bounty, or the note's tags), then the Markdown body with headings,
tables, code blocks and task lists. A line containing only `\pagebreak` starts a new
page. Headings become PDF bookmarks. The PDF is made in the background; the button
turns into **Download PDF** when it is ready.

- Markdown is rendered with raw HTML escaped, and only `http(s)`, `mailto` and `#`
  links are kept. Images are printed as `[Image: alt] url` and never fetched.
- Chromium prints with JavaScript disabled, offline, and with every request aborted,
  so a document cannot load a URL or a local file.
- Fonts are the system's (DejaVu / Noto / Liberation on Linux).

**Import.** *Reports → Import PDF* (or *Notes → Import PDF*) turns a text PDF into
a Markdown draft: text in reading order, headings (from the PDF bookmarks, or font
size), monospace text as code blocks, bullet lists, and ruled tables as Markdown
tables. You review and edit the draft, then continue to the normal **new** report or
note form. Nothing is saved before that, and existing records are never changed.

- **Limits:** 20 MB (`HEXOPS_PDF_IMPORT_MAX_BYTES`) and 200 pages
  (`HEXOPS_PDF_IMPORT_MAX_PAGES`).
- **Refused, with a translated message:** files that are not PDFs, damaged or
  password-protected PDFs, too many pages, too much text for a record, and
  image-only (scanned) PDFs. **There is no OCR.**
- **Needs manual correction:** multi-column layouts, merged or borderless table
  cells, images (skipped), text wrapped inside long code lines, and headers/footers on
  a one-page PDF (repeated ones on longer PDFs are removed).

**Jobs.** Exports and imports run one at a time in a background thread of the API
process, so other requests are never blocked. Their state is in the `pdf_jobs` table;
the page waits for changes with a long-poll request (no rapid polling).

- Files (the uploaded PDF, the exported PDF) live in `data/pdf-jobs/` (0700/0600,
  random names; `HEXOPS_PDF_DIR`). An upload is deleted as soon as it has been read.
- Results expire after 60 minutes (`HEXOPS_PDF_RESULT_TTL_MINUTES`) and are deleted
  with their files. Each job is stopped after 120 s (`HEXOPS_PDF_JOB_TIMEOUT_SECONDS`).
- **After a restart**, jobs that were queued or running are marked failed ("interrupted
  by a restart") and their files are deleted; start them again. Nothing is resumed
  half-way.
- Every PDF route requires sign-in; downloads are `attachment`, `no-store`.

## Full export and import (Settings → Data)

**Settings → Data → Export or import data** writes everything into one encrypted
`.hexops` file, or brings such a file into this installation — for moving to another
computer, or as a portable backup.

**Included:** projects and scope, reports (all fields, status dates, bounty), evidence
files (bytes and metadata), notes and tags, the activity history.
**Not included:** accounts and passwords, sessions and CSRF tokens, `backend/.env`,
PDF jobs, temporary files and caches. The records are attached to the account of the
installation they are imported into.

**Format (version 1):** an Argon2id-derived key (64 MiB, 3 passes) and AES-256-GCM in
authenticated 1 MiB chunks; inside, a ZIP with `manifest.json` (format and schema
version, record counts, file sizes and SHA-256 of every part), `data/<table>.json` and
`files/<name>`. A wrong passphrase, a changed byte, a cut-off or extended file are all
detected. The passphrase (12+ characters) is never stored or logged — **if it is lost,
the file cannot be opened.**

**Export** takes a consistent snapshot: while it runs (seconds for typical data), other
writes are refused with "A data export or import is running" and reads keep working.
The file stays downloadable for 60 minutes, then it is deleted from the server.

**Import** runs in two steps:

1. *Check archive* — decrypts and checks everything (format and schema version, sizes
   and entry count, file paths, checksums, duplicate ids, links between records) and
   shows what is in it, what is here now and the disk space needed. Nothing changes.
2. *Import* — asks for the passphrase again. On an empty installation it imports. If
   this installation has data, you must tick "I understand…" and confirm **Replace all
   data**; HexOps first writes an encrypted backup of the current data to
   `data/backups/pre-import-….hexops` (same passphrase) and verifies it by reading it
   back. Then all records are replaced in one database transaction and the evidence
   directory is swapped. Any failure leaves the previous data exactly as it was; a
   crash in the middle is repaired at the next start. Records are never merged.

The archive must come from the **same HexOps version** (database schema); update both
installations first. Limits: 2 GiB per archive, 8 GiB unpacked, 200,000 entries
(`HEXOPS_TRANSFER_MAX_ARCHIVE_BYTES`, `…_MAX_UNPACKED_BYTES`, `…_MAX_ENTRIES`).

### Moving HexOps to a new computer (Linux, verified 2026-09-27)

1. **Old computer:** Settings → Data → enter a passphrase twice → *Create encrypted
   export* → *Download .hexops file*. Keep the file and the passphrase.
2. **New computer:** install HexOps (*Setup — Linux* above: database, `pip install`,
   `playwright install --only-shell chromium`, `.env`, `alembic upgrade head`) — the
   same HexOps version as the old one.
3. Create the owner account there: open http://127.0.0.1:4173 (or `:5173`) and use
   **first-run setup**, or run `.venv/bin/python -m app.cli create-user <username>`.
   It can be a different name and password; the imported history is attributed to it.
4. Start HexOps as your user (*Daily use*), sign in, Settings → Data → *Choose a
   .hexops file…* → passphrase → *Check archive* → check the counts → passphrase again →
   *Import*.
5. Check a few reports and their evidence. Keep the `.hexops` file until you are sure.

This was run end to end with two real servers on disposable databases: every project,
report, status date, bounty, note, tag, history entry and evidence file matched (files
byte for byte), and new records continued after the imported ids. **Windows: not run.**

## Backup and restore

Two ways: the encrypted **full export** above (one file, from the UI), or the database
dump plus `data/uploads/` below (for administrators; not encrypted). `data/transfer/`
holds short-lived transfer files; `data/backups/` holds the pre-import backups — keep or
delete them as you like.

A complete backup has **two parts that belong together**: the PostgreSQL database
and the `data/uploads/` directory. A database without the files has dangling
evidence; files without the database are unnamed blobs.

Stop the backend first, so no upload happens between the two steps.

```bash
# Linux — back up
pg_dump -h 127.0.0.1 -U hexops -Fc hexops > hexops-$(date +%F).dump
tar -czf hexops-uploads-$(date +%F).tar.gz -C .. data/uploads     # run from backend/

# Restore into an empty database, then put the files back
pg_restore -h 127.0.0.1 -U hexops -d hexops --clean --if-exists hexops-YYYY-MM-DD.dump
tar -xzf hexops-uploads-YYYY-MM-DD.tar.gz -C ..
.venv/bin/alembic upgrade head    # if the backup is from an older version
```

```powershell
# Windows — back up (PowerShell, from backend\)
pg_dump -h 127.0.0.1 -U hexops -Fc hexops -f hexops-backup.dump
Compress-Archive -Path ..\data\uploads -DestinationPath hexops-uploads.zip
# Restore
pg_restore -h 127.0.0.1 -U hexops -d hexops --clean --if-exists hexops-backup.dump
Expand-Archive hexops-uploads.zip -DestinationPath ..\data -Force
```

`data/pdf-jobs/` holds only short-lived PDF job files and does not need a backup.

Keep backups private: they contain your research, and the database contains the
password hash.

**Verified (Linux, 2026-09-27):** the commands above were run on disposable
databases: a filled copy was dumped and archived, restored into another empty
database and directory, and compared through the API. Projects with scope, reports
with status dates, notes with tags and project links, evidence metadata and every
evidence file's bytes (sha256) matched. **The Windows commands have not been run on
Windows.**

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Header shows **Offline** / "Can’t reach the HexOps server" | The API is not running or not on the port the UI forwards to. Start `python -m app`; check `HEXOPS_PORT` and, for a non-default API port, start the UI with `HEXOPS_API_URL=http://127.0.0.1:<port>`. |
| **Database down** / "The database is unavailable" | PostgreSQL is stopped or `HEXOPS_DATABASE_URL` is wrong. `sudo systemctl start postgresql`; test with `psql`. |
| API refuses to start: "not a loopback address" | `HEXOPS_HOST` is not 127.0.0.1. That is deliberate; see *Security notes*. |
| Sign-in fails with "Too many attempts" | 5 failures from one address for one username lock it for 5 minutes. Wait, or restart the API. |
| Forgot the password | `python -m app.cli set-password <username>` (*Account recovery*). |
| Saving fails with "The request came from an untrusted address" | The UI runs on a port the API does not trust. Use `:5173`/`:4173`, or add the origin to `HEXOPS_TRUSTED_ORIGINS`. |
| `alembic` says the database is behind | `cd backend && .venv/bin/alembic upgrade head` (after pulling new code or restoring an old backup). |
| **Export PDF** fails: "renderer is not installed" | `cd backend && .venv/bin/playwright install --only-shell chromium` as the user that runs the API. |
| Import says "OCR is not available" | The PDF is scanned (no text layer). Export it with text from the source, or copy the text in by hand. |
| Permission denied under `data/`, `node_modules/` or `dist/` | Something ran as root. `sudo chown -R "$USER": ~/hexops`, then always run as your user. |
| Port already in use | Another copy is running: `ss -ltnp | grep -E ':(8000|5173|4173)'`, stop it. |
| Firefox E2E refuses to start as root | `env -u XAUTHORITY HOME=/root npm run e2e`. |
| Installer: "port 8000 (or 4173) is already in use" | HexOps (or something else) is running. Stop it, or set `HEXOPS_PORT` / `HEXOPS_UI_PORT` in `backend/.env`. |
| Installer: "Chromium … cannot start" (Linux) | Missing system libraries: `sudo backend/.venv/bin/python -m playwright install-deps chromium`, then run the installer again. |
| Installer: "role 'hexops' already exists" | A previous install created it; the installer does not know its password. Use `--database-url` (`-DatabaseUrl`) with that password, or the existing `backend/.env`. |
| Installer: "cannot connect to PostgreSQL" | Start the service (`sudo systemctl start postgresql`; Windows: Services → postgresql) and check the URL in `backend/.env`. |
| Windows: "running scripts is disabled" | Use `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1` (this command only); do not change the system policy. |
| Installer: PDF renderer download "timed out" | Nothing to do by hand: when Playwright's own download fails, the installer downloads the same official archives with `curl` (`curl.exe` on Windows), checks them, and lets Playwright install them from `127.0.0.1`. It prints what it observed (whether Playwright's Node.js and curl can each reach the download server). |
| Installer: "Could not install the PDF renderer" | The fallback failed too. Your database, `backend/.env` and data are unchanged — run the installer again; finished parts are not downloaded again. If it keeps failing, allow outbound HTTPS (port 443) for the programs named in the message in your firewall or antivirus, or set `HTTPS_PROXY` if your network requires a proxy. |
| Setup page does not appear | An account already exists (then sign in, or reset its password with the CLI), or you are not on the same computer (setup is loopback-only). |

## Extending HexOps

New features are added as modules without touching the existing ones: a backend
package in `backend/app/modules/<name>/` (router, service, schemas, models, `public.py`,
a migration, tests) registered once in `app/main.py` and `app/models.py`, and a frontend
folder in `frontend/src/features/<name>/` registered in `src/app/modules.ts`, with its
texts in all three locale files. Architecture tests enforce the import boundaries and
that every route requires a session and CSRF. Step by step:
[docs/ADDING_A_MODULE.md](docs/ADDING_A_MODULE.md).

## Performance (measured, not guaranteed)

Measured on 2026-09-27 on one VirtualBox VM (4 vCPU i5-11600T, 7.8 GB RAM, Debian 13,
PostgreSQL 17 with default settings) with a disposable database of **10,000 reports
and 10,000 notes** (avg. body 2.8 KB / 1.6 KB, three languages, 200 projects, 40,783
activity entries). Medians of 15 requests over loopback / 5 page loads in Chromium:

| | API | Page ready |
|---|---|---|
| Reports / Notes list, first or last page, filters, sorts | 4–21 ms | 126–146 ms |
| Notes list with a keyword matching 21 % of notes | 143 ms | — |
| Search, word present in 97 % of records | 152 ms | 352 ms |
| Search, CVE id / IP / domain fragment | 49–87 ms | 235 ms |
| Dashboard (each widget) | 4–9 ms | 248 ms (all widgets) |
| Report / note detail | 4–5 ms | 126–140 ms |

Lists send 20 rows, never all.
Your numbers depend on your hardware and data.

## Account recovery

There is no signup and no email reset. If you forget the password, run this on the
machine that hosts HexOps:

```bash
cd backend
.venv/bin/python -m app.cli set-password <username>      # Windows: .venv\Scripts\python -m app.cli set-password <username>
```

The password is entered at a hidden prompt. It never appears on the command line
or in logs. Changing it signs out every existing session. Session lifetime is set by
`HEXOPS_SESSION_TTL_HOURS` (default 168) and `HEXOPS_SESSION_IDLE_HOURS`
(default 24).

## LAN access over HTTPS (later)

HexOps currently runs **loopback-only**: the API on `127.0.0.1:8000` and the UI on
`127.0.0.1:5173`. To use it from other devices, keep both on loopback and put a TLS
reverse proxy on this machine in front of the UI. Only the proxy listens on the
network.

1. **Proxy.** Caddy keeps `Host` and adds `X-Forwarded-For` by default:
   ```
   hexops.lan {
       tls internal                 # or a certificate from your own CA
       reverse_proxy 127.0.0.1:5173
   }
   ```
   With nginx, both headers must be set explicitly (its defaults drop them):
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:5173;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_http_version 1.1;                       # dev server websocket (HMR)
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
   }
   ```
2. **Backend** (`backend/.env`):
   ```
   HEXOPS_COOKIE_SECURE=true
   HEXOPS_TRUSTED_ORIGINS=https://hexops.lan
   HEXOPS_ALLOWED_HOSTS=127.0.0.1,localhost,::1,hexops.lan
   ```
   `HEXOPS_HOST` stays `127.0.0.1`, so `HEXOPS_ALLOW_LAN` is not needed.
3. **UI:** `HEXOPS_UI_ALLOWED_HOSTS=hexops.lan npm run dev`. `HEXOPS_UI_HOST` stays
   loopback.
4. **Check:**
   - `ss -ltn` shows only the proxy on a LAN address;
   - `https://hexops.lan` works from another device;
   - `http://<lan-ip>:5173` and `:8000` refuse connections.

First-run setup stays local-only behind the proxy: the browser's `Origin` is
`https://hexops.lan`, and the proxy adds the device's LAN address to
`X-Forwarded-For`.

## API errors

Every error response has the same shape:

```json
{"detail": "Request validation failed", "code": "validation_error",
 "errors": [{"field": "username", "code": "string_pattern_mismatch", "params": {}}]}
```

`code` is stable and is what the UI translates. `errors` appears only on validation
failures and never echoes the rejected input. A database outage returns
`503 database_unavailable`. The public `GET /api/health` returns the same code, and
the app header uses it to show whether it is connected.

## Security notes

- Services bind to loopback. To expose HexOps on a LAN you must set both
  `HEXOPS_HOST` and `HEXOPS_ALLOW_LAN=true`. Put it behind HTTPS and set
  `HEXOPS_COOKIE_SECURE=true`.
- Plain-HTTP LAN sharing (`HEXOPS_UI_HOST=0.0.0.0 HEXOPS_ALLOW_LAN=true npm run dev`)
  still exists, but **don't use it**. Passwords and session cookies would cross the
  network unencrypted. Use *LAN access over HTTPS* instead.
- There is no signup. Accounts are managed with `python -m app.cli`.
- `backend/.env` holds secrets and is git-ignored. Never commit it.
- The API's access log (stdout) records request paths, including search terms and
  record ids, never bodies, passwords or cookies. Keep it local, like the database.

## License

HexOps is released under the [MIT License](LICENSE). Copyright (c) 2026 Khusan Juraev.

Third-party packages installed by the installers (Python and npm dependencies, the
Chromium build used for PDF export, fonts and icons) keep their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
