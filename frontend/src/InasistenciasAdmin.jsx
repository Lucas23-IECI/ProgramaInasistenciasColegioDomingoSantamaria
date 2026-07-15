import React, { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from './context/AuthContext';
import {
  Users, AlertTriangle, LogOut, ShieldCheck, ShieldAlert,
  FileSpreadsheet, Calendar, ChevronDown, Download, RefreshCw,
  Clock, TrendingUp, CheckCircle, X, Upload, Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

import { API_URL } from './config';

const PAGE_SIZE = 10;

const InasistenciasAdmin = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('inasistencias'); // 'inasistencias' | 'justificaciones'
  const [inasistenciasHoy, setInasistenciasHoy] = useState([]);
  const [loadingInasistencias, setLoadingInasistencias] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();

  // States for report generator
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [reportDesde, setReportDesde] = useState('');
  const [reportHasta, setReportHasta] = useState('');
  const [reportType, setReportType] = useState('ausente'); // 'ausente' | 'justificado'
  const [reportScope, setReportScope] = useState('masivo'); // 'masivo' | 'curso' | 'individual'
  const [courses, setCourses] = useState([]);
  const [selectedCursoId, setSelectedCursoId] = useState('');
  const [selectedAlumno, setSelectedAlumno] = useState(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  // States for Justification Modal
  const [justifyModal, setJustifyModal] = useState(null); // registration or student object
  const [justifyType, setJustifyType] = useState('apoderado'); // 'apoderado' | 'medica'
  const [justifyComment, setJustifyComment] = useState('');
  const [justifyFile, setJustifyFile] = useState(null);
  const [submittingJustify, setSubmittingJustify] = useState(false);
  const [justifyIsRange, setJustifyIsRange] = useState(false);
  const [justifyStartDate, setJustifyStartDate] = useState('');
  const [justifyEndDate, setJustifyEndDate] = useState('');

  // States for Central Justifications Dashboard & Alerts
  const [justificacionesList, setJustificacionesList] = useState([]);
  const [loadingJustificaciones, setLoadingJustificaciones] = useState(false);
  const [justificacionesDesde, setJustificacionesDesde] = useState('');
  const [justificacionesHasta, setJustificacionesHasta] = useState('');
  const [searchJustificaciones, setSearchJustificaciones] = useState('');
  const [cursoJustificaciones, setCursoJustificaciones] = useState('');
  const [alertasMap, setAlertasMap] = useState({});

  // States for manual absence registration search
  const [absentSearchTerm, setAbsentSearchTerm] = useState('');
  const [absentSearchResults, setAbsentSearchResults] = useState([]);
  const [isSearchingAbsent, setIsSearchingAbsent] = useState(false);

  // Initial load
  useEffect(() => {
    const now = new Date();
    const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const firstDay = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const oneMonthAgo = localDate(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
    const today = localDate(now);

    setReportDesde(firstDay);
    setReportHasta(today);
    setJustificacionesDesde(oneMonthAgo);
    setJustificacionesHasta(today);

    fetchResumen();
    fetchInasistenciasHoy();
    fetchAlertasTempranas();

    axios.get(`${API_URL}/courses`, { withCredentials: true })
      .then(res => setCourses(res.data))
      .catch(err => console.error(err));
  }, []);

  // Búsqueda inteligente para reporte individual
  useEffect(() => {
    if (studentSearchTerm.trim().length < 2) {
      setStudentSearchResults([]);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      setIsSearchingStudents(true);
      try {
        const res = await axios.get(`${API_URL}/students/search`, {
          params: { q: studentSearchTerm },
          withCredentials: true
        });
        setStudentSearchResults(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearchingStudents(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [studentSearchTerm]);

  // Búsqueda inteligente para registrar inasistencia manual
  useEffect(() => {
    if (absentSearchTerm.trim().length < 2) {
      setAbsentSearchResults([]);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      setIsSearchingAbsent(true);
      try {
        const res = await axios.get(`${API_URL}/students/search`, {
          params: { q: absentSearchTerm },
          withCredentials: true
        });
        setAbsentSearchResults(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearchingAbsent(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [absentSearchTerm]);

  // Reactive load of justifications when filters change
  useEffect(() => {
    if (activeSubTab === 'justificaciones') {
      fetchJustificaciones();
    }
  }, [activeSubTab, justificacionesDesde, justificacionesHasta, cursoJustificaciones]);

  useEffect(() => {
    if (activeSubTab !== 'justificaciones') return;
    const delayDebounceFn = setTimeout(() => {
      fetchJustificaciones();
    }, 400);
    return () => clearTimeout(delayDebounceFn);
  }, [searchJustificaciones]);

  // Fetch summaries and tables
  const fetchResumen = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/asistencia/today-stats`);
      setStats(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInasistenciasHoy = async () => {
    setLoadingInasistencias(true);
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const res = await axios.get(`${API_URL}/asistencia/inasistencias`, {
        params: { fecha: today },
        withCredentials: true
      });
      setInasistenciasHoy(res.data);
      setCurrentPage(1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingInasistencias(false);
    }
  };

  const fetchAlertasTempranas = async () => {
    try {
      const res = await axios.get(`${API_URL}/asistencia/alertas-tempranas`, {
        withCredentials: true
      });
      setAlertasMap(res.data);
    } catch (err) {
      console.error('Error fetching early warning alerts:', err);
    }
  };

  const fetchJustificaciones = async () => {
    setLoadingJustificaciones(true);
    try {
      const res = await axios.get(`${API_URL}/asistencia/justificaciones`, {
        params: {
          desde: justificacionesDesde,
          hasta: justificacionesHasta,
          id_curso: cursoJustificaciones,
          search: searchJustificaciones
        },
        withCredentials: true
      });
      setJustificacionesList(res.data);
    } catch (err) {
      console.error('Error al obtener justificaciones:', err);
    } finally {
      setLoadingJustificaciones(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Actions
  const handleRegistrarAusencia = async (student) => {
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      await axios.post(`${API_URL}/asistencia/registrar-ausencia`, {
        id_alumno: student.id_alumno,
        fecha: today
      }, { withCredentials: true });
      alert(`Se ha registrado la inasistencia de ${student.nombres} ${student.paterno} con éxito.`);
      setAbsentSearchTerm('');
      setAbsentSearchResults([]);
      fetchResumen();
      fetchInasistenciasHoy();
      fetchAlertasTempranas();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Error al registrar la inasistencia.');
    }
  };

  const openJustifyModal = (studentOrRecord) => {
    setJustifyModal(studentOrRecord);
    setJustifyType('apoderado');
    setJustifyComment('');
    setJustifyFile(null);
    setJustifyIsRange(false);
    const today = new Date().toISOString().substring(0, 10);
    setJustifyStartDate(today);
    setJustifyEndDate(today);
  };

  const submitJustification = async () => {
    if (!justifyModal) return;
    setSubmittingJustify(true);
    try {
      let fileData = null;
      if (justifyFile && justifyType === 'medica') {
        fileData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(justifyFile);
        });
      }

      const id_alumno = justifyModal.id_alumno;
      const isRange = justifyIsRange;

      const payload = {
        id_alumno,
        tipo_justificacion: justifyType,
        comentario_justificacion: justifyComment,
        fileName: justifyFile ? justifyFile.name : null,
        fileData
      };

      if (isRange) {
        payload.fecha_inicio = justifyStartDate;
        payload.fecha_fin = justifyEndDate;
      } else {
        payload.fecha = new Date().toISOString().substring(0, 10);
      }

      await axios.post(`${API_URL}/asistencia/justificar-nueva`, payload, {
        withCredentials: true
      });

      alert('Inasistencia justificada correctamente.');
      setJustifyModal(null);
      fetchResumen();
      fetchInasistenciasHoy();
      fetchAlertasTempranas();
      if (activeSubTab === 'justificaciones') {
        fetchJustificaciones();
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Error al guardar justificación.');
    } finally {
      setSubmittingJustify(false);
    }
  };

  const handleRevokeJustification = async (id_registro) => {
    if (!window.confirm('¿Está seguro de que desea eliminar/revocar esta justificación? El registro volverá al estado de ausencia injustificada.')) {
      return;
    }
    try {
      await axios.delete(`${API_URL}/asistencia/justificacion/${id_registro}`, {
        withCredentials: true
      });
      alert('Justificación eliminada/revocada con éxito.');
      fetchJustificaciones();
      fetchResumen();
      fetchInasistenciasHoy();
      fetchAlertasTempranas();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Error al eliminar la justificación.');
    }
  };

  const downloadCertificate = async (id_registro, filename) => {
    try {
      const response = await axios.get(`${API_URL}/asistencia/download/${id_registro}`, {
        responseType: 'blob',
        withCredentials: true
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename || `certificado_${id_registro}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error(err);
      alert('Error al descargar el archivo.');
    }
  };

  const generateReport = async () => {
    if (!reportDesde || !reportHasta) return;

    if (reportScope === 'curso' && !selectedCursoId) {
      alert('Por favor selecciona un curso.');
      return;
    }
    if (reportScope === 'individual' && !selectedAlumno) {
      alert('Por favor busca y selecciona un alumno.');
      return;
    }

    setGeneratingReport(true);
    try {
      const params = { desde: reportDesde, hasta: reportHasta, tipo: reportType };
      if (reportScope === 'curso') {
        params.cursoId = selectedCursoId;
      } else if (reportScope === 'individual') {
        params.alumnoId = selectedAlumno.id_alumno;
      }

      const res = await axios.get(`${API_URL}/admin/reportes/asistencia`, {
        params,
        withCredentials: true
      });

      const data = res.data || [];
      if (data.length === 0) {
        alert('No se encontraron registros para los filtros seleccionados.');
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(data.map(item => ({
        'FECHA': item.fecha ? item.fecha.substring(0, 10) : '—',
        'ALUMNO': `${item.paterno} ${item.materno || ''}, ${item.nombres}`.toUpperCase(),
        'RUT': `${item.rut}-${item.dv}`,
        'CURSO': item.grade || 'S/C',
        'ESTADO': item.estado,
        'JUSTIFICADO': item.justificado ? 'SÍ' : 'NO',
        'TIPO JUSTIFICATIVO': item.tipo_justificacion || '—',
        'COMENTARIO': item.comentario_justificacion || '—',
        'ARCHIVO ADJUNTO': item.archivo_justificacion || '—'
      })));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte Inasistencias');

      const fileName = `Reporte_Inasistencias_${reportDesde}_a_${reportHasta}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (err) {
      console.error(err);
      alert('Error al generar el reporte.');
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div className="admin-dashboard fade-in">
      <div className="glass-panel" style={{ padding: '2rem' }}>

        {/* HEADER */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ color: 'var(--text-dark)', fontWeight: 800, fontSize: '1.8rem', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Calendar size={32} style={{ color: 'var(--primary)' }} /> Control de Inasistencias
            </h1>
            <p style={{ color: 'var(--text-light)', fontSize: '0.85rem', marginTop: '4px', margin: 0 }}>
              Liceo Domingo Santa María &bull; Gestión y Justificaciones de Ausencias
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => navigate('/admin')} className="action-btn" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', color: '#3b82f6', borderRadius: '10px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
              Volver al Hub
            </button>
            <button onClick={handleLogout} className="action-btn delete" style={{ display: 'flex', gap: '4px', alignItems: 'center', borderRadius: '10px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
              <LogOut size={16} /> Salir
            </button>
          </div>
        </header>

        {/* METRICS GRID */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <TrendingUp size={20} /> Resumen de Hoy
            </h3>
            <button
              onClick={() => { fetchResumen(); fetchInasistenciasHoy(); }}
              className="action-btn"
              style={{ background: 'rgba(79,70,229,0.07)', color: 'var(--primary)', border: 'none' }}
              title="Recargar"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {loading ? (
            <div className="loader">Cargando resumen...</div>
          ) : (
            <div className="stats-grid">
              <div className="stat-card" style={{ borderLeftColor: '#3b82f6' }}>
                <div className="stat-card__icon" style={{ color: '#3b82f6' }}><Users size={22} /></div>
                <div className="stat-card__value">{stats?.totalAlumnos || 0}</div>
                <div className="stat-card__label">Matrícula Activa</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#ef4444' }} onClick={() => { setActiveSubTab('inasistencias'); setCurrentPage(1); }}>
                <div className="stat-card__icon" style={{ color: '#ef4444' }}><ShieldAlert size={22} /></div>
                <div className="stat-card__value">{stats?.absent || 0}</div>
                <div className="stat-card__label">Inasistencias Totales</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#10b981' }} onClick={() => { setActiveSubTab('inasistencias'); setCurrentPage(1); }}>
                <div className="stat-card__icon" style={{ color: '#10b981' }}><ShieldCheck size={22} /></div>
                <div className="stat-card__value">{inasistenciasHoy.filter(r => r.justificado).length}</div>
                <div className="stat-card__label">Justificadas Hoy</div>
              </div>
              <div className="stat-card" style={{ borderLeftColor: '#f59e0b' }} onClick={() => { setActiveSubTab('inasistencias'); setCurrentPage(1); }}>
                <div className="stat-card__icon" style={{ color: '#f59e0b' }}><AlertTriangle size={22} /></div>
                <div className="stat-card__value">{inasistenciasHoy.filter(r => !r.justificado).length}</div>
                <div className="stat-card__label">Injustificadas Hoy</div>
              </div>
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '1.5rem 0' }} />

        {/* DETAILS TABLE & CENTRAL JUSTIFICATIONS */}
        <div className="recent-activity" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
          <div className="dashboard-tabs">
            <button
              type="button"
              className={`dashboard-tab ${activeSubTab === 'inasistencias' ? 'active' : ''}`}
              onClick={() => { setActiveSubTab('inasistencias'); setCurrentPage(1); }}
            >
              Inasistencias de Hoy ({inasistenciasHoy.length})
            </button>
            <button
              type="button"
              className={`dashboard-tab ${activeSubTab === 'justificaciones' ? 'active' : ''}`}
              onClick={() => { setActiveSubTab('justificaciones'); setCurrentPage(1); }}
            >
              Historial de Justificaciones ({justificacionesList.length})
            </button>
          </div>

          {activeSubTab === 'inasistencias' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '1rem' }}>
              {/* Registrar Manual Search Bar */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: 'rgba(59, 130, 246, 0.04)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px dashed rgba(59, 130, 246, 0.2)',
                marginBottom: '1rem'
              }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>📌 Registrar Nueva Inasistencia para Hoy</span>
                </label>
                <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Buscar alumno por nombre o RUT para marcar inasistencia..."
                    value={absentSearchTerm}
                    onChange={(e) => setAbsentSearchTerm(e.target.value)}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem' }}
                  />
                  {absentSearchTerm && (
                    <button
                      type="button"
                      onClick={() => { setAbsentSearchTerm(''); setAbsentSearchResults([]); }}
                      style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {isSearchingAbsent && <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', margin: '4px 0 0 0' }}>Buscando...</p>}
                {absentSearchResults.length > 0 && (
                  <div style={{
                    background: 'white',
                    border: '1px solid var(--panel-border)',
                    borderRadius: '8px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    marginTop: '4px',
                    zIndex: 10
                  }}>
                    {absentSearchResults.map(student => (
                      <div key={student.id_alumno} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderBottom: '1px solid rgba(0,0,0,0.04)',
                        fontSize: '0.8rem'
                      }}>
                        <div>
                          <strong>{`${student.paterno} ${student.materno || ''}, ${student.nombres}`.toUpperCase()}</strong>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-light)' }}>RUT: {student.rut}-{student.dv} &bull; Curso: {student.nombre_curso || 'S/C'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRegistrarAusencia(student)}
                          className="action-btn"
                          style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '6px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'none', cursor: 'pointer' }}
                        >
                          Marcar Ausente
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {loadingInasistencias ? (
                <div className="loader">Cargando inasistencias...</div>
              ) : inasistenciasHoy.length === 0 ? (
                <p style={{ color: 'var(--text-light)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                  Sin inasistencias registradas hoy.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {inasistenciasHoy
                      .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                      .map((r) => {
                        const alertInfo = alertasMap[r.id_alumno];
                        return (
                          <div key={`aus_${r.id_registro}`} className="recent-item">
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.88rem' }}>
                                  {`${r.paterno}${r.materno ? ' ' + r.materno : ''}, ${r.nombres}`.toUpperCase()}
                                </span>
                                {alertInfo?.alertaCritica && (
                                  <span
                                    className="severity-badge severity-badge--grave"
                                    title={`Alerta Crítica: ${alertInfo.rate}% de inasistencias (Límite 10%)`}
                                    style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                                  >
                                    ⚠️ Crítica ({alertInfo.rate}%)
                                  </span>
                                )}
                                {alertInfo?.alertaConsecutiva && (
                                  <span
                                    className="severity-badge severity-badge--leve"
                                    title={`Alerta Consecutiva: ${alertInfo.consecutive} ausencias seguidas`}
                                    style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                                  >
                                    🚨 {alertInfo.consecutive} Seguidas
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
                                {r.rut}-{r.dv} &bull; {r.grade || 'S/C'}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {r.justificado ? (
                                <>
                                  <span className="meal-badge" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                    Ausente
                                  </span>
                                  <span className={`justify-badge justify-badge--${r.tipo_justificacion || 'apoderado'}`} title={r.comentario_justificacion || ''}>
                                    ✓ {r.tipo_justificacion === 'medica' ? 'Médica' : 'Apoderado'}
                                  </span>
                                  {r.archivo_justificacion && (
                                    <button
                                      type="button"
                                      className="download-cert-btn"
                                      onClick={() => downloadCertificate(r.id_registro, r.archivo_justificacion)}
                                      title="Descargar Certificado Médico"
                                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(59, 130, 246, 0.1)', border: 'none', borderRadius: '6px', color: '#3b82f6', width: '24px', height: '24px', cursor: 'pointer' }}
                                    >
                                      <Download size={13} />
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="meal-badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                    Ausente
                                  </span>
                                  <button
                                    type="button"
                                    className="justify-badge justify-badge--pending"
                                    onClick={() => openJustifyModal(r)}
                                    title="Justificar esta inasistencia"
                                    style={{ cursor: 'pointer' }}
                                  >
                                    Justificar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {Math.ceil(inasistenciasHoy.length / PAGE_SIZE) > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        style={{ fontSize: '0.8rem', padding: '4px 14px' }}
                      >
                        ← Anterior
                      </button>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                        Página {currentPage} de {Math.ceil(inasistenciasHoy.length / PAGE_SIZE)}
                      </span>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(inasistenciasHoy.length / PAGE_SIZE), p + 1))}
                        disabled={currentPage === Math.ceil(inasistenciasHoy.length / PAGE_SIZE)}
                        style={{ fontSize: '0.8rem', padding: '4px 14px' }}
                      >
                        Siguiente →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeSubTab === 'justificaciones' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '1rem' }}>
              {/* Filtros Bar */}
              <div style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                flexWrap: 'wrap',
                background: 'rgba(0,0,0,0.02)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid rgba(0,0,0,0.05)'
              }}>
                <div className="date-field" style={{ flex: 1, minWidth: '120px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', marginBottom: '4px', display: 'block' }}>Desde</label>
                  <input
                    type="date"
                    value={justificacionesDesde}
                    onChange={(e) => setJustificacionesDesde(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem' }}
                  />
                </div>
                <div className="date-field" style={{ flex: 1, minWidth: '120px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', marginBottom: '4px', display: 'block' }}>Hasta</label>
                  <input
                    type="date"
                    value={justificacionesHasta}
                    onChange={(e) => setJustificacionesHasta(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem' }}
                  />
                </div>
                <div className="date-field" style={{ flex: 1, minWidth: '120px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', marginBottom: '4px', display: 'block' }}>Curso</label>
                  <select
                    value={cursoJustificaciones}
                    onChange={(e) => setCursoJustificaciones(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem', background: 'white' }}
                  >
                    <option value="">Todos los cursos</option>
                    {courses.map(c => (
                      <option key={c.id_curso} value={c.id_curso}>{c.nombre_curso}</option>
                    ))}
                  </select>
                </div>
                <div className="date-field" style={{ flex: 2, minWidth: '180px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', marginBottom: '4px', display: 'block' }}>Buscar Estudiante</label>
                  <input
                    type="text"
                    placeholder="Nombre, RUT..."
                    value={searchJustificaciones}
                    onChange={(e) => setSearchJustificaciones(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem' }}
                  />
                </div>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    const now = new Date();
                    const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                    setJustificacionesDesde(localDate(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())));
                    setJustificacionesHasta(localDate(now));
                    setCursoJustificaciones('');
                    setSearchJustificaciones('');
                  }}
                  style={{ height: '32px', marginTop: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', padding: '0 12px' }}
                >
                  Limpiar
                </button>
              </div>

              {loadingJustificaciones ? (
                <div className="loader">Cargando justificaciones...</div>
              ) : justificacionesList.length === 0 ? (
                <p style={{ color: 'var(--text-light)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                  No se encontraron justificaciones con los filtros seleccionados.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {justificacionesList
                      .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                      .map((r) => (
                        <div key={`just_${r.id_registro}`} className="recent-item" style={{ borderLeft: '3px solid var(--primary)' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.88rem' }}>
                                {`${r.paterno}${r.materno ? ' ' + r.materno : ''}, ${r.nombres}`.toUpperCase()}
                              </span>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
                                ({r.grade || 'S/C'})
                              </span>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
                              RUT: {r.rut}-{r.dv} &bull; Fecha inasistencia/atraso: <strong>{r.fecha.substring(0, 10)}</strong>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-dark)', marginTop: '4px', background: 'rgba(0,0,0,0.02)', padding: '6px 10px', borderRadius: '6px', borderLeft: '2px solid #cbd5e1' }}>
                              <strong>Motivo ({r.tipo_justificacion === 'medica' ? 'Médica' : 'Apoderado'}):</strong> {r.comentario_justificacion || 'Sin comentarios.'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            <span className="meal-badge" style={{ background: r.estado === 'Atrasado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)', color: r.estado === 'Atrasado' ? '#f59e0b' : '#3b82f6', border: r.estado === 'Atrasado' ? '1px solid rgba(245, 158, 11, 0.2)' : '1px solid rgba(59, 130, 246, 0.2)' }}>
                              {r.estado}
                            </span>
                            {r.archivo_justificacion && (
                              <button
                                type="button"
                                className="download-cert-btn"
                                onClick={() => downloadCertificate(r.id_registro, r.archivo_justificacion)}
                                title="Descargar Certificado Médico"
                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(59, 130, 246, 0.1)', border: 'none', borderRadius: '6px', color: '#3b82f6', width: '28px', height: '28px', cursor: 'pointer' }}
                              >
                                <Download size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="download-cert-btn"
                              onClick={() => handleRevokeJustification(r.id_registro)}
                              title="Revocar/Eliminar Justificación"
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.1)', border: 'none', borderRadius: '6px', color: '#ef4444', width: '28px', height: '28px', cursor: 'pointer' }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                  {Math.ceil(justificacionesList.length / PAGE_SIZE) > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        style={{ fontSize: '0.8rem', padding: '4px 14px' }}
                      >
                        ← Anterior
                      </button>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-light)' }}>
                        Página {currentPage} de {Math.ceil(justificacionesList.length / PAGE_SIZE)}
                      </span>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(justificacionesList.length / PAGE_SIZE), p + 1))}
                        disabled={currentPage === Math.ceil(justificacionesList.length / PAGE_SIZE)}
                        style={{ fontSize: '0.8rem', padding: '4px 14px' }}
                      >
                        Siguiente →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '1.5rem 0' }} />

        {/* ABSENCE REPORT GENERATOR */}
        <div style={{ marginBottom: '2rem' }}>
          <button
            className="report-toggle-btn"
            onClick={() => setShowReportPanel(!showReportPanel)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--panel-border)', cursor: 'pointer', fontWeight: 600, color: 'var(--text-dark)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileSpreadsheet size={20} style={{ color: '#ef4444' }} />
              <span>Generar Reporte de Inasistencias</span>
            </div>
            <ChevronDown
              size={18}
              style={{
                transition: 'transform 0.3s ease',
                transform: showReportPanel ? 'rotate(180deg)' : 'rotate(0deg)'
              }}
            />
          </button>

          {showReportPanel && (
            <div className="report-panel fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', background: 'rgba(0,0,0,0.01)', border: '1px solid var(--panel-border)', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px', marginTop: '-1px' }}>

              {/* Período */}
              <div className="report-section" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={13} /> Período
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="date"
                    value={reportDesde}
                    onChange={(e) => setReportDesde(e.target.value)}
                    style={{ flex: 1, padding: '6px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.8rem' }}
                  />
                  <input
                    type="date"
                    value={reportHasta}
                    onChange={(e) => setReportHasta(e.target.value)}
                    style={{ flex: 1, padding: '6px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.8rem' }}
                  />
                </div>
              </div>

              {/* Tipo Reporte */}
              <div className="report-section" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)' }}>Tipo de Inasistencia</label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.8rem', background: 'white' }}
                >
                  <option value="ausente">Inasistencias Totales</option>
                  <option value="justificado">Inasistencias Justificadas</option>
                </select>
              </div>

              {/* Ámbito */}
              <div className="report-section" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)' }}>Ámbito</label>
                <select
                  value={reportScope}
                  onChange={(e) => { setReportScope(e.target.value); setSelectedAlumno(null); setSelectedCursoId(''); }}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.8rem', background: 'white' }}
                >
                  <option value="masivo">Toda la Matrícula</option>
                  <option value="curso">Por Curso</option>
                  <option value="individual">Por Alumno</option>
                </select>
              </div>

              {/* Filtros dinámicos según Ámbito */}
              {reportScope === 'curso' && (
                <div className="report-section" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)' }}>Seleccionar Curso</label>
                  <select
                    value={selectedCursoId}
                    onChange={(e) => setSelectedCursoId(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.8rem', background: 'white' }}
                  >
                    <option value="">-- Seleccione curso --</option>
                    {courses.map(c => (
                      <option key={c.id_curso} value={c.id_curso}>{c.nombre_curso}</option>
                    ))}
                  </select>
                </div>
              )}

              {reportScope === 'individual' && (
                <div className="report-section" style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)' }}>Buscar Alumno</label>
                  <input
                    type="text"
                    placeholder="Nombre o RUT..."
                    value={studentSearchTerm}
                    onChange={(e) => setStudentSearchTerm(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.8rem' }}
                  />
                  {selectedAlumno && (
                    <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '2px', fontWeight: 600 }}>
                      Seleccionado: {`${selectedAlumno.paterno}, ${selectedAlumno.nombres}`}
                    </div>
                  )}
                  {isSearchingStudents && <p style={{ fontSize: '0.7rem', color: 'var(--text-light)', margin: '2px 0' }}>Buscando...</p>}
                  {studentSearchResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid var(--panel-border)', borderRadius: '8px', zIndex: 10, maxHeight: '120px', overflowY: 'auto' }}>
                      {studentSearchResults.map(s => (
                        <div key={s.id_alumno} onClick={() => { setSelectedAlumno(s); setStudentSearchResults([]); setStudentSearchTerm(''); }} style={{ padding: '6px 10px', fontSize: '0.78rem', cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                          {`${s.paterno} ${s.materno || ''}, ${s.nombres}`} ({s.nombre_curso})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Botón de Generación */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                <button
                  onClick={generateReport}
                  className="action-btn"
                  disabled={generatingReport}
                  style={{ width: '100%', height: '36px', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  {generatingReport ? 'Generando...' : <><Download size={15} /> Descargar Excel</>}
                </button>
              </div>

            </div>
          )}
        </div>

      </div>

      {/* JUSTIFICATION MODAL */}
      {justifyModal && (
        <div className="justify-modal-overlay">
          <div className="justify-modal">

            <div className="justify-modal__header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                ⚖️ Justificar Inasistencia
              </h2>
              <button
                type="button"
                onClick={() => setJustifyModal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="justify-modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-light)', fontWeight: 600 }}>Estudiante</span>
                <div style={{ fontWeight: 700, color: 'var(--text-dark)', fontSize: '0.92rem', marginTop: '2px' }}>
                  {`${justifyModal.paterno || ''} ${justifyModal.materno || ''}, ${justifyModal.nombres || ''}`.toUpperCase()}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
                  RUT: {justifyModal.rut}-{justifyModal.dv} &bull; Curso: {justifyModal.grade || justifyModal.nombre_curso || 'S/C'}
                </div>
              </div>

              {/* Rango switch */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(59,130,246,0.05)', borderRadius: '8px' }}>
                <input
                  type="checkbox"
                  id="modal-range-check"
                  checked={justifyIsRange}
                  onChange={(e) => setJustifyIsRange(e.target.checked)}
                  style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                />
                <label htmlFor="modal-range-check" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dark)', cursor: 'pointer' }}>
                  Justificar rango de fechas (Licencia Médica)
                </label>
              </div>

              {justifyIsRange ? (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 600 }}>Fecha Inicio</label>
                    <input
                      type="date"
                      value={justifyStartDate}
                      onChange={(e) => setJustifyStartDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem', marginTop: '4px' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-light)', fontWeight: 600 }}>Fecha Fin</label>
                    <input
                      type="date"
                      value={justifyEndDate}
                      onChange={(e) => setJustifyEndDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--panel-border)', fontSize: '0.82rem', marginTop: '4px' }}
                    />
                  </div>
                </div>
              ) : null}

              {/* Selector de Tipo */}
              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-light)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Tipo de Justificación</span>
                <div className="justify-type-selector">
                  <button
                    type="button"
                    className={`justify-type-btn ${justifyType === 'apoderado' ? 'active' : ''}`}
                    onClick={() => setJustifyType('apoderado')}
                  >
                    👤 Apoderado
                  </button>
                  <button
                    type="button"
                    className={`justify-type-btn ${justifyType === 'medica' ? 'active' : ''}`}
                    onClick={() => setJustifyType('medica')}
                  >
                    🏥 Médica
                  </button>
                </div>
              </div>

              {/* Comentarios */}
              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-light)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Comentario / Observación</span>
                <textarea
                  className="justify-textarea"
                  placeholder="Describa el motivo detallado de la inasistencia..."
                  value={justifyComment}
                  onChange={(e) => setJustifyComment(e.target.value)}
                  rows="3"
                />
              </div>

              {/* Archivo adjunto (solo si es médica) */}
              {justifyType === 'medica' && (
                <div>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-light)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Certificado Médico (PDF o Imagen)</span>
                  <div className="justify-file-input">
                    <input
                      type="file"
                      id="cert-file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setJustifyFile(e.target.files[0])}
                      style={{ display: 'none' }}
                    />
                    <label htmlFor="cert-file" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', padding: '16px 10px' }}>
                      <Upload size={24} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dark)', fontWeight: 500 }}>
                        {justifyFile ? justifyFile.name : 'Seleccionar archivo de certificado'}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-light)' }}>Formatos permitidos: PDF, PNG, JPG</span>
                    </label>
                  </div>
                </div>
              )}

            </div>

            <div className="justify-modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.5rem', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '1rem' }}>
              <button
                type="button"
                className="justify-cancel-btn"
                onClick={() => setJustifyModal(null)}
                disabled={submittingJustify}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="justify-submit-btn"
                onClick={submitJustification}
                disabled={submittingJustify}
              >
                {submittingJustify ? 'Guardando...' : 'Confirmar Justificación'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default InasistenciasAdmin;
