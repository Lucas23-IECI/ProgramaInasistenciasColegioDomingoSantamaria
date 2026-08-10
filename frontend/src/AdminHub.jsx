import React, { useContext } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  BarChart2,
  ClipboardList,
  Clock3,
  LogOut,
  Settings2,
  ScanLine,
  ContactRound,
  BookUser,
  ListChecks,
  DatabaseZap,
  UserCog,
  Users,
  ShieldCheck,
  FolderArchive,
  BriefcaseBusiness,
  MessagesSquare,
} from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import InstitutionalMark from './components/InstitutionalMark';
import DevelopmentBadge from './components/DevelopmentBadge';
import { PERMISSIONS, hasAnyPermission, roleLabel } from './permissions';

const ALL_MODULES = [
  {
    key: 'operacion',
    icon: ListChecks,
    section: 'recepcion',
    category: 'Seguimiento diario',
    title: 'Tareas por resolver',
    description: 'Reúne visitas abiertas, retiros pendientes, incidencias y estado del respaldo.',
    path: '/admin/operacion',
    tone: 'blue',
    permissions: [PERMISSIONS.OPERATIONS_VIEW],
  },
  {
    key: 'visitas',
    icon: ContactRound,
    section: 'recepcion',
    category: 'Personas externas',
    title: 'Control de visitas y retiros',
    description: 'Registra visitas, salidas y solicitudes de retiro de estudiantes con trazabilidad.',
    path: '/admin/visitas',
    tone: 'ochre',
    permissions: [
      PERMISSIONS.VISITS_VIEW,
      PERMISSIONS.VISITS_REGISTER,
      PERMISSIONS.VISITS_CHECKOUT,
      PERMISSIONS.VISITS_MANAGE,
      PERMISSIONS.VISITS_HISTORY,
      PERMISSIONS.VISITS_REPORTS,
      PERMISSIONS.VISITS_SETTINGS,
      PERMISSIONS.WITHDRAWALS_REGISTER,
      PERMISSIONS.WITHDRAWALS_APPROVE,
      PERMISSIONS.WITHDRAWALS_AUTHORIZATIONS,
      PERMISSIONS.WITHDRAWALS_IMPORT_GUARDIANS,
    ],
  },
  {
    key: 'atrasos',
    icon: Clock3,
    section: 'puntualidad',
    category: 'Puntualidad',
    title: 'Control de atrasos',
    description: 'Registro diario, seguimiento de puntualidad y reportes por período.',
    path: '/admin/atrasos',
    tone: 'blue',
    permissions: [PERMISSIONS.PUNCTUALITY_VIEW],
  },
  {
    key: 'analiticas',
    icon: BarChart2,
    section: 'puntualidad',
    category: 'Información',
    title: 'Estadísticas',
    description: 'Indicadores de atrasos y puntualidad desglosados por curso.',
    path: '/admin/analiticas',
    tone: 'green',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
  },
  {
    key: 'estudiantes',
    icon: Users,
    section: 'comunidad',
    category: 'Comunidad',
    title: 'Personas y cursos',
    description: 'Padrón institucional, importaciones y asignación de matrículas.',
    path: '/admin/estudiantes',
    tone: 'navy',
    permissions: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_MANAGE, PERMISSIONS.STUDENTS_IMPORT, PERMISSIONS.STUDENTS_IDENTITY_REGULARIZE, PERMISSIONS.WITHDRAWALS_IMPORT_GUARDIANS],
  },
  {
    key: 'directorio',
    icon: BookUser,
    section: 'comunidad',
    category: 'Equipo institucional',
    title: 'Directorio interno',
    description: 'Perfiles, cargos, ubicaciones y disponibilidad del personal autorizado.',
    path: '/directorio',
    tone: 'navy',
    permissions: [PERMISSIONS.PROFILES_DIRECTORY_VIEW],
  },
  {
    key: 'seguimiento',
    development: true,
    icon: BriefcaseBusiness,
    section: 'bienestar',
    category: 'Gestión preventiva',
    title: 'Seguimiento institucional',
    description: 'Casos, responsables, contactos, acuerdos, tareas y derivaciones coordinadas.',
    path: '/admin/seguimiento',
    tone: 'blue',
    permissions: [
      PERMISSIONS.FOLLOW_UP_VIEW,
      PERMISSIONS.FOLLOW_UP_CREATE,
      PERMISSIONS.FOLLOW_UP_MANAGE,
      PERMISSIONS.FOLLOW_UP_CONTACTS,
    ],
  },
  {
    key: 'convivencia',
    development: true,
    icon: ShieldCheck,
    section: 'bienestar',
    category: 'Proteccion y bienestar',
    title: 'Convivencia escolar',
    description: 'Gestión reservada de situaciones, medidas, acuerdos y seguimientos.',
    path: '/admin/convivencia',
    tone: 'red',
    permissions: [
      PERMISSIONS.COEXISTENCE_VIEW,
      PERMISSIONS.COEXISTENCE_CREATE,
      PERMISSIONS.COEXISTENCE_MANAGE,
      PERMISSIONS.COEXISTENCE_DOCUMENTS,
      PERMISSIONS.COEXISTENCE_CLOSE,
    ],
  },
  {
    key: 'chat',
    development: true,
    icon: MessagesSquare,
    section: 'comunicacion',
    category: 'Comunicación segura',
    title: 'Chat interno',
    description: 'Conversaciones directas, grupos y canales vinculados al trabajo institucional.',
    path: '/chat',
    tone: 'green',
    permissions: [PERMISSIONS.CHAT_ACCESS],
  },
  {
    key: 'documentos',
    development: true,
    icon: FolderArchive,
    section: 'documentacion',
    category: 'Expediente estudiantil',
    title: 'Gestión documental',
    description: 'Certificados, autorizaciones, vigencias, versiones, firmas internas y OCR revisable.',
    path: '/admin/documentos',
    tone: 'purple',
    permissions: [
      PERMISSIONS.DOCUMENTS_VIEW,
      PERMISSIONS.DOCUMENTS_UPLOAD,
      PERMISSIONS.DOCUMENTS_MANAGE,
      PERMISSIONS.DOCUMENTS_SIGN,
      PERMISSIONS.DOCUMENTS_TEMPLATES,
      PERMISSIONS.DOCUMENTS_OCR,
    ],
  },
  {
    key: 'usuarios',
    icon: UserCog,
    section: 'administracion',
    category: 'Administración',
    title: 'Usuarios y permisos',
    description: 'Cuentas de acceso, perfiles y permisos administrativos.',
    path: '/admin/usuarios',
    tone: 'ochre',
    permissions: [PERMISSIONS.USERS_MANAGE],
  },
  {
    key: 'configuracion',
    icon: Settings2,
    section: 'puntualidad',
    category: 'Operación',
    title: 'Controles de puntualidad',
    description: 'Ingreso, recreos, almuerzo y otros hitos de la jornada.',
    path: '/admin/configuracion',
    tone: 'slate',
    permissions: [PERMISSIONS.SETTINGS_MANAGE],
  },
  {
    key: 'auditoria',
    icon: ClipboardList,
    section: 'administracion',
    category: 'Seguridad',
    title: 'Auditoría',
    description: 'Trazabilidad de accesos, cambios, registros e importaciones.',
    path: '/admin/auditoria',
    tone: 'slate',
    permissions: [PERMISSIONS.AUDIT_VIEW],
  },
  {
    key: 'gobierno-datos',
    icon: DatabaseZap,
    section: 'administracion',
    category: 'Privacidad',
    title: 'Gobierno de datos',
    description: 'Documenta períodos de retención y previsualiza su alcance sin eliminar información.',
    path: '/admin/gobierno-datos',
    tone: 'slate',
    permissions: [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.PUNCTUALITY_CONTROLS_MANAGE],
  },
  {
    key: 'terminal',
    icon: ScanLine,
    section: 'recepcion',
    category: 'Ingreso de estudiantes',
    title: 'Registro de estudiantes',
    description: 'Escanea el carnet o busca por nombre y RUT para registrar la hora de llegada.',
    path: '/scanner',
    tone: 'green',
    permissions: [PERMISSIONS.PUNCTUALITY_REGISTER],
  },
];

