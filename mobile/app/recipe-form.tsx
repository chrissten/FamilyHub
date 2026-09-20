import { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, Switch,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { createRecipe, updateRecipe } from '../src/api/client';
import { useTheme, type Colors } from '../src/theme';
import { useKeyboardHeight } from '../src/useKeyboardHeight';
import { takePendingRecipeForm, recipeToText, draftToText, splitLines } from '../src/recipes/formState';

export default function RecipeFormScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight();
  const router = useRouter();

  // Taken once on mount — the stash is cleared on read, so a re-render can't lose it.
  const [pending] = useState(() => takePendingRecipeForm());
  const existing = pending?.recipe ?? null;
  // An imported draft fills the same form as a saved recipe, so correcting the model
  // uses exactly the controls you'd use writing one by hand.
  const draft = pending?.draft ?? null;
  const initialText = useMemo(
    () => (existing ? recipeToText(existing) : draftToText(draft)),
    [existing, draft],
  );

  const [title, setTitle] = useState(existing?.title ?? draft?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? draft?.description ?? '');
  const [servings, setServings] = useState(String(existing?.servings ?? draft?.servings ?? ''));
  const [prep, setPrep] = useState(String(existing?.prep_minutes ?? draft?.prep_minutes ?? ''));
  const [cook, setCook] = useState(String(existing?.cook_minutes ?? draft?.cook_minutes ?? ''));
  const [ingredients, setIngredients] = useState(initialText.ingredients);
  const [steps, setSteps] = useState(initialText.steps);
  const [tags, setTags] = useState((existing?.tag_names ?? draft?.tags ?? []).join(', '));
  const [sourceName, setSourceName] = useState(existing?.source_name ?? draft?.source_name ?? '');
  const [sourceUrl, setSourceUrl] = useState(existing?.source_url ?? draft?.source_url ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [isPublic, setIsPublic] = useState(existing?.is_public ?? true);
  const [saving, setSaving] = useState(false);

  function toInt(value: string): number | null {
    const parsed = parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the recipe a name.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        servings: toInt(servings),
        prep_minutes: toInt(prep),
        cook_minutes: toInt(cook),
        notes: notes.trim() || null,
        source_type: (draft
          ? (draft.scan_token ? 'photo' : draft.source_url ? 'url' : 'text')
          : sourceUrl.trim() ? 'url' : 'manual') as 'url' | 'manual' | 'photo' | 'text',
        source_url: sourceUrl.trim() || null,
        source_name: sourceName.trim() || null,
        image_url: draft?.image_url ?? null,
        // Claims any photos stashed server-side during import. Consumed on read, so a
        // double-tap on Save can't attach them twice.
        scan_token: draft?.scan_token ?? null,
        is_public: isPublic,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        // Sent as raw lines; the server parses quantity, unit and the canonical
        // ingredient out of each one (app/ingredients.py) so matching keeps working.
        ingredients: splitLines(ingredients).map(line => ({ raw_text: line, name: line })),
        steps: splitLines(steps),
      };
      if (existing) {
        await updateRecipe(existing.id, payload);
      } else {
        await createRecipe(payload);
      }
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save this recipe');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 40 + keyboardHeight }]}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: existing ? 'Edit recipe' : draft ? 'Check this recipe' : 'New recipe',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => (
            <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={8}>
              <Text style={styles.saveButton}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {!!draft && (
        <Text style={styles.reviewBanner}>
          Pulled this out of the source — have a read before saving. Fix anything that
          looks off; it's easier now than after it's on a shopping list.
        </Text>
      )}

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input} value={title} onChangeText={setTitle}
        placeholder="e.g. Weeknight chicken skillet"
        placeholderTextColor={colors.placeholder} autoFocus={!existing && !draft}
      />

      <Text style={styles.label}>Short description</Text>
      <TextInput
        style={styles.input} value={description ?? ''} onChangeText={setDescription}
        placeholder="One line — what is it?" placeholderTextColor={colors.placeholder}
      />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Serves</Text>
          <TextInput style={styles.input} value={servings} onChangeText={setServings}
            keyboardType="number-pad" placeholder="4" placeholderTextColor={colors.placeholder} />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Prep (min)</Text>
          <TextInput style={styles.input} value={prep} onChangeText={setPrep}
            keyboardType="number-pad" placeholder="10" placeholderTextColor={colors.placeholder} />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Cook (min)</Text>
          <TextInput style={styles.input} value={cook} onChangeText={setCook}
            keyboardType="number-pad" placeholder="25" placeholderTextColor={colors.placeholder} />
        </View>
      </View>

      <Text style={styles.label}>Ingredients <Text style={styles.hint}>one per line</Text></Text>
      <TextInput
        style={[styles.input, styles.textArea]} value={ingredients} onChangeText={setIngredients}
        multiline textAlignVertical="top"
        placeholder={'2 cups all-purpose flour\n1 tsp salt\n3 large eggs'}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>Method <Text style={styles.hint}>one step per line</Text></Text>
      <TextInput
        style={[styles.input, styles.textArea]} value={steps} onChangeText={setSteps}
        multiline textAlignVertical="top"
        placeholder={'Preheat the oven to 350F.\nWhisk the dry ingredients together.'}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>Tags <Text style={styles.hint}>comma separated</Text></Text>
      <TextInput
        style={styles.input} value={tags} onChangeText={setTags}
        placeholder="weeknight, instant pot" placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
      />

      <View style={styles.row}>
        <View style={styles.rowItemWide}>
          <Text style={styles.label}>Source name</Text>
          <TextInput style={styles.input} value={sourceName ?? ''} onChangeText={setSourceName}
            placeholder="Grandma's card" placeholderTextColor={colors.placeholder} />
        </View>
        <View style={styles.rowItemWide}>
          <Text style={styles.label}>Source link</Text>
          <TextInput style={styles.input} value={sourceUrl ?? ''} onChangeText={setSourceUrl}
            placeholder="https://…" placeholderTextColor={colors.placeholder}
            autoCapitalize="none" keyboardType="url" />
        </View>
      </View>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesArea]} value={notes ?? ''} onChangeText={setNotes}
        multiline textAlignVertical="top"
        placeholder="What you'd do differently next time"
        placeholderTextColor={colors.placeholder}
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Shared with the whole family</Text>
        <Switch
          value={isPublic} onValueChange={setIsPublic}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={handleSave} disabled={saving}>
        <Text style={styles.primaryButtonText}>
          {saving ? 'Saving…' : existing ? 'Save changes' : draft ? 'Save recipe' : 'Create recipe'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 14 },
    label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 14, marginBottom: 5 },
    reviewBanner: {
      backgroundColor: colors.primary + '18', borderLeftWidth: 3, borderLeftColor: colors.primary,
      borderRadius: 4, padding: 10, fontSize: 13, color: colors.text, lineHeight: 18,
    },
    hint: { fontWeight: '400', fontSize: 12, color: colors.textFaint },
    input: {
      backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.text,
    },
    textArea: { minHeight: 150, lineHeight: 21 },
    notesArea: { minHeight: 70, lineHeight: 20 },
    row: { flexDirection: 'row', gap: 10 },
    rowItem: { flex: 1 },
    rowItemWide: { flex: 1 },
    switchRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 20, backgroundColor: colors.surface, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    switchLabel: { fontSize: 14, color: colors.text },
    primaryButton: {
      backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 13,
      alignItems: 'center', marginTop: 22,
    },
    primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    saveButton: { color: '#fff', fontSize: 16, fontWeight: '600', paddingRight: 4 },
  });
}
