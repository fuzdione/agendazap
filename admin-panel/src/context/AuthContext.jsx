import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('az_token'));
  const [usuario, setUsuario] = useState(() => {
    const raw = sessionStorage.getItem('az_usuario');
    return raw ? JSON.parse(raw) : null;
  });
  const [clinica, setClinica] = useState(() => {
    const raw = sessionStorage.getItem('az_clinica');
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email, senha) => {
    const { data } = await api.post('/auth/login', { email, senha });
    const { token: tk, usuario: u, clinica: c } = data.data;

    api.defaults.headers.common['Authorization'] = `Bearer ${tk}`;
    sessionStorage.setItem('az_token', tk);
    sessionStorage.setItem('az_usuario', JSON.stringify(u));
    sessionStorage.setItem('az_clinica', JSON.stringify(c));

    setToken(tk);
    setUsuario(u);
    setClinica(c);
  }, []);

  const logout = useCallback(() => {
    delete api.defaults.headers.common['Authorization'];
    sessionStorage.removeItem('az_token');
    sessionStorage.removeItem('az_usuario');
    sessionStorage.removeItem('az_clinica');
    setToken(null);
    setUsuario(null);
    setClinica(null);
  }, []);

  // Restaura o header Authorization ao montar (ex: refresh de página)
  if (token && !api.defaults.headers.common['Authorization']) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  return (
    <AuthContext.Provider value={{ token, usuario, clinica, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
