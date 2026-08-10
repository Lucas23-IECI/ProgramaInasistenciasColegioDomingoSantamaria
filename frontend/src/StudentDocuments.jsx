import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileCheck2,
  FileClock,
  FilePlus2,
  FileText,
  FolderArchive,
  History,
  PenLine,
  Plus,
  RefreshCw,
  ScanText,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { PERMISSIONS, hasPermission } from './permissions';
import DevelopmentBadge from './components/DevelopmentBadge';

const API = '/api/documentos-estudiantes';
const CATEGORIES = [
  ['CERTIFICADO', 'Certificado'], ['JUSTIFICACION', 'Justificación'],
  ['AUTORIZACION', 'Autorización'], ['ACTA', 'Acta'],
  ['COMPROMISO', 'Compromiso'], ['IDENTIDAD', 'Identidad'],
  ['MATRICULA', 'Matrícula'], ['FAMILIAR', 'Familiar'],
  ['CONVIVENCIA', 'Convivencia'], ['OTRO', 'Otro'],
];
const STATES = [['PENDIENTE', 'Pendiente'], ['VIGENTE', 'Vigente'], ['VENCIDO', 'Vencido'], ['ARCHIVADO', 'Archivado']];
const ACCESS = [['INSTITUCIONAL', 'Institucional'], ['RESERVADO', 'Reservado'], ['MUY_RESERVADO', 'Muy reservado']];
const SIGNATURES = [['REVISION', 'Revisión'], ['CONFORMIDAD', 'Conformidad'], ['APROBACION', 'Aprobación']];
const labelFrom = (items, value) => items.find(([key]) => key === value)?.[1] || value || 'Sin definir';
const formatDate = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : 'Sin vencimiento';
const formatDateTime = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
const errorMessage = (error, fallback) => error?.response?.data?.message || fallback;
const today = () => new Date().toISOString().slice(0, 10);

const readFile = (file) => new Promise((resolve, reject) => {
  if (!file) return reject(new Error('Selecciona un archivo.'));
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) return reject(new Error('Solo se permiten PDF, PNG o JPG.'));
  if (file.size > 8 * 1024 * 1024) return reject(new Error('El archivo supera el máximo de 8 MB.'));
  const reader = new FileReader();
  reader.onload = () => resolve({ fileData: reader.result, fileName: file.name });
  reader.onerror = () => reject(new Error('No fue posible leer el archivo.'));
  reader.readAsDataURL(file);
});

