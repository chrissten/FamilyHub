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

- **Agenda view is mobile-only for seamless forward month navigation, a default-to-today
  starting position, and the condensed one-card-per-day layout (2026-07-23, v1.2.12; load
  direction changed 2026-07-28, v1.2.17 below).** Mobile's Agenda tab opens scrolled to
  today and loads later months automatically as you scroll past the bottom edge; earlier
  days only appear via Prev/Today navigation or an explicit "Load previous events" button,
  never by scrolling up. It also renders each day's events as rows inside a single card
  instead of one card per event. `_calendar_agenda.html` still renders one month at a time
  starting at the 1st with no auto-scroll to today, no load-more control, and a separate
  card per event. Not fixed here since it wasn't asked for — flagging so it isn't
  rediscovered by accident.
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

### 2026-08-03 (3)
- **[mobile]** v1.2.21 — v1.2.20's fix wasn't enough; Week/3-Day switching was still
  taking 20+ seconds against the real production dataset (644 events). Root causes in
  `dateUtils.ts`, both now fixed:
  - `zonedParts` constructed a brand-new `Intl.DateTimeFormat` on *every* call — expensive
    on Hermes/Android, never reused. Formatters are now built once per timezone (and
    cached separately for the tz-abbreviation variant used by `eventTzLabel`) and reused
    across all calls. Benchmarked ~11x faster for the same call volume.
  - `buildMultiDayView` (backs both Week and 3-Day) called `overlapsDay` — which itself
    calls `eventStart`/`eventEnd` — once per (event, day) pair, so Week view alone did
    ~644×7 ≈ 4,500 conversions instead of ~644. It now derives each event's start/end
    once up front and reuses it across all days in the range, matching the pattern
    `buildMonthGrid`/`buildAgendaView` already used.

