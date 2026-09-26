import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';
import type {
  User, CalendarEvent, GroceryList, GroceryCategory, GroceryItem,
  TodoList, TodoItem, Freezer, FreezerItem,
  Recipe, RecipeSummary, RecipeInput, RecipeDraft, ToGroceryResult, ToGroceryRow,
  PantryItem, RecipeMatch, MealPlanEntry, Ingredient,
} from './types';

const DEFAULT_SERVER_URL = '';

export async function getServerUrl(): Promise<string> {
  return (await SecureStore.getItemAsync('server_url')) ?? DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync('server_url', url.replace(/\/$/, ''));
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('auth_token');
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

/** Reads the user id out of the JWT's `sub` claim (set by app/security.py) without a network call. */
export async function getCurrentUserId(): Promise<number | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1]));
    const id = parseInt(payload.sub, 10);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(username: string, password: string): Promise<void> {
  await SecureStore.setItemAsync('saved_credentials', JSON.stringify({ username, password }));
}

export async function getSavedCredentials(): Promise<{ username: string; password: string } | null> {
  const raw = await SecureStore.getItemAsync('saved_credentials');
  return raw ? JSON.parse(raw) : null;
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync('auth_token'),
    SecureStore.deleteItemAsync('saved_credentials'),
  ]);
}

async function request<T>(path: string, options: RequestInit = {}, _retry = false): Promise<T> {
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  if (!serverUrl) throw new Error('Server URL not configured');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${serverUrl}${path}`, { ...options, headers });

  if (res.status === 401 && !_retry) {
    const creds = await getSavedCredentials();
    if (creds) {
      try {
        const url = await getServerUrl();
        await login(url, creds.username, creds.password);
        return request<T>(path, options, true);
      } catch {
        await SecureStore.deleteItemAsync('auth_token');
      }
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return {} as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(serverUrl: string, username: string, password: string): Promise<void> {
  await setServerUrl(serverUrl);
  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const data = await res.json();
  await SecureStore.setItemAsync('auth_token', data.access_token);
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export const getEvents = (range?: { start: string; end: string }) =>
  request<CalendarEvent[]>(
    range
      ? `/api/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
      : '/api/events',
  );

export type RecurrenceOption = 'none' | 'weekly' | 'monthly';
export type EventScope = 'this' | 'series';

export const createEvent = (data: {
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  timezone: string;
  conflict?: boolean;
  attendee_ids?: number[];
  recurrence?: RecurrenceOption;
  recurrence_until?: string | null;
}) => request<CalendarEvent>('/api/events', { method: 'POST', body: JSON.stringify(data) });

export const updateEvent = (id: number, data: {
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  timezone: string;
  conflict?: boolean;
  attendee_ids?: number[];
  recurrence_until?: string | null;
}, scope: EventScope = 'this') => request<CalendarEvent>(
  `/api/events/${id}?scope=${scope}`, { method: 'PUT', body: JSON.stringify(data) },
);

export const deleteEvent = (id: number, scope: EventScope = 'this') =>
  request<{ ok: boolean }>(`/api/events/${id}?scope=${scope}`, { method: 'DELETE' });

// ── Users ─────────────────────────────────────────────────────────────────────

export const getUsers = () =>
  request<User[]>('/api/users');

export const updateUserColor = (id: number, colorHex: string) =>
  request<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ color_hex: colorHex }) });

// ── Grocery ───────────────────────────────────────────────────────────────────

export const getGroceryLists = () =>
  request<GroceryList[]>('/api/grocery/lists');

export const getGroceryCategories = (listId: number) =>
  request<GroceryCategory[]>(`/api/grocery/lists/${listId}/categories`);

export const getGroceryItems = (listId: number) =>
  request<GroceryItem[]>(`/api/grocery/lists/${listId}/items`);

export const addGroceryItem = (
  listId: number, name: string, categoryId: number, quantity?: string,
) => request<GroceryItem>(`/api/grocery/lists/${listId}/items`, {
  method: 'POST',
  body: JSON.stringify({ name, category_id: categoryId, quantity }),
});

export const toggleGroceryItem = (itemId: number) =>
  request<GroceryItem>(`/api/grocery/items/${itemId}/toggle`, { method: 'POST' });

export const deleteGroceryItem = (itemId: number) =>
  request<{ ok: boolean }>(`/api/grocery/items/${itemId}`, { method: 'DELETE' });

