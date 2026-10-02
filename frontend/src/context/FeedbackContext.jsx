import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const dialogRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.resolve(false);
        setDialog(null);
      } else if (event.key === 'Tab') {
        const buttons = [...(dialogRef.current?.querySelectorAll('button:not([disabled])') || [])];
        if (!buttons.length) return;
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!dialogRef.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dialog]);

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
  const feedbackLayer = (
    <>
      {toast && (
        <div className={`app-toast app-toast--${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
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
            ref={dialogRef}
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
              <button type="button" className="app-action app-action--secondary" onClick={() => closeDialog(false)}>
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
    </>
  );

  return (
    <FeedbackContext.Provider value={{ notify, confirm }}>
      {children}
      {typeof document !== 'undefined' ? createPortal(feedbackLayer, document.body) : feedbackLayer}
    </FeedbackContext.Provider>
  );
};

export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback debe utilizarse dentro de FeedbackProvider.');
  return context;
};

