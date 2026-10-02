import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, AppState } from 'react-native';
import { Slot, usePathname, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTheme, useTimeFormat, formatClock, type Colors } from '../../src/shared';
import { useToggle } from '../../src/settings';
import { enforceKiosk } from '../../src/kiosk';
import { checkForUpdate, useUpdateState } from '../../src/updater';
import { useNow } from '../../src/WeekBoard';
import PinPrompt from '../../src/PinPrompt';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const SECTIONS: { href: Href; path: string; label: string; icon: IoniconsName }[] = [
  { href: '/calendar', path: '/calendar', label: 'Calendar', icon: 'calendar' },
  { href: '/grocery', path: '/grocery', label: 'Grocery', icon: 'cart' },
];

const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
// Wander back to the week view after this long without a touch, so the tablet always
// "rests" on the calendar.
const IDLE_RETURN_MS = 3 * 60 * 1000;

export default function HubLayout() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const pathname = usePathname();
  const timeFormat = useTimeFormat();
  const now = useNow();
  const keepAwake = useToggle('keep_awake');
  const update = useUpdateState();
  const [pinVisible, setPinVisible] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // Pin on launch and whenever the app comes back to the foreground (e.g. after a
  // grown-up paused kiosk mode from the admin screen and then returned).
  useEffect(() => {
    enforceKiosk();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') enforceKiosk(); });
    return () => sub.remove();
  }, []);

  // The hardware/gesture Back does nothing here; the only way out is the PIN-gated admin screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (keepAwake) activateKeepAwakeAsync('hub');
    else deactivateKeepAwake('hub');
  }, [keepAwake]);

  useEffect(() => {
    checkForUpdate();
    const id = setInterval(checkForUpdate, UPDATE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  function bumpIdle() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (pathRef.current !== '/calendar') router.replace('/calendar');
    }, IDLE_RETURN_MS);
  }

  useEffect(() => {
    bumpIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [pathname]);

  return (
    <View
      style={styles.container}
      onStartShouldSetResponderCapture={() => { bumpIdle(); return false; }}
    >
      <View style={styles.rail}>
        <View style={styles.clock}>
          <Text style={styles.clockTime}>{formatClock(now.getHours(), now.getMinutes(), timeFormat)}</Text>
          <Text style={styles.clockDate}>
            {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
        </View>

        {SECTIONS.map(s => {
          const active = pathname === s.path;
          return (
            <TouchableOpacity
              key={s.path}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => router.replace(s.href)}
            >
              <Ionicons name={s.icon} size={34} color={active ? colors.primaryText : colors.textMuted} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}

        <View style={{ flex: 1 }} />

        <TouchableOpacity style={styles.adminBtn} onPress={() => setPinVisible(true)}>
          <Ionicons name="settings-outline" size={26} color={colors.textFaint} />
          {update.kind === 'ready' && <View style={styles.updateDot} />}
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Slot />
      </View>

      <PinPrompt
        visible={pinVisible}
        onCancel={() => setPinVisible(false)}
        onSuccess={() => { setPinVisible(false); router.push('/admin'); }}
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
    rail: {
      width: 132, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border,
      paddingVertical: 16, paddingHorizontal: 10, gap: 10,
    },
    clock: { alignItems: 'center', marginBottom: 14 },
    clockTime: { fontSize: 26, fontWeight: '700', color: colors.text },
    clockDate: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
    navItem: { alignItems: 'center', paddingVertical: 16, borderRadius: 16 },
    navItemActive: { backgroundColor: colors.primary },
    navLabel: { fontSize: 15, marginTop: 4, color: colors.textMuted, fontWeight: '600' },
    navLabelActive: { color: colors.primaryText },
    adminBtn: { alignItems: 'center', padding: 12 },
    updateDot: {
      position: 'absolute', top: 10, right: 38, width: 10, height: 10, borderRadius: 5,
      backgroundColor: colors.danger,
    },
    content: { flex: 1 },
  });
}
