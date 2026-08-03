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
- **Live URL**: https://your-server.example.com
- GitHub: https://github.com/chrissten/FamilyHub (private), pushed and set as the Railway service's auto-deploy source (branch `master`) — future `git push` to master redeploys automatically.
- Railway project "FamilyHub" has two services: `FamilyHub` (the app, Dockerfile build) and `Postgres` (official Railway template image, with a `postgres-volume` mounted at `/var/lib/postgresql/data` — **this volume, managed by Railway outside our Dockerfile, is what makes data persistent**, not anything in the app container itself).
- Production env vars set on the `FamilyHub` service: `SECRET_KEY` (freshly generated, distinct from the local dev one), `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD` (set by the user), `ADMIN_DISPLAY_NAME`, `ADMIN_COLOR`, and `DATABASE_URL=${{Postgres.DATABASE_URL}}` (a live reference, so it auto-updates if Postgres credentials ever rotate).
- Verified end-to-end against production: logged in as admin, created a real grocery list, confirmed it round-trips through the live Postgres database.
- Gotcha hit during setup: the public domain's target port defaulted to 8000 (matching the Dockerfile's `EXPOSE`), but Railway actually auto-assigns its own `PORT` (was `8080`) and the app correctly binds to it (`uvicorn ... --port ${PORT:-8000}`) — caused a transient 502 until the domain's target port was updated to match with `railway domain update ... --port 8080`. If this ever recurs after a redeploy, check `railway logs` for the actual `Uvicorn running on http://0.0.0.0:<port>` line and make sure the domain's target port matches.

## Login fix (2026-06-20)
Unauthenticated browser page-loads used to show a bare `{"detail":"Not authenticated"}` JSON error instead of the login page. Added a global 401 handler in `app/main.py` that redirects requests with `Accept: text/html` to `/login`, while leaving the JSON 401 unchanged for API/JWT clients (needed for the future Android app). Live and verified.

## Admin identity
The production admin login is `christopher` / (password set at deploy time) — renamed directly in the production Postgres row from the generic seeded `admin`/`Admin`. Seed defaults in `app/config.py` / `.env.example` now default to `christopher`/`Christopher` too, but that only affects *fresh* installs — seeding never retroactively renames an existing row.

## Cozi migration (2026-06-20)
Migrated real family data from my.cozi.com into production:
- **Family members**: created `dominic`, `monica`, `samuel`, `alexander`, `julia` (alongside existing `christopher`/`lindsay`), all sharing Christopher's password for now — recommend each person changes their own password once there's an in-app way to do so.
- **Calendar**: imported 260 events (May–Sept 2026) from Cozi's calendar, including recurring series (e.g. weekly "Family Game Night") expanded into individual occurrences, and multi-day spans (e.g. vacations) imported as all-day events spanning the correct date range. Attendees mapped from Cozi's per-person household members; events with no specific Cozi attendee (e.g. "Family Movie Night") were assigned to the whole family.
- **Groceries**: populated the existing public "Weekly Groceries" list with Cozi's 9 categories (Household, Dairy, Fruits & Vegetables, Meat, Baking, Non-Perishable, Snacks, Bread, Trader Joe's) and all 174 items, preserving checked/unchecked status from Cozi.
- Used the unofficial `py-cozi` PyPI package to call Cozi's REST API (it's a JS SPA, not scrapable via plain HTML fetch) — installed temporarily in the local venv, used via one-off scripts, then uninstalled; no permanent dependency on Cozi was added to the app itself.

