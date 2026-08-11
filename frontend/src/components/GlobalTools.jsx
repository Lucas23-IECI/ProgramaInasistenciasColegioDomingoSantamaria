import { useContext, useEffect, useRef, useState } from 'react';
import { BellRing, Check, CircleHelp, ContactRound, Download, KeyRound, LogOut, MessageCircle, Moon, Newspaper, RefreshCw, Smartphone, Sun, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import { useHelpTour } from '../context/HelpTourContext';
import { PERMISSIONS, hasPermission, roleLabel } from '../permissions';
import { useReleaseNotes } from '../context/ReleaseNotesContext';
import StaffAvatar from './StaffAvatar';
import { PwaContext } from '../context/PwaContext';
import { showChatNotification, subscribeToChatRealtime } from '../pwa/chatRealtime';

const initialsFrom = (value) => String(value || 'Usuario')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

const GlobalTools = () => {
  const { user, logout } = useContext(AuthContext);
  const { theme, toggleTheme } = useContext(ThemeContext);
  const { available, startTour, title } = useHelpTour();
  const { openReleaseNotes } = useReleaseNotes();
  const pwa = useContext(PwaContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [followNotifications, setFollowNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const menuRef = useRef(null);
  const notificationsRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const context = location.pathname === '/admin'
    ? 'hub'
    : location.pathname === '/' || location.pathname === '/scanner'
      ? 'kiosk'
      : 'module';

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!user || !hasPermission(user, PERMISSIONS.CHAT_ACCESS)) return undefined;
    let active = true;
    const refresh = () => fetch('/api/chat/resumen', { credentials: 'include', cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data) setUnreadChat(Number(data.no_leidos) || 0); })
      .catch(() => {});
    refresh();
    const unsubscribe = subscribeToChatRealtime((event) => {
      refresh();
      showChatNotification(event).catch(() => {});
    });
    const timer = setInterval(refresh, 60000);
    return () => { active = false; unsubscribe(); clearInterval(timer); };
  }, [user]);

  useEffect(() => {
    if (!user || !hasPermission(user, PERMISSIONS.FOLLOW_UP_VIEW)) return undefined;
    let active = true;
    const refresh = () => fetch('/api/seguimiento/notificaciones', { credentials: 'include', cache: 'no-store' })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => { if (active) setFollowNotifications(Array.isArray(data) ? data : []); })
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 60000);
    const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [user]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const close = (event) => { if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [notificationsOpen]);

  if (!user) return null;

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate('/login');
  };

  const openFollowNotification = async (notification) => {
    if (!notification.leida_en) {
      await fetch(`/api/seguimiento/notificaciones/${notification.id_notificacion}/leer`, { method: 'PATCH', credentials: 'include' }).catch(() => {});
      setFollowNotifications((current) => current.map((item) => item.id_notificacion === notification.id_notificacion ? { ...item, leida_en: new Date().toISOString() } : item));
    }
    setNotificationsOpen(false);
    navigate(notification.enlace || '/admin/seguimiento');
  };

  const unreadFollow = followNotifications.filter((notification) => !notification.leida_en).length;

  return (
    <nav className="global-tools" data-context={context} aria-label="Herramientas globales" data-tour="global-tools">
      <button
        type="button"
        className="global-tool-button"
        onClick={startTour}
        disabled={!available}
        title={title}
        aria-label={title}
      >
        <CircleHelp size={20} />
      </button>
      <button
        type="button"
        className="global-tool-button"
        onClick={toggleTheme}
        title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
        aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
      >
        {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
      </button>
      {hasPermission(user, PERMISSIONS.CHAT_ACCESS) && (
        <button
          type="button"
          className="global-tool-button global-tool-button--chat"
          onClick={() => navigate('/chat')}
          title="Abrir chat interno"
          aria-label={`Abrir chat interno${unreadChat ? `, ${unreadChat} mensajes sin leer` : ''}`}
        >
          <MessageCircle size={19} />
          {unreadChat > 0 && <span className="global-tool-badge">{unreadChat > 99 ? '99+' : unreadChat}</span>}
        </button>
      )}
      {hasPermission(user, PERMISSIONS.FOLLOW_UP_VIEW) && (
        <div className="global-notifications" ref={notificationsRef}>
          <button type="button" className="global-tool-button global-tool-button--notifications" onClick={() => setNotificationsOpen((open) => !open)} aria-expanded={notificationsOpen} aria-label={`Avisos de seguimiento${unreadFollow ? `, ${unreadFollow} sin leer` : ''}`} title="Avisos de seguimiento">
            <BellRing size={19} />
            {unreadFollow > 0 && <span className="global-tool-badge">{unreadFollow > 99 ? '99+' : unreadFollow}</span>}
          </button>
          {notificationsOpen && <section className="global-notifications-panel" aria-label="Avisos de seguimiento"><header><div><span className="section-kicker">Seguimiento</span><h2>Avisos asignados</h2></div><span>{unreadFollow} sin leer</span></header><div>{followNotifications.length === 0 ? <p className="global-notifications-panel__empty">No tienes avisos pendientes.</p> : followNotifications.slice(0, 12).map((notification) => <button type="button" key={notification.id_notificacion} className={notification.leida_en ? '' : 'is-unread'} onClick={() => openFollowNotification(notification)}><span>{notification.leida_en ? <Check size={15} /> : <BellRing size={15} />}</span><div><strong>{notification.titulo}</strong><p>{notification.detalle}</p><time>{new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(notification.creada_en))}</time></div></button>)}</div><footer><button type="button" onClick={() => { setNotificationsOpen(false); navigate('/admin/seguimiento'); }}>Abrir Seguimiento institucional</button></footer></section>}
        </div>
      )}
      {(pwa.updateAvailable || !pwa.installed) && (
        <button
          type="button"
          className={`global-tool-button global-tool-button--pwa${pwa.updateAvailable ? ' has-update' : ''}`}
          onClick={pwa.updateAvailable ? pwa.openPwaDetails : pwa.install}
          disabled={pwa.installing || pwa.updating}
          title={pwa.updateAvailable ? 'Actualizar aplicación' : 'Instalar aplicación'}
          aria-label={pwa.updateAvailable ? 'Actualizar aplicación' : 'Instalar aplicación'}
        >
          {pwa.updateAvailable ? <RefreshCw size={19} className={pwa.updating ? 'is-spinning' : ''} /> : <Download size={19} />}
        </button>
      )}
      <div className="global-user" ref={menuRef}>
        <button
          type="button"
          className="global-tool-button global-user-trigger"
          aria-label="Abrir menú de usuario"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {user.personal_profile?.avatar_url || user.personal_profile?.cuenta_compartida ? (
            <StaffAvatar profile={user.personal_profile} name={user.nombre || user.correo} size="sm" />
          ) : <span>{initialsFrom(user.nombre || user.correo)}</span>}
        </button>
        {menuOpen && (
          <div className="global-user-menu" role="menu">
            <div className="global-user-menu__identity">
              <StaffAvatar profile={user.personal_profile} name={user.nombre || user.correo} size="md" />
              <div>
                <strong>{user.personal_profile?.nombre_mostrado || user.nombre || user.correo}</strong>
                <span>{user.profile_name || roleLabel(user.rol)}</span>
              </div>
            </div>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/mi-perfil'); }}>
              <UserRound size={17} /> Mi perfil
            </button>
            {hasPermission(user, PERMISSIONS.PROFILES_DIRECTORY_VIEW) && (
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/directorio'); }}>
                <ContactRound size={17} /> Directorio interno
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/cambiar-clave'); }}>
              <KeyRound size={17} /> Cambiar contraseña
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); openReleaseNotes(); }}>
              <Newspaper size={17} /> Novedades de la versión
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); pwa.openPwaDetails(); }}>
              {pwa.installed ? <Smartphone size={17} /> : <Download size={17} />}
              {pwa.installed ? 'Aplicación instalada' : 'Instalar aplicación'}
            </button>
            <button type="button" role="menuitem" onClick={handleLogout}>
              <LogOut size={17} /> Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

export default GlobalTools;
