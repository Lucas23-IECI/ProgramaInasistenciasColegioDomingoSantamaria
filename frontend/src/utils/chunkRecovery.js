const RECOVERY_KEY = 'ldsm:chunk-recovery-attempt';
const RECOVERY_WINDOW_MS = 30_000;

export const isRecoverableChunkError = (error) => {
  const message = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(message);
};
const getRecoveryStorage = (target) => {
  try {
    return target?.sessionStorage || null;
  } catch {
    return null;
  }
};

const refreshWithCurrentWorker = async (target) => {
  try {
    const serviceWorker = target?.navigator?.serviceWorker;
    const registration = await serviceWorker?.getRegistration?.('/');
    if (!registration?.waiting) {
      target.location.reload();
      return;
    }

    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      target.location.reload();
    };
    serviceWorker.addEventListener?.('controllerchange', reload, { once: true });
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    target.setTimeout?.(reload, 1500);
  } catch {
    target.location.reload();
  }
};

export const recoverFromStaleChunk = (error, target = globalThis.window) => {
  if (!target || !isRecoverableChunkError(error)) return false;

  const storage = getRecoveryStorage(target);
  if (!storage) return false;

  const now = Date.now();
  const previousAttempt = Number(storage.getItem(RECOVERY_KEY) || 0);
  if (previousAttempt && now - previousAttempt < RECOVERY_WINDOW_MS) return false;

  storage.setItem(RECOVERY_KEY, String(now));
  void refreshWithCurrentWorker(target);
  return true;
};

export const installChunkRecovery = (target = globalThis.window) => {
  if (!target?.addEventListener) return () => {};

  const onPreloadError = (event) => {
    if (recoverFromStaleChunk(event.payload || event.error, target)) {
      event.preventDefault();
    }
  };

  target.addEventListener('vite:preloadError', onPreloadError);
  const timer = target.setTimeout(() => {
    const storage = getRecoveryStorage(target);
    storage?.removeItem(RECOVERY_KEY);
  }, RECOVERY_WINDOW_MS);

  return () => {
    target.removeEventListener('vite:preloadError', onPreloadError);
    target.clearTimeout(timer);
  };
};
