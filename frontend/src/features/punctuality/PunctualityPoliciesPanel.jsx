import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CalendarDays, CheckCircle2, Clock3, GitCompareArrows, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { API_URL } from '../../config';
import { useFeedback } from '../../context/FeedbackContext';
import { PERMISSIONS, hasPermission } from '../../permissions';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days) => { const value = new Date(); value.setDate(value.getDate() - days); return value.toISOString().slice(0, 10); };
const studentLabel = (student) => `${student.nombres || ''} ${student.paterno || ''} ${student.materno || ''}`.replace(/\s+/g, ' ').trim();
const blankShift = () => ({ codigo: '', nombre: '', tipo: 'MANANA', hora_inicio: '07:30', hora_fin: '14:00', dias_semana: [1, 2, 3, 4, 5], cursos_ids: [] });
const blankCalendar = () => ({
  fecha: today(), nombre: '', tipo: 'SUSPENSION', reemplaza_controles: true, descripcion: '',
  control: { control_base_id: '', hora_apertura: '07:30', hora_referencia: '08:00', hora_inicio_atraso: '08:15', hora_cierre: '10:00' }
});
const blankException = () => ({ id_alumno: '', fecha_desde: today(), fecha_hasta: today(), motivo_codigo: '', detalle: '' });
const blankContingency = () => ({ fecha: today(), nombre: '', motivo_codigo: '', detalle: '', control_puntualidad_id: '', hora: '08:30', estudiantes_ids: [] });
const blankCommitment = () => ({ id_alumno: '', titulo: '', descripcion: '', fecha_inicio: today(), fecha_revision: today(), meta_atrasos_maxima: 0 });
const blankReason = () => ({ codigo: '', nombre: '', categoria: 'INSTITUCIONAL', requiere_detalle: true, excluye_alertas: false });

