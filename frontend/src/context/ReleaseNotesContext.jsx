import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthContext } from './AuthContext';
import ReleaseNotesDialog from '../components/ReleaseNotesDialog';
import { CURRENT_RELEASE } from '../releaseNotes';
import { PERMISSIONS, hasPermission } from '../permissions';

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
  const navigate = useNavigate();
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
  const canOpenChat = hasPermission(user, PERMISSIONS.CHAT_ACCESS);
  const openChat = () => {
    if (!canOpenChat) return;
    closeReleaseNotes();
    navigate('/chat');
  };
  const visibleRelease = {
    ...CURRENT_RELEASE,
    sections: CURRENT_RELEASE.sections.filter((section) => !section.permission || hasPermission(user, section.permission)),
  };

  const value = useMemo(() => ({
    openReleaseNotes,
    release: CURRENT_RELEASE,
  }), [openReleaseNotes]);

  return (
    <ReleaseNotesContext.Provider value={value}>
      {children}
      <ReleaseNotesDialog open={open} release={visibleRelease} onClose={closeReleaseNotes} onOpenChat={canOpenChat ? openChat : undefined} />
    </ReleaseNotesContext.Provider>
  );
};

export const useReleaseNotes = () => useContext(ReleaseNotesContext);
