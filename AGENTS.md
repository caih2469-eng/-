# AGENTS.md

## Project scope

This repository contains the existing “廿载同心·青春同行” meal check-in website. Preserve the current project unless a task explicitly authorizes a migration or feature change.

## Current architecture

- Runtime: Node.js with built-in HTTP modules and ExcelJS for `.xlsx` imports.
- Frontend: static HTML, CSS, and browser JavaScript in `public/`.
- Backend: a single `server.js` HTTP server.
- Persistence: `data/db.json`; local image objects are stored in `uploads/` and only URLs are stored in the database.
- Team capacity is persisted in `config.maxTeams`; team membership is canonical in `teams[].memberIds`.
- Tasks use `tasks[]`; task submissions use `taskSubmissions[]` and optimistic `version` fields.
- Plaza posts use `plazaPosts[]` and may only be created automatically from public, final interaction-track submissions.
- Plaza likes and 24-hour view windows are canonical in `plazaLikes[]` and `plazaViews[]`; do not reintroduce counter-only client logic.
- Ranking freezes use immutable monthly snapshots in `rankingFreezes[]`; excluded plaza posts must never enter calculated rankings.
- All dashboard, moderation, deletion, freeze, and Excel export APIs must remain admin-only.
- Phase 9 files live in `material-files/`; never expose that directory statically or return `storedName` through JSON APIs.
- Scheduled activity tasks use `occurrenceDate`; activity-day and weekday occurrences must remain same-day-only and unique per owner.
- Student self-join is disabled by default; team membership is assigned through admin Excel import or admin member management.
- `package.json` defines start, migration, syntax-check, and Node test commands.
- There is no framework, transpiler, linter, TypeScript checker, or build step.
- There is no Cloudflare, GitHub Actions, or GitHub Pages configuration.

## Working rules

- Read `README.md` and the relevant file in `docs/` before changing behavior.
- Do not commit `data/`, `uploads/`, secrets, passwords, tokens, or real participant material.
- Treat student IDs, names, meal photos, health screenshots, and review data as sensitive personal data.
- Preserve the rule that only interaction-track students may join a team and one student may belong to at most one team.
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
