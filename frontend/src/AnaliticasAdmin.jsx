import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router';
import { Activity, AlertTriangle, BarChart3, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, FileSpreadsheet, Power, RefreshCw, ShieldCheck, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import DateRangeField from './components/DateRangeField';
import AppSelect from './components/AppSelect';
import { useFeedback } from './context/FeedbackContext';
import { hasPermission, PERMISSIONS } from './permissions';
import { getApiErrorMessage } from './utils/apiError';

const localIsoDate = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const initialPeriod = () => ({ from: localIsoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: localIsoDate() });
const formatShortDate = (value) => new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`)).replace('.', '');
const formatExecutionDate = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : null;
const countLabel = (value, singular, plural = `${singular}s`) => `${value} ${Number(value) === 1 ? singular : plural}`;
const analyticsParams = (period, courseId, justified, severity) => ({
  desde: period.from,
  hasta: period.to,
  id_curso: courseId || undefined,
  justificado: justified || undefined,
  severidad: severity || undefined
});
const analyticsScopeLabel = (filters = {}) => [
  filters.curso || 'Toda la institución',
  filters.justificado === true ? 'Solo atrasos justificados' : filters.justificado === false ? 'Solo atrasos sin justificar' : 'Cualquier justificación',
  filters.severidad ? `Severidad ${filters.severidad.toLowerCase()}` : 'Cualquier severidad'
].join(' · ');
const COURSES_PER_PAGE = 8;

const AnalyticsMetric = ({ icon: Icon, value, label, detail, tone, onClick }) => {
  const Element = onClick ? 'button' : 'article';
  return <Element type={onClick ? 'button' : undefined} className={`analytics-kpi${onClick ? ' analytics-kpi--action' : ''}`} data-tone={tone} onClick={onClick}>
    <div className="analytics-kpi__icon">{React.createElement(Icon, { size: 22 })}</div>
    <div><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>
  </Element>;
};

const CHART_VIEWS = [
  { value: 'line', label: 'Línea' },
  { value: 'bars', label: 'Barras' },
  { value: 'table', label: 'Tabla' }
];

const DailyChart = ({ data, onOpen }) => {
  const [view, setView] = useState('line');
  const [showValues, setShowValues] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  useEffect(() => { setHoveredIndex(null); setSelectedIndex(null); }, [data]);
  if (!data?.length) return <div className="analytics-empty">No hay ingresos registrados en este período.</div>;
  const width = 920;
  const height = 280;
  const pad = { left: 54, right: 26, top: 38, bottom: 44 };
  const max = Math.max(1, ...data.map((item) => Number(item.atrasos)));
  const usableWidth = width - pad.left - pad.right;
  const usableHeight = height - pad.top - pad.bottom;
  const point = (item, index) => ({
    x: pad.left + (data.length === 1 ? usableWidth / 2 : index * usableWidth / (data.length - 1)),
    y: pad.top + usableHeight - (Number(item.atrasos) / max) * usableHeight
  });
  const points = data.map(point);
  const path = points.map((item, index) => `${index ? 'L' : 'M'} ${item.x} ${item.y}`).join(' ');
  const area = `${path} L ${points.at(-1).x} ${height - pad.bottom} L ${points[0].x} ${height - pad.bottom} Z`;
  const labelStep = Math.max(1, Math.ceil(data.length / 7));
  const barWidth = Math.min(34, Math.max(10, (usableWidth / Math.max(data.length, 1)) * 0.56));
  const activeIndex = hoveredIndex ?? selectedIndex;
  const active = activeIndex === null ? null : data[activeIndex];
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const tooltipX = activePoint ? Math.max(pad.left, Math.min(width - pad.right - 184, activePoint.x - 92)) : 0;
  const tooltipY = activePoint ? (activePoint.y > 92 ? activePoint.y - 76 : activePoint.y + 18) : 0;
  const toggleSelection = (index) => setSelectedIndex((current) => current === index ? null : index);

  const toolbar = <div className="analytics-chart-toolbar">
    <div className="chart-view-switch" role="group" aria-label="Tipo de visualización">
      {CHART_VIEWS.map(({ value, label }) => <button type="button" key={value} className={view === value ? 'is-active' : ''} aria-pressed={view === value} onClick={() => { setView(value); setHoveredIndex(null); setSelectedIndex(null); }}>{label}</button>)}
    </div>
    {view !== 'table' && <button type="button" className={`chart-values-toggle${showValues ? ' is-active' : ''}`} aria-pressed={showValues} onClick={() => setShowValues((current) => !current)}>Cantidades</button>}
    <span className="analytics-chart-hint">Pasa el cursor para consultar. Haz clic, toca o usa Enter para fijar un dato.</span>
  </div>;

  if (view === 'table') return <div className="daily-chart-shell">{toolbar}<div className="daily-chart-table-wrap"><table className="daily-chart-table"><thead><tr><th>Fecha</th><th>Ingresos</th><th>Atrasos</th><th>Proporción</th></tr></thead><tbody>{data.map((item) => <tr key={item.fecha}><td>{formatShortDate(item.fecha)}</td><td>{item.ingresos}</td><td><strong>{item.atrasos}</strong></td><td>{Number(item.ingresos) ? `${((Number(item.atrasos) / Number(item.ingresos)) * 100).toFixed(1)}%` : 'Sin ingresos'}</td></tr>)}</tbody></table></div></div>;

  return (
    <div className="daily-chart-shell">
      {toolbar}
      <div className="daily-chart" role="group" aria-label={`Evolución diaria de atrasos en gráfico de ${view === 'bars' ? 'barras' : 'línea'}`} style={{ '--daily-chart-min-width': `${Math.max(620, data.length * 55)}px` }}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}><line x1={pad.left} x2={width - pad.right} y1={pad.top + usableHeight * ratio} y2={pad.top + usableHeight * ratio} className="chart-grid-line" /><text x={pad.left - 12} y={pad.top + usableHeight * ratio + 4} textAnchor="end" className="chart-axis-label">{Math.round(max * (1 - ratio))}</text></g>)}
          {view === 'line' && <><path d={area} className="chart-area" /><path d={path} className="chart-line" /></>}
          {view === 'bars' && points.map((item, index) => <rect key={`bar-${data[index].fecha}`} x={item.x - barWidth / 2} y={item.y} width={barWidth} height={height - pad.bottom - item.y} rx="3" className={`chart-bar${activeIndex === index ? ' is-active' : ''}`} />)}
          {points.map((item, index) => <g key={data[index].fecha} role="button" tabIndex="0" aria-pressed={selectedIndex === index} aria-label={`${formatShortDate(data[index].fecha)}: ${countLabel(data[index].atrasos, 'atraso')} de ${countLabel(data[index].ingresos, 'ingreso')}`} className={`chart-datum${activeIndex === index ? ' is-active' : ''}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} onClick={() => toggleSelection(index)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSelection(index); } }}>
            {view === 'line' && <circle cx={item.x} cy={item.y} r="5" className="chart-point" />}
            <circle cx={item.x} cy={item.y} r="16" className="chart-hit-target" />
            {showValues && <text x={item.x} y={Math.max(18, item.y - 12)} textAnchor="middle" className="chart-value-label">{data[index].atrasos}</text>}
          </g>)}
          {data.map((item, index) => index % labelStep === 0 || index === data.length - 1 ? <text key={item.fecha} x={point(item, index).x} y={height - 13} textAnchor="middle" className="chart-label">{formatShortDate(item.fecha)}</text> : null)}
          {active && activePoint && <g className="chart-tooltip" aria-hidden="true"><rect x={tooltipX} y={tooltipY} width="184" height="58" rx="7" /><text x={tooltipX + 12} y={tooltipY + 20} className="chart-tooltip__date">{formatShortDate(active.fecha)}</text><text x={tooltipX + 12} y={tooltipY + 41} className="chart-tooltip__value">{countLabel(active.atrasos, 'atraso')} de {countLabel(active.ingresos, 'ingreso')}</text></g>}
        </svg>
      </div>
      <p className="daily-chart-selection" aria-live="polite">{active ? <>{formatShortDate(active.fecha)}: {countLabel(active.atrasos, 'atraso')} de {countLabel(active.ingresos, 'ingreso')}. {onOpen && <button type="button" className="analytics-reset" onClick={() => onOpen(active)}>Ver registros del día</button>}</> : 'Selecciona un punto o una barra para fijar su cantidad.'}</p>
    </div>
  );
};

