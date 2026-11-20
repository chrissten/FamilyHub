import { useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, StyleSheet, Alert, Linking, Share,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import {
  createRecipeShareLink, revokeRecipeShareLink, downloadRecipePdf, recipeShareUrl,
} from '../api/client';
import type { Recipe } from '../api/types';
import { useTheme, type Colors } from '../theme';
import { recipeMailto, recipeToText } from './shareText';

interface Props {
  visible: boolean;
  recipe: Recipe;
  isOwner: boolean;
  onClose: () => void;
  /** Called after the public link is created or revoked so the screen can refetch. */
  onLinkChanged: () => void;
}

export default function ShareSheet({ visible, recipe, isOwner, onClose, onLinkChanged }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (err) {
      Alert.alert('Error', `${failure}${err instanceof Error && err.message ? `\n${err.message}` : ''}`);
    } finally {
      setBusy(null);
    }
  }

  const link = async () => (recipe.share_token ? recipeShareUrl(recipe.share_token) : null);

  const email = () => run('email', async () => {
    const url = recipeMailto(recipe, await link());
    // No canOpenURL pre-check: on Android 11+ it reports false for mailto: unless the
    // manifest declares a <queries> entry, even with a mail app installed.
    try {
      await Linking.openURL(url);
    } catch {
      throw new Error('No email app is set up on this device.');
    }
    onClose();
  }, 'Could not open your email app.');

  const pdf = () => run('pdf', async () => {
    const uri = await downloadRecipePdf(recipe.id, recipe.title);
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    onClose();
    // The share sheet is where "email it" (as an attachment), "save to Drive" and "print"
    // all live, so one PDF action covers them rather than a button per destination.
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: recipe.title, UTI: 'com.adobe.pdf' });
  }, 'Could not create the PDF.');

  const text = () => run('text', async () => {
    const message = recipeToText(recipe, await link());
    onClose();
    await Share.share({ title: recipe.title, message });
  }, 'Could not share the recipe.');

  const create = () => run('create', async () => {
    await createRecipeShareLink(recipe.id);
    onLinkChanged();
  }, 'Could not create the link.');

  const shareLink = () => run('link', async () => {
    const url = await link();
    if (!url) return;
    onClose();
    await Share.share({ message: url });
  }, 'Could not share the link.');

  const revoke = () => {
    Alert.alert(
      'Turn off public link?',
      'Anyone who has the link will lose access to this recipe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => run('revoke', async () => {
            await revokeRecipeShareLink(recipe.id);
            onLinkChanged();
          }, 'Could not turn off the link.'),
        },
      ],
    );
  };

  const row = (
    id: string, icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void,
    hint?: string, danger?: boolean,
  ) => (
    <TouchableOpacity key={id} style={styles.row} onPress={onPress} disabled={!!busy}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {busy === id && <ActivityIndicator color={colors.primary} />}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Share recipe</Text>
        {row('email', 'mail-outline', 'Email', email, 'Recipe text in a new email')}
        {row('pdf', 'document-outline', 'Share as PDF', pdf, 'Attach, save or print from the share menu')}
        {row('text', 'chatbubble-outline', 'Share as text', text, 'Messages, notes and other apps')}

        <Text style={styles.sectionLabel}>Public link</Text>
        {recipe.share_token ? (
          <>
            <Text style={styles.note}>
              Anyone with the link can view this recipe without logging in. They cannot edit it.
            </Text>
            {row('link', 'link-outline', 'Share link', shareLink)}
            {isOwner && row('revoke', 'close-circle-outline', 'Turn off link', revoke, undefined, true)}
          </>
        ) : isOwner ? (
          <>
            <Text style={styles.note}>
              Create a read-only link anyone can open, no login needed. You can turn it off any time.
            </Text>
            {row('create', 'link-outline', 'Create public link', create)}
          </>
        ) : (
          <Text style={styles.note}>
            Only {recipe.owner.display_name} can create a public link for this recipe.
          </Text>
        )}
      </View>
    </Modal>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 15.5, color: colors.text },
    rowHint: { fontSize: 12, color: colors.textFaint, marginTop: 1 },
    sectionLabel: {
      fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8,
      color: colors.textFaint, marginTop: 14, marginBottom: 4,
    },
    note: { fontSize: 13, color: colors.textMuted, lineHeight: 18, marginBottom: 2 },
  });
}
