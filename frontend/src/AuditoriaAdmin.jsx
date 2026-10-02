import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import axios from 'axios';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Download,
  RefreshCw, UserRound, X
} from 'lucide-react';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import DateRangeField from './components/DateRangeField';
import AppSelect from './components/AppSelect';
import { getApiErrorMessage } from './utils/apiError';

const PAGE_SIZE = 20;
const toIsoDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');
const today = new Date();
const thirtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
const DEFAULT_PERIOD = { from: toIsoDate(thirtyDaysAgo), to: toIsoDate(today) };

const EMPTY_SUMMARY = Object.freeze({ acceso: 0, consulta: 0, cambio: 0, descarga: 0 });
const EMPTY_CATALOGS = Object.freeze({ actions: [], entities: [], categories: [] });
const CATEGORY_OPTIONS = [
  { value: 'ACCESO', label: 'Accesos', description: 'Ingresos, salidas y credenciales' },
  { value: 'CONSULTA', label: 'Consultas', description: 'Fichas y registros revisados' },
  { value: 'CAMBIO', label: 'Cambios', description: 'Creaciones y modificaciones' },
  { value: 'DESCARGA', label: 'Descargas', description: 'Archivos y exportaciones' }
];

const WORD_LABELS = {
  id: 'Identificador', ip: 'Dirección de red', pdf: 'PDF', ocr: 'OCR', mrz: 'MRZ',
  xlsx: 'Excel', rut: 'RUT', erp: 'ERP', url: 'Enlace', api: 'API', auditoria: 'auditoría'
};
const humanizeCode = (value) => String(value || '')
  .toLowerCase()
  .split('_')
  .filter(Boolean)
  .map((word) => WORD_LABELS[word] || word)
  .join(' ')
  .replace(/^./u, (letter) => letter.toUpperCase());
const sectionLabel = (value) => ({
  audit_log: 'Registro de auditoría', analitica_institucional: 'Analítica institucional',
  perfil_acceso: 'Perfil de acceso', seguimiento_caso: 'Caso de seguimiento'
}[value] || humanizeCode(value));
const formatDetailValue = (value) => {
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  if (value === null || value === undefined || value === '') return 'Sin dato';
  if (Array.isArray(value)) return value.map(formatDetailValue).join(', ');
  if (typeof value === 'object') return Object.entries(value)
    .map(([key, child]) => `${humanizeCode(key)}: ${formatDetailValue(child)}`).join(' · ');
  if (typeof value === 'string' && /^[A-Z0-9_]+$/u.test(value)) return humanizeCode(value);
  return String(value);
};
const formatDetailsForExport = (detail) => Object.entries(detail || {})
  .map(([key, value]) => `${humanizeCode(key)}: ${formatDetailValue(value)}`).join('; ');

const ACTION_TONE = {
  LOGIN_EXITOSO: 'success', REACTIVAR_PERFIL_ACCESO: 'success', ACTIVAR_USUARIO: 'success',
  REGISTRAR_INGRESO: 'success', AUTORIZAR_RETIRO_ALUMNO: 'success',
  LOGIN_FALLIDO: 'danger', ELIMINAR_USUARIO: 'danger', DESACTIVAR_USUARIO: 'danger',
  DESACTIVAR_PERFIL_ACCESO: 'danger', ELIMINAR_PERFIL_ACCESO: 'danger',
  ANULAR_REGISTRO_PUNTUALIDAD: 'danger', RECHAZAR_RETIRO_ALUMNO: 'danger',
  CREAR_PERFIL_ACCESO: 'info', EDITAR_PERFIL_ACCESO: 'info'
};

const formatDateTime = (iso) => iso ? new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'short', timeStyle: 'medium'
}).format(new Date(iso)) : '—';

const formatPeriodDate = (value) => new Intl.DateTimeFormat('es-CL', {
  day: '2-digit', month: 'short', year: 'numeric'
}).format(new Date(`${value}T12:00:00`)).replace(/\./g, '');

const relationLabel = (kind) => ({
  realizada: 'Realizada por la cuenta',
  sobre_cuenta: 'Cambio sobre la cuenta',
  sobre_perfil: 'Cambio sobre el perfil',
  realizada_por_cuenta: 'Realizada por una cuenta del perfil'
}[kind] || 'Actividad relacionada');

