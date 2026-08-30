# FamilyHub Blotch widgets

Two separate widgets, both showing FamilyHub calendar data on a Blotch e-ink
frame. They're split into separate files/widgets (rather than one widget with
a "layout" input) because Blotch shares Input values across every instance of
the same widget — you can't drop two instances of one widget onto a frame
with different settings, so a list view and a grid view have to be genuinely
different widgets.

- **`FamilyCalendarList.tsx`** — a simple agenda list, next 3 days or next
  week (`RANGE` input).
- **`FamilyCalendarGrid.tsx`** — a tabular calendar, either a rolling 7-day
  window starting today as 7 columns, or the whole current month as a
  traditional calendar grid (`VIEW` input).

## 1. Create a device token

In FamilyHub, log in as an admin and go to **Devices** (`/devices`), then
create a token labeled something like "Blotch frame". Copy the token shown —
it's only displayed once. This authenticates the frame to the API; it's a
read-only credential scoped to `/api/widget/events` and `/api/widget/grid`,
and can be revoked from that same page at any time. Both widgets can share
the same token.

## 2. Create each widget in Blotch's Widget Designer

For each file, create a new Widget in the
[Widget Designer](https://docs.blotch.app/widget-builder/Widget%20Designer/)
and paste in its contents. Both export a component named `Widget`, matching
what the Designer's starter template expects.

## 3. Configure Inputs

**FamilyCalendarList:**

| Name | Kind | Type | Value / default |
|---|---|---|---|
| `API_BASE_URL` | Public | String | your FamilyHub server URL, e.g. `https://your-server.example.com` |
| `RANGE` | Public | Select | Choices: `Next 3 Days`, `Next Week` |
| `TEXT_SIZE` | Public | Select | Choices: `Normal`, `Large`, `Extra Large` |
| `API_TOKEN` | Private* | String | the token from step 1 |

**FamilyCalendarGrid:**

| Name | Kind | Type | Value / default |
|---|---|---|---|
| `API_BASE_URL` | Public | String | your FamilyHub server URL, e.g. `https://your-server.example.com` |
| `VIEW` | Public | Select | Choices: `Week`, `Month` |
| `DAYS` | Public | Number | `7` — how many days the rolling Week view spans starting today, 1-14. Ignored for Month view. |
| `TEXT_SIZE` | Public | Select | Choices: `Normal`, `Large`, `Extra Large` |
| `API_TOKEN` | Private* | String | the token from step 1 |

\* Start with `API_TOKEN` as **Private** (encrypted, set once by you) — that's
right for a personal Draft widget only you install. The one situation to
watch for: if a widget's Draft status turns out to block adding it to a real
frame and you end up needing to flip it to Published, switch `API_TOKEN` to
**Public** instead. Private Input values are set once by the widget's author
and reused for every install, so on a Published widget a Private token would
mean anyone who finds it in Blotch's library silently uses your FamilyHub
credentials — a Public token instead makes every installer (including you)
supply their own, so a stranger's install just fails instead of leaking data.

## 4. Add to the frame

Add each widget to the frame's page layout in the Frame Editor. Try both
`RANGE` settings on the list widget, and both `VIEW` settings on the grid
widget, to see which fit the frame's size best before deciding what to leave
installed — the frame only supports 5 widget placements per page.

## 5. Automating the schedule (bulk-editing switch times)

The Schedule editor at `console.blotch.app/frames/studio?deviceUid=...&mode=schedule`
has no duplicate/copy option — every switch between pages (e.g. Home ↔
Calendar) has to be clicked in one at a time, which doesn't scale to a
pattern repeated many times across a week. There's no separate Blotch REST
API either: the console is an Angular SPA that talks directly to **Firestore**,
so the schedule can be bulk-edited by writing to Firestore directly instead
of clicking through the UI.

Found by capturing a HAR of the Network tab during one manual schedule edit
and decoding the `firestore.googleapis.com` WebChannel request bodies
(`req0___data__=<url-encoded JSON>`). If Blotch changes their schema, redo it
the same way: get a fresh HAR covering one manual edit, filter for
`firestore.googleapis.com`, URL-decode the `req*___data__` params.

**Auth** — Blotch's console uses a Firebase Web API key for its project (grab
it yourself from a HAR capture the same way, or from the console's own bundled
JS — it's not secret, but isn't reproduced here). Sign in with the normal
Blotch account credentials via
`POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>`
(`{email, password, returnSecureToken:true, clientType:"CLIENT_TYPE_WEB"}`) to
get an `idToken`, then send it as `Authorization: Bearer <idToken>` on
Firestore REST calls — no service account needed.

**Data model** — the schedule lives on
`https://firestore.googleapis.com/v1/projects/<blotch-firebase-project>/databases/(default)/documents/devices/{deviceUid}/data/settings`,
field `timeline`, an array of blocks:

```json
{
  "timeRange": { "start": 300, "end": 330 },
  "pageUid": "35e9aed8-ec6c-49f7-ba9e-effb6d8dadd4",
  "repeatInterval": 30
}
```

- `start`/`end` are **minutes-of-week**, 0–10080 (Monday 00:00 = 0, Sunday
  24:00 = 10080), interpreted in the device's own `timeZone` field on that
  same `settings` doc (not UTC).
- A block that runs to the exact end of the week is stored with `end: 0`
  instead of `10080` — that's the app's own wraparound convention, not
  something invented for this.
- `repeatInterval: 30` is what the app's own default full-week blocks use;
  its exact meaning is unclear, but reusing `30` for normal recurring weekly
  blocks matches known-good behavior. One-off entries made through the UI use
  `9007199254740991` (`Number.MAX_SAFE_INTEGER`) instead, likely a
  "doesn't repeat" sentinel.
- `pageUid` values are **per-device** — list them via
  `GET .../devices/{deviceUid}/pages` (each page document has a `name`
  field) rather than assuming an ID from a previous session.

Write the whole `timeline` array in one shot with
`PATCH .../data/settings?updateMask.fieldPaths=timeline`, body
`{"fields": {"timeline": <arrayValue>}}` — simpler than trying to
add/remove individual entries. Generate the full set of blocks locally
(alternating pattern, day-part hold, etc.), merge adjacent same-page blocks
to keep the array small, then push it in a single PATCH instead of one
request per switch.

## Notes / things to double check against the live Designer

The public docs at the time this was written didn't spell out `useFetch`'s
exact options shape — both widgets assume it takes a fetch-style
`{ headers: {...} }` second argument (needed to send the `Authorization:
Bearer <token>` header). If the Designer's TypeScript autocomplete disagrees,
adjust the code accordingly; the header is the one thing that actually
matters here, since the API returns 401 without it.
