import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyPwaUpdate,
  getPwaCapabilitySnapshot,
  promptPwaInstall,
  registerServiceWorker,
  subscribeToPwaState,
} from '../pwa/registerServiceWorker';
import { CURRENT_RELEASE } from '../releaseNotes';
import PwaExperience from '../components/PwaExperience';

const initialState = typeof window === 'undefined'
  ? { supported: false, installed: false, secure: false, ios: false, installPromptAvailable: false }
  : getPwaCapabilitySnapshot();

export const PwaContext = createContext({
  ...initialState,
  updateAvailable: false,
  openPwaDetails: () => {},
  install: () => {},
  update: () => {},
});

export const PwaProvider = ({ children }) => {
  const [state, setState] = useState(initialState);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [operationError, setOperationError] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToPwaState((next) => setState((current) => ({ ...current, ...next })));
    registerServiceWorker();
    return unsubscribe;
  }, []);

  const openPwaDetails = useCallback(() => setDetailsOpen(true), []);
  const closePwaDetails = useCallback(() => setDetailsOpen(false), []);

  const install = useCallback(async () => {
    setOperationError('');
    if (!state.installPromptAvailable) {
      setDetailsOpen(true);
      return;
    }
    setInstalling(true);
    try {
      const choice = await promptPwaInstall();
      if (choice.outcome !== 'accepted') setDetailsOpen(true);
    } catch {
      setOperationError('El navegador no pudo iniciar la instalación. El sistema sigue disponible en esta ventana; revisa que la dirección sea HTTPS e inténtalo nuevamente.');
      setDetailsOpen(true);
    } finally {
      setInstalling(false);
    }
  }, [state.installPromptAvailable]);

  const update = useCallback(async () => {
    setOperationError('');
    setUpdating(true);
    try {
      const applied = await applyPwaUpdate();
      if (applied) return;
      setOperationError('La actualización pendiente ya no está disponible. La aplicación continuará con la versión actual y volverá a avisar cuando encuentre una nueva.');
      setState((current) => ({ ...current, updateAvailable: false }));
      setDetailsOpen(true);
    } catch {
      setOperationError('No fue posible activar la actualización. La aplicación no se recargó y los ingresos guardados en este dispositivo se conservaron. Inténtalo nuevamente cuando la conexión sea estable.');
      setDetailsOpen(true);
    } finally {
      setUpdating(false);
    }
  }, []);

  const value = useMemo(() => ({
    ...state,
    installing,
    updating,
    operationError,
    version: CURRENT_RELEASE.id,
    openPwaDetails,
    install,
    update,
  }), [install, installing, openPwaDetails, operationError, state, update, updating]);

  return (
    <PwaContext.Provider value={value}>
      {children}
      <PwaExperience
        open={detailsOpen}
        onClose={closePwaDetails}
        onInstall={install}
        onUpdate={update}
        state={value}
      />
    </PwaContext.Provider>
  );
};
