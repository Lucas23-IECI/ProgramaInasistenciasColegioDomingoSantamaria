import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router';
import { API_URL } from '../../config';
import { AuthContext } from '../../context/AuthContext';
import { useFeedback } from '../../context/FeedbackContext';
import { PERMISSIONS, hasPermission } from '../../permissions';
import {
  emptyVisit,
  emptyWithdrawal,
  emptyAuthorization,
  todayIso,
  daysAgoIso,
  studentName,
  requestConfig
} from './visitModel';

export function useVisitsController() {
const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const { notify, confirm } = useFeedback();

  const canView = hasPermission(user, PERMISSIONS.VISITS_VIEW)
    || hasPermission(user, PERMISSIONS.VISITS_HISTORY)
    || hasPermission(user, PERMISSIONS.VISITS_REPORTS);
  const canRegister = hasPermission(user, PERMISSIONS.VISITS_REGISTER);
  const canCheckout = hasPermission(user, PERMISSIONS.VISITS_CHECKOUT);
  const canManage = hasPermission(user, PERMISSIONS.VISITS_MANAGE);
  const canRegisterWithdrawal = hasPermission(user, PERMISSIONS.WITHDRAWALS_REGISTER);
  const canApproveWithdrawal = hasPermission(user, PERMISSIONS.WITHDRAWALS_APPROVE);
  const canManageAuthorizations = hasPermission(user, PERMISSIONS.WITHDRAWALS_AUTHORIZATIONS);
  const canExport = hasPermission(user, PERMISSIONS.VISITS_REPORTS);
  const canImportGuardians = hasPermission(user, PERMISSIONS.WITHDRAWALS_IMPORT_GUARDIANS)
    || hasPermission(user, PERMISSIONS.STUDENTS_IMPORT);
  const canConfigure = hasPermission(user, PERMISSIONS.VISITS_SETTINGS);

  const canSeeWithdrawals = canRegisterWithdrawal || canApproveWithdrawal || canManageAuthorizations || canView;
  const initialTab = canView
    ? 'presentes'
    : canRegister
      ? 'registrar'
      : canSeeWithdrawals
        ? 'retiros'
        : 'autorizaciones';
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState(requestedTab || initialTab);
  const [catalogs, setCatalogs] = useState({
    motivos: [],
    destinos: [],
    motivos_retiro: [],
    parentescos: []
  });
  const [summary, setSummary] = useState(null);
  const [visits, setVisits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visitForm, setVisitForm] = useState(emptyVisit);
  const [withdrawalForm, setWithdrawalForm] = useState(emptyWithdrawal);
  const [visitorMatches, setVisitorMatches] = useState([]);
  const [withdrawalVisitorMatches, setWithdrawalVisitorMatches] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [savingWithdrawal, setSavingWithdrawal] = useState(false);
  const [authorizationForm, setAuthorizationForm] = useState(emptyAuthorization);
  const [authorizationMatches, setAuthorizationMatches] = useState([]);
  const [authorizationStudentQuery, setAuthorizationStudentQuery] = useState('');
  const [authorizationStudentResults, setAuthorizationStudentResults] = useState([]);
  const [authorizationStudentSearching, setAuthorizationStudentSearching] = useState(false);
  const [authorizationStudent, setAuthorizationStudent] = useState(null);
  const [authorizations, setAuthorizations] = useState([]);
  const [authorizationsLoading, setAuthorizationsLoading] = useState(false);
  const [savingAuthorization, setSavingAuthorization] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [studentSearching, setStudentSearching] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyState, setHistoryState] = useState('');
  const [action, setAction] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [savingAction, setSavingAction] = useState(false);
  const [reportPeriod, setReportPeriod] = useState({ desde: daysAgoIso(29), hasta: todayIso() });
  const [reportType, setReportType] = useState('TODO');
  const [exportingFormat, setExportingFormat] = useState('');

  const fetchData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const requests = [
        axios.get(`${API_URL}/visitas/catalogos`, requestConfig),
        axios.get(`${API_URL}/visitas/resumen`, requestConfig)
      ];
      const visitIndex = canView ? requests.push(axios.get(`${API_URL}/visitas?limit=100`, requestConfig)) - 1 : -1;
      const withdrawalIndex = canSeeWithdrawals
        ? requests.push(axios.get(`${API_URL}/visitas/retiros`, requestConfig)) - 1
        : -1;
      const responses = await Promise.all(requests);
      setCatalogs(responses[0].data);
      setSummary(responses[1].data);
      if (visitIndex >= 0) setVisits(responses[visitIndex].data.rows || []);
      if (withdrawalIndex >= 0) setWithdrawals(responses[withdrawalIndex].data || []);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible cargar el módulo de visitas.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canSeeWithdrawals, canView, notify]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (studentQuery.trim().length < 2) {
      setStudentResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setStudentSearching(true);
      try {
        const response = await axios.get(`${API_URL}/visitas/estudiantes/buscar`, {
          ...requestConfig,
          params: { q: studentQuery.trim() }
        });
        setStudentResults(response.data);
      } catch (error) {
        notify(error.response?.data?.message || 'No fue posible buscar estudiantes.', 'error');
      } finally {
        setStudentSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [notify, studentQuery]);

  useEffect(() => {
    if (authorizationStudentQuery.trim().length < 2 || authorizationStudent) {
      setAuthorizationStudentResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setAuthorizationStudentSearching(true);
      try {
        const response = await axios.get(`${API_URL}/visitas/estudiantes/buscar`, {
          ...requestConfig,
          params: { q: authorizationStudentQuery.trim() }
        });
        setAuthorizationStudentResults(response.data);
      } catch (error) {
        notify(error.response?.data?.message || 'No fue posible buscar estudiantes.', 'error');
      } finally {
        setAuthorizationStudentSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [authorizationStudent, authorizationStudentQuery, notify]);

  const loadAuthorizations = useCallback(async (student) => {
    if (!student?.id_alumno) {
      setAuthorizations([]);
      return;
    }
    setAuthorizationsLoading(true);
    try {
      const response = await axios.get(`${API_URL}/visitas/autorizaciones`, {
        ...requestConfig,
        params: { id_alumno: student.id_alumno }
      });
      setAuthorizations(response.data || []);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible consultar las autorizaciones.', 'error');
    } finally {
      setAuthorizationsLoading(false);
    }
  }, [notify]);

  const selectAuthorizationStudent = (student) => {
    setAuthorizationStudent(student);
    setAuthorizationStudentQuery(studentName(student));
    setAuthorizationStudentResults([]);
    loadAuthorizations(student);
  };

  const lookupVisitor = async (visitor, setter, matchesSetter) => {
    if (visitor.documento.trim().length < 3) return;
    setLookupLoading(true);
    try {
      const response = await axios.get(`${API_URL}/visitas/visitantes/buscar`, {
        ...requestConfig,
        params: { q: visitor.documento }
      });
      matchesSetter(response.data);
      const exact = response.data.find((item) => item.documento?.replace(/\W/g, '').toUpperCase()
        === visitor.documento.replace(/\W/g, '').toUpperCase());
      if (exact) {
        setter({
          ...visitor,
          tipo_documento: exact.tipo_documento,
          documento: exact.documento,
          nombre_completo: exact.nombre_completo,
          telefono: exact.telefono || ''
        });
        notify('Se recuperaron los datos anteriores de la persona.', 'success');
      } else {
        notify('Documento nuevo. Completa el nombre para crear la ficha.', 'info');
      }
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible buscar a la persona.', 'error');
    } finally {
      setLookupLoading(false);
    }
  };

  const submitVisit = async (event) => {
    event.preventDefault();
    setSavingVisit(true);
    try {
      await axios.post(`${API_URL}/visitas`, visitForm, requestConfig);
      notify('Entrada registrada correctamente.', 'success');
      setVisitForm(emptyVisit);
      setVisitorMatches([]);
      setTab('presentes');
      await fetchData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible registrar la visita.', 'error');
    } finally {
      setSavingVisit(false);
    }
  };

  const registerCheckout = async (visit) => {
    const accepted = await confirm({
      title: 'Confirmar salida',
      message: `Se registrará la salida de ${visit.visitante.nombre_completo}.`,
      confirmLabel: 'Registrar salida'
    });
    if (!accepted) return;
    try {
      await axios.patch(`${API_URL}/visitas/${visit.id}/salida`, {}, requestConfig);
      notify('Salida registrada.', 'success');
      await fetchData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible registrar la salida.', 'error');
    }
  };

  const submitWithdrawal = async (event) => {
    event.preventDefault();
    if (!selectedStudent) return notify('Selecciona el estudiante que será retirado.', 'error');
    setSavingWithdrawal(true);
    try {
      const response = await axios.post(`${API_URL}/visitas/retiros`, {
        ...withdrawalForm,
        id_alumno: selectedStudent.id_alumno
      }, requestConfig);
      notify(
        response.data.coincidencia_autorizada
          ? 'Solicitud creada. La persona aparece autorizada, pero aún requiere confirmación.'
          : 'Solicitud creada sin autorización previa. Inspectoría debe revisarla.',
        response.data.coincidencia_autorizada ? 'success' : 'info'
      );
      setWithdrawalForm(emptyWithdrawal);
      setWithdrawalVisitorMatches([]);
      setSelectedStudent(null);
      setStudentQuery('');
      setTab('retiros');
      await fetchData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible registrar el retiro.', 'error');
    } finally {
      setSavingWithdrawal(false);
    }
  };

  const submitAuthorization = async (event) => {
    event.preventDefault();
    if (!authorizationStudent) {
      notify('Selecciona el estudiante al que corresponde la autorización.', 'error');
      return;
    }
    setSavingAuthorization(true);
    try {
      await axios.post(`${API_URL}/visitas/autorizaciones`, {
        ...authorizationForm,
        id_alumno: authorizationStudent.id_alumno
      }, requestConfig);
      notify('Autorización guardada con trazabilidad.', 'success');
      setAuthorizationForm(emptyAuthorization);
      setAuthorizationMatches([]);
      await loadAuthorizations(authorizationStudent);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible guardar la autorización.', 'error');
    } finally {
      setSavingAuthorization(false);
    }
  };

  const openAction = (nextAction) => {
    setAction(nextAction);
    setActionReason('');
  };

  const executeAction = async () => {
    if (!action) return;
    setSavingAction(true);
    try {
      if (action.type === 'annul-visit') {
        await axios.patch(`${API_URL}/visitas/${action.id}/anular`, { motivo: actionReason }, requestConfig);
        notify('La visita fue anulada con trazabilidad.', 'success');
      }
      if (action.type === 'approve-withdrawal' || action.type === 'reject-withdrawal') {
        await axios.patch(`${API_URL}/visitas/retiros/${action.id}/decision`, {
          aprobar: action.type === 'approve-withdrawal',
          motivo: actionReason
        }, requestConfig);
        notify(action.type === 'approve-withdrawal' ? 'Retiro autorizado.' : 'Retiro rechazado.', 'success');
      }
      setAction(null);
      setActionReason('');
      await fetchData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible completar la acción.', 'error');
    } finally {
      setSavingAction(false);
    }
  };

  const deliverStudent = async (withdrawal) => {
    const accepted = await confirm({
      title: 'Confirmar entrega del estudiante',
      message: `Confirma que ${studentName(withdrawal.estudiante)} fue entregado a ${withdrawal.visitante.nombre_completo}.`,
      confirmLabel: 'Confirmar entrega'
    });
    if (!accepted) return;
    try {
      await axios.patch(`${API_URL}/visitas/retiros/${withdrawal.id}/entregar`, {}, requestConfig);
      notify('Entrega registrada con fecha, hora y responsable.', 'success');
      await fetchData({ quiet: true });
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible confirmar la entrega.', 'error');
    }
  };

  const filteredVisits = useMemo(() => visits.filter((visit) => {
    if (tab === 'presentes' && visit.estado !== 'DENTRO') return false;
    if (historyState && visit.estado !== historyState) return false;
    const query = historyQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      visit.visitante.nombre_completo,
      visit.visitante.documento_mostrado,
      visit.destino_nombre,
      visit.persona_contactada
    ].some((value) => String(value || '').toLowerCase().includes(query));
  }), [historyQuery, historyState, tab, visits]);

  const downloadResponse = (data, contentType, fileName) => {
    const url = URL.createObjectURL(new Blob([data], { type: contentType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportReport = async (format) => {
    if (reportPeriod.desde > reportPeriod.hasta) {
      notify('La fecha inicial no puede ser posterior a la final.', 'error');
      return;
    }
    setExportingFormat(format);
    const params = {
      desde: reportPeriod.desde,
      hasta: reportPeriod.hasta,
      tipo: reportType,
      formato: format
    };
    try {
      const response = await axios.get(`${API_URL}/visitas/reportes`, {
        ...requestConfig,
        params,
        responseType: 'blob'
      });
      const contentTypes = {
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pdf: 'application/pdf',
        md: 'text/markdown;charset=utf-8'
      };
      downloadResponse(
        response.data,
        contentTypes[format],
        `reporte-visitas-retiros-${reportPeriod.desde}-${reportPeriod.hasta}.${format}`
      );
      notify(`Reporte ${format.toUpperCase()} generado correctamente.`, 'success');
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible generar el reporte.', 'error');
    } finally {
      setExportingFormat('');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return {
    navigate,
    user,
    logout,
    notify,
    confirm,
    canView,
    canRegister,
    canCheckout,
    canManage,
    canRegisterWithdrawal,
    canApproveWithdrawal,
    canManageAuthorizations,
    canExport,
    canImportGuardians,
    canConfigure,
    canSeeWithdrawals,
    initialTab,
    requestedTab,
    tab,
    setTab,
    catalogs,
    setCatalogs,
    summary,
    setSummary,
    visits,
    setVisits,
    withdrawals,
    setWithdrawals,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
    visitForm,
    setVisitForm,
    withdrawalForm,
    setWithdrawalForm,
    visitorMatches,
    setVisitorMatches,
    withdrawalVisitorMatches,
    setWithdrawalVisitorMatches,
    lookupLoading,
    setLookupLoading,
    savingVisit,
    setSavingVisit,
    savingWithdrawal,
    setSavingWithdrawal,
    authorizationForm,
    setAuthorizationForm,
    authorizationMatches,
    setAuthorizationMatches,
    authorizationStudentQuery,
    setAuthorizationStudentQuery,
    authorizationStudentResults,
    setAuthorizationStudentResults,
    authorizationStudentSearching,
    setAuthorizationStudentSearching,
    authorizationStudent,
    setAuthorizationStudent,
    authorizations,
    setAuthorizations,
    authorizationsLoading,
    setAuthorizationsLoading,
    savingAuthorization,
    setSavingAuthorization,
    studentQuery,
    setStudentQuery,
    studentResults,
    setStudentResults,
    studentSearching,
    setStudentSearching,
    selectedStudent,
    setSelectedStudent,
    historyQuery,
    setHistoryQuery,
    historyState,
    setHistoryState,
    action,
    setAction,
    actionReason,
    setActionReason,
    savingAction,
    setSavingAction,
    reportPeriod,
    setReportPeriod,
    reportType,
    setReportType,
    exportingFormat,
    setExportingFormat,
    fetchData,
    loadAuthorizations,
    selectAuthorizationStudent,
    lookupVisitor,
    submitVisit,
    registerCheckout,
    submitWithdrawal,
    submitAuthorization,
    openAction,
    executeAction,
    deliverStudent,
    filteredVisits,
    downloadResponse,
    exportReport,
    handleLogout
  };
}
