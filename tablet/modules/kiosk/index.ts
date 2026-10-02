import { requireOptionalNativeModule } from 'expo-modules-core';

interface KioskNative {
  isLocked(): boolean;
  lock(): Promise<boolean>;
  unlock(): Promise<void>;
}

// Optional so the JS still runs in Expo Go / on the web during UI work, where there's
// no native side — the kiosk calls just become no-ops there.
const native = requireOptionalNativeModule<KioskNative>('Kiosk');

export function isLocked(): boolean {
  return native?.isLocked() ?? false;
}

export async function lock(): Promise<boolean> {
  return native ? native.lock() : false;
}

export async function unlock(): Promise<void> {
  await native?.unlock();
}
