import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileClock,
  FileDown,
  FileSpreadsheet,
  History,
  Paperclip,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  X
} from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import DateRangeField from './components/DateRangeField';
import StudentPicker from './components/StudentPicker';
import AppSelect from './components/AppSelect';
import TimeField from './components/TimeField';
import { useFeedback } from './context/FeedbackContext';
import { buildDetailedRows, buildSummaryRows, reportFileName } from './utils/punctualityReport';
import { getStudentIdentifier } from './utils/studentFormat';
import { PERMISSIONS, hasPermission } from './permissions';

const PAGE_SIZE = 12;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const localIsoDate = (date = new Date()) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');

const initialPeriod = () => {
  const today = new Date();
  return {
    from: localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localIsoDate(today)
  };
};

const formatTime = (value) => String(value || '').slice(0, 5) || '—';
const formatDateTime = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const studentName = (row) => [row.nombres, row.paterno, row.materno].filter(Boolean).join(' ');

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('No fue posible leer el archivo seleccionado.'));
  reader.readAsDataURL(file);
});

const Metric = ({ icon: Icon, value, label, tone = 'blue', note }) => (
  <div className="punctuality-metric" data-tone={tone}>
    {React.createElement(Icon, { size: 22, 'aria-hidden': true })}
    <div><strong>{value}</strong><span>{label}</span>{note && <small>{note}</small>}</div>
  </div>
);

