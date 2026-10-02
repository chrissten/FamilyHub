# FamilyHub Tablet

A landscape app for the shared 15" family tablet. It opens on the **weekly calendar**,
lets anyone **add to the grocery list**, and can **pin itself** so kids can't leave it
(off until a grown-up turns on "Lock when the app starts"). A grown-ups PIN opens the
settings screen.

It reuses the phone app's API client, types, theme and calendar maths straight from
`../mobile/src` (see `metro.config.js`), so a backend API change that's handled in
`mobile/src` reaches both apps.

| Area | What it does |
|---|---|
| Calendar (default) | Week grid sized for the wall, events colour-coded by person, "now" line, tap for details. Refreshes every 2 min and snaps back to this week when left alone. |
| Grocery | Big "What do we need?" box, store-section chips (defaults to *Other*), tap items to tick them off. No deleting from the tablet. |
| Settings (PIN) | Pin/unpin, open Android settings, keep-screen-on, check/install updates, change account, change PIN. |

After 3 minutes without a touch, the app returns to the calendar.

## How the lock works

The app uses Android **screen pinning** (`startLockTask`, see `modules/kiosk`). While
pinned, Home, Recents and the notification shade do nothing. The app also ignores Back.
Two ways out:

1. **Settings → Unpin** (behind the grown-ups PIN).
2. The system unpin gesture (hold **Back + Overview**). Make that ask for the **device**
   PIN: *Settings → Security → More security settings → App pinning → "Ask for PIN
   before unpinning"* (the menu path varies by brand; search Settings for "pin").
   Without a device screen lock, the gesture unpins freely.

The lock is **off by default**, so a fresh install can never lock anyone out. Once a grown-up
turns on *Lock when the app starts*, the app re-pins itself on every launch and whenever
it returns to the foreground, unless paused from Settings (which lasts until the app
restarts). Set up the device PIN and "Ask for PIN before unpinning" first.

Optional: press Home once and choose **FamilyHub Tablet → Always**. The app then
becomes the launcher, so it comes back by itself after a reboot or power cut. To undo
that, use Settings → *Open Android settings* → Apps → Default apps → Home app.

## One-time tablet setup

1. **Wi-Fi:** use **VadenCentral**. The "Garage" extender gave the tablet IPv6 only (no
   DHCPv4), and neither the FamilyHub server nor thestehnos.com is reachable over IPv6.
2. **Screen lock:** set a device PIN (needed for "Ask for PIN before unpinning").
3. **App pinning:** turn it on, plus "Ask for PIN before unpinning" (see above).
4. **Developer options:** *Settings → About tablet → tap Build number 7 times*.
5. **Wireless debugging:** *Developer options → Wireless debugging → On*. That screen
   shows the tablet's **IP address & port**.
6. **Pair the PC once:** on the tablet, tap *Pair device with pairing code*. On the PC:
   ```powershell
   $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
   & $adb pair <ip>:<pairing-port>   # enter the 6-digit code
   & $adb mdns services              # should now list _adb-tls-connect with ip:port
   ```
7. **First install:** `tablet\scripts\release.ps1 -Push` (or copy the APK over and tap it).
8. In the app: enter the FamilyHub server URL and a family account, then choose the
   grown-ups PIN. When ready, turn on *Lock when the app starts* in its settings.
9. When the first update arrives, Android asks once to allow *Install unknown apps*
   for FamilyHub Tablet. Allow it.

## Releasing an update

1. Bump `version` **and** `android.versionCode` in `app.json` (the updater compares
   `versionCode`).
2. Run:
   ```powershell
   tablet\scripts\release.ps1          # build + publish for the in-app updater
   tablet\scripts\release.ps1 -Push    # ...and install on the tablet right now via adb
   ```

The script mirrors the source to `C:\android-build\fh-tablet` and builds there, so
OneDrive never touches Gradle's files. It then uploads `FamilyHubTablet-v<version>.apk`
and `familyhub-tablet.json` to the FTP upload folder (credentials from the repo's `.env`).

**Two delivery paths:**

- **`-Push` (adb):** silent. `adb install -r` replaces the app and relaunches it, with
  no taps on the tablet. Needs Wireless debugging on. Android turns it off when the
  tablet changes Wi-Fi networks, and some brands also turn it off on reboot.
- **In-app updater:** the tablet checks the manifest every 6 hours and downloads new
  builds in the background. A red dot appears on the settings cog. A grown-up enters
  the PIN and taps **Install**. It never installs on its own, because the Android
  installer has to unpin the app first.

Releases are signed with the Expo template's debug keystore, which is the same on every
`prebuild`. Updates therefore install over each other. Don't switch keys later without
uninstalling first.

## Development

```powershell
cd tablet
npm install
npx tsc --noEmit
npx expo start          # JS-only UI work; the kiosk calls are no-ops in Expo Go
```
