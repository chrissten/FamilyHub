# FamilyHub Blotch widget

Displays upcoming FamilyHub calendar events on a Blotch e-ink frame, with a
dropdown to switch between a 3-day and a 7-day view.

## 1. Create a device token

In FamilyHub, log in as an admin and go to **Devices** (`/devices`), then
create a token labeled something like "Blotch frame". Copy the token shown —
it's only displayed once. This is what authenticates the frame to the API;
it's a read-only credential scoped to `/api/widget/events` and can be revoked
from that same page at any time.

## 2. Create the widget in Blotch's Widget Designer

Paste `FamilyCalendar.tsx` into a new Widget in the
[Widget Designer](https://docs.blotch.app/widget-builder/Widget%20Designer/).
Leave it as **Draft** — this widget isn't meant to be published to the public
Widget Library, it's just for this family's frame.

## 3. Configure Inputs

In the widget's Inputs panel, add:

| Name | Kind | Type | Value / default |
|---|---|---|---|
| `API_BASE_URL` | Public | String | `https://your-server.example.com` |
| `RANGE` | Public | Select | Choices: `Next 3 Days`, `Next Week` |
| `API_TOKEN` | **Private** | String | the token from step 1 |

`API_TOKEN` must be a **Private** input (encrypted, author-only) — never make
it Public, since Public input values can be visible to anyone who installs
the widget.

## 4. Add to the frame

Add the widget to the frame's page layout in the Frame Editor, and try both
`RANGE` settings to see which fits the frame's size better before deciding
which one to leave installed.

## Notes / things to double check against the live Designer

The public docs at the time this was written didn't spell out `useFetch`'s
exact options shape — the code assumes it takes a fetch-style
`{ headers: {...} }` second argument (needed to send the `Authorization:
Bearer <token>` header). If the Designer's TypeScript autocomplete disagrees,
adjust `FamilyCalendar.tsx` accordingly; the header is the one thing that
actually matters here, since `/api/widget/events` returns 401 without it.
