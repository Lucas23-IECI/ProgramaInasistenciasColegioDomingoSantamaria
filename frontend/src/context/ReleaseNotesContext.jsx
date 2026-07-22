import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import ReleaseNotesDialog from '../components/ReleaseNotesDialog';
import { CURRENT_RELEASE } from '../releaseNotes';

const ReleaseNotesContext = createContext({
  openReleaseNotes: () => {},
  release: CURRENT_RELEASE,
});

const storageKeyFor = (user) => {
  const identity = user?.id || user?.correo || 'cuenta';
  return `ldsm-release:${CURRENT_RELEASE.id}:${identity}`;
};

export const ReleaseNotesProvider = ({ children }) => {
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const [manualOpen, setManualOpen] = useState(false);
  const [closedReleaseKey, setClosedReleaseKey] = useState(null);
  const eligible = Boolean(user)
    && !user.debe_cambiar_password
    && location.pathname !== '/login'
    && location.pathname !== '/cambiar-clave';
  const releaseKey = user ? storageKeyFor(user) : null;
  const hasSeenRelease = releaseKey ? Boolean(localStorage.getItem(releaseKey)) : true;
  const open = eligible && (manualOpen || (!hasSeenRelease && closedReleaseKey !== releaseKey));

  const closeReleaseNotes = useCallback(() => {
    if (releaseKey) localStorage.setItem(releaseKey, 'seen');
    setClosedReleaseKey(releaseKey);
    setManualOpen(false);
  }, [releaseKey]);

  const openReleaseNotes = useCallback(() => setManualOpen(true), []);

  const value = useMemo(() => ({
    openReleaseNotes,
    release: CURRENT_RELEASE,
  }), [openReleaseNotes]);

  return (
    <ReleaseNotesContext.Provider value={value}>
      {children}
      <ReleaseNotesDialog open={open} release={CURRENT_RELEASE} onClose={closeReleaseNotes} />
    </ReleaseNotesContext.Provider>
  );
};

export const useReleaseNotes = () => useContext(ReleaseNotesContext);
