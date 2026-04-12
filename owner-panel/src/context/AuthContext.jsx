import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('ownerToken'));
  const [usuario, setUsuario] = useState(() => {
    const raw = sessionStorage.getItem('ownerUsuario');
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email, senha) => {
    const { data } = await api.post('/owner/auth/login', { email, senha });
    const { token: tk, usuario: u } = data.data;

    api.defaults.headers.common['Authorization'] = `Bearer ${tk}`;
    sessionStorage.setItem('ownerToken', tk);
    sessionStorage.setItem('ownerUsuario', JSON.stringify(u));

    setToken(tk);
    setUsuario(u);
  }, []);

  const logout = useCallback(() => {
    delete api.defaults.headers.common['Authorization'];
    sessionStorage.removeItem('ownerToken');
    sessionStorage.removeItem('ownerUsuario');
    setToken(null);
    setUsuario(null);
  }, []);

  // Restaura o header Authorization ao montar (ex: refresh de página)
  if (token && !api.defaults.headers.common['Authorization']) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  return (
    <AuthContext.Provider value={{ token, usuario, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
