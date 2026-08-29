import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { BellRing } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useFeedback } from '../context/FeedbackContext';
import { PERMISSIONS, hasPermission } from '../permissions';
import { getApiErrorMessage } from '../utils/apiError';
import { requestPwaNotifications } from '../pwa/registerServiceWorker';
import {
  showInstitutionalNotification,
  subscribeToInstitutionalNotifications
} from '../pwa/institutionalNotifications';
import NotificationComposer from './NotificationComposer';
import NotificationHistoryDialog from './NotificationHistoryDialog';

const dateTime = (value) => new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'short',
  timeStyle: 'short'
}).format(new Date(value));

const moduleLabel = (value) => ({
  INSTITUCIONAL: 'Aviso institucional',
  SEGUIMIENTO: 'Seguimiento',
  OPERACION: 'Operación del sistema'
}[value] || 'Sistema');

const NotificationCenter = ({ user }) => {
  const { notify } = useFeedback();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const pageRef = useRef(1);
  const [open, setOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [realtimeNotice, setRealtimeNotice] = useState(null);
  const canSend = hasPermission(user, PERMISSIONS.NOTIFICATIONS_SEND);

  const refresh = useCallback(async (targetPage = pageRef.current, { quiet = false } = {}) => {
    try {
      const response = await axios.get('/api/notificaciones', { params: { pagina: targetPage, limite: 12 } });
      setNotifications(response.data.items || []);
      setUnread(Number(response.data.unread) || 0);
      setPages(Number(response.data.pagination?.pages) || 1);
      const responsePage = Number(response.data.pagination?.page) || targetPage;
      pageRef.current = responsePage;
      setPage(responsePage);
      setLoadError('');
    } catch (error) {
      if (!quiet) {
        const message = getApiErrorMessage(error, 'No fue posible cargar tus notificaciones.');
        setLoadError(message);
        notify(message, 'error');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    refresh(1);
    const unsubscribe = subscribeToInstitutionalNotifications((event) => {
      if (!active) return;
      setRealtimeNotice(event);
      refresh(pageRef.current, { quiet: true });
      showInstitutionalNotification(event).catch(() => {});
    });
    const timer = setInterval(() => refresh(pageRef.current, { quiet: true }), 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh(pageRef.current, { quiet: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refresh]);

  useEffect(() => {
    if (!realtimeNotice) return undefined;
    const timer = setTimeout(() => setRealtimeNotice(null), realtimeNotice.priority === 'URGENTE' ? 20_000 : 12_000);
    return () => clearTimeout(timer);
  }, [realtimeNotice]);

  useEffect(() => {
    if (!canSend) return undefined;
    const openHistory = () => {
      setOpen(false);
      setHistoryOpen(true);
    };
    window.addEventListener('open-notification-history', openHistory);
    return () => window.removeEventListener('open-notification-history', openHistory);
  }, [canSend]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const openNotification = async (notification) => {
    if (notification.id_notificacion && !notification.leida_en) {
      try {
        await axios.patch(`/api/notificaciones/${notification.id_notificacion}/leer`);
        setNotifications((current) => current.map((item) => item.id_notificacion === notification.id_notificacion
          ? { ...item, leida_en: new Date().toISOString() }
          : item));
        setUnread((current) => Math.max(0, current - 1));
      } catch (error) {
        notify(getApiErrorMessage(error, 'No fue posible actualizar la notificación.'), 'error');
      }
    }
    setOpen(false);
    if (notification.enlace) navigate(notification.enlace);
  };

  const openRealtimeNotification = async () => {
    if (!realtimeNotice) return;
    await openNotification({
      id_notificacion: realtimeNotice.notification_id,
      enlace: realtimeNotice.link,
      leida_en: null
    });
    setRealtimeNotice(null);
  };

  const markAllRead = async () => {
    try {
      await axios.post('/api/notificaciones/leer-todas');
      setNotifications((current) => current.map((item) => ({ ...item, leida_en: item.leida_en || new Date().toISOString() })));
      setUnread(0);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible marcar los avisos como leídos.'), 'error');
    }
  };

  const enableBrowserAlerts = async () => {
    const result = await requestPwaNotifications();
    if (result === 'granted') notify('Los avisos del navegador quedaron habilitados.', 'success');
    else if (result === 'denied') notify('El navegador bloqueó los avisos. Puedes habilitarlos desde los permisos del sitio.', 'error');
    else notify('Los avisos del navegador requieren HTTPS o localhost. Los avisos dentro de la aplicación seguirán funcionando.', 'error');
  };

  return (
    <>
      <div className="global-notifications" ref={rootRef}>
        <button
          type="button"
          className="global-tool-button global-tool-button--notifications"
          onClick={() => { setOpen((current) => !current); if (!open) refresh(pageRef.current, { quiet: true }); }}
          aria-expanded={open}
          aria-label={`Centro de notificaciones${unread ? `, ${unread} sin leer` : ''}`}
          title="Centro de notificaciones"
        >
          <BellRing size={19} />
          {unread > 0 && <span className="global-tool-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>

        {open && createPortal((
          <section ref={panelRef} className="global-notifications-panel" aria-label="Centro de notificaciones">
            <header>
              <div>
                <span className="section-kicker">Tu bandeja</span>
                <h2>Notificaciones</h2>
              </div>
              <span>{unread} sin leer</span>
            </header>
            <div className="global-notifications-panel__actions">
              {canSend && <button type="button" onClick={() => { setOpen(false); setComposerOpen(true); }}>Enviar aviso</button>}
              {canSend && <button type="button" onClick={() => { setOpen(false); setHistoryOpen(true); }}>Historial</button>}
              {unread > 0 && <button type="button" onClick={markAllRead}>Marcar todas leídas</button>}
            </div>
            <div className="global-notifications-panel__list">
              {loading ? <p className="global-notifications-panel__empty">Cargando avisos…</p> : loadError ? (
                <div className="global-notifications-panel__error" role="alert">
                  <p>{loadError}</p>
                  <button type="button" onClick={() => { setLoading(true); refresh(pageRef.current); }}>Reintentar</button>
                </div>
              ) : notifications.length === 0 ? (
                <p className="global-notifications-panel__empty">No tienes notificaciones en esta página.</p>
              ) : notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.id_notificacion}
                  className={`${notification.leida_en ? '' : 'is-unread'} priority-${String(notification.prioridad || 'NORMAL').toLowerCase()}`}
                  onClick={() => openNotification(notification)}
                >
                  <span aria-hidden="true">{notification.leida_en ? '✓' : <BellRing size={15} />}</span>
                  <div>
                    <small>{moduleLabel(notification.modulo)}{notification.emisor_nombre ? ` · ${notification.emisor_nombre}` : ''}</small>
                    <strong>{notification.titulo}</strong>
                    <p>{notification.detalle}</p>
                    <time>{dateTime(notification.creada_en)}</time>
                  </div>
                </button>
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => { const target = Math.max(1, page - 1); setLoading(true); refresh(target); }} disabled={page <= 1} aria-label="Página anterior">‹</button>
              <span>Página {page} de {pages}</span>
              <button type="button" onClick={() => { const target = Math.min(pages, page + 1); setLoading(true); refresh(target); }} disabled={page >= pages} aria-label="Página siguiente">›</button>
              <button type="button" className="global-notifications-panel__permission" onClick={enableBrowserAlerts}>Avisos del navegador</button>
            </footer>
          </section>
        ), document.body)}
      </div>

      {realtimeNotice && createPortal((
        <aside className={`institutional-notification-toast priority-${String(realtimeNotice.priority || 'NORMAL').toLowerCase()}`} role="status" aria-live="polite">
          <span><BellRing size={19} /></span>
          <div>
            <small>{realtimeNotice.sender ? `Aviso de ${realtimeNotice.sender}` : 'Aviso institucional'}</small>
            <strong>{realtimeNotice.title}</strong>
            <p>{realtimeNotice.detail}</p>
          </div>
          {realtimeNotice.link && <button type="button" onClick={openRealtimeNotification}>Abrir</button>}
          <button type="button" className="institutional-notification-toast__close" onClick={() => setRealtimeNotice(null)} aria-label="Cerrar aviso">×</button>
        </aside>
      ), document.body)}

      {composerOpen && createPortal(
        <NotificationComposer onClose={() => setComposerOpen(false)} onSent={() => refresh(1)} />,
        document.body
      )}
      {historyOpen && createPortal(
        <NotificationHistoryDialog onClose={() => setHistoryOpen(false)} />,
        document.body
      )}
    </>
  );
};

export default NotificationCenter;
