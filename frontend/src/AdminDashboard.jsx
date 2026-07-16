import React, { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from './context/AuthContext';
import {
  Users, AlertTriangle, LogOut,
  ShieldCheck, ShieldAlert, FileSpreadsheet,
  ChevronDown, Download, RefreshCw, Clock, TrendingUp,
  CheckCircle, X, Upload, Trash2, Globe2, School,
  UserRound, Settings2, ClipboardList, BarChart3, Stethoscope, Paperclip
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ModuleHeader from './components/ModuleHeader';
import { useFeedback } from './context/FeedbackContext';
import DateRangeField from './components/DateRangeField';
import StudentPicker from './components/StudentPicker';

import { API_URL } from './config';

const REPORT_TYPES = [
  { id: 'atrasado', label: 'Atrasos registrados', desc: 'Ingresos clasificados como atraso dentro del período seleccionado.', icon: <AlertTriangle size={18} /> }
];

const PAGE_SIZE = 10;


const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [reportType, setReportType] = useState('atrasado');
  const [reportFormat, setReportFormat] = useState('detallado'); // 'detallado' | 'resumido'
  const [reportDesde, setReportDesde] = useState('');
  const [reportHasta, setReportHasta] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [registrosHoy, setRegistrosHoy] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const { notify } = useFeedback();

  // Estados de segmentación de reportes
  const [reportScope, setReportScope] = useState('masivo'); // 'masivo' | 'curso' | 'individual' | 'personalizado'
  const [courses, setCourses] = useState([]);
  const [selectedCursoId, setSelectedCursoId] = useState('');

  // Para reporte individual
  const [selectedAlumno, setSelectedAlumno] = useState(null);

  // Para reporte personalizado
  const [selectedAlumnos, setSelectedAlumnos] = useState([]);

  // Para buscar alumnos
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);

  // States for Justification Modal
  const [justifyModal, setJustifyModal] = useState(null); // registration object or student object
  const [justifyType, setJustifyType] = useState('apoderado'); // 'apoderado' | 'medica'
  const [justifyComment, setJustifyComment] = useState('');
  const [justifyFile, setJustifyFile] = useState(null);
  const [submittingJustify, setSubmittingJustify] = useState(false);
  const [justifyIsRange, setJustifyIsRange] = useState(false);
  const [justifyStartDate, setJustifyStartDate] = useState('');
  const [justifyEndDate, setJustifyEndDate] = useState('');

  const openJustifyModal = (registro) => {
    setJustifyModal(registro);
    setJustifyType('apoderado');
    setJustifyComment('');
    setJustifyFile(null);
  };

  const submitJustification = async () => {
    if (!justifyModal) return;
    if (justifyType === 'medica' && !justifyFile) {
      notify('Adjunta el certificado médico antes de guardar.', 'error');
      return;
    }
    if (justifyFile && justifyFile.size > 8 * 1024 * 1024) {
      notify('El certificado no puede superar 8 MB.', 'error');
      return;
    }
    if (justifyFile && !['application/pdf', 'image/png', 'image/jpeg'].includes(justifyFile.type)) {
      notify('Formato no permitido. Utiliza PDF, PNG o JPG.', 'error');
      return;
    }
    setSubmittingJustify(true);
    try {
      let fileData = null;
      let fileName = null;
      if (justifyFile) {
        fileName = justifyFile.name;
        fileData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = (error) => reject(error);
          reader.readAsDataURL(justifyFile);
        });
      }

      if (justifyModal.id_registro !== undefined) {
        await axios.post(`${API_URL}/asistencia/${justifyModal.id_registro}/justificar`, {
          tipo_justificacion: justifyType,
          comentario_justificacion: justifyComment,
          fileName,
          fileData
        }, {
          withCredentials: true
        });
      }

      setJustifyModal(null);
      fetchRegistrosHoy();
      fetchResumen();
    } catch (err) {
      console.error(err);
      notify('No fue posible guardar la justificación.', 'error');
    } finally {
      setSubmittingJustify(false);
    }
  };

  const fetchRegistrosHoy = async () => {
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const res = await axios.get(`${API_URL}/asistencia/history`, {
        params: { from: today, to: today }
      });
      setRegistrosHoy(res.data);
      setCurrentPage(1);
    } catch (err) {
      console.error(err);
    }
  };

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

  useEffect(() => {
    const now = new Date();
    const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const firstDay = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const today = localDate(now);

    setReportDesde(firstDay);
    setReportHasta(today);

    fetchResumen();
    fetchRegistrosHoy();

    axios.get(`${API_URL}/courses`, { withCredentials: true })
      .then(res => setCourses(res.data))
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    if (showReportPanel && courses.length === 0) {
      axios.get(`${API_URL}/courses`, { withCredentials: true })
        .then(res => setCourses(res.data))
        .catch(err => console.error(err));
    }
  }, [showReportPanel, courses.length]);

  // Búsqueda inteligente de alumnos para reportes individuales/personalizados
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const generateReport = async () => {
    if (!reportDesde || !reportHasta) return;

    if (reportScope === 'curso' && !selectedCursoId) {
      notify('Selecciona un curso para generar el reporte.');
      return;
    }

    if (reportScope === 'individual' && !selectedAlumno) {
      notify('Busca y selecciona un alumno para continuar.');
      return;
    }
    if (reportScope === 'personalizado' && selectedAlumnos.length === 0) {
      notify('Agrega al menos un alumno al reporte.');
      return;
    }

    setGeneratingReport(true);
    try {
      const params = { desde: reportDesde, hasta: reportHasta, tipo: reportType };
      if (reportScope === 'curso') {
        params.cursoId = selectedCursoId;
      } else if (reportScope === 'individual') {
        params.alumnoId = selectedAlumno.id_alumno;
      } else if (reportScope === 'personalizado') {
        params.alumnosIds = selectedAlumnos.map(a => a.id_alumno).join(',');
      }

      const res = await axios.get(`${API_URL}/admin/reportes/asistencia`, {
        params,
        withCredentials: true
      });

      const rawData = res.data;
      if (rawData.length === 0) {
        notify('No se encontraron registros para el período y tipo seleccionados.');
        setGeneratingReport(false);
        return;
      }

      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Group raw data by student
      const studentsMap = {};
      rawData.forEach(r => {
        const key = r.id_alumno;
        if (!studentsMap[key]) {
          studentsMap[key] = {
            apellidos: `${r.paterno} ${r.materno || ''}`.trim(),
            nombres: r.nombres,
            curso: r.nombre_curso || 'S/C',
            correo: r.email || '',
            days: {}
          };
        }
        if (r.fecha_registro) {
          const dateKey = r.fecha_registro.substring(0, 10);
          if (!studentsMap[key].days[dateKey]) {
            studentsMap[key].days[dateKey] = [];
          }
          studentsMap[key].days[dateKey].push((r.estado_asistencia || '').toString().trim().toLowerCase());
        }
      });

      const students = Object.values(studentsMap);
      students.sort((a, b) => a.apellidos.localeCompare(b.apellidos));
      // Determine months in range
      const startDate = new Date(reportDesde + 'T12:00:00');
      const endDate = new Date(reportHasta + 'T12:00:00');
      const months = [];
      const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      while (cursor <= endDate) {
        months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
        cursor.setMonth(cursor.getMonth() + 1);
      }

      const schoolDays = new Set();
      rawData.forEach(r => {
        if (r.fecha_registro) {
          schoolDays.add(r.fecha_registro.substring(0, 10));
        }
      });
      const sortedSchoolDays = Array.from(schoolDays).sort();

      const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const reportLabel = REPORT_TYPES.find(r => r.id === reportType)?.label || 'Reporte';

      if (reportFormat === 'resumido') {
        // === FORMATO RESUMIDO: tabla simple con totales ===
        const titleRow = [`RESUMEN ASISTENCIA Y INASISTENCIAS — ${reportLabel.toUpperCase()} — ${reportDesde} a ${reportHasta}`];
        const headerRow = ['N°', 'APELLIDOS', 'NOMBRE', 'CURSO', 'Presentes', 'Atrasados', 'Inas. Justificadas', 'Inas. Injustificadas', 'Días Registrados', 'ESTADO', 'CORREO'];
        const dataRows = students.map((s, idx) => {
          let totalD = 0, totalA = 0, totalIJ = 0, totalII = 0;
          const diasUnicos = new Set();

          sortedSchoolDays.forEach(date => {
            const marcas = s.days[date] || [];
            if (marcas.length > 0) {
              diasUnicos.add(date);
              if (marcas.includes('presente')) totalD++;
              if (marcas.includes('atrasado')) totalA++;
              if (marcas.includes('ausente')) totalIJ++;
            } else {
              totalII++;
            }
          });

          const totalRegistrados = diasUnicos.size;
          const estado = totalRegistrados > 0 ? 'Con asistencia' : 'Sin registro';
          return [idx + 1, s.apellidos, s.nombres, s.curso, totalD, totalA, totalIJ, totalII, totalRegistrados, estado, s.correo];
        });

        const aoa = [titleRow, headerRow, ...dataRows];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const totalResumidoCols = 11;
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalResumidoCols - 1 } }];
        const colWidthsResumido = [{ wch: 4 }, { wch: 22 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
        ws['!cols'] = colWidthsResumido;
        XLSX.utils.book_append_sheet(wb, ws, reportLabel.substring(0, 31));

      } else {
        // === FORMATO DETALLADO: marcas P/T/I por día ===
        months.forEach(({ year, month }) => {
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const monthName = MONTH_NAMES[month];

          const titleRow = [`REPORTE ASISTENCIA Y INASISTENCIAS — ${reportLabel.toUpperCase()}`];
          const headerRow1 = ['N°', 'APELLIDOS', 'NOMBRE', 'CURSO'];
          const headerRow2 = ['', '', '', ''];

          for (let d = 1; d <= daysInMonth; d++) {
            headerRow1.push(d, '', '');
            headerRow2.push('P', 'T', 'I');
          }
          headerRow1.push('ESTADO', 'CORREO');
          headerRow2.push('', '');
          const dataRows = students.map((s, idx) => {
            const row = [idx + 1, s.apellidos, s.nombres, s.curso];

            let totalMarcasMes = 0;
            for (let d = 1; d <= daysInMonth; d++) {
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const marcas = s.days[dateStr] || [];
              const isSchoolDay = sortedSchoolDays.includes(dateStr);

              if (marcas.includes('presente')) {
                row.push('X', '', '');
              } else if (marcas.includes('atrasado')) {
                row.push('', 'X', '');
              } else if (marcas.includes('ausente')) {
                row.push('', '', 'J'); // J = Justificada
              } else if (isSchoolDay) {
                row.push('', '', 'X'); // X = Injustificada
              } else {
                row.push('', '', ''); // No hay clases / fin de semana sin registros
              }

              totalMarcasMes += marcas.length;
            }

            const estadoMes = totalMarcasMes > 0 ? 'Con asistencia' : 'Sin registro';
            row.push(estadoMes);
            row.push(s.correo);
            return row;
          });

          const aoa = [titleRow, headerRow1, headerRow2, ...dataRows];
          const ws = XLSX.utils.aoa_to_sheet(aoa);

          const totalCols = 4 + (daysInMonth * 3) + 2;
          ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }
          ];
          for (let d = 0; d < daysInMonth; d++) {
            const colStart = 4 + (d * 3);
            ws['!merges'].push({ s: { r: 1, c: colStart }, e: { r: 1, c: colStart + 2 } });
          }

          const colWidths = [{ wch: 4 }, { wch: 22 }, { wch: 20 }, { wch: 10 }];
          for (let d = 0; d < daysInMonth; d++) {
            colWidths.push({ wch: 2.5 }, { wch: 2.5 }, { wch: 2.5 });
          }
          colWidths.push({ wch: 15 }, { wch: 30 });
          ws['!cols'] = colWidths;

          const sheetName = months.length === 1
            ? reportLabel.substring(0, 31)
            : `${monthName} ${year}`.substring(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });
      }

      let scopeFilename = reportScope;
      if (reportScope === 'curso') {
        const cName = courses.find(c => c.id_curso.toString() === selectedCursoId.toString())?.nombre_curso || selectedCursoId;
        scopeFilename = `curso_${cName.replace(/\s+/g, '_')}`;

      } else if (reportScope === 'individual' && selectedAlumno) {
        scopeFilename = `alumno_${selectedAlumno.paterno}_${selectedAlumno.nombres.split(' ')[0]}`;
      } else if (reportScope === 'personalizado') {
        scopeFilename = `personalizado_${selectedAlumnos.length}_alumnos`;
      }

      XLSX.writeFile(wb, `reporte_${scopeFilename}_${reportType}_${reportFormat}_${reportDesde}_${reportHasta}.xlsx`);

    } catch (err) {
      console.error(err);
      notify('No fue posible generar el reporte.', 'error');
    } finally {
      setGeneratingReport(false);
    }
  };


  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    return timeStr.substring(0, 5);
  };

  return (
    <div className="app-container late-dashboard-page">
      <div className="glass-panel late-dashboard-surface">

        <ModuleHeader
          icon={ShieldCheck}
          title="Control de atrasos"
          description="Registro diario, seguimiento de puntualidad y generación de reportes."
          onBack={() => navigate('/admin')}
          onLogout={handleLogout}
        />

        {/* ===== SECCIÓN 1: RESUMEN DEL DÍA ===== */}
        <section className="late-dashboard-section" data-tour="late-summary">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <TrendingUp size={20} /> Resumen de Hoy
            </h3>
            <button
              onClick={() => { fetchResumen(); fetchRegistrosHoy(); }}
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
            <>
              {/* Stats Cards */}
              <div className="stats-grid late-metric-strip">
                <div className="stat-card" style={{ borderLeftColor: '#10b981' }}>
                  <div className="stat-card__icon" style={{ color: '#10b981' }}><ShieldCheck size={22} /></div>
                  <div className="stat-card__value">{stats?.presentes || 0}</div>
                  <div className="stat-card__label">Ingresos a Tiempo</div>
                </div>
                <div className="stat-card" style={{ borderLeftColor: '#f59e0b' }}>
                  <div className="stat-card__icon" style={{ color: '#f59e0b' }}><AlertTriangle size={22} /></div>
                  <div className="stat-card__value">{stats?.atrasados || 0}</div>
                  <div className="stat-card__label">Atrasados de Hoy</div>
                </div>
                <div className="stat-card" style={{ borderLeftColor: '#3b82f6' }}>
                  <div className="stat-card__icon" style={{ color: '#3b82f6' }}><Users size={22} /></div>
                  <div className="stat-card__value">{stats?.totalAlumnos || 0}</div>
                  <div className="stat-card__label">Matrícula Activa</div>
                </div>
              </div>

              {/* Atrasos de Hoy */}
              <div className="recent-activity" style={{ marginTop: '1.5rem' }} data-tour="late-list">
                <h4 style={{ color: 'var(--text-dark)', margin: '0 0 1rem 0', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={18} style={{ color: 'var(--primary)' }} />
                  Atrasos de Hoy ({registrosHoy.filter(r => r.estado === 'Atrasado').length})
                </h4>

                {(() => {
                  const activeList = registrosHoy.filter(r => r.estado === 'Atrasado');

                  if (activeList.length === 0) {
                    return (
                      <p style={{ color: 'var(--text-light)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                        Sin atrasos registrados hoy.
                      </p>
                    );
                  }

                  return (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {activeList
                          .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                          .map((r) => {
                            const uniqueKey = `reg_${r.id_registro}`;
                            return (
                              <div key={uniqueKey} className="recent-item">
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.88rem' }}>
                                      {`${r.paterno}${r.materno ? ' ' + r.materno : ''}, ${r.nombres}`.toUpperCase()}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
                                    {r.rut}-{r.dv} &bull; {r.grade || 'S/C'} ({r.rol})
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  <span className="status-badge late-badge" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                                    {r.estado}
                                  </span>
                                  {r.severidad && (
                                    <span className={`severity-badge severity-badge--${r.severidad.toLowerCase()}`}>
                                      {r.severidad}
                                    </span>
                                  )}
                                  {r.justificado ? (
                                    <span className={`justify-badge justify-badge--${r.tipo_justificacion || 'apoderado'}`} title={r.comentario_justificacion || ''}>
                                      ✓ {r.tipo_justificacion === 'medica' ? 'Médica' : 'Apoderado'}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="justify-badge justify-badge--pending"
                                      onClick={() => openJustifyModal(r)}
                                      title="Justificar este atraso"
                                      style={{ cursor: 'pointer' }}
                                    >
                                      Justificar
                                    </button>
                                  )}
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>
                                    {formatTime(r.hora)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                      {Math.ceil(activeList.length / PAGE_SIZE) > 1 && (
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
                            Página {currentPage} de {Math.ceil(activeList.length / PAGE_SIZE)}
                          </span>
                          <button
                            type="button"
                            className="action-btn"
                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(activeList.length / PAGE_SIZE), p + 1))}
                            disabled={currentPage === Math.ceil(activeList.length / PAGE_SIZE)}
                            style={{ fontSize: '0.8rem', padding: '4px 14px' }}
                          >
                            Siguiente →
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '1.5rem 0' }} />

        {/* ===== SECCIÓN 2: GENERADOR DE REPORTES ===== */}
        <section className="late-dashboard-section report-builder-section" data-tour="report-builder">
          <button
            className="report-toggle-btn"
            onClick={() => setShowReportPanel(!showReportPanel)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileSpreadsheet size={20} />
              <span>Generar Reportes</span>
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
            <div className="report-panel fade-in">

              <div className="report-section report-section--period">
                <DateRangeField
                  label="Período del reporte"
                  from={reportDesde}
                  to={reportHasta}
                  onChange={({ from, to }) => {
                    setReportDesde(from);
                    setReportHasta(to);
                  }}
                />
              </div>

              {/* Ámbito del Reporte */}
              <div className="report-section">
                <label className="report-section-label">Ámbito de Selección de Alumnos</label>
                <div className="report-scope-selector">
                  <button
                    type="button"
                    className={`report-scope-btn ${reportScope === 'masivo' ? 'active' : ''}`}
                    onClick={() => setReportScope('masivo')}
                  >
                    <Globe2 size={15} /> Masivo
                  </button>
                  <button
                    type="button"
                    className={`report-scope-btn ${reportScope === 'curso' ? 'active' : ''}`}
                    onClick={() => setReportScope('curso')}
                  >
                    <School size={15} /> Por curso
                  </button>

                  <button
                    type="button"
                    className={`report-scope-btn ${reportScope === 'individual' ? 'active' : ''}`}
                    onClick={() => setReportScope('individual')}
                  >
                    <UserRound size={15} /> Individual
                  </button>
                  <button
                    type="button"
                    className={`report-scope-btn ${reportScope === 'personalizado' ? 'active' : ''}`}
                    onClick={() => setReportScope('personalizado')}
                  >
                    <Settings2 size={15} /> Personalizado
                  </button>
                </div>

                {/* Controles Dinámicos */}
                {reportScope === 'curso' && (
                  <div className="report-scope-control fade-in" style={{ marginTop: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-light)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Curso</label>
                    <select
                      value={selectedCursoId}
                      onChange={(e) => setSelectedCursoId(e.target.value)}
                      className="report-select-input"
                    >
                      <option value="">-- Selecciona un Curso --</option>
                      {courses.map(c => (
                        <option key={c.id_curso} value={c.id_curso}>{c.nombre_curso}</option>
                      ))}
                    </select>
                  </div>
                )}

                {reportScope === 'individual' && (
                  <div className="report-scope-control fade-in">
                    <StudentPicker
                      label="Buscar una persona"
                      query={studentSearchTerm}
                      onQueryChange={setStudentSearchTerm}
                      results={studentSearchResults}
                      loading={isSearchingStudents}
                      selected={selectedAlumno ? [selectedAlumno] : []}
                      onSelect={(student) => {
                        setSelectedAlumno(student);
                        setStudentSearchResults([]);
                      }}
                      onRemove={() => setSelectedAlumno(null)}
                    />
                  </div>
                )}

                {reportScope === 'personalizado' && (
                  <div className="report-scope-control fade-in">
                    <StudentPicker
                      label="Seleccionar varias personas"
                      placeholder="Busca una persona para agregarla al reporte…"
                      query={studentSearchTerm}
                      onQueryChange={setStudentSearchTerm}
                      results={studentSearchResults}
                      loading={isSearchingStudents}
                      selected={selectedAlumnos}
                      multiple
                      onSelect={(student) => {
                        setSelectedAlumnos((current) => [...current, student]);
                        setStudentSearchResults([]);
                      }}
                      onRemove={(student) => setSelectedAlumnos((current) => current.filter((item) => item.id_alumno !== student.id_alumno))}
                      onClear={() => setSelectedAlumnos([])}
                    />
                  </div>
                )}
              </div>

              {/* Tipo de Reporte */}
              <div className="report-section">
                <label className="report-section-label">Tipo de Reporte</label>
                <div className="report-types-grid">
                  {REPORT_TYPES.map(rt => (
                    <button
                      type="button"
                      key={rt.id}
                      className={`report-type-card ${reportType === rt.id ? 'active' : ''}`}
                      onClick={() => setReportType(rt.id)}
                      aria-pressed={reportType === rt.id}
                    >
                      <div className="report-type-card__header">
                        {rt.icon}
                        <span>{rt.label}</span>
                      </div>
                      <p className="report-type-card__desc">{rt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Formato del Reporte */}
              <div className="report-section">
                <label className="report-section-label">Formato</label>
                <div className="report-format-selector">
                  <button
                    className={`report-format-btn ${reportFormat === 'detallado' ? 'active' : ''}`}
                    onClick={() => setReportFormat('detallado')}
                  >
                    <ClipboardList size={15} /> Detallado por fecha y hora
                  </button>
                  <button
                    className={`report-format-btn ${reportFormat === 'resumido' ? 'active' : ''}`}
                    onClick={() => setReportFormat('resumido')}
                  >
                    <BarChart3 size={15} /> Resumido por persona
                  </button>
                </div>
              </div>

              {/* Botón Generar */}
              <button
                className="generate-report-btn"
                onClick={generateReport}
                disabled={generatingReport || !reportDesde || !reportHasta}
              >
                {generatingReport ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Generando...
                  </>
                ) : (
                  <>
                    <Download size={16} /> Descargar Reporte Excel
                  </>
                )}
              </button>

              <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', textAlign: 'center', marginTop: '8px' }}>
                {reportFormat === 'detallado'
                  ? 'Genera una hoja por mes con cada atraso, fecha, hora y curso.'
                  : 'Genera una tabla con los totales de atrasos por persona.'
                }
              </p>
            </div>
          )}
        </section>

        {/* ===== JUSTIFICATION MODAL ===== */}
        {justifyModal && (
          <div className="justify-modal-overlay" onClick={() => setJustifyModal(null)}>
            <div className="justify-modal" onClick={(e) => e.stopPropagation()}>
              <div className="justify-modal__header">
                <h3 style={{ margin: 0, color: 'var(--text-dark)', fontSize: '1.1rem' }}>
                  {justifyModal.id_registro !== undefined ? 'Justificar Atraso' : 'Justificar Inasistencia'}
                </h3>
                <button aria-label="Cerrar regularización" onClick={() => setJustifyModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer' }}>
                  <X size={20} />
                </button>
              </div>
              <div className="justify-modal__body">
                <div style={{
                  marginBottom: '12px',
                  padding: '10px',
                  background: justifyModal.id_registro !== undefined ? 'rgba(245, 158, 11, 0.06)' : 'rgba(239, 68, 68, 0.06)',
                  borderRadius: '8px',
                  border: justifyModal.id_registro !== undefined ? '1px solid rgba(245, 158, 11, 0.12)' : '1px solid rgba(239, 68, 68, 0.12)'
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.9rem' }}>
                    {`${justifyModal.paterno}${justifyModal.materno ? ' ' + justifyModal.materno : ''}, ${justifyModal.nombres}`.toUpperCase()}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '2px' }}>
                    {justifyModal.rut}-{justifyModal.dv} &bull; {justifyModal.id_registro !== undefined ? `${formatTime(justifyModal.hora)} • Atraso ${justifyModal.severidad || 'Normal'}` : 'Inasistencia Completa'}
                  </div>
                </div>

                {justifyModal.id_registro === undefined ? (
                  <>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '6px', display: 'block' }}>
                      Tipo de Justificación
                    </label>
                    <div className="justify-type-selector">
                      <button className={`justify-type-btn ${justifyType === 'apoderado' ? 'active' : ''}`} onClick={() => setJustifyType('apoderado')}>
                        <UserRound size={16} /> Apoderado
                      </button>
                      <button className={`justify-type-btn ${justifyType === 'medica' ? 'active' : ''}`} onClick={() => setJustifyType('medica')}>
                        <Stethoscope size={16} /> Médica
                      </button>
                    </div>

                    <div style={{ marginTop: '14px', marginBottom: '10px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-dark)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={justifyIsRange}
                          onChange={(e) => setJustifyIsRange(e.target.checked)}
                          style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                        />
                        Justificar rango de fechas
                      </label>
                    </div>

                    {justifyIsRange && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: '4px' }}>
                            Fecha Inicio
                          </label>
                          <input
                            type="date"
                            value={justifyStartDate}
                            onChange={(e) => setJustifyStartDate(e.target.value)}
                            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1.5px solid rgba(0,0,0,0.12)', fontSize: '0.82rem', background: '#fff', color: 'var(--text-dark)', outline: 'none' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: '4px' }}>
                            Fecha Fin
                          </label>
                          <input
                            type="date"
                            value={justifyEndDate}
                            onChange={(e) => setJustifyEndDate(e.target.value)}
                            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1.5px solid rgba(0,0,0,0.12)', fontSize: '0.82rem', background: '#fff', color: 'var(--text-dark)', outline: 'none' }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-dark)', display: 'block', marginBottom: '4px' }}>
                      Tipo de Justificación
                    </span>
                    <span style={{ fontSize: '0.88rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(0,0,0,0.03)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.05)' }}>
                      <UserRound size={15} /> Apoderado (los atrasos solo admiten justificación de apoderados)
                    </span>
                  </div>
                )}

                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '6px', display: 'block', marginTop: '12px' }}>
                  Comentario
                </label>
                <textarea
                  className="justify-textarea"
                  value={justifyComment}
                  onChange={(e) => setJustifyComment(e.target.value)}
                  placeholder={justifyType === 'apoderado' ? 'Comentario del apoderado...' : 'Descripción del certificado médico...'}
                  rows={3}
                />

                {justifyModal.id_registro === undefined && justifyType === 'medica' && (
                  <div style={{ marginTop: '12px' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '6px', display: 'block' }}>
                      <Upload size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Certificado Médico (opcional)
                    </label>
                    <div className="justify-file-input">
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => setJustifyFile(e.target.files[0] || null)}
                        style={{ fontSize: '0.82rem' }}
                      />
                      {justifyFile && <span style={{ fontSize: '0.78rem', color: 'var(--secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Paperclip size={14} /> {justifyFile.name}</span>}
                    </div>
                  </div>
                )}
              </div>
              <div className="justify-modal__footer">
                <button className="justify-cancel-btn" onClick={() => setJustifyModal(null)}>
                  Cancelar
                </button>
                <button className="justify-submit-btn" onClick={submitJustification} disabled={submittingJustify}>
                  {submittingJustify ? (
                    <><RefreshCw size={14} className="spin" /> Guardando...</>
                  ) : (
                    <><CheckCircle size={14} /> Confirmar Justificación</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminDashboard;
