import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Users, LogOut, ChevronRight, ShieldCheck, UserCog, ClipboardList, Clock, BarChart2 } from 'lucide-react';
import { AuthContext } from './context/AuthContext';

const ALL_MODULES = [
  {
    key: 'atrasos',
    icon: Clock,
    title: 'Control de Atrasos',
    description: 'Registro de atrasos diarios, control de puntualidad y generador de reportes de atraso.',
    path: '/admin/atrasos',
    color: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.08)',
    roles: ['admin', 'secretaria'],
  },
  {
    key: 'inasistencias',
    icon: Calendar,
    title: 'Control de Inasistencias',
    description: 'Control de inasistencias diarias, registro manual de ausencias, licencias médicas y justificaciones.',
    path: '/admin/inasistencias',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.08)',
    roles: ['admin', 'secretaria'],
  },
  {
    key: 'analiticas',
    icon: BarChart2,
    title: 'Estadísticas y Analíticas',
    description: 'Módulo completo de estadísticas del período, gráficos de puntualidad y distribución de atrasos.',
    path: '/admin/analiticas',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.08)',
    roles: ['admin', 'secretaria'],
  },
  {
    key: 'estudiantes',
    icon: Users,
    title: 'Gestor de Roster',
    description: 'Padrón de estudiantes, profesores y directores, con filtros por curso.',
    path: '/admin/estudiantes',
    color: '#7C3AED',
    bg: 'rgba(124, 58, 237, 0.08)',
    roles: ['admin'],
  },
  {
    key: 'usuarios',
    icon: UserCog,
    title: 'Gestión de Usuarios',
    description: 'Crear, editar y eliminar cuentas de acceso al panel administrativo.',
    path: '/admin/usuarios',
    color: '#B45309',
    bg: 'rgba(180, 83, 9, 0.08)',
    roles: ['admin'],
  },
  {
    key: 'auditoria',
    icon: ClipboardList,
    title: 'Auditoría del Sistema',
    description: 'Historial completo de acciones, inicios de sesión, registros e importaciones.',
    path: '/admin/auditoria',
    color: '#475569',
    bg: 'rgba(71, 85, 105, 0.07)',
    roles: ['admin'],
  },
];

const AdminHub = () => {
  const navigate = useNavigate();
  const { logout, user } = useContext(AuthContext);

  const modules = ALL_MODULES.filter(m => m.roles.includes(user?.rol));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="hub-page">
      <div className="hub-card">
        <header className="hub-header">
          <div className="hub-header-left">
            <div className="hub-logo-placeholder" style={{ padding: '8px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px', marginRight: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={32} style={{ color: '#3b82f6' }} />
            </div>
            <div>
              <h1 className="hub-title">Hub Administrativo</h1>
              <p className="hub-welcome">
                Liceo Domingo Santa María &bull; <strong>{user?.nombre || user?.correo}</strong>
              </p>
            </div>
          </div>
        </header>

        <p className="hub-prompt">Selecciona el módulo al que deseas acceder:</p>

        <div className="hub-grid">
          {modules.map((mod) => (
            <button
              key={mod.key}
              className="hub-module"
              onClick={() => navigate(mod.path)}
            >
              <div className="hub-module-icon" style={{ background: mod.bg, color: mod.color }}>
                <mod.icon size={28} />
              </div>
              <h3 className="hub-module-title">{mod.title}</h3>
              <p className="hub-module-desc">{mod.description}</p>
              <span className="hub-module-go" style={{ color: mod.color }}>
                Acceder <ChevronRight size={16} />
              </span>
            </button>
          ))}
          <button className="hub-module hub-module--logout" onClick={handleLogout}>
            <div className="hub-module-icon" style={{ background: 'rgba(239, 68, 68, 0.08)', color: '#EF4444' }}>
              <LogOut size={28} />
            </div>
            <h3 className="hub-module-title">Cerrar sesión</h3>
            <p className="hub-module-desc">Salir del sistema de forma segura.</p>
            <span className="hub-module-go" style={{ color: '#EF4444' }}>
              Salir <ChevronRight size={16} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminHub;
