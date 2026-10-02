import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock3,
  DoorOpen,
  GraduationCap,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { hasPermission, PERMISSIONS } from './permissions';
import { getApiErrorMessage } from './utils/apiError';

const API_URL = '/api';

const TASK_DEFINITIONS = [
  {
    key: 'internal_tasks',
    label: 'Tareas internas',
    description: 'Compromisos del equipo con responsable, plazo e historial.',
    icon: ClipboardList
  },
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

const formatDate = (value) => {
  if (!value) return 'Sin fecha límite';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return `${day}-${month}-${year}`;
};

const taskStateLabel = (state) => ({
  PENDIENTE: 'Pendiente',
  EN_PROGRESO: 'En curso',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada'
}[state] || state);

const emptyTaskForm = {
  titulo: '',
  detalle: '',
  prioridad: 'MEDIA',
  responsable_usuario_id: '',
  fecha_limite: ''
};

const OperationalInbox = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const canManageTasks = hasPermission(user, PERMISSIONS.OPERATIONS_TASKS_MANAGE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [closing, setClosing] = useState(false);
  const [observations, setObservations] = useState('');
  const [resolution, setResolution] = useState(null);
  const [responsibles, setResponsibles] = useState([]);
  const [responsiblesError, setResponsiblesError] = useState('');
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskDetail, setTaskDetail] = useState(null);
  const [updatingTaskId, setUpdatingTaskId] = useState(null);
  const [resolvingItem, setResolvingItem] = useState(false);
  const dialogRef = useRef(null);
  const dialogBusyRef = useRef(false);
  useEffect(() => { dialogBusyRef.current = resolvingItem || Boolean(updatingTaskId); }, [resolvingItem, updatingTaskId]);

  const updateTaskFormField = (field) => (event) => {
    const { value } = event.currentTarget;
    setTaskForm((current) => ({ ...current, [field]: value }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await axios.get(`${API_URL}/operaciones/bandeja`);
      setData(response.data);
    } catch (error) {
      const message = getApiErrorMessage(error, 'No fue posible cargar la bandeja.');
      setData(null);
      setLoadError(message);
      notify(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const loadResponsibles = useCallback(async () => {
    if (!canManageTasks) return;
    setResponsiblesError('');
    try {
      const response = await axios.get(`${API_URL}/operaciones/tareas/responsables`);
      setResponsibles(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setResponsibles([]);
      setResponsiblesError(getApiErrorMessage(error, 'No fue posible cargar las personas responsables.'));
    }
  }, [canManageTasks]);

  useEffect(() => { loadResponsibles(); }, [loadResponsibles]);

  const taskRows = useMemo(() => TASK_DEFINITIONS.map((definition) => ({
    ...definition,
    items: data?.tasks?.[definition.key] || [],
    count: data?.summary?.[definition.key] || 0
  })), [data]);
  const internalTasks = taskRows.find((task) => task.key === 'internal_tasks');
  const operationalRows = taskRows.filter((task) => task.key !== 'internal_tasks');
  const dialogOpen = Boolean(resolution || taskDetail);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const previousFocus = document.activeElement;
    document.body.classList.add('operations-modal-open');
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector('textarea, button, input, select')?.focus();
    }, 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (dialogBusyRef.current) return;
        setResolution(null);
        setTaskDetail(null);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('operations-modal-open');
      previousFocus?.focus?.();
    };
  }, [dialogOpen]);

  const closeDay = async () => {
    setClosing(true);
    try {
      await axios.post(`${API_URL}/operaciones/cierres`, { observaciones: observations });
      notify('Jornada operacional cerrada correctamente.', 'success');
      setObservations('');
      await load();
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible cerrar la jornada.'), 'error');
    } finally {
      setClosing(false);
    }
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (taskForm.titulo.trim().length < 3) {
      notify('Indica un título de al menos 3 caracteres.', 'error');
      return;
    }
    setCreatingTask(true);
    try {
      await axios.post(`${API_URL}/operaciones/tareas`, {
        titulo: taskForm.titulo.trim(),
        detalle: taskForm.detalle.trim() || null,
        prioridad: taskForm.prioridad,
        responsable_usuario_id: taskForm.responsable_usuario_id || null,
        fecha_limite: taskForm.fecha_limite || null
      });
      setTaskForm(emptyTaskForm);
      notify('Tarea interna creada con historial de origen.', 'success');
      await load();
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible crear la tarea interna.'), 'error');
    } finally {
      setCreatingTask(false);
    }
  };

  const openTaskDetail = async (taskId) => {
    setTaskDetail({ loading: true, error: '', tarea: null, eventos: [] });
    try {
      const response = await axios.get(`${API_URL}/operaciones/tareas/${taskId}`);
      setTaskDetail({ loading: false, error: '', ...response.data });
    } catch (error) {
      setTaskDetail({
        loading: false,
        error: getApiErrorMessage(error, 'No fue posible cargar el historial de la tarea.'),
        tarea: null,
        eventos: []
      });
    }
  };

  const startTask = async (task) => {
    if (updatingTaskId) return;
    setUpdatingTaskId(task.id_tarea);
    try {
      await axios.patch(`${API_URL}/operaciones/tareas/${task.id_tarea}/estado`, {
        estado: 'EN_PROGRESO'
      });
      notify('Tarea marcada en curso.', 'success');
      setTaskDetail(null);
      await load();
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible iniciar la tarea.'), 'error');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const resolveItem = async () => {
    if (!resolution?.reason?.trim() || resolution.reason.trim().length < 5) {
      setResolution((current) => current ? {
        ...current,
        error: 'Indica un motivo de al menos 5 caracteres.'
      } : current);
      window.requestAnimationFrame(() => {
        dialogRef.current?.querySelector('#resolution-reason')?.focus();
      });
      return;
    }
    setResolvingItem(true);
    try {
      if (resolution.kind === 'task') {
        await axios.patch(`${API_URL}/operaciones/tareas/${resolution.id}/estado`, {
          estado: 'COMPLETADA',
          motivo: resolution.reason.trim()
        });
        notify('Tarea completada y registrada en su historial.', 'success');
        setTaskDetail(null);
      } else {
        await axios.patch(`${API_URL}/operaciones/eventos/${resolution.id}/resolver`, {
          estado: 'RESUELTO',
          motivo: resolution.reason.trim()
        });
        notify('Incidencia resuelta.', 'success');
      }
      setResolution(null);
      await load();
    } catch (error) {
      const message = getApiErrorMessage(error, `No fue posible completar ${resolution.kind === 'task' ? 'la tarea' : 'la incidencia'}.`);
      setResolution((current) => current ? { ...current, error: message } : current);
    } finally {
      setResolvingItem(false);
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
        {loadError ? <section className="operations-load-error" role="alert" aria-labelledby="operations-load-error-title"><AlertTriangle size={38} /><div><span className="section-kicker">Estado no confirmado</span><h2 id="operations-load-error-title">No pudimos cargar las tareas</h2><p>{loadError}</p><p>No se puede confirmar que existan cero pendientes ni cerrar la jornada hasta recuperar la bandeja.</p></div><button type="button" className="secondary-action" onClick={load}><RefreshCw size={17} /> Reintentar</button></section> : <><section className="operations-status" aria-live="polite" data-tour="operations-status">
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

        <section className="operations-section operations-internal" aria-labelledby="operations-internal-title" data-tour="operations-list">
          <header className="operations-section__header">
            <div className="operations-section__identity">
              <span className="operations-row__icon"><ClipboardList size={22} /></span>
              <div>
                <span className="section-kicker">Coordinación del equipo</span>
                <h2 id="operations-internal-title">Tareas internas</h2>
                <p>Compromisos con responsable, plazo e historial trazable.</p>
              </div>
            </div>
            <strong className="operations-count-badge" aria-label={`${internalTasks?.count || 0} tareas internas`}>{internalTasks?.count || 0}</strong>
          </header>
          <div className="operations-task-list">
            {internalTasks?.items?.length ? internalTasks.items.map((internalTask) => (
              <article className="operations-task-item" key={internalTask.id_tarea}>
                <div>
                  <strong>{internalTask.titulo}</strong>
                  <span>
                    {taskStateLabel(internalTask.estado)} · {internalTask.prioridad.toLowerCase()} · {internalTask.responsable_nombre || 'Sin responsable'} · {internalTask.fecha_limite ? `vence ${formatDate(internalTask.fecha_limite)}` : 'sin fecha límite'}
                  </span>
                </div>
                <div className="operations-task-item__actions">
                  <button type="button" onClick={() => openTaskDetail(internalTask.id_tarea)}>Historial</button>
                  {canManageTasks && internalTask.estado === 'PENDIENTE' && (
                    <button type="button" disabled={Boolean(updatingTaskId)} onClick={() => startTask(internalTask)}>
                      {updatingTaskId === internalTask.id_tarea ? 'Iniciando…' : 'Iniciar'}
                    </button>
                  )}
                  {canManageTasks && !['COMPLETADA', 'CANCELADA'].includes(internalTask.estado) && (
                    <button type="button" className="is-primary" onClick={() => setResolution({ kind: 'task', id: internalTask.id_tarea, title: 'Completar tarea', reason: '' })}>Completar</button>
                  )}
                </div>
              </article>
            )) : (
              <div className="operations-empty"><CheckCircle2 size={20} /><span>No hay tareas internas pendientes.</span></div>
            )}
          </div>
        </section>

        <section className="operations-section operations-signals" aria-labelledby="operations-signals-title">
          <header className="operations-section__header">
            <div>
              <span className="section-kicker">Registros operativos</span>
              <h2 id="operations-signals-title">Pendientes de la jornada</h2>
              <p>Accesos directos a los registros que todavía requieren revisión.</p>
            </div>
          </header>
          <div className="operations-grid">
            {operationalRows.map((task) => (
              <article className={`operations-row${task.blocking && task.count ? ' is-blocking' : ''}`} key={task.key}>
                <div className="operations-row__icon"><task.icon size={22} /></div>
                <div className="operations-row__copy">
                  <div className="operations-row__heading">
                    <strong>{task.label}</strong>
                    <span className="operations-count-badge">{task.count}</span>
                  </div>
                  <span>{task.description}</span>
                  {task.key === 'operational_events' && task.items.slice(0, 3).map((event) => (
                    <button
                      type="button"
                      className="operations-event"
                      key={event.id}
                      onClick={() => setResolution({ kind: 'event', id: event.id, title: 'Resolver incidencia', reason: '' })}
                    >
                      {event.tipo.replaceAll('_', ' ').toLowerCase()} · {formatDateTime(event.ocurrido_en)}
                    </button>
                  ))}
                </div>
                {task.path && (
                  <button type="button" className="operations-row__action" onClick={() => navigate(task.path)}>
                    Revisar
                  </button>
                )}
              </article>
            ))}
          </div>
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

        {canManageTasks && (
          <section className="operations-task-create" data-tour="operations-internal-tasks">
            <header>
              <span className="section-kicker">Coordinación del equipo</span>
              <h2>Nueva tarea interna</h2>
              <p>Crea un compromiso sin modificar visitas, retiros, atrasos ni otros registros institucionales.</p>
            </header>
            <form onSubmit={createTask}>
              <label className="operations-task-create__title">
                Título de la tarea
                <input
                  value={taskForm.titulo}
                  onChange={updateTaskFormField('titulo')}
                  maxLength={160}
                  required
                  minLength={3}
                  placeholder="Ej.: Confirmar antecedente pendiente"
                />
              </label>
              <label>
                Prioridad
                <select value={taskForm.prioridad} onChange={updateTaskFormField('prioridad')}>
                  <option value="BAJA">Baja</option>
                  <option value="MEDIA">Media</option>
                  <option value="ALTA">Alta</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </label>
              <label>
                Responsable
                <select
                  value={taskForm.responsable_usuario_id}
                  onChange={updateTaskFormField('responsable_usuario_id')}
                  disabled={Boolean(responsiblesError)}
                >
                  <option value="">Sin asignar</option>
                  {responsibles.map((responsible) => <option key={responsible.id} value={responsible.id}>{responsible.nombre}</option>)}
                </select>
              </label>
              <label>
                Fecha límite
                <input type="date" value={taskForm.fecha_limite} onChange={updateTaskFormField('fecha_limite')} />
              </label>
              <label className="operations-task-create__detail">
                Detalle opcional
                <textarea
                  value={taskForm.detalle}
                  onChange={updateTaskFormField('detalle')}
                  maxLength={1500}
                  placeholder="Contexto necesario para que otra persona pueda resolverla"
                />
              </label>
              {responsiblesError && (
                <div className="operations-task-create__error" role="alert">
                  <span>{responsiblesError} Puedes crearla sin asignar o reintentar la carga.</span>
                  <button type="button" onClick={loadResponsibles}>Reintentar responsables</button>
                </div>
              )}
              <button type="submit" className="primary-action operations-task-create__submit" disabled={creatingTask}>
                <Plus size={18} /> {creatingTask ? 'Creando…' : 'Crear tarea interna'}
              </button>
            </form>
          </section>
        )}
        </>}
      </main>

      {resolution && createPortal(
        <div className="operations-modal-backdrop" role="presentation" onMouseDown={() => !resolvingItem && setResolution(null)}>
          <section ref={dialogRef} className="operations-modal operations-resolution" role="dialog" aria-modal="true" aria-labelledby="resolution-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="operations-modal__header">
              <div><span className="section-kicker">Registro trazable</span><h2 id="resolution-title">{resolution.title}</h2></div>
              <button type="button" className="operations-modal__close" onClick={() => setResolution(null)} disabled={resolvingItem} aria-label="Cerrar diálogo"><X size={20} /></button>
            </header>
            <div className="operations-modal__body">
              <p>{resolution.kind === 'task' ? 'La tarea quedará completada, pero conservará todas sus acciones y responsables.' : 'La incidencia seguirá existiendo en el historial con la persona y el motivo de resolución.'}</p>
            <label htmlFor="resolution-reason">
              Motivo de resolución
              <textarea
                id="resolution-reason"
                value={resolution.reason}
                onChange={(event) => setResolution((current) => ({
                  ...current,
                  reason: event.target.value,
                  error: ''
                }))}
                maxLength={500}
                minLength={5}
                required
                aria-invalid={Boolean(resolution.error)}
                aria-describedby={resolution.error ? 'resolution-reason-error' : undefined}
                placeholder="Explica brevemente cómo se resolvió"
              />
            </label>
            {resolution.error && (
              <p id="resolution-reason-error" className="operations-task-create__error" role="alert">
                <AlertTriangle size={17} aria-hidden="true" />
                <span>{resolution.error}</span>
              </p>
            )}
            </div>
            <footer className="operations-modal__actions">
              <button type="button" className="operations-button operations-button--secondary" onClick={() => setResolution(null)} disabled={resolvingItem}>Volver</button>
              <button type="button" className="operations-button operations-button--primary" onClick={resolveItem} disabled={resolvingItem}>{resolvingItem ? 'Guardando…' : resolution.kind === 'task' ? 'Completar tarea' : 'Guardar resolución'}</button>
            </footer>
          </section>
        </div>, document.body
      )}

      {taskDetail && createPortal(
        <div className="operations-modal-backdrop" role="presentation" onMouseDown={() => !updatingTaskId && setTaskDetail(null)}>
          <section ref={dialogRef} className="operations-modal operations-task-detail" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="operations-modal__header">
              <div><span className="section-kicker">Historial trazable</span><h2 id="task-detail-title">{taskDetail.tarea?.titulo || 'Detalle de la tarea'}</h2></div>
              <button type="button" className="operations-modal__close" onClick={() => setTaskDetail(null)} disabled={Boolean(updatingTaskId)} aria-label="Cerrar historial"><X size={20} /></button>
            </header>
            <div className="operations-modal__body">
            {taskDetail.loading ? (
              <p className="operations-modal__state" role="status">Cargando historial…</p>
            ) : taskDetail.error ? (
              <div className="operations-task-detail__error" role="alert">
                <h3>No pudimos cargar el historial</h3>
                <p>{taskDetail.error}</p>
              </div>
            ) : (
              <>
                <p>{taskDetail.tarea.detalle || 'Sin detalle adicional.'}</p>
                <dl className="operations-task-detail__summary">
                  <div><dt>Estado</dt><dd>{taskStateLabel(taskDetail.tarea.estado)}</dd></div>
                  <div><dt>Prioridad</dt><dd>{taskDetail.tarea.prioridad.toLowerCase()}</dd></div>
                  <div><dt>Responsable</dt><dd>{taskDetail.tarea.responsable_nombre || 'Sin asignar'}</dd></div>
                  <div><dt>Fecha límite</dt><dd>{formatDate(taskDetail.tarea.fecha_limite)}</dd></div>
                </dl>
                <ol className="operations-task-timeline">
                  {taskDetail.eventos.map((event) => (
                    <li key={event.id_evento}>
                      <strong>{event.tipo === 'CREADA' ? 'Tarea creada' : 'Estado actualizado'}</strong>
                      <span>{event.detalle || 'Sin observación'} · {event.realizado_por_nombre || 'Cuenta no disponible'} · {formatDateTime(event.realizado_en)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            </div>
            <footer className="operations-modal__actions">
              <button type="button" className="operations-button operations-button--secondary" onClick={() => setTaskDetail(null)} disabled={Boolean(updatingTaskId)}>Cerrar</button>
              {!taskDetail.loading && !taskDetail.error && canManageTasks && taskDetail.tarea.estado === 'PENDIENTE' && (
                <button type="button" className="operations-button operations-button--secondary" disabled={Boolean(updatingTaskId)} onClick={() => startTask(taskDetail.tarea)}>{updatingTaskId ? 'Iniciando…' : 'Marcar en curso'}</button>
              )}
              {!taskDetail.loading && !taskDetail.error && canManageTasks && !['COMPLETADA', 'CANCELADA'].includes(taskDetail.tarea.estado) && (
                <button type="button" className="operations-button operations-button--primary" disabled={Boolean(updatingTaskId)} onClick={() => { setTaskDetail(null); setResolution({ kind: 'task', id: taskDetail.tarea.id_tarea, title: 'Completar tarea', reason: '' }); }}>Completar tarea</button>
              )}
            </footer>
          </section>
        </div>, document.body
      )}
    </div>
  );
};

export default OperationalInbox;
