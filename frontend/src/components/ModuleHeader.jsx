import { ArrowLeft, LogOut } from 'lucide-react';
import { createElement } from 'react';

const ModuleHeader = ({ icon, title, description, onBack, onLogout, children }) => (
  <header className="module-header">
    <div className="module-header__identity">
      <span className="module-header__icon" aria-hidden="true">{createElement(icon, { size: 23 })}</span>
      <div>
        <span className="module-header__kicker">Gestión institucional</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
    <div className="module-header__actions">
      {children}
      {onBack && (
        <button type="button" className="module-header__button" onClick={onBack}>
          <ArrowLeft size={15} /> Panel principal
        </button>
      )}
      {onLogout && (
        <button type="button" className="module-header__button module-header__button--danger" onClick={onLogout}>
          <LogOut size={15} /> Cerrar sesión
        </button>
      )}
    </div>
  </header>
);

export default ModuleHeader;
