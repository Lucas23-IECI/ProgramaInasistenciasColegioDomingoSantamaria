import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { CircleHelp, ContactRound, Download, KeyRound, LogOut, MessageCircle, Moon, Newspaper, RefreshCw, Smartphone, Sun, UserRound, WifiOff } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import { useHelpTour } from '../context/HelpTourContext';
import { PERMISSIONS, hasPermission, roleLabel } from '../permissions';
import { useReleaseNotes } from '../context/ReleaseNotesContext';
import StaffAvatar from './StaffAvatar';
import { PwaContext } from '../context/PwaContext';
import { showChatNotification, subscribeToChatRealtime } from '../pwa/chatRealtime';

const NotificationCenter = lazy(() => import('./NotificationCenter'));

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
  const [online, setOnline] = useState(() => navigator.onLine);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const context = location.pathname === '/admin'
    ? 'hub'
    : location.pathname === '/' || location.pathname === '/scanner'
      ? 'kiosk'
      : 'module';

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

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

  if (!user) return null;

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <>
    {!online && (
      <aside className="global-connectivity-alert" role="status" aria-live="polite">
        <WifiOff size={18} />
        <span><strong>Sin conexión con la red</strong><small>Solo el terminal de puntualidad puede guardar ingresos pendientes. Las demás operaciones esperan hasta recuperar la conexión.</small></span>
      </aside>
    )}
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
      <Suspense fallback={null}>
        <NotificationCenter user={user} />
      </Suspense>
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
    </>
  );
};

export default GlobalTools;
