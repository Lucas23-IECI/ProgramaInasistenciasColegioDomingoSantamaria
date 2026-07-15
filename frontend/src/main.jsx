import { StrictMode, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import { AuthProvider, AuthContext } from './context/AuthContext'
import { ThemeProvider, ThemeContext } from './context/ThemeContext'
import { Sun, Moon } from 'lucide-react'
import App from './App.jsx'
import Students from './Students.jsx'
import Login from './Login.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import AdminHub from './AdminHub.jsx'
import UsuariosAdmin from './UsuariosAdmin.jsx'
import AuditoriaAdmin from './AuditoriaAdmin.jsx'
import AnaliticasAdmin from './AnaliticasAdmin.jsx'
import InasistenciasAdmin from './InasistenciasAdmin.jsx'

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.rol)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const RoleBasedHome = () => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  
  if (user.rol === 'admin' || user.rol === 'secretaria') {
      return <Navigate to="/admin" />;
  }
  return <App />;
}

const ThemeToggler = () => {
  const { theme, toggleTheme } = useContext(ThemeContext);
  return (
    <button onClick={toggleTheme} className="theme-toggle-btn-floating" title={theme === 'light' ? 'Modo Oscuro' : 'Modo Claro'}>
      {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
    </button>
  );
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <ThemeToggler />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RoleBasedHome />} />
            
            {/* Lector Only (Opcional admin test) */}
            <Route path="/scanner" element={<ProtectedRoute allowedRoles={['lector', 'admin']}><App /></ProtectedRoute>} />
            
            {/* Admin Tree */}
            <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><AdminHub /></ProtectedRoute>} />
            <Route path="/admin/alimentacion" element={<Navigate to="/admin/atrasos" replace />} />
            <Route path="/admin/atrasos" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/inasistencias" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><InasistenciasAdmin /></ProtectedRoute>} />
            <Route path="/admin/estudiantes" element={<ProtectedRoute allowedRoles={['admin']}><Students /></ProtectedRoute>} />
            <Route path="/admin/usuarios" element={<ProtectedRoute allowedRoles={['admin']}><UsuariosAdmin /></ProtectedRoute>} />
            <Route path="/admin/auditoria" element={<ProtectedRoute allowedRoles={['admin']}><AuditoriaAdmin /></ProtectedRoute>} />
            <Route path="/admin/analiticas" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><AnaliticasAdmin /></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
)
