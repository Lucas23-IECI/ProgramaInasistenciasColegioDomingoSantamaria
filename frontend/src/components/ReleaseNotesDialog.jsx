import { useEffect, useRef } from 'react';
import { ArrowRight, CalendarDays, MessageCircle, Newspaper, X } from 'lucide-react';

const ReleaseNotesDialog = ({ open, release, onClose, onOpenChat }) => {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), [tabindex="0"]') || [])];
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if ((!event.shiftKey && document.activeElement === last) || !dialogRef.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      cancelAnimationFrame(focusFrame);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="release-notes-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="release-notes" role="dialog" aria-modal="true" aria-labelledby="release-notes-title" aria-describedby="release-notes-summary">
        <header className="release-notes__header">
          <div className="release-notes__mark"><Newspaper size={23} /></div>
          <div className="release-notes__heading">
            <span>Novedades del sistema</span>
            <h2 id="release-notes-title">{release.title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="release-notes__close" onClick={onClose} aria-label="Cerrar novedades"><X size={21} /></button>
        </header>

        <div className="release-notes__body" role="region" aria-label="Detalle de novedades" tabIndex={0}>
          {onOpenChat && release.chatHighlight && (
            <section className="release-notes__chat" aria-labelledby="release-chat-title">
              <span className="release-notes__chat-kicker"><MessageCircle size={20} aria-hidden="true" /> ¿Ya lo conocías?</span>
              <h3 id="release-chat-title">{release.chatHighlight.title}</h3>
              <p>{release.chatHighlight.description}</p>
              <div className="release-notes__chat-location"><MessageCircle size={22} aria-hidden="true" /><p>{release.chatHighlight.location}</p></div>
              <button type="button" className="release-notes__confirm" onClick={onOpenChat}>{release.chatHighlight.action} <ArrowRight size={18} aria-hidden="true" /></button>
            </section>
          )}
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
