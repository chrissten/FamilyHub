import * as Kiosk from '../modules/kiosk';
import { getToggle } from './settings';

// Set from the admin screen when a grown-up needs the tablet for something else.
// Lasts until the app is next launched, so a reboot or update always comes back locked.
let paused = false;

/** Pins the app unless kiosk mode is off or paused. Safe to call repeatedly. */
export async function enforceKiosk(): Promise<void> {
  if (paused || !(await getToggle('kiosk_enabled'))) return;
  if (!Kiosk.isLocked()) await Kiosk.lock();
}

export async function pauseKiosk(): Promise<void> {
  paused = true;
  await Kiosk.unlock();
}

export async function resumeKiosk(): Promise<void> {
  paused = false;
  await enforceKiosk();
}

export function isKioskPaused(): boolean {
  return paused;
}

export const isPinned = Kiosk.isLocked;
