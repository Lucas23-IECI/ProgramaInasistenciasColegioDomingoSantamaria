import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  FilePlus2,
  FolderLock,
  Handshake,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { PERMISSIONS, hasPermission } from './permissions';
import DevelopmentBadge from './components/DevelopmentBadge';

const API = '/api/convivencia';

const CATEGORIES = [
  ['CONVIVENCIA', 'Situación de convivencia'],
  ['CONFLICTO', 'Conflicto'],
  ['ACOSO', 'Acoso'],
  ['VIOLENCIA', 'Violencia'],
  ['DISCRIMINACION', 'Discriminación'],
  ['VULNERACION', 'Posible vulneración'],
  ['OTRO', 'Otro antecedente'],
];
const PRIORITIES = [['BAJA', 'Baja'], ['MEDIA', 'Media'], ['ALTA', 'Alta'], ['URGENTE', 'Urgente']];
const STATES = [
  ['', 'Todos los estados'],
  ['ABIERTO', 'Abierto'],
  ['EN_SEGUIMIENTO', 'En seguimiento'],
  ['EN_REVISION', 'En revisión'],
  ['CERRADO', 'Cerrado'],
  ['ANULADO', 'Anulado'],
];
const EVENT_TYPES = [
  ['MEDIDA', 'Medida adoptada'],
  ['ENTREVISTA', 'Entrevista'],
  ['MEDIACION', 'Mediación'],
  ['ACUERDO', 'Acuerdo'],
  ['SEGUIMIENTO', 'Seguimiento'],
  ['DERIVACION', 'Derivación'],
  ['REVISION', 'Revisión del caso'],
];
const PARTICIPANT_ROLES = [
  ['AFECTADO', 'Persona afectada'],
  ['INVOLUCRADO', 'Persona involucrada'],
  ['TESTIGO', 'Testigo'],
  ['APODERADO', 'Apoderado/a'],
  ['PROFESIONAL', 'Profesional interviniente'],
  ['OTRO', 'Otro vínculo'],
];

const labelFrom = (options, value) => options.find(([key]) => key === value)?.[1] || value;
const formatDate = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
  : 'Sin fecha';
const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Sin fecha';
const today = () => new Date().toISOString().slice(0, 10);
const toInputDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};
const errorMessage = (error, fallback) => error?.response?.data?.message || fallback;

const Modal = ({ title, eyebrow, onClose, children, actions, wide = false }) => {
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="coex-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`coex-modal${wide ? ' coex-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coex-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="coex-modal__header">
          <div>
            {eyebrow && <span className="section-kicker">{eyebrow}</span>}
            <h2 id="coex-modal-title">{title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="coex-icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>
        <div className="coex-modal__body">{children}</div>
        {actions && <footer className="coex-modal__actions">{actions}</footer>}
      </section>
    </div>
  );
};

