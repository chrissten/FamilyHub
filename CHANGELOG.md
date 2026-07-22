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

### 2026-07-22 (2)
- **[mobile]** v1.2.6 — Grocery categories are now collapsible outside Store Mode,
  defaulting to collapsed. Tapping a category header toggles it open/closed (chevron
  indicator); its item list and inline add-item field (added in v1.2.5 above) only show
  while expanded. Store Mode always shows every category fully expanded regardless of
  the collapsed state, since that view is for shopping, not browsing. Typing a name that
  matches an existing (possibly collapsed) item now auto-expands that item's category
  before scrolling to and highlighting it, so the existing "type an item name again to
  un-check it" behavior still works across collapsed categories. Mobile-only for now —
  the web app's `_grocery_category.html` shows every category expanded on one page,
  which doesn't have the same small-screen scroll pressure; not added there since it
  wasn't asked for.

### 2026-07-22
- **[mobile]** v1.2.5 — Grocery tab: each category now has its own inline "Add item…"
  field (with its own Qty field), instead of one add bar at the bottom that always
  added to whichever category happened to be first. This also closes a mobile/web
  parity gap — `_grocery_category.html` on web has always had one add form per
  category section. Categories with zero items are no longer hidden outside Store
  Mode, so there's always somewhere to add the first item. `grocery.tsx` also picked
  up the `KeyboardAvoidingView` wrapper from the To-Do tab fix (2026-07-21 below),
  since it has the same add-bar-under-a-list layout that was flagged as unverified.

### 2026-07-21
- **[mobile]** v1.2.4 — Fix the To-Do tab's on-screen keyboard covering the "Add item…"
  input instead of the screen shrinking to make room. Unlike the event form (fixed
  2026-07-15 by moving off RN `<Modal>`), the To-Do tab is already a normal screen, so it
  should have honored the Activity's `android:windowSoftInputMode="adjustResize"` — but
  in practice the keyboard still overlapped the input. `app/(tabs)/todo.tsx` now wraps its
  content in an explicit `KeyboardAvoidingView` (`padding` on iOS, `height` on Android)
  rather than relying solely on `adjustResize`. Grocery/Freezer (`grocery.tsx`/`freezer.tsx`)
  have the identical add-bar-below-a-list layout and no such wrapper either — not touched
  here since only To-Do was reported broken, but worth checking if the same symptom shows
  up there.

### 2026-07-20
- **[web]** Recurring events can now have an end date instead of only ever "repeating
  forever." New `CalendarEvent.series_until` column (`app/models.py`, migrated via the
  usual startup `ALTER TABLE`); `materialize_series` (`app/recurrence.py`) generates the
  whole bounded run up front when an end date is given instead of the rolling 24-month
  horizon, and `top_up_recurring_series` now skips any series with `series_until` set
  (bounded series are fully materialized already, nothing to top up). New
  `update_series_until` lets an *existing* series' end date be changed later — trims
  occurrences past the new boundary, or extends them (reusing the top-up logic, factored
  out as `_extend_series`) if the boundary moved out; the boundary is clamped to never fall
  before the occurrence currently being edited, so picking an end date earlier than the
  event you're editing can't delete it out from under the save. `_event_form.html` gets an
  "Ends: Never / On date" control both when creating a repeat and when editing an existing
  series (applied on "Save whole series").
- **[web]** Events can now be duplicated: a "Duplicate" button on the edit form opens a
  prefilled "New event" form (title/description/location/dates/times/all-day/attendees
  copied from the source) via a new `GET /calendar/events/{id}/duplicate` route reusing
  `_event_form.html`'s existing "new event" rendering path — the duplicate is always a
  standalone event (repeat defaults to "Does not repeat"), it doesn't join the source
  event's series.
- **[mobile]** v1.2.3 — End-date and duplicate parity with the web changes above:
  `event-form.tsx`'s Repeat section gains the same "Ends: Never / On date" pills (for new
  events, and for editing an existing series' whole-series save), backed by
  `recurrence_until` on `createEvent`/`updateEvent` (`src/api/client.ts`) and the new
  `series_until` field on `CalendarEvent` (`src/api/types.ts`). A "Duplicate Event" button
  flips the form into a prefilled create-mode in place (no navigation) — title/description/
  location/dates/times/all-day/attendees are kept from the source event, repeat resets to
  "Does not repeat," and Delete/Duplicate are hidden while duplicating since it's no longer
  editing the original.

