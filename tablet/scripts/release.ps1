<#
.SYNOPSIS
  Builds the FamilyHub Tablet release APK, publishes it for the in-app updater, and
  (optionally) pushes it straight onto the tablet over Wireless debugging.

.DESCRIPTION
  The build runs from a mirror outside OneDrive (C:\android-build\fh-tablet) so Gradle
  never touches OneDrive placeholder files, which is the cause of the phone app's
  snapshot and lock errors. The mirror also gets ../mobile/src, since the tablet
  imports shared code from there.

  Bump "version" and "android.versionCode" in tablet/app.json before running. The
  updater only installs a build whose versionCode is higher than the installed one.

.PARAMETER SkipBuild
  Reuse the APK already in C:ndroid-buildh-tablet\dist for this version (e.g. to
  publish or push a build made earlier with -SkipUpload).

.PARAMETER SkipUpload
  Build only. Don't upload to FTP or update the manifest.

.PARAMETER Push
  After building, find the tablet via adb mDNS (Wireless debugging must be on and
  paired, see tablet/README.md) and install the APK silently with `adb install -r`.

.PARAMETER Device
  Explicit adb target (ip:port) instead of mDNS discovery.
#>
param(
  [switch]$SkipBuild,
  [switch]$SkipUpload,
  [switch]$Push,
  [string]$Device
)
$ErrorActionPreference = 'Stop'

$repo    = Resolve-Path "$PSScriptRoot\..\.."
$tablet  = Join-Path $repo 'tablet'
$mirror  = 'C:\android-build\fh-tablet'
$sdk     = "$env:LOCALAPPDATA\Android\Sdk"
$adb     = "$sdk\platform-tools\adb.exe"

$app         = Get-Content "$tablet\app.json" -Raw | ConvertFrom-Json
$version     = $app.expo.version
$versionCode = [int]$app.expo.android.versionCode
$apkName     = "FamilyHubTablet-v$version.apk"
Write-Host "== FamilyHub Tablet $version (build $versionCode)"

$dist = "$mirror\dist"
$apk  = Join-Path $dist $apkName

if (-not $SkipBuild) {
# ── Mirror sources outside OneDrive ─────────────────────────────────────────────
# /MIR keeps the mirror exact; /XD'd folders (node_modules, android, .expo) are neither
# copied nor purged, so npm and Gradle caches survive between builds.
robocopy $tablet "$mirror\tablet" /MIR /XD node_modules android .expo /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy tablet failed ($LASTEXITCODE)" }
robocopy "$repo\mobile\src" "$mirror\mobile\src" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy mobile/src failed ($LASTEXITCODE)" }

$env:JAVA_HOME        = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME     = $sdk
$env:GRADLE_USER_HOME = 'C:\gradle-home'
$env:PATH = "C:\Program Files\nodejs;$env:JAVA_HOME\bin;$sdk\platform-tools;$env:PATH"

# The NDK's libc++_shared.so files keep turning into Windows reparse points, and CMake's
# copies inherit that, which fails Gradle with "Cannot snapshot ... not a regular file"
# (root README, "Fix NDK .so files"). Re-materialize any that have reverted, and drop
# CMake output that already captured a bad copy.
$fixedNdk = $false
Get-ChildItem "$sdk\ndk\*\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\*\libc++_shared.so" | ForEach-Object {
  if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    $bytes = [IO.File]::ReadAllBytes($_.FullName)
    [IO.File]::Delete($_.FullName)
    [IO.File]::WriteAllBytes($_.FullName, $bytes)
    $fixedNdk = $true
  }
}
if ($fixedNdk) {
  Write-Host '== Re-materialized NDK libc++_shared.so; clearing cached CMake output'
  Get-ChildItem "$mirror\tablet\node_modules" -Directory -Recurse -Depth 4 -Filter .cxx -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force
  Get-ChildItem "$mirror\tablet\node_modules" -Directory -Recurse -Depth 5 -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\android\\build\\intermediates\\cxx$' } | Remove-Item -Recurse -Force
}

