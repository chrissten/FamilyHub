# FamilyHub — Status (as of 2026-06-20)

## What's built and working
A FastAPI + HTMX + WebSocket family management app, verified locally end-to-end:

- **Auth**: session-cookie login for the web UI, JWT bearer tokens via `POST /api/auth/token` for the future Android app. First user is seeded as admin from `.env` on startup.
- **Family members**: admin-only `/users` page to add family members with a display name + calendar color.
- **Calendar**: Month/Week/Day views at `/calendar` (a unified `?date=` focus carries across views and prev/next/today nav), full CRUD via HTMX modal + matching `/api/events`. Events have separate **attendees** (who's actually going) from the owner (who created it) — month/day views show one colored dot per attendee, week view shows time-blocked, attendee-colored event blocks with a simple greedy overlap layout for same-time events.
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
- Deployed to Railway: Dockerfile-built app service plus a managed Postgres service (Railway's Postgres plugin injects `DATABASE_URL` automatically, and its volume is what makes data persistent, not anything in the app container). Pushing to `master` on GitHub redeploys automatically.
- Production env vars set on the app service: `SECRET_KEY` (freshly generated, distinct from the local dev one), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, `ADMIN_COLOR`, `DATABASE_URL` (referenced live from the Postgres service so it auto-updates if credentials ever rotate).
- Verified end-to-end against production: logged in as admin, created a real grocery list, confirmed it round-trips through the live Postgres database.
- Gotcha hit during setup: the public domain's target port defaulted to 8000 (matching the Dockerfile's `EXPOSE`), but Railway auto-assigns its own `PORT` and the app correctly binds to it (`uvicorn ... --port ${PORT:-8000}`) — caused a transient 502 until the domain's target port was updated to match. If this ever recurs after a redeploy, check the platform logs for the actual bound port and make sure the domain's target port matches.

## Login fix (2026-06-20)
Unauthenticated browser page-loads used to show a bare `{"detail":"Not authenticated"}` JSON error instead of the login page. Added a global 401 handler in `app/main.py` that redirects requests with `Accept: text/html` to `/login`, while leaving the JSON 401 unchanged for API/JWT clients (needed for the future Android app). Live and verified.

## Admin identity
The production admin login was renamed directly in the production database from the generic seeded `admin`/`Admin` to a personal account. Seed defaults in `app/config.py` / `.env.example` are configurable via env vars, but that only affects *fresh* installs — seeding never retroactively renames an existing row.

## Cozi migration (2026-06-20)
Migrated real family data from my.cozi.com into production:
- **Family members**: added the rest of the household as users, all sharing one password for now — recommend each person changes their own password once there's an in-app way to do so.
- **Calendar**: imported historical events from Cozi's calendar, including recurring series expanded into individual occurrences, and multi-day spans (e.g. vacations) imported as all-day events spanning the correct date range. Attendees mapped from Cozi's per-person household members; events with no specific Cozi attendee were assigned to the whole family.
- **Groceries**: populated an existing public grocery list with Cozi's categories and items, preserving checked/unchecked status from Cozi.
- Used the unofficial `py-cozi` PyPI package to call Cozi's REST API (it's a JS SPA, not scrapable via plain HTML fetch) — installed temporarily in the local venv, used via one-off scripts, then uninstalled; no permanent dependency on Cozi was added to the app itself.

## Cozi sync #2 (2026-07-02)
Re-synced from my.cozi.com into production, future events only (skipped anything with an end time in the past):
- Pulled several months forward from Cozi's calendar API (same unofficial `py-cozi` approach as the first migration — installed temporarily, used via a one-off script in the scratchpad, uninstalled after).
- Deduped against existing rows by exact (title, start_time, end_time) match.
- Did **not** backfill older events (never migrated originally, but all in the past now) — user explicitly asked for future-only.
- Flagged during this sync, not yet built: (1) FamilyHub has no native recurring-event concept — Cozi's recurring items are still being expanded into individual one-off rows at sync time, not stored as a series; (2) all-day events already support a start/end *datetime* span in the schema (used for Cozi's multi-day trips), but there's no dedicated start/end **date** UI for creating one — worth adding to the calendar modal.

## Cozi sync #3 (2026-07-12)
Re-synced from my.cozi.com into production again, same approach and scope as sync #2 (future events only, deduped by exact `(title, start_time, end_time)`):
- Installed `py-cozi` temporarily into the local venv, ran a one-off script from the scratchpad, uninstalled it after. No permanent Cozi dependency or stored credentials were added — Cozi login env vars were added to the local `.env` (gitignored) for this run only; consider removing them if not doing another sync soon.
- Also carried over `notes` from Cozi appointment details into the FamilyHub event's `description` field where present (small gap noticed vs. prior syncs; unclear whether syncs #1/#2 captured this).

## Cozi sync #4 (2026-07-22) — one family member's recurring shifts only
Scoped re-sync, not a full calendar pull: pulled the same date range from Cozi again (`py-cozi`, installed temporarily and uninstalled after) but filtered to one family member's recurring work-shift events.
- Deduped by exact `(title, start_time, end_time)` against all existing `calendar_events` rows, same as prior syncs.
- Unlike syncs #2/#3, **did** backfill past shifts this time (user explicitly asked to sync "all" of that member's events, not just future ones), including several already-past shifts that earlier future-only syncs had permanently skipped since they were already past-due at each sync's run time.
- Cozi's `startTime`/`endTime` are stored as-is with a UTC tzinfo tag (no timezone conversion) — confirmed this matches how every prior sync stored these fields, by comparing a known Cozi local time against its existing DB row.

## Next steps when we resume
Nothing is pending from the feature requests so far — calendar (month/week/day views + attendees), multi-list grocery, multi-list to-do, public/private visibility, Docker, GitHub, and the live deployment are all done and verified. Possible future asks: add Alembic migrations once the schema needs to change, or add an in-app password-change feature (currently the only way to change a password is a direct DB update or the `ADMIN_PASSWORD` env var, which doesn't retroactively update an already-seeded row).

## Useful references
- Local dev: `.venv\Scripts\python.exe -m uvicorn app.main:app --reload` (after `pip install -r requirements.txt`, with `.env` present)
