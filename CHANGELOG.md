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

- **Agenda view doesn't scroll to today on web.** Mobile's Agenda tab now opens scrolled
  to today (2026-07-15, v1.0.9 below); `_calendar_agenda.html` still renders starting at
  the 1st of the month with no auto-scroll to `.agenda-day.today`. Not fixed here since it
  wasn't asked for — flagging so it isn't rediscovered by accident.
- **Dark mode is mobile-only (v1.1.0 below).** The web app has no theme system; all its
  colors are hardcoded in `app.css`. Not fixed here since it wasn't asked for.
- **Native date/time picker popups don't follow the in-app dark mode override.** Mobile's
  `@react-native-community/datetimepicker` popup styling is governed by the Android
  system's day/night setting (`app.json`'s `userInterfaceStyle: "light"`, baked into the
  native project), not by the app's own Light/Dark/System setting — so if a user forces
  "Dark" while their phone is set to light mode (or vice versa), the picker popup won't
  match. Fixing this needs a native rebuild (`expo prebuild`) touching the Android theme
  resources, which risks re-triggering the CMake/OneDrive buildBase issue documented for
  `@react-native-community/datetimepicker` — left alone rather than risk breaking the
  build blind (no device to verify against in this environment).

## History (newest first)

### 2026-07-15 (3)
- **[mobile]** v1.1.0 — Event form ("New Event"/"Edit Event") moved from a React Native
  `<Modal>` to a real expo-router screen (`app/event-form.tsx`, `presentation: 'modal'`).
  Android's `<Modal>` renders as a separate Dialog window that doesn't reliably honor
  `android:windowSoftInputMode="adjustResize"` even with `KeyboardAvoidingView` wrapping
  the content (the fix attempted 2026-07-14 below), so the keyboard kept covering the
  lower fields. A real screen is hosted in the main Activity and picks up `adjustResize`
  correctly. Data (the event being edited, the members list) is handed off via a small
  in-memory `formState.ts` module since expo-router's URL params can't carry non-serializable
  objects; save/delete now call the API directly and `router.back()`, relying on the
  calendar screen's existing `useFocusEffect` refetch instead of prop callbacks.
- **[mobile]** v1.1.0 — Added a Version number to the bottom of Settings (`Constants.expoConfig`
  from `expo-constants`, already a dependency) so an installed APK's actual version/build
  number can be checked against what was just built — this project has had version drift
  between `app.json` and the native `build.gradle` bite before.
- **[mobile]** v1.1.0 — Added optional Dark Mode: a Light/Dark/System setting in Settings
  (`src/theme.ts`, same reactive-preference pattern as Time Format), defaulting to System.
  Every screen and shared component now sources its colors from `useTheme()` instead of
  hardcoded hex values — calendar views, event form, grocery/todo/freezer, settings, login,
  tab bar, and the status bar style. No web equivalent — the web app has no theme system
  (see "Known parity gaps" above). Native date/time picker popups are a known exception,
  also noted above.

### 2026-07-15 (2)
- **[mobile]** v1.0.9 — Agenda view now opens scrolled to today instead of the 1st of the month. `AgendaView` scrolls its `FlatList` to today's row on mount/month-change (not on every pull-to-refresh, so a manual scroll position isn't stolen back). No web equivalent gap — the web agenda view isn't in scope here.

### 2026-07-15
- **[mobile]** v1.0.8 — Fix event times displaying shifted from what was entered (e.g. a 2:30 PM event showing as 9:30 AM). The backend and the web app store/render event times as plain wall-clock values with no real timezone conversion, but the mobile app's display code (`fmtTime`, month/week/day/agenda views, the event form) parsed timestamps with `new Date(iso)`, which reinterprets the digits as a true UTC instant and re-applies the device's real offset. Added `parseEventDate()` in `dateUtils.ts` to extract the wall-clock components directly instead, and switched every event-time read site to use it — fixes display for events regardless of whether they were created on web or mobile, without any backend or data changes.
- **[mobile]** v1.0.8 — Replaced the free-text `HH:MM` start/end time fields in the event form with a native time picker (`@react-native-community/datetimepicker`, `mode="time"`), matching the native date picker added 2026-07-12.
- **[mobile]** v1.0.8 — Added a Time Format setting (12-hour AM/PM vs 24-hour) in Settings, applied everywhere a time is shown or picked: agenda/day/month/week views, the event form's time picker and time buttons. No web equivalent needed — the web form already uses a native `<input type="time">`, which renders per the browser/OS locale automatically.

