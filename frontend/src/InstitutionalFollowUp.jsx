import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle, ArrowLeft, Bot, CalendarDays, CheckCircle2, ChevronRight,
  ClipboardList, Download, FileText, Handshake, MessageCircle, MessageSquareText,
  PhoneCall, Plus, RefreshCw, Search, Settings2, ShieldAlert, Upload, UserRoundCheck, X
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { PERMISSIONS, hasPermission } from './permissions';
import DevelopmentBadge from './components/DevelopmentBadge';
import FollowUpAutomationDialog from './components/FollowUpAutomationDialog';

const API = '/api/seguimiento';
const STATES = [['', 'Todos'], ['ABIERTO', 'Abierto'], ['ASIGNADO', 'Asignado'], ['EN_CONTACTO', 'En contacto'], ['EN_SEGUIMIENTO', 'En seguimiento'], ['ESCALADO', 'Escalado'], ['RESUELTO', 'Resuelto'], ['CERRADO', 'Cerrado'], ['ANULADO', 'Anulado']];
const PRIORITIES = [['', 'Todas'], ['BAJA', 'Baja'], ['MEDIA', 'Media'], ['ALTA', 'Alta'], ['URGENTE', 'Urgente']];
const TASK_STATES = { PENDIENTE: 'Pendiente', EN_PROGRESO: 'En progreso', COMPLETADA: 'Completada', CANCELADA: 'Cancelada' };
const stateLabel = (value) => STATES.find(([key]) => key === value)?.[1] || value;
const priorityLabel = (value) => PRIORITIES.find(([key]) => key === value)?.[1] || value;
const date = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin fecha';
const dateTime = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';
const messageOf = (error, fallback) => error.response?.data?.message || fallback;

const Summary = ({ data, onFilter }) => {
  const items = [
    ['activos', 'Seguimientos activos', ClipboardList, ''],
    ['prioritarios', 'Alta prioridad', ShieldAlert, 'ALTA'],
    ['vencidos', 'Fuera de plazo', AlertTriangle, 'VENCIDOS'],
    ['sin_responsable', 'Sin responsable', UserRoundCheck, 'SIN_RESPONSABLE'],
  ];
  return <div className="follow-summary" aria-label="Resumen de seguimiento" data-tour="follow-summary">
    {items.map(([key, label, Icon, filter]) => <button key={key} type="button" onClick={() => onFilter(filter)}>
      <Icon size={21} /><span><strong>{data?.[key] || 0}</strong>{label}</span>
    </button>)}
  </div>;
};

const NewCaseDialog = ({ people, onClose, onCreated }) => {
  const { notify } = useFeedback();
  const [form, setForm] = useState({ titulo: '', motivo_apertura: '', prioridad: 'MEDIA', responsable_usuario_id: '', fecha_limite: '', estudiante_id: '' });
  const [studentQuery, setStudentQuery] = useState('');
  const [students, setStudents] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (studentQuery.trim().length < 2) { setStudents([]); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => axios.get(`${API}/estudiantes`, { params: { q: studentQuery }, signal: controller.signal }).then((r) => setStudents(r.data || [])).catch(() => {}), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [studentQuery]);
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await axios.post(`${API}/casos`, { ...form, estudiante_id: form.estudiante_id || null, responsable_usuario_id: form.responsable_usuario_id || null, fecha_limite: form.fecha_limite || null });
      notify('Seguimiento creado correctamente.', 'success'); onCreated(response.data.id_caso);
    } catch (error) { notify(messageOf(error, 'No fue posible crear el seguimiento.'), 'error'); }
    finally { setSaving(false); }
  };
  return <div className="follow-dialog-backdrop" onMouseDown={onClose}>
    <form className="follow-dialog" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
      <header><div><span className="section-kicker">Nuevo seguimiento</span><h2>Abrir caso institucional</h2><p>Registra el motivo, el estudiante y la persona responsable.</p></div><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <label>Título<input required minLength={4} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Seguimiento preventivo por puntualidad" /></label>
      <label>Motivo de apertura<textarea required minLength={8} value={form.motivo_apertura} onChange={(e) => setForm({ ...form, motivo_apertura: e.target.value })} placeholder="Explica el antecedente que origina el seguimiento." /></label>
      <div className="follow-form-grid">
        <label>Prioridad<select value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: e.target.value })}>{PRIORITIES.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Fecha límite<input type="date" value={form.fecha_limite} onChange={(e) => setForm({ ...form, fecha_limite: e.target.value })} /></label>
        <label>Responsable<select value={form.responsable_usuario_id} onChange={(e) => setForm({ ...form, responsable_usuario_id: e.target.value })}><option value="">Sin asignar</option>{people.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.cargo}</option>)}</select></label>
      </div>
      <label>Estudiante relacionado<input value={studentQuery} onChange={(e) => { setStudentQuery(e.target.value); setForm({ ...form, estudiante_id: '' }); }} placeholder="Buscar por nombre o identificador" /></label>
      {students.length > 0 && <div className="follow-search-results">{students.map((student) => <button type="button" key={student.id_alumno} className={String(form.estudiante_id) === String(student.id_alumno) ? 'selected' : ''} onClick={() => { setForm({ ...form, estudiante_id: student.id_alumno }); setStudentQuery(student.nombre); setStudents([]); }}><strong>{student.nombre}</strong><span>{student.curso} · {student.identificador}</span></button>)}</div>}
      <footer><button type="button" className="app-action app-action--secondary" onClick={onClose}>Cancelar</button><button className="app-action app-action--primary" disabled={saving}>{saving ? 'Creando…' : 'Crear seguimiento'}</button></footer>
    </form>
  </div>;
};