Push-Location "$mirror\tablet"
try {
  # Install exactly what the committed lockfile says (a fresh `npm install` can
  # re-resolve peers differently), and only when the lockfile changed since last time.
  $lockHash = (Get-FileHash package-lock.json).Hash
  $stamp = 'node_modules\.lock-hash'
  if (-not (Test-Path $stamp) -or (Get-Content $stamp) -ne $lockHash) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE) { throw 'npm ci failed' }
    Set-Content $stamp $lockHash
  }
  # --clean regenerates android/ from app.json every time, so versionCode can't drift.
  npx expo prebuild --platform android --clean --no-install
  if ($LASTEXITCODE) { throw 'expo prebuild failed' }
  Set-Content android\local.properties "sdk.dir=$($sdk -replace '\\','\\')"
  Push-Location android
  try {
    $env:NODE_ENV = 'production'
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE) { throw 'gradle assembleRelease failed' }
  } finally { Pop-Location }
} finally { Pop-Location }

$built = "$mirror\tablet\android\app\build\outputs\apk\release\app-release.apk"
$age = (Get-Date) - (Get-Item $built).LastWriteTime
if ($age.TotalMinutes -gt 30) { throw "APK at $built is $([int]$age.TotalMinutes) min old; refusing to ship a stale build" }
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $built $apk -Force
Write-Host "== Built $apk ($([math]::Round((Get-Item $apk).Length / 1MB, 1)) MB)"
} elseif (-not (Test-Path $apk)) {
  throw "-SkipBuild: no $apkName in $dist; build it first"
}

# ── Publish for the in-app updater ──────────────────────────────────────────────
if (-not $SkipUpload) {
  $envVars = @{}
  Get-Content "$repo\.env" | Where-Object { $_ -match '^\s*(FTP_\w+)\s*=\s*(.*)$' } | ForEach-Object {
    $envVars[$Matches[1]] = $Matches[2].Trim().Trim('"')
  }
  $pass = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envVars.FTP_PASSWORD))
  $ftp  = "ftp://$($envVars.FTP_SITE)$($envVars.FTP_FOLDER)"
  # FTP_FOLDER is /public_html/<x>; the web path drops the public_html part.
  $webBase = "https://$($envVars.FTP_SITE)" + ($envVars.FTP_FOLDER -replace '^/public_html', '')

  $manifest = Join-Path $dist 'familyhub-tablet.json'
  [ordered]@{ version = $version; versionCode = $versionCode; url = "$webBase/$apkName" } |
    ConvertTo-Json | Set-Content $manifest -Encoding utf8NoBOM

  # APK first, manifest second, so a tablet never sees a manifest pointing at a missing file.
  foreach ($f in @($apk, $manifest)) {
    curl.exe --fail --silent --show-error --user "$($envVars.FTP_USER):$pass" -T $f "$ftp/"
    if ($LASTEXITCODE) { throw "FTP upload of $f failed" }
  }
  $check = Invoke-RestMethod "$webBase/familyhub-tablet.json?t=$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
  if ($check.versionCode -ne $versionCode) { throw "Published manifest shows build $($check.versionCode), expected $versionCode" }
  Write-Host "== Published $webBase/$apkName (the tablet will offer it within 6 hours, or tap Check now)"
}

# ── Push straight to the tablet ─────────────────────────────────────────────────
if ($Push) {
  if (-not $Device) {
    # Network adb advertises the tablet's current IPv4 and port over mDNS: as _adb._tcp
    # for classic adb-over-TCP (what this tablet ships with, port 5555), or as
    # _adb-tls-connect._tcp for paired Wireless debugging (port changes on each restart).
    $line = & $adb mdns services | Select-String '_adb(-tls-connect)?\._tcp' | Select-Object -First 1
    if (-not $line) { throw 'Tablet not found via mDNS. Is Wireless debugging on (and paired)?' }
    $Device = @($line.Line -split '\s+' | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+:\d+$' })[0]
  }
  Write-Host "== Installing on $Device"
  & $adb connect $Device | Write-Host
  & $adb -s $Device install -r $apk
  if ($LASTEXITCODE) { throw 'adb install failed' }
  & $adb -s $Device shell am start -n com.familyhub.tablet/.MainActivity | Out-Null
  Write-Host '== Installed and relaunched'
}
