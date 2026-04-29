import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Agendamentos from './pages/Agendamentos.jsx';
import Profissionais from './pages/Profissionais.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import Conversas from './pages/Conversas.jsx';
import Convenios from './pages/Convenios.jsx';

function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="agendamentos" element={<Agendamentos />} />
        <Route path="profissionais" element={<Profissionais />} />
        <Route path="configuracoes" element={<Configuracoes />} />
        <Route path="conversas" element={<Conversas />} />
        <Route path="convenios" element={<Convenios />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/painel">
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
