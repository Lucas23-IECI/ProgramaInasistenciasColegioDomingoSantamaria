import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Establece que Axios incluya siempre las cookies HttpOnly
axios.defaults.withCredentials = true;

export const AuthContext = createContext();

const SESSION_SYNC_KEY = 'ldsm:session-sync';

const hasSignedOut = () => {
  try { return JSON.parse(localStorage.getItem(SESSION_SYNC_KEY))?.type === 'SIGNED_OUT'; }
  catch { return false; }
};

const announceSessionChange = (type) => {
  try {
    localStorage.setItem(SESSION_SYNC_KEY, JSON.stringify({ type, at: Date.now() }));
  } catch {
    // El evento de foco seguirá restaurando la sesión si el almacenamiento no está disponible.
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const authEpochRef = useRef(0);
  const sessionProbeRef = useRef(0);
  const signedOutRef = useRef(hasSignedOut());
  const logoutRequestRef = useRef(null);
  // Capture the current session for asynchronous UI work (e.g. reading a file
  // before uploading it). A later login, even by the same user, invalidates it.
  const getSessionGuard = useCallback(() => {
    const epoch = authEpochRef.current;
    return () => epoch === authEpochRef.current && !signedOutRef.current;
  }, []);

  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      config.ldsmAuthEpoch = authEpochRef.current;
      return config;
    });
    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const requestUrl = error.config?.url || '';
        const belongsToCurrentSession = error.config?.ldsmAuthEpoch === authEpochRef.current;
        const sessionProbe = requestUrl.endsWith('/auth/me');
        if (error.response?.status === 401 && belongsToCurrentSession && !sessionProbe && !requestUrl.endsWith('/auth/login')) {
          authEpochRef.current += 1;
          setUser(null);
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  const refreshUser = async () => {
    const requestEpoch = authEpochRef.current;
    const res = await axios.get(`${API_URL}/auth/me`);
    if (signedOutRef.current || requestEpoch !== authEpochRef.current) return null;
    setUser(res.data.user);
    setSessionError('');
    return res.data.user;
  };

  const checkSession = useCallback(async ({ silent = false } = {}) => {
    // Cerrar sesión es una decisión explícita, incluso mientras la petición de
    // cierre está en tránsito o sin red. Solo otro login puede restablecerla.
    if (signedOutRef.current) {
      setLoading(false);
      return;
    }
    const requestEpoch = authEpochRef.current;
    const probe = ++sessionProbeRef.current;
    const isCurrent = () => requestEpoch === authEpochRef.current && probe === sessionProbeRef.current;
    if (!silent) {
      setLoading(true);
      setSessionError('');
    }
    try {
      const res = await axios.get(`${API_URL}/auth/me`);
      if (!isCurrent()) return;
      setUser(res.data.user);
      setSessionError('');
    } catch (error) {
      if (!isCurrent()) return;
      if (error.response?.status === 401) {
        setUser(null);
      } else {
        // Un límite temporal, una caída o un timeout no equivalen a cerrar sesión.
        // Conservamos cualquier usuario ya verificado y bloqueamos la navegación
        // hasta poder confirmar el estado con el servidor.
        setSessionError('No pudimos verificar tu sesión con el servidor.');
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentar restaurar la sesión desde el backend a través de la cookie HttpOnly.
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const revalidateVisibleSession = () => {
      if (document.visibilityState === 'visible') checkSession({ silent: true });
    };
    const syncSessionFromAnotherTab = (event) => {
      if (event.key !== SESSION_SYNC_KEY || !event.newValue) return;
      try {
        const change = JSON.parse(event.newValue);
        if (change.type === 'SIGNED_OUT') {
          authEpochRef.current += 1;
          signedOutRef.current = true;
          setUser(null);
          setSessionError('');
          setLoading(false);
        } else if (change.type === 'SIGNED_IN') {
          authEpochRef.current += 1;
          signedOutRef.current = false;
          checkSession({ silent: true });
        }
      } catch {
        checkSession({ silent: true });
      }
    };

    window.addEventListener('focus', revalidateVisibleSession);
    document.addEventListener('visibilitychange', revalidateVisibleSession);
    window.addEventListener('storage', syncSessionFromAnotherTab);
    return () => {
      window.removeEventListener('focus', revalidateVisibleSession);
      document.removeEventListener('visibilitychange', revalidateVisibleSession);
      window.removeEventListener('storage', syncSessionFromAnotherTab);
    };
  }, [checkSession]);

  const login = async (correo, password) => {
    // No permitir que una respuesta tardía de logout borre la cookie del nuevo acceso.
    if (logoutRequestRef.current) await logoutRequestRef.current;
    const loginEpoch = authEpochRef.current + 1;
    authEpochRef.current = loginEpoch;
    const res = await axios.post(`${API_URL}/auth/login`, { correo, password });
    if (authEpochRef.current !== loginEpoch) return false;
    authEpochRef.current += 1;
    signedOutRef.current = false;
    setUser(res.data.user);
    setSessionError('');
    setLoading(false);
    announceSessionChange('SIGNED_IN');
    return true;
  };

  const changePassword = async (currentPassword, newPassword) => {
    const passwordEpoch = authEpochRef.current + 1;
    authEpochRef.current = passwordEpoch;
    const res = await axios.post(`${API_URL}/auth/change-password`, {
      current_password: currentPassword,
      new_password: newPassword
    });
    if (authEpochRef.current !== passwordEpoch) return null;
    authEpochRef.current += 1;
    setUser(res.data.user);
    announceSessionChange('SIGNED_IN');
    return res.data.user;
  };

  const logout = async () => {
    if (logoutRequestRef.current) return logoutRequestRef.current;
    authEpochRef.current += 1;
    signedOutRef.current = true;
    setUser(null);
    setSessionError('');
    setLoading(false);
    announceSessionChange('SIGNED_OUT');
    logoutRequestRef.current = axios.post(`${API_URL}/auth/logout`, {}, { timeout: 10000 })
      .catch(() => { /* El cierre local se conserva aunque el servidor no responda. */ })
      .finally(() => { logoutRequestRef.current = null; });
    return logoutRequestRef.current;
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, changePassword, refreshUser, loading, sessionError, retrySession: checkSession, getSessionGuard }}>
      {children}
    </AuthContext.Provider>
  );
};