const ScopeButton = ({ active, icon: Icon, children, onClick }) => (
  <button type="button" className="report-scope-option" data-active={active || undefined} onClick={onClick}>
    {React.createElement(Icon, { size: 18 })} <span>{children}</span>
  </button>
);

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const { notify, confirm } = useFeedback();
  const canRegister = hasPermission(user, PERMISSIONS.PUNCTUALITY_REGISTER);
  const canCorrect = hasPermission(user, PERMISSIONS.PUNCTUALITY_CORRECT);
  const canCancel = hasPermission(user, PERMISSIONS.PUNCTUALITY_CANCEL);
  const canJustify = hasPermission(user, PERMISSIONS.PUNCTUALITY_JUSTIFY);
  const canReport = hasPermission(user, PERMISSIONS.REPORTS_GENERATE);
  const canConfigure = hasPermission(user, PERMISSIONS.SETTINGS_MANAGE)
    || hasPermission(user, PERMISSIONS.PUNCTUALITY_CONTROLS_MANAGE);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [config, setConfig] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [controlFilter, setControlFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState(null);
  const [actionMode, setActionMode] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [justificationType, setJustificationType] = useState('apoderado');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [downloadingDocument, setDownloadingDocument] = useState(false);
  const [correctedDate, setCorrectedDate] = useState(localIsoDate());
  const [correctedTime, setCorrectedTime] = useState('');
  const [savingAction, setSavingAction] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [period, setPeriod] = useState(initialPeriod);
  const [scope, setScope] = useState('institucional');
  const [courseId, setCourseId] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [reportFormat, setReportFormat] = useState('detalle');
  const [generatingReport, setGeneratingReport] = useState(false);

  const loadOperationalData = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [summaryResponse, rowsResponse, configResponse, coursesResponse] = await Promise.all([
        axios.get(`${API_URL}/puntualidad/resumen-hoy`),
        axios.get(`${API_URL}/puntualidad/hoy`),
        axios.get(`${API_URL}/puntualidad/config`),
        axios.get(`${API_URL}/courses`)
      ]);
      setSummary(summaryResponse.data);
      setRows(rowsResponse.data || []);
      setConfig(configResponse.data);
      setCourses(coursesResponse.data || []);
      setSelectedRow((currentSelection) => {
        if (!currentSelection) return null;
        const updatedSelection = (rowsResponse.data || []).find(
          (row) => row.id_registro === currentSelection.id_registro
        );
        if (!updatedSelection) {
          setActionMode(null);
          setActionReason('');
          setHistory([]);
          return null;
        }
        return updatedSelection;
      });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible actualizar la operación del día.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => { loadOperationalData(); }, [loadOperationalData]);

  useEffect(() => {
    if (!reportOpen || !['individual', 'personalizado'].includes(scope) || studentQuery.trim().length < 2) {
      setStudentResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setSearchingStudents(true);
      try {
        const response = await axios.get(`${API_URL}/students/search`, { params: { q: studentQuery.trim() } });
        setStudentResults(response.data || []);
      } catch {
        setStudentResults([]);
      } finally {
        setSearchingStudents(false);
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [reportOpen, scope, studentQuery]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return rows.filter((row) => {
      const haystack = `${studentName(row)} ${getStudentIdentifier(row)} ${row.curso || ''}`.toLocaleLowerCase('es');
      return (!normalized || haystack.includes(normalized))
        && (!severity || row.severidad === severity)
        && (!controlFilter || String(row.control_puntualidad_id) === String(controlFilter))
        && (!status || (status === 'justificado' ? row.justificado : row.estado === status));
    });
  }, [controlFilter, query, rows, severity, status]);

  useEffect(() => { setPage(1); }, [controlFilter, query, severity, status]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const closeDrawer = () => {
    setSelectedRow(null);
    setActionMode(null);
    setActionReason('');
    setJustificationType('apoderado');
    setAttachmentFile(null);
    setHistory([]);
  };

  const openRow = (row) => {
    setSelectedRow(row);
    setActionMode(null);
    setActionReason('');
    setJustificationType('apoderado');
    setAttachmentFile(null);
    setCorrectedDate(String(row.fecha).slice(0, 10));
    setCorrectedTime(formatTime(row.hora));
    setHistory([]);
  };

  const openHistory = async () => {
    setActionMode('historial');
    setHistoryLoading(true);
    try {
      const response = await axios.get(`${API_URL}/puntualidad/registros/${selectedRow.id_registro}/historial`);
      setHistory(response.data || []);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible cargar el historial.', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const selectAttachment = (event) => {
    const file = event.target.files?.[0] || null;
    if (file && file.size > MAX_DOCUMENT_BYTES) {
      event.target.value = '';
      setAttachmentFile(null);
      notify('El documento supera el máximo permitido de 8 MB.', 'error');
      return;
    }
    setAttachmentFile(file);
  };

  const downloadDocument = async () => {
    if (!selectedRow?.documento_id) return;
    setDownloadingDocument(true);
    try {
      const response = await axios.get(
        `${API_URL}/puntualidad/registros/${selectedRow.id_registro}/documento`,
        { responseType: 'blob' }
      );
      const downloadUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = selectedRow.documento_nombre || `respaldo-atraso-${selectedRow.id_registro}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible descargar el documento.', 'error');
    } finally {
      setDownloadingDocument(false);
    }
  };

  const saveAction = async () => {
    if (!selectedRow) return;
    if (actionMode !== 'justificar' && actionReason.trim().length < 10) {
      notify('Describe el motivo con al menos 10 caracteres.', 'error');
      return;
    }
    if (actionMode === 'justificar' && actionReason.trim().length < 5) {
      notify('Registra una observación de al menos 5 caracteres.', 'error');
      return;
    }
    if (actionMode === 'justificar' && justificationType === 'medica' && !attachmentFile) {
      notify('Una justificación médica requiere adjuntar el certificado.', 'error');
      return;
    }
    setSavingAction(true);
    try {
      const id = selectedRow.id_registro;
      if (actionMode === 'corregir') {
        await axios.patch(`${API_URL}/puntualidad/registros/${id}/corregir`, { fecha: correctedDate, hora: correctedTime, motivo: actionReason });
        notify('Registro corregido y respaldado en el historial.', 'success');
      } else if (actionMode === 'justificar') {
        const payload = { tipo: justificationType, comentario: actionReason };
        if (attachmentFile) {
          payload.fileName = attachmentFile.name;
          payload.fileData = await readFileAsDataUrl(attachmentFile);
        }
        await axios.post(`${API_URL}/puntualidad/registros/${id}/justificar`, payload);
        notify('Justificación y respaldo registrados.', 'success');
      } else if (actionMode === 'revocar') {
        await axios.patch(`${API_URL}/puntualidad/registros/${id}/revocar-justificacion`, { motivo: actionReason });
        notify('Justificación revocada con trazabilidad.', 'success');
      } else if (actionMode === 'anular') {
        const accepted = await confirm({
          title: 'Anular registro de ingreso',
          message: 'El registro dejará de contabilizarse, pero permanecerá en el historial institucional.',
          confirmLabel: 'Anular registro',
          danger: true
        });
        if (!accepted) return;
        await axios.patch(`${API_URL}/puntualidad/registros/${id}/anular`, { motivo: actionReason });
        notify('Registro anulado sin eliminar su trazabilidad.', 'success');
      }
      closeDrawer();
      await loadOperationalData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible completar la acción.', 'error');
    } finally {
      setSavingAction(false);
    }
  };

  const generateReport = async () => {
    if (scope === 'curso' && !courseId) return notify('Selecciona un curso.', 'error');
    if (scope === 'individual' && !selectedStudent) return notify('Selecciona una persona.', 'error');
    if (scope === 'personalizado' && selectedStudents.length === 0) return notify('Agrega al menos una persona.', 'error');

    setGeneratingReport(true);
    try {
      const params = { desde: period.from, hasta: period.to };
      if (scope === 'curso') params.curso_id = courseId;
      if (scope === 'individual') params.alumno_id = selectedStudent.id_alumno;
      if (scope === 'personalizado') params.alumnos_ids = selectedStudents.map((student) => student.id_alumno).join(',');
      const response = await axios.get(`${API_URL}/puntualidad/reporte`, { params });
      const records = response.data.registros || [];
      if (!records.length) return notify('No existen atrasos en el período y alcance seleccionados.', 'info');

      const XLSX = await import('xlsx');
      const rowsForSheet = reportFormat === 'detalle' ? buildDetailedRows(records) : buildSummaryRows(records);
      const title = `REPORTE DE ATRASOS · ${period.from} A ${period.to}`;
      const worksheet = XLSX.utils.aoa_to_sheet([[title], [], ...rowsForSheet]);
      const columnCount = rowsForSheet[0].length;
      worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columnCount - 1 } }];
      worksheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 2, c: 0 },
          e: { r: 2 + rowsForSheet.length - 1, c: columnCount - 1 }
        })
      };
      worksheet['!cols'] = reportFormat === 'detalle'
        ? [{ wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 17 }, { wch: 12 }, { wch: 13 }, { wch: 19 }, { wch: 28 }, { wch: 34 }, { wch: 14 }, { wch: 16 }, { wch: 42 }]
        : [{ wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 14 }, { wch: 15 }, { wch: 17 }, { wch: 13 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, reportFormat === 'detalle' ? 'Detalle de atrasos' : 'Resumen por persona');

      const scopeLabel = scope === 'curso'
        ? courses.find((course) => String(course.id_curso) === String(courseId))?.nombre_curso || 'curso'
        : scope === 'individual'
          ? studentName(selectedStudent)
          : scope === 'personalizado' ? `${selectedStudents.length}_personas` : 'institucional';
      XLSX.writeFile(workbook, reportFileName({ scope: scopeLabel, from: period.from, to: period.to }));
      notify(`Reporte generado con ${records.length} atraso${records.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible generar el reporte.', 'error');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="app-container punctuality-page">
      <div className="punctuality-surface">
        <ModuleHeader
          icon={Clock3}
          title="Control de atrasos"
          description="Operación diaria, correcciones trazables y reportes institucionales."
          onBack={() => navigate('/admin')}
          onLogout={handleLogout}
        />

        <section className="punctuality-hero" data-tour="late-summary">
          <div className="punctuality-hero__heading">
            <span className="section-kicker">Jornada en curso</span>
            <h2>{new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</h2>
            <p>
              {config?.nombre_jornada || 'Jornada principal'} · {(config?.controles || []).filter((control) => control.activo).length} controles horarios configurados
            </p>
          </div>
          <div className="punctuality-hero__actions">
            {canConfigure && <button type="button" className="quiet-action" onClick={() => navigate('/admin/configuracion')}><Settings size={18} /> Configurar controles</button>}
            {canRegister && <button type="button" className="primary-action" onClick={() => navigate('/scanner')}><FileClock size={18} /> Abrir terminal de registro <ArrowRight size={17} /></button>}
          </div>
        </section>

        {loading ? <div className="punctuality-loading">Preparando la jornada…</div> : (
          <section className="punctuality-metrics" aria-label="Resumen operativo">
            <Metric icon={Users} value={summary?.matricula_activa ?? 0} label="Matrícula activa" tone="slate" note="Dato de referencia" />
            <Metric icon={CalendarClock} value={summary?.ingresos_registrados ?? 0} label="Ingresos registrados" tone="blue" />
            <Metric icon={CheckCircle2} value={summary?.a_tiempo ?? 0} label="A tiempo" tone="green" />
            <Metric icon={AlertTriangle} value={summary?.atrasos ?? 0} label="Atrasos" tone="amber" note={`${summary?.atrasos_graves ?? 0} graves`} />
            <Metric icon={BarChart3} value={summary?.puntualidad_registrada === null ? '—' : `${summary?.puntualidad_registrada}%`} label="Puntualidad registrada" tone="navy" note="Solo sobre ingresos marcados" />
          </section>
        )}

        <div className="calculation-notice"><ShieldCheck size={18} /><span>El sistema no presume asistencia ni ausencia: los indicadores consideran únicamente ingresos efectivamente registrados.</span></div>

        <section className="operation-section" data-tour="late-list">
          <div className="operation-heading">
            <div><span className="section-kicker">Registro del día</span><h2>Ingresos procesados</h2><p>{filteredRows.length} resultado{filteredRows.length === 1 ? '' : 's'} visible{filteredRows.length === 1 ? '' : 's'}</p></div>
            <button type="button" className="icon-text-action" onClick={() => loadOperationalData({ quiet: true })} disabled={refreshing}><RotateCcw size={18} className={refreshing ? 'spin' : ''} /> Actualizar</button>
          </div>

          <div className="operation-filters">
            <label className="operation-search"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, RUT o curso" /></label>
            <label><span>Estado</span><AppSelect ariaLabel="Filtrar por estado" value={status} onChange={setStatus} options={[{ value: '', label: 'Todos' }, { value: 'Presente', label: 'A tiempo' }, { value: 'Atrasado', label: 'Atrasados' }, { value: 'justificado', label: 'Justificados' }]} /></label>
            <label><span>Severidad</span><AppSelect ariaLabel="Filtrar por severidad" value={severity} onChange={setSeverity} options={[{ value: '', label: 'Todas' }, { value: 'Leve', label: 'Leve' }, { value: 'Grave', label: 'Grave' }]} /></label>
            <label><span>Control horario</span><AppSelect ariaLabel="Filtrar por control horario" value={controlFilter} onChange={setControlFilter} options={[{ value: '', label: 'Todos los controles' }, ...(config?.controles || []).filter((control) => control.activo).map((control) => ({ value: String(control.id), label: control.nombre }))]} /></label>
          </div>

          <div className="operation-table-wrap">
            <table className="operation-table">
              <thead><tr><th>Persona</th><th>Curso</th><th>Control</th><th>Hora</th><th>Clasificación</th><th>Respaldo</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id_registro}>
                    <td data-label="Persona"><strong>{studentName(row)}</strong><small>{getStudentIdentifier(row)}</small></td>
                    <td data-label="Curso">{row.curso || 'Sin curso'}</td>
                    <td data-label="Control"><strong>{row.control_nombre || 'Ingreso de la jornada'}</strong><small>{String(row.control_tipo || 'INGRESO').replaceAll('_', ' ').toLocaleLowerCase('es')}</small></td>
                    <td data-label="Hora" className="time-cell">{formatTime(row.hora)}{row.corregido_en && <small>Corregido</small>}</td>
                    <td data-label="Clasificación"><span className="status-pill" data-status={row.estado === 'Presente' ? 'ontime' : row.severidad?.toLowerCase()}>{row.estado === 'Presente' ? 'A tiempo' : `Atraso ${row.severidad?.toLowerCase()}`}</span></td>
                    <td data-label="Respaldo">{row.estado === 'Atrasado' ? <span className="justification-state" data-active={row.justificado || undefined}>{row.documento_id ? 'Con documento' : row.justificado ? 'Justificado' : 'Pendiente'}</span> : <span className="muted-cell">No aplica</span>}</td>
                    <td><button type="button" className="manage-action" onClick={() => openRow(row)}>{canCorrect || canCancel || canJustify ? 'Gestionar' : 'Revisar'} <ChevronRight size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length && <div className="operation-empty"><ShieldCheck size={34} /><strong>No hay registros con estos filtros</strong><span>Prueba otra búsqueda o actualiza la jornada.</span></div>}
          </div>

          {totalPages > 1 && <div className="operation-pagination"><button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={18} /> Anterior</button><span>Página {page} de {totalPages}</span><button type="button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente <ChevronRight size={18} /></button></div>}
        </section>

        {canReport && <section className="report-section-v2" data-tour="report-builder">
          <div className="report-intro">
            <div className="report-intro__icon"><FileSpreadsheet size={25} /></div>
            <div><span className="section-kicker">Documentación institucional</span><h2>Reporte de atrasos</h2><p>Exporta solo atrasos registrados, con minutos, severidad y respaldo documental.</p></div>
            <button type="button" className="report-toggle" onClick={() => setReportOpen((open) => !open)}>{reportOpen ? 'Cerrar configuración' : 'Configurar reporte'} <SlidersHorizontal size={18} /></button>
          </div>

          {reportOpen && <div className="report-builder-v2">
            <div className="report-builder-v2__period"><DateRangeField label="Período del reporte" from={period.from} to={period.to} maxValue={localIsoDate()} onChange={setPeriod} /></div>
            <div className="report-builder-v2__block"><span className="field-label">Alcance</span><div className="report-scope-grid"><ScopeButton icon={ShieldCheck} active={scope === 'institucional'} onClick={() => setScope('institucional')}>Toda la institución</ScopeButton><ScopeButton icon={Users} active={scope === 'curso'} onClick={() => setScope('curso')}>Un curso</ScopeButton><ScopeButton icon={UserRound} active={scope === 'individual'} onClick={() => setScope('individual')}>Una persona</ScopeButton><ScopeButton icon={SlidersHorizontal} active={scope === 'personalizado'} onClick={() => setScope('personalizado')}>Selección múltiple</ScopeButton></div></div>

            {scope === 'curso' && <label className="report-control"><span className="field-label">Curso</span><AppSelect ariaLabel="Seleccionar curso" value={courseId} onChange={setCourseId} options={[{ value: '', label: 'Seleccionar curso' }, ...courses.map((course) => ({ value: course.id_curso, label: course.nombre_curso }))]} /></label>}
            {scope === 'individual' && <StudentPicker label="Persona" query={studentQuery} onQueryChange={setStudentQuery} results={studentResults} loading={searchingStudents} selected={selectedStudent ? [selectedStudent] : []} onSelect={setSelectedStudent} onRemove={() => setSelectedStudent(null)} />}
            {scope === 'personalizado' && <StudentPicker label="Personas" multiple query={studentQuery} onQueryChange={setStudentQuery} results={studentResults} loading={searchingStudents} selected={selectedStudents} onSelect={(student) => setSelectedStudents((current) => [...current, student])} onRemove={(student) => setSelectedStudents((current) => current.filter((item) => item.id_alumno !== student.id_alumno))} onClear={() => setSelectedStudents([])} />}

            <div className="report-builder-v2__footer"><div><span className="field-label">Formato</span><div className="report-format-switch"><button type="button" data-active={reportFormat === 'detalle' || undefined} onClick={() => setReportFormat('detalle')}>Detalle de cada atraso</button><button type="button" data-active={reportFormat === 'resumen' || undefined} onClick={() => setReportFormat('resumen')}>Resumen por persona</button></div></div><button type="button" className="download-report-action" onClick={generateReport} disabled={generatingReport}><Download size={19} /> {generatingReport ? 'Generando…' : 'Descargar Excel'}</button></div>
          </div>}
        </section>}
      </div>

      {selectedRow && <div className="record-drawer-backdrop" onMouseDown={closeDrawer}>
        <aside className="record-drawer" role="dialog" aria-modal="true" aria-label="Gestionar registro" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="section-kicker">Registro #{selectedRow.id_registro}</span><h2>{studentName(selectedRow)}</h2><p>{selectedRow.curso || 'Sin curso'} · {getStudentIdentifier(selectedRow)}</p></div><button type="button" onClick={closeDrawer} aria-label="Cerrar"><X size={22} /></button></header>
          <div className="record-summary"><div><small>Fecha</small><strong>{String(selectedRow.fecha).slice(0, 10)}</strong></div><div><small>Hora</small><strong>{formatTime(selectedRow.hora)}</strong></div><div><small>Resultado</small><strong>{selectedRow.estado === 'Presente' ? 'A tiempo' : `Atraso ${selectedRow.severidad}`}</strong></div></div>

          {!actionMode && (
            <div className="record-actions">
              {canCorrect && <button type="button" onClick={() => setActionMode('corregir')}>
                <Clock3 size={19} />
                <span><strong>Corregir fecha u hora</strong><small>Recalcula automáticamente la clasificación.</small></span>
                <ChevronRight size={18} />
              </button>}
              {canJustify && selectedRow.estado === 'Atrasado' && !selectedRow.justificado && (
                <button type="button" onClick={() => setActionMode('justificar')}>
                  <ShieldCheck size={19} />
                  <span><strong>Registrar justificación</strong><small>Permite respaldar la constancia y adjuntar certificado.</small></span>
                  <ChevronRight size={18} />
                </button>
              )}
              {canJustify && selectedRow.estado === 'Atrasado' && selectedRow.justificado && (
                <button type="button" onClick={() => setActionMode('revocar')}>
                  <RotateCcw size={19} />
                  <span><strong>Revocar justificación</strong><small>Conserva el cambio en el historial.</small></span>
                  <ChevronRight size={18} />
                </button>
              )}
              {selectedRow.documento_id && (
                <button type="button" onClick={downloadDocument} disabled={downloadingDocument}>
                  <FileDown size={19} />
                  <span><strong>Descargar documento</strong><small>{selectedRow.documento_nombre || 'Respaldo documental vigente'}</small></span>
                  <Download size={18} />
                </button>
              )}
              <button type="button" onClick={openHistory}>
                <History size={19} />
                <span><strong>Ver historial</strong><small>Correcciones y respaldos anteriores.</small></span>
                <ChevronRight size={18} />
              </button>
              {canCancel && <button type="button" className="danger" onClick={() => setActionMode('anular')}>
                <ShieldAlert size={19} />
                <span><strong>Anular registro</strong><small>Deja de contabilizarlo sin eliminarlo.</small></span>
                <ChevronRight size={18} />
              </button>}
            </div>
          )}

          {actionMode && actionMode !== 'historial' && (
            <div className="record-form">
              <button
                type="button"
                className="back-inline"
                onClick={() => {
                  setActionMode(null);
                  setActionReason('');
                  setJustificationType('apoderado');
                  setAttachmentFile(null);
                }}
              >
                <ChevronLeft size={17} /> Volver a opciones
              </button>
              <h3>
                {actionMode === 'corregir'
                  ? 'Corregir registro'
                  : actionMode === 'justificar'
                    ? 'Justificar atraso'
                    : actionMode === 'revocar'
                      ? 'Revocar justificación'
                      : 'Anular registro'}
              </h3>

              {actionMode === 'corregir' && (
                <div className="record-form__row">
                  <label>
                    <span>Fecha</span>
                    <input type="date" max={localIsoDate()} value={correctedDate} onChange={(event) => setCorrectedDate(event.target.value)} />
                  </label>
                  <div className="record-form__field">
                    <span>Hora</span>
                    <TimeField ariaLabel="Hora corregida" value={correctedTime} onChange={setCorrectedTime} />
                  </div>
                </div>
              )}

              {actionMode === 'justificar' && (
                <div className="justification-document-fields">
                  <label>
                    <span>Tipo de respaldo</span>
                    <AppSelect ariaLabel="Tipo de respaldo" value={justificationType} onChange={setJustificationType} options={[{ value: 'apoderado', label: 'Información de apoderado' }, { value: 'medica', label: 'Certificado médico' }, { value: 'institucional', label: 'Constancia institucional' }]} />
                  </label>
                  <label className="document-upload">
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                      onChange={selectAttachment}
                    />
                    <Paperclip size={20} />
                    <span>
                      <strong>{attachmentFile ? attachmentFile.name : 'Adjuntar documento'}</strong>
                      <small>PDF, PNG o JPG · máximo 8 MB{justificationType === 'medica' ? ' · obligatorio' : ''}</small>
                    </span>
                  </label>
                </div>
              )}

              <label>
                <span>{actionMode === 'justificar' ? 'Antecedente informado' : 'Motivo obligatorio'}</span>
                <textarea
                  rows="5"
                  maxLength="500"
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  placeholder={actionMode === 'justificar'
                    ? 'Indica quién informó, el motivo comunicado y cualquier antecedente relevante…'
                    : 'Explica por qué se realiza este cambio…'}
                />
              </label>
              <small className="character-count">{actionReason.length}/500 caracteres</small>
              <div className="record-form__notice">
                <ShieldCheck size={17} />
                <span>La persona, fecha, valores anteriores, responsable y documento quedarán trazados.</span>
              </div>
              <button
                type="button"
                className={actionMode === 'anular' ? 'drawer-submit danger' : 'drawer-submit'}
                onClick={saveAction}
                disabled={savingAction}
              >
                <Save size={18} /> {savingAction ? 'Guardando…' : 'Confirmar y guardar'}
              </button>
            </div>
          )}

          {actionMode === 'historial' && <div className="record-history"><button type="button" className="back-inline" onClick={() => setActionMode(null)}><ChevronLeft size={17} /> Volver a opciones</button><h3>Historial del registro</h3>{historyLoading ? <div className="drawer-loading">Cargando historial…</div> : history.length ? <div className="history-timeline">{history.map((event) => <article key={event.id}><i /><div><span>{event.accion.replaceAll('_', ' ')}</span><strong>{event.motivo}</strong><small>{formatDateTime(event.realizado_en)} · {event.realizado_por_nombre || event.realizado_por_correo || 'Usuario histórico'}</small></div></article>)}</div> : <div className="drawer-empty"><History size={28} /><span>Este registro todavía no tiene modificaciones.</span></div>}</div>}
        </aside>
      </div>}
    </div>
  );
};

export default AdminDashboard;
