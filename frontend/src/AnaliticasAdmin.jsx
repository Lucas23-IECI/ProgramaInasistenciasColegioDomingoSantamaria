import React, { useCallback, useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from './context/AuthContext';
import {
  LogOut, Clock, TrendingUp, BarChart2, PieChart, Activity,
  Percent, Users, ShieldCheck, CheckCircle, ArrowLeft, Download,
  Calendar, ShieldAlert
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';

/* ═══════════════════ SVG CHART COMPONENTS ═══════════════════ */

const JustifiedDonutChart = ({ justified = 0, unjustified = 0, colorJustified = 'var(--secondary)', colorUnjustified = '#ef4444' }) => {
  const total = justified + unjustified;
  const pctJust = total > 0 ? (justified / total) * 100 : 0;
  const pctUnjust = total > 0 ? (unjustified / total) * 100 : 100;

  const radius = 55;
  const circumference = 2 * Math.PI * radius;

  const strokeJust = (pctJust / 100) * circumference;
  const strokeUnjust = (pctUnjust / 100) * circumference;

  const offsetJust = 0;
  const offsetUnjust = strokeJust;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>
      <svg className="donut-chart-svg" viewBox="0 0 160 160" style={{ maxWidth: '140px', maxHeight: '140px' }}>
        <circle cx="80" cy="80" r={radius} fill="transparent" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
        {pctJust > 0 && (
          <circle
            cx="80" cy="80" r={radius} fill="transparent"
            stroke={colorJustified} strokeWidth="12"
            strokeDasharray={`${strokeJust} ${circumference - strokeJust}`}
            strokeDashoffset={-offsetJust}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease-in-out', transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        )}
        {pctUnjust > 0 && (
          <circle
            cx="80" cy="80" r={radius} fill="transparent"
            stroke={colorUnjustified} strokeWidth="12"
            strokeDasharray={`${strokeUnjust} ${circumference - strokeUnjust}`}
            strokeDashoffset={-offsetUnjust}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease-in-out', transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        )}
        <text x="80" y="76" textAnchor="middle" fill="var(--text-dark)" fontSize="1.2rem" fontWeight="800">
          {total > 0 ? pctJust.toFixed(1) + '%' : '0%'}
        </text>
        <text x="80" y="94" textAnchor="middle" fill="var(--text-light)" fontSize="0.65rem" fontWeight="600" letterSpacing="0.05em">
          JUSTIFICADO
        </text>
      </svg>

      <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', justifyContent: 'center', flexWrap: 'wrap', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorJustified }}></span>
          <span style={{ color: 'var(--text-light)' }}>Justificados: {justified} ({pctJust.toFixed(0)}%)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorUnjustified }}></span>
          <span style={{ color: 'var(--text-light)' }}>Sin Justificar: {unjustified} ({pctUnjust.toFixed(0)}%)</span>
        </div>
      </div>
    </div>
  );
};

const getRangeDates = (periodType) => {
  const hasta = new Date();
  const desde = new Date();
  switch (periodType) {
    case 'semana': desde.setDate(hasta.getDate() - 7); break;
    case 'mes': desde.setDate(hasta.getDate() - 30); break;
    case 'trimestre': desde.setDate(hasta.getDate() - 90); break;
    case 'semestre': desde.setDate(hasta.getDate() - 180); break;
    case 'ano': desde.setDate(hasta.getDate() - 365); break;
    default: desde.setDate(hasta.getDate() - 7);
  }
  const fmt = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { desde: fmt(desde), hasta: fmt(hasta) };
};

const SVGLineChart = ({ data = [], color = 'var(--primary)', label = 'Registros' }) => {
  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
        Sin registros en este período.
      </div>
    );
  }
  const width = 500, height = 200, padding = 30;
  const maxCount = Math.max(...data.map(d => parseInt(d.count, 10)), 5);

  const points = data.map((d, index) => {
    const x = padding + (index / Math.max(1, data.length - 1)) * (width - 2 * padding);
    const y = height - padding - (parseInt(d.count, 10) / maxCount) * (height - 2 * padding);
    return { x, y, date: d.fecha || d.date, count: parseInt(d.count, 10) };
  });

  const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const formatLabelDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${parts[2]} ${months[parseInt(parts[1], 10) - 1]}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
      <svg className="line-chart-svg" viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = padding + ratio * (height - 2 * padding);
          const val = Math.round(maxCount * (1 - ratio));
          return (
            <g key={i}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <text x={padding - 8} y={y + 4} textAnchor="end" fill="var(--text-light)" fontSize="10">{val}</text>
            </g>
          );
        })}

        {linePath && (
          <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {points.map((p, idx) => (
          <g key={idx}>
            <circle cx={p.x} cy={p.y} r="3.5" fill={color} stroke="var(--bg-card, #0b1329)" strokeWidth="1.2" />
            <circle cx={p.x} cy={p.y} r="12" fill="transparent" style={{ cursor: 'pointer' }} />
            <title>{`${formatLabelDate(p.date)}\n${label}: ${p.count}`}</title>
          </g>
        ))}

        {data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1].map((idx) => {
          if (idx >= data.length || idx < 0) return null;
          const p = points[idx];
          return (
            <text key={idx} x={p.x} y={height - padding + 16}
              textAnchor={idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle'}
              fill="var(--text-light)" fontSize="10">
              {formatLabelDate(p.date)}
            </text>
          );
        })}
      </svg>

      <div style={{ display: 'flex', gap: '6px', fontSize: '0.72rem', justifyContent: 'center', width: '100%', alignItems: 'center' }}>
        <span style={{ width: 12, height: 3, background: color, display: 'inline-block' }}></span>
        <span style={{ color: 'var(--text-light)' }}>{label}</span>
      </div>
    </div>
  );
};

