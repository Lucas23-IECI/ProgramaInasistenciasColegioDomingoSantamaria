import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const FeedbackContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export const FeedbackProvider = ({ children }) => {
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null);
  const timerRef = useRef(null);

  const notify = useCallback((message, type = 'info') => {
    clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, type });
    timerRef.current = setTimeout(() => setToast(null), type === 'error' ? 6500 : 4500);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    setDialog({
      title: options.title || 'Confirmar acción',
      message: options.message,
      confirmLabel: options.confirmLabel || 'Confirmar',
      cancelLabel: options.cancelLabel || 'Cancelar',
      danger: Boolean(options.danger),
      resolve,
    });
  }), []);

  const closeDialog = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  const ToastIcon = toast ? (ICONS[toast.type] || Info) : Info;

  return (
    <FeedbackContext.Provider value={{ notify, confirm }}>
      {children}

      {toast && (
        <div className={`app-toast app-toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live="polite">
          <ToastIcon size={22} aria-hidden="true" />
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Cerrar notificación">
            <X size={20} />
          </button>
        </div>
      )}

      {dialog && (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={() => closeDialog(false)}>
          <div
            className="app-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="app-dialog-title">{dialog.title}</h2>
            <p id="app-dialog-description">{dialog.message}</p>
            <div className="app-dialog__actions">
              <button type="button" className="app-action app-action--secondary" onClick={() => closeDialog(false)} autoFocus>
                {dialog.cancelLabel}
              </button>
              <button
                type="button"
                className={`app-action ${dialog.danger ? 'app-action--danger' : 'app-action--primary'}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
};

export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback debe utilizarse dentro de FeedbackProvider.');
  return context;
};