## Cozi sync #2 (2026-07-02)
Re-synced from my.cozi.com into production, future events only (skipped anything with an end time in the past):
- Pulled every month Jan 2026 – Jun 2027 from Cozi's calendar API (same unofficial `py-cozi` approach as the first migration — installed temporarily, used via a one-off script in the scratchpad, uninstalled after).
- Deduped against existing rows by exact (title, start_time, end_time) match; inserted 241 new future events, bringing the total from 262 to 503.
- Included 12 new "Dominic Working" shifts (through 2026-07-19) that were added to Cozi after the first migration's 6/20 export.
- Did **not** backfill Jan–Apr 2026 (never migrated originally, but all in the past now) or anything already past-due — user explicitly asked for future-only.
- Flagged during this sync, not yet built: (1) FamilyHub has no native recurring-event concept — Cozi's recurring items (weekly Family Game Night, etc.) are still being expanded into individual one-off rows at sync time, not stored as a series; (2) all-day events already support a start/end *datetime* span in the schema (used for Cozi's multi-day trips), but there's no dedicated start/end **date** UI for creating one — worth adding to the calendar modal.

## Cozi sync #3 (2026-07-12)
Re-synced from my.cozi.com into production again, same approach and scope as sync #2 (future events only, Jan 2026 – Jun 2027 pulled, deduped by exact `(title, start_time, end_time)`):
- Installed `py-cozi` temporarily into the local venv, ran a one-off script from the scratchpad, uninstalled it after. No permanent Cozi dependency or stored credentials were added — `COZI_USERNAME`/`COZI_PASSWORD` were added to the local `.env` (gitignored) for this run only; consider removing them if not doing another sync soon.
- Inserted 41 new future events (511 → 552 total), including newly-added items like "Fall Break", "HOLY CROSS RETREAT", "WGU graduation in Seattle", and several "Teacher training" days — all added to Cozi since the 2026-07-02 sync.
- Also carried over `notes` from Cozi appointment details into the FamilyHub event's `description` field where present (small gap noticed vs. prior syncs — 2 items in the full Jan 2026 range had notes; unclear whether syncs #1/#2 captured this).

## Cozi sync #4 (2026-07-22) — Dominic's working shifts only
Scoped re-sync, not a full calendar pull: pulled Jan 2026 – Jun 2027 from Cozi again (`py-cozi`, installed temporarily and uninstalled after) but filtered to items where Dominic is the sole attendee and the description (trimmed/lowercased) is exactly "dominic working" — 60 such shifts found in Cozi.
- Deduped by exact `(title, start_time, end_time)` against all existing `calendar_events` rows (not scoped to Dominic), same as prior syncs.
- Unlike syncs #2/#3, **did** backfill past shifts this time (user explicitly asked to sync "all" of Dominic's working events, not just future ones) — inserted 34 new rows spanning Jan 2026 through the confirmed-future 7/23–7/24, including several already-past shifts (e.g. 7/1, 7/20, 7/21) that earlier future-only syncs had permanently skipped since they were already past-due at each sync's run time. 26 of the 60 already existed. Total events 577 → 611.
- All inserted rows use `owner_id` = christopher (id 1) with Dominic as the sole `event_attendees` row, matching the pattern of every pre-existing "Dominic Working" event.
- Cozi's `startTime`/`endTime` are stored as-is with a UTC tzinfo tag (no timezone conversion) — confirmed this matches how every prior sync stored these fields, by comparing a known Cozi local time against its existing DB row.

## Next steps when we resume
Nothing is pending from the feature requests so far — calendar (month/week/day views + attendees), multi-list grocery, multi-list to-do, public/private visibility, Docker, GitHub, and the live Railway deployment are all done and verified. Possible future asks: add other family members via the **Family** page on the live site (Lindsay/Dominic/Monica only exist in local test data, not yet in production), add Alembic migrations once the schema needs to change, or add an in-app password-change feature (currently the only way to change a password is a direct DB update or the `ADMIN_PASSWORD` env var, which doesn't retroactively update an already-seeded row).

## Useful references
- Plan file with full design rationale: `C:\Users\chris\.claude\plans\snuggly-waddling-sparrow.md`
- Project root: `C:\Users\chris\OneDrive\Code\FamilyHub`
- Local dev: `.venv\Scripts\python.exe -m uvicorn app.main:app --reload` (after `pip install -r requirements.txt`, with `.env` present)
