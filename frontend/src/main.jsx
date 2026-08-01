import { lazy, StrictMode, Suspense, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import './index.css'
import './styles/institutional.css'
import './styles/design-system.css'
import './styles/punctuality.css'
import './styles/release-notes.css'
import './styles/visits.css'
import './styles/operations.css'
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
import { ADMIN_MODULE_PERMISSIONS, PERMISSIONS, hasAnyPermission, hasPermission } from './permissions'
import { ReleaseNotesProvider } from './context/ReleaseNotesContext.jsx'

const Students = lazy(() => import('./Students.jsx'))
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'))
const UsuariosAdmin = lazy(() => import('./UsuariosAdmin.jsx'))
const AuditoriaAdmin = lazy(() => import('./AuditoriaAdmin.jsx'))
const AnaliticasAdmin = lazy(() => import('./AnaliticasAdmin.jsx'))
const ChangePassword = lazy(() => import('./ChangePassword.jsx'))
const PunctualitySettings = lazy(() => import('./PunctualitySettings.jsx'))
const VisitsAdmin = lazy(() => import('./VisitsAdmin.jsx'))
const OperationalInbox = lazy(() => import('./OperationalInbox.jsx'))
const VisitSettingsAdmin = lazy(() => import('./VisitSettingsAdmin.jsx'))
const FamilyDirectory = lazy(() => import('./FamilyDirectory.jsx'))
const DataGovernanceAdmin = lazy(() => import('./DataGovernanceAdmin.jsx'))

const ProtectedRoute = ({ children, permission, anyPermissions }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.debe_cambiar_password) return <Navigate to="/cambiar-clave" replace />;
  if (permission && !hasPermission(user, permission)) {
    return <Navigate to="/" replace />;
  }
  if (anyPermissions && !hasAnyPermission(user, anyPermissions)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const ProtectedPasswordRoute = ({ children }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const RoleBasedHome = () => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (!user) return <Navigate to="/login" />;
  if (user.debe_cambiar_password) return <Navigate to="/cambiar-clave" replace />;

  if (hasAnyPermission(user, ADMIN_MODULE_PERMISSIONS)) {
      return <Navigate to="/admin" />;
  }
  if (hasPermission(user, PERMISSIONS.PUNCTUALITY_REGISTER)) return <App />;
  return <Navigate to="/login" replace />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <FeedbackProvider>
            <BrowserRouter>
          <HelpTourProvider>
          <ReleaseNotesProvider>
          <ScrollToTop />
          <GlobalTools />
          <Suspense fallback={<div className="route-loader" role="status">Cargando módulo…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cambiar-clave" element={<ProtectedPasswordRoute><ChangePassword /></ProtectedPasswordRoute>} />
            <Route path="/" element={<RoleBasedHome />} />

            {/* Lector Only (Opcional admin test) */}
            <Route path="/scanner" element={<ProtectedRoute permission={PERMISSIONS.PUNCTUALITY_REGISTER}><App /></ProtectedRoute>} />

            {/* Admin Tree */}
            <Route path="/admin" element={<ProtectedRoute anyPermissions={ADMIN_MODULE_PERMISSIONS}><AdminHub /></ProtectedRoute>} />
            <Route path="/admin/atrasos" element={<ProtectedRoute permission={PERMISSIONS.PUNCTUALITY_VIEW}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/inasistencias" element={<Navigate to="/admin/atrasos" replace />} />
            <Route path="/admin/estudiantes" element={<ProtectedRoute anyPermissions={[PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_MANAGE, PERMISSIONS.STUDENTS_IMPORT, PERMISSIONS.WITHDRAWALS_IMPORT_GUARDIANS]}><Students /></ProtectedRoute>} />
            <Route path="/admin/usuarios" element={<ProtectedRoute permission={PERMISSIONS.USERS_MANAGE}><UsuariosAdmin /></ProtectedRoute>} />
            <Route path="/admin/usuarios/:profileCode" element={<ProtectedRoute permission={PERMISSIONS.USERS_MANAGE}><UsuariosAdmin /></ProtectedRoute>} />
            <Route path="/admin/auditoria" element={<ProtectedRoute permission={PERMISSIONS.AUDIT_VIEW}><AuditoriaAdmin /></ProtectedRoute>} />
            <Route path="/admin/analiticas" element={<ProtectedRoute permission={PERMISSIONS.ANALYTICS_VIEW}><AnaliticasAdmin /></ProtectedRoute>} />
            <Route path="/admin/configuracion" element={<ProtectedRoute anyPermissions={[PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.PUNCTUALITY_CONTROLS_MANAGE]}><PunctualitySettings /></ProtectedRoute>} />
            <Route path="/admin/visitas" element={<ProtectedRoute anyPermissions={[
              PERMISSIONS.VISITS_VIEW,
              PERMISSIONS.VISITS_REGISTER,
              PERMISSIONS.VISITS_CHECKOUT,
              PERMISSIONS.VISITS_HISTORY,
              PERMISSIONS.WITHDRAWALS_REGISTER,
              PERMISSIONS.WITHDRAWALS_APPROVE,
              PERMISSIONS.WITHDRAWALS_AUTHORIZATIONS,
              PERMISSIONS.VISITS_REPORTS,
            ]}><VisitsAdmin /></ProtectedRoute>} />
            <Route path="/admin/operacion" element={<ProtectedRoute permission={PERMISSIONS.OPERATIONS_VIEW}><OperationalInbox /></ProtectedRoute>} />
            <Route path="/admin/visitas/configuracion" element={<ProtectedRoute permission={PERMISSIONS.VISITS_SETTINGS}><VisitSettingsAdmin /></ProtectedRoute>} />
            <Route path="/admin/familias" element={<ProtectedRoute permission={PERMISSIONS.FAMILY_MANAGE}><FamilyDirectory /></ProtectedRoute>} />
            <Route path="/admin/gobierno-datos" element={<ProtectedRoute permission={PERMISSIONS.SETTINGS_MANAGE}><DataGovernanceAdmin /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ReleaseNotesProvider>
          </HelpTourProvider>
            </BrowserRouter>
          </FeedbackProvider>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>
)
