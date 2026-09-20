import type { ShareIntent } from 'expo-share-intent';

/** What another app handed us via the Android share sheet, normalised into the three
 *  things the import screen understands. */
export interface SharedRecipeSource {
  mode: 'url' | 'photo' | 'text';
  url?: string;
  text?: string;
  photos?: { uri: string; name: string; type: string }[];
}

let pending: SharedRecipeSource | null = null;

/** Same single-use stash pattern as formState.ts — expo-router params are URL-based and
 *  can't carry picked image descriptors. */
export function setPendingShare(value: SharedRecipeSource | null): void {
  pending = value;
}

export function takePendingShare(): SharedRecipeSource | null {
  const value = pending;
  pending = null;
  return value;
}

/**
 * Work out what was actually shared.
 *
 * Sharing from Chrome gives a URL. Sharing from the Facebook app usually gives text
 * with a URL buried in it, and sometimes just text — which is the whole point, since
 * Facebook blocks server-side fetching. A URL we can fetch is preferred; otherwise the
 * text goes through as a paste, which works even when the link wouldn't.
 */
export function shareIntentToSource(intent: ShareIntent): SharedRecipeSource | null {
  const files = intent.files ?? [];
  const images = files.filter(f => (f.mimeType ?? '').startsWith('image/'));
  if (images.length > 0) {
    return {
      mode: 'photo',
      photos: images.slice(0, 5).map((f, i) => ({
        uri: f.path,
        name: f.fileName || `shared-${Date.now()}-${i}.jpg`,
        type: f.mimeType || 'image/jpeg',
      })),
    };
  }

  if (intent.webUrl) {
    return { mode: 'url', url: intent.webUrl };
  }

  const text = (intent.text ?? '').trim();
  if (!text) return null;

  // A bare shared link arrives as plain text from some apps.
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch && text.length <= urlMatch[0].length + 20) {
    return { mode: 'url', url: urlMatch[0] };
  }

  return { mode: 'text', text };
}
