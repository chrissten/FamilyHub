import { useEffect, useState } from 'react';
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { pauseKiosk } from './kiosk';

/** Written by scripts/release.ps1 next to the uploaded APK. */
export const UPDATE_MANIFEST_URL = 'https://thestehnos.com/upload/familyhub-tablet.json';

export interface UpdateManifest {
  version: string;
  versionCode: number;
  url: string;
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; checkedAt: Date }
  | { kind: 'downloading'; manifest: UpdateManifest }
  | { kind: 'ready'; manifest: UpdateManifest; file: File }
  | { kind: 'error'; message: string };

let state: UpdateState = { kind: 'idle' };
const listeners = new Set<(s: UpdateState) => void>();

function setState(next: UpdateState) {
  state = next;
  listeners.forEach(l => l(next));
}

export function useUpdateState(): UpdateState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

export function installedVersion(): { version: string; versionCode: number } {
  return {
    version: Application.nativeApplicationVersion ?? '?',
    versionCode: Number(Application.nativeBuildVersion ?? 0),
  };
}

/** Checks the manifest and, if there's a newer build, downloads it so a grown-up can
 *  install it with one tap. Never installs on its own: the installer has to unpin the
 *  app, and that shouldn't happen while a child is using the tablet. */
export async function checkForUpdate(): Promise<void> {
  if (state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'ready') return;
  setState({ kind: 'checking' });
  try {
    const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
    const manifest: UpdateManifest = await res.json();
    if (!(manifest.versionCode > installedVersion().versionCode)) {
      setState({ kind: 'current', checkedAt: new Date() });
      return;
    }
    setState({ kind: 'downloading', manifest });
    const file = new File(Paths.cache, `FamilyHubTablet-${manifest.versionCode}.apk`);
    if (file.exists) file.delete();
    await File.downloadFileAsync(manifest.url, file);
    setState({ kind: 'ready', manifest, file });
  } catch (e) {
    setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

/** Unpins and hands the APK to Android's installer. Android kills this app once the
 *  install finishes; tapping "Open" (or a reboot, since this is the launcher) brings
 *  it back, and it pins itself again on launch. */
export async function installUpdate(): Promise<void> {
  if (state.kind !== 'ready') return;
  await pauseKiosk();
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: state.file.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
