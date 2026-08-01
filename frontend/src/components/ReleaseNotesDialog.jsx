import { useEffect, useRef } from 'react';
import { ArrowRight, CalendarDays, Newspaper, X } from 'lucide-react';

const ReleaseNotesDialog = ({ open, release, onClose }) => {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="release-notes-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="release-notes" role="dialog" aria-modal="true" aria-labelledby="release-notes-title" aria-describedby="release-notes-summary">
        <header className="release-notes__header">
          <div className="release-notes__mark"><Newspaper size={23} /></div>
          <div className="release-notes__heading">
            <span>Novedades del sistema</span>
            <h2 id="release-notes-title">{release.title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="release-notes__close" onClick={onClose} aria-label="Cerrar novedades"><X size={21} /></button>
        </header>

        <div className="release-notes__body" role="region" aria-label="Detalle de novedades" tabIndex={0}>
          <div className="release-notes__intro">
            <div className="release-notes__release"><CalendarDays size={16} /><span>{release.label}</span><span aria-hidden="true">·</span><span>{release.date}</span></div>
            <p id="release-notes-summary">{release.summary}</p>
          </div>

          <div className="release-notes__list">
            {release.sections.map((section) => {
              const Icon = section.icon;
              return (
                <article key={section.title} className="release-notes__item">
                  <span className="release-notes__item-icon"><Icon size={20} /></span>
                  <div><h3>{section.title}</h3><p>{section.description}</p></div>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="release-notes__footer">
          <p>Podrás consultar este resumen nuevamente desde el menú de tu cuenta.</p>
          <button type="button" className="release-notes__confirm" onClick={onClose}>Entendido <ArrowRight size={18} /></button>
        </footer>
      </section>
    </div>
  );
};

export default ReleaseNotesDialog;
