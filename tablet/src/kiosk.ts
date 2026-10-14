import { BackHandler } from 'react-native';
import * as Kiosk from '../modules/kiosk';
import { getToggle } from './settings';

// Set from the admin screen when a grown-up needs the tablet for something else. It is
// temporary: it ends when the app is brought back to the front, when the grown-up taps
// Done, after the idle timeout, or when the app next launches (see HubLayout).
let paused = false;

/** Hides the navigation bar whenever the app is in front (it would otherwise cover the
 *  settings cog at the bottom of the rail), and pins the app unless kiosk mode is off.
 *  Both are skipped while paused. Safe to call repeatedly. */
export async function enforceKiosk(): Promise<void> {
  if (paused) return;
  await Kiosk.setImmersive(true);
  if (!(await getToggle('kiosk_enabled'))) return;
  if (!Kiosk.isLocked()) await Kiosk.lock();
}

/** The "Pin now" button: pins immediately, whether or not the start-up switch is on.
 *  Resolves to whether Android actually pinned the app, which it won't if "App pinning"
 *  is off in Android's own security settings. */
export async function pinNow(): Promise<boolean> {
  paused = false;
  await Kiosk.setImmersive(true);
  if (!Kiosk.isLocked()) await Kiosk.lock();
  // startLockTask() takes effect asynchronously.
  await new Promise(resolve => setTimeout(resolve, 700));
  return Kiosk.isLocked();
}

export async function pauseKiosk(): Promise<void> {
  paused = true;
  await Kiosk.setImmersive(false);
  await Kiosk.unlock();
}

export async function resumeKiosk(): Promise<void> {
  paused = false;
  await enforceKiosk();
}

/** Leaves the app entirely, and ends the process so the next launch starts cleanly. */
export async function exitApp(): Promise<void> {
  if (!(await Kiosk.exitApp())) BackHandler.exitApp();
}

export function isKioskPaused(): boolean {
  return paused;
}

export const isPinned = Kiosk.isLocked;