// ── Todo ──────────────────────────────────────────────────────────────────────

export const getTodoLists = () =>
  request<TodoList[]>('/api/todo/lists');

export const getTodoItems = (listId: number) =>
  request<TodoItem[]>(`/api/todo/lists/${listId}/items`);

export const addTodoItem = (listId: number, text: string) =>
  request<TodoItem>(`/api/todo/lists/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

export const toggleTodoItem = (itemId: number) =>
  request<TodoItem>(`/api/todo/items/${itemId}/toggle`, { method: 'POST' });

export const deleteTodoItem = (itemId: number) =>
  request<{ ok: boolean }>(`/api/todo/items/${itemId}`, { method: 'DELETE' });

// ── Freezer ───────────────────────────────────────────────────────────────────

export const getFreezers = () =>
  request<Freezer[]>('/api/freezer/freezers');

export const getFreezerItems = (freezerId: number) =>
  request<FreezerItem[]>(`/api/freezer/freezers/${freezerId}/items`);

export const addFreezerItem = (
  freezerId: number, name: string, quantity?: string, quantityUnit?: string | null,
  datePurchased?: string, expirationDate?: string, count: number = 1,
) => request<FreezerItem>(`/api/freezer/freezers/${freezerId}/items`, {
  method: 'POST',
  body: JSON.stringify({
    name, quantity: quantity || null,
    quantity_unit: quantityUnit || null,
    count,
    date_purchased: datePurchased || null,
    expiration_date: expirationDate || null,
  }),
});

export const updateFreezerItem = (
  itemId: number, name: string, quantity?: string, quantityUnit?: string | null,
  datePurchased?: string, expirationDate?: string, count: number = 1,
) => request<FreezerItem>(`/api/freezer/items/${itemId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    name, quantity: quantity || null,
    quantity_unit: quantityUnit || null,
    count,
    date_purchased: datePurchased || null,
    expiration_date: expirationDate || null,
  }),
});

export const deleteFreezerItem = (itemId: number) =>
  request<{ ok: boolean }>(`/api/freezer/items/${itemId}`, { method: 'DELETE' });

export const incrementFreezerItem = (itemId: number) =>
  request<FreezerItem>(`/api/freezer/items/${itemId}/increment`, { method: 'POST' });

export const decrementFreezerItem = (itemId: number) =>
  request<{ ok: boolean; deleted?: boolean } & Partial<FreezerItem>>(`/api/freezer/items/${itemId}/decrement`, { method: 'POST' });

// ── Recipes ───────────────────────────────────────────────────────────────────

export const getRecipes = (q?: string) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const query = params.toString();
  return request<RecipeSummary[]>(`/api/recipes${query ? `?${query}` : ''}`);
};

export const getRecipe = (id: number) =>
  request<Recipe>(`/api/recipes/${id}`);

export const createRecipe = (data: RecipeInput) =>
  request<Recipe>('/api/recipes', { method: 'POST', body: JSON.stringify(data) });

export const updateRecipe = (id: number, data: RecipeInput) =>
  request<Recipe>(`/api/recipes/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteRecipe = (id: number) =>
  request<Record<string, never>>(`/api/recipes/${id}`, { method: 'DELETE' });

/**
 * Multipart sibling of `request<T>()`.
 *
 * `request` hardcodes `Content-Type: application/json`, and multipart bodies must let
 * fetch set the header itself so it can include the boundary — spreading `undefined`
 * over the existing header block would send a literal "undefined" instead. Same silent
 * re-login on 401 as `request`, since an import can easily be the first call after a
 * token expires.
 */
async function requestMultipart<T>(path: string, body: FormData, _retry = false): Promise<T> {
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  if (!serverUrl) throw new Error('Server URL not configured');

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${serverUrl}${path}`, { method: 'POST', headers, body });

  if (res.status === 401 && !_retry) {
    const creds = await getSavedCredentials();
    if (creds) {
      try {
        await login(await getServerUrl(), creds.username, creds.password);
        return requestMultipart<T>(path, body, true);
      } catch {
        await SecureStore.deleteItemAsync('auth_token');
      }
    }
  }

  if (!res.ok) {
    // The server returns 422 with a human-readable reason for an unusable source
    // ("that site wouldn't let us read the page..."), which is worth surfacing verbatim
    // rather than replacing with a generic failure message.
    let detail = '';
    try {
      const parsed = await res.json();
      detail = typeof parsed?.detail === 'string' ? parsed.detail : '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `Import failed (${res.status})`);
  }
  return res.json();
}

