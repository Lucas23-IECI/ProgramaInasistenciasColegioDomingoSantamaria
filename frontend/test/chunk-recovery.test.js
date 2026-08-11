import assert from 'node:assert/strict';
import test from 'node:test';
import { isRecoverableChunkError, recoverFromStaleChunk } from '../src/utils/chunkRecovery.js';

const createTarget = () => {
  const values = new Map();
  let reloads = 0;
  return {
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    location: { reload: () => { reloads += 1; } },
    reloadCount: () => reloads,
  };
};

const createTargetWithWaitingWorker = () => {
  const target = createTarget();
  let posted = null;
  let controllerListener = null;
  target.setTimeout = () => 1;
  target.navigator = {
    serviceWorker: {
      getRegistration: async () => ({
        waiting: { postMessage: (message) => { posted = message; } },
      }),
      addEventListener: (_name, listener) => { controllerListener = listener; },
    },
  };
  return {
    target,
    posted: () => posted,
    activate: () => controllerListener?.(),
  };
};

test('reconoce errores producidos por un modulo dinamico obsoleto', () => {
  assert.equal(isRecoverableChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/VisitsAdmin-old.js')), true);
  assert.equal(isRecoverableChunkError(new Error('Error de validacion')), false);
});
test('recarga una sola vez ante un modulo obsoleto', async () => {
  const target = createTarget();
  const error = new TypeError('Failed to fetch dynamically imported module: /assets/VisitsAdmin-old.js');

  assert.equal(recoverFromStaleChunk(error, target), true);
  await Promise.resolve();
  assert.equal(target.reloadCount(), 1);
  assert.equal(recoverFromStaleChunk(error, target), false);
  assert.equal(target.reloadCount(), 1);
});

test('activa primero el service worker pendiente antes de recargar', async () => {
  const waiting = createTargetWithWaitingWorker();
  const error = new TypeError('Failed to fetch dynamically imported module: /assets/VisitsAdmin-old.js');
  assert.equal(recoverFromStaleChunk(error, waiting.target), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(waiting.posted(), { type: 'SKIP_WAITING' });
  assert.equal(waiting.target.reloadCount(), 0);
  waiting.activate();
  assert.equal(waiting.target.reloadCount(), 1);
});

test('no recarga por errores funcionales de la aplicacion', () => {
  const target = createTarget();
  assert.equal(recoverFromStaleChunk(new Error('No fue posible guardar'), target), false);
  assert.equal(target.reloadCount(), 0);
});
