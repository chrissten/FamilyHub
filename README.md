# FamilyHub

A family management web app: shared calendar with per-member color coding, and a real-time
multi-category grocery list that syncs instantly across everyone's open browser tabs/devices.
Built with FastAPI + server-rendered HTMX, designed to also serve a future Android app over the
same JSON API.

## Local development

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # then edit SECRET_KEY / ADMIN_PASSWORD
uvicorn app.main:app --reload
```

Visit http://127.0.0.1:8000 — log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`
(an admin account is auto-created on first startup if no users exist yet). Without `DATABASE_URL`
set, the app uses a local `familyhub.db` SQLite file.

Once logged in as admin, go to **Family** to add the rest of the family members and assign each a
calendar color.

## Real-time grocery sync

The grocery list page connects over a WebSocket (`/ws/grocery`). Every add/check/delete is
broadcast as an HTML fragment and swapped into every other open tab via htmx's `ws` extension —
no manual refresh needed. This relies on all connections living in one process, which is fine for
a single Railway instance; it won't fan out across multiple replicas.

## API

JSON endpoints live under `/api/...` (see `/docs` for the interactive OpenAPI schema). Get a
bearer token via `POST /api/auth/token` (OAuth2 password flow) to use the API from a future
Android client; the same endpoints power the web UI under the hood via cookie session auth.

## Deploying to Railway

1. Push this repo to GitHub and create a new Railway project from it (Dockerfile is auto-detected).
2. Add a Postgres plugin to the project — Railway injects `DATABASE_URL` automatically.
3. Set `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, `ADMIN_COLOR` as
   environment variables on the service.
4. Deploy. The app reads `PORT` from Railway automatically.
