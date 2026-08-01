import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router';
import {
  ArrowRight, Check, CheckCircle2, ContactRound, DoorOpen, History, LogOut,
  PackageCheck, Plus, Search, ShieldCheck, UserCheck, UserRound, UsersRound, X
} from 'lucide-react';
import { API_URL } from './config';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';
import AppSelect from './components/AppSelect';
import { formatChilePhoneInput, formatDocumentInput } from './utils/personFormat';
import { getStudentIdentifier, getStudentIdentifierLabel } from './utils/studentFormat';

const requestConfig = { withCredentials: true };
const emptyPerson = { tipo_documento: 'RUT', documento: '', nombre_completo: '', telefono: '' };
const emptyWithdrawal = {
  motivo_codigo: '',
  motivo_detalle: '',
  parentesco_declarado_codigo: '',
  parentesco_declarado_detalle: '',
  validacion_excepcional: { responsable: '', motivo: '' }
};
const studentName = (student) => [student?.nombres, student?.paterno, student?.materno].filter(Boolean).join(' ');
const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(value))
  : '—';
const stateLabel = (state) => ({
  DENTRO: 'Dentro',
  FINALIZADA: 'Salida registrada',
  SOLICITADO: 'Pendiente anterior',
  AUTORIZADO: 'Autorizado',
  ENTREGADO: 'Retiro completado',
  RECHAZADO: 'Rechazado',
  CANCELADO: 'Cancelado',
  ANULADA: 'Anulada'
}[state] || state);

const PersonFields = ({ value, onChange }) => {
  const update = (key, next) => onChange({ ...value, [key]: next });
  return (
    <div className="porter-person-fields">
      <label><span>Tipo de documento</span><AppSelect ariaLabel="Tipo de documento" value={value.tipo_documento} onChange={(type) => onChange({ ...value, tipo_documento: type, documento: formatDocumentInput(type, value.documento) })} options={[{ value: 'RUT', label: 'RUT chileno' }, { value: 'PASAPORTE', label: 'Pasaporte' }, { value: 'OTRO', label: 'Otro documento' }]} /></label>
      <label><span>Número de documento</span><input value={value.documento} onChange={(event) => update('documento', formatDocumentInput(value.tipo_documento, event.target.value))} placeholder={value.tipo_documento === 'RUT' ? '12.345.678-5' : 'Documento completo'} /></label>
      <label><span>Nombre completo</span><input value={value.nombre_completo} onChange={(event) => update('nombre_completo', event.target.value)} placeholder="Nombre y apellidos" /></label>
      <label><span>Teléfono <small>opcional</small></span><input value={value.telefono} onChange={(event) => update('telefono', formatChilePhoneInput(event.target.value))} placeholder="+56 9 1234 5678" /></label>
    </div>
  );
};

