import axios from 'axios';
import {
  AlertTriangle, ArrowLeftRight, Box, Check, ChevronLeft, ChevronRight, ClipboardCheck,
  Clock3, Edit3, Filter, PackageCheck, PackageOpen, Plus, RefreshCw, RotateCcw,
  Search, Send, UserRound, Wrench, X
} from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import ModuleHeader from './components/ModuleHeader';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { getApiErrorMessage } from './utils/apiError';
import { PERMISSIONS, hasPermission } from './permissions';
import './styles/internal-resources.css';

const API = '/api/recursos';
const PAGE_SIZE = 12;
const RESOURCE_STATES = { ACTIVO: 'Activo', MANTENCION: 'En mantención', BAJA: 'Dado de baja' };
const REQUEST_STATES = { PENDIENTE: 'Pendiente', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada', ENTREGADA: 'Entregada', CANCELADA: 'Cancelada' };
const RESOURCE_CATEGORY_SUGGESTIONS = [
  'Audiovisual',
  'Deportivo',
  'Herramientas',
  'Material didáctico',
  'Mobiliario',
  'Oficina',
  'Seguridad',
  'Tecnología'
];

const dateTime = (value) => value ? new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value)) : 'Sin fecha definida';
const dateOnly = (value) => value ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Sin fecha definida';
const emptyResource = { nombre: '', categoria: '', codigo_interno: '', descripcion: '', ubicacion: '', stock_total: 1, estado: 'ACTIVO', version: 1 };

const Pagination = ({ page, total, onChange }) => {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return <nav className="resources-pagination" aria-label="Páginas de resultados">
    <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior"><ChevronLeft /></button>
    <span>Página <strong>{page}</strong> de {pages}</span>
    <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Página siguiente"><ChevronRight /></button>
  </nav>;
};

const LoadState = ({ loading, error, empty, emptyText, onRetry }) => {
  if (loading) return <section className="resources-state" role="status"><RefreshCw className="spin" /><p>Cargando información…</p></section>;
  if (error) return <section className="resources-state resources-state--error" role="alert"><AlertTriangle /><div><strong>No pudimos cargar esta sección</strong><p>{error}</p></div><button type="button" onClick={onRetry}>Reintentar</button></section>;
  if (empty) return <section className="resources-state"><PackageOpen /><div><strong>Aún no hay información aquí</strong><p>{emptyText}</p></div></section>;
  return null;
};