const MODULE_SECTIONS = [
  {
    key: 'recepcion',
    title: 'Acceso y recepción',
    description: 'Movimientos de estudiantes y personas externas en la entrada del establecimiento.'
  },
  {
    key: 'puntualidad',
    title: 'Puntualidad',
    description: 'Registro diario, seguimiento, indicadores y parámetros del control de atrasos.'
  },
  {
    key: 'comunidad',
    title: 'Comunidad educativa',
    description: 'Nómina escolar, cursos, matrículas y fichas de apoderados.'
  },
  {
    key: 'bienestar',
    title: 'Proteccion y bienestar',
    description: 'Casos reservados, medidas institucionales y seguimiento de convivencia escolar.'
  },
  {
    key: 'comunicacion',
    title: 'Coordinación interna',
    description: 'Comunicación institucional conectada con las tareas y los casos del establecimiento.'
  },
  {
    key: 'documentacion',
    title: 'Documentación estudiantil',
    description: 'Expedientes protegidos, vigencias, versiones y documentos institucionales.'
  },
  {
    key: 'administracion',
    title: 'Administración y seguridad',
    description: 'Cuentas, permisos y trazabilidad de operaciones sensibles.'
  }
];

const formatCurrentDate = () => new Intl.DateTimeFormat('es-CL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date());

const AdminHub = () => {
  const navigate = useNavigate();
  const { logout, user } = useContext(AuthContext);
  const isReader = user?.rol === 'lector';
  const modules = ALL_MODULES
    .filter((module) => hasAnyPermission(user, module.permissions))
    .filter((module) => !isReader || ['terminal', 'visitas'].includes(module.key))
    .sort((a, b) => {
      if (!isReader) return 0;
      const order = { terminal: 0, visitas: 1 };
      return (order[a.key] ?? 99) - (order[b.key] ?? 99);
    });
  const visibleSections = MODULE_SECTIONS
    .map((section) => ({
      ...section,
      modules: modules.filter((module) => module.section === section.key)
    }))
    .filter((section) => section.modules.length > 0);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`hub-page${isReader ? ' hub-page--reader' : ''}`}>
      <main className="hub-card">
        <header className="hub-header">
          <InstitutionalMark />
          <div className="hub-header__product">
            <span>Sistema institucional</span>
            <strong>Gestión escolar</strong>
          </div>
          <div className="hub-user">
            <div className="hub-user__identity">
              <span>{user?.profile_name || roleLabel(user?.rol)}</span>
              <strong>{user?.nombre || user?.correo}</strong>
            </div>
            <button className="hub-logout" onClick={handleLogout} title="Cerrar sesión">
              <LogOut size={17} /> <span>Cerrar sesión</span>
            </button>
          </div>
        </header>

        <section className="hub-intro hub-intro--campus" aria-label="Fachada del Liceo Domingo Santa María de Concepción" data-tour="hub-intro">
          <div className="hub-intro__content">
            <span className="section-kicker">Panel principal</span>
            <h1 className="hub-title">{isReader ? 'Puesto de Portería' : 'Gestión institucional'}</h1>
            <p className="hub-date">{formatCurrentDate()}</p>
            <span className="hub-campus-label">Santa María 2350 · Concepción</span>
          </div>
          <div className="hub-summary">
            <strong>{modules.length}</strong>
            <span>módulos habilitados<br />para tu perfil</span>
          </div>
        </section>

        <section className="hub-modules" aria-labelledby="modules-title" data-tour="hub-modules">
          <div className="hub-section-heading">
            <h2 id="modules-title">{isReader ? '¿Qué necesitas registrar?' : 'Módulos de trabajo'}</h2>
            <span>{isReader ? 'Elige una de las dos tareas disponibles' : 'Selecciona una sección para continuar'}</span>
          </div>
          <div className="hub-domains">
            {visibleSections.map((section) => (
              <section className="hub-domain" key={section.key}>
                <header>
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                </header>
                <div className="hub-grid">
                  {section.modules.map((module) => (
                    <button
                      key={module.key}
                      className="hub-module"
                      data-tone={module.tone}
                      onClick={() => navigate(module.path)}
                    >
                      <div className="hub-module-icon"><module.icon size={22} /></div>
                      <span className="hub-module-category-row">
                        <span className="hub-module-category">{module.category}</span>
                        {module.development && <DevelopmentBadge compact />}
                      </span>
                      <h3 className="hub-module-title">{module.title}</h3>
                      <p className="hub-module-desc">{module.description}</p>
                      <span className="hub-module-go">Ingresar <ArrowRight size={16} /></span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <footer className="hub-footer">
          <span className="hub-footer__status"><i /> Servicios operativos</span>
          <span>Liceo Domingo Santa María · RBD 4565-9 · Concepción</span>
          <span className="hub-footer__branding">
            © 2026 Todos los derechos reservados. Desarrollado por{' '}
            <a href="https://purocode.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
              PuroCode
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
};

export default AdminHub;