const AuditRow = ({ row, scoped }) => {
  const [expanded, setExpanded] = useState(false);
  const detailEntries = Object.entries(row.detalle || {});
  const hasDetail = detailEntries.length > 0;
  return <>
    <tr>
      <td>{formatDateTime(row.fecha)}</td>
      <td><strong>{row.usuario_nombre || row.usuario_correo || 'Sistema'}</strong>{row.usuario_correo && <small>{row.usuario_correo}</small>}</td>
      <td><span className="audit-action" data-tone={ACTION_TONE[row.accion] || 'neutral'}>{humanizeCode(row.accion)}</span><small>{humanizeCode(row.categoria)}</small></td>
      {scoped && <td><span className="audit-relationship" data-kind={row.relacion_cuenta}>{relationLabel(row.relacion_cuenta)}</span></td>}
      <td>{row.entidad ? <><strong>{sectionLabel(row.entidad)}</strong>{row.entidad_id ? <small>Registro {row.entidad_id}</small> : null}</> : '—'}</td>
      <td>{row.ip || '—'}</td>
      <td className="audit-detail-cell">{hasDetail
        ? <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? 'Ocultar' : 'Ver'}</button>
        : '—'}</td>
    </tr>
    {expanded && hasDetail && <tr className="audit-detail-row"><td colSpan={scoped ? 7 : 6}><pre>{detailEntries.map(([key, value]) => `${humanizeCode(key)}: ${formatDetailValue(value)}`).join('\n')}</pre></td></tr>}
  </>;
};

