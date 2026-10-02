import { lazy, Suspense, useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, MessageCircle, Minus, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { AuthContext } from '../context/AuthContext';
import { useChatWorkspace } from '../context/ChatWorkspaceContext';
import { hasPermission, PERMISSIONS } from '../permissions';
import '../styles/internal-chat.css';

const InternalChat = lazy(() => import('../InternalChat'));

export default function ChatDock({ unread = 0 }) {
  const { user, loading, sessionError } = useContext(AuthContext);
  const workspace = useChatWorkspace();
  const { dockOpen, dockPath, setDockOpen, setDockPath, setReturnPath } = workspace;
  const location = useLocation();
  const navigate = useNavigate();
  const launcherRef = useRef(null);
  const panelRef = useRef(null);
  const fullChat = /^\/chat(?:\/|$)/.test(location.pathname);
  const available = user && !loading && !sessionError && !user.debe_cambiar_password
    && hasPermission(user, PERMISSIONS.CHAT_ACCESS) && !['/login', '/cambiar-clave'].includes(location.pathname);

  useEffect(() => {
    if (available && !fullChat) setReturnPath(`${location.pathname}${location.search}${location.hash}`);
  }, [available, fullChat, location.pathname, location.search, location.hash, setReturnPath]);

  useEffect(() => {
    if (dockOpen && !fullChat && available) panelRef.current?.focus({ preventScroll: true });
  }, [dockOpen, fullChat, available]);

  const minimize = () => {
    setDockOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  };
  if (!available || fullChat) return null;
  return createPortal(dockOpen ? (
    <section ref={panelRef} tabIndex={-1} className="chat-dock" role="region" aria-label="Chat rápido" onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.target.closest('.chat-settings-panel, .chat-dialog, .chat-mention-menu')) {
        event.stopPropagation();
        minimize();
      }
    }}>
      <header className="chat-dock-bar">
        <h2><MessageCircle size={18} /> Mensajes</h2>
        <div className="chat-dock-actions">
          <button type="button" aria-label="Abrir chat completo" title="Abrir chat completo" onClick={() => navigate(dockPath)}><Maximize2 size={17} /></button>
          <button type="button" aria-label="Minimizar chat" title="Minimizar chat" onClick={minimize}><Minus size={18} /></button>
          <button type="button" aria-label="Cerrar chat" title="Cerrar chat" onClick={minimize}><X size={18} /></button>
        </div>
      </header>
      <Suspense fallback={<p className="chat-conversations__status" role="status">Abriendo mensajes…</p>}>
        <InternalChat embedded embeddedPath={dockPath} onNavigate={setDockPath} />
      </Suspense>
    </section>
  ) : (
    <button ref={launcherRef} type="button" className="chat-launcher" aria-label={`Abrir mensajes${unread ? `, ${unread} sin leer` : ''}`} aria-expanded="false" onClick={() => setDockOpen(true)}>
      <MessageCircle size={20} /><span>Mensajes</span>
      {unread > 0 && <span className="chat-launcher-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
  ), document.body);
}
