import * as SecureStore from 'expo-secure-store';
import type {
  User, CalendarEvent, GroceryList, GroceryCategory, GroceryItem,
  TodoList, TodoItem, Freezer, FreezerItem,
} from './types';

const DEFAULT_SERVER_URL = 'https://your-server.example.com';

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

export const getEvents = () =>
  request<CalendarEvent[]>('/api/events');

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
  datePurchased?: string, expirationDate?: string,
) => request<FreezerItem>(`/api/freezer/freezers/${freezerId}/items`, {
  method: 'POST',
  body: JSON.stringify({
    name, quantity: quantity || null,
    quantity_unit: quantityUnit || null,
    date_purchased: datePurchased || null,
    expiration_date: expirationDate || null,
  }),
});

export const updateFreezerItem = (
  itemId: number, name: string, quantity?: string, quantityUnit?: string | null,
  datePurchased?: string, expirationDate?: string,
) => request<FreezerItem>(`/api/freezer/items/${itemId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    name, quantity: quantity || null,
    quantity_unit: quantityUnit || null,
    date_purchased: datePurchased || null,
    expiration_date: expirationDate || null,
  }),
});

export const deleteFreezerItem = (itemId: number) =>
  request<{ ok: boolean }>(`/api/freezer/items/${itemId}`, { method: 'DELETE' });
