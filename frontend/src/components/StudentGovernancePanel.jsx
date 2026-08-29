import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileSpreadsheet,
  FileClock,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { API_URL } from '../config';
import { getStudentIdentifier, getStudentIdentifierLabel } from '../utils/studentFormat';
import { getApiErrorMessage } from '../utils/apiError';

const reasonLabels = {
  MATRICULA_RECIENTE: 'Matrícula reciente',
  TRASLADO_ESTABLECIMIENTO: 'Traslado desde otro establecimiento',
  PENDIENTE_ERP: 'Ingreso pendiente en ERP',
  ERROR_TEMPORAL_ERP: 'Error temporal del ERP',
  REGULARIZACION_INSTITUCIONAL: 'Regularización institucional',
  OTRO: 'Otro'
};

const qualityLabels = {
  manuales_pendientes: 'Altas manuales pendientes',
  rut_invalidos: 'RUT chilenos inválidos almacenados',
  sin_curso: 'Sin curso vigente',
  sin_apoderado: 'Sin apoderado',
  telefono_incompleto: 'Teléfono incompleto',
  matriculas_duplicadas: 'Matrículas duplicadas',
  conflictos_erp: 'Conflictos ERP recientes',
  inactivos_reaparecidos: 'Fichas inactivas reactivadas',
  validacion_documental_pendiente: 'Documentos pendientes de validación'
};

const studentName = (student) => (
  [student?.nombres, student?.paterno, student?.materno].filter(Boolean).join(' ')
);

