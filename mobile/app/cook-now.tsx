import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, SectionList, StyleSheet, TouchableOpacity, Alert, RefreshControl,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getCookNow } from '../src/api/client';
import type { RecipeMatch } from '../src/api/types';
import { useTheme, type Colors } from '../src/theme';

const FILTERS: { label: string; value: number | undefined }[] = [
  { label: 'Everything', value: undefined },
  { label: 'Ready now', value: 0 },
  { label: 'Missing 1', value: 1 },
  { label: '3 or fewer', value: 3 },
];

const BUCKET_TITLES: Record<RecipeMatch['bucket'], string> = {
  ready: 'Ready to cook',
  one: 'One ingredient away',
  several: 'Needs a shop',
};

export default function CookNowScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();

  const [matches, setMatches] = useState<RecipeMatch[]>([]);
  const [filter, setFilter] = useState<number | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { load(filter); }, [filter]));

  async function load(maxMissing: number | undefined) {
    setRefreshing(true);
    try {
      setMatches(await getCookNow(maxMissing));
    } catch {
      Alert.alert('Error', 'Could not work out what you can cook');
    } finally {
      setRefreshing(false);
    }
  }

  const sections = useMemo(() => {
    const order: RecipeMatch['bucket'][] = ['ready', 'one', 'several'];
    return order
      .map(bucket => ({ bucket, title: BUCKET_TITLES[bucket], data: matches.filter(m => m.bucket === bucket) }))
      .filter(s => s.data.length > 0);
  }, [matches]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'What can I cook?',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/pantry')} hitSlop={8}>
              <Ionicons name="file-tray-stacked-outline" size={21} color="#fff" />
            </TouchableOpacity>
          ),
        }}
      />

      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.label}
            style={[styles.filterChip, filter === f.value && styles.filterChipActive]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.filterText, filter === f.value && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={m => String(m.recipe.id)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(filter)} colors={[colors.primary]} tintColor={colors.primary} />}
        contentContainerStyle={sections.length === 0 ? styles.emptyWrap : { paddingBottom: 40 }}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeaderWrap}>
            <Text style={styles.sectionHeader}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item: m }) => (
          <TouchableOpacity
            style={[styles.card, styles[`card_${m.bucket}` as const]]}
            onPress={() => router.push(`/recipe-detail?id=${m.recipe.id}`)}
          >
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} numberOfLines={2}>{m.recipe.title}</Text>
              <Text style={[styles.badge, styles[`badge_${m.bucket}` as const]]}>
                {m.can_make ? 'Ready' : `Missing ${m.shortfall}`}
              </Text>
            </View>

            <Text style={styles.cardMeta}>
              have {m.have.length} of {m.have.length + m.missing.length + m.unknown.length}
              {m.recipe.servings ? ` · serves ${m.recipe.servings}` : ''}
            </Text>

            {m.missing.length > 0 && (
              <View style={styles.needRow}>
                <Text style={styles.needLabel}>Need:</Text>
                {m.missing.map(i => (
                  <Text key={i.id} style={styles.needChip}>{i.ingredient?.name ?? i.name}</Text>
                ))}
              </View>
            )}

            {m.unknown.length > 0 && (
              <View style={styles.needRow}>
                <Text style={styles.needLabel}>Not recognised:</Text>
                {m.unknown.map(i => <Text key={i.id} style={styles.needChip}>{i.name}</Text>)}
              </View>
            )}

            {!m.can_make && (
              <TouchableOpacity
                style={styles.pushButton}
                onPress={() => router.push(`/recipe-to-grocery?id=${m.recipe.id}`)}
              >
                <Ionicons name="cart-outline" size={15} color={colors.primary} />
                <Text style={styles.pushText}>Add what's missing</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter !== undefined
              ? 'Nothing matches that filter yet.'
              : "No recipes yet — add some, and fill in the pantry so this can match against it."}
          </Text>
        }
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    filterRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    filterChip: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    filterChipActive: { backgroundColor: colors.primary },
    filterText: { fontSize: 12.5, color: colors.chipText },
    filterTextActive: { color: colors.primaryText, fontWeight: '600' },
    sectionHeaderWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 18, paddingBottom: 7 },
    sectionHeader: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: colors.textFaint },
    sectionCount: {
      fontSize: 10.5, color: colors.textMuted, backgroundColor: colors.chip,
      paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: 'hidden',
    },
    card: {
      backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 9,
      borderRadius: 10, padding: 12, borderLeftWidth: 4, borderLeftColor: colors.border,
    },
    card_ready: { borderLeftColor: '#2a9d5c' },
    card_one: { borderLeftColor: colors.warning },
    card_several: { borderLeftColor: colors.border },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    cardTitle: { flex: 1, fontSize: 15.5, fontWeight: '600', color: colors.text },
    badge: {
      fontSize: 10.5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
      overflow: 'hidden', color: colors.textMuted, backgroundColor: colors.chip,
    },
    badge_ready: { backgroundColor: '#e3f4ea', color: '#2a9d5c' },
    badge_one: { backgroundColor: colors.warningBg, color: colors.warning },
    badge_several: {},
    cardMeta: { fontSize: 11.5, color: colors.textFaint, marginTop: 3 },
    needRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 7 },
    needLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    needChip: {
      fontSize: 11.5, color: colors.text, backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, overflow: 'hidden',
    },
    pushButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    pushText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    empty: { color: colors.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  });
}
