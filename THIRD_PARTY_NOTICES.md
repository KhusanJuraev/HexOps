# Third-party notices

HexOps itself is MIT-licensed (see [LICENSE](LICENSE)). It builds on third-party
software that keeps its own copyright and license. The copyright line in `LICENSE`
covers only the HexOps code, not the works listed here.

## Code included in this repository

### shadcn/ui

The components in `frontend/src/shared/ui/` were generated with the shadcn/ui CLI
(see `frontend/components.json`) and adapted for HexOps.

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Dependencies installed at setup time (not included in this repository)

The installers download these from PyPI, npm and the Playwright CDN. Each is
distributed under its own license, which is included in the installed package:

- Python packages listed in `backend/pyproject.toml` (FastAPI, SQLAlchemy, Alembic,
  psycopg, Argon2, Playwright, and others);
- npm packages listed in `frontend/package.json` and `frontend/package-lock.json`
  (React, Radix UI, lucide-react icons, Recharts, react-markdown, Tailwind CSS, and
  others);
- the Chromium build that Playwright downloads for PDF export.

No third-party fonts or images are bundled; the UI uses the system font stack.
