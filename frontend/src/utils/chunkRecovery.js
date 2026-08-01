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

export const recoverFromStaleChunk = (error, target = globalThis.window) => {
  if (!target || !isRecoverableChunkError(error)) return false;

  const storage = getRecoveryStorage(target);
  if (!storage) return false;

  const now = Date.now();
  const previousAttempt = Number(storage.getItem(RECOVERY_KEY) || 0);
  if (previousAttempt && now - previousAttempt < RECOVERY_WINDOW_MS) return false;

  storage.setItem(RECOVERY_KEY, String(now));
  target.location.reload();
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
