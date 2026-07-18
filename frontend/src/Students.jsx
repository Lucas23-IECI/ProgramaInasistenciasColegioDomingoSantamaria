import React, { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import { Search, X, Users, GraduationCap, Database, Upload, FileSpreadsheet, RefreshCw, ShieldCheck, User, Mail, Phone, Calendar, Hash, Shield, Clock, Activity, AlertTriangle, BellRing } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './index.css';

import { API_URL } from './config';
import { AuthContext } from './context/AuthContext';
import ModuleHeader from './components/ModuleHeader';
import AppSelect from './components/AppSelect';

const normalizeHeaderKey = (value) => {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

const getCell = (row, aliases) => {
  const aliasSet = new Set(aliases.map((alias) => normalizeHeaderKey(alias)));
  for (const [key, value] of Object.entries(row || {})) {
    if (!aliasSet.has(normalizeHeaderKey(key))) continue;
    const cleaned = String(value ?? '').trim();
    if (cleaned !== '') return cleaned;
  }
  return '';
};

function Students() {
  const { logout } = useContext(AuthContext);
  const [activeSection, setActiveSection] = useState('listado');
  const [students, setStudents] = useState([]);
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
  const [excelFileName, setExcelFileName] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [toast, setToast] = useState(null);

  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

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
    fetchAlertasTempranas();
  }, []);

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
      const res = await axios.get(`${API_URL}/students`);
      setStudents(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (id) => {
    setSelectedStudentId(id);
    setLoadingDetails(true);
    setStudentDetails(null);
    try {
      const res = await axios.get(`${API_URL}/students/${id}/details`);
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
        return;
      }

      const mappedPreview = cleanRows.map((row, index) => {
        const rut = getCell(row, ['RUT', 'run', 'id']);
        const nombres = getCell(row, ['Nombres']);
        const apellidos = getCell(row, ['Apellidos']);
        const nombre = `${nombres} ${apellidos}`.trim();
        const curso = getCell(row, ['Curso', 'grade']);
        const email = getCell(row, ['Email', 'correo']);
        const rol = getCell(row, ['Rol', 'role']);
        return { index: index + 2, rut, nombre, curso, email, rol };
      });

      setExcelRows(cleanRows);
      setPreviewRows(mappedPreview);
      setExcelFileName(file.name);
    } catch (err) {
      console.error(err);
      setUploadError('No fue posible leer el archivo Excel.');
    }
  };

  const syncExcelWithDatabase = async () => {
    if (!excelRows.length || syncing) return;

    setSyncing(true);
    setUploadError('');
    setSyncResult(null);

    try {
      const res = await axios.post(`${API_URL}/students/bulk-sync`, { students: excelRows });
      setSyncResult(res.data);
      fetchStudents();
      setSelectedCourse(null);
      setActiveSection('listado');
      setToast({ type: 'success', text: `Sincronización completada — Creados: ${res.data.inserted || 0}, Actualizados: ${res.data.updated || 0}` });
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
    const matchText = (s.nombres + ' ' + s.paterno).toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.rut.toLowerCase().includes(searchTerm.toLowerCase());
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
    if (activeSection === 'carga') {
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

  return (
    <div className="students-page">
      {toast && (
        <div className={`kiosk-reconnected-banner ${toast.type === 'error' ? 'bg-red-500' : ''}`} style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 10000,
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '10px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <span>{toast.text}</span>
        </div>
      )}

      <div className="students-card" ref={contentStartRef}>

        <ModuleHeader
          icon={GraduationCap}
          title={activeSection === 'listado'
            ? (selectedCourse ? `Nómina: ${selectedCourse}` : 'Personas y cursos')
            : 'Importación de nómina escolar'}
          description={activeSection === 'carga'
            ? 'Carga controlada desde el archivo ERP, con previsualización antes de sincronizar.'
            : 'Padrón institucional, cursos, estado de matrícula y ficha de cada integrante.'}
          onBack={handleBack}
          onLogout={handleLogout}
        />

        <div className="students-tabs">
          <button
            className={`students-tab ${activeSection === 'listado' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('listado');
              setUploadError('');
            }}
          >
            <Users size={16} /> Padrón de personas
          </button>
          <button
            className={`students-tab ${activeSection === 'carga' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('carga');
              setSelectedCourse(null);
            }}
          >
            <Database size={16} /> Importar Excel ERP
          </button>
        </div>

        {activeSection === 'listado' && loading ? (
          <div className="loader">Cargando base de datos escolar...</div>
        ) : activeSection === 'listado' && !selectedCourse ? (
          <div className="fade-in">
             <p style={{color: 'var(--text-light)', marginBottom: '16px'}}>
                Seleccione un curso para inspeccionar su listado, o busque de manera global por RUT o Nombre.
             </p>

             <div className="students-filter-row" data-tour="student-search">
               <div className="students-search" style={{flex: '2', minWidth: '260px'}}>
                 <Search size={16} />
                 <input
                   type="text"
                   placeholder="Buscar globalmente (por RUT, Nombre o Usuario)..."
                   value={globalStudentSearch}
                   onChange={(e) => setGlobalStudentSearch(e.target.value)}
                 />
               </div>
               <div className="students-search" style={{flex: '1', minWidth: '180px'}}>
                 <Search size={16} />
                 <input
                   type="text"
                   placeholder="Filtrar cursos..."
                   value={courseSearch}
                   onChange={(e) => setCourseSearch(e.target.value)}
                 />
               </div>
             </div>

             {globalStudentSearch.trim().length >= 2 && (() => {
               const globalFiltered = students.filter(s =>
                 (s.nombres + ' ' + s.paterno).toLowerCase().includes(globalStudentSearch.toLowerCase()) ||
                 s.rut.toLowerCase().includes(globalStudentSearch.toLowerCase()) ||
                 (s.nombre_usuario && s.nombre_usuario.toLowerCase().includes(globalStudentSearch.toLowerCase()))
               );
               return (
                 <div className="fade-in" style={{marginBottom: '28px', background: 'rgba(15,23,42,0.4)', borderRadius: '14px', padding: '18px', border: '1px solid rgba(59,130,246,0.15)'}}>
                   <h3 style={{margin: '0 0 12px 0', color: 'var(--text-dark)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px'}}>
                     <Users size={18} color="var(--primary)" />
                     Miembros Encontrados ({globalFiltered.length})
                   </h3>
                   {globalFiltered.length > 0 ? (
                     <div className="students-table-wrap">
                       <table className="students-table students-table--cards">
                         <thead>
                           <tr>
                             <th>RUT</th>
                             <th>Nombre Completo</th>
                             <th>Curso</th>
                             <th>Rol</th>
                             <th style={{textAlign: 'center'}}>Estado</th>
                             <th style={{textAlign: 'right'}}>Acción</th>
                           </tr>
                         </thead>
                         <tbody>
                           {globalFiltered.slice(0, 15).map(s => (
                             <tr key={s.id_alumno}>
                               <td className="students-cell-mono" data-label="RUT">{s.rut}-{s.dv}</td>
                               <td className="students-cell-name" data-label="Nombre">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span>{s.nombres} {s.paterno} {s.materno}</span>
                            {alertasMap[s.id_alumno]?.nivel === 'critica' && (
                              <span
                                className="severity-badge severity-badge--grave"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados en los últimos 30 días, ${alertasMap[s.id_alumno].graves} graves`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <AlertTriangle size={12} /> Seguimiento crítico
                              </span>
                            )}
                            {alertasMap[s.id_alumno]?.nivel === 'preventiva' && (
                              <span
                                className="severity-badge severity-badge--leve"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados; racha actual de ${alertasMap[s.id_alumno].racha_atrasos}`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <BellRing size={12} /> Seguimiento preventivo
                              </span>
                            )}
                          </div>
                        </td>
                               <td data-label="Curso">{s.grade || 'Sin Curso'}</td>
                               <td data-label="Rol">
                                 <span style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '8px', background: s.rol === 'Estudiante' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)', color: s.rol === 'Estudiante' ? '#3b82f6' : '#f59e0b' }}>
                                   {s.rol}
                                 </span>
                               </td>
                               <td style={{textAlign: 'center'}} data-label="Estado">
                                 <span className={`students-badge ${s.activo ? 'badge-active' : 'badge-inactive'}`}>
                                   {s.activo ? 'Activa' : 'Retirado'}
                                 </span>
                               </td>
                               <td style={{textAlign: 'right'}} data-label="Acción">
                                 <button onClick={() => openDetails(s.id_alumno)} className="students-ficha-btn">
                                   Ver Ficha
                                 </button>
                               </td>
                             </tr>
                           ))}
                         </tbody>
                       </table>
                     </div>
                   ) : (
                     <p style={{margin: 0, color: 'var(--text-light)', fontSize: '0.9rem', fontStyle: 'italic'}}>No se encontraron registros coincidentes.</p>
                   )}
                 </div>
               );
             })()}

             {(() => {
                const allCourses = Object.keys(courseGroups).sort().filter(c => c.toLowerCase().includes(courseSearch.toLowerCase()));
                const totalCoursePages = Math.ceil((allCourses.length + 1) / COURSE_PAGE_SIZE);
                const pagedCourses = coursePage === 1
                  ? allCourses.slice(0, COURSE_PAGE_SIZE - 1)
                  : allCourses.slice((coursePage - 1) * COURSE_PAGE_SIZE - 1, coursePage * COURSE_PAGE_SIZE - 1);
                return (
                  <>
                    <div className="students-course-grid" data-tour="course-selector">
                      {coursePage === 1 && (
                      <button
                        type="button"
                        className="hub-module students-course-option students-course-option--all"
                        onClick={() => selectCourse('Toda La Matrícula')}
                      >
                        <Users size={32} color="#3b82f6" style={{marginBottom: '10px'}}/>
                        <h3 className="hub-module-title">Matrícula Completa</h3>
                        <p className="hub-module-desc">Padrón total del Liceo ({students.length} miembros)</p>
                      </button>
                      )}

                      {pagedCourses.map(curso => (
                       <button
                         type="button"
                         key={curso}
                         className="hub-module students-course-option"
                         onClick={() => selectCourse(curso)}
                       >
                         <GraduationCap size={32} color="var(--primary)" style={{marginBottom: '10px'}}/>
                         <h3 className="hub-module-title">{curso}</h3>
                         <p className="hub-module-desc">{courseGroups[curso].length} Miembros registrados</p>
                       </button>
                      ))}
                    </div>
                    {totalCoursePages > 1 && (
                      <div className="pagination" style={{marginTop: '20px'}}>
                        <button className="pagination-btn" disabled={coursePage === 1} onClick={() => setCoursePage(p => p - 1)}>← Anterior</button>
                        <span className="pagination-info">Pág {coursePage} de {totalCoursePages} · {allCourses.length} cursos</span>
                        <button className="pagination-btn" disabled={coursePage === totalCoursePages} onClick={() => setCoursePage(p => p + 1)}>Siguiente →</button>
                      </div>
                    )}
                  </>
                );
             })()}
          </div>
        ) : activeSection === 'listado' ? (
          <div className="fade-in">
             <div className="students-filter-row" data-tour="student-search">
               <div className="students-search" style={{flex: '1', minWidth: '220px'}}>
                 <Search size={16} />
                 <input
                   type="text"
                   placeholder={`Buscar en ${selectedCourse}...`}
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                 />
               </div>
               <AppSelect ariaLabel="Filtrar por estado" value={filterEstado} onChange={setFilterEstado} options={[{ value: '', label: 'Estado: todos' }, { value: 'activo', label: 'Vigentes' }, { value: 'inactivo', label: 'Retirados' }]} />
               <AppSelect ariaLabel="Filtrar por rol" value={filterRol} onChange={setFilterRol} options={[{ value: '', label: 'Rol: todos' }, { value: 'Estudiante', label: 'Estudiante' }, { value: 'Admin', label: 'Admin' }, { value: 'Profesor(a)', label: 'Profesor(a)' }, { value: 'Asistente de educación', label: 'Asistente de educación' }]} />
             </div>

             <div className="students-table-wrap" data-tour="student-list">
               <table className="students-table students-table--cards">
                 <thead>
                   <tr>
                     <th>RUT</th>
                     <th>Nombre Completo</th>
                     {selectedCourse === 'Toda La Matrícula' && <th>Curso</th>}
                     <th>Rol</th>
                     <th style={{textAlign: 'center'}}>Estado</th>
                     <th style={{textAlign: 'right'}}>Acción</th>
                   </tr>
                 </thead>
                 <tbody>
                    {paginatedStudents.map(s => (
                      <tr key={s.id_alumno}>
                        <td className="students-cell-mono" data-label="RUT">{s.rut}-{s.dv}</td>
                        <td className="students-cell-name" data-label="Nombre">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span>{s.nombres} {s.paterno} {s.materno}</span>
                            {alertasMap[s.id_alumno]?.nivel === 'critica' && (
                              <span
                                className="severity-badge severity-badge--grave"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados en los últimos 30 días, ${alertasMap[s.id_alumno].graves} graves`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <AlertTriangle size={12} /> Seguimiento crítico
                              </span>
                            )}
                            {alertasMap[s.id_alumno]?.nivel === 'preventiva' && (
                              <span
                                className="severity-badge severity-badge--leve"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados; racha actual de ${alertasMap[s.id_alumno].racha_atrasos}`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <BellRing size={12} /> Seguimiento preventivo
                              </span>
                            )}
                          </div>
                        </td>
                        {selectedCourse === 'Toda La Matrícula' && <td data-label="Curso">{s.grade || 'Sin Curso'}</td>}
                       <td data-label="Rol">
                         <span style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '8px', background: s.rol === 'Estudiante' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)', color: s.rol === 'Estudiante' ? '#3b82f6' : '#f59e0b' }}>
                           {s.rol}
                         </span>
                       </td>
                       <td style={{textAlign: 'center'}} data-label="Estado">
                          <span className={`students-badge ${s.activo ? 'badge-active' : 'badge-inactive'}`}>
                            {s.activo ? 'Activa' : 'Retirado'}
                          </span>
                       </td>
                       <td style={{textAlign: 'right'}} data-label="Acción">
                          <button onClick={() => openDetails(s.id_alumno)} className="students-ficha-btn">
                            Ver Ficha
                          </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
               {filtered.length === 0 && <p style={{textAlign: 'center', padding: '20px', color: 'var(--text-light)'}}>No hay resultados coincidentes en esta nómina.</p>}
               {filtered.length > 0 && (
                 <div className="pagination">
                   <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Anterior</button>
                   <span className="pagination-info">Página {page} de {stuTotalPages} · {filtered.length} registros</span>
                   <button className="pagination-btn" disabled={page === stuTotalPages} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
                   <AppSelect ariaLabel="Registros por página" value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} options={[10, 20, 50, 100].map((number) => ({ value: String(number), label: `${number} por página` }))} />
                 </div>
               )}
             </div>
          </div>
        ) : (
          <div className="fade-in">
            <div className="students-import-panel">
              <h3 style={{margin: 0, marginBottom: '8px', color: 'var(--text-dark)', display: 'flex', gap: '8px', alignItems: 'center'}}>
                <FileSpreadsheet size={18} /> Cargar Planilla ERP (`Usuarios`)
              </h3>
              <p style={{color: 'var(--text-light)', marginBottom: '12px', fontSize: '0.9rem'}}>
                Seleccione el archivo Excel exportado desde el ERP. El sistema actualizará personas, cursos y matrículas. Las columnas de contraseña se descartan y la importación nunca crea cuentas de acceso.
              </p>

              <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center'}}>
                <label className="pagination-btn students-import-select">
                  <Upload size={16} /> Seleccionar Archivo Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    style={{display: 'none'}}
                  />
                </label>

                <button
                  className="pagination-btn students-import-submit"
                  onClick={syncExcelWithDatabase}
                  disabled={!excelRows.length || syncing}
                  style={{
                    background: excelRows.length ? '#10b981' : 'rgba(30,41,59,0.3)',
                    cursor: excelRows.length && !syncing ? 'pointer' : 'not-allowed'
                  }}
                >
                  {syncing ? <RefreshCw size={16} className="spin" /> : <Database size={16} />} {syncing ? 'Sincronizando...' : 'Cargar / Actualizar Base de Datos'}
                </button>
              </div>

              {excelFileName && (
                <p style={{marginTop: '10px', fontSize: '0.85rem', color: 'var(--text-light)'}}>
                  Planilla seleccionada: <strong style={{color: 'var(--text-dark)'}}>{excelFileName}</strong> ({excelRows.length} filas procesadas)
                </p>
              )}

              {uploadError && (
                <div className="login-error" style={{marginTop: '12px'}}>{uploadError}</div>
              )}

              {syncResult && (
                <div className="students-sync-success">
                  <div><strong>Carga Finalizada Exitosamente</strong></div>
                  <div style={{marginTop: '6px', fontSize: '0.9rem'}}>Miembros Nuevos: {syncResult.inserted} | Actualizados: {syncResult.updated} | Omitidos sin cambios: {syncResult.unchanged}</div>
                  <div style={{marginTop: '4px', fontSize: '0.9rem'}}>Errores encontrados: {syncResult.errors?.length || 0}</div>
                </div>
              )}

              {syncResult?.errors?.length > 0 && (
                <div style={{marginTop: '12px', maxHeight: '160px', overflowY: 'auto', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '10px', background: 'rgba(239,68,68,0.05)'}}>
                  {syncResult.errors.map((errorItem, idx) => (
                    <p key={`${errorItem.row}-${idx}`} style={{margin: '0 0 6px 0', color: '#f87171', fontSize: '0.85rem'}}>
                      Fila {errorItem.row}: {errorItem.message}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {previewRows.length > 0 && (
              <div className="students-import-preview" style={{overflowX: 'auto'}}>
                <table className="students-table" style={{width: '100%', borderCollapse: 'collapse'}}>
                  <thead>
                    <tr style={{borderBottom: '1px solid rgba(59,130,246,0.2)'}}>
                      <th style={{padding: '12px'}}>Fila</th>
                      <th style={{padding: '12px'}}>RUT</th>
                      <th style={{padding: '12px'}}>Nombre</th>
                      <th style={{padding: '12px'}}>Curso</th>
                      <th style={{padding: '12px'}}>Rol</th>
                      <th style={{padding: '12px'}}>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 25).map((row) => (
                      <tr key={row.index} style={{borderBottom: '1px solid rgba(59,130,246,0.1)'}}>
                        <td style={{padding: '10px 12px'}}>{row.index}</td>
                        <td style={{padding: '10px 12px'}} className="students-cell-mono">{row.rut || '-'}</td>
                        <td style={{padding: '10px 12px'}} className="students-cell-name">{row.nombre || '-'}</td>
                        <td style={{padding: '10px 12px'}}>{row.curso || '-'}</td>
                        <td style={{padding: '10px 12px'}}>
                          <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)' }}>
                            {row.rol || '-'}
                          </span>
                        </td>
                        <td style={{padding: '10px 12px'}}>{row.email || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewRows.length > 25 && (
                  <p style={{padding: '12px', color: 'var(--text-light)', fontSize: '0.85rem'}}>
                    Previsualizando primeras 25 de {previewRows.length} filas.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {selectedStudentId && (
        <div className="student-detail-overlay" onClick={closeDetails}>
           <div className="student-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="student-detail-title" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={closeDetails}
                className="student-detail-close"
                aria-label="Cerrar ficha"
              >
                <X size={20} />
              </button>

              {loadingDetails ? (
                 <div className="loader" style={{margin: '50px auto'}}>Atrayendo ficha del miembro...</div>
              ) : studentDetails ? (
                 <div className="fade-in">
                    {/* Header with Avatar and Basic Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                      <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        fontSize: '1.4rem',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)'
                      }}>
                        {(() => {
                          const n = studentDetails.alumno.nombres ? studentDetails.alumno.nombres.trim().charAt(0) : '';
                          const p = studentDetails.alumno.paterno ? studentDetails.alumno.paterno.trim().charAt(0) : '';
                          return (n + p).toUpperCase() || '?';
                        })()}
                      </div>
                      <div>
                        <h3 id="student-detail-title" style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                          {studentDetails.alumno.nombres} {studentDetails.alumno.paterno} {studentDetails.alumno.materno || ''}
                        </h3>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                          <span style={{
                            background: 'rgba(59,130,246,0.12)',
                            color: 'var(--primary)',
                            padding: '3px 10px',
                            borderRadius: '8px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}>
                            {studentDetails.alumno.rol || 'Estudiante'}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', fontWeight: 500 }}>
                            {studentDetails.alumno.grade || 'Sin Curso'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Datos Personales Panel */}
                    <div style={{
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '16px',
                      padding: '20px',
                      marginBottom: '20px',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                    }}>
                      <h4 style={{
                        margin: '0 0 16px 0',
                        color: 'var(--primary)',
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderBottom: '1px solid var(--panel-border)',
                        paddingBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        <User size={16} /> Datos Personales
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', fontSize: '0.88rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>RUT</span>
                          <span style={{ color: 'var(--text-dark)', fontFamily: 'Space Mono, monospace', fontWeight: 600 }}>{studentDetails.alumno.rut}-{studentDetails.alumno.dv}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Estado</span>
                          <span style={{
                            color: studentDetails.alumno.activo ? '#10b981' : '#ef4444',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: studentDetails.alumno.activo ? '#10b981' : '#ef4444', display: 'inline-block' }} />
                            {studentDetails.alumno.activo ? 'Vigente' : 'Inactivo'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Curso / Grado</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.grade)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Sección / Letra</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.seccion)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Código de Barra</span>
                          <span style={{ color: 'var(--primary)', fontFamily: 'Space Mono, monospace', fontWeight: 600 }}>{formatNullable(studentDetails.alumno.codigo_barra)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Género</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.genero)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Fecha de Nacimiento</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{studentDetails.alumno.fecha_nacimiento ? new Date(studentDetails.alumno.fecha_nacimiento).toLocaleDateString('es-CL') : 'N/D'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Usuario ERP</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.nombre_usuario)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Contacto e Información Extra Panel */}
                    <div style={{
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '16px',
                      padding: '20px',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                    }}>
                      <h4 style={{
                        margin: '0 0 16px 0',
                        color: 'var(--primary)',
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderBottom: '1px solid var(--panel-border)',
                        paddingBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        <Activity size={16} /> Contacto y Sincronización
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', fontSize: '0.88rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Email de Contacto</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500, wordBreak: 'break-all' }}>{formatNullable(studentDetails.alumno.email)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Teléfono</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.telefono)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>RUT Apoderado</span>
                          <span style={{ color: 'var(--text-dark)', fontFamily: 'Space Mono, monospace' }}>{formatNullable(studentDetails.alumno.rut_apoderado)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>ID ERP (UUID)</span>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.82rem', fontFamily: 'Space Mono, monospace', wordBreak: 'break-all' }}>{formatNullable(studentDetails.alumno.uuid_erp)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Última Sincronización</span>
                          <span style={{ color: 'var(--text-dark)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} style={{ color: 'var(--text-light)' }} />
                            {studentDetails.alumno.fecha_actualizacion ? new Date(studentDetails.alumno.fecha_actualizacion).toLocaleString('es-CL') : 'N/D'}
                          </span>
                        </div>
                      </div>
                    </div>

                 </div>
              ) : null}
           </div>
        </div>
      )}

    </div>
  );
}

export default Students;