const StudentGovernancePanel = ({
  onOpenStudent,
  canManage = false,
  canExport = false
}) => {
  const [view, setView] = useState('quality');
  const [quality, setQuality] = useState(null);
  const [activeQualityKey, setActiveQualityKey] = useState('');
  const [pending, setPending] = useState([]);
  const [imports, setImports] = useState([]);
  const [importDetail, setImportDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [primary, setPrimary] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [mergePreview, setMergePreview] = useState(null);
  const [mergeReason, setMergeReason] = useState('');
  const [merging, setMerging] = useState(false);
  const [exporting, setExporting] = useState('');
  const [exportNotice, setExportNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [qualityResponse, pendingResponse, importsResponse] = await Promise.all([
        axios.get(`${API_URL}/padron/quality`, { withCredentials: true }),
        axios.get(`${API_URL}/padron/manual-pending`, { withCredentials: true }),
        axios.get(`${API_URL}/padron/imports`, { withCredentials: true })
      ]);
      setQuality(qualityResponse.data);
      setPending(pendingResponse.data?.students || []);
      setImports(importsResponse.data?.imports || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible cargar el control del padrón.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setMatches([]);
      return undefined;
    }
    const timeout = window.setTimeout(async () => {
      try {
        const response = await axios.get(`${API_URL}/students/search`, {
          params: { q: query },
          withCredentials: true
        });
        setMatches(response.data || []);
      } catch {
        setMatches([]);
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setMergePreview(null);
    if (!primary || !duplicate) return;
    axios.post(
      `${API_URL}/padron/merge-preview`,
      { primary_id: primary.id_alumno, duplicate_id: duplicate.id_alumno },
      { withCredentials: true }
    ).then((response) => setMergePreview(response.data))
      .catch((requestError) => setError(getApiErrorMessage(requestError, 'No fue posible evaluar la fusión.')));
  }, [primary, duplicate]);

  const qualityTotal = useMemo(() => (
    Object.values(quality?.indicators || {}).reduce((sum, value) => sum + Number(value || 0), 0)
  ), [quality]);
  const activeQualityCases = quality?.cases?.[activeQualityKey] || [];

  const showImport = async (id) => {
    setError('');
    try {
      const response = await axios.get(`${API_URL}/padron/imports/${id}`, { withCredentials: true });
      setImportDetail(response.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible abrir la importación.'));
    }
  };

  const selectMergeStudent = (student) => {
    if (!primary) setPrimary(student);
    else if (Number(primary.id_alumno) !== Number(student.id_alumno)) setDuplicate(student);
    setSearch('');
    setMatches([]);
  };

  const mergeStudents = async () => {
    if (!mergePreview?.can_merge || mergeReason.trim().length < 10 || merging) return;
    setMerging(true);
    setError('');
    try {
      await axios.post(
        `${API_URL}/padron/merge`,
        {
          primary_id: primary.id_alumno,
          duplicate_id: duplicate.id_alumno,
          motivo: mergeReason
        },
        { withCredentials: true }
      );
      setPrimary(null);
      setDuplicate(null);
      setMergePreview(null);
      setMergeReason('');
      await load();
    } catch (requestError) {
      const blockers = requestError.response?.data?.blockers;
      setError(blockers?.length
        ? blockers.join(' ')
        : getApiErrorMessage(requestError, 'No fue posible fusionar las fichas.'));
    } finally {
      setMerging(false);
    }
  };

  const downloadExport = async (scope) => {
    if (exporting) return;
    setExporting(scope);
    setError('');
    setExportNotice('');
    try {
      const response = await axios.get(`${API_URL}/padron/export`, {
        params: { scope },
        responseType: 'blob',
        withCredentials: true
      });
      const contentDisposition = response.headers['content-disposition'] || '';
      const fileName = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1]
        || `padron-${scope}.xlsx`;
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportNotice('Exportación generada con identificadores estudiantiles completos. La descarga quedó registrada en auditoría.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible generar la exportación.'));
    } finally {
      setExporting('');
    }
  };

  if (loading) return <div className="loader">Revisando calidad e historial del padrón…</div>;

  return (
    <section className="student-governance" data-tour="student-governance">
      <header className="student-governance__header">
        <div>
          <span className="section-kicker">Control institucional</span>
          <h2>Gobernanza del padrón</h2>
          <p>Validación de altas manuales, importaciones ERP, calidad y duplicados.</p>
        </div>
        <div className="student-governance__actions">
          {canExport && (
            <button type="button" disabled={Boolean(exporting)} onClick={() => downloadExport('operational')}>
              {exporting === 'operational' ? <RefreshCw className="spin" size={17} /> : <FileSpreadsheet size={17} />}
              Padrón operativo
            </button>
          )}
          {canExport && (
            <button type="button" disabled={Boolean(exporting)} onClick={() => downloadExport('quality')}>
              {exporting === 'quality' ? <RefreshCw className="spin" size={17} /> : <Download size={17} />}
              Casos de calidad
            </button>
          )}
          {canExport && (
            <button type="button" disabled={Boolean(exporting)} onClick={() => downloadExport('administrative')}>
              {exporting === 'administrative' ? <RefreshCw className="spin" size={17} /> : <Download size={17} />}
              Padrón administrativo
            </button>
          )}
          <button type="button" disabled={Boolean(exporting)} onClick={load}><RefreshCw size={17} /> Actualizar</button>
        </div>
      </header>

      <nav className="student-governance__nav" aria-label="Control del padrón">
        <button type="button" data-active={view === 'quality' || undefined} onClick={() => setView('quality')}>
          <ShieldCheck size={18} /> Calidad <span>{qualityTotal}</span>
        </button>
        <button type="button" data-active={view === 'manual' || undefined} onClick={() => setView('manual')}>
          <UserCheck size={18} /> Pendientes manuales <span>{pending.length}</span>
        </button>
        <button type="button" data-active={view === 'history' || undefined} onClick={() => setView('history')}>
          <FileClock size={18} /> Historial <span>{imports.length}</span>
        </button>
        {canManage && (
          <button type="button" data-active={view === 'merge' || undefined} onClick={() => setView('merge')}>
            <ArrowRightLeft size={18} /> Unir duplicados
          </button>
        )}
      </nav>

      {error && <div className="student-governance__error"><AlertTriangle size={18} /> {error}</div>}
      {exportNotice && <div className="student-governance__notice"><CheckCircle2 size={18} /> {exportNotice}</div>}

      {view === 'quality' && (
        <div className="student-quality-grid">
          {Object.entries(quality?.indicators || {}).map(([key, value]) => (
            <button
              type="button"
              key={key}
              data-alert={Number(value) > 0 || undefined}
              data-active={activeQualityKey === key || undefined}
              disabled={Number(value) === 0}
              aria-pressed={activeQualityKey === key}
              onClick={() => setActiveQualityKey((current) => current === key ? '' : key)}
            >
              <span>{qualityLabels[key] || key}</span>
              <strong>{value}</strong>
              <small>{Number(value) === 0 ? 'Sin observaciones' : 'Abrir casos'}</small>
            </button>
          ))}
        </div>
      )}

      {view === 'quality' && activeQualityKey && (
        <div className="student-quality-cases" aria-live="polite">
          <header>
            <div>
              <span className="section-kicker">Casos que requieren revisión</span>
              <h3>{qualityLabels[activeQualityKey] || activeQualityKey}</h3>
            </div>
            <strong>{quality?.indicators?.[activeQualityKey] || 0} casos</strong>
          </header>
          {!activeQualityCases.length && (
            <div className="student-governance__empty">
              <CheckCircle2 /> No hay fichas individuales disponibles para este indicador.
            </div>
          )}
          {activeQualityCases.map((student, index) => {
            const content = (
              <>
                <span>
                  <strong>{student.nombre}</strong>
                  <small>{student.curso || 'Sin curso vigente'}</small>
                </span>
                <span>
                  <strong>Revisión requerida</strong>
                  <small>{student.detalle}</small>
                </span>
              </>
            );
            return student.id_alumno ? (
              <button
                type="button"
                className="student-governance__row"
                key={`${activeQualityKey}-${student.id_alumno}-${index}`}
                onClick={() => onOpenStudent(student.id_alumno)}
              >
                {content}
                <span className="student-governance__open">Abrir ficha</span>
              </button>
            ) : (
              <article className="student-governance__row" key={`${activeQualityKey}-general-${index}`}>
                {content}
                <span className="student-governance__open">Caso general</span>
              </article>
            );
          })}
          {Number(quality?.indicators?.[activeQualityKey] || 0) > activeQualityCases.length && (
            <p className="student-quality-cases__limit">
              Se muestran los primeros {activeQualityCases.length} casos. Use los filtros del padrón para continuar la revisión.
            </p>
          )}
        </div>
      )}

      {view === 'manual' && (
        <div className="student-governance__list">
          <div className="student-governance__intro">
            <ClipboardList size={22} />
            <div>
              <strong>Fichas creadas localmente que todavía no reconoce el ERP</strong>
              <span>Al importar una coincidencia válida, se vinculará la misma ficha y conservará todo su historial.</span>
            </div>
          </div>
          {!pending.length && <div className="student-governance__empty"><CheckCircle2 /> No hay altas manuales pendientes.</div>}
          {pending.map((student) => (
            <button type="button" className="student-governance__row" key={student.id_alumno} onClick={() => onOpenStudent(student.id_alumno)}>
              <span>
                <strong>{student.nombre}</strong>
                <small>{getStudentIdentifierLabel(student)} {getStudentIdentifier(student)} · {student.curso || 'Sin curso'}</small>
              </span>
              <span>
                <strong>{reasonLabels[student.motivo_alta_manual] || student.motivo_alta_manual}</strong>
                <small>Creado por {student.creado_por_nombre || 'usuario no disponible'}</small>
              </span>
              <span className="student-governance__age">{student.dias_pendiente} días</span>
            </button>
          ))}
        </div>
      )}

      {view === 'history' && (
        <div className="student-governance__history">
          <div className="student-governance__history-list">
            {!imports.length && <div className="student-governance__empty"><Database /> Todavía no hay importaciones registradas.</div>}
            {imports.map((item) => (
              <button type="button" key={item.id} data-selected={importDetail?.import?.id === item.id || undefined} onClick={() => showImport(item.id)}>
                <span><strong>{item.nombre_archivo}</strong><small>{new Date(item.importado_en).toLocaleString('es-CL')} · {item.modo}</small></span>
                <span><strong>{item.total_filas} filas</strong><small>{item.importado_por_nombre || 'Usuario no disponible'}</small></span>
                <em>{item.estado.replaceAll('_', ' ').toLowerCase()}</em>
              </button>
            ))}
          </div>
          {importDetail && (
            <aside className="student-import-detail">
              <h3>{importDetail.import.nombre_archivo}</h3>
              <p>Hash: <code>{importDetail.import.hash_archivo}</code></p>
              <div>
                <span>Creados <strong>{importDetail.import.filas_creadas}</strong></span>
                <span>Actualizados <strong>{importDetail.import.filas_actualizadas}</strong></span>
                <span>Vinculados <strong>{importDetail.import.filas_vinculadas}</strong></span>
                <span>Retirados <strong>{importDetail.import.filas_retiradas}</strong></span>
                <span>Rechazados <strong>{importDetail.import.filas_rechazadas}</strong></span>
              </div>
              <details>
                <summary>Ver cambios por fila ({importDetail.changes.length})</summary>
                <ul>
                  {importDetail.changes.map((change) => (
                    <li key={change.id}>
                      <strong>{change.accion.replaceAll('_', ' ')}</strong>
                      <span>{change.estudiante || `RUT ${change.rut_referencia || 'sin dato'}`}</span>
                      <small>{change.numero_fila ? `Fila ${change.numero_fila}` : 'Cambio global'} {change.mensaje ? `· ${change.mensaje}` : ''}</small>
                    </li>
                  ))}
                </ul>
              </details>
            </aside>
          )}
        </div>
      )}

      {view === 'merge' && canManage && (
        <div className="student-merge-tool">
          <div className="student-governance__intro">
            <ArrowRightLeft size={22} />
            <div>
              <strong>Unión controlada de fichas duplicadas</strong>
              <span>La ficha principal conserva la identidad. El sistema revisa ingresos, matrículas, apoderados y retiros antes de permitir la operación.</span>
            </div>
          </div>
          <div className="student-merge-selection">
            <article>
              <span>Ficha principal</span>
              <strong>{primary ? studentName(primary) : 'Sin seleccionar'}</strong>
              <small>{primary ? `${getStudentIdentifierLabel(primary)} ${getStudentIdentifier(primary)} · ${primary.nombre_curso || 'Sin curso'}` : 'Recibirá las relaciones y el historial'}</small>
              {primary && <button type="button" onClick={() => setPrimary(null)}>Cambiar</button>}
            </article>
            <ArrowRightLeft />
            <article>
              <span>Ficha duplicada</span>
              <strong>{duplicate ? studentName(duplicate) : 'Sin seleccionar'}</strong>
              <small>{duplicate ? `${getStudentIdentifierLabel(duplicate)} ${getStudentIdentifier(duplicate)} · ${duplicate.nombre_curso || 'Sin curso'}` : 'Quedará desactivada y vinculada'}</small>
              {duplicate && <button type="button" onClick={() => setDuplicate(null)}>Cambiar</button>}
            </article>
          </div>
          {(!primary || !duplicate) && (
            <div className="student-merge-search">
              <Search size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o RUT" />
              {matches.length > 0 && (
                <div>
                  {matches.filter((student) => Number(student.id_alumno) !== Number(primary?.id_alumno)).map((student) => (
                    <button type="button" key={student.id_alumno} onClick={() => selectMergeStudent(student)}>
                      <strong>{studentName(student)}</strong>
                      <span>{getStudentIdentifierLabel(student)} {getStudentIdentifier(student)} · {student.nombre_curso || 'Sin curso'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {mergePreview && (
            <div className="student-merge-preview" data-safe={mergePreview.can_merge || undefined}>
              <h3>{mergePreview.can_merge ? 'La unión es técnicamente segura' : 'La unión está bloqueada'}</h3>
              <div>
                <span>Ingresos a transferir <strong>{mergePreview.counts.duplicate.attendance}</strong></span>
                <span>Matrículas a conservar <strong>{mergePreview.counts.duplicate.enrollments}</strong></span>
                <span>Vínculos familiares <strong>{mergePreview.counts.duplicate.guardians}</strong></span>
                <span>Retiros asociados <strong>{mergePreview.counts.duplicate.withdrawals}</strong></span>
              </div>
              {mergePreview.blockers.length > 0 && <ul>{mergePreview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
              {mergePreview.can_merge && (
                <label>
                  <span>Motivo institucional de la unión</span>
                  <textarea value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} maxLength={500} placeholder="Explique cómo se comprobó que ambas fichas corresponden a la misma persona" />
                </label>
              )}
              <button type="button" disabled={!mergePreview.can_merge || mergeReason.trim().length < 10 || merging} onClick={mergeStudents}>
                {merging ? <RefreshCw className="spin" /> : <ArrowRightLeft />} Confirmar unión controlada
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default StudentGovernancePanel;
