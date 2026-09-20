import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { getRecipe } from '../src/api/client';
import type { Recipe } from '../src/api/types';
import { useTheme, type Colors } from '../src/theme';

// Must match SCALE_OPTIONS in app/models.py — the server precomputes an amount string
// for each of these, so the fraction rules live in one place rather than being
// reimplemented here.
const SCALES = ['0.5', '1.0', '1.5', '2.0', '3.0'] as const;

export default function RecipeCookScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Keeps the screen on for as long as this screen is mounted. Unlike the web's wake
  // lock this needs no permission and no re-acquiring after backgrounding.
  useKeepAwake();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<string>('1.0');
  const [current, setCurrent] = useState(0);
  // Not persisted: one cooking session. A stale checklist from last week would be worse
  // than an empty one.
  const [used, setUsed] = useState<Record<number, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        setRecipe(await getRecipe(Number(id)));
      } catch {
        Alert.alert('Error', 'Could not load this recipe');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: recipe?.title ?? 'Cooking',
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        headerRight: () => (
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        ),
      }}
    />
  );

  if (loading) {
    return <View style={styles.centered}>{header}<ActivityIndicator color={colors.primary} /></View>;
  }
  if (!recipe) {
    return <View style={styles.centered}>{header}<Text style={styles.empty}>Recipe not available.</Text></View>;
  }

  const steps = recipe.steps;
  const scaleLabel = (s: string) =>
    recipe.servings ? String(Math.round(recipe.servings * parseFloat(s))) : `${parseFloat(s)}×`;

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>Servings</Text>
        <View style={styles.scaleRow}>
          {SCALES.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.scaleChip, scale === s && styles.scaleChipActive]}
              onPress={() => setScale(s)}
            >
              <Text style={[styles.scaleText, scale === s && styles.scaleTextActive]}>{scaleLabel(s)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.headerRow}>
          <Text style={styles.sectionHeader}>Ingredients</Text>
          <TouchableOpacity onPress={() => setUsed({})}>
            <Text style={styles.resetLink}>Reset</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {recipe.ingredients.map(item => {
            const amount = item.scaled_amounts?.[scale];
            const isUsed = !!used[item.id];
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.ingredientRow}
                onPress={() => setUsed(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
              >
                <Ionicons
                  name={isUsed ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={isUsed ? colors.primary : colors.textFaint}
                />
                <Text style={[styles.ingredientText, isUsed && styles.ingredientUsed]}>
                  {/* No parseable amount ("salt to taste") — show the original wording. */}
                  {amount ? <Text style={styles.amount}>{amount} </Text> : null}
                  {amount ? item.name : item.raw_text}
                  {item.prep_note ? `, ${item.prep_note}` : ''}
                </Text>
                {item.optional && <Text style={styles.optionalTag}>optional</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
        {scale !== '1.0' && (
          <Text style={styles.hint}>
            Amounts scaled from the original. Cooking times usually don't scale the same way.
          </Text>
        )}

        <Text style={styles.sectionHeader}>Method</Text>
        {steps.length === 0 ? (
          <View style={styles.card}><Text style={styles.empty}>No steps listed.</Text></View>
        ) : (
          <>
            <View style={styles.stepCard}>
              <Text style={styles.stepCounter}>Step {current + 1} of {steps.length}</Text>
              <Text style={styles.stepText}>{steps[current].text}</Text>
            </View>
            <View style={styles.stepNav}>
              <TouchableOpacity
                style={[styles.navButton, current === 0 && styles.navButtonDisabled]}
                onPress={() => setCurrent(c => Math.max(0, c - 1))}
                disabled={current === 0}
              >
                <Ionicons name="arrow-back" size={18} color={current === 0 ? colors.textFaint : colors.primaryText} />
                <Text style={[styles.navText, current === 0 && styles.navTextDisabled]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navButton, current === steps.length - 1 && styles.navButtonDisabled]}
                onPress={() => setCurrent(c => Math.min(steps.length - 1, c + 1))}
                disabled={current === steps.length - 1}
              >
                <Text style={[styles.navText, current === steps.length - 1 && styles.navTextDisabled]}>Next</Text>
                <Ionicons name="arrow-forward" size={18} color={current === steps.length - 1 ? colors.textFaint : colors.primaryText} />
              </TouchableOpacity>
            </View>

            <View style={styles.allSteps}>
              {steps.map((step, index) => (
                <TouchableOpacity key={step.id} onPress={() => setCurrent(index)} style={styles.allStepRow}>
                  <Text style={[
                    styles.allStepText,
                    index === current && styles.allStepActive,
                    index < current && styles.allStepDone,
                  ]} numberOfLines={2}>
                    {index + 1}. {step.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    content: { padding: 14, paddingBottom: 48 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionHeader: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8,
      color: colors.textFaint, marginTop: 18, marginBottom: 8,
    },
    resetLink: { fontSize: 12, color: colors.primary, marginTop: 18 },
    scaleRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
    scaleChip: {
      backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9,
      minWidth: 54, alignItems: 'center',
    },
    scaleChipActive: { backgroundColor: colors.primary },
    scaleText: { fontSize: 15, color: colors.chipText, fontWeight: '600' },
    scaleTextActive: { color: colors.primaryText },
    card: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12 },
    ingredientRow: {
      flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    ingredientText: { flex: 1, fontSize: 16, color: colors.text, lineHeight: 22 },
    ingredientUsed: { color: colors.textFaint, textDecorationLine: 'line-through' },
    amount: { fontWeight: '700' },
    optionalTag: { fontSize: 10.5, color: colors.textFaint },
    hint: { fontSize: 12, color: colors.textFaint, marginTop: 9, lineHeight: 17 },
    stepCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 18 },
    stepCounter: { fontSize: 11.5, color: colors.textFaint, marginBottom: 8 },
    stepText: { fontSize: 19, lineHeight: 28, color: colors.text },
    stepNav: { flexDirection: 'row', gap: 10, marginTop: 12 },
    navButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 15,
    },
    navButtonDisabled: { backgroundColor: colors.surfaceAlt },
    navText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    navTextDisabled: { color: colors.textFaint },
    allSteps: { marginTop: 18 },
    allStepRow: { paddingVertical: 7 },
    allStepText: { fontSize: 13.5, color: colors.textMuted, lineHeight: 19 },
    allStepActive: { color: colors.text, fontWeight: '600' },
    allStepDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
    empty: { color: colors.textMuted, fontSize: 15, padding: 16, textAlign: 'center' },
  });
}