const PorteriaWorkspace = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify, confirm } = useFeedback();
  const [view, setView] = useState('inside');
  const [summary, setSummary] = useState({});
  const [catalogs, setCatalogs] = useState({ motivos: [], destinos: [], motivos_retiro: [], parentescos: [] });
  const [visits, setVisits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visitForm, setVisitForm] = useState({ visitante: emptyPerson, motivo_codigo: '', motivo_detalle: '', destino_codigo: '', persona_contactada: '', origen: 'LECTOR' });
  const [visitQuery, setVisitQuery] = useState('');
  const [visitMatches, setVisitMatches] = useState([]);
  const [visitIdentified, setVisitIdentified] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [guardianQuery, setGuardianQuery] = useState('');
  const [guardianMatches, setGuardianMatches] = useState([]);
  const [guardianSearching, setGuardianSearching] = useState(false);
  const [guardian, setGuardian] = useState(null);
  const [manualResponsible, setManualResponsible] = useState(false);
  const [responsible, setResponsible] = useState(emptyPerson);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentMatches, setStudentMatches] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [withdrawalForm, setWithdrawalForm] = useState(emptyWithdrawal);
  const [savingWithdrawal, setSavingWithdrawal] = useState(false);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [catalogResponse, summaryResponse, visitResponse, withdrawalResponse] = await Promise.all([
        axios.get(`${API_URL}/visitas/catalogos`, requestConfig),
        axios.get(`${API_URL}/visitas/resumen`, requestConfig),
        axios.get(`${API_URL}/visitas?limit=100`, requestConfig),
        axios.get(`${API_URL}/visitas/retiros`, requestConfig)
      ]);
      setCatalogs(catalogResponse.data);
      setSummary(summaryResponse.data || {});
      setVisits(visitResponse.data.rows || []);
      setWithdrawals(withdrawalResponse.data || []);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible actualizar Portería.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (guardianQuery.trim().length < 2 || guardian || manualResponsible) {
      setGuardianMatches([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setGuardianSearching(true);
      try {
        const response = await axios.get(`${API_URL}/visitas/apoderados/buscar`, { ...requestConfig, params: { q: guardianQuery.trim() } });
        setGuardianMatches(response.data || []);
      } catch (error) {
        notify(error.response?.data?.message || 'No fue posible consultar la ficha de apoderados.', 'error');
      } finally {
        setGuardianSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [guardian, guardianQuery, manualResponsible, notify]);

  useEffect(() => {
    if (studentQuery.trim().length < 2) {
      setStudentMatches([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await axios.get(`${API_URL}/visitas/estudiantes/buscar`, { ...requestConfig, params: { q: studentQuery.trim() } });
        setStudentMatches(response.data || []);
      } catch (error) {
        notify(error.response?.data?.message || 'No fue posible buscar estudiantes.', 'error');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [notify, studentQuery]);

  const linkedIds = useMemo(() => new Set((guardian?.estudiantes || []).map((student) => Number(student.id_alumno))), [guardian]);
  const unlinkedStudents = selectedStudents.filter((student) => !linkedIds.has(Number(student.id_alumno)));
  const requiresException = selectedStudents.length > 0 && (!guardian || unlinkedStudents.length > 0);
  const activeVisits = visits.filter((visit) => visit.estado === 'DENTRO');
  const todayVisits = visits.filter((visit) => new Date(visit.ingreso_en).toDateString() === new Date().toDateString());
  const selectedVisitReason = catalogs.motivos.find((item) => item.codigo === visitForm.motivo_codigo);
  const selectedVisitDestination = catalogs.destinos.find((item) => item.codigo === visitForm.destino_codigo);
  const selectedWithdrawalReason = catalogs.motivos_retiro.find((item) => item.codigo === withdrawalForm.motivo_codigo);
  const selectedRelationship = catalogs.parentescos.find((item) => item.codigo === withdrawalForm.parentesco_declarado_codigo);
  const visitReady = visitIdentified
    && visitForm.visitante.documento.trim().length >= 4
    && visitForm.visitante.nombre_completo.trim().length >= 3
    && Boolean(visitForm.motivo_codigo)
    && Boolean(visitForm.destino_codigo)
    && (!selectedVisitReason?.requiere_detalle || visitForm.motivo_detalle.trim().length >= 3)
    && (!selectedVisitDestination?.requiere_contacto || visitForm.persona_contactada.trim().length >= 3);
  const responsibleReady = Boolean(guardian) || (
    manualResponsible
    && responsible.documento.trim().length >= 4
    && responsible.nombre_completo.trim().length >= 3
  );
  const withdrawalReady = responsibleReady
    && selectedStudents.length > 0
    && Boolean(withdrawalForm.motivo_codigo)
    && (!selectedWithdrawalReason?.requiere_detalle || withdrawalForm.motivo_detalle.trim().length >= 5)
    && (!requiresException || (
      Boolean(withdrawalForm.parentesco_declarado_codigo)
      && (!selectedRelationship?.requiere_detalle || withdrawalForm.parentesco_declarado_detalle.trim().length >= 3)
      && withdrawalForm.validacion_excepcional.responsable.trim().length >= 3
      && withdrawalForm.validacion_excepcional.motivo.trim().length >= 8
    ));

  const toggleStudent = (student) => setSelectedStudents((current) => (
    current.some((item) => Number(item.id_alumno) === Number(student.id_alumno))
      ? current.filter((item) => Number(item.id_alumno) !== Number(student.id_alumno))
      : [...current, student]
  ));
  const resetWithdrawal = () => {
    setGuardianQuery(''); setGuardianMatches([]); setGuardian(null); setManualResponsible(false);
    setResponsible(emptyPerson); setStudentQuery(''); setStudentMatches([]); setSelectedStudents([]);
    setWithdrawalForm(emptyWithdrawal);
  };

  const searchVisitPerson = async () => {
    if (visitQuery.trim().length < 2) return;
    try {
      const response = await axios.get(`${API_URL}/visitas/visitantes/buscar`, { ...requestConfig, params: { q: visitQuery.trim() } });
      setVisitMatches(response.data || []);
      if (!response.data?.length) setVisitIdentified(true);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible buscar a la persona.', 'error');
    }
  };
  const selectVisitPerson = (person) => {
    setVisitForm((current) => ({ ...current, visitante: { tipo_documento: person.tipo_documento, documento: person.documento, nombre_completo: person.nombre_completo, telefono: person.telefono || '' } }));
    setVisitQuery(person.nombre_completo);
    setVisitMatches([]);
    setVisitIdentified(true);
  };
  const submitVisit = async (event) => {
    event.preventDefault();
    setSavingVisit(true);
    try {
      await axios.post(`${API_URL}/visitas`, visitForm, requestConfig);
      notify('Entrada registrada correctamente.', 'success');
      setVisitForm({ visitante: emptyPerson, motivo_codigo: '', motivo_detalle: '', destino_codigo: '', persona_contactada: '', origen: 'LECTOR' });
      setVisitQuery(''); setVisitMatches([]); setVisitIdentified(false); setView('inside');
      await loadData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible registrar la visita.', 'error');
    } finally {
      setSavingVisit(false);
    }
  };
  const registerCheckout = async (visit) => {
    const accepted = await confirm({ title: 'Registrar salida', message: `Confirma la salida de ${visit.visitante.nombre_completo}.`, confirmLabel: 'Registrar salida' });
    if (!accepted) return;
    try {
      await axios.patch(`${API_URL}/visitas/${visit.id}/salida`, {}, requestConfig);
      notify('Salida registrada.', 'success');
      await loadData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible registrar la salida.', 'error');
    }
  };
  const submitWithdrawal = async (event) => {
    event.preventDefault();
    if (!selectedStudents.length) return notify('Selecciona al menos un estudiante.', 'error');
    setSavingWithdrawal(true);
    try {
      const response = await axios.post(`${API_URL}/visitas/retiros/registrar-salida`, {
        ...withdrawalForm,
        id_alumnos: selectedStudents.map((student) => student.id_alumno),
        visitante_id: guardian?.id,
        visitante: guardian ? undefined : responsible
      }, requestConfig);
      notify(response.data.message, 'success');
      resetWithdrawal();
      setView('withdrawals');
      await loadData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible registrar el retiro.', 'error');
    } finally {
      setSavingWithdrawal(false);
    }
  };

  if (loading) return <div className="route-loader">Preparando Portería…</div>;
  return (
    <div className="visits-page porter-page">
      <main className="visits-shell">
        <ModuleHeader icon={ContactRound} title="Portería" description="Entradas, salidas, visitas y retiros desde un único puesto de trabajo." onBack={() => navigate('/admin')} onLogout={async () => { await logout(); navigate('/login'); }} />
        <section className="porter-status" data-tour="visits-summary">
          <div className="porter-status__heading"><div><span className="section-kicker">Situación actual</span><h2>Control de acceso del establecimiento</h2></div><span className="visits-live"><i /> Información en tiempo real</span></div>
          <div className="porter-metrics">
            <button type="button" onClick={() => setView('inside')} data-active={view === 'inside' || undefined}><UsersRound size={25} /><span><strong>{summary.dentro || 0}</strong><b>Personas dentro</b><small>Ver y registrar salida</small></span><ArrowRight size={18} /></button>
            <button type="button" onClick={() => setView('history')} data-active={view === 'history' || undefined}><DoorOpen size={25} /><span><strong>{summary.ingresos_hoy || 0}</strong><b>Ingresos de hoy</b><small>Revisar movimientos</small></span><ArrowRight size={18} /></button>
            <button type="button" onClick={() => setView('history')}><PackageCheck size={25} /><span><strong>{summary.salidas_hoy || 0}</strong><b>Salidas confirmadas</b><small>Ver historial de hoy</small></span><ArrowRight size={18} /></button>
            <button type="button" onClick={() => setView('withdrawals')} data-active={view === 'withdrawals' || undefined}><UserCheck size={25} /><span><strong>{summary.retiros_pendientes || 0}</strong><b>Retiros pendientes</b><small>Abrir retiros anteriores</small></span><ArrowRight size={18} /></button>
          </div>
        </section>
        <nav className="porter-actions" data-tour="visits-navigation">
          <button type="button" onClick={() => setView('inside')} data-active={view === 'inside' || undefined}><UsersRound size={20} /> Personas dentro</button>
          <button type="button" onClick={() => setView('visit')} data-active={view === 'visit' || undefined}><DoorOpen size={20} /> Registrar visita</button>
          <button type="button" onClick={() => setView('withdrawal')} data-active={view === 'withdrawal' || undefined}><UserCheck size={20} /> Registrar retiro</button>
          <button type="button" onClick={() => setView('history')} data-active={view === 'history' || undefined}><History size={20} /> Movimientos de hoy</button>
        </nav>

        {view === 'inside' && <section className="porter-panel"><header><div><span className="section-kicker">Acceso vigente</span><h2>Personas dentro</h2><p>{activeVisits.length} personas requieren registrar su salida.</p></div><button type="button" className="primary-action" onClick={() => setView('visit')}><Plus size={17} /> Nueva visita</button></header><div className="porter-list">{!activeVisits.length && <div className="visit-empty"><CheckCircle2 size={38} /><strong>No hay visitas activas</strong><span>Las nuevas entradas aparecerán aquí.</span></div>}{activeVisits.map((visit) => <article key={visit.id}><span className="visit-avatar">{visit.visitante.nombre_completo.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span><div><strong>{visit.visitante.nombre_completo}</strong><small>{visit.destino_nombre} · {visit.motivo_nombre}</small></div><span><small>Ingreso</small><strong>{formatDateTime(visit.ingreso_en)}</strong></span><button type="button" className="primary-action" onClick={() => registerCheckout(visit)}><LogOut size={16} /> Registrar salida</button></article>)}</div></section>}

        {view === 'visit' && <form className="porter-panel porter-form" onSubmit={submitVisit}><header><div><span className="section-kicker">Persona externa</span><h2>Registrar visita</h2><p>Busca una visita anterior o identifica a una persona nueva.</p></div></header><section className="porter-step"><div className="porter-step__title"><span>1</span><div><strong>Identificar a la persona</strong><small>Busca por nombre o RUT antes de crear una ficha.</small></div></div><div className="porter-search"><Search size={19} /><input value={visitQuery} onChange={(event) => { setVisitQuery(event.target.value); setVisitIdentified(false); setVisitMatches([]); setVisitForm((current) => ({ ...current, visitante: { ...emptyPerson } })); }} placeholder="Nombre o RUT de la persona" /><button type="button" onClick={searchVisitPerson}>Buscar</button></div>{visitMatches.length > 0 && <div className="porter-search-results">{visitMatches.map((person) => <button type="button" key={person.id} onClick={() => selectVisitPerson(person)}><UserRound size={18} /><span><strong>{person.nombre_completo}</strong><small>{person.documento_mostrado}</small></span><ArrowRight size={17} /></button>)}</div>}{!visitIdentified && visitQuery.trim().length >= 2 && <button type="button" className="porter-inline-action" onClick={() => { setVisitForm((current) => ({ ...current, visitante: { ...emptyPerson } })); setVisitIdentified(true); }}><Plus size={16} /> No aparece: identificar persona nueva</button>}{visitIdentified && <PersonFields value={visitForm.visitante} onChange={(visitante) => setVisitForm((current) => ({ ...current, visitante }))} />}</section><section className="porter-step"><div className="porter-step__title"><span>2</span><div><strong>Motivo y destino</strong><small>Indica a qué área se dirige.</small></div></div><div className="porter-form-grid"><label><span>Motivo</span><AppSelect ariaLabel="Motivo de la visita" value={visitForm.motivo_codigo} onChange={(value) => setVisitForm((current) => ({ ...current, motivo_codigo: value }))} options={[{ value: '', label: 'Seleccionar motivo' }, ...catalogs.motivos.map((item) => ({ value: item.codigo, label: item.nombre }))]} /></label><label><span>Destino</span><AppSelect ariaLabel="Destino de la visita" value={visitForm.destino_codigo} onChange={(value) => setVisitForm((current) => ({ ...current, destino_codigo: value }))} options={[{ value: '', label: 'Seleccionar dependencia' }, ...catalogs.destinos.map((item) => ({ value: item.codigo, label: item.nombre }))]} /></label><label><span>Persona contactada {selectedVisitDestination?.requiere_contacto ? <small>obligatoria</small> : <small>opcional</small>}</span><input value={visitForm.persona_contactada} onChange={(event) => setVisitForm((current) => ({ ...current, persona_contactada: event.target.value }))} placeholder="Ej: directora o docente" /></label><label><span>Detalle {selectedVisitReason?.requiere_detalle ? <small>obligatorio</small> : <small>opcional</small>}</span><input value={visitForm.motivo_detalle} onChange={(event) => setVisitForm((current) => ({ ...current, motivo_detalle: event.target.value }))} placeholder="Antecedente breve" /></label></div></section><footer><span><ShieldCheck size={18} /> La hora y la cuenta responsable quedan registradas.</span><button type="submit" className="primary-action" disabled={savingVisit || !visitReady}>{savingVisit ? 'Registrando…' : 'Confirmar entrada'} <ArrowRight size={18} /></button></footer></form>}

        {view === 'withdrawal' && <form className="porter-panel porter-form" onSubmit={submitWithdrawal}><header><div><span className="section-kicker">Salida de estudiantes</span><h2>Registrar retiro</h2><p>Busca primero a la persona responsable. Si existe en la ficha, sus estudiantes aparecerán automáticamente.</p></div></header><section className="porter-step"><div className="porter-step__title"><span>1</span><div><strong>Persona responsable</strong><small>Escribe su nombre o RUT.</small></div></div>{!guardian && !manualResponsible && <><div className="porter-search"><Search size={19} /><input value={guardianQuery} onChange={(event) => setGuardianQuery(event.target.value)} placeholder="Nombre o RUT del apoderado" /><span>{guardianSearching ? 'Buscando…' : ''}</span></div>{guardianMatches.length > 0 && <div className="porter-search-results">{guardianMatches.map((person) => <button type="button" key={person.id} onClick={() => { setGuardian(person); setGuardianQuery(person.nombre_completo); setSelectedStudents([]); }}><UserCheck size={18} /><span><strong>{person.nombre_completo}</strong><small>{person.documento_mostrado} · {person.estudiantes.length} estudiante(s)</small></span><ArrowRight size={17} /></button>)}</div>}{guardianQuery.trim().length >= 2 && !guardianSearching && <button type="button" className="porter-inline-action" onClick={() => setManualResponsible(true)}><Plus size={16} /> No aparece en la ficha: identificación completa</button>}</>}{guardian && <div className="porter-identified"><CheckCircle2 size={23} /><div><strong>{guardian.nombre_completo}</strong><small>{guardian.documento_mostrado} · Ficha vigente encontrada</small></div><button type="button" onClick={resetWithdrawal}>Cambiar</button></div>}{manualResponsible && <><PersonFields value={responsible} onChange={setResponsible} /><button type="button" className="porter-inline-action" onClick={resetWithdrawal}><X size={16} /> Volver a buscar en la ficha</button></>}</section>
        {(guardian || manualResponsible) && <section className="porter-step"><div className="porter-step__title"><span>2</span><div><strong>Seleccionar estudiantes</strong><small>Puedes marcar varios hermanos en el mismo retiro.</small></div></div>{guardian?.estudiantes?.length > 0 && <div className="porter-student-options">{guardian.estudiantes.map((student) => { const selected = selectedStudents.some((item) => Number(item.id_alumno) === Number(student.id_alumno)); return <button type="button" key={student.id_alumno} data-selected={selected || undefined} onClick={() => toggleStudent(student)}><span>{selected && <Check size={16} />}</span><div><strong>{studentName(student)}</strong><small>{student.nombre_curso || 'Sin curso'} · {student.parentesco}</small></div></button>; })}</div>}<div className="porter-search"><Search size={19} /><input value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder={guardian ? 'Agregar otro estudiante por nombre o identificador' : 'Buscar estudiante por nombre o identificador'} /></div>{studentMatches.length > 0 && <div className="porter-search-results">{studentMatches.map((student) => <button type="button" key={student.id_alumno} onClick={() => { toggleStudent(student); setStudentQuery(''); setStudentMatches([]); }}><UserRound size={18} /><span><strong>{studentName(student)}</strong><small>{student.nombre_curso || 'Sin curso'} · {getStudentIdentifierLabel(student)} {getStudentIdentifier(student)}</small></span><Plus size={17} /></button>)}</div>}{selectedStudents.length > 0 && <div className="porter-selected-students">{selectedStudents.map((student) => <span key={student.id_alumno}><UserRound size={15} /> {studentName(student)} <button type="button" onClick={() => toggleStudent(student)}><X size={14} /></button></span>)}</div>}</section>}
        {selectedStudents.length > 0 && <section className="porter-step"><div className="porter-step__title"><span>3</span><div><strong>Motivo y validación</strong><small>La validación adicional aparece solo si la ficha no cubre a todos.</small></div></div><div className="porter-form-grid"><label><span>Motivo del retiro</span><AppSelect ariaLabel="Motivo del retiro" value={withdrawalForm.motivo_codigo} onChange={(value) => setWithdrawalForm((current) => ({ ...current, motivo_codigo: value }))} options={[{ value: '', label: 'Seleccionar motivo' }, ...catalogs.motivos_retiro.map((item) => ({ value: item.codigo, label: item.nombre }))]} /></label><label><span>Justificación {selectedWithdrawalReason?.requiere_detalle ? <small>obligatoria</small> : <small>opcional</small>}</span><input value={withdrawalForm.motivo_detalle} onChange={(event) => setWithdrawalForm((current) => ({ ...current, motivo_detalle: event.target.value }))} placeholder="Antecedente breve informado" /></label></div>{!requiresException && <div className="porter-validation porter-validation--success"><ShieldCheck size={22} /><div><strong>Persona autorizada en la ficha</strong><span>Comprueba físicamente su documento antes de confirmar.</span></div></div>}{requiresException && <div className="porter-exception"><div className="porter-validation porter-validation--warning"><UserCheck size={22} /><div><strong>Se necesita validación excepcional</strong><span>{guardian ? `${unlinkedStudents.length} estudiante(s) no están vinculados a esta persona.` : 'La persona no aparece en la ficha.'} Registra quién confirmó la salida.</span></div></div><div className="porter-form-grid"><label><span>Relación con los estudiantes</span><AppSelect ariaLabel="Relación con los estudiantes" value={withdrawalForm.parentesco_declarado_codigo} onChange={(value) => setWithdrawalForm((current) => ({ ...current, parentesco_declarado_codigo: value }))} options={[{ value: '', label: 'Seleccionar relación' }, ...catalogs.parentescos.map((item) => ({ value: item.codigo, label: item.nombre }))]} /></label>{selectedRelationship?.requiere_detalle && <label><span>Especificar relación</span><input value={withdrawalForm.parentesco_declarado_detalle} onChange={(event) => setWithdrawalForm((current) => ({ ...current, parentesco_declarado_detalle: event.target.value }))} /></label>}<label><span>Quién confirmó la salida</span><input value={withdrawalForm.validacion_excepcional.responsable} onChange={(event) => setWithdrawalForm((current) => ({ ...current, validacion_excepcional: { ...current.validacion_excepcional, responsable: event.target.value } }))} placeholder="Nombre y cargo" /></label><label><span>Fundamento informado</span><input value={withdrawalForm.validacion_excepcional.motivo} onChange={(event) => setWithdrawalForm((current) => ({ ...current, validacion_excepcional: { ...current.validacion_excepcional, motivo: event.target.value } }))} placeholder="Ej: confirmación de Inspectoría" /></label></div></div>}</section>}<footer><span><ShieldCheck size={18} /> Se registran estudiantes, persona, hora, motivo y operador.</span><button type="submit" className="primary-action" disabled={savingWithdrawal || !withdrawalReady}>{savingWithdrawal ? 'Registrando…' : selectedStudents.length > 1 ? `Confirmar retiro de ${selectedStudents.length} estudiantes` : 'Confirmar retiro'} <ArrowRight size={18} /></button></footer></form>}

        {view === 'history' && <section className="porter-panel"><header><div><span className="section-kicker">Movimientos de hoy</span><h2>Entradas y salidas</h2><p>{todayVisits.length} visitas registradas durante la jornada.</p></div></header><div className="porter-list">{!todayVisits.length && <div className="visit-empty"><History size={38} /><strong>No hay movimientos hoy</strong></div>}{todayVisits.map((visit) => <article key={visit.id}><span className="visit-avatar">{visit.visitante.nombre_completo.slice(0, 2).toUpperCase()}</span><div><strong>{visit.visitante.nombre_completo}</strong><small>{visit.destino_nombre} · {visit.motivo_nombre}</small></div><span><small>Ingreso</small><strong>{formatDateTime(visit.ingreso_en)}</strong></span><span className="visit-status" data-state={visit.estado}>{stateLabel(visit.estado)}</span></article>)}</div></section>}
        {view === 'withdrawals' && <section className="porter-panel"><header><div><span className="section-kicker">Retiros registrados</span><h2>Movimientos de estudiantes</h2><p>Los retiros nuevos quedan completados desde Portería.</p></div><button type="button" className="primary-action" onClick={() => setView('withdrawal')}><Plus size={17} /> Registrar retiro</button></header><div className="porter-list">{!withdrawals.length && <div className="visit-empty"><UserCheck size={38} /><strong>No hay retiros registrados</strong></div>}{withdrawals.map((item) => <article key={item.id}><span className="visit-avatar">{studentName(item.estudiante).slice(0, 2).toUpperCase()}</span><div><strong>{studentName(item.estudiante)}</strong><small>Retira {item.visitante.nombre_completo} · {item.motivo_nombre}</small></div><span><small>Registro</small><strong>{formatDateTime(item.entregado_en || item.solicitado_en)}</strong></span><span className="visit-status" data-state={item.estado}>{stateLabel(item.estado)}</span></article>)}</div></section>}
      </main>
    </div>
  );
};

export default PorteriaWorkspace;
