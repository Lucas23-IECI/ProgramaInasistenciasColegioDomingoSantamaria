import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart2,
  ClipboardList,
  Clock3,
  LogOut,
  Settings2,
  UserCog,
  Users,
} from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import InstitutionalMark from './components/InstitutionalMark';

const ALL_MODULES = [
  {
    key: 'atrasos',
    icon: Clock3,
    category: 'Puntualidad',
    title: 'Control de atrasos',
    description: 'Registro diario, seguimiento de puntualidad y reportes por período.',
    path: '/admin/atrasos',
    tone: 'blue',
    roles: ['admin', 'secretaria'],
  },
  {
    key: 'analiticas',
    icon: BarChart2,
    category: 'Información',
    title: 'Estadísticas',
    description: 'Indicadores de atrasos y puntualidad desglosados por curso.',
    path: '/admin/analiticas',
    tone: 'green',
    roles: ['admin', 'secretaria'],
  },
  {
    key: 'estudiantes',
    icon: Users,
    category: 'Comunidad',
    title: 'Personas y cursos',
    description: 'Padrón institucional, importaciones y asignación de matrículas.',
    path: '/admin/estudiantes',
    tone: 'navy',
    roles: ['admin'],
  },
  {
    key: 'usuarios',
    icon: UserCog,
    category: 'Administración',
    title: 'Usuarios y permisos',
    description: 'Cuentas de acceso, perfiles y permisos administrativos.',
    path: '/admin/usuarios',
    tone: 'ochre',
    roles: ['admin'],
  },
  {
    key: 'configuracion',
    icon: Settings2,
    category: 'Operación',
    title: 'Configuración de jornada',
    description: 'Horarios, severidad y umbrales preventivos de atrasos.',
    path: '/admin/configuracion',
    tone: 'slate',
    roles: ['admin'],
  },
  {
    key: 'auditoria',
    icon: ClipboardList,
    category: 'Seguridad',
    title: 'Auditoría',
    description: 'Trazabilidad de accesos, cambios, registros e importaciones.',
    path: '/admin/auditoria',
    tone: 'slate',
    roles: ['admin'],
  },
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
  const modules = ALL_MODULES.filter((module) => module.roles.includes(user?.rol));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="hub-page">
      <main className="hub-card">
        <header className="hub-header">
          <InstitutionalMark />
          <div className="hub-header__product">
            <span>Sistema institucional</span>
            <strong>Gestión de puntualidad</strong>
          </div>
          <div className="hub-user">
            <div className="hub-user__identity">
              <span>{user?.rol === 'admin' ? 'Administrador' : 'Secretaría'}</span>
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
            <h1 className="hub-title">Gestión institucional</h1>
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
            <h2 id="modules-title">Módulos de trabajo</h2>
            <span>Selecciona una sección para continuar</span>
          </div>
          <div className="hub-grid">
            {modules.map((module) => (
              <button
                key={module.key}
                className="hub-module"
                data-tone={module.tone}
                onClick={() => navigate(module.path)}
              >
                <div className="hub-module-icon"><module.icon size={22} /></div>
                <span className="hub-module-category">{module.category}</span>
                <h3 className="hub-module-title">{module.title}</h3>
                <p className="hub-module-desc">{module.description}</p>
                <span className="hub-module-go">Ingresar <ArrowRight size={16} /></span>
              </button>
            ))}
          </div>
        </section>

        <footer className="hub-footer">
          <span className="hub-footer__status"><i /> Servicios operativos</span>
          <span>Liceo Domingo Santa María · RBD 4565-9 · Concepción</span>
        </footer>
      </main>
    </div>
  );
};

export default AdminHub;
