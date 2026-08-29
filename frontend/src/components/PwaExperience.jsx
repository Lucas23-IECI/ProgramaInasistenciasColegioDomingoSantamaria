import { lazy, Suspense, useEffect, useRef } from 'react';
import { ArrowUpCircle, CheckCircle2, Download, MonitorSmartphone, RefreshCw, Share, ShieldCheck, X } from 'lucide-react';

const OfflineSyncPanel = lazy(() => import('./OfflineSyncPanel'));

const InstallationGuide = ({ state }) => {
  if (!state.secure) {
    return (
      <div className="pwa-experience__notice pwa-experience__notice--warning">
        <ShieldCheck size={20} />
        <div>
          <strong>La instalación está bloqueada en esta dirección</strong>
          <p>Estás usando una dirección HTTP. El navegador permite abrir el sistema, pero bloquea la instalación, la cámara y los avisos fuera de pantalla. Solicita al administrador la dirección HTTPS del colegio.</p>
          <small>No se descargó ningún archivo ni se creó una instalación incompleta.</small>
        </div>
      </div>
    );
  }

  if (state.ios) {
    return (
      <ol className="pwa-experience__steps">
        <li><Share size={20} /><span>Toca <strong>Compartir</strong> en Safari.</span></li>
        <li><MonitorSmartphone size={20} /><span>Elige <strong>Agregar a pantalla de inicio</strong>.</span></li>
        <li><CheckCircle2 size={20} /><span>Confirma con <strong>Agregar</strong>.</span></li>
      </ol>
    );
  }

  return (
    <ol className="pwa-experience__steps">
      <li><Download size={20} /><span>Busca el icono <strong>Instalar</strong> en la barra de direcciones.</span></li>
      <li><MonitorSmartphone size={20} /><span>También puedes abrir el menú del navegador y elegir <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla de inicio</strong>.</span></li>
      <li><CheckCircle2 size={20} /><span>La aplicación seguirá conectada al mismo sistema y recibirá sus actualizaciones.</span></li>
    </ol>
  );
};

const PwaExperience = ({ open, onClose, onInstall, onUpdate, state }) => {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => event.key === 'Escape' && onClose();
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  return (
    <>
      {state.updateAvailable && (
        <aside className="pwa-update-banner" role="status" aria-live="polite">
          <span className="pwa-update-banner__icon"><ArrowUpCircle size={22} /></span>
          <div>
            <strong>Nueva versión disponible</strong>
            <span>Termina lo que estés editando y actualiza cuando estés listo. Los registros offline se conservarán.</span>
          </div>
          <button type="button" onClick={onUpdate} disabled={state.updating}>
            <RefreshCw size={17} className={state.updating ? 'is-spinning' : ''} />
            {state.updating ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
        </aside>
      )}

      {open && (
        <div className="pwa-experience-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <section className="pwa-experience" role="dialog" aria-modal="true" aria-labelledby="pwa-experience-title">
            <header>
              <img src="/institucional/escudo-ldsm-concepcion.jpg" alt="Escudo del Liceo Domingo Santa María" />
              <div>
                <span>Aplicación institucional</span>
                <h2 id="pwa-experience-title">{state.installed ? 'Aplicación instalada' : 'Instalar en este dispositivo'}</h2>
              </div>
              <button ref={closeRef} type="button" className="pwa-experience__close" onClick={onClose} aria-label="Cerrar"><X size={21} /></button>
            </header>

            <div className="pwa-experience__body">
              <p>Instala el mismo sistema en tu computador, tablet o celular. No crea una base separada: funciona en línea con la información institucional y mantiene disponible la continuidad segura de Portería ante cortes breves.</p>

              {state.installed ? (
                <div className="pwa-experience__notice pwa-experience__notice--success">
                  <CheckCircle2 size={21} />
                  <div><strong>Ya está instalada</strong><p>Puedes abrirla desde el escritorio o la pantalla de inicio como cualquier otra aplicación.</p></div>
                </div>
              ) : <InstallationGuide state={state} />}

              {state.registrationError && (
                <div className="pwa-experience__notice pwa-experience__notice--warning" role="alert">
                  <ShieldCheck size={20} />
                  <div><strong>Uso sin conexión no disponible</strong><p>{state.registrationError}</p></div>
                </div>
              )}

              <Suspense fallback={<div className="offline-sync-panel__empty">Revisando la bandeja de este dispositivo…</div>}><OfflineSyncPanel /></Suspense>

              <dl className="pwa-experience__facts">
                <div><dt>Identidad</dt><dd>Escudo oficial del colegio</dd></div>
                <div><dt>Versión</dt><dd>{state.version}</dd></div>
                <div><dt>Actualizaciones</dt><dd>El sistema avisa antes de recargar</dd></div>
                <div><dt>Uso web</dt><dd>Siempre disponible desde el navegador</dd></div>
              </dl>
            </div>

            <footer>
              <button type="button" className="pwa-experience__secondary" onClick={onClose}>Cerrar</button>
              {!state.installed && state.installPromptAvailable && (
                <button type="button" className="pwa-experience__primary" onClick={onInstall} disabled={state.installing}>
                  <Download size={18} /> {state.installing ? 'Preparando…' : 'Instalar aplicación'}
                </button>
              )}
              {state.updateAvailable && (
                <button type="button" className="pwa-experience__primary" onClick={onUpdate} disabled={state.updating}>
                  <RefreshCw size={18} className={state.updating ? 'is-spinning' : ''} /> {state.updating ? 'Actualizando…' : 'Actualizar ahora'}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
};

export default PwaExperience;
