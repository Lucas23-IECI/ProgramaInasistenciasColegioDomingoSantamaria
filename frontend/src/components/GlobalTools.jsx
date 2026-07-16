import { useContext, useEffect, useRef, useState } from 'react';
import { CircleHelp, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import { useHelpTour } from '../context/HelpTourContext';

const initialsFrom = (value) => String(value || 'Usuario')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

const roleLabel = (role) => ({
  admin: 'Administrador',
  secretaria: 'Secretaría / Inspectoría',
  lector: 'Lector',
}[role] || role || 'Usuario');

const GlobalTools = () => {
  const { user, logout } = useContext(AuthContext);
  const { theme, toggleTheme } = useContext(ThemeContext);
  const { available, startTour, title } = useHelpTour();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

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

  if (!user) return null;

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <nav className="global-tools" aria-label="Herramientas globales" data-tour="global-tools">
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
      <div className="global-user" ref={menuRef}>
        <button
          type="button"
          className="global-tool-button global-user-trigger"
          aria-label="Abrir menú de usuario"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span>{initialsFrom(user.nombre || user.correo)}</span>
        </button>
        {menuOpen && (
          <div className="global-user-menu" role="menu">
            <div className="global-user-menu__identity">
              <UserRound size={18} />
              <div>
                <strong>{user.nombre || user.correo}</strong>
                <span>{roleLabel(user.rol)}</span>
              </div>
            </div>
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

