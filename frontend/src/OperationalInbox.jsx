import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  DoorOpen,
  GraduationCap,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { useFeedback } from './context/FeedbackContext';

const API_URL = '/api';

const TASK_DEFINITIONS = [
  {
    key: 'visits',
    label: 'Visitas aún dentro',
    description: 'Personas que requieren registrar salida.',
    icon: DoorOpen,
    path: '/admin/visitas?tab=presentes',
    blocking: true
  },
  {
    key: 'requested_withdrawals',
    label: 'Retiros por decidir',
    description: 'Solicitudes pendientes de revisión.',
    icon: ShieldCheck,
    path: '/admin/visitas?tab=retiros',
    blocking: true
  },
  {
    key: 'authorized_withdrawals',
    label: 'Retiros por entregar',
    description: 'Autorizados que aún no registran entrega.',
    icon: UserCheck,
    path: '/admin/visitas?tab=retiros',
    blocking: true
  },
  {
    key: 'unenrolled_students',
    label: 'Estudiantes sin matrícula',
    description: 'Personas activas que no tienen un curso vigente.',
    icon: GraduationCap,
    path: '/admin/estudiantes'
  },
  {
    key: 'manual_students_pending',
    label: 'Altas manuales pendientes',
    description: 'Estudiantes creados localmente que todavía no han sido validados por el ERP.',
    icon: UserCheck,
    path: '/admin/estudiantes?seccion=governance'
  },
  {
    key: 'pending_justifications',
    label: 'Atrasos sin justificar',
    description: 'Registros de los últimos siete días.',
    icon: Clock3,
    path: '/admin/atrasos'
  },
  {
    key: 'operational_events',
    label: 'Incidencias operativas',
    description: 'Duplicados, códigos no encontrados o importaciones rechazadas.',
    icon: AlertTriangle
  },
  {
    key: 'blocked_users',
    label: 'Cuentas con bloqueo',
    description: 'Cuentas desactivadas o temporalmente bloqueadas.',
    icon: LockKeyhole,
    path: '/admin/usuarios'
  }
];

const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Sin información';

const OperationalInbox = () => {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [observations, setObservations] = useState('');
  const [resolution, setResolution] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/operaciones/bandeja`);
      setData(response.data);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible cargar la bandeja.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const taskRows = useMemo(() => TASK_DEFINITIONS.map((definition) => ({
    ...definition,
    items: data?.tasks?.[definition.key] || [],
    count: data?.summary?.[definition.key] || 0
  })), [data]);

  const closeDay = async () => {
    setClosing(true);
    try {
      await axios.post(`${API_URL}/operaciones/cierres`, { observations });
      notify('Jornada operacional cerrada correctamente.', 'success');
      setObservations('');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible cerrar la jornada.', 'error');
    } finally {
      setClosing(false);
    }
  };

  const resolveEvent = async () => {
    if (!resolution?.reason?.trim() || resolution.reason.trim().length < 5) {
      notify('Indica un motivo de al menos 5 caracteres.', 'error');
      return;
    }
    try {
      await axios.patch(`${API_URL}/operaciones/eventos/${resolution.id}/resolver`, {
        estado: 'RESUELTO',
        motivo: resolution.reason.trim()
      });
      notify('Incidencia resuelta.', 'success');
      setResolution(null);
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible resolver la incidencia.', 'error');
    }
  };

  return (
    <div className="operations-page">
      <header className="operations-header" data-tour="page-header">
        <div>
          <span className="section-kicker">Operación institucional</span>
          <h1>Tareas por resolver</h1>
          <p>Una sola bandeja para revisar lo que requiere acción antes de terminar la jornada.</p>
        </div>
        <div className="operations-header__actions">
          <button type="button" className="secondary-action" onClick={load} disabled={loading}>
            <RefreshCw size={17} className={loading ? 'spin' : ''} /> Actualizar
          </button>
          <button type="button" className="secondary-action" onClick={() => navigate('/admin')}>
            <ArrowLeft size={17} /> Panel principal
          </button>
        </div>
      </header>

      <main className="operations-content">
        <section className="operations-status" aria-live="polite" data-tour="operations-status">
          <div>
            <span className="section-kicker">Estado actual</span>
            <h2>{loading ? 'Actualizando…' : `${data?.summary?.total || 0} tareas visibles`}</h2>
          </div>
          <div className={`operations-health ${data?.backup?.healthy ? 'is-ok' : 'is-warning'}`}>
            <ArchiveRestore size={22} />
            <div>
              <strong>{data?.backup?.healthy ? 'Respaldo vigente' : 'Respaldo por revisar'}</strong>
              <span>{data?.backup?.completed_at ? formatDateTime(data.backup.completed_at) : 'No se pudo leer el último respaldo'}</span>
            </div>
          </div>
        </section>

        <section className="operations-list" aria-label="Pendientes operativos" data-tour="operations-list">
          {taskRows.map((task) => (
            <article className={`operations-row${task.blocking && task.count ? ' is-blocking' : ''}`} key={task.key}>
              <div className="operations-row__icon"><task.icon size={23} /></div>
              <div className="operations-row__copy">
                <strong>{task.label}</strong>
                <span>{task.description}</span>
                {task.key === 'operational_events' && task.items.slice(0, 3).map((event) => (
                  <button
                    type="button"
                    className="operations-event"
                    key={event.id}
                    onClick={() => setResolution({ id: event.id, reason: '' })}
                  >
                    {event.tipo.replaceAll('_', ' ').toLowerCase()} · {formatDateTime(event.ocurrido_en)}
                  </button>
                ))}
              </div>
              <strong className="operations-row__count">{task.count}</strong>
              {task.path && (
                <button type="button" className="operations-row__action" onClick={() => navigate(task.path)}>
                  Revisar
                </button>
              )}
            </article>
          ))}
        </section>

        <section className="operations-close" data-tour="operations-close">
          <div>
            <span className="section-kicker">Cierre diario de visitas y retiros</span>
            <h2>Cerrar jornada operacional</h2>
            <p>Este cierre no calcula asistencia. Solo confirma que no quedan visitas ni retiros abiertos.</p>
          </div>
          <label>
            Observación opcional
            <textarea
              value={observations}
              onChange={(event) => setObservations(event.target.value)}
              maxLength={1000}
              placeholder="Novedades del cierre o constancia del turno"
            />
          </label>
          <button
            type="button"
            className="primary-action"
            onClick={closeDay}
            disabled={closing || loading || (data?.summary?.blocking || 0) > 0}
          >
            <CheckCircle2 size={18} />
            {closing ? 'Cerrando…' : 'Confirmar cierre operacional'}
          </button>
          {(data?.summary?.blocking || 0) > 0 && (
            <span className="operations-close__notice">
              Resuelve primero {data.summary.blocking} pendiente(s) de visitas o retiros.
            </span>
          )}
        </section>
      </main>

      {resolution && (
        <div className="institutional-modal-backdrop" role="presentation">
          <section className="institutional-modal operations-resolution" role="dialog" aria-modal="true" aria-labelledby="resolution-title">
            <h2 id="resolution-title">Resolver incidencia</h2>
            <p>La incidencia seguirá existiendo en el historial con la persona y el motivo de resolución.</p>
            <label>
              Motivo de resolución
              <textarea
                autoFocus
                value={resolution.reason}
                onChange={(event) => setResolution({ ...resolution, reason: event.target.value })}
                maxLength={500}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-action" onClick={() => setResolution(null)}>Cancelar</button>
              <button type="button" className="primary-action" onClick={resolveEvent}>Guardar resolución</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default OperationalInbox;