### 2026-07-17
- **[web]** Multi-day events can now have real start/end times instead of being forced to
  "all day" — e.g. Friday 6:00 PM through Sunday 12:00 PM. `calendar_create_event`/
  `calendar_update_event` (`app/routers/calendar.py`) previously collapsed a timed event's
  end date onto its start date; the end-date field now always applies, regardless of the
  All day checkbox (`_event_form.html`). The month/week/agenda view-builders already
  bucketed events by day range independent of `all_day`, so they needed no change; the
  week/3-day timeline's per-day block clipping (`layout_day_blocks`) also already clamped
  correctly. Added `continues-before`/`continues-after` styling to timed blocks (mirroring
  the existing all-day chip treatment) and new `event_tooltip_range`/`event_time_label`
  helpers (`app/templating.py`) so month/week tooltips show the weekday alongside the time
  for spanning events, and agenda/day rows show "6:00 PM – continues" / "Continues all day"
  / "continues – 12:00 PM" instead of the same raw start/end time on every day the event
  touches. Whole-series edits (`_update_series`) now preserve a multi-day occurrence's
  duration across every other occurrence instead of collapsing it back to one day.
- **[mobile]** v1.2.2 — Multi-day timed event parity with the web change above:
  `event-form.tsx`'s End date field is no longer gated on All day. New `eventTimeLabel()`
  (`src/calendar/dateUtils.ts`, port of the web's `event_time_label`) drives the same
  "continues" agenda/day-row labels; `DayAgenda.tsx` now takes a `theDate` prop to compute
  it. `TimelineView.tsx`'s timed blocks get the same continues-before/after corner styling
  as `MonthView.tsx`'s chips (which already worked for multi-day, unchanged).
- **[web]** Calendar events can now repeat — "Weekly on {weekday}" or "Monthly on the
  {nth/last} {weekday}", auto-labeled from whatever start date is picked (no separate
  weekday/ordinal selector). New `CalendarEvent.recurrence_rule`/`series_id` columns
  (`app/models.py`, migrated via the same startup `ALTER TABLE` pattern already used for
  `grocery_items.sort_order`) and a new `app/recurrence.py` module that materializes
  concrete occurrence rows 24 months out (matches the existing "flat row per occurrence"
  model the Cozi import already used, so none of the 8 existing month/week/day/agenda
  view-builder functions needed to change). A startup job tops up any series getting close
  to running out, so "repeats forever" actually behaves that way without a cron job.
  Editing/deleting a single occurrence detaches it from the series ("this event only");
  editing/deleting the whole series is also supported. `_event_form.html` gains a Repeat
  select and a this-vs-whole-series choice when editing a recurring event.
- **[mobile]** v1.2.1 — Recurring-event parity with the web change above: `event-form.tsx`
  gains a "Repeat" picker (new events only) and this-vs-series Alert prompts on save/delete
  for events that are part of a series (`src/calendar/recurrence.ts` mirrors the web's
  weekday/ordinal label logic). `AgendaView.tsx`/`DayAgenda.tsx` show a small "↻" next to
  recurring event titles.
- **[mobile]** Agenda tab whitespace: event cards now put the time on the same line as the
  title (was its own line, leaving a lot of empty space to the right) — cuts a typical card
  from 3–4 lines down to 2–3. `AgendaView.tsx` and `DayAgenda.tsx`.
- **[mobile]** Grocery list: typing an item name that already exists on the list now scrolls
  to that entry, highlights it, and unchecks it automatically if it was checked off —
  previously this only happened server-side at submit time. `app/(tabs)/grocery.tsx`.

### 2026-07-15 (5)
- **[web]** Admins can now edit an existing family member's color from the Family Members
  page (`/users`) — previously `color_hex` was only settable at account creation, with no
  edit route anywhere. New `POST /users/{id}/color` (form, admin-only, matches the existing
  "Add member" pattern) and `PATCH /api/users/{id}` (JSON API, admin-only). Each member row
  now shows a native `<input type="color">` swatch (admin view only) that auto-submits on
  change.
- **[mobile]** Family Members parity with the web change above: new `app/members.tsx` screen
  (linked from a new "Family" section in Settings), listing every member with their color
  swatch. Admins can tap a swatch to open a picker with a curated color palette
  (`src/colorPalette.ts`) and pick a new one — mobile has no built-in color-picker component
  (unlike the native date/time pickers), so this uses a fixed swatch grid instead of true
  hex entry, calling the new `PATCH /api/users/{id}` endpoint (`updateUserColor` in
  `src/api/client.ts`).

### 2026-07-15 (4)
- **[web]** Month and week-view all-day event chip tooltips now include the time (or
  "All day"), matching the timed week-event-block tooltip which already had it. Previously
  the chip's hover title showed only "Attendees: Title" with no time — the only place a
  user could see an event's time in month view without opening it, since month view (unlike
  agenda/day) never renders time as visible text. `_calendar_month.html` and
  `_calendar_week.html`.

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