const DistributionBars = ({ data, valueKey = 'atrasos', labelKey, suffix = 'atrasos', onSelect }) => {
  if (!data?.length) return <div className="analytics-empty">Sin datos para mostrar.</div>;
  const max = Math.max(1, ...data.map((item) => Number(item[valueKey])));
  return <div className="distribution-list">{data.map((item) => {
    const Element = onSelect ? 'button' : 'div';
    return <Element type={onSelect ? 'button' : undefined} className={`distribution-row${onSelect ? ' distribution-row--action' : ''}`} key={`${item.id_curso || 'sin-curso'}-${item[labelKey]}`} onClick={onSelect ? () => onSelect(item) : undefined} aria-label={onSelect ? `Ver detalle de atrasos de ${item[labelKey]}` : undefined}><div><strong>{item[labelKey]}</strong><span>{item[valueKey]} {suffix}</span></div><div className="distribution-track"><i style={{ width: `${Math.max(3, (Number(item[valueKey]) / max) * 100)}%` }} /></div>{onSelect && <ChevronRight size={17} aria-hidden="true" />}</Element>;
  })}</div>;
};

const AnaliticasAdmin = () => {
  const navigate = useNavigate();
  const { logout, user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [period, setPeriod] = useState(initialPeriod);
  const [courseId, setCourseId] = useState('');
  const [justified, setJustified] = useState('');
  const [severity, setSeverity] = useState('');
  const [courses, setCourses] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [institutional, setInstitutional] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [executions, setExecutions] = useState({ items: [], pagina: 1, paginas: 1, total: 0 });
  const [executionPage, setExecutionPage] = useState(1);
  const [executionBusy, setExecutionBusy] = useState(null);
  const [coursePage, setCoursePage] = useState(1);
  const [showImprovedStudents, setShowImprovedStudents] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ nombre: 'Resumen institucional', frecuencia: 'SEMANAL', formato: 'PDF', dia_semana: '1', dia_mes: '1', hora: '07:00' });
  const canViewInstitutional = hasPermission(user, PERMISSIONS.ANALYTICS_INSTITUTIONAL_VIEW);
  const canExportInstitutional = hasPermission(user, PERMISSIONS.ANALYTICS_INSTITUTIONAL_EXPORT);
  const canManageSchedules = hasPermission(user, PERMISSIONS.ANALYTICS_SCHEDULES_MANAGE);
  const activeAnalyticsParams = useMemo(() => analyticsParams(period, courseId, justified, severity), [courseId, justified, period, severity]);

  useEffect(() => {
    axios.get(`${API_URL}/courses`)
      .then((response) => setCourses(response.data || []))
      .catch((error) => notify(getApiErrorMessage(error, 'No fue posible cargar los cursos.'), 'error'));
  }, [notify]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/puntualidad/analitica`, {
        params: activeAnalyticsParams
      });
      setData(response.data);
    } catch (error) {
      setData(null);
      notify(getApiErrorMessage(error, 'No fue posible calcular los indicadores.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [activeAnalyticsParams, notify]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  useEffect(() => {
    if (!canViewInstitutional) { setInstitutional(null); return; }
    axios.get(`${API_URL}/analitica/institucional`, { params: activeAnalyticsParams })
      .then((response) => setInstitutional(response.data))
      .catch((error) => {
        setInstitutional(null);
        notify(getApiErrorMessage(error, 'No fue posible cargar la analítica institucional.'), 'error');
      });
  }, [activeAnalyticsParams, canViewInstitutional, notify]);

  const loadSchedules = useCallback(async () => {
    if (!canManageSchedules) { setSchedules([]); return; }
    try {
      const response = await axios.get(`${API_URL}/analitica/programaciones`);
      setSchedules(response.data || []);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible cargar los reportes automáticos.'), 'error');
    }
  }, [canManageSchedules, notify]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const loadExecutions = useCallback(async (page = executionPage) => {
    if (!canManageSchedules) { setExecutions({ items: [], pagina: 1, paginas: 1, total: 0 }); return; }
    try {
      const response = await axios.get(`${API_URL}/analitica/programaciones/ejecuciones`, { params: { pagina: page, limite: 10 } });
      setExecutions(response.data);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible cargar el historial de reportes.'), 'error');
    }
  }, [canManageSchedules, executionPage, notify]);

  useEffect(() => { loadExecutions(); }, [loadExecutions]);

  const createSchedule = async (event) => {
    event.preventDefault();
    setScheduleSaving(true);
    try {
      await axios.post(`${API_URL}/analitica/programaciones`, scheduleForm);
      notify('Reporte automático programado correctamente.', 'success');
      await loadSchedules();
      await loadExecutions(1);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible programar el reporte.'), 'error');
    } finally {
      setScheduleSaving(false);
    }
  };

  const toggleSchedule = async (schedule) => {
    try {
      await axios.patch(`${API_URL}/analitica/programaciones/${schedule.id_reporte}/estado`, { activo: !schedule.activo });
      await loadSchedules();
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible cambiar el estado del reporte automático.'), 'error');
    }
  };

  const exportInstitutional = async (format) => {
    try {
      const response = await axios.get(`${API_URL}/analitica/institucional/exportar`, {
        params: { ...activeAnalyticsParams, formato: format }, responseType: 'blob'
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `analitica-institucional-${period.from}-${period.to}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible exportar la analítica institucional.'), 'error');
    }
  };

  const insight = useMemo(() => {
    const daily = data?.por_dia || [];
    if (!daily.length) return null;
    const peak = [...daily].sort((a, b) => b.atrasos - a.atrasos)[0];
    const split = Math.max(1, Math.floor(daily.length / 2));
    const first = daily.slice(0, split).reduce((sum, item) => sum + Number(item.atrasos), 0) / split;
    const secondItems = daily.slice(split);
    const second = secondItems.length ? secondItems.reduce((sum, item) => sum + Number(item.atrasos), 0) / secondItems.length : first;
    return { peak, trend: second > first ? 'up' : second < first ? 'down' : 'flat', change: first > 0 ? Math.abs(((second - first) / first) * 100).toFixed(0) : 0 };
  }, [data]);

  const resetFilters = () => {
    setPeriod(initialPeriod());
    setCourseId('');
    setJustified('');
    setSeverity('');
  };

  useEffect(() => { setCoursePage(1); }, [courseId, justified, period.from, period.to, severity]);

  const openLateRecords = ({ course = null, date = '', controlId = '', studentId = '', minutesFrom = '', minutesTo = '', includeAll = false } = {}) => {
    const params = new URLSearchParams({ desde: date || period.from, hasta: date || period.to });
    if (!includeAll) params.set('estado', 'Atrasado');
    const selectedCourse = course?.id_curso ?? courseId;
    if (course && !course.id_curso) params.set('curso_id', 'sin_curso');
    else if (selectedCourse) params.set('curso_id', String(selectedCourse));
    if (severity) params.set('severidad', severity);
    if (justified) params.set('justificado', justified);
    if (controlId) params.set('control_id', String(controlId));
    if (studentId) params.set('alumno_id', String(studentId));
    if (minutesFrom !== '') params.set('minutos_desde', String(minutesFrom));
    if (minutesTo !== '') params.set('minutos_hasta', String(minutesTo));
    navigate(`/admin/atrasos?${params.toString()}`);
  };

  const downloadExecution = async (execution) => {
    setExecutionBusy(execution.id_ejecucion);
    try {
      const response = await axios.get(`${API_URL}/analitica/programaciones/ejecuciones/${execution.id_ejecucion}/descargar`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = execution.archivo_nombre || `reporte-${execution.id_ejecucion}.${String(execution.formato).toLowerCase()}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible descargar el reporte generado.'), 'error');
    } finally { setExecutionBusy(null); }
  };

  const retryExecution = async (execution) => {
    setExecutionBusy(execution.id_ejecucion);
    try {
      await axios.post(`${API_URL}/analitica/programaciones/ejecuciones/${execution.id_ejecucion}/reintentar`);
      notify('El reporte fue generado correctamente en un nuevo intento.', 'success');
      setExecutionPage(1);
      await loadExecutions(1);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible reintentar el reporte.'), 'error');
    } finally { setExecutionBusy(null); }
  };

  const openCoexistenceRecords = (query = {}) => {
    const params = new URLSearchParams({ desde: period.from, hasta: period.to, ...query });
    navigate(`/admin/convivencia?${params.toString()}`);
  };

  const openVisitRecords = (tab, item) => {
    const params = new URLSearchParams({ tab, desde: period.from, hasta: period.to });
    if (item?.motivo_codigo) params.set('motivo', item.motivo_codigo);
    navigate(`/admin/visitas?${params.toString()}`);
  };

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const summary = data?.resumen;
  const courseBreakdown = (data?.por_curso || []).filter((item) => Number(item.atrasos) > 0);
  const coursePages = Math.max(1, Math.ceil(courseBreakdown.length / COURSES_PER_PAGE));
  const visibleCourses = courseBreakdown.slice((coursePage - 1) * COURSES_PER_PAGE, coursePage * COURSES_PER_PAGE);

  return (
    <div className="app-container analytics-page-v2">
      <div className="analytics-surface-v2">
        <ModuleHeader icon={BarChart3} title="Estadísticas de puntualidad" description="Análisis basado exclusivamente en ingresos registrados y atrasos reales." onBack={() => navigate('/admin')} onLogout={handleLogout} />

        <section className="analytics-control-band" data-tour="analytics-filters">
          <div className="analytics-control-band__period"><DateRangeField label="Período de análisis" from={period.from} to={period.to} maxValue={localIsoDate()} onChange={setPeriod} /></div>
          <div className="analytics-filter-fields">
            <label><span>Curso</span><AppSelect ariaLabel="Filtrar por curso" value={courseId} onChange={setCourseId} options={[{ value: '', label: 'Toda la institución' }, ...courses.map((course) => ({ value: course.id_curso, label: course.nombre_curso }))]} /></label>
            <label><span>Justificación</span><AppSelect ariaLabel="Filtrar por justificación" value={justified} onChange={setJustified} options={[{ value: '', label: 'Todas' }, { value: 'false', label: 'Sin justificar' }, { value: 'true', label: 'Justificados' }]} /></label>
            <label><span>Severidad</span><AppSelect ariaLabel="Filtrar por severidad" value={severity} onChange={setSeverity} options={[{ value: '', label: 'Todas' }, { value: 'Leve', label: 'Leve' }, { value: 'Grave', label: 'Grave' }]} /></label>
            <button type="button" className="analytics-reset" onClick={resetFilters}><RefreshCw size={17} /> Restablecer</button>
          </div>
        </section>

        {loading ? <div className="analytics-loading-v2"><Activity size={24} className="spin" /> Calculando indicadores…</div> : data ? <>
          <section className="analytics-kpi-grid" data-tour="analytics-summary">
            <AnalyticsMetric icon={ShieldCheck} value={summary.puntualidad_registrada === null ? '—' : `${summary.puntualidad_registrada}%`} label="Puntualidad registrada" detail="Sobre ingresos marcados · Ver ingresos" tone="green" onClick={() => openLateRecords({ includeAll: true })} />
            <AnalyticsMetric icon={Users} value={summary.ingresos} label="Ingresos registrados" detail={`${summary.a_tiempo} a tiempo · Ver detalle`} tone="blue" onClick={() => openLateRecords({ includeAll: true })} />
            <AnalyticsMetric icon={AlertTriangle} value={summary.atrasos} label="Atrasos" detail={`${summary.leves} leves · ${summary.graves} graves · Ver detalle`} tone="amber" onClick={() => openLateRecords()} />
            <AnalyticsMetric icon={Clock3} value={summary.promedio_minutos_atraso ? `${summary.promedio_minutos_atraso} min` : '—'} label="Promedio de atraso" detail={`${summary.justificados} justificados · Ver atrasos`} tone="navy" onClick={() => openLateRecords()} />
          </section>

          <div className="analytics-scope-notice"><CheckCircle2 size={18} /><span>Ningún indicador interpreta la falta de escaneo como presencia o ausencia.</span></div>

          <section className="analytics-story-grid">
            <article className="analytics-panel analytics-panel--wide" data-tour="analytics-daily-chart">
              <header><div><span className="section-kicker">Comportamiento diario</span><h2>Evolución de atrasos</h2></div><span className="panel-period">{period.from} · {period.to}</span></header>
              <DailyChart data={data.por_dia} onOpen={(item) => openLateRecords({ date: item.fecha })} />
            </article>
            <aside className="analytics-insight-panel">
              <span className="section-kicker">Lectura rápida</span><h2>Qué muestra el período</h2>
              {insight ? <div className="insight-stack"><article><AlertTriangle size={20} /><div><small>Día con más atrasos</small><strong>{formatShortDate(insight.peak.fecha)}</strong><span>{insight.peak.atrasos} de {insight.peak.ingresos} ingresos</span></div></article><article>{insight.trend === 'up' ? <TrendingUp size={20} /> : insight.trend === 'down' ? <TrendingDown size={20} /> : <Activity size={20} />}<div><small>Tendencia entre mitades</small><strong>{insight.trend === 'up' ? 'En aumento' : insight.trend === 'down' ? 'En descenso' : 'Estable'}</strong><span>{insight.change}% de variación aproximada</span></div></article><article><ShieldCheck size={20} /><div><small>Respaldos</small><strong>{summary.justificados}</strong><span>atrasos con respaldo de apoderado, médico o institucional</span></div></article></div> : <div className="analytics-empty">Aún no hay información suficiente.</div>}
            </aside>
          </section>

          <section className="analytics-detail-grid" data-tour="analytics-breakdowns">
            <article className="analytics-panel"><header><div><span className="section-kicker">Distribución</span><h2>Minutos de atraso</h2></div></header><DistributionBars data={data.por_tramo} labelKey="tramo" onSelect={(item) => openLateRecords({ minutesFrom: item.minutos_desde, minutesTo: item.minutos_hasta })} /></article>
            <article className="analytics-panel"><header><div><span className="section-kicker">Cursos</span><h2>Atrasos por curso</h2></div><span className="panel-period">{courseBreakdown.length} curso{courseBreakdown.length === 1 ? '' : 's'}</span></header><DistributionBars data={visibleCourses} labelKey="curso" onSelect={(course) => openLateRecords({ course })} />{coursePages > 1 && <div className="analytics-panel__pagination"><button type="button" disabled={coursePage === 1} onClick={() => setCoursePage((current) => current - 1)}><ChevronLeft size={17} /> Anterior</button><span>Página {coursePage} de {coursePages}</span><button type="button" disabled={coursePage === coursePages} onClick={() => setCoursePage((current) => current + 1)}>Siguiente <ChevronRight size={17} /></button></div>}</article>
          </section>

          <section className="analytics-recurrence" data-tour="analytics-recurrence">
            <header><div><span className="section-kicker">Seguimiento</span><h2>Personas con recurrencia en el período</h2><p>Ordenadas por cantidad de atrasos efectivamente registrados.</p></div></header>
            <div className="recurrence-table-wrap"><table className="recurrence-table"><thead><tr><th>Persona</th><th>Curso</th><th>Atrasos</th><th>Graves</th><th>Nivel</th><th>Detalle</th></tr></thead><tbody>{data.recurrentes.map((person, index) => <tr key={person.id_alumno}><td data-label="Persona"><span className="rank-number">{index + 1}</span><strong>{[person.nombres, person.paterno, person.materno].filter(Boolean).join(' ')}</strong></td><td data-label="Curso">{person.curso}</td><td data-label="Atrasos"><strong>{person.atrasos}</strong></td><td data-label="Graves">{person.graves}</td><td data-label="Nivel"><span className="recurrence-level" data-level={person.graves >= 3 ? 'critical' : person.atrasos >= 3 ? 'warning' : 'normal'}>{person.graves >= 3 ? 'Prioritario' : person.atrasos >= 3 ? 'Preventivo' : 'Observación'}</span></td><td data-label="Detalle"><button type="button" className="analytics-reset" onClick={() => openLateRecords({ studentId: person.id_alumno })}>Ver registros</button></td></tr>)}</tbody></table>{!data.recurrentes.length && <div className="analytics-empty">No hay atrasos recurrentes con estos filtros.</div>}</div>
          </section>

          {institutional && <section className="institutional-analytics" aria-labelledby="institutional-title" data-tour="analytics-institutional">
            <header className="institutional-analytics__header">
              <div><span className="section-kicker">Visión institucional</span><h2 id="institutional-title">Analítica explicable</h2><p>Indicadores calculados con reglas visibles, sin puntajes opacos.</p></div>
              {canExportInstitutional && <div className="institutional-analytics__actions" data-tour="analytics-export"><button type="button" onClick={() => exportInstitutional('pdf')}><Download size={17} /> PDF</button><button type="button" onClick={() => exportInstitutional('xlsx')}><FileSpreadsheet size={17} /> Excel</button></div>}
            </header>
            <div className="analytics-scope-notice"><CheckCircle2 size={18} /><span><strong>Alcance del informe:</strong> {analyticsScopeLabel(institutional.filtros)}. Visitas, retiros y Convivencia consideran toda la institución dentro de {period.from} a {period.to}.</span></div>
            <div className="institutional-analytics__metrics">
              <AnalyticsMetric icon={TrendingDown} value={institutional.estudiantes_mejoraron.length} label="Estudiantes que mejoraron" detail="Comparación entre mitades · Ver lista" tone="green" onClick={() => setShowImprovedStudents((current) => !current)} />
              <AnalyticsMetric icon={Users} value={institutional.convivencia.abiertos} label="Casos abiertos" detail={`${institutional.convivencia.resueltos} resueltos · Ver casos`} tone="blue" onClick={() => openCoexistenceRecords({ activos: 'true' })} />
              <AnalyticsMetric icon={Clock3} value={institutional.convivencia.promedio_dias_resolucion ? `${institutional.convivencia.promedio_dias_resolucion} días` : '—'} label="Resolución media" detail="Solo casos cerrados · Ver casos" tone="navy" onClick={() => openCoexistenceRecords({ estado: 'CERRADO' })} />
              <AnalyticsMetric icon={ShieldCheck} value={institutional.contactos_apoderados.porcentaje_cierre === null ? '—' : `${institutional.contactos_apoderados.porcentaje_cierre}%`} label="Casos cerrados con contacto" detail="Correlación descriptiva · Ver casos" tone="amber" onClick={() => openCoexistenceRecords({ estado: 'CERRADO', contacto_apoderado: 'true' })} />
            </div>
            {showImprovedStudents && <article className="analytics-panel"><header><div><span className="section-kicker">Detalle explicable</span><h2>Estudiantes que mejoraron</h2></div><span className="panel-period">{institutional.estudiantes_mejoraron.length} resultados</span></header><DistributionBars data={institutional.estudiantes_mejoraron.map((item) => ({ ...item, etiqueta: `${item.estudiante} · ${item.antes} a ${item.despues}`, valor: item.reduccion }))} valueKey="valor" labelKey="etiqueta" suffix="atrasos menos" onSelect={(item) => openLateRecords({ studentId: item.id_alumno })} /></article>}
            <div className="institutional-analytics__grid">
              <article className="analytics-panel"><header><div><span className="section-kicker">Horarios</span><h2>Bloques con más atrasos</h2></div></header><DistributionBars data={institutional.bloques_horarios.slice(0, 8)} labelKey="bloque" onSelect={(item) => openLateRecords({ controlId: item.control_id || 'sin_control' })} /></article>
              <article className="analytics-panel"><header><div><span className="section-kicker">Portería</span><h2>Motivos de visita</h2></div></header><DistributionBars data={institutional.motivos_visita.slice(0, 8)} valueKey="total" labelKey="motivo" suffix="visitas" onSelect={(item) => openVisitRecords('historial', item)} /></article>
              <article className="analytics-panel"><header><div><span className="section-kicker">Retiros</span><h2>Retiros anticipados</h2></div></header><DistributionBars data={institutional.retiros_anticipados.slice(0, 8)} valueKey="total" labelKey="motivo" suffix="retiros" onSelect={(item) => openVisitRecords('retiros', item)} /></article>
              <article className="analytics-panel"><header><div><span className="section-kicker">Equipos</span><h2>Carga por área</h2></div></header><DistributionBars data={institutional.carga_trabajo.slice(0, 8)} valueKey="casos" labelKey="area" suffix="casos" onSelect={(item) => openCoexistenceRecords({ area: item.area })} /></article>
            </div>
            <article className="analytics-explanations"><header><AlertTriangle size={20} /><div><h2>Alertas con explicación</h2><p>Cada aviso muestra el dato y la regla exacta que lo activó.</p></div></header>{institutional.alertas.length ? institutional.alertas.map((alert) => <div className="analytics-explanation" key={`${alert.title}-${alert.rule}`} data-level={alert.level}><strong>{alert.title}</strong><span>{alert.explanation}</span><small>Regla: {alert.rule}</small></div>) : <div className="analytics-empty">No se activaron alertas en este período.</div>}</article>
            <details className="analytics-methodology"><summary>Cómo se calcularon estos indicadores</summary>{Object.values(institutional.metodologia).map((text) => <p key={text}>{text}</p>)}</details>
            {canManageSchedules && <article className="analytics-schedules" aria-labelledby="analytics-schedules-title" data-tour="analytics-schedules">
              <header><CalendarClock size={22} /><div><span className="section-kicker">Entrega periódica</span><h2 id="analytics-schedules-title">Reportes automáticos</h2><p>Genera una copia institucional semanal o mensual con el período anterior ya cerrado.</p></div></header>
              <form className="analytics-schedules__form" onSubmit={createSchedule}>
                <label><span>Nombre</span><input value={scheduleForm.nombre} maxLength="120" required onChange={(event) => setScheduleForm((current) => ({ ...current, nombre: event.target.value }))} /></label>
                <label><span>Frecuencia</span><AppSelect ariaLabel="Frecuencia del reporte" value={scheduleForm.frecuencia} onChange={(value) => setScheduleForm((current) => ({ ...current, frecuencia: value }))} options={[{ value: 'SEMANAL', label: 'Semanal' }, { value: 'MENSUAL', label: 'Mensual' }]} /></label>
                <label><span>{scheduleForm.frecuencia === 'SEMANAL' ? 'Día de la semana' : 'Día del mes'}</span><input type="number" min="1" max={scheduleForm.frecuencia === 'SEMANAL' ? '7' : '28'} value={scheduleForm.frecuencia === 'SEMANAL' ? scheduleForm.dia_semana : scheduleForm.dia_mes} onChange={(event) => setScheduleForm((current) => ({ ...current, [current.frecuencia === 'SEMANAL' ? 'dia_semana' : 'dia_mes']: event.target.value }))} /></label>
                <label><span>Hora</span><input type="time" value={scheduleForm.hora} required onChange={(event) => setScheduleForm((current) => ({ ...current, hora: event.target.value }))} /></label>
                <label><span>Formato</span><AppSelect ariaLabel="Formato del reporte" value={scheduleForm.formato} onChange={(value) => setScheduleForm((current) => ({ ...current, formato: value }))} options={[{ value: 'PDF', label: 'PDF' }, { value: 'XLSX', label: 'Excel' }]} /></label>
                <button type="submit" disabled={scheduleSaving}>{scheduleSaving ? <RefreshCw size={17} className="spin" /> : <CalendarClock size={17} />} Programar</button>
              </form>
              <div className="analytics-schedules__list">
                {schedules.map((schedule) => <div key={schedule.id_reporte} className="analytics-schedule" data-active={schedule.activo}>
                  <div><strong>{schedule.nombre}</strong><span>{schedule.frecuencia === 'SEMANAL' ? `Semanal · día ${schedule.dia_semana}` : `Mensual · día ${schedule.dia_mes}`} · {String(schedule.hora).slice(0, 5)} · {schedule.formato}</span><small>{schedule.ultima_ejecucion ? `Última ejecución: ${formatExecutionDate(schedule.ultima_ejecucion)}` : 'Aún no registra ejecuciones'}</small></div>
                  <span className="analytics-schedule__status">{schedule.activo ? 'Activo' : 'Pausado'}</span>
                  <button type="button" onClick={() => toggleSchedule(schedule)} aria-label={`${schedule.activo ? 'Pausar' : 'Reactivar'} ${schedule.nombre}`}><Power size={16} /> {schedule.activo ? 'Pausar' : 'Reactivar'}</button>
                </div>)}
                {!schedules.length && <div className="analytics-empty">Todavía no hay reportes automáticos programados.</div>}
              </div>
              <header><FileSpreadsheet size={22} /><div><span className="section-kicker">Trazabilidad</span><h2>Historial de ejecuciones</h2><p>Cada intento conserva período, resultado y archivo generado. Los fallos muestran una causa segura y pueden reintentarse.</p></div></header>
              <div className="analytics-schedules__list">
                {executions.items.map((execution) => <div key={execution.id_ejecucion} className="analytics-schedule" data-active={execution.estado === 'GENERADO'}>
                  <div><strong>{execution.nombre_reporte}</strong><span>{execution.periodo_desde} a {execution.periodo_hasta} · {execution.formato}{execution.reintento_de ? ` · Reintento de #${execution.reintento_de}` : ''}</span><small>{formatExecutionDate(execution.generado_en)}{execution.error_publico ? ` · ${execution.error_publico}` : execution.archivo_bytes ? ` · ${Math.max(1, Math.round(execution.archivo_bytes / 1024))} KB` : ''}</small></div>
                  <span className="analytics-schedule__status">{execution.estado === 'GENERADO' ? execution.archivo_bytes ? 'Generado' : 'Sin archivo' : 'Fallido'}</span>
                  {execution.estado === 'GENERADO' ? execution.archivo_bytes ? <button type="button" onClick={() => downloadExecution(execution)} disabled={executionBusy === execution.id_ejecucion}><Download size={16} /> Descargar</button> : <span className="analytics-schedule__legacy">Ejecución anterior a esta mejora</span> : <button type="button" onClick={() => retryExecution(execution)} disabled={executionBusy === execution.id_ejecucion}><RefreshCw size={16} className={executionBusy === execution.id_ejecucion ? 'spin' : ''} /> Reintentar</button>}
                </div>)}
                {!executions.items.length && <div className="analytics-empty">Aún no existen ejecuciones registradas.</div>}
              </div>
              {executions.paginas > 1 && <div className="analytics-panel__pagination"><button type="button" disabled={executionPage <= 1} onClick={() => setExecutionPage((current) => current - 1)}><ChevronLeft size={17} /> Anterior</button><span>Página {executions.pagina} de {executions.paginas}</span><button type="button" disabled={executionPage >= executions.paginas} onClick={() => setExecutionPage((current) => current + 1)}>Siguiente <ChevronRight size={17} /></button></div>}
            </article>}
          </section>}
        </> : <div className="analytics-empty analytics-empty--page">No fue posible mostrar el análisis.</div>}
      </div>
    </div>
  );
};

export default AnaliticasAdmin;