const Modal = ({ title, eyebrow, onClose, children, actions, wide = false }) => {
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="docs-modal-backdrop" onMouseDown={onClose} role="presentation">
      <section className={`docs-modal${wide ? ' docs-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="docs-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="docs-modal__header">
          <div>{eyebrow && <span className="section-kicker">{eyebrow}</span>}<h2 id="docs-modal-title">{title}</h2></div>
          <button ref={closeRef} type="button" className="docs-icon-button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <div className="docs-modal__body">{children}</div>
        {actions && <footer className="docs-modal__actions">{actions}</footer>}
      </section>
    </div>
  );
};

const StatusBadge = ({ value }) => <span className={`docs-status docs-status--${String(value || '').toLowerCase()}`}>{labelFrom(STATES, value)}</span>;

const Metric = ({ icon: Icon, value, label, tone, onClick }) => {
  const content = <><span className={`docs-metric__icon docs-metric__icon--${tone}`}><Icon size={23} /></span><span><strong>{value ?? 0}</strong><small>{label}</small></span></>;
  return onClick
    ? <button type="button" className="docs-metric docs-metric--button" onClick={onClick}>{content}</button>
    : <div className="docs-metric">{content}</div>;
};

const StudentSearch = ({ onSelect, compact = false }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await axios.get(`${API}/estudiantes/buscar`, { params: { q: query.trim() }, signal: controller.signal });
        setResults(response.data || []);
      } catch (error) {
        if (error.code !== 'ERR_CANCELED') setResults([]);
      } finally { setLoading(false); }
    }, 260);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return (
    <div className={`docs-student-search${compact ? ' docs-student-search--compact' : ''}`}>
      <label><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar estudiante por nombre o documento" /></label>
      {query.trim().length >= 2 && (
        <div className="docs-search-results" role="listbox">
          {loading && <p>Buscando estudiantes…</p>}
          {!loading && results.length === 0 && <p>No se encontraron coincidencias.</p>}
          {results.map((student) => (
            <button key={student.id_alumno} type="button" onClick={() => { onSelect(student); setQuery(''); setResults([]); }}>
              <span><strong>{student.nombre}</strong><small>{student.curso} · {student.documento}</small></span><ChevronRight size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const DocumentFields = ({ form, setForm, includeFile = false, file, setFile }) => (
  <div className="docs-form-grid">
    <label className="docs-field docs-field--span-2"><span>Título</span><input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Certificado médico de agosto" maxLength={180} /></label>
    <label className="docs-field"><span>Categoría</span><select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="docs-field"><span>Estado</span><select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>{STATES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="docs-field"><span>Nivel de acceso</span><select value={form.nivel_acceso} onChange={(e) => setForm({ ...form, nivel_acceso: e.target.value })}>{ACCESS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="docs-field"><span>Vigente desde</span><input type="date" value={form.vigente_desde} onChange={(e) => setForm({ ...form, vigente_desde: e.target.value })} /></label>
    <label className="docs-field"><span>Vence el</span><input type="date" value={form.vence_en} min={form.vigente_desde || undefined} onChange={(e) => setForm({ ...form, vence_en: e.target.value })} /></label>
    <label className="docs-field docs-field--span-2"><span>Descripción</span><textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Contexto breve y verificable" maxLength={600} /></label>
    {includeFile && <label className="docs-upload docs-field--span-2"><Upload size={23} /><span><strong>{file?.name || 'Seleccionar archivo protegido'}</strong><small>PDF, PNG o JPG · máximo 8 MB</small></span><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>}
  </div>
);

const defaultForm = () => ({ titulo: '', categoria: 'CERTIFICADO', estado: 'VIGENTE', nivel_acceso: 'RESERVADO', vigente_desde: today(), vence_en: '', descripcion: '' });

const Dashboard = ({ permissions }) => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState({});
  const [documents, setDocuments] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ q: '', categoria: '', estado: '', vencimiento: false });
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState({ nombre: '', categoria: 'CERTIFICADO', descripcion: '', contenido: '', campos: '' });
  const { notify } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResponse, docsResponse, templatesResponse] = await Promise.all([
        axios.get(`${API}/resumen`),
        axios.get(`${API}/documentos`, { params: { ...filters, vencimiento: filters.vencimiento || undefined } }),
        axios.get(`${API}/plantillas`),
      ]);
      setSummary(summaryResponse.data || {});
      setDocuments(docsResponse.data?.items || []);
      setTotal(docsResponse.data?.total || 0);
      setTemplates(templatesResponse.data || []);
    } catch (error) { notify(errorMessage(error, 'No fue posible cargar la gestión documental.'), 'error'); }
    finally { setLoading(false); }
  }, [filters, notify]);
  useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer); }, [load]);

  const createTemplate = async () => {
    try {
      await axios.post(`${API}/plantillas`, {
        nombre: templateForm.nombre,
        categoria: templateForm.categoria,
        descripcion: templateForm.descripcion,
        contenido: templateForm.contenido,
        campos_permitidos: templateForm.campos.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setTemplateModal(false);
      setTemplateForm({ nombre: '', categoria: 'CERTIFICADO', descripcion: '', contenido: '', campos: '' });
      notify('Plantilla institucional creada.', 'success');
      await load();
    } catch (error) { notify(errorMessage(error, 'No fue posible crear la plantilla.'), 'error'); }
  };

  return (
    <>
      <section className="docs-overview" data-tour="documents-summary">
        <Metric icon={FolderArchive} value={summary.documentos_activos} label="documentos activos" tone="blue" />
        <Metric icon={AlertTriangle} value={summary.vencidos} label="documentos vencidos" tone="red" onClick={() => setFilters({ ...filters, estado: 'VENCIDO' })} />
        <Metric icon={CalendarClock} value={summary.vencen_pronto} label="vencen en 30 días" tone="ochre" onClick={() => setFilters({ ...filters, estado: '', vencimiento: true })} />
        <Metric icon={ScanText} value={summary.ocr_pendientes} label="OCR por revisar" tone="purple" />
        <Metric icon={FileCheck2} value={summary.sin_firma} label="versiones sin firma" tone="slate" />
      </section>

      <section className="docs-workspace" data-tour="documents-student-search">
        <div className="docs-workspace__lead">
          <span className="section-kicker">Expediente por estudiante</span>
          <h2>Abrir una ficha documental</h2>
          <p>Busca al estudiante y consulta sus certificados, autorizaciones, versiones y vigencias.</p>
          <StudentSearch onSelect={(student) => navigate(`/admin/documentos/estudiante/${student.id_alumno}`)} />
        </div>
        <aside className="docs-template-panel">
          <div><Sparkles size={22} /><span><strong>Plantillas institucionales</strong><small>{templates.filter((item) => item.activa).length} disponibles para generar PDF</small></span></div>
          {permissions.templates && <button type="button" className="docs-secondary-button" onClick={() => setTemplateModal(true)}><Plus size={17} /> Nueva plantilla</button>}
        </aside>
      </section>

      <section className="docs-list-section" data-tour="documents-list">
        <div className="docs-section-heading"><div><span className="section-kicker">Consulta transversal</span><h2>Documentos registrados</h2><p>{total} resultados según los filtros activos.</p></div><button type="button" className="docs-secondary-button" onClick={load}><RefreshCw size={17} /> Actualizar</button></div>
        <div className="docs-filters">
          <label className="docs-filter-search"><Search size={18} /><input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Buscar por estudiante o título" /></label>
          <select value={filters.categoria} onChange={(e) => setFilters({ ...filters, categoria: e.target.value })}><option value="">Todas las categorías</option>{CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select value={filters.estado} onChange={(e) => setFilters({ ...filters, estado: e.target.value, vencimiento: false })}><option value="">Todos los estados</option>{STATES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <button type="button" className={filters.vencimiento ? 'is-active' : ''} onClick={() => setFilters({ ...filters, vencimiento: !filters.vencimiento, estado: '' })}>Próximos a vencer</button>
        </div>
        {loading ? <div className="docs-empty">Cargando expedientes…</div> : documents.length === 0 ? <div className="docs-empty"><FolderArchive size={34} /><strong>No hay documentos con estos filtros</strong><span>Busca otro término o abre la ficha de un estudiante para incorporar el primero.</span></div> : (
          <div className="docs-table-wrap"><table className="docs-table"><thead><tr><th>Estudiante</th><th>Documento</th><th>Vigencia</th><th>Responsable</th><th></th></tr></thead><tbody>{documents.map((doc) => (
            <tr key={doc.id_documento_expediente}><td><strong>{doc.estudiante_nombre}</strong><small>{doc.curso}</small></td><td><span className="docs-category">{labelFrom(CATEGORIES, doc.categoria)}</span><strong>{doc.titulo}</strong><small>{doc.versiones} versión(es) · OCR {doc.ocr_estado || 'no solicitado'}</small></td><td><StatusBadge value={doc.estado_efectivo} /><small>{formatDate(doc.vence_en)}</small></td><td>{doc.responsable_nombre}</td><td><button type="button" className="docs-row-button" onClick={() => navigate(`/admin/documentos/ficha/${doc.id_documento_expediente}`)}>Abrir <ChevronRight size={16} /></button></td></tr>
          ))}</tbody></table></div>
        )}
      </section>

      {templateModal && <Modal title="Nueva plantilla institucional" eyebrow="Generación controlada de PDF" wide onClose={() => setTemplateModal(false)} actions={<><button className="docs-secondary-button" onClick={() => setTemplateModal(false)}>Cancelar</button><button className="docs-primary-button" onClick={createTemplate} disabled={templateForm.nombre.trim().length < 3 || templateForm.contenido.trim().length < 20}><Plus size={17} /> Crear plantilla</button></>}>
        <div className="docs-form-grid">
          <label className="docs-field"><span>Nombre</span><input value={templateForm.nombre} onChange={(e) => setTemplateForm({ ...templateForm, nombre: e.target.value })} /></label>
          <label className="docs-field"><span>Categoría</span><select value={templateForm.categoria} onChange={(e) => setTemplateForm({ ...templateForm, categoria: e.target.value })}>{CATEGORIES.filter(([key]) => key !== 'IDENTIDAD' && key !== 'CONVIVENCIA').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="docs-field docs-field--span-2"><span>Descripción</span><input value={templateForm.descripcion} onChange={(e) => setTemplateForm({ ...templateForm, descripcion: e.target.value })} /></label>
          <label className="docs-field docs-field--span-2"><span>Contenido</span><textarea className="docs-template-text" value={templateForm.contenido} onChange={(e) => setTemplateForm({ ...templateForm, contenido: e.target.value })} placeholder="Use campos como {{estudiante_nombre}} y {{fecha_emision}}." /></label>
          <label className="docs-field docs-field--span-2"><span>Campos permitidos, separados por coma</span><input value={templateForm.campos} onChange={(e) => setTemplateForm({ ...templateForm, campos: e.target.value })} placeholder="observacion, responsable_nombre, detalle" /></label>
        </div>
      </Modal>}
    </>
  );
};

const StudentFile = ({ studentId, permissions }) => {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadModal, setUploadModal] = useState(false);
  const [generateModal, setGenerateModal] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generate, setGenerate] = useState({ id_plantilla: '', titulo: '', vence_en: '', valores: {} });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fileResponse, templatesResponse] = await Promise.all([axios.get(`${API}/estudiantes/${studentId}/expediente`), axios.get(`${API}/plantillas`)]);
      setData(fileResponse.data); setTemplates(templatesResponse.data || []);
    } catch (error) { notify(errorMessage(error, 'No fue posible abrir el expediente.'), 'error'); navigate('/admin/documentos'); }
    finally { setLoading(false); }
  }, [navigate, notify, studentId]);
  useEffect(() => { load(); }, [load]);

  const uploadDocument = async () => {
    setSaving(true);
    try {
      const binary = await readFile(file);
      await axios.post(`${API}/estudiantes/${studentId}/documentos`, { ...form, ...binary });
      setUploadModal(false); setForm(defaultForm()); setFile(null);
      notify('Documento incorporado con su primera versión.', 'success'); await load();
    } catch (error) { notify(errorMessage(error, error.message || 'No fue posible incorporar el documento.'), 'error'); }
    finally { setSaving(false); }
  };

  const selectedTemplate = templates.find((item) => String(item.id_plantilla) === String(generate.id_plantilla));
  const allowedFields = useMemo(() => Array.isArray(selectedTemplate?.campos_permitidos) ? selectedTemplate.campos_permitidos.filter((field) => !['estudiante_nombre', 'estudiante_documento', 'curso', 'fecha_emision'].includes(field)) : [], [selectedTemplate]);
  const generatePdf = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/estudiantes/${studentId}/generar`, generate);
      setGenerateModal(false); setGenerate({ id_plantilla: '', titulo: '', vence_en: '', valores: {} });
      notify('PDF generado como documento pendiente de revisión.', 'success'); await load();
    } catch (error) { notify(errorMessage(error, 'No fue posible generar el PDF.'), 'error'); }
    finally { setSaving(false); }
  };

  if (loading || !data) return <div className="docs-empty">Cargando expediente…</div>;
  return (
    <>
      <section className="docs-student-hero" data-tour="documents-student-file">
        <button type="button" className="docs-back" onClick={() => navigate('/admin/documentos')}><ArrowLeft size={18} /> Gestión documental</button>
        <div className="docs-student-hero__main"><span className="docs-student-avatar">{data.student.nombre.split(' ').slice(0, 2).map((part) => part[0]).join('')}</span><div><span className="section-kicker">Expediente documental</span><h2>{data.student.nombre}</h2><p>{data.student.curso} · {data.student.documento}</p></div></div>
        <div className="docs-student-hero__actions">
          {permissions.upload && <button className="docs-primary-button" onClick={() => setUploadModal(true)}><FilePlus2 size={18} /> Incorporar documento</button>}
          {permissions.templates && <button className="docs-secondary-button" onClick={() => setGenerateModal(true)}><Sparkles size={18} /> Generar PDF</button>}
        </div>
      </section>
      <section className="docs-file-summary" data-tour="documents-file-summary"><div><strong>{data.documents.length}</strong><span>documentos registrados</span></div><div><strong>{data.documents.filter((item) => item.estado_efectivo === 'VIGENTE').length}</strong><span>vigentes</span></div><div><strong>{data.documents.filter((item) => item.estado_efectivo === 'VENCIDO').length}</strong><span>vencidos</span></div><div><strong>{data.documents.reduce((sum, item) => sum + Number(item.versiones || 0), 0)}</strong><span>versiones conservadas</span></div></section>
      {data.documents.length === 0 ? <div className="docs-empty docs-empty--large"><FolderArchive size={42} /><strong>Este estudiante aún no tiene documentos</strong><span>El expediente se crea automáticamente al incorporar o generar el primer archivo.</span></div> : <div className="docs-card-grid">{data.documents.map((doc) => (
        <button key={doc.id_documento_expediente} type="button" className="docs-card" onClick={() => navigate(`/admin/documentos/ficha/${doc.id_documento_expediente}`)}>
          <div className="docs-card__top"><span className="docs-card__icon"><FileText size={22} /></span><StatusBadge value={doc.estado_efectivo} /></div><span className="docs-category">{labelFrom(CATEGORIES, doc.categoria)}</span><h3>{doc.titulo}</h3><p>{doc.descripcion || 'Sin descripción adicional.'}</p><div className="docs-card__meta"><span><History size={15} /> {doc.versiones} versión(es)</span><span><FileCheck2 size={15} /> {doc.firmas} firma(s)</span><span><CalendarClock size={15} /> {formatDate(doc.vence_en)}</span></div><div className="docs-card__footer"><span>{doc.nivel_acceso.replace('_', ' ')}</span><ChevronRight size={18} /></div>
        </button>
      ))}</div>}

      {uploadModal && <Modal title="Incorporar documento" eyebrow="Nueva ficha y versión protegida" wide onClose={() => !saving && setUploadModal(false)} actions={<><button className="docs-secondary-button" onClick={() => setUploadModal(false)} disabled={saving}>Cancelar</button><button className="docs-primary-button" onClick={uploadDocument} disabled={saving || !file || form.titulo.trim().length < 3}>{saving ? 'Guardando…' : <><Upload size={17} /> Guardar documento</>}</button></>}><DocumentFields form={form} setForm={setForm} includeFile file={file} setFile={setFile} /><div className="docs-notice"><ShieldCheck size={20} /><span>El archivo se guarda fuera de la carpeta pública. Al reemplazarlo se crea una versión nueva; el original no se sobrescribe.</span></div></Modal>}
      {generateModal && <Modal title="Generar documento PDF" eyebrow="Plantilla institucional" wide onClose={() => !saving && setGenerateModal(false)} actions={<><button className="docs-secondary-button" onClick={() => setGenerateModal(false)} disabled={saving}>Cancelar</button><button className="docs-primary-button" onClick={generatePdf} disabled={saving || !generate.id_plantilla}>{saving ? 'Generando…' : <><Sparkles size={17} /> Generar para revisión</>}</button></>}>
        <div className="docs-form-grid"><label className="docs-field docs-field--span-2"><span>Plantilla</span><select value={generate.id_plantilla} onChange={(e) => setGenerate({ id_plantilla: e.target.value, titulo: '', vence_en: '', valores: {} })}><option value="">Seleccionar plantilla</option>{templates.filter((item) => item.activa).map((item) => <option key={item.id_plantilla} value={item.id_plantilla}>{item.nombre}</option>)}</select></label><label className="docs-field"><span>Título opcional</span><input value={generate.titulo} onChange={(e) => setGenerate({ ...generate, titulo: e.target.value })} placeholder={selectedTemplate?.nombre || 'Título del documento'} /></label><label className="docs-field"><span>Vencimiento opcional</span><input type="date" min={today()} value={generate.vence_en} onChange={(e) => setGenerate({ ...generate, vence_en: e.target.value })} /></label>{allowedFields.map((field) => <label key={field} className="docs-field docs-field--span-2"><span>{field.replaceAll('_', ' ')}</span><textarea value={generate.valores[field] || ''} onChange={(e) => setGenerate({ ...generate, valores: { ...generate.valores, [field]: e.target.value } })} /></label>)}</div><div className="docs-notice"><Eye size={20} /><span>El PDF se crea en estado Pendiente. Debe revisarse antes de marcarlo vigente o firmarlo.</span></div>
      </Modal>}
    </>
  );
};

