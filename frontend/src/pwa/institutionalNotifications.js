const EVENT_NAME = 'ldsm:institutional-notification';

let source = null;
let subscribers = 0;

const dispatch = (payload) => window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));

const ensureSource = () => {
  if (source || typeof window === 'undefined' || !('EventSource' in window)) return;
  source = new EventSource('/api/notificaciones/eventos', { withCredentials: true });
  source.addEventListener('institutional-notification', (event) => {
    try { dispatch(JSON.parse(event.data)); } catch { /* se ignora un evento incompleto */ }
  });
  source.addEventListener('error', () => {
    if (source?.readyState === EventSource.CLOSED) source = null;
  });
};

export const subscribeToInstitutionalNotifications = (listener) => {
  subscribers += 1;
  ensureSource();
  const handler = (event) => listener(event.detail || {});
  window.addEventListener(EVENT_NAME, handler);
  return () => {
    subscribers = Math.max(0, subscribers - 1);
    window.removeEventListener(EVENT_NAME, handler);
    if (subscribers === 0 && source) {
      source.close();
      source = null;
    }
  };
};

export const showInstitutionalNotification = async (payload) => {
  if (!payload?.notify || document.visibilityState === 'visible'
    || !('Notification' in window) || Notification.permission !== 'granted') return false;

  const options = {
    body: payload.detail || 'Tienes un nuevo aviso institucional.',
    icon: '/pwa/icon-192.png',
    badge: '/pwa/icon-192.png',
    tag: `ldsm-notification-${payload.notification_id}`,
    data: { url: payload.link || '/admin' }
  };
  const title = payload.priority === 'URGENTE'
    ? `Aviso urgente: ${payload.title}`
    : payload.title || 'Nuevo aviso institucional';

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, options);
  } else {
    new Notification(title, options);
  }
  return true;
};
