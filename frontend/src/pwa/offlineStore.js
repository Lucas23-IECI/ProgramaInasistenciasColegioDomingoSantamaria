import { isDuplicateRegistrationError } from '../utils/punctualityRegistration';
import { getApiErrorMessage } from '../utils/apiError';

const DB_NAME = 'ldsm-operacion-segura';
const DB_VERSION = 2;
const ROSTER = 'roster';
const QUEUE = 'punctualityQueue';
const HISTORY = 'punctualitySyncHistory';
const QUEUE_EVENT = 'ldsm:offline-queue-changed';
const HISTORY_LIMIT = 25;

const emitQueueChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
};

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(ROSTER)) db.createObjectStore(ROSTER, { keyPath: 'id_alumno' });
    if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'offline_operation_id' });
    if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: 'offline_operation_id' });
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
export const queueOfflineRegistration = async (payload) => {
  await transaction(QUEUE, 'readwrite', (store) => store.put({
    ...payload,
    sync_status: 'PENDIENTE',
    intentos: Number(payload.intentos || 0),
    ultimo_error_publico: null,
    ultimo_intento_en: null
  }));
  emitQueueChanged();
};
export const countOfflineRegistrations = async () => (await getAll(QUEUE)).length;

const keepRecentHistory = async () => {
  const history = (await getAll(HISTORY)).sort((a, b) => String(b.finalizado_en).localeCompare(String(a.finalizado_en)));
  for (const item of history.slice(HISTORY_LIMIT)) {
    await transaction(HISTORY, 'readwrite', (store) => store.delete(item.offline_operation_id));
  }
};

const saveSyncedHistory = async (item, duplicate = false) => {
  await transaction(HISTORY, 'readwrite', (store) => store.put({
    offline_operation_id: item.offline_operation_id,
    id_alumno: item.id_alumno,
    capturado_en: item.capturado_en,
    finalizado_en: new Date().toISOString(),
    intentos: Number(item.intentos || 0),
    sync_status: 'SINCRONIZADO',
    resultado: duplicate ? 'El servidor ya tenía este ingreso y lo confirmó sin duplicarlo.' : 'Ingreso confirmado por el servidor.'
  }));
  await keepRecentHistory();
};

const publicSyncFailure = (error) => {
  const status = Number(error?.response?.status || 0);
  if (!status) return { transient: true, message: 'Sin conexión con el servidor. El ingreso sigue protegido en este dispositivo.' };
  if (status >= 500) return { transient: true, message: 'El servidor no está disponible. El ingreso sigue pendiente y se intentará nuevamente.' };
  return { transient: false, message: getApiErrorMessage(error, 'El servidor rechazó este ingreso. Revísalo antes de reintentar.') };
};

const decorateItems = (items, students) => {
  const roster = new Map(students.map((student) => [String(student.id_alumno), student]));
  return items.map((item) => {
    const student = roster.get(String(item.id_alumno));
    return {
      ...item,
      persona: student ? [student.nombres, student.paterno, student.materno].filter(Boolean).join(' ') : 'Estudiante del padrón guardado',
      curso: student?.nombre_curso || 'Curso no disponible'
    };
  });
};

export const getOfflineQueueSnapshot = async () => {
  const [queue, history, students] = await Promise.all([getAll(QUEUE), getAll(HISTORY), getAll(ROSTER)]);
  const decoratedQueue = decorateItems(queue, students).sort((a, b) => String(a.capturado_en).localeCompare(String(b.capturado_en)));
  const decoratedHistory = decorateItems(history, students).sort((a, b) => String(b.finalizado_en).localeCompare(String(a.finalizado_en)));
  return {
    pending: decoratedQueue.filter((item) => item.sync_status !== 'FALLIDO'),
    failed: decoratedQueue.filter((item) => item.sync_status === 'FALLIDO'),
    synced: decoratedHistory
  };
};

export const subscribeOfflineQueue = (listener) => {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener(QUEUE_EVENT, handler);
  return () => window.removeEventListener(QUEUE_EVENT, handler);
};

export const flushOfflineRegistrations = async (sender, { operationId = '', includeFailed = false } = {}) => {
  const queued = (await getAll(QUEUE))
    .filter((item) => (!operationId || item.offline_operation_id === operationId) && (includeFailed || item.sync_status !== 'FALLIDO'))
    .sort((a, b) => a.capturado_en.localeCompare(b.capturado_en));
  let synced = 0;
  let failed = 0;
  let networkUnavailable = false;
  for (const item of queued) {
    const attempting = {
      ...item,
      sync_status: 'SINCRONIZANDO',
      intentos: Number(item.intentos || 0) + 1,
      ultimo_intento_en: new Date().toISOString(),
      ultimo_error_publico: null
    };
    await transaction(QUEUE, 'readwrite', (store) => store.put(attempting));
    emitQueueChanged();
    try {
      await sender(attempting);
      await transaction(QUEUE, 'readwrite', (store) => store.delete(item.offline_operation_id));
      await saveSyncedHistory(attempting);
      synced += 1;
    } catch (error) {
      if (isDuplicateRegistrationError(error)) {
        await transaction(QUEUE, 'readwrite', (store) => store.delete(item.offline_operation_id));
        await saveSyncedHistory(attempting, true);
        synced += 1;
        continue;
      }
      const failure = publicSyncFailure(error);
      await transaction(QUEUE, 'readwrite', (store) => store.put({
        ...attempting,
        sync_status: failure.transient ? 'PENDIENTE' : 'FALLIDO',
        ultimo_error_publico: failure.message
      }));
      if (failure.transient) {
        networkUnavailable = true;
        break;
      }
      failed += 1;
    }
  }
  emitQueueChanged();
  const snapshot = await getOfflineQueueSnapshot();
  return { synced, failed, pending: snapshot.pending.length, networkUnavailable };
};

export const retryOfflineRegistration = (operationId, sender) => flushOfflineRegistrations(sender, {
  operationId,
  includeFailed: true
});