### 2026-07-14
- **[mobile]** v1.0.7 — When someone else creates a calendar event, every other signed-in family member's phone now pops a "New event" notification by default (existing 15-minute background poll in `notifications.ts`, no new accounts/infra needed). Two fixes made this actually work: `checkNewEvents` now excludes events owned by the current user (via a new `getCurrentUserId`, decoded client-side from the JWT `sub` claim — no new endpoint) so you don't get notified about your own creations, and the "New events" pref now defaults to on the first time each device signs in (`ensureDefaultNotifPrefs`, called from both `app/index.tsx` auto-login and `app/login.tsx`) instead of requiring a manual Settings toggle. No web equivalent — this is mobile push-style behavior with no server-side analog yet.
- **[mobile]** v1.0.7 — Fix the "New Event" / "Edit Event" form keyboard covering the input fields instead of the view scrolling up to make room. `EventFormModal` now wraps its content in a `KeyboardAvoidingView` (`padding` behavior on iOS, `height` on Android). Web has no equivalent gap here — browsers already reflow the page for the on-screen keyboard.

### 2026-07-12
- **[mobile]** v1.0.6 — In the event form (used by "New Event" everywhere, including the Agenda tab), the Start/End date fields are now a native calendar picker (`@react-native-community/datetimepicker`, `display="calendar"`) instead of a raw `YYYY-MM-DD` text box, and default to the day currently in view rather than requiring manual entry.
- **[web]** Fix broken freezer card layout: the delete "×" was dropping to its own line under the freezer name, and the add-item row (name/qty/purchased/expires/Add) overflowed off the side of the page on narrower screens. `.add-item-form`/`.item-edit-form` were missing `flex-wrap: wrap`, so their five fields never wrapped; `.freezer-card-header` now truncates long freezer names with an ellipsis instead of letting them push the delete button around. Also added a `?v=<mtime>` cache-busting query string to `app.css` (via `asset_version` in `app/templating.py`) since Starlette's `StaticFiles` sends no `Cache-Control` header, so a stale cached copy may have been part of what was seen here.
- **[web]** Redesign Freezer Inventory as a single unified page instead of a list-of-freezers index + separate per-freezer detail page — every freezer now renders as its own card (mirroring the Grocery categories-within-a-list layout), each with an independent live-updating item list. Removed the `/freezer/freezers/{id}` detail route and `freezer_list.html`; added `_freezer_card.html`, and `freezer_create` now redirects back to `/freezer`. Mobile is unaffected — its tab-per-freezer picker already matches how the mobile Grocery/To-Do screens work, so there's no parity gap here.
- **[web]** Fix blank screen when creating a new grocery or to-do list. Same root cause as the freezer fix directly above: `grocery_create_list` (`app/routers/grocery.py`) and `todo_create_list` (`app/routers/todo.py`) fed the same plain, non-htmx "new list" forms an `HX-Redirect`-only 200 response, which a normal browser form POST doesn't honor. Switched both to a real 302 redirect.
- **[web]** Fix blank screen when creating a new freezer: the "New freezer" form is a plain HTML form (not htmx-driven), but `freezer_create` (`app/routers/freezer.py`) only set an `HX-Redirect` header on an empty 200 body — htmx.js reads that header, but a normal browser form POST doesn't, so it rendered the empty body as a blank page. Switched to a real 302 redirect, matching `/login`.
- **[web]** Add a Freezer Inventory tab supporting multiple named, shared freezers (no owner/private concept, unlike Grocery/To-Do). Items track name, quantity, date purchased, and expiration date, with red/amber highlighting for expired/expiring-soon items. New `Freezer`/`FreezerItem` models in `app/models.py`, `app/routers/freezer.py` (HTMX + `/api/freezer/...` JSON + `/ws/freezer/{id}`), `expiry_class` Jinja filter in `app/templating.py`, `freezer_lists.html`/`freezer_list.html`/`_freezer_item_row.html` templates.
- **[mobile]** v1.0.5 — Freezer Inventory parity with the web change above: new `freezer.tsx` tab (freezer picker strip, item list with expired/expiring-soon color coding, add bar with `YYYY-MM-DD` date fields matching the existing `EventFormModal` date-entry pattern), `Freezer`/`FreezerItem` types and client functions in `mobile/src/api/`.
- **[web]** Add an Agenda (list) view to the calendar, alongside Month/Week/3-Day/Day: shows every day in the current month as a scrolling list, including days with nothing scheduled (labeled "Nothing scheduled"), matching Cozi's list view. New `/calendar/agenda` route, `build_agenda_view()` in `app/routers/calendar.py`, `_calendar_agenda.html` partial.
- **[mobile]** v1.0.4 — Agenda view parity with the web change above: new `AgendaView.tsx` + `buildAgendaView()` in `dateUtils.ts`, added as a fifth tab in the calendar screen.

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