const CaseDetail = ({ caseId, people, onBack }) => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext); const { notify, confirm } = useFeedback();
  const [item, setItem] = useState(null); const [loading, setLoading] = useState(true); const [draft, setDraft] = useState(null);
  const [quick, setQuick] = useState({ type: 'nota', text: '', secondary: '' });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const canManage = hasPermission(user, PERMISSIONS.FOLLOW_UP_MANAGE);
  const load = useCallback(async () => { setLoading(true); try { const response = await axios.get(`${API}/casos/${caseId}`); setItem(response.data); setDraft(response.data); } catch (error) { notify(messageOf(error, 'No fue posible cargar el seguimiento.'), 'error'); } finally { setLoading(false); } }, [caseId, notify]);
  useEffect(() => { load(); }, [load]);
  const save = async () => { try { await axios.patch(`${API}/casos/${caseId}`, { titulo: draft.titulo, prioridad: draft.prioridad, estado: draft.estado, responsable_usuario_id: draft.responsable_usuario_id || null, fecha_limite: draft.fecha_limite?.slice(0, 10) || null }); notify('Seguimiento actualizado.', 'success'); load(); } catch (error) { notify(messageOf(error, 'No fue posible actualizar el seguimiento.'), 'error'); } };
  const submitQuick = async (event) => {
    event.preventDefault(); if (!quick.text.trim()) return;
    const routes = { nota: ['notas', { contenido: quick.text }], tarea: ['tareas', { titulo: quick.text, detalle: quick.secondary || null, prioridad: 'MEDIA', fecha_limite: null }], contacto: ['contactos', { tipo: 'LLAMADA', destinatario: quick.secondary || 'Apoderado', resultado: 'CONTACTADO', detalle: quick.text }], acuerdo: ['acuerdos', { descripcion: quick.text, responsable: quick.secondary || null, fecha_compromiso: null }] };
    const [route, body] = routes[quick.type];
    try { await axios.post(`${API}/casos/${caseId}/${route}`, body); setQuick({ ...quick, text: '', secondary: '' }); notify('Registro agregado al seguimiento.', 'success'); load(); } catch (error) { notify(messageOf(error, 'No fue posible agregar el registro.'), 'error'); }
  };
  const closeCase = async () => { const result = window.prompt('Describe el resultado final del seguimiento:'); if (!result) return; try { await axios.post(`${API}/casos/${caseId}/cerrar`, { estado: 'CERRADO', resultado_final: result, confirmar_tareas_pendientes: true }); notify('Seguimiento cerrado.', 'success'); load(); } catch (error) { notify(messageOf(error, 'No fue posible cerrar el seguimiento.'), 'error'); } };
  const escalate = async () => { if (!await confirm({ title: 'Derivar a Convivencia Escolar', message: 'Se creará un caso reservado de Convivencia vinculado a este seguimiento.', confirmLabel: 'Derivar' })) return; try { await axios.post(`${API}/casos/${caseId}/escalar-convivencia`); notify('Caso derivado a Convivencia Escolar.', 'success'); load(); } catch (error) { notify(messageOf(error, 'No fue posible derivar el seguimiento.'), 'error'); } };
  const uploadDocument = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return notify('El archivo supera el máximo de 8 MB.', 'error');
    setUploading(true);
    try {
      const fileData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      await axios.post(`${API}/casos/${caseId}/documentos`, { file_name: file.name, file_data: fileData, descripcion: 'Respaldo del seguimiento' });
      notify('Documento incorporado al seguimiento.', 'success'); await load();
    } catch (error) { notify(messageOf(error, 'No fue posible adjuntar el documento.'), 'error'); }
    finally { setUploading(false); }
  };
  if (loading) return <div className="follow-state">Cargando seguimiento…</div>;
  if (!item || !draft) return <div className="follow-state">El seguimiento no está disponible.</div>;
  const closed = ['CERRADO', 'ANULADO'].includes(item.estado);
  return <section className="follow-detail">
    <header className="follow-detail__header" data-tour="page-header"><button type="button" className="app-action app-action--secondary" onClick={onBack}><ArrowLeft size={17} /> Volver</button><div><span className="section-kicker">Seguimiento #{item.id_caso}</span><h2>{item.titulo}</h2><p>{item.estudiante || 'Caso institucional sin estudiante principal'}{item.nombre_curso ? ` · ${item.nombre_curso}` : ''}</p></div><span className={`follow-badge priority-${item.prioridad.toLowerCase()}`}>{priorityLabel(item.prioridad)}</span></header>
    <div className="follow-detail__layout">
      <div className="follow-detail__main">
        <section className="follow-panel"><h3>Gestión del caso</h3><p className="follow-reason">{item.motivo_apertura}</p>{canManage && !closed && <div className="follow-form-grid"><label>Estado<select value={draft.estado} onChange={(e) => setDraft({ ...draft, estado: e.target.value })}>{STATES.slice(1, 7).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Prioridad<select value={draft.prioridad} onChange={(e) => setDraft({ ...draft, prioridad: e.target.value })}>{PRIORITIES.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Responsable<select value={draft.responsable_usuario_id || ''} onChange={(e) => setDraft({ ...draft, responsable_usuario_id: e.target.value })}><option value="">Sin asignar</option>{people.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><label>Fecha límite<input type="date" value={draft.fecha_limite?.slice(0, 10) || ''} onChange={(e) => setDraft({ ...draft, fecha_limite: e.target.value })} /></label><button type="button" className="app-action app-action--primary" onClick={save}>Guardar cambios</button></div>}</section>
        {!closed && <form className="follow-panel follow-quick" onSubmit={submitQuick}><div className="follow-tabs">{[['nota', MessageSquareText, 'Nota'], ['tarea', ClipboardList, 'Tarea'], ['contacto', PhoneCall, 'Contacto'], ['acuerdo', Handshake, 'Acuerdo']].map(([v, Icon, l]) => <button type="button" key={v} className={quick.type === v ? 'active' : ''} onClick={() => setQuick({ type: v, text: '', secondary: '' })}><Icon size={16} />{l}</button>)}</div><textarea value={quick.text} onChange={(e) => setQuick({ ...quick, text: e.target.value })} placeholder={quick.type === 'nota' ? 'Escribe una nota interna…' : `Describe el ${quick.type}…`} /><div><input value={quick.secondary} onChange={(e) => setQuick({ ...quick, secondary: e.target.value })} placeholder={quick.type === 'contacto' ? 'Persona contactada' : quick.type === 'acuerdo' ? 'Responsable del acuerdo' : 'Detalle opcional'} /><button className="app-action app-action--primary">Agregar</button></div></form>}
        <section className="follow-panel"><h3>Línea de tiempo</h3><div className="follow-timeline">{(item.timeline || []).map((event) => <article key={event.id_evento}><i /><div><strong>{event.titulo}</strong><p>{event.detalle}</p><span>{dateTime(event.realizado_en)} · {event.realizado_por_nombre || 'Sistema'}</span></div></article>)}</div></section>
      </div>
      <aside className="follow-detail__aside"><section className="follow-panel"><h3>Estado actual</h3><dl><div><dt>Estado</dt><dd>{stateLabel(item.estado)}</dd></div><div><dt>Responsable</dt><dd>{item.responsable_nombre || 'Sin asignar'}</dd></div><div><dt>Fecha límite</dt><dd>{date(item.fecha_limite)}</dd></div><div><dt>Origen</dt><dd>{item.origen === 'AUTOMATICO' ? 'Detección automática' : 'Registro manual'}</dd></div></dl></section><section className="follow-panel"><h3>Tareas</h3>{(item.tasks || []).length === 0 ? <p>Sin tareas registradas.</p> : item.tasks.map((task) => <div className="follow-task" key={task.id_tarea}><CheckCircle2 size={17} /><span><strong>{task.titulo}</strong><small>{TASK_STATES[task.estado] || task.estado} · {date(task.fecha_limite)}</small></span>{canManage && !['COMPLETADA', 'CANCELADA'].includes(task.estado) && <button type="button" onClick={async () => { await axios.patch(`${API}/casos/${caseId}/tareas/${task.id_tarea}`, { estado: 'COMPLETADA' }); load(); }} aria-label={`Completar ${task.titulo}`}>Completar</button>}</div>)}</section><section className="follow-panel"><div className="follow-panel__heading"><h3>Documentos</h3>{hasPermission(user, PERMISSIONS.FOLLOW_UP_DOCUMENTS) && !closed && <><input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={uploadDocument} /><button type="button" className="follow-icon-action" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Adjuntar documento"><Upload size={16} /></button></>}</div>{(item.documents || []).length === 0 ? <p>Sin documentos adjuntos.</p> : <div className="follow-documents">{item.documents.map((document) => <a key={document.id_documento} href={`${API}/casos/${caseId}/documentos/${document.id_documento}`}><FileText size={16} /><span>{document.nombre_original}</span><Download size={14} /></a>)}</div>}</section><section className="follow-panel follow-actions"><h3>Coordinación</h3>{hasPermission(user, PERMISSIONS.CHAT_GROUP_CREATE) && <button type="button" onClick={() => navigate(`/chat?contexto_tipo=SEGUIMIENTO&contexto_id=${caseId}&contexto_nombre=${encodeURIComponent(item.titulo)}`)}><MessageCircle size={17} /> Abrir chat del caso</button>}<h3>Acciones sensibles</h3>{!item.convivencia_caso_id && !closed && <button type="button" onClick={escalate}><ShieldAlert size={17} /> Derivar a Convivencia</button>}{!closed && hasPermission(user, PERMISSIONS.FOLLOW_UP_CLOSE) && <button type="button" onClick={closeCase}><CheckCircle2 size={17} /> Cerrar seguimiento</button>}</section></aside>
    </div>
  </section>;
};

const InstitutionalFollowUp = () => {
  const { caseId } = useParams(); const navigate = useNavigate(); const { user } = useContext(AuthContext); const { notify, confirm } = useFeedback();
  const [summary, setSummary] = useState(null); const [cases, setCases] = useState([]); const [people, setPeople] = useState([]); const [loading, setLoading] = useState(true); const [dialog, setDialog] = useState(false); const [automationOpen, setAutomationOpen] = useState(false);
  const closeAutomation = useCallback(() => setAutomationOpen(false), []);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [runningRules, setRunningRules] = useState(false);
  const [filters, setFilters] = useState({ q: '', estado: '', prioridad: '', vencidos: false, sin_responsable: false });
  const load = useCallback(async () => { setLoading(true); try { const [summaryResult, caseResult, peopleResult] = await Promise.all([axios.get(`${API}/resumen`), axios.get(`${API}/casos`, { params: { ...filters, pagina: page, limite: 30 } }), axios.get(`${API}/personas`)]); setSummary(summaryResult.data); setCases(caseResult.data.cases || []); setTotal(caseResult.data.total || 0); setPeople(peopleResult.data || []); } catch (error) { notify(messageOf(error, 'No fue posible cargar Seguimiento Institucional.'), 'error'); } finally { setLoading(false); } }, [filters, page, notify]);
  useEffect(() => { if (!caseId) load(); }, [caseId, load]);
  useEffect(() => { if (!caseId || people.length > 0) return; axios.get(`${API}/personas`).then((response) => setPeople(response.data || [])).catch(() => {}); }, [caseId, people.length]);
  const runAutomation = async () => {
    setRunningRules(true);
    try {
      const preview = (await axios.get(`${API}/automatizaciones/previsualizar`)).data;
      if (!preview.detected) {
        notify('La previsualización no detectó condiciones que requieran seguimiento.', 'success');
        return;
      }
      const breakdown = (preview.by_rule || []).slice(0, 4)
        .map((rule) => `${rule.nombre}: ${rule.total}`).join(' · ');
      const accepted = await confirm({
        title: 'Confirmar creación de seguimientos',
        message: `La previsualización detectó ${preview.detected} condiciones para ${preview.affected_students || 0} estudiantes. ${breakdown}. Solo al confirmar se crearán o actualizarán casos; alumnos y atrasos de origen no se modificarán.`,
        confirmLabel: 'Crear seguimientos'
      });
      if (!accepted) return;
      const response = await axios.post(`${API}/automatizaciones/ejecutar`);
      notify(`Revisión completada: ${response.data.detected || 0} señales detectadas y ${response.data.created || 0} casos nuevos.`, 'success');
      load();
    } catch (error) { notify(messageOf(error, 'No fue posible ejecutar la revisión.'), 'error'); }
    finally { setRunningRules(false); }
  };
  if (caseId) return <main className="follow-page" data-tour="follow-detail"><CaseDetail caseId={caseId} people={people} onBack={() => navigate('/admin/seguimiento')} /></main>;
  return <main className="follow-page">
    <header className="follow-page__header" data-tour="page-header"><div><span className="section-kicker">Gestión preventiva</span><DevelopmentBadge /><h1>Seguimiento institucional</h1><p>Casos, contactos, acuerdos y tareas que necesitan una respuesta coordinada.</p></div><div className="follow-page__actions"><button className="app-action app-action--secondary" onClick={() => navigate('/admin')}><ArrowLeft size={17} /> Panel principal</button><button className="app-action app-action--secondary" onClick={load}><RefreshCw size={17} /> Actualizar</button>{hasPermission(user, PERMISSIONS.FOLLOW_UP_AUTOMATION_MANAGE) && <><button className="app-action app-action--secondary" onClick={() => setAutomationOpen(true)}><Settings2 size={17} /> Configurar reglas</button><button className="app-action app-action--secondary" onClick={runAutomation} disabled={runningRules}><Bot size={17} /> {runningRules ? 'Revisando…' : 'Revisar ahora'}</button></>}{hasPermission(user, PERMISSIONS.FOLLOW_UP_CREATE) && <button className="app-action app-action--primary" onClick={() => setDialog(true)}><Plus size={17} /> Nuevo seguimiento</button>}</div></header>
    <Summary data={summary} onFilter={(value) => { setPage(1); setFilters({ q: '', estado: '', prioridad: value === 'ALTA' ? 'ALTA' : '', vencidos: value === 'VENCIDOS', sin_responsable: value === 'SIN_RESPONSABLE' }); }} />
    <section className="follow-workspace"><div className="follow-filters"><label><Search size={18} /><input value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} placeholder="Buscar por estudiante, título o motivo" aria-label="Buscar seguimientos" /></label><select aria-label="Filtrar por estado" value={filters.estado} onChange={(e) => { setPage(1); setFilters({ ...filters, estado: e.target.value }); }}>{STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><select aria-label="Filtrar por prioridad" value={filters.prioridad} onChange={(e) => { setPage(1); setFilters({ ...filters, prioridad: e.target.value }); }}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      {loading ? <div className="follow-state">Cargando seguimientos…</div> : cases.length === 0 ? <div className="follow-state"><ClipboardList size={32} /><h2>No hay seguimientos con estos filtros</h2><p>Prueba otra búsqueda o ejecuta la revisión de reglas.</p></div> : <div className="follow-list" data-tour="follow-list">{cases.map((item) => <button key={item.id_caso} type="button" onClick={() => navigate(`/admin/seguimiento/${item.id_caso}`)}><span className={`follow-priority priority-${item.prioridad.toLowerCase()}`} /><div><div className="follow-list__top"><span className="follow-badge">{stateLabel(item.estado)}</span><small>{item.regla_codigo ? 'Automático' : 'Manual'}</small></div><h2>{item.titulo}</h2><p>{item.estudiante || 'Caso institucional'}{item.nombre_curso ? ` · ${item.nombre_curso}` : ''}</p><footer><span><UserRoundCheck size={15} /> {item.responsable_nombre || 'Sin responsable'}</span><span><CalendarDays size={15} /> {date(item.fecha_limite)}</span><span><ClipboardList size={15} /> {item.tareas_pendientes || 0} tareas</span></footer></div><ChevronRight /></button>)}</div>}
      {total > 30 && <nav className="follow-pagination" aria-label="Paginación de seguimientos"><button type="button" className="app-action app-action--secondary" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {page} de {Math.ceil(total / 30)} · {total} seguimientos</span><button type="button" className="app-action app-action--secondary" disabled={page >= Math.ceil(total / 30)} onClick={() => setPage((current) => current + 1)}>Siguiente</button></nav>}
    </section>
    {dialog && <NewCaseDialog people={people} onClose={() => setDialog(false)} onCreated={(id) => { setDialog(false); navigate(`/admin/seguimiento/${id}`); }} />}
    {automationOpen && <FollowUpAutomationDialog onClose={closeAutomation} onSaved={load} />}
  </main>;
};

export default InstitutionalFollowUp;
