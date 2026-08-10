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

  useEffect(() => {
    const unsubscribe = subscribeToPwaState((next) => setState((current) => ({ ...current, ...next })));
    registerServiceWorker();
    return unsubscribe;
  }, []);

  const openPwaDetails = useCallback(() => setDetailsOpen(true), []);
  const closePwaDetails = useCallback(() => setDetailsOpen(false), []);

  const install = useCallback(async () => {
    if (!state.installPromptAvailable) {
      setDetailsOpen(true);
      return;
    }
    setInstalling(true);
    try {
      const choice = await promptPwaInstall();
      if (choice.outcome !== 'accepted') setDetailsOpen(true);
    } finally {
      setInstalling(false);
    }
  }, [state.installPromptAvailable]);

  const update = useCallback(async () => {
    setUpdating(true);
    const applied = await applyPwaUpdate();
    if (!applied) {
      setUpdating(false);
      setState((current) => ({ ...current, updateAvailable: false }));
    }
  }, []);

  const value = useMemo(() => ({
    ...state,
    installing,
    updating,
    version: CURRENT_RELEASE.id,
    openPwaDetails,
    install,
    update,
  }), [install, installing, openPwaDetails, state, update, updating]);

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