const CourseBarChart = ({ data = [], label = 'registro(s)', color = 'var(--primary)' }) => {
  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-light)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0', width: '100%' }}>
        Sin registros por curso.
      </div>
    );
  }
  const maxCount = Math.max(...data.map(d => parseInt(d.count, 10)), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', padding: '4px' }}>
      {data.slice(0, 6).map((d, idx) => {
        const count = parseInt(d.count, 10);
        const pct = (count / maxCount) * 100;
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-dark)', fontWeight: 500 }}>
              <span>{d.curso || 'Sin Curso'}</span>
              <strong style={{ color: 'var(--primary)' }}>{count} {label}</strong>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.8s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TimeSlotBarChart = ({ data = [] }) => {
  const defaultSlots = [
    { slot: '08:15 - 08:20', label: '08:15-20' },
    { slot: '08:21 - 08:25', label: '08:21-25' },
    { slot: '08:26 - 08:30', label: '08:26-30' },
    { slot: '08:31 - 08:40', label: '08:31-40' },
    { slot: 'Después 08:40', label: '> 08:40' }
  ];

  const slotMap = {};
  data.forEach(d => { slotMap[d.slot] = parseInt(d.count, 10); });
  const mergedData = defaultSlots.map(s => ({ label: s.label, count: slotMap[s.slot] || 0 }));
  const maxCount = Math.max(...mergedData.map(d => d.count), 1);

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: '180px', width: '100%', padding: '0 10px' }}>
      {mergedData.map((d, idx) => {
        const pct = (d.count / maxCount) * 120;
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flex: 1 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: d.count > 0 ? 'var(--primary)' : 'var(--text-light)' }}>
              {d.count}
            </div>
            <div style={{
              width: '20px', height: `${Math.max(4, pct)}px`,
              background: d.label.includes('>') ? '#ef4444' : 'var(--primary)',
              borderRadius: '4px 4px 0 0', transition: 'height 0.8s ease'
            }} />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-light)', textAlign: 'center', lineHeight: 1.1 }}>
              {d.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ═══════════════════ MAIN COMPONENT ═══════════════════ */

const AnaliticasAdmin = () => {
  const [period, setPeriod] = useState('semana');
  const [subTab, setSubTab] = useState('atrasos'); // 'atrasos' | 'inasistencias'
  const [courses, setCourses] = useState([]);
  const [selectedCurso, setSelectedCurso] = useState('');
  const [selectedJustificado, setSelectedJustificado] = useState('');
  const [selectedSeveridad, setSelectedSeveridad] = useState('');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const { logout, user } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const res = await axios.get(`${API_URL}/courses`, { withCredentials: true });
        setCourses(res.data);
      } catch (err) {
        console.error("Error al obtener cursos", err);
      }
    };
    fetchCourses();
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    const { desde, hasta } = getRangeDates(period);
    try {
      const res = await axios.get(`${API_URL}/asistencia/range-stats`, {
        params: {
          desde,
          hasta,
          id_curso: selectedCurso,
          justificado: selectedJustificado,
          severidad: selectedSeveridad
        },
        withCredentials: true
      });
      setAnalyticsData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAnalytics(false);
    }
  }, [period, selectedCurso, selectedJustificado, selectedSeveridad]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const formatLabelDate = (dateStr) => {
    if (!dateStr) return 'N/D';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${parts[2]} ${months[parseInt(parts[1], 10) - 1]}`;
  };

  const periodIdx = { semana: 0, mes: 1, trimestre: 2, semestre: 3, ano: 4 };

  return (
    <div className="admin-dashboard fade-in">
      <div className="glass-panel" style={{ padding: '2rem' }}>

        <ModuleHeader
          icon={BarChart2}
          title="Estadísticas"
          description={`Indicadores institucionales de asistencia · ${user?.rol === 'admin' ? 'Administrador' : 'Secretaría'}`}
          onBack={() => navigate('/admin')}
          onLogout={handleLogout}
        >
          <button type="button" onClick={() => window.print()} className="module-header__button">
            <Download size={15} /> Exportar PDF
          </button>
        </ModuleHeader>

        {/* Sub-tab segmented control for Atrasos vs Inasistencias */}
        <div className="dashboard-tabs" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)' }}>
          <button
            type="button"
            className={`dashboard-tab ${subTab === 'atrasos' ? 'active' : ''}`}
            onClick={() => setSubTab('atrasos')}
            style={{ fontSize: '0.95rem', fontWeight: 700, padding: '10px 20px', cursor: 'pointer' }}
          >
            <Clock size={16} /> Estadísticas de atrasos
          </button>
          <button
            type="button"
            className={`dashboard-tab ${subTab === 'inasistencias' ? 'active' : ''}`}
            onClick={() => setSubTab('inasistencias')}
            style={{ fontSize: '0.95rem', fontWeight: 700, padding: '10px 20px', cursor: 'pointer' }}
          >
            <Calendar size={16} /> Estadísticas de inasistencias
          </button>
        </div>

        {/* Segmented Period Slider */}
        <div className="segmented-control">
          <div
            className="segmented-control__slider"
            style={{
              width: 'calc(20% - 8px)',
              transform: `translateX(calc(${(periodIdx[period] || 0) * 100}% + ${(periodIdx[period] || 0) * 8}px))`
            }}
          />
          <button className={`segmented-control__option ${period === 'semana' ? 'active' : ''}`} onClick={() => setPeriod('semana')}>Semana</button>
          <button className={`segmented-control__option ${period === 'mes' ? 'active' : ''}`} onClick={() => setPeriod('mes')}>Mes</button>
          <button className={`segmented-control__option ${period === 'trimestre' ? 'active' : ''}`} onClick={() => setPeriod('trimestre')}>Trimestre</button>
          <button className={`segmented-control__option ${period === 'semestre' ? 'active' : ''}`} onClick={() => setPeriod('semestre')}>Semestre</button>
          <button className={`segmented-control__option ${period === 'ano' ? 'active' : ''}`} onClick={() => setPeriod('ano')}>Año</button>
        </div>

        {/* Interactive Filters Panel */}
        <div className="analytics-filter-bar" style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', margin: '20px 0', padding: '12px', background: 'rgba(59, 130, 246, 0.04)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.08)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '150px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-light)' }}>Curso</label>
            <select
              value={selectedCurso}
              onChange={(e) => setSelectedCurso(e.target.value)}
              className="analytics-select-input"
              style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', background: 'var(--glass-bg)', color: 'var(--text-dark)', fontSize: '0.82rem', outline: 'none' }}
            >
              <option value="">Todos los Cursos</option>
              {courses.map(c => (
                <option key={c.id_curso} value={c.id_curso}>{c.nombre_curso}</option>
              ))}
            </select>
          </div>

          {subTab === 'atrasos' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '150px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-light)' }}>Justificación</label>
                <select
                  value={selectedJustificado}
                  onChange={(e) => setSelectedJustificado(e.target.value)}
                  className="analytics-select-input"
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', background: 'var(--glass-bg)', color: 'var(--text-dark)', fontSize: '0.82rem', outline: 'none' }}
                >
                  <option value="">Todas las marcas</option>
                  <option value="false">Solo Sin Justificar</option>
                  <option value="true">Solo Justificados</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '150px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-light)' }}>Severidad</label>
                <select
                  value={selectedSeveridad}
                  onChange={(e) => setSelectedSeveridad(e.target.value)}
                  className="analytics-select-input"
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', background: 'var(--glass-bg)', color: 'var(--text-dark)', fontSize: '0.82rem', outline: 'none' }}
                >
                  <option value="">Todas las severidades</option>
                  <option value="Leve">Solo Atrasos Leves</option>
                  <option value="Grave">Solo Atrasos Graves</option>
                </select>
              </div>
            </>
          )}
        </div>

        {loadingAnalytics ? (
          <div className="loader" style={{ margin: '4rem auto' }}>Cargando analíticas...</div>
        ) : (
          <div className="fade-in" style={{ marginTop: '1.5rem' }}>

            {subTab === 'atrasos' ? (
              <>
                {/* KPI Cards Atrasos */}
                <div className="analytics-metrics-grid">
                  <div className="stat-card" style={{ '--card-accent': '#10b981' }}>
                    <div className="stat-card__icon" style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.1)' }}><Percent size={20} /></div>
                    <div className="stat-card__value" style={{ color: '#10b981' }}>
                      {analyticsData ? (
                        (analyticsData.totalPresentes / Math.max(1, analyticsData.totalPresentes + analyticsData.totalAtrasados) * 100).toFixed(1) + '%'
                      ) : '100%'}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Puntualidad General</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': 'var(--primary)' }}>
                    <div className="stat-card__icon" style={{ color: 'var(--primary)', background: 'rgba(59, 130, 246, 0.1)' }}><Clock size={20} /></div>
                    <div className="stat-card__value" style={{ color: 'var(--primary)' }}>{analyticsData?.totalAtrasados || 0}</div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Total Atrasos</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': 'var(--secondary)' }}>
                    <div className="stat-card__icon" style={{ color: 'var(--secondary)', background: 'rgba(16, 185, 129, 0.1)' }}><CheckCircle size={20} /></div>
                    <div className="stat-card__value" style={{ color: 'var(--secondary)' }}>{analyticsData?.totalAtrasadosJustificados || 0}</div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Atrasos Justificados</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': '#8b5cf6' }}>
                    <div className="stat-card__icon" style={{ color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.1)' }}><Users size={20} /></div>
                    <div className="stat-card__value" style={{ fontSize: '1.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#8b5cf6' }} title={analyticsData?.courseLate?.[0]?.curso || 'N/D'}>
                      {analyticsData?.courseLate?.[0]?.curso || 'N/D'}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Peor Curso</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': '#f59e0b' }}>
                    <div className="stat-card__icon" style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}><TrendingUp size={20} /></div>
                    <div className="stat-card__value" style={{ fontSize: '1rem', color: '#f59e0b' }}>
                      {analyticsData?.dailyLate?.length > 0
                        ? formatLabelDate([...analyticsData.dailyLate].sort((a,b) => b.count - a.count)[0]?.fecha)
                        : 'N/D'}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Día Pico Atrasos</div>
                  </div>
                </div>

                {/* Charts Grid Atrasos */}
                <div className="analytics-charts-grid">
                  <div className="chart-card chart-card--full">
                    <div className="chart-card__title"><Activity size={16} /> Frecuencia Diaria de Atrasos</div>
                    <div className="chart-container">
                      <SVGLineChart data={analyticsData?.dailyLate} color="var(--primary)" label="Atrasos" />
                    </div>
                  </div>

                  <div className="chart-card">
                    <div className="chart-card__title"><PieChart size={16} /> Proporción de Atrasos Justificados</div>
                    <div className="chart-container">
                      <JustifiedDonutChart
                        justified={analyticsData?.totalAtrasadosJustificados || 0}
                        unjustified={(analyticsData?.totalAtrasados || 0) - (analyticsData?.totalAtrasadosJustificados || 0)}
                        label="Atrasos"
                        colorJustified="var(--secondary)"
                        colorUnjustified="#f59e0b"
                      />
                    </div>
                  </div>

                  <div className="chart-card">
                    <div className="chart-card__title"><BarChart2 size={16} /> Peores Cursos (Atrasos)</div>
                    <div className="chart-container">
                      <CourseBarChart data={analyticsData?.courseLate} label="atraso(s)" color="var(--primary)" />
                    </div>
                  </div>

                  <div className="chart-card chart-card--full">
                    <div className="chart-card__title"><Clock size={16} /> Distribución por Rango Horario de Atrasos</div>
                    <div className="chart-container">
                      <TimeSlotBarChart data={analyticsData?.slotLate} />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* KPI Cards Inasistencias */}
                <div className="analytics-metrics-grid">
                  <div className="stat-card" style={{ '--card-accent': 'var(--secondary)' }}>
                    <div className="stat-card__icon" style={{ color: 'var(--secondary)', background: 'rgba(16, 185, 129, 0.1)' }}><Percent size={20} /></div>
                    <div className="stat-card__value" style={{ color: 'var(--secondary)' }}>
                      {analyticsData ? (
                        (() => {
                          const totalMatriculaDias = (analyticsData.totalAlumnos || 0) * (analyticsData.diasActivos || 1);
                          const totalInas = (analyticsData.totalInasistencias || 0) + (analyticsData.totalJustificados || 0);
                          return totalMatriculaDias > 0
                            ? ((totalMatriculaDias - totalInas) / totalMatriculaDias * 100).toFixed(1) + '%'
                            : '100%';
                        })()
                      ) : '100%'}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Asistencia General</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': '#ef4444' }}>
                    <div className="stat-card__icon" style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}><ShieldAlert size={20} /></div>
                    <div className="stat-card__value" style={{ color: '#ef4444' }}>
                      {(analyticsData?.totalInasistencias || 0) + (analyticsData?.totalJustificados || 0)}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Total Inasistencias</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': 'var(--primary)' }}>
                    <div className="stat-card__icon" style={{ color: 'var(--primary)', background: 'rgba(59, 130, 246, 0.1)' }}><CheckCircle size={20} /></div>
                    <div className="stat-card__value" style={{ color: 'var(--primary)' }}>{analyticsData?.totalJustificados || 0}</div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Inasistencias Justificadas</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': '#8b5cf6' }}>
                    <div className="stat-card__icon" style={{ color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.1)' }}><Users size={20} /></div>
                    <div className="stat-card__value" style={{ fontSize: '1.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#8b5cf6' }} title={analyticsData?.courseAbsences?.[0]?.curso || 'N/D'}>
                      {analyticsData?.courseAbsences?.[0]?.curso || 'N/D'}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Peor Curso Abs.</div>
                  </div>
                  <div className="stat-card" style={{ '--card-accent': '#f59e0b' }}>
                    <div className="stat-card__icon" style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}><TrendingUp size={20} /></div>
                    <div className="stat-card__value" style={{ fontSize: '1rem', color: '#f59e0b' }}>
                      {analyticsData?.dailyAbsences?.length > 0
                        ? formatLabelDate([...analyticsData.dailyAbsences].sort((a,b) => b.count - a.count)[0]?.fecha)
                        : 'N/D'}
                    </div>
                    <div className="stat-card__label" style={{ fontSize: '0.78rem' }}>Día Pico Ausencias</div>
                  </div>
                </div>

                {/* Charts Grid Inasistencias */}
                <div className="analytics-charts-grid">
                  <div className="chart-card chart-card--full">
                    <div className="chart-card__title"><Activity size={16} /> Frecuencia Diaria de Inasistencias</div>
                    <div className="chart-container">
                      <SVGLineChart data={analyticsData?.dailyAbsences} color="#ef4444" label="Inasistencias" />
                    </div>
                  </div>

                  <div className="chart-card">
                    <div className="chart-card__title"><PieChart size={16} /> Proporción de Inasistencias Justificadas</div>
                    <div className="chart-container">
                      <JustifiedDonutChart
                        justified={analyticsData?.totalJustificados || 0}
                        unjustified={analyticsData?.totalInasistencias || 0}
                        label="Inasistencias"
                        colorJustified="var(--secondary)"
                        colorUnjustified="#ef4444"
                      />
                    </div>
                  </div>

                  <div className="chart-card">
                    <div className="chart-card__title"><BarChart2 size={16} /> Cursos con Más Inasistencias</div>
                    <div className="chart-container">
                      <CourseBarChart data={analyticsData?.courseAbsences} label="ausencia(s)" color="#ef4444" />
                    </div>
                  </div>
                </div>
              </>
            )}

          </div>
        )}

      </div>
    </div>
  );
};

export default AnaliticasAdmin;
