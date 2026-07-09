import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken, getServerUrl, getGroceryLists, getGroceryItems, getEvents } from './api/client';

const TASK_NAME = 'familyhub-poll';

const KEYS = {
  LAST_EVENT_ID: 'poll_last_event_id',
  LAST_GROCERY_IDS: 'poll_last_grocery_ids',
  NOTIF_EVENTS: 'pref_notif_events',
  NOTIF_GROCERY: 'pref_notif_grocery',
};

// Must be defined at module top-level, not inside a component
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const token = await getToken();
    if (!token) return BackgroundFetch.BackgroundFetchResult.NoData;

    const [notifEvents, notifGrocery] = await Promise.all([
      AsyncStorage.getItem(KEYS.NOTIF_EVENTS),
      AsyncStorage.getItem(KEYS.NOTIF_GROCERY),
    ]);

    const tasks: Promise<void>[] = [];
    if (notifEvents === 'true') tasks.push(checkNewEvents());
    if (notifGrocery === 'true') tasks.push(checkNewGroceryItems());
    await Promise.all(tasks);

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function checkNewEvents(): Promise<void> {
  const events = await getEvents();
  if (!events.length) return;

  const latestId = Math.max(...events.map(e => e.id));
  const lastSeenStr = await AsyncStorage.getItem(KEYS.LAST_EVENT_ID);
  const lastSeen = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;

  if (lastSeen === 0) {
    await AsyncStorage.setItem(KEYS.LAST_EVENT_ID, String(latestId));
    return;
  }

  const newEvents = events.filter(e => e.id > lastSeen);
  if (newEvents.length > 0) {
    await AsyncStorage.setItem(KEYS.LAST_EVENT_ID, String(latestId));
    const title = newEvents.length === 1
      ? `New event: ${newEvents[0].title}`
      : `${newEvents.length} new events added`;
    await Notifications.scheduleNotificationAsync({
      content: { title, body: 'Tap to view in FamilyHub' },
      trigger: null,
    });
  }
}

async function checkNewGroceryItems(): Promise<void> {
  const lists = await getGroceryLists();
  const lastSeenStr = await AsyncStorage.getItem(KEYS.LAST_GROCERY_IDS);
  const lastSeen: Record<number, number> = lastSeenStr ? JSON.parse(lastSeenStr) : {};

  let newCount = 0;
  const names: string[] = [];
  const updated = { ...lastSeen };

  for (const list of lists) {
    const items = await getGroceryItems(list.id);
    if (!items.length) continue;

    const latestId = Math.max(...items.map(i => i.id));
    const prevId = lastSeen[list.id] ?? 0;

    if (prevId === 0) {
      updated[list.id] = latestId;
      continue;
    }

    const newItems = items.filter(i => i.id > prevId);
    newCount += newItems.length;
    names.push(...newItems.map(i => i.name));
    updated[list.id] = latestId;
  }

  await AsyncStorage.setItem(KEYS.LAST_GROCERY_IDS, JSON.stringify(updated));

  if (newCount > 0) {
    const title = newCount === 1
      ? `Added to grocery list: ${names[0]}`
      : `${newCount} items added to grocery list`;
    await Notifications.scheduleNotificationAsync({
      content: { title, body: 'Tap to view in FamilyHub' },
      trigger: null,
    });
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function registerBackgroundTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) return;

  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}

async function unregisterBackgroundTask(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) {
    await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
  }
}

export async function getNotifPrefs(): Promise<{ events: boolean; grocery: boolean }> {
  const [events, grocery] = await Promise.all([
    AsyncStorage.getItem(KEYS.NOTIF_EVENTS),
    AsyncStorage.getItem(KEYS.NOTIF_GROCERY),
  ]);
  return { events: events === 'true', grocery: grocery === 'true' };
}

export async function setNotifPref(key: 'events' | 'grocery', value: boolean): Promise<void> {
  const storageKey = key === 'events' ? KEYS.NOTIF_EVENTS : KEYS.NOTIF_GROCERY;
  await AsyncStorage.setItem(storageKey, String(value));

  const prefs = await getNotifPrefs();
  if (prefs.events || prefs.grocery) {
    await registerBackgroundTask();
  } else {
    await unregisterBackgroundTask();
  }
}
