import { lazy, StrictMode, Suspense, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import './styles/institutional.css'
import './styles/design-system.css'
import { AuthProvider, AuthContext } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import App from './App.jsx'
import Login from './Login.jsx'
import AdminHub from './AdminHub.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import NotFound from './components/NotFound.jsx'
import { FeedbackProvider } from './context/FeedbackContext.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import GlobalTools from './components/GlobalTools.jsx'
import { HelpTourProvider } from './context/HelpTourContext.jsx'

const Students = lazy(() => import('./Students.jsx'))
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'))
const UsuariosAdmin = lazy(() => import('./UsuariosAdmin.jsx'))
const AuditoriaAdmin = lazy(() => import('./AuditoriaAdmin.jsx'))
const AnaliticasAdmin = lazy(() => import('./AnaliticasAdmin.jsx'))
const InasistenciasAdmin = lazy(() => import('./InasistenciasAdmin.jsx'))

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.rol)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const RoleBasedHome = () => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (!user) return <Navigate to="/login" />;

  if (user.rol === 'admin' || user.rol === 'secretaria') {
      return <Navigate to="/admin" />;
  }
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <FeedbackProvider>
            <BrowserRouter>
          <HelpTourProvider>
          <ScrollToTop />
          <GlobalTools />
          <Suspense fallback={<div className="route-loader" role="status">Cargando módulo…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RoleBasedHome />} />

            {/* Lector Only (Opcional admin test) */}
            <Route path="/scanner" element={<ProtectedRoute allowedRoles={['lector', 'admin']}><App /></ProtectedRoute>} />

            {/* Admin Tree */}
            <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><AdminHub /></ProtectedRoute>} />
            <Route path="/admin/atrasos" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/inasistencias" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><InasistenciasAdmin /></ProtectedRoute>} />
            <Route path="/admin/estudiantes" element={<ProtectedRoute allowedRoles={['admin']}><Students /></ProtectedRoute>} />
            <Route path="/admin/usuarios" element={<ProtectedRoute allowedRoles={['admin']}><UsuariosAdmin /></ProtectedRoute>} />
            <Route path="/admin/auditoria" element={<ProtectedRoute allowedRoles={['admin']}><AuditoriaAdmin /></ProtectedRoute>} />
            <Route path="/admin/analiticas" element={<ProtectedRoute allowedRoles={['admin', 'secretaria']}><AnaliticasAdmin /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </HelpTourProvider>
            </BrowserRouter>
          </FeedbackProvider>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>
)
