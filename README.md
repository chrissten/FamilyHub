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

### Configuration (`.env`)

`.env` is gitignored — copy `.env.example` to `.env` and fill in your own values. None of these
have usable defaults baked into the app, so set them before running:

| Variable | Required | Notes |
|---|---|---|
| `SECRET_KEY` | Yes | Signs session cookies and JWTs. Generate with `python -c "import secrets; print(secrets.token_hex(32))"`. Use a different value per environment. |
| `ADMIN_USERNAME` | Yes | Login for the auto-created bootstrap admin account. |
| `ADMIN_PASSWORD` | Yes | Password for that account. Only takes effect on first startup (no existing users) — changing it later doesn't retroactively update an already-seeded row. |
| `ADMIN_DISPLAY_NAME` | Yes | Display name shown in the UI for the admin account. |
| `ADMIN_COLOR` | Yes | Hex calendar color for the admin account, e.g. `#4A90D9`. |
| `DATABASE_URL` | No | Postgres connection string. Leave unset for local dev to fall back to a local `familyhub.db` SQLite file. On Railway, the Postgres plugin injects this automatically. |

## Real-time grocery sync

The grocery list page connects over a WebSocket (`/ws/grocery`). Every add/check/delete is
broadcast as an HTML fragment and swapped into every other open tab via htmx's `ws` extension —
no manual refresh needed. This relies on all connections living in one process, which is fine for
a single Railway instance; it won't fan out across multiple replicas.

## API

JSON endpoints live under `/api/...` (see `/docs` for the interactive OpenAPI schema). Get a
bearer token via `POST /api/auth/token` (OAuth2 password flow) to use the API from a future
Android client; the same endpoints power the web UI under the hood via cookie session auth.

## Mobile app (Android)

The `mobile/` directory contains a React Native / Expo SDK 56 app that connects to the same JSON API.

### Build a standalone release APK (Windows)

The APK bundles the JS inline so it works without a Metro dev server — install it on any Android device or emulator.

**One-time setup** — run these once after cloning or after reinstalling the Android NDK:

1. Create `mobile/android/local.properties` with your machine-specific paths
   (this file is gitignored so each developer maintains their own copy):

```properties
# Redirects build output outside any cloud-synced folder (OneDrive, Dropbox, etc.)
# Required to prevent Gradle snapshot errors on .so files. Pick any path outside your sync folder.
android.buildBase=C:/android-build/familyhub
```

2. Fix NDK `.so` files that Windows extracts as reparse points (causes Gradle snapshot errors):

```powershell
$ndkLib = "$env:LOCALAPPDATA\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib"
foreach ($abi in @("aarch64-linux-android","arm-linux-androideabi","i686-linux-android","x86_64-linux-android")) {
    $p = "$ndkLib\$abi\libc++_shared.so"
    $b = [System.IO.File]::ReadAllBytes($p)
    [System.IO.File]::Delete($p)
    [System.IO.File]::WriteAllBytes($p, $b)
    Write-Host "Fixed: $abi"
}
```

**Build the APK:**

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:GRADLE_USER_HOME = "C:\gradle-home"
$env:PATH = "C:\Program Files\nodejs;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
Set-Location mobile\android
.\gradlew.bat assembleRelease
```

The APK is written to `<android.buildBase>\app\outputs\apk\release\app-release.apk`
(i.e. `C:\android-build\familyhub\...` with the default `local.properties` above).

First build takes ~15 min (compiles native modules). Subsequent builds are ~2–3 min (Gradle cache at `C:\gradle-home`).

### Dev mode (emulator with hot reload)

```powershell
cd mobile
npx expo run:android
```

This starts Metro and builds a debug APK that connects to it automatically.

## Deploying to Railway

1. Push this repo to GitHub and create a new Railway project from it (Dockerfile is auto-detected).
2. Add a Postgres plugin to the project — Railway injects `DATABASE_URL` automatically.
3. Set `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, `ADMIN_COLOR` as
   environment variables on the service.
4. Deploy. The app reads `PORT` from Railway automatically.
