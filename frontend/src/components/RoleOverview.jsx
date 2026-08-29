import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, ArchiveRestore, ArrowRight, BellRing, Clock3, FileWarning, RefreshCw, ShieldAlert, TrendingDown, TrendingUp, UserCheck, Users } from 'lucide-react';
import { PERMISSIONS, hasAnyPermission, hasPermission, roleLabel } from '../permissions';
import { getApiErrorMessage } from '../utils/apiError';

const VISIT_PERMISSIONS = [
  PERMISSIONS.VISITS_VIEW,
  PERMISSIONS.VISITS_REGISTER,
  PERMISSIONS.VISITS_HISTORY,
  PERMISSIONS.VISITS_REPORTS,
  PERMISSIONS.WITHDRAWALS_REGISTER,
  PERMISSIONS.WITHDRAWALS_APPROVE,
  PERMISSIONS.WITHDRAWALS_AUTHORIZATIONS
];

const localIsoDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Santiago'
}).format(date);

const analyticsPeriod = () => {
  const to = localIsoDate();
  return { from: `${to.slice(0, 8)}01`, to };
};

const requestDefinitions = (user) => [
  hasPermission(user, PERMISSIONS.OPERATIONS_VIEW) && ['operations', '/api/operaciones/bandeja'],
  hasAnyPermission(user, [PERMISSIONS.PUNCTUALITY_VIEW, PERMISSIONS.PUNCTUALITY_REGISTER]) && ['punctuality', '/api/puntualidad/resumen-hoy'],
  hasPermission(user, PERMISSIONS.FOLLOW_UP_VIEW) && ['followUp', '/api/seguimiento/resumen'],
  hasPermission(user, PERMISSIONS.FOLLOW_UP_VIEW) && ['assigned', '/api/seguimiento/casos', { params: { responsable: user.id, limite: 10 } }],
  hasPermission(user, PERMISSIONS.DOCUMENTS_VIEW) && ['documents', '/api/documentos-estudiantes/resumen'],
  hasPermission(user, PERMISSIONS.COEXISTENCE_VIEW) && ['coexistence', '/api/convivencia/resumen'],
  hasAnyPermission(user, VISIT_PERMISSIONS) && ['visits', '/api/visitas/resumen'],
  hasPermission(user, PERMISSIONS.ANALYTICS_INSTITUTIONAL_VIEW) && ['analytics', '/api/analitica/institucional', { params: { desde: analyticsPeriod().from, hasta: analyticsPeriod().to } }],
  hasPermission(user, PERMISSIONS.NOTIFICATIONS_SEND) && ['sentNotifications', '/api/notificaciones/enviadas', { params: { pagina: 1, limite: 5 } }]
].filter(Boolean);

const card = (key, label, value, path, icon, tone = 'blue') => ({ key, label, value: value ?? 0, path, icon, tone });

const cardsForRole = (role, data) => {
  const operations = data.operations;
  const punctuality = data.punctuality;
  const followUp = data.followUp;
  const assigned = data.assigned;
  const documents = data.documents;
  const coexistence = data.coexistence;
  const visits = data.visits;
  const options = {
    direction: [
      followUp && card('priority-cases', 'Casos prioritarios', followUp.prioritarios, '/admin/seguimiento', ShieldAlert, 'red'),
      followUp && card('overdue-cases', 'Seguimientos vencidos', followUp.vencidos, '/admin/seguimiento?vencidos=true', Clock3, 'ochre'),
      operations && card('operational-tasks', 'Pendientes operativos', operations.summary?.total, '/admin/operacion', AlertTriangle),
      operations && card('backup', operations.backup?.healthy ? 'Respaldo vigente' : 'Respaldo por revisar', operations.backup?.healthy ? 'OK' : '!', '/admin/operacion', ArchiveRestore, operations.backup?.healthy ? 'green' : 'red')
    ],
    inspector: [
      punctuality && card('delays-today', 'Atrasos de hoy', punctuality.atrasos, '/admin/atrasos', Clock3, 'ochre'),
      assigned && card('assigned-cases', 'Seguimientos asignados', assigned.total, `/admin/seguimiento?responsable=${data.userId}`, UserCheck),
      operations && card('pending-justifications', 'Atrasos sin justificar', operations.summary?.pending_justifications, '/admin/atrasos', FileWarning, 'red'),
      visits && card('withdrawals', 'Retiros por decidir', visits.retiros_pendientes, '/admin/visitas?tab=retiros', ShieldAlert, 'ochre')
    ],
    reader: [
      visits && card('people-inside', 'Personas dentro', visits.dentro, '/admin/visitas?tab=presentes', Users, 'red'),
      visits && card('withdrawals', 'Retiros pendientes', visits.retiros_pendientes, '/admin/visitas?tab=retiros', UserCheck, 'ochre'),
      punctuality && card('registered-today', 'Ingresos registrados', punctuality.ingresos_registrados, '/scanner', Clock3, 'green')
    ],
    secretary: [
      operations && card('unenrolled', 'Sin matrícula vigente', operations.summary?.unenrolled_students, '/admin/estudiantes', Users, 'red'),
      operations && card('manual-pending', 'Altas manuales pendientes', operations.summary?.manual_students_pending, '/admin/estudiantes?seccion=governance', UserCheck, 'ochre'),
      documents && card('expired-documents', 'Documentos vencidos', documents.vencidos, '/admin/documentos?estado=VENCIDO', FileWarning, 'red'),
      documents && card('documents-soon', 'Vencen dentro de 30 días', documents.vencen_pronto, '/admin/documentos?vencimiento=30', Clock3)
    ],
    coexistence: [
      coexistence && card('coexistence-active', 'Casos activos', coexistence.activos, '/admin/convivencia', ShieldAlert),
      coexistence && card('reviews', 'Revisiones pendientes', coexistence.revisiones_pendientes, '/admin/convivencia', Clock3, 'red'),
      followUp && card('priority-follow-up', 'Seguimientos prioritarios', followUp.prioritarios, '/admin/seguimiento', UserCheck, 'ochre')
    ],
    documents: [
      documents && card('expired-documents', 'Documentos vencidos', documents.vencidos, '/admin/documentos?estado=VENCIDO', FileWarning, 'red'),
      documents && card('ocr', 'OCR pendiente de revisión', documents.ocr_pendientes, '/admin/documentos', UserCheck, 'ochre'),
      documents && card('unsigned', 'Versiones sin firma', documents.sin_firma, '/admin/documentos', FileWarning)
    ]
  };
  const selected = role === 'direccion' || role === 'admin'
    ? options.direction
    : role === 'inspector'
      ? options.inspector
      : role === 'lector'
        ? options.reader
        : role === 'secretaria'
          ? options.secretary
          : role === 'convivencia'
            ? options.coexistence
            : role === 'documental'
              ? options.documents
              : [...options.direction, ...options.inspector, ...options.secretary];
  return selected.filter(Boolean).filter((item, index, rows) => rows.findIndex((candidate) => candidate.key === item.key) === index).slice(0, 4);
};

