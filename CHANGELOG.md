# FamilyHub Changelog

Tracks feature history for both the web app (`app/`) and the mobile app (`mobile/`),
so capability gaps between the two are visible in one place instead of discovered
by accident (as happened with multi-day events on 2026-07-09).

**Tags:** `[web]` server-rendered app, deployed via Railway on push to master · `[mobile]` Android app, versioned via `mobile/app.json` semver, built locally per `mobile/INSTALL.md`.

**Versioning:** the web app doesn't carry an explicit version number — it deploys continuously, so its "version" is effectively its commit hash/date. The mobile app is pinned to a semver in `app.json`, bumped on every APK build.

> Mobile entries before 2026-07-09 are reconstructed from file timestamps, not commits —
> the `mobile/` directory was never under version control until that date (see below).
> Entries from 2026-07-09 onward are commit-accurate.

## Known parity gaps

_None currently known._ When you spot a capability that exists on one platform but not
the other, add it here with a short note, and remove it once fixed (cross-reference the
changelog entry that closed it).

## History (newest first)

### 2026-07-09
- **[mobile]** v1.0.3 — Multi-day all-day event parity with the 2026-07-05 web change below, closing a gap where mobile calendars silently dropped multi-day events after their first day:
  - Month view now spans a multi-day event across every day it covers (previously it only ever appeared on its `start_time` date — the direct cause of "multi-day events don't show up")
  - Event form modal gains an End date field (shown when "All day" is on), so multi-day events can actually be created from the app, not just viewed
  - Month/week/3-day chips get continuation styling (joined edges, attendee dots suppressed on continuation days) matching the web app
  - Day agenda shows the `(7/10–7/12)` date-range suffix for multi-day all-day events
- **[mobile]** `mobile/` directory added to git for the first time, with a `.gitignore` — previously the entire mobile app was untracked and unbacked-up.

### 2026-07-05
- **[web]** `df7f2a4` — Add capability for multi-day all-day events (month/week/day views span the full date range; event form gains an end-date field for all-day events; continuation styling for chips that span days)
- **[web]** `1baf48b` — Add profile page with password change, and drag-to-reorder for grocery/to-do items

### ~2026-07-01 (approximate — mobile, pre-git)
- **[mobile]** Calendar month view and REST API client added (`src/calendar/`, `src/api/client.ts`)

### ~2026-06-29 (approximate — mobile, pre-git)
- **[mobile]** Grocery, to-do, and settings/profile tab screens added

### ~2026-06-28 (approximate — mobile, pre-git)
- **[mobile]** Initial app scaffold: login screen, bottom-tab navigation, push notification opt-in

### 2026-06-20
- **[web]** `7f2e0d4` — Add grocery item typeahead, duplicate prevention, and quantity editing
- **[web]** `38079b0` — Add 3-day calendar view and mobile-friendly responsive layout
- **[web]** `9fc97ee` — Make calendar fill the viewport and add an "All" attendees option
- **[web]** `072895a` — Fix week view 500 error from naive/aware datetime mismatch on Postgres
- **[web]** `9610f53` — Add week and day calendar views alongside month view
- **[web]** `160f072` — Default admin seed identity to christopher/Christopher
- **[web]** `a5e375a` — Add event attendees, distinct from who created the event
- **[web]** `bb6c179` — Redirect unauthenticated browser page loads to /login
- **[web]** `cfc354e` — Initial FamilyHub app: calendar, multi-list grocery/to-do, real-time sync