### 2026-08-03 (2)
- **[mobile]** v1.2.20 — Fixed multi-second lag switching between Month/Week/3-Day/Day
  views. Three causes, all fixed:
  - `buildMonthGrid`/`buildMultiDayView`/`buildDayAgenda` (`app/(tabs)/index.tsx`) ran
    inline in the render body on every render, including plain tab switches with no data
    change; now `useMemo`'d on `[events, anchor]` so a tab switch alone is a cheap
    re-render instead of re-walking every event with per-event `Intl.DateTimeFormat`
    timezone conversion.
  - `GET /api/events` had no date filtering and no eager-loading, so every load pulled
    the entire (ever-growing) events table plus ~2N+1 queries for each event's
    owner/attendees. It now accepts optional `start`/`end` params (same overlap
    semantics as the web app's `build_month_grid`) and uses `joinedload`/`selectinload`;
    mobile requests a rolling 12-months-back/15-months-forward window and re-fetches a
    re-centered window when Prev/Next/Today or Agenda's scroll navigation moves outside
    it.
  - Added missing indexes on `calendar_events.start_time`/`end_time`.

### 2026-08-03
- **[web][mobile]** v1.2.19 — Events can now be flagged as a "conflict" (needs discussion),
  highlighting them in yellow everywhere they appear.
  - **[web]** New checkbox in the event form; `.conflict` class added to month/week/day/
    agenda views (`#fff3cd` background). `CalendarEvent.conflict` column added with a
    guarded migration for existing deployments.
  - **[mobile]** Matching Switch in the event form; conflict styling uses the existing
    `warningBg` theme token across Month, Timeline, Agenda, and Day views.
  - The JSON `PUT /api/events/{id}` endpoint only overwrites `conflict` when the request
    body explicitly includes it (via Pydantic's `model_fields_set`), so an older
    already-installed mobile client that doesn't know about this field can't silently
    clear a flag someone else set from a newer client.

### 2026-07-30
- **[mobile]** v1.2.18 — Fixed the event form's Attendees list being trapped under the
  on-screen keyboard, requiring a keyboard dismiss before a family member could be
  tapped. `event-form.tsx`'s `ScrollView` now reserves bottom padding equal to the live
  keyboard height (via `useKeyboardHeight`, the same fix already used on the Grocery/
  To-Do/Freezer tabs), so the list can scroll fully clear of the keyboard instead of
  relying on Android's `adjustResize`, which doesn't reach this modal screen reliably.

### 2026-07-28 (2)
- **[mobile]** v1.2.17 — Agenda tab now defaults to today instead of the 1st of the
  month, and no longer auto-loads earlier months as you scroll up. `AgendaView.tsx`
  filters rendered days to a `minDate` floor (today, or the requested date after
  Prev/Today navigation) and replaces the old scroll-triggered previous-month load with
  a "Load previous events" button at the top of the list; forward infinite scroll into
  future months is unchanged.

### 2026-07-28
- **[web][mobile]** The app now reopens to whichever top-level screen (and, for
  Calendar, whichever sub-view — e.g. Agenda) was last open, instead of always
  defaulting to Grocery (web) or Calendar (mobile).
  - **[web]** Each visit to `/calendar`, `/grocery`, `/todo`, or `/freezer` records
    `last_page` in the server session (Calendar also records its `?view=` sub-view).
    `/` and the post-login redirect now send the user to `last_page` instead of a
    hardcoded `/grocery`. Cleared on logout, so a fresh login always starts at the
    default.
  - **[mobile]** New `pref_last_tab` / `pref_last_calendar_view` AsyncStorage keys
    (`src/preferences.ts`), following the existing timezone/time-format preference
    pattern. `(tabs)/_layout.tsx` records the active tab on every navigation;
    `app/index.tsx` reads it on launch and routes straight there instead of always
    landing on the Calendar tab. The Calendar screen's Month/Week/3 Day/Day/Agenda
    picker now persists and restores the same way.

### 2026-07-25 (3)
- **[mobile]** v1.2.15 — Creating a new event now defaults its timezone to the pinned
  Display Time Zone override (Settings, added in v1.2.14) when one is set, instead of
  always defaulting to the device's actual current zone. Editing an existing event is
  unaffected (still keeps that event's own already-stored timezone).
  `event-form.tsx`'s initial timezone state now reads `effectiveTimeZone()` instead of
  `deviceTimeZone()` directly. Also fixed a related latent bug found while wiring this
  up: the pinned override lived only in an in-memory cache populated when the Settings
  screen loaded, so on a cold app start it wouldn't take effect anywhere (calendar
  display or event creation) until the user visited Settings at least once that
  session — `app/_layout.tsx` now eagerly loads it (and the time-format preference) at
  startup.

### 2026-07-25 (2)
- **[web][mobile]** Fixed a bug in the 2026-07-24 timezone migration (v1.2.13, below): the
  one-time backfill assumed the family's home zone was `America/New_York` (a hardcoded
  default in `app/config.py` that was never actually confirmed against where this family
  is) instead of the correct `America/Chicago` — every legacy event ended up anchored one
  hour off (DST itself was applied correctly throughout; verified January events compute
  at UTC-5/EST and June events at UTC-4/EDT as expected — the bug was the assumed base
  zone, not DST handling). Corrected all 611 affected production rows directly (recovered
  each event's original wall-clock digits by reversing the wrong `America/New_York`
  conversion, then re-localized through `America/Chicago`; all-day events were untouched
  either time, since they're zone-agnostic). `default_timezone` now defaults to
  `America/Chicago` in code and is also set explicitly as a Railway `DEFAULT_TIMEZONE` env
  var, so the fallback isn't silently dependent on a hardcoded guess again.

### 2026-07-25
- **[mobile]** v1.2.14 — Added a persistent "Display Time Zone" setting (Settings →
  Display Time Zone): pin event times to a specific zone (e.g. Central) regardless of
  where the phone currently is, instead of always following the device's detected zone.
  Defaults to "Device" (today's behavior, auto-following the phone). Stored locally via
  AsyncStorage (`pref_display_timezone`), same per-device pattern as the existing 12h/24h
  time-format preference — not synced to the account or to the web app, which has no
  settings page to host it. New `preferences.ts` exports
  (`loadDisplayTimezone`/`setDisplayTimezone`/`useDisplayTimezone`/
  `getCachedDisplayTimezone`) and a new `dateUtils.ts` `effectiveTimeZone()` (pinned
  override, falling back to `deviceTimeZone()`) that `eventStart`/`eventEnd`/
  `eventTzLabel`/`fmtTime` now go through instead of the device zone directly.

### 2026-07-24
- **[web][mobile]** v1.2.13 — Events now carry a real per-event timezone instead of a
  naive wall-clock value shown identically to everyone. `calendar_events.start_time`/
  `end_time` are now genuine UTC instants (matching what the column was always declared
  as); a new `timezone` column (IANA name, e.g. "America/New_York") anchors each event.
  Viewers in a different timezone than an event's anchor zone see it converted to their
  own current local time, with a short zone-abbreviation badge (e.g. "6:00 PM EDT") so a
  converted time is visibly distinguishable from a plain local one — same-zone viewing
  (the common case) renders identically to before. Creating/editing an event defaults
  the timezone to the device's/browser's current zone (auto-detected) but exposes a
  "Time zone: ... (change)" control to anchor it to a different one (e.g. a flight or a
  call with someone elsewhere); a whole-series edit updates every occurrence's timezone
  the same way it already overwrites title/description/attendees, and each recurring
  occurrence is localized independently so a series correctly shifts UTC offset across a
  DST transition instead of drifting by an hour. Existing deployments get a one-time
  startup migration (`app/main.py`) that reinterprets existing wall-clock values as local
  time in a new `default_timezone` setting and rewrites them as true UTC instants —
  this touches the production DB in place, unlike the additive-column migrations so far.
  New `app/timezones.py` (backend) and mobile `dateUtils.ts`/`timezones.ts` hold the
  zoneinfo/Intl conversion helpers and the shared curated timezone list.

### 2026-07-23 (1)
- **[mobile]** v1.2.12 — Grocery tab: the "Add item" row moved from the bottom of each
  category to the top (right below the category header), so it's reachable without
  scrolling past every item first. Calendar Agenda tab: rebuilt as a true infinite scroll
  spanning months — scrolling past the top or bottom edge loads the adjacent month
  automatically (with a month-name divider between them), and Prev/Next/Today now scroll
  within that continuous list instead of swapping out the whole month's data (which
  previously could leave the list scrolled to the bottom of the new month instead of the
  top). Each day's events are now grouped into a single card (thin divided rows) instead
  of a separate shadowed card per event, condensing the view.

### 2026-07-22 (7)
- **[web][mobile]** v1.2.11 — Freezer item quantity now has an optional unit (oz or lb),
  selectable alongside the free-text quantity field. Added `quantity_unit` to
  `FreezerItem`/`FreezerItemCreate`/`FreezerItemUpdate`/`FreezerItemOut` (existing
  deployments migrated via `ALTER TABLE freezer_items ADD COLUMN quantity_unit` on
  startup, same pattern as the `sort_order`/recurrence columns). Web's add/edit forms
  get a `<select>` next to the qty input; the item row shows e.g. "(2 lb)". Mobile's
  add bar gets an oz/lb toggle (tap to select, tap again to clear) next to the Qty
  field, and the item list shows the unit inline the same way.

### 2026-07-22 (6)
- **[mobile]** v1.2.10 — The v1.2.9 `KeyboardAvoidingView` fix for the keyboard covering
  add-item inputs turned out to have zero effect on Grocery, To-Do, *or* Freezer — verified
  directly on device. `android:windowSoftInputMode="adjustResize"` isn't reaching these
  screens at all inside the bottom-tab navigator, and layering `KeyboardAvoidingView` on
  top of a resize that never happens does nothing. Replaced with a new
  `src/useKeyboardHeight.ts` hook that tracks the real keyboard height directly via
  `Keyboard.addListener('keyboardDidShow'/'keyboardDidHide', ...)`, independent of any
  native resize behavior. To-Do and Freezer (fixed add-bar-below-the-list screens) now pad
  an outer wrapper around that bar by the tracked height, pushing it up above the keyboard.
  Grocery has no fixed bar anymore (its add fields moved inline per-category in v1.2.5), so
  instead its `SectionList` gets extra bottom `contentContainerStyle` padding plus an
  `onFocus` handler that scrolls the focused category's last item to the bottom of the
  viewport, bringing its add-row up out from behind the keyboard.

### 2026-07-22 (5)
- **[mobile]** v1.2.9 — Fix the Freezer tab's on-screen keyboard covering its add-item
  inputs, the same symptom fixed on the To-Do tab on 2026-07-21 (v1.2.4) and flagged
  there as unverified on Grocery/Freezer. Grocery got the `KeyboardAvoidingView` wrapper
  as a side effect of the 2026-07-22 category-add-field change (v1.2.5); this does the
  same for `freezer.tsx`.

### 2026-07-22 (4)
- **[mobile]** v1.2.8 — Tapping a "New event" notification now opens that event directly
  in the event form instead of just launching the app to whatever screen it last showed.
  The notification body also now shows the event's date and time (e.g. "Wednesday, July
  22, 2026 · 3:00 PM – 4:00 PM"), reusing the same `dayLabel`/`eventTimeLabel` formatting
  the calendar views use, respecting the 12h/24h time-format preference. Only applies to
  the single-new-event case — a "3 new events added" notification has no one event to
  jump to, so it still just opens the app. `app/_layout.tsx` now listens for notification
  taps (both a cold app launch via `getLastNotificationResponseAsync` and a tap while
  already running via `addNotificationResponseReceivedListener`) and routes to
  `/event-form` with the matching event. Grocery-item notifications are unchanged — they
  don't identify a single item to jump to.

### 2026-07-22 (3)
- **[mobile]** v1.2.7 — Grocery item quantity now renders inline with the name, e.g.
  "Ketchup (1)", instead of on its own line below. Closes another mobile/web parity gap —
  `_grocery_item_row.html` has always shown `<span class="item-name">…</span> ({{ quantity
  }})` inline.

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
