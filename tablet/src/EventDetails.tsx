import { useMemo, type ComponentProps } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useTheme, useTimeFormat, eventStart, eventTimeLabel, dayLabel, type Colors, type CalendarEvent,
} from './shared';

interface Props {
  event: CalendarEvent | null;
  onClose: () => void;
}

/** Read-only: the tablet shows the family calendar, edits happen on phones / the web. */
export default function EventDetails({ event, onClose }: Props) {
  const { colors } = useTheme();
  const timeFormat = useTimeFormat();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!event) return null;
  const attendees = event.attendees.length ? event.attendees : [event.owner];
  const start = eventStart(event);

  const row = (icon: ComponentProps<typeof Ionicons>['name'], text: string) => (
    <View style={styles.row}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={styles.overlay} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.card, { borderTopColor: attendees[0].color_hex }]}>
          <ScrollView>
            <Text style={styles.title}>{event.title}</Text>
            {row('calendar-outline', dayLabel(start))}
            {row('time-outline', eventTimeLabel(event, start, timeFormat))}
            {event.location ? row('location-outline', event.location) : null}
            <View style={styles.people}>
              {attendees.map(u => (
                <View key={u.id} style={[styles.person, { backgroundColor: u.color_hex + '26', borderColor: u.color_hex }]}>
                  <View style={[styles.dot, { backgroundColor: u.color_hex }]} />
                  <Text style={styles.personText}>{u.display_name}</Text>
                </View>
              ))}
            </View>
            {event.description ? <Text style={styles.description}>{event.description}</Text> : null}
          </ScrollView>
          <TouchableOpacity style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
    card: {
      width: 560, maxHeight: '80%', backgroundColor: colors.surface, borderRadius: 20,
      borderTopWidth: 8, padding: 28,
    },
    title: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 16 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
    rowText: { fontSize: 19, color: colors.text, flexShrink: 1 },
    people: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    person: {
      flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5,
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    },
    dot: { width: 12, height: 12, borderRadius: 6 },
    personText: { fontSize: 17, color: colors.text, fontWeight: '600' },
    description: { fontSize: 17, color: colors.textMuted, marginTop: 18, lineHeight: 24 },
    close: {
      marginTop: 20, alignSelf: 'flex-end', paddingHorizontal: 28, paddingVertical: 12,
      borderRadius: 12, backgroundColor: colors.primary,
    },
    closeText: { color: colors.primaryText, fontSize: 18, fontWeight: '700' },
  });
}
