import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Linking, ActivityIndicator,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getRecipe, deleteRecipe, getCurrentUserId } from '../src/api/client';
import type { Recipe } from '../src/api/types';
import { useTheme, type Colors } from '../src/theme';
import { setPendingRecipeForm, totalMinutes } from '../src/recipes/formState';
import { leftoverColors, leftoverLabel } from '../src/recipes/leftovers';

export default function RecipeDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipeId = Number(id);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<number | null>(null);

  // Refetch on focus rather than trusting a snapshot: coming back from the editor,
  // or from someone else's edit on the web, should show the current version.
  useFocusEffect(useCallback(() => { load(); }, [recipeId]));

  async function load() {
    try {
      const [data, uid] = await Promise.all([getRecipe(recipeId), getCurrentUserId()]);
      setRecipe(data);
      setUserId(uid);
    } catch {
      Alert.alert('Error', 'Could not load this recipe');
    } finally {
      setLoading(false);
    }
  }

  function handleEdit() {
    if (!recipe) return;
    setPendingRecipeForm({ recipe });
    router.push('/recipe-form');
  }

  function handleDelete() {
    if (!recipe) return;
    Alert.alert('Delete recipe', `Delete "${recipe.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecipe(recipe.id);
            router.back();
          } catch {
            Alert.alert('Error', 'Could not delete this recipe');
          }
        },
      },
    ]);
  }

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: recipe?.title ?? 'Recipe',
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        headerRight: () => (
          recipe ? (
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => router.push(`/recipe-cook?id=${recipe.id}`)} hitSlop={8}>
                <Ionicons name="flame-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push(`/recipe-to-grocery?id=${recipe.id}`)} hitSlop={8}>
                <Ionicons name="cart-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleEdit} hitSlop={8}>
                <Ionicons name="create-outline" size={22} color="#fff" />
              </TouchableOpacity>
              {recipe.owner.id === userId && (
                <TouchableOpacity onPress={handleDelete} hitSlop={8}>
                  <Ionicons name="trash-outline" size={22} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          ) : null
        ),
      }}
    />
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        {header}
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={styles.empty}>This recipe is no longer available.</Text>
      </View>
    );
  }

  const minutes = totalMinutes(recipe);
  const leftovers = leftoverLabel(recipe.leftover_rating);
  const badge = leftovers ? leftoverColors(recipe.leftover_rating!, colors) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {header}

      <View style={styles.metaRow}>
        {recipe.prep_minutes != null && <Text style={styles.metaText}>{recipe.prep_minutes} min prep</Text>}
        {recipe.cook_minutes != null && <Text style={styles.metaText}>{recipe.cook_minutes} min cook</Text>}
        {minutes != null && recipe.prep_minutes != null && recipe.cook_minutes != null && (
          <Text style={styles.metaText}>{minutes} min total</Text>
        )}
        {recipe.servings != null && <Text style={styles.metaText}>Serves {recipe.servings}</Text>}
        {!recipe.is_public && <Text style={styles.privateBadge}>Private</Text>}
      </View>

      {!!recipe.source_url && (
        <TouchableOpacity onPress={() => Linking.openURL(recipe.source_url!)}>
          <Text style={styles.sourceLink}>{recipe.source_name || recipe.source_url}</Text>
        </TouchableOpacity>
      )}
      {!recipe.source_url && !!recipe.source_name && (
        <Text style={styles.sourceText}>Source: {recipe.source_name}</Text>
      )}

      <Text style={styles.sectionHeader}>Ingredients</Text>
      <View style={styles.card}>
        {recipe.ingredients.length === 0 ? (
          <Text style={styles.empty}>No ingredients listed.</Text>
        ) : recipe.ingredients.map(item => (
          <View key={item.id} style={styles.ingredientRow}>
            <Text style={[styles.ingredientText, item.optional && styles.optional]}>
              {item.raw_text}
            </Text>
            {!item.ingredient && (
              // Not resolved to a canonical ingredient, so it won't count toward
              // "what can I cook" once the pantry lands.
              <Ionicons name="help-circle-outline" size={15} color={colors.textFaint} />
            )}
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={styles.cookButton}
        onPress={() => router.push(`/recipe-cook?id=${recipe.id}`)}
      >
        <Ionicons name="flame-outline" size={18} color={colors.primaryText} />
        <Text style={styles.cookButtonText}>Cook this</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.toGroceryButton}
        onPress={() => router.push(`/recipe-to-grocery?id=${recipe.id}`)}
      >
        <Ionicons name="cart-outline" size={17} color={colors.primary} />
        <Text style={styles.toGroceryText}>Add ingredients to a grocery list</Text>
      </TouchableOpacity>

      <Text style={styles.sectionHeader}>Method</Text>
      <View style={styles.card}>
        {recipe.steps.length === 0 ? (
          <Text style={styles.empty}>No steps listed.</Text>
        ) : recipe.steps.map(step => (
          <View key={step.id} style={styles.stepRow}>
            <Text style={styles.stepNumber}>{step.step_number}</Text>
            <Text style={styles.stepText}>{step.text}</Text>
          </View>
        ))}
      </View>

      {!!recipe.notes && (
        <>
          <Text style={styles.sectionHeader}>Notes</Text>
          <View style={styles.card}><Text style={styles.notesText}>{recipe.notes}</Text></View>
        </>
      )}

      {/* Always shown, even empty, so it's obvious there's somewhere to record it. */}
      <Text style={styles.sectionHeader}>Leftovers</Text>
      <View style={styles.card}>
        {leftovers && badge && (
          <Text style={[styles.leftoverBadge, { color: badge.fg, backgroundColor: badge.bg }]}>
            {leftovers}
          </Text>
        )}
        {!!recipe.leftover_notes && <Text style={styles.notesText}>{recipe.leftover_notes}</Text>}
        {!leftovers && !recipe.leftover_notes && (
          <Text style={styles.empty}>Not rated yet. Edit the recipe to note how it held up the next day.</Text>
        )}
      </View>

      <Text style={styles.byline}>Added by {recipe.owner.display_name}</Text>
    </ScrollView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 14, paddingBottom: 40 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    headerActions: { flexDirection: 'row', gap: 18, paddingRight: 4 },
    cookButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      marginTop: 14, paddingVertical: 13, borderRadius: 10, backgroundColor: colors.primary,
    },
    cookButtonText: { color: colors.primaryText, fontSize: 15, fontWeight: '600' },
    toGroceryButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      marginTop: 12, paddingVertical: 12, borderRadius: 10,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary,
    },
    toGroceryText: { color: colors.primary, fontSize: 14.5, fontWeight: '600' },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
    metaText: { fontSize: 12, color: colors.textFaint },
    privateBadge: {
      fontSize: 11, color: colors.warning, backgroundColor: colors.warningBg,
      paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
    },
    leftoverBadge: {
      alignSelf: 'flex-start', marginTop: 10, fontSize: 13, fontWeight: '600',
      paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
    },
    sourceLink: { marginTop: 10, fontSize: 13, color: colors.primary },
    sourceText: { marginTop: 10, fontSize: 13, color: colors.textMuted },
    sectionHeader: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8,
      color: colors.textFaint, marginTop: 20, marginBottom: 6,
    },
    card: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
    ingredientRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    ingredientText: { flex: 1, fontSize: 14.5, color: colors.text, lineHeight: 20 },
    optional: { color: colors.textMuted },
    stepRow: {
      flexDirection: 'row', gap: 10, paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    stepNumber: {
      width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22,
      fontSize: 12, fontWeight: '700', color: colors.primaryText, backgroundColor: colors.primary,
      overflow: 'hidden',
    },
    stepText: { flex: 1, fontSize: 14.5, color: colors.text, lineHeight: 21 },
    notesText: { fontSize: 14, color: colors.text, lineHeight: 20, paddingVertical: 10 },
    empty: { color: colors.textMuted, fontSize: 14, paddingVertical: 12 },
    byline: { marginTop: 24, fontSize: 12, color: colors.textFaint, textAlign: 'center' },
  });
}
