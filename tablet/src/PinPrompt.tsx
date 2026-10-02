import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type Colors } from './shared';
import { checkAdminPin } from './settings';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/** Grown-ups-only gate in front of the admin screen. */
export default function PinPrompt({ visible, onCancel, onSuccess }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  useEffect(() => { if (visible) { setPin(''); setWrong(false); } }, [visible]);

  async function press(key: typeof KEYS[number]) {
    setWrong(false);
    if (key === 'clear') return setPin('');
    if (key === 'back') return setPin(p => p.slice(0, -1));
    const next = (pin + key).slice(0, 8);
    setPin(next);
    if (next.length >= 4 && await checkAdminPin(next)) onSuccess();
  }

  async function submit() {
    if (await checkAdminPin(pin)) onSuccess();
    else { setWrong(true); setPin(''); }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Grown-ups only</Text>
          <Text style={[styles.dots, wrong && { color: colors.danger }]}>
            {wrong ? 'Wrong PIN' : pin.length ? '●'.repeat(pin.length) : 'Enter PIN'}
          </Text>
          <View style={styles.grid}>
            {KEYS.map(k => (
              <TouchableOpacity key={k} style={styles.key} onPress={() => press(k)}>
                {k === 'clear' ? <Text style={styles.keySmall}>Clear</Text>
                  : k === 'back' ? <Ionicons name="backspace-outline" size={28} color={colors.text} />
                  : <Text style={styles.keyText}>{k}</Text>}
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancel} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ok} onPress={submit}>
              <Text style={styles.okText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
    card: { width: 380, backgroundColor: colors.surface, borderRadius: 20, padding: 24, alignItems: 'center' },
    title: { fontSize: 22, fontWeight: '700', color: colors.text },
    dots: { fontSize: 22, color: colors.textMuted, marginVertical: 16, letterSpacing: 4, height: 32 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', width: 300, justifyContent: 'space-between', rowGap: 12 },
    key: {
      width: 92, height: 64, borderRadius: 14, backgroundColor: colors.surfaceAlt,
      justifyContent: 'center', alignItems: 'center',
    },
    keyText: { fontSize: 28, fontWeight: '600', color: colors.text },
    keySmall: { fontSize: 16, color: colors.textMuted },
    actions: { flexDirection: 'row', gap: 12, marginTop: 20, width: 300 },
    cancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    cancelText: { fontSize: 17, color: colors.textMuted },
    ok: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
    okText: { fontSize: 17, color: colors.primaryText, fontWeight: '700' },
  });
}