const AuditoriaAdmin = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get('cuenta_id') || '';
  const sourceProfile = searchParams.get('perfil') || '';
  const profileCode = searchParams.get('perfil_codigo') || '';
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState(null);
  const [profileSubject, setProfileSubject] = useState(null);
  const [profileAccounts, setProfileAccounts] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [catalogs, setCatalogs] = useState(EMPTY_CATALOGS);
  const [action, setAction] = useState('');
  const [category, setCategory] = useState('');
  const [entity, setEntity] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('todas');
  const [profileAccount, setProfileAccount] = useState('');
  const [from, setFrom] = useState(DEFAULT_PERIOD.from);
  const [to, setTo] = useState(DEFAULT_PERIOD.to);
  const [exportNotice, setExportNotice] = useState('');
  const scoped = Boolean(subject || profileSubject);
  const periodLabel = from === DEFAULT_PERIOD.from && to === DEFAULT_PERIOD.to ? 'últimos 30 días' : 'período seleccionado';

  const currentFilters = useMemo(() => ({ action, category, entity, email, relationship, profileAccount, from, to }), [action, category, entity, email, relationship, profileAccount, from, to]);
  const buildParams = useCallback((filters, pg = 1, exporting = false) => {
    const params = new URLSearchParams({ page: String(pg), limit: exporting ? '10000' : String(PAGE_SIZE) });
    if (exporting) params.set('exportar', '1');
    if (filters.action) params.set('accion', filters.action);
    if (filters.category) params.set('categoria', filters.category);
    if (filters.entity) params.set('entidad', filters.entity);
    if (filters.email) params.set('usuario_correo', filters.email);
    if (filters.from) params.set('desde', filters.from);
    if (filters.to) params.set('hasta', filters.to);
    if (accountId) params.set('cuenta_id', accountId);
    if (accountId && filters.relationship !== 'todas') params.set('relacion', filters.relationship);
    if (profileCode) params.set('perfil_codigo', profileCode);
    if (profileCode && filters.profileAccount) params.set('cuenta_perfil_id', filters.profileAccount);
    return params;
  }, [accountId, profileCode]);

  const fetchData = useCallback(async (pg = 1, override = null) => {
    const filters = override || currentFilters;
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${API_URL}/audit?${buildParams(filters, pg)}`, { withCredentials: true });
      setRows(response.data.rows || []);
      setTotal(response.data.total || 0);
      setPages(response.data.pages || 1);
      setPage(pg);
      setSubject(response.data.subject || null);
      setProfileSubject(response.data.profile || null);
      setProfileAccounts(response.data.profile_accounts || []);
      setSummary({ ...EMPTY_SUMMARY, ...(response.data.summary || {}) });
      setCatalogs({ ...EMPTY_CATALOGS, ...(response.data.catalogs || {}) });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible cargar la auditoría.'));
    } finally {
      setLoading(false);
    }
  }, [buildParams, currentFilters]);

  useEffect(() => { fetchData(1); }, [accountId, profileCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetFilters = () => {
    const clean = { action: '', category: '', entity: '', email: '', relationship: 'todas', profileAccount: '', ...DEFAULT_PERIOD };
    setAction(''); setCategory(''); setEntity(''); setEmail(''); setRelationship('todas'); setProfileAccount('');
    setFrom(clean.from); setTo(clean.to);
    fetchData(1, clean);
  };

  const exportExcel = async () => {
    if (!total) return;
    setError('');
    setExportNotice('');
    try {
      const response = await axios.get(`${API_URL}/audit?${buildParams(currentFilters, 1, true)}`, { withCredentials: true });
      const xlsxModule = await import('xlsx');
      const XLSX = xlsxModule.default || xlsxModule;
      const data = (response.data.rows || []).map((row) => ({
        'Fecha / hora': formatDateTime(row.fecha),
        'Ejecutado por': row.usuario_nombre || row.usuario_correo || 'Sistema',
        Correo: row.usuario_correo || '',
        Categoría: humanizeCode(row.categoria),
        Acción: humanizeCode(row.accion),
        Relación: relationLabel(row.relacion_cuenta),
        Entidad: sectionLabel(row.entidad),
        'Entidad ID': row.entidad_id ?? '',
        IP: row.ip || '',
        Detalle: formatDetailsForExport(row.detalle)
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Auditoría');
      const scope = subject || profileSubject;
      const suffix = scope ? `_${scope.nombre || scope.correo}`.replace(/[^a-zA-Z0-9_-]+/g, '_') : '';
      XLSX.writeFile(workbook, `auditoria${suffix}_${toIsoDate(new Date())}.xlsx`);
      setExportNotice(response.data.truncated
        ? 'Se descargaron los primeros 10.000 eventos del período. Acota los filtros para exportar el resto.'
        : `Se descargaron ${data.length} eventos con los filtros visibles.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible exportar la actividad filtrada.'));
    }
  };

  const backPath = profileSubject
    ? `/admin/usuarios/${encodeURIComponent(profileSubject.codigo)}`
    : subject && sourceProfile ? `/admin/usuarios/${encodeURIComponent(sourceProfile)}` : '/admin';
  const title = profileSubject ? `Actividad del perfil ${profileSubject.nombre}` : subject ? `Actividad de ${subject.nombre || subject.correo}` : 'Auditoría del sistema';
  const description = `${profileSubject ? `Actividad consolidada · ${profileSubject.account_count} cuenta${profileSubject.account_count !== 1 ? 's' : ''}` : subject ? 'Historial individual' : 'Trazabilidad institucional'} · ${total} evento${total !== 1 ? 's' : ''} · ${periodLabel}`;

  return <div className="app-container audit-page"><div className="glass-panel audit-shell">
    <ModuleHeader icon={ClipboardList} title={title} description={description} onBack={() => navigate(backPath)} backLabel={scoped ? 'Volver al perfil' : 'Panel principal'}>
      <button type="button" className="module-header__button" onClick={() => fetchData(page)}><RefreshCw size={14} /> Actualizar</button>
      <button type="button" className="module-header__button" onClick={exportExcel} disabled={!total}><Download size={14} /> Excel</button>
    </ModuleHeader>

    {subject && <section className="audit-subject" data-tour="audit-subject">
      <span className="audit-subject__avatar"><UserRound size={22} /></span>
      <div><span className="section-kicker">Cuenta seleccionada</span><strong>{subject.nombre || subject.correo}</strong><p>{subject.correo}{subject.cargo ? ` · ${subject.cargo}` : ''}{subject.profile_name ? ` · ${subject.profile_name}` : ''}</p></div>
      <span className="audit-subject__status" data-deleted={subject.eliminado_en || undefined}>{subject.eliminado_en ? 'Cuenta eliminada' : subject.activo ? 'Cuenta activa' : 'Cuenta desactivada'}</span>
      <button type="button" className="secondary-action" onClick={() => navigate('/admin/auditoria')}><X size={16} /> Ver auditoría completa</button>
    </section>}
    {profileSubject && <section className="audit-subject audit-subject--profile" data-tour="audit-subject">
      <span className="audit-subject__avatar"><ClipboardList size={22} /></span>
      <div><span className="section-kicker">Perfil seleccionado</span><strong>{profileSubject.nombre}</strong><p>{profileSubject.descripcion || 'Sin descripción'} · {profileSubject.permission_count} funciones recomendadas</p></div>
      <span className="audit-subject__status" data-deleted={!profileSubject.activo || undefined}>{profileSubject.activo ? 'Perfil activo' : 'Perfil desactivado'}</span>
      <button type="button" className="secondary-action" onClick={() => navigate('/admin/auditoria')}><X size={16} /> Ver auditoría completa</button>
    </section>}

    <section className="analytics-kpi-grid audit-kpi-grid" aria-label="Resumen de actividad del período">
      {CATEGORY_OPTIONS.map(({ value, label, description }) => { const Icon = value === 'DESCARGA' ? Download : ClipboardList; return <div key={value} className="analytics-kpi" data-tone={value === 'DESCARGA' ? 'green' : value === 'CAMBIO' ? 'amber' : 'navy'}><div className="analytics-kpi__icon"><Icon size={18} /></div><div><strong>{summary[value.toLowerCase()] || 0}</strong><span>{label}</span><small>{description}</small></div></div>; })}
    </section>

    <form className="audit-filters" data-tour="audit-filters" onSubmit={(event) => { event.preventDefault(); fetchData(1); }}>
      <label><span>Categoría</span><AppSelect ariaLabel="Filtrar por categoría de actividad" value={category} onChange={setCategory} options={[{ value: '', label: 'Todas las categorías' }, ...CATEGORY_OPTIONS.map((item) => ({ value: item.value, label: item.label }))]} /></label>
      <label><span>Acción</span><AppSelect ariaLabel="Filtrar por acción" value={action} onChange={setAction} options={[{ value: '', label: 'Todas las acciones' }, ...(catalogs.actions || []).map((value) => ({ value, label: humanizeCode(value) }))]} /></label>
      <label><span>Sección afectada</span><AppSelect ariaLabel="Filtrar por sección afectada" value={entity} onChange={setEntity} options={[{ value: '', label: 'Todas las secciones' }, ...(catalogs.entities || []).map((value) => ({ value, label: sectionLabel(value) }))]} /></label>
      {!scoped && <label><span>Usuario</span><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Buscar por correo" /></label>}
      {subject && <label><span>Actividad de la cuenta</span><AppSelect ariaLabel="Filtrar relación con la cuenta" value={relationship} onChange={setRelationship} options={[{ value: 'todas', label: 'Toda la actividad' }, { value: 'realizada', label: 'Realizada por la cuenta' }, { value: 'sobre_cuenta', label: 'Cambios sobre la cuenta' }]} /></label>}
      {profileSubject && <label><span>Cuenta / usuario</span><AppSelect ariaLabel="Filtrar por cuenta del perfil" value={profileAccount} onChange={setProfileAccount} options={[{ value: '', label: 'Todas las cuentas' }, ...profileAccounts.map((account) => ({ value: String(account.id), label: account.nombre || account.correo }))]} /></label>}
      <div className="audit-date-range"><DateRangeField label="Período" from={from} to={to} onChange={(range) => { setFrom(range.from); setTo(range.to); }} maxValue={DEFAULT_PERIOD.to} /></div>
      <button type="submit" className="primary-action" disabled={loading}>{loading ? 'Buscando…' : 'Buscar'}</button>
      <button type="button" className="module-header__button" onClick={resetFilters}>Restablecer</button>
    </form>

    <div className="audit-results-context" role="status"><strong>{total} evento{total !== 1 ? 's' : ''}</strong><span>entre {formatPeriodDate(from)} y {formatPeriodDate(to)}</span>{profileSubject && <span>Actividad consolidada del perfil y sus cuentas.</span>}</div>
    {error && <div className="audit-error" role="alert">{error}</div>}
    {exportNotice && <div className="audit-results-context" role="status">{exportNotice}</div>}
    <div className="audit-table-wrap" data-tour="audit-list">
      {loading ? <div className="audit-empty">Cargando actividad…</div> : !rows.length ? <div className="audit-empty">No hay eventos para los filtros seleccionados.</div> : <table className="audit-table">
        <thead><tr><th>Fecha / hora</th><th>Ejecutado por</th><th>Actividad</th>{scoped && <th>Relación</th>}<th>Sección / registro</th><th>Equipo / red</th><th>Detalle</th></tr></thead>
        <tbody>{rows.map((row) => <AuditRow key={row.id} row={row} scoped={scoped} />)}</tbody>
      </table>}
    </div>
    {pages > 1 && <nav className="audit-pagination" aria-label="Páginas de actividad">
      <button type="button" disabled={page <= 1} onClick={() => fetchData(page - 1)}><ChevronLeft size={14} /> Anterior</button>
      <span>Página {page} de {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => fetchData(page + 1)}>Siguiente <ChevronRight size={14} /></button>
    </nav>}
  </div></div>;
};

export default AuditoriaAdmin;
