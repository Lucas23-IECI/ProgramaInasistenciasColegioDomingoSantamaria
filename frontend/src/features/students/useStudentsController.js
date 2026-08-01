import { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router';
import { API_URL } from '../../config';
import { AuthContext } from '../../context/AuthContext';
import { PERMISSIONS, hasPermission } from '../../permissions';
import { mapGuardianRecord } from './studentUtils';

export function useStudentsController() {
const { logout, user } = useContext(AuthContext);
  const canImport = hasPermission(user, PERMISSIONS.STUDENTS_IMPORT);
  const canManage = hasPermission(user, PERMISSIONS.STUDENTS_MANAGE);
  const canRegularizeIdentity = hasPermission(user, PERMISSIONS.STUDENTS_IDENTITY_REGULARIZE);
  const canExportStudents = hasPermission(user, PERMISSIONS.STUDENTS_EXPORT);
  const canExportSensitiveStudents = hasPermission(user, PERMISSIONS.STUDENTS_EXPORT_SENSITIVE);
  const canViewSensitiveIdentifiers = hasPermission(user, PERMISSIONS.STUDENTS_IDENTIFIERS_VIEW_SENSITIVE);
  const canImportGuardians = hasPermission(user, PERMISSIONS.WITHDRAWALS_IMPORT_GUARDIANS) || canImport;
  const canViewAnalytics = hasPermission(user, PERMISSIONS.ANALYTICS_VIEW);
  const canManageFamilies = hasPermission(user, PERMISSIONS.FAMILY_MANAGE);
  const [activeSection, setActiveSection] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('seccion');
    return ['apoderados', 'governance', 'carga'].includes(requested) ? requested : 'listado';
  });
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [courseSearch, setCourseSearch] = useState('');
  const [globalStudentSearch, setGlobalStudentSearch] = useState('');
  const [coursePage, setCoursePage] = useState(1);
  const COURSE_PAGE_SIZE = 9;
  const [filterEstado, setFilterEstado] = useState('');
  const [filterRol, setFilterRol] = useState('');

  const [excelRows, setExcelRows] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [importPreview, setImportPreview] = useState(null);
  const [courseResolutions, setCourseResolutions] = useState({});
  const [identityResolutions, setIdentityResolutions] = useState({});
  const [confirmNewCourses, setConfirmNewCourses] = useState(false);
  const [confirmMissingDeactivation, setConfirmMissingDeactivation] = useState(false);
  const [importMode, setImportMode] = useState('PARCIAL');
  const [excelFileName, setExcelFileName] = useState('');
  const [excelFileHash, setExcelFileHash] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [toast, setToast] = useState(null);
  const [guardianRows, setGuardianRows] = useState([]);
  const [guardianFileName, setGuardianFileName] = useState('');
  const [guardianFileHash, setGuardianFileHash] = useState('');
  const [guardianError, setGuardianError] = useState('');
  const [guardianResult, setGuardianResult] = useState(null);
  const [syncingGuardians, setSyncingGuardians] = useState(false);

  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [manualEditor, setManualEditor] = useState(null);
  const [identityRegularization, setIdentityRegularization] = useState(null);

  const navigate = useNavigate();
  const contentStartRef = useRef(null);
  const [alertasMap, setAlertasMap] = useState({});

  const fetchAlertasTempranas = async () => {
    try {
      const res = await axios.get(`${API_URL}/puntualidad/alertas`, {
        withCredentials: true
      });
      setAlertasMap(Object.fromEntries((res.data?.alertas || []).map((alerta) => [alerta.id_alumno, alerta])));
    } catch (err) {
      console.error('Error al obtener alertas de atrasos:', err);
    }
  };

  useEffect(() => {
    fetchStudents();
    if (canViewAnalytics) fetchAlertasTempranas();
  }, [canViewAnalytics]);

  useEffect(() => {
    setPage(1);
  }, [selectedCourse, searchTerm, filterEstado, filterRol]);

  useEffect(() => {
    setCoursePage(1);
  }, [courseSearch]);

  useEffect(() => {
    if (!selectedStudentId) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeDetails();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedStudentId]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const [studentsResponse, coursesResponse] = await Promise.all([
        axios.get(`${API_URL}/students`, { withCredentials: true }),
        axios.get(`${API_URL}/courses`, { withCredentials: true })
      ]);
      setStudents(studentsResponse.data || []);
      setCourses(coursesResponse.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (id, includeSensitive = false) => {
    setSelectedStudentId(id);
    setLoadingDetails(true);
    setStudentDetails(null);
    try {
      const res = await axios.get(`${API_URL}/students/${id}/details`, {
        params: includeSensitive ? { include_sensitive: true } : undefined,
        withCredentials: true
      });
      setStudentDetails(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const closeDetails = () => {
    setSelectedStudentId(null);
    setStudentDetails(null);
  };

  const handleExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    setUploadError('');
    setSyncResult(null);

    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      let fileHash = '';
      if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
        fileHash = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets['Usuarios'] || workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        setUploadError('No se encontró la hoja "Usuarios" ni hojas válidas.');
        return;
      }

      const parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const nonEmptyRows = parsedRows.filter((row) =>
        Object.values(row).some((value) => String(value).trim() !== '')
      );

      // Skip instructions or blank sheets if the first row is a header title
      const cleanRows = nonEmptyRows.filter(row => {
        const firstVal = String(Object.values(row)[0]).toLowerCase();
        return !firstVal.includes('importante') && !firstVal.includes('elimine');
      });

      if (!cleanRows.length) {
        setUploadError('No se detectaron filas de usuarios válidas.');
        setExcelRows([]);
        setPreviewRows([]);
        setExcelFileName('');
        setImportPreview(null);
        return;
      }
      setExcelRows(cleanRows);
      setExcelFileName(file.name);
      setExcelFileHash(fileHash);
      setCourseResolutions({});
      setIdentityResolutions({});
      setConfirmNewCourses(false);
      setConfirmMissingDeactivation(false);
      const previewResponse = await axios.post(
        `${API_URL}/students/import-preview`,
        { students: cleanRows, import_mode: importMode },
        { withCredentials: true }
      );
      setImportPreview(previewResponse.data);
      setPreviewRows(previewResponse.data.rows || []);
    } catch (err) {
      console.error(err);
      setUploadError('No fue posible leer el archivo Excel.');
      setImportPreview(null);
      setPreviewRows([]);
    }
  };

  const changeImportMode = async (nextMode) => {
    setImportMode(nextMode);
    setConfirmMissingDeactivation(false);
    if (!excelRows.length) return;
    setSyncing(true);
    setUploadError('');
    try {
      const previewResponse = await axios.post(
        `${API_URL}/students/import-preview`,
        { students: excelRows, import_mode: nextMode },
        { withCredentials: true }
      );
      setImportPreview(previewResponse.data);
      setPreviewRows(previewResponse.data.rows || []);
    } catch (error) {
      setUploadError(error.response?.data?.message || 'No fue posible recalcular la previsualización.');
    } finally {
      setSyncing(false);
    }
  };

  const resolveImportedCourse = (row, value) => {
    setCourseResolutions((current) => {
      const next = { ...current };
      if (!value) {
        delete next[row.curso_key];
      } else if (value === '__CREATE__') {
        next[row.curso_key] = { action: 'create', name: row.curso_origen };
      } else {
        next[row.curso_key] = { action: 'map', course_id: Number(value) };
      }
      return next;
    });
  };

  const unresolvedImportRows = previewRows.filter((row) => {
    if ([
      'RECHAZADA',
      'DUPLICADA_ARCHIVO',
      'COLISION_UUID_RUT',
      'COLISION_IDENTIFICADORES'
    ].includes(row.status)) return true;
    if (row.status === 'CONFLICTO_IDENTIDAD') {
      const requiredAction = row.inactive_reappearance
        ? 'CONFIRMAR_Y_REACTIVAR'
        : 'CONFIRMAR_MISMA_PERSONA';
      return identityResolutions[String(row.row)] !== requiredAction;
    }
    if (row.inactive_reappearance
      && !['REACTIVAR_FICHA', 'CONFIRMAR_Y_REACTIVAR'].includes(identityResolutions[String(row.row)])) {
      return true;
    }
    if (row.status === 'FICHA_INACTIVA_REAPARECE') {
      return false;
    }
    if (row.status === 'VALIDA') return false;
    return !courseResolutions[row.curso_key];
  });
  const createsNewCourses = Object.values(courseResolutions).some((resolution) => resolution.action === 'create');
  const canConfirmImport = excelRows.length > 0
    && unresolvedImportRows.length === 0
    && (!createsNewCourses || confirmNewCourses)
    && (importMode !== 'COMPLETA'
      || !(importPreview?.missing_students?.length)
      || confirmMissingDeactivation);

  const syncExcelWithDatabase = async () => {
    if (!excelRows.length || syncing) return;

    setSyncing(true);
    setUploadError('');
    setSyncResult(null);

    try {
      const res = await axios.post(`${API_URL}/students/bulk-sync`, {
        students: excelRows,
        course_resolutions: courseResolutions,
        identity_resolutions: identityResolutions,
        confirm_new_courses: confirmNewCourses,
        confirm_missing_deactivation: confirmMissingDeactivation,
        import_mode: importMode,
        file_name: excelFileName,
        file_hash: excelFileHash
      }, { withCredentials: true });
      setSyncResult(res.data);
      fetchStudents();
      setSelectedCourse(null);
      setActiveSection('listado');
      setToast({
        type: 'success',
        text: `Sincronización completada — Creados: ${res.data.inserted || 0}, actualizados: ${res.data.updated || 0}, vinculados manuales: ${res.data.linked_manual || 0}, reactivados: ${res.data.reactivated || 0}`
      });
      setTimeout(() => setToast(null), 4500);
    } catch (err) {
      console.error(err);
      setUploadError(err.response?.data?.message || 'Falló la sincronización de miembros.');
      setToast({ type: 'error', text: err.response?.data?.message || 'Falló la sincronización.' });
      setTimeout(() => setToast(null), 4500);
    } finally {
      setSyncing(false);
    }
  };

  const openManualEditor = (mode, student = null) => {
    setManualEditor({ mode, student });
  };

  const handleManualSaved = async (message) => {
    setManualEditor(null);
    setToast({ type: 'success', text: message });
    await fetchStudents();
    if (selectedStudentId) {
      if (manualEditor?.mode === 'retire' || manualEditor?.mode === 'reactivate') {
        await openDetails(selectedStudentId);
      } else {
        closeDetails();
      }
    }
    setTimeout(() => setToast(null), 5000);
  };

  const openIdentityRegularization = () => {
    if (!studentDetails) return;
    setIdentityRegularization(studentDetails);
  };

  const handleIdentityRegularized = async (message) => {
    setIdentityRegularization(null);
    setToast({ type: 'success', text: message });
    await Promise.all([
      fetchStudents(),
      selectedStudentId ? openDetails(selectedStudentId) : Promise.resolve()
    ]);
    setTimeout(() => setToast(null), 6000);
  };

  const handleGuardianUpload = async (event) => {
    const file = event.target.files?.[0];
    setGuardianError('');
    setGuardianResult(null);
    setGuardianRows([]);
    setGuardianFileName('');
    setGuardianFileHash('');
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const preferredSheet = workbook.SheetNames.find((name) => /apoderad|autorizad|ficha/i.test(name));
      const sheet = workbook.Sheets[preferredSheet || workbook.SheetNames[0]];
      if (!sheet) throw new Error('La planilla no contiene hojas legibles.');

      const parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      const records = parsedRows.flatMap((row, index) => {
        const primary = mapGuardianRecord(row, index);
        const secondary = mapGuardianRecord(row, index, '2');
        const output = [];
        if (primary.documento || primary.nombre_completo || primary.alumno_rut) output.push(primary);
        if (secondary.documento || secondary.nombre_completo) output.push(secondary);
        return output;
      });

      if (!records.length) {
        throw new Error('No se detectaron columnas de estudiante y apoderado. Revisa los encabezados de la ficha.');
      }
      if (records.length > 5000) {
        throw new Error('La planilla supera el máximo de 5.000 vínculos por carga.');
      }

      const digest = await window.crypto.subtle.digest('SHA-256', data);
      const hash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      setGuardianRows(records);
      setGuardianFileName(file.name);
      setGuardianFileHash(hash);
    } catch (error) {
      console.error(error);
      setGuardianError(error.message || 'No fue posible leer la ficha de apoderados.');
    } finally {
      event.target.value = '';
    }
  };

  const syncGuardians = async () => {
    if (!guardianRows.length || syncingGuardians) return;
    setSyncingGuardians(true);
    setGuardianError('');
    setGuardianResult(null);
    try {
      const response = await axios.post(`${API_URL}/visitas/apoderados/importar`, {
        nombre_archivo: guardianFileName,
        hash_archivo: guardianFileHash,
        rows: guardianRows
      }, { withCredentials: true });
      setGuardianResult(response.data);
      setToast({
        type: response.data.errors?.length ? 'info' : 'success',
        text: `Ficha procesada: ${response.data.created} vínculos nuevos y ${response.data.updated} actualizados.`
      });
      setTimeout(() => setToast(null), 5000);
    } catch (error) {
      const message = error.response?.data?.message || 'No fue posible sincronizar la ficha de apoderados.';
      setGuardianError(message);
      setToast({ type: 'error', text: message });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSyncingGuardians(false);
    }
  };

  const courseGroups = students.reduce((acc, s) => {
    const curso = s.grade || 'Sin Curso Asignado';
    if (!acc[curso]) acc[curso] = [];
    acc[curso].push(s);
    return acc;
  }, {});

  const currentStudents = selectedCourse === 'Toda La Matrícula'
     ? students
     : (courseGroups[selectedCourse] || []);

  const filtered = currentStudents.filter(s => {
    const normalizedSearch = searchTerm.toLowerCase();
    const matchText = (s.nombres + ' ' + s.paterno).toLowerCase().includes(normalizedSearch) ||
            String(s.rut || '').toLowerCase().includes(normalizedSearch) ||
            String(s.documento_erp || '').toLowerCase().includes(normalizedSearch) ||
            String(s.uuid_erp || '').toLowerCase().includes(normalizedSearch);
    const matchEstado = filterEstado === '' ? true : filterEstado === 'activo' ? s.activo : !s.activo;
    const matchRol = filterRol === '' ? true : s.rol === filterRol;
    return matchText && matchEstado && matchRol;
  });

  const stuTotalPages = Math.ceil(filtered.length / pageSize);
  const paginatedStudents = filtered.slice((page - 1) * pageSize, page * pageSize);

  const formatNullable = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return 'N/D';
    return String(value);
  };

  const handleBack = () => {
    if (selectedCourse) {
      setSelectedCourse(null);
      return;
    }
    if (activeSection === 'carga' || activeSection === 'apoderados' || activeSection === 'governance') {
      setActiveSection('listado');
      return;
    }
    navigate('/admin');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const selectCourse = (course) => {
    setSelectedCourse(course);
    requestAnimationFrame(() => {
      contentStartRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
    });
  };

  return {
    logout,
    user,
    canImport,
    canManage,
    canRegularizeIdentity,
    canExportStudents,
    canExportSensitiveStudents,
    canViewSensitiveIdentifiers,
    canImportGuardians,
    canViewAnalytics,
    canManageFamilies,
    activeSection,
    setActiveSection,
    students,
    setStudents,
    courses,
    setCourses,
    loading,
    setLoading,
    searchTerm,
    setSearchTerm,
    selectedCourse,
    setSelectedCourse,
    page,
    setPage,
    pageSize,
    setPageSize,
    courseSearch,
    setCourseSearch,
    globalStudentSearch,
    setGlobalStudentSearch,
    coursePage,
    setCoursePage,
    COURSE_PAGE_SIZE,
    filterEstado,
    setFilterEstado,
    filterRol,
    setFilterRol,
    excelRows,
    setExcelRows,
    previewRows,
    setPreviewRows,
    importPreview,
    setImportPreview,
    courseResolutions,
    setCourseResolutions,
    identityResolutions,
    setIdentityResolutions,
    confirmNewCourses,
    setConfirmNewCourses,
    confirmMissingDeactivation,
    setConfirmMissingDeactivation,
    importMode,
    setImportMode,
    excelFileName,
    setExcelFileName,
    excelFileHash,
    setExcelFileHash,
    syncing,
    setSyncing,
    syncResult,
    setSyncResult,
    uploadError,
    setUploadError,
    toast,
    setToast,
    guardianRows,
    setGuardianRows,
    guardianFileName,
    setGuardianFileName,
    guardianFileHash,
    setGuardianFileHash,
    guardianError,
    setGuardianError,
    guardianResult,
    setGuardianResult,
    syncingGuardians,
    setSyncingGuardians,
    selectedStudentId,
    setSelectedStudentId,
    studentDetails,
    setStudentDetails,
    loadingDetails,
    setLoadingDetails,
    manualEditor,
    setManualEditor,
    identityRegularization,
    setIdentityRegularization,
    navigate,
    contentStartRef,
    alertasMap,
    setAlertasMap,
    fetchAlertasTempranas,
    fetchStudents,
    openDetails,
    closeDetails,
    handleExcelUpload,
    changeImportMode,
    resolveImportedCourse,
    unresolvedImportRows,
    createsNewCourses,
    canConfirmImport,
    syncExcelWithDatabase,
    openManualEditor,
    handleManualSaved,
    openIdentityRegularization,
    handleIdentityRegularized,
    handleGuardianUpload,
    syncGuardians,
    courseGroups,
    currentStudents,
    filtered,
    stuTotalPages,
    paginatedStudents,
    formatNullable,
    handleBack,
    handleLogout,
    selectCourse
  };
}
