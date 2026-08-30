# FamilyHub Mobile — Build & Install Guide

Builds locally with Android Studio. No Expo account, no cloud service, no Play Store.
On first launch, enter your FamilyHub server URL along with your username and password
(the app remembers it after that).

---

## Prerequisites (one-time setup)

1. **Node.js 20+** — https://nodejs.org
2. **Android Studio** — https://developer.android.com/studio
   - During setup, install the "Android SDK" component (default)
   - Java 17 is bundled with Android Studio — no separate install needed
3. Set the `ANDROID_HOME` environment variable:
   - Windows: `C:\Users\<you>\AppData\Local\Android\Sdk`
   - Add `%ANDROID_HOME%\platform-tools` to PATH as well

---

## Build the APK

```powershell
cd mobile
npm install

# Generate the native Android project (creates the android/ folder)
npx expo prebuild --platform android

# Build the debug APK
cd android
.\gradlew.bat assembleDebug
```

The APK is at:
```
C:\android-build\familyhub\app\outputs\apk\debug\app-debug.apk
```
(Build output is redirected outside the OneDrive-synced project folder via `android.buildBase`
in `local.properties` — see the comment in `android/build.gradle` for why. The path inside
`mobile/android/app/build/...` is stale and won't update.)

---

## Install on your Android device

**Enable sideloading on the device:**
- *Settings → Apps → Special app access → Install unknown apps*
  → select your file manager or browser → allow

**Transfer the APK** (any method works):
- USB file transfer: copy to the phone, open with a file manager, tap to install
- Email it to yourself and open the attachment on the phone
- Share via Google Drive / Dropbox

---

## Installing on additional devices

Copy the same `app-debug.apk` to each device and install it. No rebuild needed unless
you change the app code.

---

## Updating the app

When you change the code:

```powershell
cd mobile/android
.\gradlew.bat assembleDebug
```

The `android/` folder persists — you only need to re-run `npx expo prebuild` if you
change `app.json` (permissions, plugins, package name).

Install the new APK over the existing one; credentials are preserved.

---

## Notifications (opt-in)

Go to the **Settings** tab and toggle **New events** or **Grocery items**. The app polls
every 15 minutes in the background and fires a local notification when something is added.

If your phone aggressively kills background apps, go to:
*Settings → Battery → Battery optimization → All apps → FamilyHub → Don't optimize*

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ANDROID_HOME` not found | Set the env var, restart your terminal |
| `gradlew.bat` fails with SDK error | Open `android/` in Android Studio once to let it sync |
| APK won't install | Enable "Install unknown apps" for your file manager |
| Login fails | Check you're on a network that can reach your server, and that the server URL is correct |
| Notifications not arriving | Disable battery optimization for FamilyHub |