/** Extract a recipe from a link, photos, or pasted text. Returns a draft to review —
 *  nothing is saved until the draft is POSTed back via createRecipe(). */
export async function importRecipe(
  mode: 'url' | 'photo' | 'text',
  payload: { url?: string; text?: string; photos?: { uri: string; name: string; type: string }[] },
): Promise<RecipeDraft> {
  const form = new FormData();
  form.append('mode', mode);
  form.append('url', payload.url ?? '');
  form.append('text', payload.text ?? '');
  for (const photo of payload.photos ?? []) {
    // Expo replaces the global fetch with expo/fetch, which rejects RN's {uri, name, type}
    // file parts ("Unsupported FormDataPart implementation"). It does accept any part with
    // a bytes() method, so read the file through expo-file-system instead.
    const part = { name: photo.name, type: photo.type, bytes: () => new File(photo.uri).bytes() };
    form.append('photos', part as unknown as Blob);
  }
  return requestMultipart<RecipeDraft>('/api/recipes/import', form);
}

/** Push selected ingredients from a recipe onto a grocery list. Ingredients already on
 *  the list have their amounts combined server-side rather than duplicated. */
export const getToGroceryPreview = (recipeId: number) =>
  request<ToGroceryRow[]>(`/api/recipes/${recipeId}/to-grocery/preview`);

/** "Yes, same thing": fold an auto-created ingredient into a known one for good. */
export const mergeIngredient = (ingredientId: number, intoId: number) =>
  request<Ingredient>(`/api/ingredients/${ingredientId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ into_id: intoId }),
  });

/** "No, it's different": stop suggesting a match for it. */
export const keepIngredientSeparate = (ingredientId: number) =>
  request<Ingredient>(`/api/ingredients/${ingredientId}/keep`, { method: 'POST' });

export const recipeToGrocery = (
  recipeId: number, listId: number, ingredientIds: number[], scale = 1,
) => request<ToGroceryResult>(`/api/recipes/${recipeId}/to-grocery`, {
  method: 'POST',
  body: JSON.stringify({ list_id: listId, ingredient_ids: ingredientIds, scale }),
});

// ── Pantry & matching ─────────────────────────────────────────────────────────

export const getPantryItems = () =>
  request<PantryItem[]>('/api/pantry/items');

export const getKnownIngredients = (q?: string) =>
  request<string[]>(`/api/pantry/known${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const addPantryItem = (name: string, location: 'pantry' | 'fridge', quantity?: string) =>
  request<PantryItem>('/api/pantry/items', {
    method: 'POST',
    body: JSON.stringify({ name, location, quantity: quantity || null }),
  });

export const updatePantryItem = (
  id: number, data: { quantity?: string | null; low?: boolean; location?: 'pantry' | 'fridge' },
) => request<PantryItem>(`/api/pantry/items/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deletePantryItem = (id: number) =>
  request<Record<string, never>>(`/api/pantry/items/${id}`, { method: 'DELETE' });

/** Recipes ranked by how close they are to cookable, given pantry + freezer + staples. */
export const getCookNow = (maxMissing?: number) =>
  request<RecipeMatch[]>(`/api/recipes/cook-now${maxMissing != null ? `?max_missing=${maxMissing}` : ''}`);

// ── Meal plan ─────────────────────────────────────────────────────────────────

/** The week containing `start` (any date in it); defaults to the current week. */
export const getMealPlan = (start?: string) =>
  request<MealPlanEntry[]>(`/api/recipes/plan${start ? `?start=${start}` : ''}`);

export const addMealPlanEntry = (
  recipeId: number, date: string, mealSlot: 'breakfast' | 'lunch' | 'dinner',
) => request<MealPlanEntry>('/api/recipes/plan', {
  method: 'POST',
  body: JSON.stringify({ recipe_id: recipeId, date, meal_slot: mealSlot }),
});

/** Removes the planned meal and the calendar event it created. */
export const deleteMealPlanEntry = (id: number) =>
  request<Record<string, never>>(`/api/recipes/plan/${id}`, { method: 'DELETE' });