const ParticipantComposer = ({ value, onChange, allowMany = true }) => {
  const [mode, setMode] = useState('INSTITUCIONAL');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [role, setRole] = useState('INVOLUCRADO');
  const [externalName, setExternalName] = useState('');
  const [externalDetail, setExternalDetail] = useState('');

  useEffect(() => {
    if (mode !== 'INSTITUCIONAL' || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await axios.get(`${API}/personas/buscar`, { params: { q: query.trim() }, signal: controller.signal });
        setResults(response.data || []);
      } catch (error) {
        if (error.code !== 'ERR_CANCELED') setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query]);

  const append = (participant) => {
    const key = `${participant.tipo_persona}-${participant.estudiante_id || participant.usuario_id || participant.nombre_externo}`;
    const next = allowMany ? [...value.filter((item) => item._key !== key), { ...participant, _key: key }] : [{ ...participant, _key: key }];
    onChange(next);
  };

  const addResult = (person) => {
    append({
      tipo_persona: person.tipo_persona,
      estudiante_id: person.tipo_persona === 'ESTUDIANTE' ? person.referencia_id : null,
      usuario_id: person.tipo_persona === 'PERSONAL' ? person.referencia_id : null,
      rol_en_caso: role,
      nombre: person.nombre,
      referencia: person.detalle,
    });
    setQuery('');
    setResults([]);
  };

  const addExternal = () => {
    if (externalName.trim().length < 2) return;
    append({
      tipo_persona: 'EXTERNA',
      nombre_externo: externalName.trim(),
      rol_en_caso: role,
      detalle_relacion: externalDetail.trim() || null,
      nombre: externalName.trim(),
      referencia: externalDetail.trim() || 'Persona externa',
    });
    setExternalName('');
    setExternalDetail('');
  };

  return (
    <div className="coex-participant-composer">
      <div className="coex-segmented" aria-label="Origen de la persona">
        <button type="button" className={mode === 'INSTITUCIONAL' ? 'is-active' : ''} onClick={() => setMode('INSTITUCIONAL')}>Estudiante o personal</button>
        <button type="button" className={mode === 'EXTERNA' ? 'is-active' : ''} onClick={() => setMode('EXTERNA')}>Persona externa</button>
      </div>
      <label className="coex-field">
        <span>Participación en el caso</span>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {PARTICIPANT_ROLES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {mode === 'INSTITUCIONAL' ? (
        <div className="coex-search-picker">
          <label className="coex-field">
            <span>Buscar persona</span>
            <div className="coex-input-icon"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Escribe nombre o correo" /></div>
          </label>
          {query.trim().length >= 2 && (
            <div className="coex-search-results" role="listbox" aria-label="Resultados">
              {searching && <p>Buscando…</p>}
              {!searching && results.length === 0 && <p>No hay coincidencias.</p>}
              {results.map((person) => (
                <button key={`${person.tipo_persona}-${person.referencia_id}`} type="button" onClick={() => addResult(person)}>
                  <strong>{person.nombre}</strong><span>{person.detalle} · {person.tipo_persona === 'ESTUDIANTE' ? 'Estudiante' : 'Personal'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="coex-form-grid coex-form-grid--two">
          <label className="coex-field"><span>Nombre completo</span><input value={externalName} onChange={(event) => setExternalName(event.target.value)} /></label>
          <label className="coex-field"><span>Antecedente del vínculo</span><input value={externalDetail} onChange={(event) => setExternalDetail(event.target.value)} placeholder="Ej. apoderado, profesional externo" /></label>
          <button type="button" className="coex-button coex-button--secondary" onClick={addExternal} disabled={externalName.trim().length < 2}><UserPlus size={18} /> Agregar persona</button>
        </div>
      )}
      {value.length > 0 && (
        <div className="coex-selected-people" aria-label="Personas seleccionadas">
          {value.map((person) => (
            <div key={person._key}>
              <span><strong>{person.nombre}</strong><small>{labelFrom(PARTICIPANT_ROLES, person.rol_en_caso)} · {person.referencia}</small></span>
              <button type="button" onClick={() => onChange(value.filter((item) => item._key !== person._key))} aria-label={`Quitar a ${person.nombre}`}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SummaryButton = ({ icon: Icon, value, label, detail, active, onClick, tone = '' }) => (
  <button type="button" className={`coex-summary__item ${tone ? `coex-summary__item--${tone}` : ''}${active ? ' is-active' : ''}`} onClick={onClick}>
    <span className="coex-summary__icon"><Icon size={23} /></span>
    <span><strong>{value ?? '—'}</strong><b>{label}</b><small>{detail}</small></span>
  </button>
);

const CoexistenceList = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const canCreate = hasPermission(user, PERMISSIONS.COEXISTENCE_CREATE);
  const [summary, setSummary] = useState(null);
  const [data, setData] = useState({ items: [], total: 0, pagina: 1, limite: 20 });
  const [filters, setFilters] = useState({ q: '', estado: '', prioridad: '', revision_pendiente: false, pagina: 1 });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [form, setForm] = useState({
    titulo: '', categoria: 'CONVIVENCIA', prioridad: 'MEDIA', fecha_situacion: today(),
    proxima_revision: '', descripcion_inicial: ''
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, q: filters.q.trim() };
      const [summaryResponse, casesResponse] = await Promise.all([
        axios.get(`${API}/resumen`),
        axios.get(`${API}/casos`, { params })
      ]);
      setSummary(summaryResponse.data);
      setData(casesResponse.data);
    } catch (error) {
      notify(errorMessage(error, 'No fue posible cargar Convivencia Escolar.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, notify]);

  useEffect(() => { load(); }, [load]);

  const createCase = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/casos`, { ...form, proxima_revision: form.proxima_revision || null, participantes: participants });
      notify(`Caso ${response.data.codigo} registrado.`, 'success');
      setShowCreate(false);
      navigate(`/admin/convivencia/${response.data.id_caso}`);
    } catch (error) {
      notify(errorMessage(error, 'No fue posible registrar el caso.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const setFilter = (patch) => setFilters((current) => ({ ...current, ...patch, pagina: patch.pagina || 1 }));
  const createReady = form.titulo.trim().length >= 5
    && form.descripcion_inicial.trim().length >= 10
    && Boolean(form.fecha_situacion)
    && participants.length > 0;

  return (
    <main className="coex-page">
      <header className="coex-page-header" data-tour="page-header">
        <div className="coex-page-header__identity">
          <span className="coex-page-header__icon"><ShieldCheck size={28} /></span>
          <div><span className="section-kicker">Módulo reservado</span><DevelopmentBadge /><h1>Convivencia escolar</h1><p>Situaciones, medidas, acuerdos y seguimientos con acceso restringido.</p></div>
        </div>
        <div className="coex-page-header__actions">
          <span className="coex-private-badge"><LockKeyhole size={16} /> Información protegida</span>
          <button type="button" className="coex-button coex-button--secondary" onClick={load} disabled={loading}><RefreshCw size={18} /> Actualizar</button>
          {canCreate && <button type="button" className="coex-button coex-button--primary" onClick={() => setShowCreate(true)}><Plus size={18} /> Registrar situación</button>}
          <button type="button" className="coex-button coex-button--ghost" onClick={() => navigate('/admin')}><ArrowLeft size={18} /> Panel principal</button>
        </div>
      </header>

      <section className="coex-summary" aria-label="Resumen de casos" data-tour="coexistence-summary">
        <SummaryButton icon={FolderLock} value={summary?.activos} label="Casos activos" detail="Abiertos o en gestión" active={!filters.estado && !filters.revision_pendiente} onClick={() => setFilter({ estado: '', revision_pendiente: false })} />
        <SummaryButton icon={Handshake} value={summary?.en_seguimiento} label="En seguimiento" detail="Con acciones en curso" active={filters.estado === 'EN_SEGUIMIENTO'} onClick={() => setFilter({ estado: 'EN_SEGUIMIENTO', revision_pendiente: false })} tone="blue" />
        <SummaryButton icon={CalendarClock} value={summary?.revisiones_pendientes} label="Revisiones pendientes" detail="Con fecha vencida o para hoy" active={filters.revision_pendiente} onClick={() => setFilter({ estado: '', revision_pendiente: true })} tone="amber" />
        <SummaryButton icon={CheckCircle2} value={summary?.cerrados_mes} label="Cerrados este mes" detail="Con cierre registrado" active={filters.estado === 'CERRADO'} onClick={() => setFilter({ estado: 'CERRADO', revision_pendiente: false })} tone="green" />
      </section>

      <section className="coex-workspace" data-tour="coexistence-cases">
        <div className="coex-workspace__heading">
          <div><span className="section-kicker">Registro institucional</span><h2>Casos de convivencia</h2><p>{data.total} {data.total === 1 ? 'caso encontrado' : 'casos encontrados'}</p></div>
        </div>
        <div className="coex-filters">
          <label className="coex-field coex-field--search"><span>Buscar caso o persona</span><div className="coex-input-icon"><Search size={18} /><input value={filters.q} onChange={(event) => setFilter({ q: event.target.value })} placeholder="Código, título o persona involucrada" /></div></label>
          <label className="coex-field"><span>Estado</span><select value={filters.estado} onChange={(event) => setFilter({ estado: event.target.value, revision_pendiente: false })}>{STATES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="coex-field"><span>Prioridad</span><select value={filters.prioridad} onChange={(event) => setFilter({ prioridad: event.target.value })}><option value="">Todas</option>{PRIORITIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>

        {loading ? (
          <div className="coex-empty"><RefreshCw className="coex-spin" size={30} /><h3>Cargando casos protegidos…</h3></div>
        ) : data.items.length === 0 ? (
          <div className="coex-empty"><ShieldCheck size={34} /><h3>No hay casos con estos filtros</h3><p>Ajusta la búsqueda o registra una nueva situación si corresponde.</p></div>
        ) : (
          <div className="coex-case-list">
            {data.items.map((item) => {
              const reviewDue = item.proxima_revision && item.estado !== 'CERRADO' && String(item.proxima_revision).slice(0, 10) <= today();
              return (
                <button key={item.id_caso} type="button" className="coex-case-row" onClick={() => navigate(`/admin/convivencia/${item.id_caso}`)}>
                  <span className={`coex-priority coex-priority--${item.prioridad.toLowerCase()}`}>{labelFrom(PRIORITIES, item.prioridad)}</span>
                  <span className="coex-case-row__main"><small>{item.codigo}</small><strong>{item.titulo}</strong><span>{labelFrom(CATEGORIES, item.categoria)} · {item.participantes} personas · {item.actuaciones} actuaciones</span></span>
                  <span className="coex-case-row__responsible"><small>Responsable</small><strong>{item.responsable_nombre || 'Sin asignar'}</strong></span>
                  <span className={`coex-review-date${reviewDue ? ' is-due' : ''}`}><CalendarClock size={17} /><span><small>Próxima revisión</small><strong>{formatDate(item.proxima_revision)}</strong></span></span>
                  <span className={`coex-state coex-state--${item.estado.toLowerCase()}`}>{labelFrom(STATES, item.estado)}</span>
                  <ChevronRight size={20} />
                </button>
              );
            })}
          </div>
        )}
        {data.total > data.limite && (
          <div className="coex-pagination">
            <button type="button" disabled={data.pagina <= 1} onClick={() => setFilter({ pagina: data.pagina - 1 })}>Anterior</button>
            <span>Página {data.pagina} de {Math.ceil(data.total / data.limite)}</span>
            <button type="button" disabled={data.pagina >= Math.ceil(data.total / data.limite)} onClick={() => setFilter({ pagina: data.pagina + 1 })}>Siguiente</button>
          </div>
        )}
      </section>

      {showCreate && (
        <Modal
          wide
          eyebrow="Apertura controlada"
          title="Registrar situación de convivencia"
          onClose={() => !saving && setShowCreate(false)}
          actions={<><button type="button" className="coex-button coex-button--secondary" onClick={() => setShowCreate(false)} disabled={saving}>Cancelar</button><button type="button" className="coex-button coex-button--primary" onClick={createCase} disabled={saving || !createReady}>{saving ? 'Guardando…' : 'Crear caso protegido'}</button></>}
        >
          <div className="coex-privacy-notice"><ShieldAlert size={22} /><div><strong>Registra solo antecedentes pertinentes</strong><p>El acceso queda limitado a cuentas autorizadas. La auditoría registra la operación sin duplicar el relato sensible.</p></div></div>
          <div className="coex-form-grid coex-form-grid--two">
            <label className="coex-field coex-field--span-2"><span>Título breve del caso</span><input value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} maxLength={180} /></label>
            <label className="coex-field"><span>Categoría</span><select value={form.categoria} onChange={(event) => setForm({ ...form, categoria: event.target.value })}>{CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="coex-field"><span>Prioridad de gestión</span><select value={form.prioridad} onChange={(event) => setForm({ ...form, prioridad: event.target.value })}>{PRIORITIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="coex-field"><span>Fecha de la situación</span><input type="date" value={form.fecha_situacion} onChange={(event) => setForm({ ...form, fecha_situacion: event.target.value })} /></label>
            <label className="coex-field"><span>Primera fecha de revisión</span><input type="date" value={form.proxima_revision} onChange={(event) => setForm({ ...form, proxima_revision: event.target.value })} min={form.fecha_situacion} /></label>
            <label className="coex-field coex-field--span-2"><span>Descripción inicial</span><textarea rows="5" value={form.descripcion_inicial} onChange={(event) => setForm({ ...form, descripcion_inicial: event.target.value })} placeholder="Describe hechos observables, contexto y antecedentes necesarios para iniciar la gestión." /></label>
          </div>
          <div className="coex-subsection"><h3><Users size={20} /> Personas involucradas</h3><p>Debe existir al menos una persona vinculada antes de abrir el caso.</p><ParticipantComposer value={participants} onChange={setParticipants} /></div>
        </Modal>
      )}
    </main>
  );
};

const CoexistenceDetail = ({ caseId }) => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const canManage = hasPermission(user, PERMISSIONS.COEXISTENCE_MANAGE);
  const canDocuments = hasPermission(user, PERMISSIONS.COEXISTENCE_DOCUMENTS);
  const canClose = hasPermission(user, PERMISSIONS.COEXISTENCE_CLOSE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  const [participantDraft, setParticipantDraft] = useState([]);
  const [eventForm, setEventForm] = useState({ tipo: 'MEDIDA', titulo: '', detalle: '', resultado: '', fecha_evento: toInputDateTime(), proxima_revision: '', participantes: [] });
  const [caseForm, setCaseForm] = useState(null);
  const [closeReason, setCloseReason] = useState('');
  const [documentForm, setDocumentForm] = useState({ file: null, descripcion: '', id_evento: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/casos/${caseId}`);
      setData(response.data);
    } catch (error) {
      notify(errorMessage(error, 'No fue posible cargar el caso.'), 'error');
      if (error?.response?.status === 404) navigate('/admin/convivencia');
    } finally {
      setLoading(false);
    }
  }, [caseId, navigate, notify]);
  useEffect(() => { load(); }, [load]);

  const runAction = async (action, success) => {
    setSaving(true);
    try {
      await action();
      notify(success, 'success');
      setDialog(null);
      await load();
    } catch (error) {
      notify(errorMessage(error, 'No fue posible completar la operación.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveParticipant = () => {
    if (!participantDraft[0]) return;
    runAction(() => axios.post(`${API}/casos/${caseId}/participantes`, participantDraft[0]), 'Persona agregada al caso.');
  };
  const saveEvent = () => runAction(
    () => axios.post(`${API}/casos/${caseId}/actuaciones`, { ...eventForm, proxima_revision: eventForm.proxima_revision || null }),
    'Actuación registrada con trazabilidad.'
  );
  const saveCase = () => runAction(
    () => axios.patch(`${API}/casos/${caseId}`, { ...caseForm, proxima_revision: caseForm.proxima_revision || null, version: data.case.version }),
    'Caso actualizado.'
  );
  const closeOrReopen = () => runAction(
    () => axios.post(`${API}/casos/${caseId}/${data.case.estado === 'CERRADO' ? 'reabrir' : 'cerrar'}`, { motivo: closeReason }),
    data.case.estado === 'CERRADO' ? 'Caso reabierto para seguimiento.' : 'Caso cerrado con trazabilidad.'
  );
  const saveDocument = async () => {
    if (!documentForm.file) return;
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(documentForm.file);
    });
    return runAction(
      () => axios.post(`${API}/casos/${caseId}/documentos`, {
        archivo: fileData,
        nombre_archivo: documentForm.file.name,
        descripcion: documentForm.descripcion,
        id_evento: documentForm.id_evento || null
      }),
      'Documento protegido adjuntado.'
    );
  };
  const downloadDocument = async (document) => {
    try {
      const response = await axios.get(`${API}/documentos/${document.id_convivencia_documento}/descargar`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.nombre_original;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(errorMessage(error, 'No fue posible descargar el documento.'), 'error');
    }
  };

  if (loading) return <main className="coex-page"><div className="coex-empty coex-empty--page"><RefreshCw className="coex-spin" size={34} /><h2>Cargando caso protegido…</h2></div></main>;
  if (!data) return null;
  const item = data.case;
  const closed = item.estado === 'CERRADO' || item.estado === 'ANULADO';

  return (
    <main className="coex-page coex-page--detail">
      <header className="coex-case-header" data-tour="page-header">
        <button type="button" className="coex-back-link" onClick={() => navigate('/admin/convivencia')}><ArrowLeft size={18} /> Volver a casos</button>
        <div className="coex-case-header__body">
          <div>
            <span className="section-kicker">{item.codigo} · Caso reservado</span>
            <h1>{item.titulo}</h1>
            <p>{labelFrom(CATEGORIES, item.categoria)} · Situación del {formatDate(item.fecha_situacion)}</p>
          </div>
          <div className="coex-case-header__status"><span className={`coex-priority coex-priority--${item.prioridad.toLowerCase()}`}>{labelFrom(PRIORITIES, item.prioridad)}</span><span className={`coex-state coex-state--${item.estado.toLowerCase()}`}>{labelFrom(STATES, item.estado)}</span></div>
        </div>
        <div className="coex-case-actions" data-tour="coexistence-actions">
          {canManage && !closed && <button type="button" className="coex-button coex-button--secondary" onClick={() => { setCaseForm({ titulo: item.titulo, categoria: item.categoria, prioridad: item.prioridad, estado: item.estado, proxima_revision: item.proxima_revision ? String(item.proxima_revision).slice(0, 10) : '', responsable_usuario_id: item.responsable_usuario_id }); setDialog('edit'); }}>Editar ficha</button>}
          {canManage && !closed && <button type="button" className="coex-button coex-button--secondary" onClick={() => { setParticipantDraft([]); setDialog('participant'); }}><UserPlus size={18} /> Agregar persona</button>}
          {canManage && !closed && <button type="button" className="coex-button coex-button--primary" onClick={() => setDialog('event')}><Plus size={18} /> Registrar actuación</button>}
          {canDocuments && !closed && <button type="button" className="coex-button coex-button--secondary" onClick={() => setDialog('document')}><Paperclip size={18} /> Adjuntar documento</button>}
          {canClose && <button type="button" className={`coex-button ${closed ? 'coex-button--secondary' : 'coex-button--danger'}`} onClick={() => { setCloseReason(''); setDialog('close'); }}>{closed ? 'Reabrir caso' : 'Cerrar caso'}</button>}
        </div>
      </header>

      <section className="coex-case-facts">
        <div><small>Responsable</small><strong>{item.responsable_nombre || 'Sin asignar'}</strong></div>
        <div><small>Próxima revisión</small><strong>{formatDate(item.proxima_revision)}</strong></div>
        <div><small>Personas vinculadas</small><strong>{data.participants.length}</strong></div>
        <div><small>Actuaciones</small><strong>{data.events.length}</strong></div>
        <div><small>Última actualización</small><strong>{formatDateTime(item.actualizado_en)}</strong></div>
      </section>

      <div className="coex-detail-layout">
        <div className="coex-detail-main">
          <section className="coex-detail-section">
            <header><div><span className="section-kicker">Antecedente inicial</span><h2>Situación registrada</h2></div><MessageSquareText size={24} /></header>
            <p className="coex-narrative">{item.descripcion_inicial}</p>
          </section>
          <section className="coex-detail-section" data-tour="coexistence-timeline">
            <header><div><span className="section-kicker">Trazabilidad</span><h2>Historial del caso</h2></div><ClipboardCheck size={24} /></header>
            <div className="coex-timeline">
              {data.events.map((event) => (
                <article key={event.id_evento} className={`coex-timeline__event coex-timeline__event--${event.tipo.toLowerCase()}`}>
                  <div className="coex-timeline__marker" />
                  <div className="coex-timeline__content">
                    <div className="coex-timeline__meta"><span>{labelFrom(EVENT_TYPES, event.tipo) || event.tipo}</span><time>{formatDateTime(event.fecha_evento)}</time></div>
                    <h3>{event.titulo}</h3>
                    <p>{event.detalle}</p>
                    {event.resultado && <div className="coex-result"><strong>Resultado</strong><p>{event.resultado}</p></div>}
                    <footer><span>Registrado por {event.creado_por_nombre}</span>{event.proxima_revision && <span>Revisión: {formatDate(event.proxima_revision)}</span>}</footer>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="coex-detail-aside">
          <section className="coex-side-section">
            <header><Users size={20} /><div><h2>Personas involucradas</h2><p>{data.participants.length} vinculadas</p></div></header>
            <div className="coex-people-list">
              {data.participants.map((person) => (
                <div key={person.id_participante}><span className="coex-person-avatar">{person.nombre?.slice(0, 1)}</span><span><strong>{person.nombre}</strong><small>{labelFrom(PARTICIPANT_ROLES, person.rol_en_caso)} · {person.referencia}</small></span></div>
              ))}
            </div>
          </section>
          <section className="coex-side-section">
            <header><FolderLock size={20} /><div><h2>Documentos</h2><p>{data.documents.length} archivos protegidos</p></div></header>
            <div className="coex-document-list">
              {data.documents.length === 0 && <p className="coex-side-empty">No hay documentos adjuntos.</p>}
              {data.documents.map((document) => (
                <button key={document.id_convivencia_documento} type="button" onClick={() => downloadDocument(document)} disabled={!canDocuments}>
                  <FileDown size={19} /><span><strong>{document.nombre_original}</strong><small>{document.descripcion || formatDateTime(document.creado_en)}</small></span>
                </button>
              ))}
            </div>
          </section>
          <div className="coex-confidentiality"><LockKeyhole size={20} /><p><strong>Acceso especialmente protegido</strong>Consulta y descargas requieren permisos explícitos y dejan trazabilidad institucional.</p></div>
        </aside>
      </div>

      {dialog === 'participant' && (
        <Modal title="Agregar persona al caso" eyebrow="Personas involucradas" onClose={() => !saving && setDialog(null)} actions={<><button type="button" className="coex-button coex-button--secondary" onClick={() => setDialog(null)}>Cancelar</button><button type="button" className="coex-button coex-button--primary" disabled={saving || !participantDraft[0]} onClick={saveParticipant}>{saving ? 'Guardando…' : 'Agregar persona'}</button></>}>
          <ParticipantComposer value={participantDraft} onChange={setParticipantDraft} allowMany={false} />
        </Modal>
      )}
      {dialog === 'event' && (
        <Modal wide title="Registrar actuación" eyebrow="Seguimiento del caso" onClose={() => !saving && setDialog(null)} actions={<><button type="button" className="coex-button coex-button--secondary" onClick={() => setDialog(null)}>Cancelar</button><button type="button" className="coex-button coex-button--primary" disabled={saving || eventForm.titulo.trim().length < 3 || eventForm.detalle.trim().length < 5} onClick={saveEvent}>{saving ? 'Guardando…' : 'Registrar actuación'}</button></>}>
          <div className="coex-form-grid coex-form-grid--two">
            <label className="coex-field"><span>Tipo de actuación</span><select value={eventForm.tipo} onChange={(event) => setEventForm({ ...eventForm, tipo: event.target.value })}>{EVENT_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="coex-field"><span>Fecha y hora</span><input type="datetime-local" value={eventForm.fecha_evento} onChange={(event) => setEventForm({ ...eventForm, fecha_evento: event.target.value })} /></label>
            <label className="coex-field coex-field--span-2"><span>Título</span><input value={eventForm.titulo} onChange={(event) => setEventForm({ ...eventForm, titulo: event.target.value })} /></label>
            <label className="coex-field coex-field--span-2"><span>Detalle</span><textarea rows="5" value={eventForm.detalle} onChange={(event) => setEventForm({ ...eventForm, detalle: event.target.value })} /></label>
            <label className="coex-field"><span>Resultado o compromiso</span><textarea rows="3" value={eventForm.resultado} onChange={(event) => setEventForm({ ...eventForm, resultado: event.target.value })} /></label>
            <label className="coex-field"><span>Próxima revisión</span><input type="date" value={eventForm.proxima_revision} onChange={(event) => setEventForm({ ...eventForm, proxima_revision: event.target.value })} /></label>
          </div>
          <fieldset className="coex-checklist"><legend>Personas que participaron</legend>{data.participants.map((person) => <label key={person.id_participante}><input type="checkbox" checked={eventForm.participantes.includes(person.id_participante)} onChange={(event) => setEventForm({ ...eventForm, participantes: event.target.checked ? [...eventForm.participantes, person.id_participante] : eventForm.participantes.filter((id) => id !== person.id_participante) })} /><span><strong>{person.nombre}</strong><small>{labelFrom(PARTICIPANT_ROLES, person.rol_en_caso)}</small></span></label>)}</fieldset>
        </Modal>
      )}
      {dialog === 'edit' && caseForm && (
        <Modal title="Editar ficha del caso" eyebrow={item.codigo} onClose={() => !saving && setDialog(null)} actions={<><button type="button" className="coex-button coex-button--secondary" onClick={() => setDialog(null)}>Cancelar</button><button type="button" className="coex-button coex-button--primary" disabled={saving} onClick={saveCase}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></>}>
          <div className="coex-form-grid coex-form-grid--two">
            <label className="coex-field coex-field--span-2"><span>Título</span><input value={caseForm.titulo} onChange={(event) => setCaseForm({ ...caseForm, titulo: event.target.value })} /></label>
            <label className="coex-field"><span>Categoría</span><select value={caseForm.categoria} onChange={(event) => setCaseForm({ ...caseForm, categoria: event.target.value })}>{CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="coex-field"><span>Prioridad</span><select value={caseForm.prioridad} onChange={(event) => setCaseForm({ ...caseForm, prioridad: event.target.value })}>{PRIORITIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="coex-field"><span>Estado operativo</span><select value={caseForm.estado} onChange={(event) => setCaseForm({ ...caseForm, estado: event.target.value })}><option value="ABIERTO">Abierto</option><option value="EN_SEGUIMIENTO">En seguimiento</option><option value="EN_REVISION">En revisión</option></select></label>
            <label className="coex-field"><span>Próxima revisión</span><input type="date" value={caseForm.proxima_revision} onChange={(event) => setCaseForm({ ...caseForm, proxima_revision: event.target.value })} /></label>
          </div>
        </Modal>
      )}
      {dialog === 'document' && (
        <Modal title="Adjuntar documento protegido" eyebrow="Documentación del caso" onClose={() => !saving && setDialog(null)} actions={<><button type="button" className="coex-button coex-button--secondary" onClick={() => setDialog(null)}>Cancelar</button><button type="button" className="coex-button coex-button--primary" disabled={saving || !documentForm.file} onClick={saveDocument}>{saving ? 'Procesando…' : 'Adjuntar documento'}</button></>}>
          <div className="coex-file-drop"><FilePlus2 size={30} /><label><strong>{documentForm.file?.name || 'Seleccionar PDF, PNG o JPG'}</strong><span>Máximo 8 MB. El archivo se almacena fuera del acceso público.</span><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setDocumentForm({ ...documentForm, file: event.target.files?.[0] || null })} /></label></div>
          <label className="coex-field"><span>Descripción</span><input value={documentForm.descripcion} onChange={(event) => setDocumentForm({ ...documentForm, descripcion: event.target.value })} placeholder="Ej. acta de entrevista o antecedente recibido" /></label>
          <label className="coex-field"><span>Vincular a una actuación (opcional)</span><select value={documentForm.id_evento} onChange={(event) => setDocumentForm({ ...documentForm, id_evento: event.target.value })}><option value="">Documento general del caso</option>{data.events.map((event) => <option key={event.id_evento} value={event.id_evento}>{formatDate(event.fecha_evento)} · {event.titulo}</option>)}</select></label>
        </Modal>
      )}
      {dialog === 'close' && (
        <Modal title={closed ? 'Reabrir caso' : 'Cerrar caso'} eyebrow="Decisión institucional" onClose={() => !saving && setDialog(null)} actions={<><button type="button" className="coex-button coex-button--secondary" onClick={() => setDialog(null)}>Cancelar</button><button type="button" className={`coex-button ${closed ? 'coex-button--primary' : 'coex-button--danger'}`} disabled={saving || closeReason.trim().length < 10} onClick={closeOrReopen}>{saving ? 'Guardando…' : closed ? 'Reabrir para seguimiento' : 'Cerrar caso'}</button></>}>
          <div className="coex-privacy-notice"><ShieldAlert size={22} /><div><strong>{closed ? 'La reapertura quedará en el historial' : 'El cierre bloqueará nuevas actuaciones'}</strong><p>{closed ? 'El caso volverá al estado En seguimiento y conservará el cierre anterior en la línea de tiempo.' : 'Podrá reabrirse posteriormente solo con el permiso correspondiente.'}</p></div></div>
          <label className="coex-field"><span>Motivo y conclusión</span><textarea rows="6" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Explica la decisión, su fundamento y el estado de los acuerdos." /></label>
        </Modal>
      )}
    </main>
  );
};

const SchoolCoexistence = () => {
  const { caseId } = useParams();
  return caseId ? <CoexistenceDetail caseId={caseId} /> : <CoexistenceList />;
};

export default SchoolCoexistence;
