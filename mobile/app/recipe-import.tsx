import { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, Image,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { importRecipe } from '../src/api/client';
import { useTheme, type Colors } from '../src/theme';
import { useKeyboardHeight } from '../src/useKeyboardHeight';
import { setPendingRecipeForm } from '../src/recipes/formState';

type Mode = 'url' | 'photo' | 'text';

interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
}

const MAX_PHOTOS = 5;

export default function RecipeImportScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const keyboardHeight = useKeyboardHeight();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  function toPicked(asset: ImagePicker.ImagePickerAsset): PickedPhoto {
    const name = asset.fileName || `recipe-${Date.now()}.jpg`;
    return { uri: asset.uri, name, type: asset.mimeType || 'image/jpeg' };
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos not allowed', 'FamilyHub needs access to your photos to read a recipe from one.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 1,
    });
    // Full-size is fine: the server downscales to 1568px before anything is sent on or
    // stored, so compressing twice would only cost legibility on handwriting.
    if (!result.canceled) {
      setPhotos(prev => [...prev, ...result.assets.map(toPicked)].slice(0, MAX_PHOTOS));
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera not allowed', 'FamilyHub needs the camera to photograph a recipe.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!result.canceled) {
      setPhotos(prev => [...prev, ...result.assets.map(toPicked)].slice(0, MAX_PHOTOS));
    }
  }

  async function handleImport() {
    if (mode === 'url' && !url.trim()) {
      Alert.alert('Paste a link first');
      return;
    }
    if (mode === 'photo' && photos.length === 0) {
      Alert.alert('Add at least one photo');
      return;
    }
    if (mode === 'text' && text.trim().length < 40) {
      Alert.alert('Paste the recipe', 'That looks too short — include the ingredients and method.');
      return;
    }

    setBusy(true);
    try {
      const draft = await importRecipe(mode, { url: url.trim(), text: text.trim(), photos });
      // Straight into the editor, pre-filled. Nothing has been saved yet.
      setPendingRecipeForm({ recipe: null, draft });
      router.replace('/recipe-form');
    } catch (err) {
      // The server's 422 message says what to do next (e.g. Facebook blocked the fetch),
      // so show it rather than a generic failure.
      Alert.alert('Could not import', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
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
          title: 'Import a recipe',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      />

      <View style={styles.tabs}>
        {(['url', 'photo', 'text'] as Mode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.tab, mode === m && styles.tabActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === 'url' ? 'Link' : m === 'photo' ? 'Photo' : 'Paste'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'url' && (
        <>
          <Text style={styles.label}>Recipe link</Text>
          <TextInput
            style={styles.input} value={url} onChangeText={setUrl}
            placeholder="https://…" placeholderTextColor={colors.placeholder}
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
          />
          <Text style={styles.hint}>
            Most recipe sites work. Facebook and Instagram block this — for those, copy the
            post's text into Paste, or screenshot it and use Photo.
          </Text>
        </>
      )}

      {mode === 'photo' && (
        <>
          <Text style={styles.label}>Photos</Text>
          <View style={styles.photoButtons}>
            <TouchableOpacity style={styles.photoButton} onPress={takePhoto} disabled={photos.length >= MAX_PHOTOS}>
              <Ionicons name="camera-outline" size={18} color={colors.primary} />
              <Text style={styles.photoButtonText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoButton} onPress={pickFromLibrary} disabled={photos.length >= MAX_PHOTOS}>
              <Ionicons name="images-outline" size={18} color={colors.primary} />
              <Text style={styles.photoButtonText}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {photos.length > 0 && (
            <View style={styles.thumbs}>
              {photos.map((photo, index) => (
                <View key={`${photo.uri}-${index}`} style={styles.thumbWrap}>
                  <Image source={{ uri: photo.uri }} style={styles.thumb} />
                  <TouchableOpacity
                    style={styles.thumbRemove}
                    onPress={() => setPhotos(prev => prev.filter((_, i) => i !== index))}
                  >
                    <Ionicons name="close" size={13} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.hint}>
            A cookbook page, a recipe card, or a handwritten note. Up to {MAX_PHOTOS} —
            use several if it runs over a page. They're kept with the recipe.
          </Text>
        </>
      )}

      {mode === 'text' && (
        <>
          <Text style={styles.label}>Recipe text</Text>
          <TextInput
            style={[styles.input, styles.textArea]} value={text} onChangeText={setText}
            multiline textAlignVertical="top"
            placeholder="Paste the whole recipe — ingredients, method, and any surrounding waffle. We'll sort it out."
            placeholderTextColor={colors.placeholder}
          />
        </>
      )}

      <TouchableOpacity style={[styles.primaryButton, busy && styles.primaryButtonBusy]} onPress={handleImport} disabled={busy}>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.primaryText} size="small" />
            <Text style={styles.primaryButtonText}>Reading the recipe…</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>Import recipe</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.note}>
        Nothing is saved yet — you'll get a chance to check and fix everything first.
      </Text>
    </ScrollView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 14 },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    tab: { flex: 1, backgroundColor: colors.chip, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
    tabActive: { backgroundColor: colors.primary },
    tabText: { fontSize: 14, fontWeight: '600', color: colors.chipText },
    tabTextActive: { color: colors.primaryText },
    label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 5 },
    input: {
      backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text,
    },
    textArea: { minHeight: 220, lineHeight: 21 },
    hint: { fontSize: 12, color: colors.textFaint, marginTop: 8, lineHeight: 17 },
    photoButtons: { flexDirection: 'row', gap: 10 },
    photoButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 8, paddingVertical: 14,
    },
    photoButtonText: { fontSize: 14, fontWeight: '600', color: colors.primary },
    thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 76, height: 76, borderRadius: 6, backgroundColor: colors.surfaceAlt },
    thumbRemove: {
      position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
      backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    },
    primaryButton: {
      backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14,
      alignItems: 'center', marginTop: 24,
    },
    primaryButtonBusy: { opacity: 0.85 },
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    primaryButtonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    note: { marginTop: 14, fontSize: 12, color: colors.textFaint, textAlign: 'center', lineHeight: 17 },
  });
}
