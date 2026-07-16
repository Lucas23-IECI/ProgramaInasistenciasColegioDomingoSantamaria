import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Establece que Axios incluya siempre las cookies HttpOnly
axios.defaults.withCredentials = true;

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const requestUrl = error.config?.url || '';
        if (error.response?.status === 401 && !requestUrl.endsWith('/auth/login')) {
          setUser(null);
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  useEffect(() => {
    // Intentar restaurar la sesión desde el backend a través de la cookie HttpOnly
    const checkSession = async () => {
      try {
        const res = await axios.get(`${API_URL}/auth/me`);
        setUser(res.data.user);
      } catch {
        setUser(null); // No hay cookie válida
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const login = async (correo, password) => {
    const res = await axios.post(`${API_URL}/auth/login`, { correo, password });
    setUser(res.data.user);
    return true;
  };

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`);
    } catch {
      // La sesión local se limpia incluso si el backend no está disponible.
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
