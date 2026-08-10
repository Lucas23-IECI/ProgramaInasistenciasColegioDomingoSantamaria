const DB_NAME = 'ldsm-operacion-segura';
const DB_VERSION = 1;
const ROSTER = 'roster';
const QUEUE = 'punctualityQueue';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(ROSTER)) db.createObjectStore(ROSTER, { keyPath: 'id_alumno' });
    if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'offline_operation_id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transaction = async (store, mode, action) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

export const saveOfflineRoster = async (students) => transaction(ROSTER, 'readwrite', (store) => {
  store.clear();
  students.forEach((student) => store.put(student));
});

const getAll = async (storeName) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
};

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
export const findOfflineStudent = async (value) => {
  const sought = normalize(value);
  const students = await getAll(ROSTER);
  return students.filter((student) => student.search_tokens?.some((token) => normalize(token).includes(sought)));
};
export const queueOfflineRegistration = async (payload) => transaction(QUEUE, 'readwrite', (store) => store.put(payload));
export const countOfflineRegistrations = async () => (await getAll(QUEUE)).length;
export const flushOfflineRegistrations = async (sender) => {
  const queued = (await getAll(QUEUE)).sort((a, b) => a.capturado_en.localeCompare(b.capturado_en));
  let synced = 0;
  for (const item of queued) {
    try {
      await sender(item);
      await transaction(QUEUE, 'readwrite', (store) => store.delete(item.offline_operation_id));
      synced += 1;
    } catch (error) {
      if (error?.response?.status === 409) {
        await transaction(QUEUE, 'readwrite', (store) => store.delete(item.offline_operation_id));
        synced += 1;
        continue;
      }
      break;
    }
  }
  return { synced, pending: await countOfflineRegistrations() };
};
