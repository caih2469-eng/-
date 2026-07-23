# AGENTS.md

## Project scope

This repository contains the existing “廿载同心·青春同行” meal check-in website. Preserve the current project unless a task explicitly authorizes a migration or feature change.

## Current architecture

- Runtime: Node.js with built-in HTTP modules and ExcelJS for `.xlsx` imports.
- Frontend: static HTML, CSS, and browser JavaScript in `public/`.
- Backend: a single `server.js` HTTP server.
- Persistence: `data/db.json`; uploaded images are stored in `uploads/`.
- `package.json` defines start, migration, syntax-check, and Node test commands.
- There is no framework, transpiler, linter, TypeScript checker, or build step.
- There is no Cloudflare, GitHub Actions, or GitHub Pages configuration.

## Working rules

- Read `README.md` and the relevant file in `docs/` before changing behavior.
- Do not commit `data/`, `uploads/`, secrets, passwords, tokens, or real participant material.
- Treat student IDs, names, meal photos, health screenshots, and review data as sensitive personal data.
- Do not deploy the current server publicly without addressing the security blockers listed in `docs/PROJECT_PLAN.md`.
- Keep API and storage changes documented in `docs/API.md` and `docs/DATABASE.md`.
- Keep verification commands and results current in `docs/TESTING.md`.
- Prefer small, reviewable changes. Do not silently replace the stack or regenerate the project.

## Validation baseline

Run:

```powershell
node --check server.js
node --check public/app.js
node -e "JSON.parse(require('fs').readFileSync('data/db.json','utf8'))"
node --test
```

Then start `node server.js` and smoke-test the home page, login, `/api/me`, student check-in authorization, and admin authorization.
