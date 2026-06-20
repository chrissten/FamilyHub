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

## Deployed (2026-06-20)
- **Live URL**: https://your-server.example.com
- GitHub: https://github.com/chrissten/FamilyHub (private), pushed and set as the Railway service's auto-deploy source (branch `master`) — future `git push` to master redeploys automatically.
- Railway project "FamilyHub" has two services: `FamilyHub` (the app, Dockerfile build) and `Postgres` (official Railway template image, with a `postgres-volume` mounted at `/var/lib/postgresql/data` — **this volume, managed by Railway outside our Dockerfile, is what makes data persistent**, not anything in the app container itself).
- Production env vars set on the `FamilyHub` service: `SECRET_KEY` (freshly generated, distinct from the local dev one), `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD` (set by the user), `ADMIN_DISPLAY_NAME`, `ADMIN_COLOR`, and `DATABASE_URL=${{Postgres.DATABASE_URL}}` (a live reference, so it auto-updates if Postgres credentials ever rotate).
- Verified end-to-end against production: logged in as admin, created a real grocery list, confirmed it round-trips through the live Postgres database.
- Gotcha hit during setup: the public domain's target port defaulted to 8000 (matching the Dockerfile's `EXPOSE`), but Railway actually auto-assigns its own `PORT` (was `8080`) and the app correctly binds to it (`uvicorn ... --port ${PORT:-8000}`) — caused a transient 502 until the domain's target port was updated to match with `railway domain update ... --port 8080`. If this ever recurs after a redeploy, check `railway logs` for the actual `Uvicorn running on http://0.0.0.0:<port>` line and make sure the domain's target port matches.

## Next steps when we resume
Nothing is pending from the feature requests so far — calendar, multi-list grocery, multi-list to-do, public/private visibility, Docker, GitHub, and the live Railway deployment are all done and verified. Possible future asks: add other family members via the **Family** page on the live site, add Alembic migrations once the schema needs to change, or add an in-app password-change feature (currently the only way to change `ADMIN_PASSWORD` is via the Railway env var, which doesn't retroactively update the already-seeded admin row).

## Useful references
- Plan file with full design rationale: `C:\Users\chris\.claude\plans\snuggly-waddling-sparrow.md`
- Project root: `C:\Users\chris\OneDrive\Code\FamilyHub`
- Local dev: `.venv\Scripts\python.exe -m uvicorn app.main:app --reload` (after `pip install -r requirements.txt`, with `.env` present)
