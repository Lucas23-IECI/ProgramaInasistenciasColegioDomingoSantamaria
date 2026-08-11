const EVENT_NAME = 'ldsm:chat-message';

let source = null;
let subscribers = 0;

const dispatch = (payload) => window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));

const ensureSource = () => {
  if (source || typeof window === 'undefined' || !('EventSource' in window)) return;
  source = new EventSource('/api/chat/eventos', { withCredentials: true });
  source.addEventListener('chat-message', (event) => {
    try { dispatch(JSON.parse(event.data)); } catch { /* se ignora un evento incompleto */ }
  });
  source.addEventListener('error', () => {
    if (source?.readyState === EventSource.CLOSED) source = null;
  });
};

export const subscribeToChatRealtime = (listener) => {
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

export const showChatNotification = async (payload) => {
  if (!payload?.notify || document.visibilityState === 'visible'
    || !('Notification' in window) || Notification.permission !== 'granted') return false;
  const options = {
    body: payload.conversation_title || 'Tienes un nuevo mensaje institucional.',
    icon: '/pwa/icon-192.png',
    badge: '/pwa/icon-192.png',
    tag: `ldsm-chat-${payload.conversation_id}`,
    data: { url: `/chat/${payload.conversation_id}` }
  };
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(payload.type === 'URGENTE' ? 'Mensaje institucional urgente' : 'Nuevo mensaje institucional', options);
  } else {
    new Notification(payload.type === 'URGENTE' ? 'Mensaje institucional urgente' : 'Nuevo mensaje institucional', options);
  }
  return true;
};
