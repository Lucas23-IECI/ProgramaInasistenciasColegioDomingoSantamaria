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
import './styles/staff-profiles.css'
import './styles/coexistence.css'
import './styles/student-documents.css'
import './styles/institutional-analytics.css'
import './styles/pwa-experience.css'
import './styles/follow-up.css'
import './styles/internal-chat.css'
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
import { installChunkRecovery, recoverFromStaleChunk } from './utils/chunkRecovery.js'
import { registerServiceWorker } from './pwa/registerServiceWorker.js'
import { PwaProvider } from './context/PwaContext.jsx'

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
          <PwaProvider>
          <HelpTourProvider>
          <ReleaseNotesProvider>
          <ScrollToTop />
          <GlobalTools />
          <Suspense fallback={<div className="route-loader" role="status">Cargando módulo…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cambiar-clave" element={<ProtectedPasswordRoute><ChangePassword /></ProtectedPasswordRoute>} />
            <Route path="/mi-perfil" element={<ProtectedRoute><StaffProfile /></ProtectedRoute>} />
            <Route path="/directorio" element={<ProtectedRoute permission={PERMISSIONS.PROFILES_DIRECTORY_VIEW}><StaffDirectory /></ProtectedRoute>} />
            <Route path="/directorio/:userId" element={<ProtectedRoute permission={PERMISSIONS.PROFILES_DIRECTORY_VIEW}><StaffProfile directoryMode /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute permission={PERMISSIONS.CHAT_ACCESS}><InternalChat /></ProtectedRoute>} />
            <Route path="/chat/:conversationId" element={<ProtectedRoute permission={PERMISSIONS.CHAT_ACCESS}><InternalChat /></ProtectedRoute>} />
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
            <Route path="/admin/analiticas" element={<ProtectedRoute anyPermissions={[PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_INSTITUTIONAL_VIEW]}><AnaliticasAdmin /></ProtectedRoute>} />
            <Route path="/admin/configuracion" element={<ProtectedRoute anyPermissions={[PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.PUNCTUALITY_CONTROLS_MANAGE, PERMISSIONS.PUNCTUALITY_CALENDAR_MANAGE, PERMISSIONS.PUNCTUALITY_SHIFTS_MANAGE, PERMISSIONS.PUNCTUALITY_EXCEPTIONS_MANAGE, PERMISSIONS.PUNCTUALITY_CONTINGENCIES_MANAGE, PERMISSIONS.PUNCTUALITY_COMMITMENTS_MANAGE, PERMISSIONS.PUNCTUALITY_IMPROVEMENTS_VIEW]}><PunctualitySettings /></ProtectedRoute>} />
            <Route path="/admin/visitas" element={<ProtectedRoute anyPermissions={[
              PERMISSIONS.VISITS_VIEW,
              PERMISSIONS.VISITS_REGISTER,
              PERMISSIONS.VISITS_CHECKOUT,
              PERMISSIONS.VISITS_HISTORY,
              PERMISSIONS.WITHDRAWALS_REGISTER,
              PERMISSIONS.WITHDRAWALS_APPROVE,
              PERMISSIONS.WITHDRAWALS_AUTHORIZATIONS,
              PERMISSIONS.VISITS_REPORTS,
              PERMISSIONS.VISITS_PREREGISTRATIONS_MANAGE,
              PERMISSIONS.VISITS_RESTRICTIONS_MANAGE,
              PERMISSIONS.VISITS_DELIVERIES_MANAGE,
              PERMISSIONS.VISITS_VEHICLES_MANAGE,
              PERMISSIONS.VISITS_EMERGENCY_VIEW,
              PERMISSIONS.VISITS_EMERGENCY_MANAGE,
            ]}><VisitsAdmin /></ProtectedRoute>} />
            <Route path="/admin/operacion" element={<ProtectedRoute permission={PERMISSIONS.OPERATIONS_VIEW}><OperationalInbox /></ProtectedRoute>} />
            <Route path="/admin/visitas/configuracion" element={<ProtectedRoute permission={PERMISSIONS.VISITS_SETTINGS}><VisitSettingsAdmin /></ProtectedRoute>} />
            <Route path="/admin/familias" element={<ProtectedRoute permission={PERMISSIONS.FAMILY_MANAGE}><FamilyDirectory /></ProtectedRoute>} />
            <Route path="/admin/gobierno-datos" element={<ProtectedRoute permission={PERMISSIONS.SETTINGS_MANAGE}><DataGovernanceAdmin /></ProtectedRoute>} />
            <Route path="/admin/convivencia" element={<ProtectedRoute permission={PERMISSIONS.COEXISTENCE_VIEW}><SchoolCoexistence /></ProtectedRoute>} />
            <Route path="/admin/convivencia/:caseId" element={<ProtectedRoute permission={PERMISSIONS.COEXISTENCE_VIEW}><SchoolCoexistence /></ProtectedRoute>} />
            <Route path="/admin/documentos" element={<ProtectedRoute permission={PERMISSIONS.DOCUMENTS_VIEW}><StudentDocuments /></ProtectedRoute>} />
            <Route path="/admin/documentos/estudiante/:studentId" element={<ProtectedRoute permission={PERMISSIONS.DOCUMENTS_VIEW}><StudentDocuments /></ProtectedRoute>} />
            <Route path="/admin/documentos/ficha/:documentId" element={<ProtectedRoute permission={PERMISSIONS.DOCUMENTS_VIEW}><StudentDocuments /></ProtectedRoute>} />
            <Route path="/admin/seguimiento" element={<ProtectedRoute permission={PERMISSIONS.FOLLOW_UP_VIEW}><InstitutionalFollowUp /></ProtectedRoute>} />
            <Route path="/admin/seguimiento/:caseId" element={<ProtectedRoute permission={PERMISSIONS.FOLLOW_UP_VIEW}><InstitutionalFollowUp /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
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