const DocumentDetail = ({ documentId, permissions }) => {
  const navigate = useNavigate();
  const { notify, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(defaultForm());
  const [file, setFile] = useState(null);
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState({ tipo: 'REVISION', declaracion: 'Declaro haber revisado esta versión y sus antecedentes asociados.' });
  const [ocrText, setOcrText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await axios.get(`${API}/documentos/${documentId}`); setData(response.data); }
    catch (error) { notify(errorMessage(error, 'No fue posible abrir el documento.'), 'error'); navigate('/admin/documentos'); }
    finally { setLoading(false); }
  }, [documentId, navigate, notify]);
  useEffect(() => { load(); }, [load]);

  const openEdit = () => { const doc = data.document; setForm({ titulo: doc.titulo, categoria: doc.categoria, estado: doc.estado, nivel_acceso: doc.nivel_acceso, vigente_desde: doc.vigente_desde?.slice(0, 10) || '', vence_en: doc.vence_en?.slice(0, 10) || '', descripcion: doc.descripcion || '', version_registro: doc.version_registro }); setModal('edit'); };
  const saveEdit = async () => { setSaving(true); try { await axios.patch(`${API}/documentos/${documentId}`, form); setModal(null); notify('Metadatos y vigencia actualizados.', 'success'); await load(); } catch (error) { notify(errorMessage(error, 'No fue posible actualizar la ficha.'), 'error'); } finally { setSaving(false); } };
  const addVersion = async () => { setSaving(true); try { const binary = await readFile(file); await axios.post(`${API}/documentos/${documentId}/versiones`, { ...binary, notas_version: notes }); setModal(null); setFile(null); setNotes(''); notify('Nueva versión incorporada sin sobrescribir las anteriores.', 'success'); await load(); } catch (error) { notify(errorMessage(error, error.message || 'No fue posible crear la versión.'), 'error'); } finally { setSaving(false); } };
  const runOcr = async (version) => { const accepted = await confirm({ title: 'Ejecutar OCR local', message: 'Se extraerá una propuesta de texto desde esta imagen. Ningún dato se aplicará automáticamente.', confirmLabel: 'Procesar imagen' }); if (!accepted) return; try { await axios.post(`${API}/versiones/${version.id_version}/ocr`); notify('OCR finalizado. Revisa la propuesta antes de aprobarla.', 'success'); await load(); } catch (error) { notify(errorMessage(error, 'No fue posible ejecutar el OCR.'), 'error'); } };
  const openOcr = (version) => { setOcrText(version.ocr_texto_propuesto || ''); setModal({ type: 'ocr', version }); };
  const reviewOcr = async (action) => { setSaving(true); try { await axios.post(`${API}/versiones/${modal.version.id_version}/ocr/revisar`, { accion: action, texto_revisado: ocrText }); setModal(null); notify(action === 'APROBAR' ? 'Texto OCR revisado y aprobado.' : 'Propuesta OCR rechazada.', 'success'); await load(); } catch (error) { notify(errorMessage(error, 'No fue posible guardar la revisión.'), 'error'); } finally { setSaving(false); } };
  const openSign = (version) => { setSignature({ tipo: 'REVISION', declaracion: 'Declaro haber revisado esta versión y sus antecedentes asociados.' }); setModal({ type: 'sign', version }); };
  const sign = async () => { setSaving(true); try { await axios.post(`${API}/versiones/${modal.version.id_version}/firmar`, signature); setModal(null); notify('Firma interna registrada sobre la huella digital de esta versión.', 'success'); await load(); } catch (error) { notify(errorMessage(error, 'No fue posible registrar la firma.'), 'error'); } finally { setSaving(false); } };

  if (loading || !data) return <div className="docs-empty">Cargando ficha documental…</div>;
  const doc = data.document;
  return (
    <>
      <section className="docs-detail-header" data-tour="documents-detail"><button type="button" className="docs-back" onClick={() => navigate(`/admin/documentos/estudiante/${data.student.id_alumno}`)}><ArrowLeft size={18} /> Expediente de {data.student.nombre}</button><div className="docs-detail-header__title"><span className="docs-detail-icon"><FileText size={28} /></span><div><span className="docs-category">{labelFrom(CATEGORIES, doc.categoria)}</span><h2>{doc.titulo}</h2><p>{data.student.curso} · {doc.nivel_acceso.replace('_', ' ')}</p></div><StatusBadge value={doc.estado} /></div><div className="docs-detail-actions">{permissions.manage && <button className="docs-secondary-button" onClick={openEdit}><PenLine size={17} /> Editar ficha</button>}{permissions.upload && <button className="docs-primary-button" onClick={() => setModal('version')}><Plus size={17} /> Nueva versión</button>}</div></section>
      <section className="docs-metadata"><div><span>Vigente desde</span><strong>{formatDate(doc.vigente_desde)}</strong></div><div><span>Vence</span><strong>{formatDate(doc.vence_en)}</strong></div><div><span>Creado</span><strong>{formatDateTime(doc.creado_en)}</strong></div><div><span>Registro de ficha</span><strong>v{doc.version_registro}</strong></div></section>
      {doc.descripcion && <p className="docs-description">{doc.descripcion}</p>}
      <section className="docs-timeline-section" data-tour="documents-versions"><div className="docs-section-heading"><div><span className="section-kicker">Archivo inmutable</span><h2>Historial de versiones</h2><p>Cada versión conserva su archivo, huella SHA-256, OCR y firmas.</p></div></div><div className="docs-version-list">{data.versions.map((version) => (
        <article className="docs-version" key={version.id_version}>
          <div className="docs-version__rail"><span>{version.numero_version}</span></div>
          <div className="docs-version__content"><div className="docs-version__heading"><div><h3>Versión {version.numero_version} · {version.nombre_original}</h3><p>{version.origen === 'PLANTILLA' ? 'Generada desde plantilla institucional' : 'Archivo incorporado'} · {formatDateTime(version.creado_en)} · {version.creado_por_nombre}</p></div><span className={`docs-ocr-badge docs-ocr-badge--${version.ocr_estado.toLowerCase()}`}>OCR {version.ocr_estado.replace('_', ' ')}</span></div>{version.notas_version && <p>{version.notas_version}</p>}<div className="docs-version__hash"><span>SHA-256</span><code>{version.sha256}</code></div>
          <div className="docs-version__buttons"><a className="docs-secondary-button" href={`${API}/versiones/${version.id_version}/descargar`}><Download size={16} /> Descargar</a>{permissions.ocr && ['image/jpeg', 'image/png'].includes(version.mime_type) && !['PROPUESTO', 'REVISADO'].includes(version.ocr_estado) && <button className="docs-secondary-button" onClick={() => runOcr(version)}><ScanText size={16} /> Extraer texto</button>}{permissions.ocr && version.ocr_estado === 'PROPUESTO' && <button className="docs-primary-button" onClick={() => openOcr(version)}><Eye size={16} /> Revisar OCR</button>}{permissions.sign && <button className="docs-secondary-button" onClick={() => openSign(version)}><FileCheck2 size={16} /> Firmar internamente</button>}</div>
          {version.firmas.length > 0 && <div className="docs-signatures">{version.firmas.map((item) => <div key={item.id_firma}><ShieldCheck size={17} /><span><strong>{item.tipo} · {item.firmante_nombre}</strong><small>{item.firmante_cargo || 'Cargo no informado'} · {formatDateTime(item.firmada_en)}</small><small>{item.declaracion}</small></span></div>)}</div>}
          </div>
        </article>
      ))}</div></section>

      {modal === 'edit' && <Modal title="Editar ficha documental" eyebrow="Metadatos y vigencia" wide onClose={() => !saving && setModal(null)} actions={<><button className="docs-secondary-button" onClick={() => setModal(null)} disabled={saving}>Cancelar</button><button className="docs-primary-button" onClick={saveEdit} disabled={saving || form.titulo.trim().length < 3}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></>}><DocumentFields form={form} setForm={setForm} /></Modal>}
      {modal === 'version' && <Modal title="Incorporar nueva versión" eyebrow="El archivo anterior se conserva" onClose={() => !saving && setModal(null)} actions={<><button className="docs-secondary-button" onClick={() => setModal(null)} disabled={saving}>Cancelar</button><button className="docs-primary-button" onClick={addVersion} disabled={saving || !file}>{saving ? 'Guardando…' : 'Crear versión'}</button></>}><label className="docs-upload"><Upload size={23} /><span><strong>{file?.name || 'Seleccionar archivo'}</strong><small>PDF, PNG o JPG · máximo 8 MB</small></span><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label><label className="docs-field"><span>Notas de esta versión</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Qué cambió y por qué" /></label></Modal>}
      {modal?.type === 'ocr' && <Modal title={`Revisar OCR · versión ${modal.version.numero_version}`} eyebrow="Revisión humana obligatoria" wide onClose={() => !saving && setModal(null)} actions={<><button className="docs-danger-button" onClick={() => reviewOcr('RECHAZAR')} disabled={saving}>Rechazar propuesta</button><button className="docs-primary-button" onClick={() => reviewOcr('APROBAR')} disabled={saving || ocrText.trim().length < 2}>Aprobar texto revisado</button></>}><div className="docs-ocr-summary"><span>Confianza estimada <strong>{modal.version.ocr_confianza ?? 0}%</strong></span><span>Motor <strong>{modal.version.ocr_motor || 'OCR local'}</strong></span></div><label className="docs-field"><span>Texto propuesto</span><textarea className="docs-ocr-text" value={ocrText} onChange={(e) => setOcrText(e.target.value)} /></label><div className="docs-notice"><AlertTriangle size={20} /><span>Comprueba el texto con el archivo original. Aprobar OCR no modifica automáticamente la ficha del estudiante ni prueba la autenticidad del documento.</span></div></Modal>}
      {modal?.type === 'sign' && <Modal title={`Firmar versión ${modal.version.numero_version}`} eyebrow="Firma electrónica interna" onClose={() => !saving && setModal(null)} actions={<><button className="docs-secondary-button" onClick={() => setModal(null)} disabled={saving}>Cancelar</button><button className="docs-primary-button" onClick={sign} disabled={saving || signature.declaracion.trim().length < 12}>Registrar firma</button></>}><label className="docs-field"><span>Tipo</span><select value={signature.tipo} onChange={(e) => setSignature({ ...signature, tipo: e.target.value })}>{SIGNATURES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="docs-field"><span>Declaración</span><textarea value={signature.declaracion} onChange={(e) => setSignature({ ...signature, declaracion: e.target.value })} /></label><div className="docs-notice"><ShieldCheck size={20} /><span>Esta constancia autentica al usuario dentro del sistema y se vincula a la huella SHA-256 del archivo. No reemplaza una firma electrónica avanzada.</span></div></Modal>}
    </>
  );
};

const StudentDocuments = () => {
  const navigate = useNavigate();
  const { studentId, documentId } = useParams();
  const { user } = useContext(AuthContext);
  const permissions = {
    upload: hasPermission(user, PERMISSIONS.DOCUMENTS_UPLOAD),
    manage: hasPermission(user, PERMISSIONS.DOCUMENTS_MANAGE),
    sign: hasPermission(user, PERMISSIONS.DOCUMENTS_SIGN),
    templates: hasPermission(user, PERMISSIONS.DOCUMENTS_TEMPLATES),
    ocr: hasPermission(user, PERMISSIONS.DOCUMENTS_OCR),
  };
  return (
    <div className="docs-page">
      <header className="docs-page-header" data-tour="page-header"><div className="docs-page-header__identity"><span className="docs-page-header__icon"><FolderArchive size={26} /></span><div><span className="section-kicker">Gestión institucional protegida</span><DevelopmentBadge /><h1>Gestión documental</h1><p>Expedientes, versiones, vigencias y documentos de cada estudiante.</p></div></div><button type="button" className="docs-secondary-button" onClick={() => navigate('/admin')}><ArrowLeft size={17} /> Panel principal</button></header>
      <main className="docs-main">{documentId ? <DocumentDetail documentId={documentId} permissions={permissions} /> : studentId ? <StudentFile studentId={studentId} permissions={permissions} /> : <Dashboard permissions={permissions} />}</main>
    </div>
  );
};

export default StudentDocuments;
