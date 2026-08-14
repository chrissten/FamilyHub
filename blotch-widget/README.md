# FamilyHub Blotch widgets

Two separate widgets, both showing FamilyHub calendar data on a Blotch e-ink
frame. They're split into separate files/widgets (rather than one widget with
a "layout" input) because Blotch shares Input values across every instance of
the same widget — you can't drop two instances of one widget onto a frame
with different settings, so a list view and a grid view have to be genuinely
different widgets.

- **`FamilyCalendarList.tsx`** — a simple agenda list, next 3 days or next
  week (`RANGE` input).
- **`FamilyCalendarGrid.tsx`** — a tabular calendar, either the current
  Sunday-Saturday week as 7 columns, or the whole current month as a
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
| `API_BASE_URL` | Public | String | `https://your-server.example.com` |
| `RANGE` | Public | Select | Choices: `Next 3 Days`, `Next Week` |
| `TEXT_SIZE` | Public | Select | Choices: `Normal`, `Large`, `Extra Large` |
| `API_TOKEN` | Private* | String | the token from step 1 |

**FamilyCalendarGrid:**

| Name | Kind | Type | Value / default |
|---|---|---|---|
| `API_BASE_URL` | Public | String | `https://your-server.example.com` |
| `VIEW` | Public | Select | Choices: `Week`, `Month` |
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

## Notes / things to double check against the live Designer

The public docs at the time this was written didn't spell out `useFetch`'s
exact options shape — both widgets assume it takes a fetch-style
`{ headers: {...} }` second argument (needed to send the `Authorization:
Bearer <token>` header). If the Designer's TypeScript autocomplete disagrees,
adjust the code accordingly; the header is the one thing that actually
matters here, since the API returns 401 without it.
