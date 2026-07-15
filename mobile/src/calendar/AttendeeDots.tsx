import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { User } from '../api/types';
import { useTheme, type Colors } from '../theme';

/** Port of the _attendee_dots.html macro — a dot per attendee, or an "All" badge. */
export default function AttendeeDots({ attendees, familySize }: { attendees: User[]; familySize: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (familySize > 1 && attendees.length >= familySize) {
    return (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>All</Text>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {attendees.map(person => (
        <View key={person.id} style={[styles.dot, { backgroundColor: person.color_hex }]} />
      ))}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', gap: 3 },
    dot: { width: 7, height: 7, borderRadius: 3.5 },
    badge: {
      backgroundColor: colors.primary, borderRadius: 6,
      paddingHorizontal: 5, paddingVertical: 1,
    },
    badgeText: { color: colors.primaryText, fontSize: 9, fontWeight: '700' },
  });
}
