import { lazy, StrictMode, Suspense, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import './index.css'
import './styles/institutional.css'
import './styles/design-system.css'
import './styles/punctuality.css'
import './styles/release-notes.css'
import './styles/visits.css'
import './styles/operations.css'
import './styles/staff-profiles.css'
import './styles/coexistence.css'
import './styles/student-documents.css'
import './styles/institutional-analytics.css'
import './styles/pwa-experience.css'
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
import { ADMIN_MODULE_PERMISSIONS, MODULE_ACCESS_PERMISSIONS, PERMISSIONS, hasAnyPermission, hasPermission } from './permissions'
import { ReleaseNotesProvider } from './context/ReleaseNotesContext.jsx'
import { installChunkRecovery, recoverFromStaleChunk } from './utils/chunkRecovery.js'
import { registerServiceWorker } from './pwa/registerServiceWorker.js'
import { PwaProvider } from './context/PwaContext.jsx'
import { buildReturnPath, getSafeReturnPath } from './utils/authNavigation.js'
import { ChatWorkspaceProvider } from './context/ChatWorkspaceContext.jsx'

installChunkRecovery()
registerServiceWorker()

const lazyRoute = (importer) => lazy(async () => {
  try {
    return await importer()
  } catch (error) {
    if (recoverFromStaleChunk(error)) return new Promise(() => {})
    throw error
  }
})

const Students = lazyRoute(() => import('./Students.jsx'))
const AdminDashboard = lazyRoute(() => import('./AdminDashboard.jsx'))
const UsuariosAdmin = lazyRoute(() => import('./UsuariosAdmin.jsx'))
const AuditoriaAdmin = lazyRoute(() => import('./AuditoriaAdmin.jsx'))
const AnaliticasAdmin = lazyRoute(() => import('./AnaliticasAdmin.jsx'))
const ChangePassword = lazyRoute(() => import('./ChangePassword.jsx'))
const PunctualitySettings = lazyRoute(() => import('./PunctualitySettings.jsx'))
const VisitsAdmin = lazyRoute(() => import('./VisitsAdmin.jsx'))
const OperationalInbox = lazyRoute(() => import('./OperationalInbox.jsx'))
const VisitSettingsAdmin = lazyRoute(() => import('./VisitSettingsAdmin.jsx'))
const FamilyDirectory = lazyRoute(() => import('./FamilyDirectory.jsx'))
const DataGovernanceAdmin = lazyRoute(() => import('./DataGovernanceAdmin.jsx'))
const StaffProfile = lazyRoute(() => import('./StaffProfile.jsx'))
const StaffDirectory = lazyRoute(() => import('./StaffDirectory.jsx'))
const SchoolCoexistence = lazyRoute(() => import('./SchoolCoexistence.jsx'))
const StudentDocuments = lazyRoute(() => import('./StudentDocuments.jsx'))
const InstitutionalFollowUp = lazyRoute(() => import('./InstitutionalFollowUp.jsx'))
const InternalChat = lazyRoute(() => import('./InternalChat.jsx'))
const AgendaInternal = lazyRoute(() => import('./AgendaInternal.jsx'))
const InternalResources = lazyRoute(() => import('./InternalResources.jsx'))

const SessionVerificationError = ({ onRetry }) => (
  <main className="session-verification" role="alert">
    <section className="session-verification__card">
      <span className="section-kicker">Conexión temporal</span>
      <h1>No pudimos verificar tu sesión</h1>
      <p>El servidor no respondió correctamente. No cerramos tu sesión ni asumimos que tus credenciales dejaron de ser válidas.</p>
      <button type="button" onClick={onRetry}>Reintentar conexión</button>
    </section>
  </main>
)

const ProtectedRoute = ({ children, permission, anyPermissions }) => {
  const { user, loading, sessionError, retrySession } = useContext(AuthContext);
  const location = useLocation();
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (sessionError) return <SessionVerificationError onRetry={retrySession} />;
  if (!user) return <Navigate to="/login" state={{ returnTo: buildReturnPath(location) }} replace />;
  if (user.debe_cambiar_password) return <Navigate to="/cambiar-clave" state={{ returnTo: buildReturnPath(location) }} replace />;
  if (permission && !hasPermission(user, permission)) {
    return <Navigate to="/" replace />;
  }
  if (anyPermissions && !hasAnyPermission(user, anyPermissions)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const ProtectedPasswordRoute = ({ children }) => {
  const { user, loading, sessionError, retrySession } = useContext(AuthContext);
  const location = useLocation();
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (sessionError) return <SessionVerificationError onRetry={retrySession} />;
  if (!user) return <Navigate to="/login" state={{ returnTo: buildReturnPath(location) }} replace />;
  return children;
};

const PublicLoginRoute = () => {
  const { user, loading, sessionError, retrySession } = useContext(AuthContext);
  const location = useLocation();
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (sessionError) return <SessionVerificationError onRetry={retrySession} />;
  if (user) return <Navigate to={getSafeReturnPath(location.state?.returnTo)} replace />;
  return <Login />;
};

const RoleBasedHome = () => {
  const { user, loading, sessionError, retrySession } = useContext(AuthContext);
  if (loading) return <div className="route-loader" role="status">Verificando sesión…</div>;
  if (sessionError) return <SessionVerificationError onRetry={retrySession} />;
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
          <PwaProvider>
          <HelpTourProvider>
          <ReleaseNotesProvider>
          <ChatWorkspaceProvider>
          <ScrollToTop />
          <GlobalTools />
          <Suspense fallback={<div className="route-loader" role="status">Cargando módulo…</div>}>
          <Routes>
            <Route path="/login" element={<PublicLoginRoute />} />
            <Route path="/cambiar-clave" element={<ProtectedPasswordRoute><ChangePassword /></ProtectedPasswordRoute>} />
            <Route path="/mi-perfil" element={<ProtectedRoute><StaffProfile /></ProtectedRoute>} />
            <Route path="/directorio" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.directory}><StaffDirectory /></ProtectedRoute>} />
            <Route path="/directorio/:userId" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.directory}><StaffProfile directoryMode /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.chat}><InternalChat /></ProtectedRoute>} />
            <Route path="/chat/:conversationId" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.chat}><InternalChat /></ProtectedRoute>} />
            <Route path="/agenda" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.agenda}><AgendaInternal /></ProtectedRoute>} />
            <Route path="/admin/recursos" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.resources}><InternalResources /></ProtectedRoute>} />
            <Route path="/" element={<RoleBasedHome />} />

            {/* Lector Only (Opcional admin test) */}
            <Route path="/scanner" element={<ProtectedRoute permission={PERMISSIONS.PUNCTUALITY_REGISTER}><App /></ProtectedRoute>} />

            {/* Admin Tree */}
            <Route path="/admin" element={<ProtectedRoute anyPermissions={ADMIN_MODULE_PERMISSIONS}><AdminHub /></ProtectedRoute>} />
            <Route path="/admin/atrasos" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.punctuality}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/inasistencias" element={<Navigate to="/admin/atrasos" replace />} />
            <Route path="/admin/estudiantes" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.students}><Students /></ProtectedRoute>} />
            <Route path="/admin/usuarios" element={<ProtectedRoute permission={PERMISSIONS.USERS_MANAGE}><UsuariosAdmin /></ProtectedRoute>} />
            <Route path="/admin/usuarios/:profileCode" element={<ProtectedRoute permission={PERMISSIONS.USERS_MANAGE}><UsuariosAdmin /></ProtectedRoute>} />
            <Route path="/admin/auditoria" element={<ProtectedRoute permission={PERMISSIONS.AUDIT_VIEW}><AuditoriaAdmin /></ProtectedRoute>} />
            <Route path="/admin/analiticas" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.analytics}><AnaliticasAdmin /></ProtectedRoute>} />
            <Route path="/admin/configuracion" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.punctualitySettings}><PunctualitySettings /></ProtectedRoute>} />
            <Route path="/admin/visitas" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.visits}><VisitsAdmin /></ProtectedRoute>} />
            <Route path="/admin/operacion" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.operations}><OperationalInbox /></ProtectedRoute>} />
            <Route path="/admin/visitas/configuracion" element={<ProtectedRoute permission={PERMISSIONS.VISITS_SETTINGS}><VisitSettingsAdmin /></ProtectedRoute>} />
            <Route path="/admin/familias" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.families}><FamilyDirectory /></ProtectedRoute>} />
            <Route path="/admin/gobierno-datos" element={<ProtectedRoute permission={PERMISSIONS.SETTINGS_MANAGE}><DataGovernanceAdmin /></ProtectedRoute>} />
            <Route path="/admin/convivencia" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.coexistence}><SchoolCoexistence /></ProtectedRoute>} />
            <Route path="/admin/convivencia/:caseId" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.coexistence}><SchoolCoexistence /></ProtectedRoute>} />
            <Route path="/admin/documentos" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.documents}><StudentDocuments /></ProtectedRoute>} />
            <Route path="/admin/documentos/estudiante/:studentId" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.documents}><StudentDocuments /></ProtectedRoute>} />
            <Route path="/admin/documentos/ficha/:documentId" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.documents}><StudentDocuments /></ProtectedRoute>} />
            <Route path="/admin/seguimiento" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.followUp}><InstitutionalFollowUp /></ProtectedRoute>} />
            <Route path="/admin/seguimiento/:caseId" element={<ProtectedRoute anyPermissions={MODULE_ACCESS_PERMISSIONS.followUp}><InstitutionalFollowUp /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ChatWorkspaceProvider>
          </ReleaseNotesProvider>
          </HelpTourProvider>
          </PwaProvider>
            </BrowserRouter>
          </FeedbackProvider>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>
)