const InternalResources = () => {
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const { notify, confirm } = useFeedback();
  const canManage = hasPermission(user, PERMISSIONS.RESOURCES_MANAGE);
  const canRequest = hasPermission(user, PERMISSIONS.RESOURCES_REQUEST);
  const [tab, setTab] = useState('catalogo');
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [catalog, setCatalog] = useState({ items: [], total: 0, categories: [] });
  const [loans, setLoans] = useState({ items: [], total: 0 });
  const [requests, setRequests] = useState({ items: [], total: 0 });
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [loading, setLoading] = useState({ catalogo: true, prestamos: false, solicitudes: false });
  const [errors, setErrors] = useState({ catalogo: '', prestamos: '', solicitudes: '' });
  const [pages, setPages] = useState({ catalogo: 1, prestamos: 1, solicitudes: 1 });
  const [filters, setFilters] = useState({ q: '', categoria: '', recurso_estado: '', prestamo_estado: '', solicitud_estado: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  const loadSummary = useCallback(async () => {
    try {
      setSummaryError('');
      const response = await axios.get(`${API}/resumen`, { withCredentials: true });
      setSummary(response.data);
    } catch (error) {
      setSummary(null);
      setSummaryError(getApiErrorMessage(error, 'No fue posible cargar el resumen de recursos.'));
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading((value) => ({ ...value, catalogo: true }));
    setErrors((value) => ({ ...value, catalogo: '' }));
    try {
      const response = await axios.get(`${API}/catalogo`, { params: {
        pagina: pages.catalogo, limite: PAGE_SIZE, q: filters.q,
        categoria: filters.categoria, estado: filters.recurso_estado
      }, withCredentials: true });
      setCatalog(response.data);
    } catch (error) {
      setCatalog((value) => ({ ...value, items: [], total: 0 }));
      setErrors((value) => ({ ...value, catalogo: getApiErrorMessage(error, 'No fue posible cargar el inventario.') }));
    } finally {
      setLoading((value) => ({ ...value, catalogo: false }));
    }
  }, [filters.categoria, filters.q, filters.recurso_estado, pages.catalogo]);

  const loadLoans = useCallback(async () => {
    setLoading((value) => ({ ...value, prestamos: true }));
    setErrors((value) => ({ ...value, prestamos: '' }));
    try {
      const response = await axios.get(`${API}/prestamos`, { params: {
        pagina: pages.prestamos, limite: PAGE_SIZE, estado: filters.prestamo_estado
      }, withCredentials: true });
      setLoans(response.data);
    } catch (error) {
      setLoans({ items: [], total: 0 });
      setErrors((value) => ({ ...value, prestamos: getApiErrorMessage(error, 'No fue posible cargar los préstamos.') }));
    } finally {
      setLoading((value) => ({ ...value, prestamos: false }));
    }
  }, [filters.prestamo_estado, pages.prestamos]);

  const loadRequests = useCallback(async () => {
    setLoading((value) => ({ ...value, solicitudes: true }));
    setErrors((value) => ({ ...value, solicitudes: '' }));
    try {
      const response = await axios.get(`${API}/solicitudes`, { params: {
        pagina: pages.solicitudes, limite: PAGE_SIZE, estado: filters.solicitud_estado
      }, withCredentials: true });
      setRequests(response.data);
    } catch (error) {
      setRequests({ items: [], total: 0 });
      setErrors((value) => ({ ...value, solicitudes: getApiErrorMessage(error, 'No fue posible cargar las solicitudes.') }));
    } finally {
      setLoading((value) => ({ ...value, solicitudes: false }));
    }
  }, [filters.solicitud_estado, pages.solicitudes]);

  const loadPeople = useCallback(async () => {
    if (!canManage) return;
    setPeopleLoading(true);
    setPeopleError('');
    try {
      const response = await axios.get(`${API}/personas`, { withCredentials: true });
      setPeople(response.data.people || []);
    } catch (error) {
      setPeople([]);
      setPeopleError(getApiErrorMessage(error, 'No fue posible cargar las personas habilitadas.'));
    } finally {
      setPeopleLoading(false);
    }
  }, [canManage]);

  useEffect(() => { loadSummary(); loadCatalog(); loadPeople(); }, [loadCatalog, loadPeople, loadSummary]);
  useEffect(() => { if (tab === 'prestamos') loadLoans(); }, [loadLoans, tab]);
  useEffect(() => { if (tab === 'solicitudes') loadRequests(); }, [loadRequests, tab]);

  const submittingRef = useRef(false);
  useEffect(() => { submittingRef.current = submitting; }, [submitting]);

  useEffect(() => {
    if (!dialog) return undefined;
    previousFocus.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => dialogRef.current?.querySelector('input, select, textarea, button')?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submittingRef.current) setDialog(null);
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus?.();
    };
  }, [dialog]);

  const refreshAll = async () => {
    await Promise.all([loadSummary(), loadCatalog(), tab === 'prestamos' ? loadLoans() : Promise.resolve(), tab === 'solicitudes' ? loadRequests() : Promise.resolve()]);
  };

  const openDialog = (type, item = null) => {
    if (type === 'resource') setForm(item ? { ...item } : { ...emptyResource });
    if (type === 'request') setForm({ id_recurso: item.id_recurso, recurso_nombre: item.nombre, cantidad: 1, motivo: '', necesita_en: '' });
    if (type === 'loan') setForm({ id_recurso: item.id_recurso, recurso_nombre: item.nombre, usuario_id: '', cantidad: 1, vence_en: '', condicion_entrega: '', observaciones: '' });
    if (type === 'decision') setForm({ id_solicitud: item.id_solicitud, recurso_nombre: item.recurso_nombre, estado: 'APROBADA', respuesta: '' });
    if (type === 'deliver') setForm({ id_solicitud: item.id_solicitud, recurso_nombre: item.recurso_nombre, vence_en: '', condicion_entrega: '', observaciones: '' });
    if (type === 'return') setForm({ id_prestamo: item.id_prestamo, recurso_nombre: item.recurso_nombre, condicion_devolucion: '' });
    setDialog({ type, item });
  };

  const closeDialog = () => { if (!submitting) setDialog(null); };
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submitDialog = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      let response;
      if (dialog.type === 'resource') {
        response = dialog.item
          ? await axios.patch(`${API}/catalogo/${dialog.item.id_recurso}`, form, { withCredentials: true })
          : await axios.post(`${API}/catalogo`, form, { withCredentials: true });
      } else if (dialog.type === 'request') {
        response = await axios.post(`${API}/solicitudes`, form, { withCredentials: true });
      } else if (dialog.type === 'loan') {
        response = await axios.post(`${API}/prestamos`, { ...form, vence_en: form.vence_en ? new Date(form.vence_en).toISOString() : null }, { withCredentials: true });
      } else if (dialog.type === 'decision') {
        response = await axios.patch(`${API}/solicitudes/${form.id_solicitud}/decision`, { estado: form.estado, respuesta: form.respuesta }, { withCredentials: true });
      } else if (dialog.type === 'deliver') {
        response = await axios.post(`${API}/solicitudes/${form.id_solicitud}/entregar`, { ...form, vence_en: form.vence_en ? new Date(form.vence_en).toISOString() : null }, { withCredentials: true });
      } else if (dialog.type === 'return') {
        response = await axios.patch(`${API}/prestamos/${form.id_prestamo}/devolver`, { condicion_devolucion: form.condicion_devolucion }, { withCredentials: true });
      }
      notify(response?.data?.message || 'La operación quedó registrada.', 'success');
      setDialog(null);
      await refreshAll();
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible completar la operación.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (item) => {
    const accepted = await confirm({ title: 'Cancelar solicitud', message: `La solicitud de “${item.recurso_nombre}” quedará cancelada y conservará su historial.`, confirmLabel: 'Cancelar solicitud', danger: true });
    if (!accepted) return;
    try {
      const response = await axios.patch(`${API}/solicitudes/${item.id_solicitud}/cancelar`, {}, { withCredentials: true });
      notify(response.data.message, 'success');
      await Promise.all([loadRequests(), loadSummary()]);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible cancelar la solicitud.'), 'error');
    }
  };

  const summaryCards = useMemo(() => [
    { label: 'Recursos vigentes', value: summary?.recursos ?? '—', icon: Box, tone: 'blue' },
    { label: 'Unidades disponibles', value: summary?.unidades_disponibles ?? '—', icon: PackageCheck, tone: 'green' },
    { label: 'Préstamos activos', value: summary?.prestamos_activos ?? '—', icon: ArrowLeftRight, tone: 'navy' },
    { label: 'Solicitudes pendientes', value: summary?.solicitudes_pendientes ?? '—', icon: ClipboardCheck, tone: Number(summary?.solicitudes_pendientes) > 0 ? 'ochre' : 'slate' }
  ], [summary]);

  const resourceCategoryOptions = useMemo(() => [...new Set([
    ...RESOURCE_CATEGORY_SUGGESTIONS,
    ...(Array.isArray(catalog.categories) ? catalog.categories : [])
  ])].sort((left, right) => left.localeCompare(right, 'es')), [catalog.categories]);

  const applySearch = (event) => {
    event.preventDefault();
    setPages((value) => ({ ...value, catalogo: 1 }));
    setFilters((value) => ({ ...value, q: searchDraft.trim() }));
  };

  const logoutAndLeave = () => { logout(); navigate('/login'); };

  return <main className="resources-page">
    <ModuleHeader icon={PackageOpen} title="Recursos internos" description="Inventario, solicitudes, entregas y devoluciones del equipo institucional." onBack={() => navigate('/admin')} onLogout={logoutAndLeave} />

    <section className="resources-intro" data-tour="resources-overview">
      <div><span className="section-kicker">Coordinación operativa</span><h2>Una vista clara de lo que existe y quién lo tiene</h2><p>El stock se descuenta únicamente al registrar una entrega. Las solicitudes pendientes no reservan unidades y todo cambio conserva trazabilidad.</p></div>
      {canManage && <button type="button" className="resources-primary" onClick={() => openDialog('resource')}><Plus /> Agregar recurso</button>}
    </section>

    {summaryError ? <section className="resources-summary-error" role="alert"><AlertTriangle /><span>{summaryError}</span><button type="button" onClick={loadSummary}>Reintentar</button></section> : <section className="resources-summary" aria-label="Resumen de recursos">
      {summaryCards.map((card) => <article key={card.label} data-tone={card.tone}><span><card.icon /></span><div><strong>{card.value}</strong><small>{card.label}</small></div></article>)}
      {Number(summary?.prestamos_vencidos) > 0 && <p className="resources-overdue"><Clock3 /> {summary.prestamos_vencidos} préstamo{summary.prestamos_vencidos === 1 ? '' : 's'} con devolución vencida</p>}
    </section>}

    <nav className="resources-tabs" aria-label="Secciones de recursos" data-tour="resources-tabs">
      {[['catalogo', 'Inventario'], ['prestamos', canManage ? 'Préstamos' : 'Mis préstamos'], ['solicitudes', canManage ? 'Solicitudes' : 'Mis solicitudes']].map(([key, label]) => <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}
    </nav>

    {tab === 'catalogo' && <section className="resources-panel" data-tour="resources-catalog">
      <header className="resources-panel__header"><div><span className="section-kicker">Inventario</span><h2>Catálogo institucional</h2><p>{catalog.total} recurso{catalog.total === 1 ? '' : 's'} en el alcance actual</p></div></header>
      <form className="resources-filters" onSubmit={applySearch}>
        <label className="resources-search"><span className="sr-only">Buscar recursos</span><Search /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Nombre, código o categoría" /><button type="submit">Buscar</button></label>
        <label><Filter /><span className="sr-only">Categoría</span><select value={filters.categoria} onChange={(event) => { setPages((v) => ({ ...v, catalogo: 1 })); setFilters((v) => ({ ...v, categoria: event.target.value })); }}><option value="">Todas las categorías</option>{catalog.categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label><Wrench /><span className="sr-only">Estado</span><select value={filters.recurso_estado} onChange={(event) => { setPages((v) => ({ ...v, catalogo: 1 })); setFilters((v) => ({ ...v, recurso_estado: event.target.value })); }}><option value="">Todos los estados</option>{Object.entries(RESOURCE_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </form>
      <LoadState loading={loading.catalogo} error={errors.catalogo} empty={!catalog.items.length} emptyText="Agrega el primer recurso o ajusta los filtros." onRetry={loadCatalog} />
      {!loading.catalogo && !errors.catalogo && catalog.items.length > 0 && <div className="resources-catalog-grid">
        {catalog.items.map((item) => <article className="resource-card" key={item.id_recurso} data-state={item.estado.toLowerCase()}>
          <header><span className="resource-card__icon"><Box /></span><div><span>{item.categoria}</span><h3>{item.nombre}</h3>{item.codigo_interno && <code>{item.codigo_interno}</code>}</div><em>{RESOURCE_STATES[item.estado]}</em></header>
          <p>{item.descripcion || 'Sin descripción adicional.'}</p>
          <dl><div><dt>Disponible</dt><dd><strong>{item.stock_disponible}</strong> de {item.stock_total}</dd></div><div><dt>Ubicación</dt><dd>{item.ubicacion || 'Sin ubicación'}</dd></div></dl>
          <div className="resource-stock" role="progressbar" aria-label="Unidades disponibles" aria-valuemin="0" aria-valuemax={item.stock_total} aria-valuenow={item.stock_disponible}><i style={{ width: `${Math.min(100, (item.stock_disponible / item.stock_total) * 100)}%` }} /></div>
          <footer>
            {canRequest && item.estado === 'ACTIVO' && <button type="button" onClick={() => openDialog('request', item)}><Send /> Solicitar</button>}
            {canManage && item.estado === 'ACTIVO' && item.stock_disponible > 0 && <button type="button" onClick={() => openDialog('loan', item)}><ArrowLeftRight /> Prestar</button>}
            {canManage && <button type="button" onClick={() => openDialog('resource', item)}><Edit3 /> Editar</button>}
          </footer>
        </article>)}
      </div>}
      <Pagination page={pages.catalogo} total={catalog.total} onChange={(page) => setPages((value) => ({ ...value, catalogo: page }))} />
    </section>}

    {tab === 'prestamos' && <section className="resources-panel" data-tour="resources-loans">
      <header className="resources-panel__header resources-panel__header--filter"><div><span className="section-kicker">Circulación</span><h2>{canManage ? 'Préstamos registrados' : 'Mis préstamos'}</h2><p>{loans.total} registro{loans.total === 1 ? '' : 's'} en el alcance actual</p></div><label>Estado<select value={filters.prestamo_estado} onChange={(event) => { setPages((v) => ({ ...v, prestamos: 1 })); setFilters((v) => ({ ...v, prestamo_estado: event.target.value })); }}><option value="">Todos</option><option value="ACTIVO">Activos</option><option value="VENCIDO">Vencidos</option><option value="DEVUELTO">Devueltos</option><option value="CANCELADO">Cancelados</option></select></label></header>
      <LoadState loading={loading.prestamos} error={errors.prestamos} empty={!loans.items.length} emptyText="No hay préstamos para este filtro." onRetry={loadLoans} />
      {!loading.prestamos && !errors.prestamos && loans.items.length > 0 && <div className="resources-list">
        {loans.items.map((item) => <article key={item.id_prestamo} data-urgent={item.vencido || undefined}>
          <span className="resources-list__icon"><ArrowLeftRight /></span><div className="resources-list__main"><header><h3>{item.recurso_nombre}</h3><em>{item.vencido ? 'Vencido' : item.estado === 'ACTIVO' ? 'Activo' : item.estado === 'DEVUELTO' ? 'Devuelto' : 'Cancelado'}</em></header><p><UserRound /> {item.usuario_nombre}{item.usuario_cargo ? ` · ${item.usuario_cargo}` : ''}</p><dl><div><dt>Cantidad</dt><dd>{item.cantidad}</dd></div><div><dt>Entrega</dt><dd>{dateTime(item.prestado_en)}</dd></div><div><dt>Devolución esperada</dt><dd>{dateTime(item.vence_en)}</dd></div></dl></div>
          {canManage && item.estado === 'ACTIVO' && <button type="button" className="resources-inline-action" onClick={() => openDialog('return', item)}><RotateCcw /> Registrar devolución</button>}
        </article>)}
      </div>}
      <Pagination page={pages.prestamos} total={loans.total} onChange={(page) => setPages((value) => ({ ...value, prestamos: page }))} />
    </section>}

    {tab === 'solicitudes' && <section className="resources-panel" data-tour="resources-requests">
      <header className="resources-panel__header resources-panel__header--filter"><div><span className="section-kicker">Solicitudes</span><h2>{canManage ? 'Solicitudes del equipo' : 'Mis solicitudes'}</h2><p>{requests.total} solicitud{requests.total === 1 ? '' : 'es'} en el alcance actual</p></div><label>Estado<select value={filters.solicitud_estado} onChange={(event) => { setPages((v) => ({ ...v, solicitudes: 1 })); setFilters((v) => ({ ...v, solicitud_estado: event.target.value })); }}><option value="">Todos</option>{Object.entries(REQUEST_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></header>
      <LoadState loading={loading.solicitudes} error={errors.solicitudes} empty={!requests.items.length} emptyText="No hay solicitudes para este filtro." onRetry={loadRequests} />
      {!loading.solicitudes && !errors.solicitudes && requests.items.length > 0 && <div className="resources-list">
        {requests.items.map((item) => <article key={item.id_solicitud}>
          <span className="resources-list__icon"><ClipboardCheck /></span><div className="resources-list__main"><header><h3>{item.recurso_nombre}</h3><em data-state={item.estado.toLowerCase()}>{REQUEST_STATES[item.estado]}</em></header>{canManage && <p><UserRound /> {item.solicitante_nombre}{item.solicitante_cargo ? ` · ${item.solicitante_cargo}` : ''}</p>}<p className="resources-list__reason">{item.motivo}</p><dl><div><dt>Cantidad</dt><dd>{item.cantidad}</dd></div><div><dt>Solicitado</dt><dd>{dateTime(item.creado_en)}</dd></div><div><dt>Necesario para</dt><dd>{dateOnly(item.necesita_en)}</dd></div></dl>{item.respuesta && <p className="resources-list__response"><strong>Respuesta:</strong> {item.respuesta}</p>}</div>
          <div className="resources-list__actions">
            {canManage && item.estado === 'PENDIENTE' && <button type="button" onClick={() => openDialog('decision', item)}><Check /> Resolver</button>}
            {canManage && ['PENDIENTE', 'APROBADA'].includes(item.estado) && <button type="button" onClick={() => openDialog('deliver', item)}><PackageCheck /> Entregar</button>}
            {canRequest && Number(item.solicitante_id) === Number(user.id) && ['PENDIENTE', 'APROBADA'].includes(item.estado) && <button type="button" className="danger" onClick={() => cancelRequest(item)}><X /> Cancelar</button>}
          </div>
        </article>)}
      </div>}
      <Pagination page={pages.solicitudes} total={requests.total} onChange={(page) => setPages((value) => ({ ...value, solicitudes: page }))} />
    </section>}

    {dialog && createPortal(<div className="resources-dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
      <form ref={dialogRef} className="resources-dialog" role="dialog" aria-modal="true" aria-labelledby="resources-dialog-title" onSubmit={submitDialog} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="section-kicker">Recursos internos</span><h2 id="resources-dialog-title">{{ resource: dialog.item ? 'Editar recurso' : 'Agregar recurso', request: 'Solicitar recurso', loan: 'Registrar préstamo', decision: 'Resolver solicitud', deliver: 'Registrar entrega', return: 'Registrar devolución' }[dialog.type]}</h2></div><button type="button" onClick={closeDialog} aria-label="Cerrar"><X /></button></header>
        {dialog.type === 'resource' && <div className="resources-form-grid"><label className="span-2">Nombre<input required minLength={3} maxLength={180} value={form.nombre} onChange={(e) => setField('nombre', e.target.value)} /></label><label>Categoría<input aria-label="Categoría" aria-describedby="resource-category-hint" required minLength={2} maxLength={80} list="resource-category-suggestions" placeholder="Escribe o elige una categoría" value={form.categoria} onChange={(e) => setField('categoria', e.target.value)} /><datalist id="resource-category-suggestions">{resourceCategoryOptions.map((category) => <option key={category} value={category} />)}</datalist><small id="resource-category-hint">Puedes elegir una sugerencia o escribir una categoría nueva.</small></label><label>Código interno<input maxLength={80} value={form.codigo_interno || ''} onChange={(e) => setField('codigo_interno', e.target.value)} /></label><label>Stock total<input type="number" min="1" max="10000" required value={form.stock_total} onChange={(e) => setField('stock_total', Number(e.target.value))} /></label><label>Estado<select value={form.estado} onChange={(e) => setField('estado', e.target.value)}>{Object.entries(RESOURCE_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="span-2">Ubicación<input maxLength={180} value={form.ubicacion || ''} onChange={(e) => setField('ubicacion', e.target.value)} /></label><label className="span-2">Descripción<textarea maxLength={1000} value={form.descripcion || ''} onChange={(e) => setField('descripcion', e.target.value)} /></label></div>}
        {dialog.type === 'request' && <div className="resources-form-grid"><p className="resources-dialog__subject span-2"><Box /> {form.recurso_nombre}</p><label>Cantidad<input type="number" min="1" max="10000" required value={form.cantidad} onChange={(e) => setField('cantidad', Number(e.target.value))} /></label><label>Necesario para<input type="date" value={form.necesita_en} onChange={(e) => setField('necesita_en', e.target.value)} /></label><label className="span-2">¿Para qué lo necesitas?<textarea required minLength={5} maxLength={1000} value={form.motivo} onChange={(e) => setField('motivo', e.target.value)} /></label><p className="resources-form-note span-2">La solicitud no descuenta stock hasta que una persona autorizada registre la entrega.</p></div>}
        {dialog.type === 'loan' && <div className="resources-form-grid"><p className="resources-dialog__subject span-2"><Box /> {form.recurso_nombre}</p>{peopleError ? <div className="resources-directory-error span-2" role="alert"><AlertTriangle /><span>{peopleError}</span><button type="button" onClick={loadPeople}>Reintentar</button></div> : <label className="span-2">Persona<select required disabled={peopleLoading} value={form.usuario_id} onChange={(e) => setField('usuario_id', Number(e.target.value))}><option value="">{peopleLoading ? 'Cargando personas…' : people.length ? 'Selecciona una persona' : 'No hay personas habilitadas'}</option>{people.map((person) => <option key={person.id} value={person.id}>{person.nombre} · {person.cargo}</option>)}</select></label>}<label>Cantidad<input type="number" min="1" max="10000" required value={form.cantidad} onChange={(e) => setField('cantidad', Number(e.target.value))} /></label><label>Devolución esperada<input type="datetime-local" value={form.vence_en} onChange={(e) => setField('vence_en', e.target.value)} /></label><label className="span-2">Condición al entregar<textarea maxLength={500} value={form.condicion_entrega} onChange={(e) => setField('condicion_entrega', e.target.value)} /></label></div>}
        {dialog.type === 'decision' && <div className="resources-form-grid"><p className="resources-dialog__subject span-2"><ClipboardCheck /> {form.recurso_nombre}</p><label className="span-2">Decisión<select value={form.estado} onChange={(e) => setField('estado', e.target.value)}><option value="APROBADA">Aprobar</option><option value="RECHAZADA">Rechazar</option></select></label><label className="span-2">Respuesta<textarea required={form.estado === 'RECHAZADA'} minLength={form.estado === 'RECHAZADA' ? 5 : 0} maxLength={1000} value={form.respuesta} onChange={(e) => setField('respuesta', e.target.value)} /></label><p className="resources-form-note span-2">Aprobar no descuenta stock. La entrega se registra por separado.</p></div>}
        {dialog.type === 'deliver' && <div className="resources-form-grid"><p className="resources-dialog__subject span-2"><PackageCheck /> {form.recurso_nombre}</p><label className="span-2">Devolución esperada<input type="datetime-local" value={form.vence_en} onChange={(e) => setField('vence_en', e.target.value)} /></label><label className="span-2">Condición al entregar<textarea maxLength={500} value={form.condicion_entrega} onChange={(e) => setField('condicion_entrega', e.target.value)} /></label><p className="resources-form-note span-2">Al confirmar, el sistema vuelve a comprobar el stock bajo bloqueo antes de crear el préstamo.</p></div>}
        {dialog.type === 'return' && <div className="resources-form-grid"><p className="resources-dialog__subject span-2"><RotateCcw /> {form.recurso_nombre}</p><label className="span-2">Condición al devolver<textarea maxLength={500} value={form.condicion_devolucion} onChange={(e) => setField('condicion_devolucion', e.target.value)} /></label><p className="resources-form-note span-2">La unidad volverá a quedar disponible inmediatamente y el préstamo conservará su historial.</p></div>}
        <footer><button type="button" onClick={closeDialog} disabled={submitting}>Volver</button><button type="submit" className="resources-primary" disabled={submitting}>{submitting ? <RefreshCw className="spin" /> : <Check />} {submitting ? 'Guardando…' : 'Confirmar'}</button></footer>
      </form>
    </div>, document.body)}
  </main>;
};

export default InternalResources;
