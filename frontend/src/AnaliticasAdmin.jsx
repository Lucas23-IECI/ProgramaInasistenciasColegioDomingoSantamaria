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
import DevelopmentBadge from './components/DevelopmentBadge';

const localIsoDate = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const initialPeriod = () => ({ from: localIsoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: localIsoDate() });
const formatShortDate = (value) => new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`)).replace('.', '');
const formatExecutionDate = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : null;
const COURSES_PER_PAGE = 8;

const AnalyticsMetric = ({ icon: Icon, value, label, detail, tone, onClick }) => {
  const Element = onClick ? 'button' : 'article';
  return <Element type={onClick ? 'button' : undefined} className={`analytics-kpi${onClick ? ' analytics-kpi--action' : ''}`} data-tone={tone} onClick={onClick}>
    <div className="analytics-kpi__icon">{React.createElement(Icon, { size: 22 })}</div>
    <div><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>
  </Element>;
};

const DailyChart = ({ data }) => {
  if (!data?.length) return <div className="analytics-empty">No hay ingresos registrados en este período.</div>;
  const width = 920;
  const height = 260;
  const pad = { x: 48, top: 24, bottom: 42 };
  const max = Math.max(1, ...data.map((item) => Number(item.atrasos)));
  const usableWidth = width - pad.x * 2;
  const usableHeight = height - pad.top - pad.bottom;
  const point = (item, index) => ({
    x: pad.x + (data.length === 1 ? usableWidth / 2 : index * usableWidth / (data.length - 1)),
    y: pad.top + usableHeight - (Number(item.atrasos) / max) * usableHeight
  });
  const points = data.map(point);
  const path = points.map((item, index) => `${index ? 'L' : 'M'} ${item.x} ${item.y}`).join(' ');
  const area = `${path} L ${points.at(-1).x} ${height - pad.bottom} L ${points[0].x} ${height - pad.bottom} Z`;
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className="daily-chart" role="img" aria-label="Evolución diaria de atrasos">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1={pad.x} x2={width - pad.x} y1={pad.top + usableHeight * ratio} y2={pad.top + usableHeight * ratio} className="chart-grid-line" />)}
        <path d={area} className="chart-area" />
        <path d={path} className="chart-line" />
        {points.map((item, index) => <circle key={data[index].fecha} cx={item.x} cy={item.y} r="5" className="chart-point"><title>{formatShortDate(data[index].fecha)}: {data[index].atrasos} atrasos de {data[index].ingresos} ingresos</title></circle>)}
        {data.map((item, index) => index % labelStep === 0 || index === data.length - 1 ? <text key={item.fecha} x={point(item, index).x} y={height - 13} textAnchor="middle" className="chart-label">{formatShortDate(item.fecha)}</text> : null)}
      </svg>
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
  const [coursePage, setCoursePage] = useState(1);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ nombre: 'Resumen institucional', frecuencia: 'SEMANAL', formato: 'PDF', dia_semana: '1', dia_mes: '1', hora: '07:00' });
  const canViewInstitutional = hasPermission(user, PERMISSIONS.ANALYTICS_INSTITUTIONAL_VIEW);
  const canExportInstitutional = hasPermission(user, PERMISSIONS.ANALYTICS_INSTITUTIONAL_EXPORT);
  const canManageSchedules = hasPermission(user, PERMISSIONS.ANALYTICS_SCHEDULES_MANAGE);

  useEffect(() => {
    axios.get(`${API_URL}/courses`).then((response) => setCourses(response.data || [])).catch(() => notify('No fue posible cargar los cursos.', 'error'));
  }, [notify]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/puntualidad/analitica`, {
        params: {
          desde: period.from,
          hasta: period.to,
          id_curso: courseId || undefined,
          justificado: justified || undefined,
          severidad: severity || undefined
        }
      });
      setData(response.data);
    } catch (error) {
      setData(null);
      notify(error.response?.data?.message || 'No fue posible calcular los indicadores.', 'error');
    } finally {
      setLoading(false);
    }
  }, [courseId, justified, notify, period.from, period.to, severity]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  useEffect(() => {
    if (!canViewInstitutional) { setInstitutional(null); return; }
    axios.get(`${API_URL}/analitica/institucional`, { params: { desde: period.from, hasta: period.to } })
      .then((response) => setInstitutional(response.data))
      .catch(() => setInstitutional(null));
  }, [canViewInstitutional, period.from, period.to]);

  const loadSchedules = useCallback(async () => {
    if (!canManageSchedules) { setSchedules([]); return; }
    try {
      const response = await axios.get(`${API_URL}/analitica/programaciones`);
      setSchedules(response.data || []);
    } catch {
      notify('No fue posible cargar los reportes automáticos.', 'error');
    }
  }, [canManageSchedules, notify]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const createSchedule = async (event) => {
    event.preventDefault();
    setScheduleSaving(true);
    try {
      await axios.post(`${API_URL}/analitica/programaciones`, scheduleForm);
      notify('Reporte automático programado correctamente.', 'success');
      await loadSchedules();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible programar el reporte.', 'error');
    } finally {
      setScheduleSaving(false);
    }
  };

  const toggleSchedule = async (schedule) => {
    try {
      await axios.patch(`${API_URL}/analitica/programaciones/${schedule.id_reporte}/estado`, { activo: !schedule.activo });
      await loadSchedules();
    } catch {
      notify('No fue posible cambiar el estado del reporte automático.', 'error');
    }
  };

  const exportInstitutional = async (format) => {
    try {
      const response = await axios.get(`${API_URL}/analitica/institucional/exportar`, {
        params: { desde: period.from, hasta: period.to, formato: format }, responseType: 'blob'
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `analitica-institucional-${period.from}-${period.to}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch { notify('No fue posible exportar la analítica institucional.', 'error'); }
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

  const openLateRecords = (course = null) => {
    const params = new URLSearchParams({ desde: period.from, hasta: period.to, estado: 'Atrasado' });
    const selectedCourse = course?.id_curso ?? courseId;
    if (course && !course.id_curso) params.set('curso_id', 'sin_curso');
    else if (selectedCourse) params.set('curso_id', String(selectedCourse));
    if (severity) params.set('severidad', severity);
    if (justified) params.set('justificado', justified);
    navigate(`/admin/atrasos?${params.toString()}`);
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
          <section className="analytics-kpi-grid">
            <AnalyticsMetric icon={ShieldCheck} value={summary.puntualidad_registrada === null ? '—' : `${summary.puntualidad_registrada}%`} label="Puntualidad registrada" detail="Sobre ingresos marcados" tone="green" />
            <AnalyticsMetric icon={Users} value={summary.ingresos} label="Ingresos registrados" detail={`${summary.a_tiempo} a tiempo`} tone="blue" />
            <AnalyticsMetric icon={AlertTriangle} value={summary.atrasos} label="Atrasos" detail={`${summary.leves} leves · ${summary.graves} graves · Ver detalle`} tone="amber" onClick={() => openLateRecords()} />
            <AnalyticsMetric icon={Clock3} value={summary.promedio_minutos_atraso ? `${summary.promedio_minutos_atraso} min` : '—'} label="Promedio de atraso" detail={`${summary.justificados} justificados`} tone="navy" />
          </section>

          <div className="analytics-scope-notice"><CheckCircle2 size={18} /><span>Ningún indicador interpreta la falta de escaneo como presencia o ausencia.</span></div>

          <section className="analytics-story-grid">
            <article className="analytics-panel analytics-panel--wide">
              <header><div><span className="section-kicker">Comportamiento diario</span><h2>Evolución de atrasos</h2></div><span className="panel-period">{period.from} · {period.to}</span></header>
              <DailyChart data={data.por_dia} />
            </article>
            <aside className="analytics-insight-panel">
              <span className="section-kicker">Lectura rápida</span><h2>Qué muestra el período</h2>
              {insight ? <div className="insight-stack"><article><AlertTriangle size={20} /><div><small>Día con más atrasos</small><strong>{formatShortDate(insight.peak.fecha)}</strong><span>{insight.peak.atrasos} de {insight.peak.ingresos} ingresos</span></div></article><article>{insight.trend === 'up' ? <TrendingUp size={20} /> : insight.trend === 'down' ? <TrendingDown size={20} /> : <Activity size={20} />}<div><small>Tendencia entre mitades</small><strong>{insight.trend === 'up' ? 'En aumento' : insight.trend === 'down' ? 'En descenso' : 'Estable'}</strong><span>{insight.change}% de variación aproximada</span></div></article><article><ShieldCheck size={20} /><div><small>Respaldos</small><strong>{summary.justificados}</strong><span>atrasos con respaldo de apoderado, médico o institucional</span></div></article></div> : <div className="analytics-empty">Aún no hay información suficiente.</div>}
            </aside>
          </section>

          <section className="analytics-detail-grid">
            <article className="analytics-panel"><header><div><span className="section-kicker">Distribución</span><h2>Minutos de atraso</h2></div></header><DistributionBars data={data.por_tramo} labelKey="tramo" /></article>
            <article className="analytics-panel"><header><div><span className="section-kicker">Cursos</span><h2>Atrasos por curso</h2></div><span className="panel-period">{courseBreakdown.length} curso{courseBreakdown.length === 1 ? '' : 's'}</span></header><DistributionBars data={visibleCourses} labelKey="curso" onSelect={openLateRecords} />{coursePages > 1 && <div className="analytics-panel__pagination"><button type="button" disabled={coursePage === 1} onClick={() => setCoursePage((current) => current - 1)}><ChevronLeft size={17} /> Anterior</button><span>Página {coursePage} de {coursePages}</span><button type="button" disabled={coursePage === coursePages} onClick={() => setCoursePage((current) => current + 1)}>Siguiente <ChevronRight size={17} /></button></div>}</article>
          </section>

          <section className="analytics-recurrence">
            <header><div><span className="section-kicker">Seguimiento</span><h2>Personas con recurrencia en el período</h2><p>Ordenadas por cantidad de atrasos efectivamente registrados.</p></div></header>
            <div className="recurrence-table-wrap"><table className="recurrence-table"><thead><tr><th>Persona</th><th>Curso</th><th>Atrasos</th><th>Graves</th><th>Nivel</th></tr></thead><tbody>{data.recurrentes.map((person, index) => <tr key={person.id_alumno}><td data-label="Persona"><span className="rank-number">{index + 1}</span><strong>{[person.nombres, person.paterno, person.materno].filter(Boolean).join(' ')}</strong></td><td data-label="Curso">{person.curso}</td><td data-label="Atrasos"><strong>{person.atrasos}</strong></td><td data-label="Graves">{person.graves}</td><td data-label="Nivel"><span className="recurrence-level" data-level={person.graves >= 3 ? 'critical' : person.atrasos >= 3 ? 'warning' : 'normal'}>{person.graves >= 3 ? 'Prioritario' : person.atrasos >= 3 ? 'Preventivo' : 'Observación'}</span></td></tr>)}</tbody></table>{!data.recurrentes.length && <div className="analytics-empty">No hay atrasos recurrentes con estos filtros.</div>}</div>
          </section>

          {institutional && <section className="institutional-analytics" aria-labelledby="institutional-title">
            <header className="institutional-analytics__header">
              <div><span className="section-kicker">Visión institucional</span><DevelopmentBadge /><h2 id="institutional-title">Analítica explicable</h2><p>Indicadores calculados con reglas visibles, sin puntajes opacos.</p></div>
              {canExportInstitutional && <div className="institutional-analytics__actions"><button type="button" onClick={() => exportInstitutional('pdf')}><Download size={17} /> PDF</button><button type="button" onClick={() => exportInstitutional('xlsx')}><FileSpreadsheet size={17} /> Excel</button></div>}
            </header>
            <div className="institutional-analytics__metrics">
              <AnalyticsMetric icon={TrendingDown} value={institutional.estudiantes_mejoraron.length} label="Estudiantes que mejoraron" detail="Comparación entre mitades" tone="green" />
              <AnalyticsMetric icon={Users} value={institutional.convivencia.abiertos} label="Casos abiertos" detail={`${institutional.convivencia.resueltos} resueltos`} tone="blue" />
              <AnalyticsMetric icon={Clock3} value={institutional.convivencia.promedio_dias_resolucion ? `${institutional.convivencia.promedio_dias_resolucion} días` : '—'} label="Resolución media" detail="Solo casos cerrados" tone="navy" />
              <AnalyticsMetric icon={ShieldCheck} value={institutional.contactos_apoderados.porcentaje_cierre === null ? '—' : `${institutional.contactos_apoderados.porcentaje_cierre}%`} label="Casos cerrados con contacto" detail="Correlación descriptiva" tone="amber" />
            </div>
            <div className="institutional-analytics__grid">
              <article className="analytics-panel"><header><div><span className="section-kicker">Horarios</span><h2>Bloques con más atrasos</h2></div></header><DistributionBars data={institutional.bloques_horarios.slice(0, 8)} labelKey="bloque" /></article>
              <article className="analytics-panel"><header><div><span className="section-kicker">Portería</span><h2>Motivos de visita</h2></div></header><DistributionBars data={institutional.motivos_visita.slice(0, 8)} valueKey="total" labelKey="motivo" suffix="visitas" /></article>
              <article className="analytics-panel"><header><div><span className="section-kicker">Retiros</span><h2>Retiros anticipados</h2></div></header><DistributionBars data={institutional.retiros_anticipados.slice(0, 8)} valueKey="total" labelKey="motivo" suffix="retiros" /></article>
              <article className="analytics-panel"><header><div><span className="section-kicker">Equipos</span><h2>Carga por área</h2></div></header><DistributionBars data={institutional.carga_trabajo.slice(0, 8)} valueKey="casos" labelKey="area" suffix="casos" /></article>
            </div>
            <article className="analytics-explanations"><header><AlertTriangle size={20} /><div><h2>Alertas con explicación</h2><p>Cada aviso muestra el dato y la regla exacta que lo activó.</p></div></header>{institutional.alertas.length ? institutional.alertas.map((alert) => <div className="analytics-explanation" key={`${alert.title}-${alert.rule}`} data-level={alert.level}><strong>{alert.title}</strong><span>{alert.explanation}</span><small>Regla: {alert.rule}</small></div>) : <div className="analytics-empty">No se activaron alertas en este período.</div>}</article>
            <details className="analytics-methodology"><summary>Cómo se calcularon estos indicadores</summary>{Object.values(institutional.metodologia).map((text) => <p key={text}>{text}</p>)}</details>
            {canManageSchedules && <article className="analytics-schedules" aria-labelledby="analytics-schedules-title">
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
            </article>}
          </section>}
        </> : <div className="analytics-empty analytics-empty--page">No fue posible mostrar el análisis.</div>}
      </div>
    </div>
  );
};

export default AnaliticasAdmin;
