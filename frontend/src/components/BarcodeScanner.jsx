import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Search, CheckCircle, AlertCircle, LogIn, LogOut, User, ChevronRight, Columns, AlignCenter, Sparkles, ShieldCheck, GraduationCap, Clock, Filter, X } from 'lucide-react';
import { playBeep } from '../utils/audioNotifier';
import { API_URL } from '../config';

const BarcodeScanner = ({ tipoRegistro }) => {
  const [inputValue, setInputValue] = useState('');
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [statusRegistrado, setStatusRegistrado] = useState(''); // Presente / Atrasado / Salida
  const [restricciones, setRestricciones] = useState([]);
  const [isOffline, setIsOffline] = useState(false);
  const [showReconnectedBanner, setShowReconnectedBanner] = useState(false);
  const [todayStats, setTodayStats] = useState({ total: 0, presentes: 0, atrasados: 0 }); // Presentes y Atrasados
  
  // Settings/Config
  const [asistenciaConfig, setAsistenciaConfig] = useState({ hora_entrada: '08:00:00', hora_limite_atraso: '08:15:00' });

  // Layout mode: 'centered' | 'columns'
  const [layoutMode, setLayoutMode] = useState('centered');
  
  // Flash mode feedback
  const [flashMode, setFlashMode] = useState(true);
  const [flashColor, setFlashColor] = useState(null);
  
  // Advanced search filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterCurso, setFilterCurso] = useState('');
  const [courses, setCourses] = useState([]);
  
  // Búsqueda manual
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  // Scanner status
  const [scannerActive, setScannerActive] = useState(true);
  const [manualOverride, setManualOverride] = useState(false);
  
  // Confirmación antes de registro (flujo escáner)
  const [pendingRegistration, setPendingRegistration] = useState(null);
  
  // Detección de escáner vs teclado manual
  const keystrokeTimestamps = useRef([]);
  const scannerThreshold = 80;
  const lastScannerDetection = useRef(Date.now());
  
  const inputRef = useRef(null);
  const autoResetTimer = useRef(null);
  const searchDebounce = useRef(null);
  const isProcessing = useRef(false);
  const overrideTimer = useRef(null);
  const pendingTimer = useRef(null);
  const searchResultRefs = useRef([]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  
  // Fetch Config on mount
  useEffect(() => {
    axios.get(`${API_URL}/attendance/config`)
      .then(res => setAsistenciaConfig(res.data))
      .catch(() => {});
  }, []);

  // Polling de salud del servidor (heartbeat)
  useEffect(() => {
    let consecutiveFailures = 0;
    const checkHealth = async () => {
      try {
        await axios.get(`${API_URL}/health`, { timeout: 4000 });
        consecutiveFailures = 0;
        setIsOffline(prev => {
          if (prev) {
            setShowReconnectedBanner(true);
            setTimeout(() => setShowReconnectedBanner(false), 5000);
          }
          return false;
        });
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= 2) {
          setIsOffline(true);
        }
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);
  
  // Fetch today's stats
  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API_URL}/asistencia/today-stats`);
      setTodayStats(res.data);
    } catch {
      // El indicador conserva el último valor válido si el servicio no responde.
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch courses for filter
  useEffect(() => {
    axios.get(`${API_URL}/courses`).then(r => setCourses(r.data || [])).catch(() => {});
  }, []);

  // Keep focus on input
  useEffect(() => {
    const refocus = () => {
      if (!showResults && (document.activeElement === document.body || document.activeElement === inputRef.current)) {
        inputRef.current?.focus();
      }
    };
    const interval = setInterval(refocus, 1000);
    return () => clearInterval(interval);
  }, [showResults]);

  // Auto-detect scanner inactive
  useEffect(() => {
    if (manualOverride) return;
    const interval = setInterval(() => {
      if (Date.now() - lastScannerDetection.current > 15000) {
        setScannerActive(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [manualOverride]);

  const resetState = useCallback(() => {
    setInputValue('');
    setStudent(null);
    setError('');
    setSuccessMsg('');
    setAlreadyRegistered(false);
    setStatusRegistrado('');
    setRestricciones([]);
    setSearchResults([]);
    setShowResults(false);
    setSelectedIndex(-1);
    setPendingRegistration(null);
    clearTimeout(pendingTimer.current);
    keystrokeTimestamps.current = [];
    inputRef.current?.focus();
  }, []);

  // Auto-reset after feedback
  useEffect(() => {
    if (successMsg || error || (alreadyRegistered && !successMsg)) {
      autoResetTimer.current = setTimeout(resetState, 4500);
    }
    return () => clearTimeout(autoResetTimer.current);
  }, [successMsg, error, alreadyRegistered, resetState]);

  const isScannerInput = () => {
    const stamps = keystrokeTimestamps.current;
    if (stamps.length < 3) return false;
    let totalGap = 0;
    for (let i = 1; i < stamps.length; i++) {
      totalGap += stamps[i] - stamps[i - 1];
    }
    const avgGap = totalGap / (stamps.length - 1);
    return avgGap < scannerThreshold;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (pendingRegistration) {
        clearTimeout(pendingTimer.current);
        setPendingRegistration(null);
        setStudent(null);
        setLoading(false);
        isProcessing.current = false;
        inputRef.current?.focus();
        return;
      }
      resetState();
      return;
    }
    
    if (showResults && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const next = Math.min(prev + 1, searchResults.length - 1);
          searchResultRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const next = Math.max(prev - 1, -1);
          if (next >= 0) searchResultRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
        return;
      }
    }
    
    keystrokeTimestamps.current.push(Date.now());
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setSelectedIndex(-1);
    
    if (val.trim().length > 0) {
      clearTimeout(autoResetTimer.current);
      setSuccessMsg('');
      setError('');
      setAlreadyRegistered(false);
      setStatusRegistrado('');
      setRestricciones([]);
      setStudent(null);
    }
    
    clearTimeout(searchDebounce.current);
    
    if (val.trim().length >= 2) {
      searchDebounce.current = setTimeout(async () => {
        if (!isScannerInput() && val.trim().length >= 2) {
          try {
            const res = await axios.get(`${API_URL}/students/search`, { params: { q: val.trim() } });
            setSearchResults(res.data);
            setShowResults(res.data.length > 0);
          } catch { setSearchResults([]); setShowResults(false); }
        }
      }, 350);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isOffline) return;
    const value = inputValue.trim();
    if (!value) return;
    
    // Commit pending registration immediately when a new scan/submission is detected
    if (pendingRegistration) {
      clearTimeout(pendingTimer.current);
      const currentPending = pendingRegistration;
      setPendingRegistration(null);
      isProcessing.current = false;
      await registerAttendance(currentPending.student, currentPending.calculatedStatus);
    }
    
    if (isProcessing.current) return;
    
    clearTimeout(searchDebounce.current);
    
    if (showResults && selectedIndex >= 0 && searchResults[selectedIndex]) {
      await handleSelectStudent(searchResults[selectedIndex]);
      return;
    }
    
    const wasScanner = isScannerInput();
    
    if (wasScanner) {
      if (!manualOverride) setScannerActive(true);
      lastScannerDetection.current = Date.now();
      setShowResults(false);
      setSearchResults([]);
      await scanByBarcode(value);
    } else {
      setShowResults(false);
      try {
        setLoading(true);
        const res = await axios.get(`${API_URL}/students/search`, { params: { q: value } });
        if (res.data.length === 1) {
          await handleSelectStudent(res.data[0]);
        } else if (res.data.length > 1) {
          setSearchResults(res.data);
          setShowResults(true);
          setLoading(false);
        } else {
          setError('No se encontraron miembros con esa búsqueda.');
          playBeep('error');
          setInputValue('');
          setLoading(false);
        }
      } catch {
        setError('Error de conexión con el servidor.');
        playBeep('error');
        setLoading(false);
      }
    }
    
    keystrokeTimestamps.current = [];
  };

  // Flujo escáner: buscar → mostrar confirmación 1.5s → registrar automáticamente
  const scanByBarcode = async (barcode) => {
    if (isOffline) return;
    if (isProcessing.current) return;
    isProcessing.current = true;

    setInputValue('');
    setLoading(true);
    setError('');
    setSuccessMsg('');
    setStudent(null);
    setAlreadyRegistered(false);
    setStatusRegistrado('');
    setRestricciones([]);

    try {
      const res = await axios.get(`${API_URL}/students/scan/${encodeURIComponent(barcode)}`, {
        params: { tipo_registro: tipoRegistro }
      });
      
      const foundStudent = res.data.alumno;
      const isAlreadyReg = res.data.alreadyRegistered;
      const calculatedStatus = res.data.statusPropuesto;

      setStudent(foundStudent);
      setAlreadyRegistered(isAlreadyReg);

      if (calculatedStatus === 'Atrasado') {
        setRestricciones(['Ingreso Atrasado']);
      }

      setLoading(false);

      if (!isAlreadyReg) {
        // Confirmación antes de registrar
        setPendingRegistration({ student: foundStudent, calculatedStatus, tipoRegistro });
        pendingTimer.current = setTimeout(async () => {
          setPendingRegistration(null);
          await registerAttendance(foundStudent, calculatedStatus);
          isProcessing.current = false;
        }, 1500);
      } else {
        const horaReg = res.data.registroPrevio ? res.data.registroPrevio.hora.slice(0, 5) : '';
        setError(`Ya registrado hoy (${res.data.registroPrevio?.estado || 'Presente'} a las ${horaReg})`);
        triggerFlash('warning');
        playBeep('warning');
        isProcessing.current = false;
      }
    } catch (err) {
      if (err.response && err.response.status === 404) {
        setError('Código o RUT no encontrado en el sistema.');
      } else if (err.response && err.response.status === 403) {
        setError(err.response.data.message);
      } else {
        setError('Error de conexión con el servidor.');
      }
      triggerFlash('error');
      playBeep('error');
      setLoading(false);
      isProcessing.current = false;
    }
  };

  const handleSelectStudent = async (s) => {
    setShowResults(false);
    setSearchResults([]);
    setInputValue('');
    setSelectedIndex(-1);
    
    if (isOffline) return;
    
    // Commit pending registration immediately when selecting a student
    if (pendingRegistration) {
      clearTimeout(pendingTimer.current);
      const currentPending = pendingRegistration;
      setPendingRegistration(null);
      isProcessing.current = false;
      await registerAttendance(currentPending.student, currentPending.calculatedStatus);
    }
    
    if (isProcessing.current) return;
    isProcessing.current = true;
    
    setLoading(true);
    setError('');
    setSuccessMsg('');
    setStudent(null);
    setAlreadyRegistered(false);
    setStatusRegistrado('');
    setRestricciones([]);

    try {
      const res = await axios.get(`${API_URL}/students/${s.id_alumno}/status`, {
        params: { tipo_registro: tipoRegistro }
      });
      
      const foundStudent = res.data.alumno;
      const isAlreadyReg = res.data.alreadyRegistered;
      const calculatedStatus = res.data.statusPropuesto;

      setStudent(foundStudent);
      setAlreadyRegistered(isAlreadyReg);

      if (calculatedStatus === 'Atrasado') {
        setRestricciones(['Ingreso Atrasado']);
      }

      if (!isAlreadyReg) {
        await registerAttendance(foundStudent, calculatedStatus);
      } else {
        setError(`Ya registrado hoy.`);
        triggerFlash('warning');
        playBeep('warning');
      }
    } catch {
      setError('Error al obtener estado del miembro.');
      playBeep('error');
    } finally {
      setLoading(false);
      isProcessing.current = false;
    }
  };

  const registerAttendance = async (studentData, status) => {
    try {
      await axios.post(`${API_URL}/asistencia`, {
        id_alumno: studentData.id_alumno,
        tipo_registro: tipoRegistro
      });
      
      setSuccessMsg(`${studentData.nombres} ${studentData.paterno} — ${status}`);
      setStatusRegistrado(status);
      setAlreadyRegistered(true);
      
      // Refresh statistics
      fetchStats();
      
      if (status === 'Atrasado') {
        triggerFlash('warning');
        playBeep('warning');
      } else {
        triggerFlash('success');
        playBeep('success');
      }
    } catch (err) {
      if (err.response && err.response.status === 409) {
        setAlreadyRegistered(true);
        setError('Ya registrado hoy.');
        triggerFlash('warning');
        playBeep('warning');
      } else {
        setError('Error al registrar. Intente nuevamente.');
        triggerFlash('error');
        playBeep('error');
      }
    }
  };

  const triggerFlash = (type) => {
    if (!flashMode) return;
    const colors = { success: 'flash-green', error: 'flash-red', warning: 'flash-yellow' };
    setFlashColor(colors[type] || null);
    setTimeout(() => setFlashColor(null), 800);
  };

  const handleToggleScanner = () => {
    clearTimeout(overrideTimer.current);
    setManualOverride(true);
    setScannerActive(prev => !prev);
    overrideTimer.current = setTimeout(() => setManualOverride(false), 30000);
  };

  useEffect(() => {
    return () => {
      clearTimeout(overrideTimer.current);
      clearTimeout(pendingTimer.current);
      clearTimeout(searchDebounce.current);
    };
  }, []);

  const filteredSearchResults = filterCurso
    ? searchResults.filter(s => s.nombre_curso === filterCurso)
    : searchResults;

  // Feedback content
  const feedbackContent = (
    <>
      {pendingRegistration && (
        <div className="kiosk-feedback kiosk-pending fade-in" style={{ borderLeft: pendingRegistration.calculatedStatus === 'Atrasado' ? '6px solid #f59e0b' : '6px solid #10b981' }}>
          <div className="kiosk-pending-spinner" style={{ borderColor: pendingRegistration.calculatedStatus === 'Atrasado' ? '#f59e0b transparent transparent transparent' : '#10b981 transparent transparent transparent' }} />
          <div className="kiosk-feedback-text">
            Registrando ingreso a {pendingRegistration.student.nombres} {pendingRegistration.student.paterno}...
          </div>
          <div className="kiosk-feedback-sub" style={{ fontFamily: 'Space Mono, monospace' }}>
            {pendingRegistration.student.rut}-{pendingRegistration.student.dv} • {pendingRegistration.student.nombre_curso || 'Personal/Staff'}
          </div>
          <div className="kiosk-feedback-meal" style={{ color: pendingRegistration.calculatedStatus === 'Atrasado' ? '#f59e0b' : '#10b981', fontWeight: 'bold' }}>
            Estado: {pendingRegistration.calculatedStatus}
          </div>
        </div>
      )}

      {loading && !pendingRegistration && <div className="kiosk-feedback kiosk-loading">Procesando código...</div>}

      {successMsg && (
        <div className={`kiosk-feedback kiosk-feedback-dramatic fade-in ${statusRegistrado === 'Atrasado' ? 'kiosk-warning' : 'kiosk-success'}`}>
          <CheckCircle size={56} className="kiosk-check-anim" />
          <div className="kiosk-feedback-text">{successMsg}</div>
          {student && <div className="kiosk-feedback-sub" style={{ fontFamily: 'Space Mono, monospace' }}>{student.rut}-{student.dv} • {student.nombre_curso || 'Personal/Staff'}</div>}
          <div className="kiosk-feedback-meal" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Registro {tipoRegistro} Exitoso</div>
        </div>
      )}

      {error && (
        <div className="kiosk-feedback kiosk-error kiosk-feedback-dramatic fade-in">
          <AlertCircle size={56} className="kiosk-error-anim" />
          <div className="kiosk-feedback-text">{error}</div>
          {student && <div className="kiosk-feedback-sub" style={{ fontFamily: 'Space Mono, monospace' }}>{student.rut}-{student.dv}</div>}
        </div>
      )}

      {/* Warnings & badging */}
      {student && !error && !pendingRegistration && (
        <div className="kiosk-warnings" style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
          <div className={`kiosk-badge ${student.rol === 'Estudiante' ? 'kiosk-badge-blue' : 'kiosk-badge-orange'}`} style={{
            background: student.rol === 'Estudiante' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)',
            color: student.rol === 'Estudiante' ? '#3b82f6' : '#f59e0b',
            border: student.rol === 'Estudiante' ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(245,158,11,0.3)',
            padding: '6px 14px',
            borderRadius: '12px',
            fontWeight: '600',
            fontSize: '0.85rem'
          }}>
            Rol: {student.rol}
          </div>
          {restricciones.length > 0 && (
            <div className="kiosk-badge kiosk-badge-red fade-in" style={{
              background: 'rgba(239,68,68,0.15)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.3)',
              padding: '6px 14px',
              borderRadius: '12px',
              fontWeight: '600',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <AlertCircle size={14} /> {restricciones.join(', ')}
            </div>
          )}
        </div>
      )}
    </>
  );

  // Input/search section
  const inputSection = (
    <>
      <div 
        className={`scanner-status ${scannerActive ? 'active' : 'inactive'}`}
        onClick={isOffline ? undefined : handleToggleScanner}
        role="button"
        tabIndex={-1}
        title={isOffline ? 'Sistema fuera de línea' : scannerActive ? 'Escáner detectado — click para cambiar' : 'Sin escáner — click para cambiar'}
        style={isOffline ? { cursor: 'not-allowed', opacity: 0.6 } : {}}
      >
        <LogIn size={16} />
        <span>{isOffline ? 'Sistema fuera de línea' : scannerActive ? 'Escáner de Carnet Activo' : 'Ingreso Manual'}</span>
      </div>

      <form onSubmit={handleSubmit} className="kiosk-input-form">
        <div className="kiosk-input-wrapper">
          <Search size={20} className="kiosk-input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="kiosk-input"
            style={isOffline ? { backgroundColor: 'rgba(30,41,59,0.3)', cursor: 'not-allowed', color: '#64748b' } : {}}
            placeholder={isOffline ? 'Reconectando...' : scannerActive ? 'Acerque el código de barra al lector...' : 'Escriba RUT o Nombre...'}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={isOffline}
            autoFocus={!isOffline}
            autoComplete="off"
          />
          <button
            type="button"
            className={`kiosk-filter-btn ${showFilters ? 'active' : ''}`}
            onClick={isOffline ? undefined : () => setShowFilters(prev => !prev)}
            disabled={isOffline}
            style={isOffline ? { cursor: 'not-allowed', opacity: 0.5 } : {}}
            title="Filtros"
          >
            <Filter size={16} />
          </button>
        </div>
      </form>

      {/* Advanced filters */}
      {showFilters && (
        <div className="kiosk-filters fade-in" style={{ background: 'rgba(15,23,42,0.4)', borderRadius: '12px', padding: '12px', marginTop: '10px', border: '1px solid rgba(59,130,246,0.15)' }}>
          <div className="kiosk-filter-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GraduationCap size={15} style={{ color: '#3b82f6' }} />
            <select
              value={filterCurso}
              onChange={(e) => setFilterCurso(e.target.value)}
              className="kiosk-filter-select"
              style={{
                flex: '1',
                padding: '6px',
                background: 'rgba(15,23,42,0.6)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '8px',
                color: 'white',
                fontFamily: 'inherit',
                outline: 'none'
              }}
            >
              <option value="">Filtrar por Curso...</option>
              {courses.map(c => (
                <option key={c.id_curso} value={c.nombre_curso}>{c.nombre_curso}</option>
              ))}
            </select>
            {filterCurso && (
              <button className="kiosk-filter-clear" onClick={() => setFilterCurso('')} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search results dropdown */}
      {showResults && filteredSearchResults.length > 0 && (
        <div className="kiosk-search-results" role="listbox">
          {filteredSearchResults.map((s, idx) => (
            <div 
              key={s.id_alumno} 
              ref={el => searchResultRefs.current[idx] = el}
              className={`kiosk-search-item${idx === selectedIndex ? ' selected' : ''}`}
              onClick={() => handleSelectStudent(s)}
              role="option"
              aria-selected={idx === selectedIndex}
            >
              <User size={16} />
              <div className="kiosk-search-item-info">
                <span className="kiosk-search-name">{s.nombres} {s.paterno} {s.materno}</span>
                <span className="kiosk-search-detail" style={{ fontFamily: 'Space Mono, monospace' }}>{s.rut}-{s.dv} • {s.nombre_curso || 'Sin curso'} • {s.rol}</span>
              </div>
              <ChevronRight size={16} />
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={`kiosk-scanner ${layoutMode === 'columns' ? 'kiosk-columns' : ''}`} style={{ width: '100%' }}>
      {flashColor && <div className={`kiosk-flash-overlay ${flashColor}`} />}

      {showReconnectedBanner && (
        <div className="kiosk-reconnected-banner">
          <CheckCircle size={18} />
          <span>Conexión de red restaurada. Servidor en línea.</span>
        </div>
      )}

      {isOffline && (
        <div className="kiosk-offline-overlay">
          <div className="kiosk-offline-card">
            <AlertCircle size={48} className="kiosk-error-anim" style={{ color: '#dc2626' }} />
            <h2 className="kiosk-offline-title">Servidor Desconectado</h2>
            <p className="kiosk-offline-desc">
              Por favor, verifique la conexión de red del kiosk. Reintentando enlazar con el servidor automáticamente...
            </p>
            <div className="kiosk-offline-loader" />
          </div>
        </div>
      )}

      {/* Top bar: entry times & layout options */}
      <div className="kiosk-topbar">
        <div className="kiosk-turno-badge" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Clock size={14} />
          <span>Límite Ingreso: <strong>{asistenciaConfig.hora_limite_atraso.slice(0, 5)}</strong></span>
        </div>
        <div className="kiosk-topbar-controls">
          <button
            className={`kiosk-view-btn ${flashMode ? 'active' : ''}`}
            onClick={() => setFlashMode(prev => !prev)}
            title="Destello de pantalla"
          >
            <Sparkles size={15} />
          </button>
          <button
            className={`kiosk-view-btn ${layoutMode === 'centered' ? 'active' : ''}`}
            onClick={() => setLayoutMode('centered')}
            title="Vista centrada"
          >
            <AlignCenter size={15} />
          </button>
          <button
            className={`kiosk-view-btn ${layoutMode === 'columns' ? 'active' : ''}`}
            onClick={() => setLayoutMode('columns')}
            title="Vista dos columnas"
          >
            <Columns size={15} />
          </button>
        </div>
      </div>

      {/* Main Kiosk Area */}
      {layoutMode === 'centered' ? (
        <>
          {inputSection}
          {feedbackContent}
        </>
      ) : (
        <div className="kiosk-columns-grid">
          <div className="kiosk-col-left">
            {inputSection}
          </div>
          <div className="kiosk-col-right">
            {feedbackContent}
            {!loading && !successMsg && !error && !student && !pendingRegistration && (
              <div className="kiosk-col-empty">
                <User size={40} style={{ color: 'rgba(59,130,246,0.3)' }} />
                <span style={{ color: '#64748b' }}>Acerque la tarjeta de biblioteca para marcar...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="kiosk-stats-bar">
        <div className="kiosk-stat">
          <User size={14} />
          <span>Ingresados hoy: <strong>{todayStats.total}</strong></span>
        </div>
        <div className="kiosk-stat kiosk-stat-benef">
          <CheckCircle size={14} />
          <span>A tiempo: <strong>{todayStats.presentes}</strong></span>
        </div>
        <div className="kiosk-stat kiosk-stat-nobenef">
          <AlertCircle size={14} />
          <span>Atrasados: <strong>{todayStats.atrasados}</strong></span>
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;
