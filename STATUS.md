# FamilyHub — Status (as of 2026-06-20)

## What's built and working
A FastAPI + HTMX + WebSocket family management app, verified locally end-to-end:

- **Auth**: session-cookie login for the web UI, JWT bearer tokens via `POST /api/auth/token` for the future Android app. First user is seeded as admin from `.env` on startup.
- **Family members**: admin-only `/users` page to add family members with a display name + calendar color.
- **Calendar**: month-grid view at `/calendar`, color-coded per member, full CRUD via HTMX modal + matching `/api/events`.
- **Grocery lists**: multiple lists at `/grocery`, each **public** (shared, anyone can edit) or **private** (owner-only). Each list has categories and items. Real-time sync over `/ws/grocery/{list_id}` — verified a public list updates live across sessions, and a private list's WebSocket rejects unauthorized users (403).
- **To-do lists**: same multi-list/public-private model at `/todo`, but flat checklists (no categories). Real-time over `/ws/todo/{list_id}`, verified the same way.
- **Persistence**: SQLAlchemy, SQLite locally / Postgres on Railway via `DATABASE_URL`. No Alembic yet — `Base.metadata.create_all()` on startup (deliberate v1 simplification, schema is still small).

## Known gaps / deliberate simplifications
- ~~Docker build is unverified.~~ **Done (2026-06-20):** `docker build` succeeds cleanly, the container starts, `/healthz` returns 200, and login + protected pages (grocery, calendar) work correctly inside the container via `docker run`. Docker Desktop needed a manual fix first — it was being launched as Administrator, which caused a named-pipe ACL conflict (`access denied` on `dockerExtensionManagerAPI`, `com.docker.service` stuck Stopped); relaunching it as a normal user resolved it.
- No Alembic migrations — fine for now since there's no real production data yet, but worth adding before the schema gets more complex.
- No "delete a whole list" UI (only delete individual items) — noted as a future enhancement, not requested yet.
- WebSocket connections live in one process's memory — fine for a single Railway instance, would break if horizontally scaled.
- Local `.env` has dev-only secrets (`SECRET_KEY=dev-secret-key-for-local-testing-only`, `ADMIN_PASSWORD=adminpass123`) — fine for local testing, **must be replaced** with real secrets before deploying to Railway (see `.env.example`).

## Environment quirks hit during this build (already fixed, just FYI)
- `psycopg2-binary` has no wheel for Python 3.14 (very new) — switched to `psycopg[binary]==3.2.13` (psycopg3). `app/database.py` rewrites `postgres://`/`postgresql://` URLs to `postgresql+psycopg://` automatically, so Railway's injected `DATABASE_URL` works as-is.
- SQLAlchemy needed bumping to `2.0.51` for compatibility with Python 3.14's typing internals.
- A relationship attribute was accidentally named `list` in two models, which shadowed the builtin `list` type and broke mapper configuration in a confusing way (`NotImplementedType` error). Renamed to `grocery_list`/`todo_list`. **Lesson: never name a SQLAlchemy relationship/column `list`, `id`-shadowing names, etc.**

## Next steps when we resume
1. **Deploy to Railway**: push this repo to GitHub, create a Railway project from it (Dockerfile auto-detected), add the Postgres plugin, set real env vars (`SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, `ADMIN_COLOR` — do **not** reuse the local dev values) — see `README.md` for the full deploy checklist.
2. Nothing else is left pending from the feature requests so far — calendar, multi-list grocery, multi-list to-do, public/private visibility, and the Docker build are all done and verified.

## Useful references
- Plan file with full design rationale: `C:\Users\chris\.claude\plans\snuggly-waddling-sparrow.md`
- Project root: `C:\Users\chris\OneDrive\Code\FamilyHub`
- Local dev: `.venv\Scripts\python.exe -m uvicorn app.main:app --reload` (after `pip install -r requirements.txt`, with `.env` present)