const RoleOverview = ({ user, navigate }) => {
  const [state, setState] = useState({ loading: true, data: {}, error: '' });
  const load = useCallback(async () => {
    const definitions = requestDefinitions(user);
    if (!definitions.length) {
      setState({ loading: false, data: {}, error: '' });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    const settled = await Promise.allSettled(definitions.map(([, url, config]) => axios.get(url, config)));
    const data = { userId: user.id };
    let failures = 0;
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') data[definitions[index][0]] = result.value.data;
      else failures += 1;
    });
    setState({
      loading: false,
      data,
      error: failures === definitions.length
        ? getApiErrorMessage(settled.find((result) => result.status === 'rejected')?.reason, 'No fue posible cargar las prioridades de tu panel.')
        : failures > 0 ? 'Algunos indicadores no pudieron actualizarse. Los demás siguen disponibles.' : ''
    });
  }, [user]);

  useEffect(() => { load(); }, [load]);
  const cards = useMemo(() => cardsForRole(user.rol, state.data), [state.data, user.rol]);
  const directionInsights = useMemo(() => {
    if (!['admin', 'direccion'].includes(user.rol)) return null;
    const daily = state.data.analytics?.tendencia_diaria || [];
    const midpoint = Math.ceil(daily.length / 2);
    const before = daily.slice(0, midpoint).reduce((total, row) => total + Number(row.atrasos || 0), 0);
    const after = daily.slice(midpoint).reduce((total, row) => total + Number(row.atrasos || 0), 0);
    const sent = state.data.sentNotifications?.summary;
    if (!daily.length && !sent) return null;
    return { before, after, sent };
  }, [state.data.analytics, state.data.sentNotifications, user.rol]);
  if (!state.loading && !cards.length && !state.error) return null;

  return (
    <section className="role-overview" aria-labelledby="role-overview-title" data-tour="role-overview">
      <header>
        <div><span className="section-kicker">Prioridades de {roleLabel(user.rol)}</span><h2 id="role-overview-title">Resumen para tu jornada</h2><p>Indicadores operativos según los permisos vigentes de tu cuenta.</p></div>
        <button type="button" onClick={load} disabled={state.loading}><RefreshCw size={16} className={state.loading ? 'is-spinning' : ''} /> Actualizar</button>
      </header>
      {state.error && <p className="role-overview__error" role="status">{state.error}</p>}
      {state.loading && !cards.length ? <div className="role-overview__loading">Actualizando prioridades…</div> : (
        <div className="role-overview__grid">
          {cards.map((item) => <button type="button" key={item.key} className="role-overview-card" data-tone={item.tone} onClick={() => navigate(item.path)}><span className="role-overview-card__icon"><item.icon size={20} /></span><span><strong>{item.value}</strong><b>{item.label}</b></span><ArrowRight size={17} /></button>)}
        </div>
      )}
      {directionInsights && <div className="role-overview__direction" aria-label="Tendencias para Dirección">
        <button type="button" onClick={() => navigate('/admin/analiticas')}>
          <span className="role-overview-card__icon">{directionInsights.after <= directionInsights.before ? <TrendingDown size={20} /> : <TrendingUp size={20} />}</span>
          <span><small>Tendencia mensual de atrasos</small><strong>{directionInsights.before} → {directionInsights.after}</strong><b>{directionInsights.after < directionInsights.before ? 'Disminuyeron entre mitades' : directionInsights.after > directionInsights.before ? 'Aumentaron entre mitades' : 'Sin variación entre mitades'}</b></span>
          <ArrowRight size={17} />
        </button>
        {directionInsights.sent && <button type="button" onClick={() => window.dispatchEvent(new Event('open-notification-history'))}>
          <span className="role-overview-card__icon"><BellRing size={20} /></span>
          <span><small>Avisos institucionales enviados</small><strong>{directionInsights.sent.total}</strong><b>{directionInsights.sent.leidas} leídas de {directionInsights.sent.entregadas} entregadas{directionInsights.sent.fallidos ? ` · ${directionInsights.sent.fallidos} fallidos` : ''}</b></span>
          <ArrowRight size={17} />
        </button>}
      </div>}
    </section>
  );
};

export default RoleOverview;
