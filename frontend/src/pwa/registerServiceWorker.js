const EVENT_NAME = 'ldsm:pwa-state';
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

let deferredInstallPrompt = null;
let registrationPromise = null;
let refreshRequested = false;

const emitState = (detail) => window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));

export const isPwaStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

export const isIosDevice = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

export const getPwaCapabilitySnapshot = () => ({
  installPromptAvailable: Boolean(deferredInstallPrompt),
  installed: isPwaStandalone(),
  ios: isIosDevice(),
  secure: window.isSecureContext,
  supported: 'serviceWorker' in navigator,
});

const watchRegistration = (registration) => {
  if (registration.waiting) emitState({ updateAvailable: true, registration });

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        emitState({ updateAvailable: true, registration });
      }
    });
  });

  const checkForUpdate = () => registration.update().catch(() => undefined);
  const timer = window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
  window.addEventListener('online', checkForUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
};

export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return Promise.resolve(null);
  if (registrationPromise) return registrationPromise;

  const register = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((registration) => {
      watchRegistration(registration);
      emitState({ registration, ...getPwaCapabilitySnapshot() });
      return registration;
    })
    .catch((error) => {
      console.warn('[PWA] No fue posible registrar el service worker:', error.message);
      emitState({
        registrationError: 'No fue posible activar el uso sin conexión en este dispositivo. El sistema puede seguir utilizándose en línea.'
      });
      return null;
    });

  registrationPromise = document.readyState === 'complete'
    ? register()
    : new Promise((resolve) => window.addEventListener('load', () => resolve(register()), { once: true }));
  return registrationPromise;
};

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  emitState({ installPromptAvailable: true, installed: false });
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  emitState({ installPromptAvailable: false, installed: true, justInstalled: true });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    emitState({ updateAvailable: false, updateActivated: true });
    if (refreshRequested) window.location.reload();
  });
}

export const subscribeToPwaState = (listener) => {
  const handler = (event) => listener(event.detail || {});
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
};

export const promptPwaInstall = async () => {
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  const prompt = deferredInstallPrompt;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferredInstallPrompt = null;
  emitState({ installPromptAvailable: false, installOutcome: choice.outcome });
  return choice;
};

export const applyPwaUpdate = async () => {
  const registration = await (registrationPromise || navigator.serviceWorker?.getRegistration('/'));
  if (!registration?.waiting) return false;
  refreshRequested = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
};

export const requestPwaNotifications = async () => {
  if (!window.isSecureContext || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
};

export const notifyPwaSync = async (count) => {
  if (!count || !('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Registros sincronizados', {
    body: `${count} ${count === 1 ? 'ingreso pendiente fue confirmado' : 'ingresos pendientes fueron confirmados'} por el servidor.`,
    icon: '/pwa/icon-192.png',
    badge: '/pwa/icon-192.png',
    tag: 'ldsm-offline-sync'
  });
  return true;
};