function StudentPicker({ value, onChange, multiple = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) return setResults([]);
      try { const response = await axios.get(`${API_URL}/students/search`, { params: { q: query.trim() } }); setResults(response.data || []); }
      catch { setResults([]); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return <div className="policy-student-picker">
    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar estudiante por nombre o identificador" />
    {selected.length > 0 && <div className="policy-selected">{selected.map((item) => <button type="button" key={item.id_alumno} onClick={() => onChange(multiple ? selected.filter((entry) => entry.id_alumno !== item.id_alumno) : null)}>{studentLabel(item)} ×</button>)}</div>}
    {results.length > 0 && <div className="policy-search-results">{results.map((student) => <button type="button" key={student.id_alumno} onClick={() => { onChange(multiple ? [...selected.filter((entry) => entry.id_alumno !== student.id_alumno), student] : student); setQuery(''); setResults([]); }}><strong>{studentLabel(student)}</strong><small>{student.nombre_curso || 'Sin curso'}</small></button>)}</div>}
  </div>;
}

export default function PunctualityPoliciesPanel({ user, controls, courses, onPoliciesChange }) {
  const { notify, confirm } = useFeedback();
  const [active, setActive] = useState('turnos');
  const [policies, setPolicies] = useState({ turnos: [], calendario: [], motivos: [] });
  const [exceptions, setExceptions] = useState([]);
  const [contingencies, setContingencies] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [shift, setShift] = useState(blankShift());
  const [calendar, setCalendar] = useState(blankCalendar());
  const [exception, setException] = useState(blankException());
  const [exceptionStudent, setExceptionStudent] = useState(null);
  const [contingency, setContingency] = useState(blankContingency());
  const [contingencyStudents, setContingencyStudents] = useState([]);
  const [commitment, setCommitment] = useState(blankCommitment());
  const [commitmentStudent, setCommitmentStudent] = useState(null);
  const [reason, setReason] = useState(blankReason());
  const [comparison, setComparison] = useState({ desde_1: daysAgo(60), hasta_1: daysAgo(31), desde_2: daysAgo(30), hasta_2: today(), curso_id: '' });
  const [comparisonResult, setComparisonResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const permissions = useMemo(() => ({
    shifts: hasPermission(user, PERMISSIONS.PUNCTUALITY_SHIFTS_MANAGE),
    calendar: hasPermission(user, PERMISSIONS.PUNCTUALITY_CALENDAR_MANAGE),
    exceptions: hasPermission(user, PERMISSIONS.PUNCTUALITY_EXCEPTIONS_MANAGE),
    contingencies: hasPermission(user, PERMISSIONS.PUNCTUALITY_CONTINGENCIES_MANAGE),
    commitments: hasPermission(user, PERMISSIONS.PUNCTUALITY_COMMITMENTS_MANAGE),
    improvements: hasPermission(user, PERMISSIONS.PUNCTUALITY_IMPROVEMENTS_VIEW)
  }), [user]);

  const load = useCallback(async () => {
    try {
      const requests = [axios.get(`${API_URL}/puntualidad/politicas`)];
      const keys = ['policies'];
      if (permissions.exceptions) { requests.push(axios.get(`${API_URL}/puntualidad/excepciones-estudiantes`)); keys.push('exceptions'); }
      if (permissions.contingencies) { requests.push(axios.get(`${API_URL}/puntualidad/contingencias`)); keys.push('contingencies'); }
      if (permissions.commitments) { requests.push(axios.get(`${API_URL}/puntualidad/compromisos`)); keys.push('commitments'); }
      const responses = await Promise.all(requests);
      responses.forEach((response, index) => {
        if (keys[index] === 'policies') { setPolicies(response.data); onPoliciesChange?.(response.data); }
        if (keys[index] === 'exceptions') setExceptions(response.data || []);
        if (keys[index] === 'contingencies') setContingencies(response.data || []);
        if (keys[index] === 'commitments') setCommitments(response.data || []);
      });
    } catch (error) { notify(error.response?.data?.message || 'No fue posible cargar las políticas institucionales.', 'error'); }
  }, [notify, onPoliciesChange, permissions]);
  useEffect(() => { load(); }, [load]);

  const submit = async (request, success, reset) => {
    setBusy(true);
    try { await request(); notify(success, 'success'); reset?.(); await load(); }
    catch (error) { notify(error.response?.data?.message || 'No fue posible guardar el cambio.', 'error'); }
    finally { setBusy(false); }
  };
  const tabs = [
    permissions.shifts && ['turnos', 'Jornadas y turnos', Clock3],
    permissions.calendar && ['calendario', 'Calendario especial', CalendarDays],
    permissions.exceptions && ['excepciones', 'Excepciones', ShieldCheck],
    permissions.contingencies && ['contingencias', 'Contingencias', Users],
    permissions.commitments && ['compromisos', 'Compromisos', CheckCircle2],
    permissions.improvements && ['comparacion', 'Mejoras', GitCompareArrows]
  ].filter(Boolean);
  useEffect(() => { if (tabs.length && !tabs.some(([id]) => id === active)) setActive(tabs[0][0]); }, [active, tabs]);
  if (!tabs.length) return null;

  return <section className="settings-section policy-center">
    <div className="settings-section__heading policy-center__heading"><span>03</span><div><h2>Políticas institucionales</h2><p>Turnos, días especiales, excepciones, contingencias y seguimiento con trazabilidad.</p></div><button type="button" className="control-add-button" onClick={load}><RefreshCw size={17} /> Actualizar</button></div>
    <nav className="policy-tabs">{tabs.map(([id, label, Icon]) => <button type="button" aria-selected={active === id} key={id} onClick={() => setActive(id)}><Icon size={17} /> {label}</button>)}</nav>

    {active === 'turnos' && <div className="policy-layout"><form onSubmit={(event) => { event.preventDefault(); submit(() => axios.post(`${API_URL}/puntualidad/turnos`, shift), 'Turno creado y disponible para asignar controles.', () => setShift(blankShift())); }}><h3>Nuevo turno</h3><input placeholder="Código interno" value={shift.codigo} onChange={(event) => setShift({ ...shift, codigo: event.target.value })} required /><input placeholder="Nombre visible" value={shift.nombre} onChange={(event) => setShift({ ...shift, nombre: event.target.value })} required /><div className="policy-fields"><label>Inicio<input type="time" value={shift.hora_inicio} onChange={(event) => setShift({ ...shift, hora_inicio: event.target.value })} /></label><label>Término<input type="time" value={shift.hora_fin} onChange={(event) => setShift({ ...shift, hora_fin: event.target.value })} /></label></div><fieldset className="policy-course-selector"><legend>Cursos o niveles del turno</legend><p>Si no marcas cursos, se podrá usar en todo el establecimiento.</p>{courses.map((course) => <label key={course.id_curso}><input type="checkbox" checked={shift.cursos_ids.includes(Number(course.id_curso))} onChange={(event) => setShift({ ...shift, cursos_ids: event.target.checked ? [...shift.cursos_ids, Number(course.id_curso)] : shift.cursos_ids.filter((id) => id !== Number(course.id_curso)) })} />{course.nombre_curso}</label>)}</fieldset><button disabled={busy}><Plus size={17} /> Crear turno</button></form><div><h3>Turnos configurados</h3>{policies.turnos.map((item) => <article className="policy-row" key={item.id}><div><strong>{item.nombre}</strong><small>{String(item.hora_inicio).slice(0,5)}–{String(item.hora_fin).slice(0,5)} · {item.controles} controles · {item.cursos_ids?.length ? `${item.cursos_ids.length} cursos` : 'todos los cursos'}</small></div><span className={item.activo ? 'is-active' : ''}>{item.activo ? 'Activo' : 'Inactivo'}</span></article>)}</div></div>}

    {active === 'calendario' && <div className="policy-layout"><form onSubmit={(event) => { event.preventDefault(); const special = calendar.tipo === 'HORARIO_ESPECIAL'; const payload = { ...calendar, controles: special ? [calendar.control] : [], reemplaza_controles: calendar.tipo === 'SUSPENSION' || special }; delete payload.control; submit(() => axios.post(`${API_URL}/puntualidad/calendario-excepciones`, payload), 'Día especial incorporado al calendario.', () => setCalendar(blankCalendar())); }}><h3>Registrar día especial</h3><input type="date" value={calendar.fecha} onChange={(event) => setCalendar({ ...calendar, fecha: event.target.value })} /><select value={calendar.tipo} onChange={(event) => setCalendar({ ...calendar, tipo: event.target.value })}><option value="SUSPENSION">Suspensión</option><option value="HORARIO_ESPECIAL">Horario excepcional</option><option value="ACTIVIDAD">Actividad institucional</option><option value="CONTINGENCIA">Contingencia</option></select><input placeholder="Nombre del evento" value={calendar.nombre} onChange={(event) => setCalendar({ ...calendar, nombre: event.target.value })} required />{calendar.tipo === 'HORARIO_ESPECIAL' && <div className="policy-special-hours"><select value={calendar.control.control_base_id} onChange={(event) => setCalendar({ ...calendar, control: { ...calendar.control, control_base_id: event.target.value } })} required><option value="">Control base que será reemplazado</option>{controls.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select><div className="policy-date-grid">{[['hora_apertura','Apertura'],['hora_referencia','Hora oficial'],['hora_inicio_atraso','Inicio atraso'],['hora_cierre','Cierre']].map(([key,label]) => <label key={key}>{label}<input type="time" value={calendar.control[key]} onChange={(event) => setCalendar({ ...calendar, control: { ...calendar.control, [key]: event.target.value } })} /></label>)}</div></div>}<textarea placeholder="Descripción y alcance" value={calendar.descripcion} onChange={(event) => setCalendar({ ...calendar, descripcion: event.target.value })} /><button disabled={busy}>Guardar en calendario</button></form><div><h3>Calendario excepcional</h3>{policies.calendario.map((item) => <article className="policy-row" key={item.id}><div><strong>{item.nombre}</strong><small>{String(item.fecha).slice(0,10)} · {item.tipo.replaceAll('_',' ')} · {item.controles_excepcionales || 0} controles excepcionales</small></div>{item.activo ? <button type="button" onClick={async () => { const accepted = await confirm({ title: 'Desactivar día especial', message: 'Los registros históricos conservarán las reglas que ya fueron aplicadas.', confirmLabel: 'Desactivar' }); if (accepted) submit(() => axios.patch(`${API_URL}/puntualidad/calendario-excepciones/${item.id}/desactivar`, { motivo: 'Día especial desactivado por revisión institucional.' }), 'Día especial desactivado.'); }}>Desactivar</button> : <span>Desactivado</span>}</article>)}</div></div>}

    {active === 'excepciones' && <div className="policy-layout"><div><form onSubmit={(event) => { event.preventDefault(); const payload = { ...exception, id_alumno: exceptionStudent?.id_alumno }; submit(() => axios.post(`${API_URL}/puntualidad/excepciones-estudiantes`, payload), 'Excepción registrada sin borrar el ingreso ni su regla histórica.', () => { setException(blankException()); setExceptionStudent(null); }); }}><h3>Excepción individual</h3><StudentPicker value={exceptionStudent} onChange={setExceptionStudent} /><div className="policy-fields"><label>Desde<input type="date" value={exception.fecha_desde} onChange={(event) => setException({ ...exception, fecha_desde: event.target.value })} /></label><label>Hasta<input type="date" value={exception.fecha_hasta} onChange={(event) => setException({ ...exception, fecha_hasta: event.target.value })} /></label></div><select value={exception.motivo_codigo} onChange={(event) => setException({ ...exception, motivo_codigo: event.target.value })} required><option value="">Motivo institucional</option>{policies.motivos.filter((item) => item.activo).map((item) => <option key={item.codigo} value={item.codigo}>{item.nombre}</option>)}</select><textarea placeholder="Fundamento y respaldo informado" value={exception.detalle} onChange={(event) => setException({ ...exception, detalle: event.target.value })} required /><button disabled={busy || !exceptionStudent}>Registrar excepción</button></form><form className="policy-secondary-form" onSubmit={(event) => { event.preventDefault(); submit(() => axios.post(`${API_URL}/puntualidad/motivos-institucionales`, reason), 'Motivo institucional incorporado.', () => setReason(blankReason())); }}><h3>Nuevo motivo institucional</h3><div className="policy-fields"><input placeholder="Código" value={reason.codigo} onChange={(event) => setReason({ ...reason, codigo: event.target.value })} /><select value={reason.categoria} onChange={(event) => setReason({ ...reason, categoria: event.target.value })}><option value="INSTITUCIONAL">Institucional</option><option value="TRANSPORTE">Transporte</option><option value="CONTINGENCIA">Contingencia</option><option value="FAMILIAR">Familiar</option><option value="OTRA">Otra</option></select></div><input placeholder="Nombre del motivo" value={reason.nombre} onChange={(event) => setReason({ ...reason, nombre: event.target.value })} /><label className="policy-checkbox"><input type="checkbox" checked={reason.excluye_alertas} onChange={(event) => setReason({ ...reason, excluye_alertas: event.target.checked })} />Excluir de alertas preventivas</label><button disabled={busy}>Crear motivo</button></form></div><div><h3>Excepciones registradas</h3>{exceptions.map((item) => <article className="policy-row" key={item.id}><div><strong>{item.estudiante}</strong><small>{item.motivo_nombre} · {String(item.fecha_desde).slice(0,10)} a {String(item.fecha_hasta).slice(0,10)}</small></div>{item.estado === 'VIGENTE' ? <button type="button" onClick={async () => { const accepted = await confirm({ title: 'Revocar excepción', message: 'Los registros anteriores conservarán su trazabilidad.', confirmLabel: 'Revocar' }); if (accepted) submit(() => axios.patch(`${API_URL}/puntualidad/excepciones-estudiantes/${item.id}/revocar`, { motivo: 'Excepción revocada tras revisión institucional.' }), 'Excepción revocada.'); }}>Revocar</button> : <span>{item.estado}</span>}</article>)}</div></div>}

    {active === 'contingencias' && <div className="policy-layout"><form onSubmit={(event) => { event.preventDefault(); const payload = { ...contingency, estudiantes_ids: contingencyStudents.map((item) => item.id_alumno) }; submit(() => axios.post(`${API_URL}/puntualidad/contingencias`, payload), 'Contingencia aplicada con registros individuales auditables.', () => { setContingency(blankContingency()); setContingencyStudents([]); }); }}><h3>Registro masivo controlado</h3><StudentPicker multiple value={contingencyStudents} onChange={setContingencyStudents} /><div className="policy-fields"><input type="date" value={contingency.fecha} onChange={(event) => setContingency({ ...contingency, fecha: event.target.value })} /><input type="time" value={contingency.hora} onChange={(event) => setContingency({ ...contingency, hora: event.target.value })} /></div><select value={contingency.control_puntualidad_id} onChange={(event) => setContingency({ ...contingency, control_puntualidad_id: event.target.value })} required><option value="">Control horario</option>{controls.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select><select value={contingency.motivo_codigo} onChange={(event) => setContingency({ ...contingency, motivo_codigo: event.target.value })} required><option value="">Motivo institucional</option>{policies.motivos.filter((item) => item.activo).map((item) => <option key={item.codigo} value={item.codigo}>{item.nombre}</option>)}</select><input placeholder="Nombre de la contingencia" value={contingency.nombre} onChange={(event) => setContingency({ ...contingency, nombre: event.target.value })} /><textarea placeholder="Detalle institucional" value={contingency.detalle} onChange={(event) => setContingency({ ...contingency, detalle: event.target.value })} /><button disabled={busy || !contingencyStudents.length}>Aplicar contingencia</button></form><div><h3>Contingencias</h3>{contingencies.map((item) => <article className="policy-row" key={item.id}><div><strong>{item.nombre}</strong><small>{String(item.fecha).slice(0,10)} · {item.registros_generados} registros</small></div>{item.estado === 'ABIERTA' ? <button type="button" onClick={async () => { const accepted = await confirm({ title: 'Cerrar contingencia', message: 'Los registros individuales se conservarán.', confirmLabel: 'Cerrar' }); if (accepted) submit(() => axios.patch(`${API_URL}/puntualidad/contingencias/${item.id}/cerrar`, { estado: 'CERRADA', motivo: 'Contingencia revisada y cerrada institucionalmente.' }), 'Contingencia cerrada.'); }}>Cerrar</button> : <span>{item.estado}</span>}</article>)}</div></div>}

    {active === 'compromisos' && <div className="policy-layout"><form onSubmit={(event) => { event.preventDefault(); const payload = { ...commitment, id_alumno: commitmentStudent?.id_alumno }; submit(() => axios.post(`${API_URL}/puntualidad/compromisos`, payload), 'Compromiso de puntualidad creado.', () => { setCommitment(blankCommitment()); setCommitmentStudent(null); }); }}><h3>Nuevo compromiso</h3><StudentPicker value={commitmentStudent} onChange={setCommitmentStudent} /><input placeholder="Título" value={commitment.titulo} onChange={(event) => setCommitment({ ...commitment, titulo: event.target.value })} /><textarea placeholder="Acuerdo, meta y acompañamiento" value={commitment.descripcion} onChange={(event) => setCommitment({ ...commitment, descripcion: event.target.value })} /><div className="policy-fields"><label>Inicio<input type="date" value={commitment.fecha_inicio} onChange={(event) => setCommitment({ ...commitment, fecha_inicio: event.target.value })} /></label><label>Revisión<input type="date" value={commitment.fecha_revision} onChange={(event) => setCommitment({ ...commitment, fecha_revision: event.target.value })} /></label></div><button disabled={busy || !commitmentStudent}>Crear compromiso</button></form><div><h3>Seguimiento</h3>{commitments.map((item) => <article className="policy-row" key={item.id}><div><strong>{item.estudiante}</strong><small>{item.titulo} · revisión {String(item.fecha_revision).slice(0,10)}</small></div>{item.estado === 'ACTIVO' ? <button type="button" onClick={async () => { const accepted = await confirm({ title: 'Cerrar compromiso', message: 'Se registrará el resultado final sin eliminar el seguimiento.', confirmLabel: 'Cerrar como cumplido' }); if (accepted) submit(() => axios.patch(`${API_URL}/puntualidad/compromisos/${item.id}/cerrar`, { estado: 'CUMPLIDO', resultado: 'Compromiso revisado y cumplido según seguimiento institucional.' }), 'Compromiso cerrado.'); }}>Cerrar</button> : <span>{item.estado}</span>}</article>)}</div></div>}

    {active === 'comparacion' && <div className="policy-comparison"><form onSubmit={(event) => { event.preventDefault(); setBusy(true); axios.get(`${API_URL}/puntualidad/comparacion-periodos`, { params: comparison }).then((response) => setComparisonResult(response.data)).catch((error) => notify(error.response?.data?.message || 'No fue posible comparar los períodos.', 'error')).finally(() => setBusy(false)); }}><h3>Comparar períodos equivalentes</h3><div className="policy-date-grid">{['desde_1','hasta_1','desde_2','hasta_2'].map((key) => <label key={key}>{key.replace('_',' ').replace('desde','Desde').replace('hasta','Hasta')}<input type="date" value={comparison[key]} onChange={(event) => setComparison({ ...comparison, [key]: event.target.value })} /></label>)}</div><select value={comparison.curso_id} onChange={(event) => setComparison({ ...comparison, curso_id: event.target.value })}><option value="">Todos los cursos</option>{courses.map((item) => <option key={item.id_curso} value={item.id_curso}>{item.nombre_curso}</option>)}</select><button disabled={busy}>Comparar con criterio explicable</button></form>{comparisonResult && <div><p className="policy-criterion">{comparisonResult.criterio}</p>{comparisonResult.resultados.slice(0,100).map((item) => <article className="policy-row" key={`${item.id_alumno}-${item.id_curso}`}><div><strong>{studentLabel(item)}</strong><small>{item.atrasos_1} → {item.atrasos_2} atrasos · {item.minutos_1} → {item.minutos_2} min</small></div><span className={item.mejoro ? 'is-active' : ''}>{item.mejoro ? 'Mejoró' : 'Sin mejora'}</span></article>)}</div>}</div>}
  </section>;
}
