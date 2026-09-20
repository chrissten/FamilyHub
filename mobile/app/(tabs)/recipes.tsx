import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, TextInput,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getRecipes } from '../../src/api/client';
import type { RecipeSummary } from '../../src/api/types';
import { useTheme, type Colors } from '../../src/theme';
import { setPendingRecipeForm, totalMinutes } from '../../src/recipes/formState';

export default function RecipesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { load(); }, [activeTag]));

  async function load(query?: string) {
    setRefreshing(true);
    try {
      setRecipes(await getRecipes(query ?? search, activeTag ?? undefined));
    } catch {
      Alert.alert('Error', 'Could not load recipes');
    } finally {
      setRefreshing(false);
    }
  }

  // Every tag in the current result set, so the filter row reflects what's actually there.
  const tags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const recipe of recipes) {
      for (const name of recipe.tag_names) {
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, name);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [recipes]);

  function openNew() {
    setPendingRecipeForm({ recipe: null });
    router.push('/recipe-form');
  }

  function renderCard({ item }: { item: RecipeSummary }) {
    const minutes = totalMinutes(item);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/recipe-detail?id=${item.id}`)}
      >
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          {!!item.description && (
            <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          )}
          <View style={styles.cardMeta}>
            {minutes != null && <Text style={styles.metaText}>{minutes} min</Text>}
            {item.servings != null && <Text style={styles.metaText}>Serves {item.servings}</Text>}
            {!item.is_public && <Text style={styles.privateBadge}>Private</Text>}
          </View>
          {item.tag_names.length > 0 && (
            <View style={styles.cardTags}>
              {item.tag_names.map(name => (
                <Text key={name} style={styles.tagChipSmall}>{name}</Text>
              ))}
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => load()}
          returnKeyType="search"
          placeholder="Search name or ingredient…"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(''); load(''); }}>
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.importButton} onPress={() => router.push('/recipe-import')}>
          <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.addButton} onPress={openNew}>
          <Ionicons name="add" size={22} color={colors.primaryText} />
        </TouchableOpacity>
      </View>

      <View style={styles.kitchenRow}>
        <TouchableOpacity style={styles.kitchenButton} onPress={() => router.push('/cook-now')}>
          <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
          <Text style={styles.kitchenText}>What can I cook?</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.kitchenButton} onPress={() => router.push('/pantry')}>
          <Ionicons name="file-tray-stacked-outline" size={16} color={colors.primary} />
          <Text style={styles.kitchenText}>Pantry</Text>
        </TouchableOpacity>
      </View>

      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map(name => {
            const active = activeTag?.toLowerCase() === name.toLowerCase();
            return (
              <TouchableOpacity
                key={name}
                onPress={() => setActiveTag(active ? null : name)}
                style={[styles.tagChip, active && styles.tagChipActive]}
              >
                <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>{name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <FlatList
        data={recipes}
        keyExtractor={item => String(item.id)}
        renderItem={renderCard}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} colors={[colors.primary]} tintColor={colors.primary} />}
        contentContainerStyle={recipes.length === 0 ? styles.emptyWrap : styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {search || activeTag
              ? 'No recipes match that.'
              : 'No recipes yet — import one from a link or a photo, or tap + to type one in.'}
          </Text>
        }
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    searchInput: {
      flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: colors.text,
    },
    addButton: {
      backgroundColor: colors.primary, borderRadius: 8,
      width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    },
    importButton: {
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
      borderRadius: 8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    },
    kitchenRow: {
      flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 9,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    kitchenButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingVertical: 9,
    },
    kitchenText: { fontSize: 13, fontWeight: '600', color: colors.primary },
    tagRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 6,
      paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    tagChip: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    tagChipActive: { backgroundColor: colors.primary },
    tagChipText: { fontSize: 12, color: colors.chipText },
    tagChipTextActive: { color: colors.primaryText },
    listContent: { paddingBottom: 80 },
    emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    empty: { textAlign: 'center', color: colors.textMuted, fontSize: 15 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    cardMain: { flex: 1 },
    cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    cardDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
    cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 5, alignItems: 'center' },
    metaText: { fontSize: 12, color: colors.textFaint },
    privateBadge: {
      fontSize: 11, color: colors.warning, backgroundColor: colors.warningBg,
      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
    },
    cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
    tagChipSmall: {
      fontSize: 11, color: colors.chipText, backgroundColor: colors.chip,
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
    },
  });
}
