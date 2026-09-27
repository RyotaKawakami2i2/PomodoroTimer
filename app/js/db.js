const DB_NAME = 'pomodoro-app';
const DB_VERSION = 1;
const STORE_NAMES = ['settings', 'memos', 'tasks', 'playlist'];

export const DEFAULT_SETTINGS = { key: 'main', workMinutes: 25, breakMinutes: 5, autoSwitch: false };

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('memos')) {
        db.createObjectStore('memos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('tasks')) {
        db.createObjectStore('tasks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('playlist')) {
        db.createObjectStore('playlist', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqToPromise(tx.objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putMany(storeName, values) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  values.forEach((value) => store.put(value));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function remove(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clear(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getSettings() {
  const settings = await get('settings', 'main');
  return settings || DEFAULT_SETTINGS;
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial, key: 'main' };
  await put('settings', updated);
  return updated;
}

export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      await navigator.storage.persist();
    } catch (e) {
      // 対応していない/拒否された場合もアプリは動作を継続する
    }
  }
}

export async function exportAllData() {
  const [memos, tasks, playlist] = await Promise.all([
    getAll('memos'),
    getAll('tasks'),
    getAll('playlist'),
  ]);
  const settings = await getSettings();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      workMinutes: settings.workMinutes,
      breakMinutes: settings.breakMinutes,
      autoSwitch: !!settings.autoSwitch,
    },
    memos,
    tasks,
    playlist,
  };
}

export function validateBackupShape(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (!data.settings) return false;
  if (typeof data.settings.workMinutes !== 'number' || typeof data.settings.breakMinutes !== 'number') return false;
  if (!Array.isArray(data.memos) || !Array.isArray(data.tasks) || !Array.isArray(data.playlist)) return false;
  return true;
}

export async function importAllData(data) {
  await Promise.all(STORE_NAMES.map((name) => clear(name)));
  await put('settings', {
    key: 'main',
    workMinutes: data.settings.workMinutes,
    breakMinutes: data.settings.breakMinutes,
    autoSwitch: !!data.settings.autoSwitch,
  });
  if (data.memos.length) await putMany('memos', data.memos);
  if (data.tasks.length) await putMany('tasks', data.tasks);
  if (data.playlist.length) await putMany('playlist', data.playlist);
}
