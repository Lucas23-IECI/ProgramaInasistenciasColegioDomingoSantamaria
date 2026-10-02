import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './AuthContext';
import { hasPermission, PERMISSIONS } from '../permissions';
import useChatAppearance from './useChatAppearance';

const ChatWorkspaceContext = createContext(null);
const EMPTY_DRAFT = Object.freeze({ content: '', urgent: false, mentions: [] });
const freshWorkspace = (owner) => ({ owner, drafts: {}, busy: {}, dockOpen: false, dockPath: '/chat', returnPath: '/admin' });

// Private drafts live only in this tab's memory: never localStorage, URLs or logs.
export const ChatWorkspaceProvider = ({ children }) => {
  const { user, getSessionGuard } = useContext(AuthContext);
  const isCurrentSession = useMemo(() => user ? getSessionGuard() : () => false, [user, getSessionGuard]);
  const owner = user && !user.debe_cambiar_password && hasPermission(user, PERMISSIONS.CHAT_ACCESS) ? String(user.id) : null;
  const appearance = useChatAppearance(owner, isCurrentSession);
  const [state, setState] = useState(() => freshWorkspace(owner));
  useEffect(() => { setState((current) => current.owner === owner ? current : freshWorkspace(owner)); }, [owner]);

  const change = useCallback((update) => {
    setState((current) => current.owner === owner && owner !== null && isCurrentSession() ? update(current) : current);
  }, [owner, isCurrentSession]);
  const updateDraft = useCallback((id, update) => change((current) => {
    const previous = current.drafts[id] || EMPTY_DRAFT;
    return { ...current, drafts: { ...current.drafts, [id]: { ...previous, ...(typeof update === 'function' ? update(previous) : update) } } };
  }), [change]);
  const clearDraft = useCallback((id) => change((current) => {
    const drafts = { ...current.drafts };
    delete drafts[id];
    return { ...current, drafts };
  }), [change]);
  const setBusy = useCallback((id, value) => change((current) => ({ ...current, busy: { ...current.busy, [id]: value } })), [change]);
  const clearAllDrafts = useCallback(() => change((current) => ({ ...current, drafts: {} })), [change]);
  const setDockOpen = useCallback((value) => change((current) => ({ ...current, dockOpen: typeof value === 'function' ? value(current.dockOpen) : value })), [change]);
  const setDockPath = useCallback((value) => change((current) => ({ ...current, dockPath: value })), [change]);
  const setReturnPath = useCallback((value) => change((current) => ({ ...current, returnPath: value })), [change]);
  const current = state.owner === owner ? state : freshWorkspace(owner);
  const value = useMemo(() => ({
    ...current, ...appearance, isCurrentSession, updateDraft, clearDraft, clearAllDrafts, setBusy, setDockOpen, setDockPath, setReturnPath,
    getDraft: (id) => current.drafts[id] || EMPTY_DRAFT,
  }), [current, appearance, isCurrentSession, updateDraft, clearDraft, clearAllDrafts, setBusy, setDockOpen, setDockPath, setReturnPath]);
  return <ChatWorkspaceContext.Provider value={value}>{children}</ChatWorkspaceContext.Provider>;
};

export const useChatWorkspace = () => useContext(ChatWorkspaceContext);
