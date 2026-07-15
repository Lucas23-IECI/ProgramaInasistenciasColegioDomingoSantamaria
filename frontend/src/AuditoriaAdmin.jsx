import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { ArrowLeft, RefreshCw, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { API_URL } from './config';
const PAGE_SIZE = 20;

// ─── Catálogo de acciones auditables ──────────────────────────────────────────
const ACCIONES = [
  'LOGIN_EXITOSO',
  'LOGIN_FALLIDO',
  'LOGOUT',
  'COLACION_REGISTRADA',
  'USUARIO_CREADO',
  'USUARIO_EDITADO',
  'USUARIO_ELIMINADO',
  'IMPORTACION_ALUMNOS',
  'IMPORTACION_BENEFICIARIOS',
  'IMPORTACION_PAE',
];

const BADGE_STYLE = {
  LOGIN_EXITOSO:            { background: '#dcfce7', color: '#15803d' },
  LOGIN_FALLIDO:            { background: '#fee2e2', color: '#b91c1c' },
  LOGOUT:                   { background: '#f1f5f9', color: '#64748b' },
  COLACION_REGISTRADA:      { background: '#dbeafe', color: '#1d4ed8' },
  USUARIO_CREADO:           { background: '#ede9fe', color: '#6d28d9' },
  USUARIO_EDITADO:          { background: '#fef9c3', color: '#854d0e' },
  USUARIO_ELIMINADO:        { background: '#fee2e2', color: '#b91c1c' },
  IMPORTACION_ALUMNOS:      { background: '#ffedd5', color: '#c2410c' },
  IMPORTACION_BENEFICIARIOS:{ background: '#ffedd5', color: '#c2410c' },
  IMPORTACION_PAE:          { background: '#ffedd5', color: '#c2410c' },
};

const badgeStyle = (accion) => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '999px',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  ...(BADGE_STYLE[accion] || { background: '#e2e8f0', color: '#475569' }),
});

// ─── Formatea fecha ISO a "DD/MM/AAAA HH:MM:SS" ───────────────────────────────
const formatFecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// ─── Fila de la tabla ─────────────────────────────────────────────────────────
const AuditRow = ({ row }) => {
  const [expandido, setExpandido] = useState(false);
  const tieneDetalle = row.detalle && Object.keys(row.detalle).length > 0;

  return (
    <>
      <tr style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
        <td style={{ padding: '10px 12px', fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap' }}>
          {formatFecha(row.fecha)}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.82rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.usuario_nombre
            ? <><span style={{ display: 'block', fontWeight: 600, color: '#1e293b' }}>{row.usuario_nombre}</span><span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{row.usuario_correo}</span></>
            : row.usuario_correo || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>anónimo</span>}
        </td>
        <td style={{ padding: '10px 12px' }}>
          <span style={badgeStyle(row.accion)}>{row.accion}</span>
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.78rem', color: '#64748b' }}>
          {row.entidad && row.entidad_id ? `${row.entidad} #${row.entidad_id}` : row.entidad || '—'}
        </td>
        <td style={{ padding: '10px 12px', fontSize: '0.78rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {row.ip || '—'}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
          {tieneDetalle ? (
            <button
              onClick={() => setExpandido(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366f1', display: 'flex', alignItems: 'center', gap: 2, fontSize: '0.78rem' }}
            >
              {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expandido ? 'Ocultar' : 'Ver'}
            </button>
          ) : <span style={{ color: '#cbd5e1' }}>—</span>}
        </td>
      </tr>
      {expandido && tieneDetalle && (
        <tr style={{ background: '#f8fafc' }}>
          <td colSpan={6} style={{ padding: '0 12px 12px 12px' }}>
            <pre style={{
              margin: 0,
              fontSize: '0.75rem',
              color: '#334155',
              background: '#f1f5f9',
              borderRadius: 6,
              padding: '10px 14px',
              overflowX: 'auto',
              border: '1px solid #e2e8f0'
            }}>
              {JSON.stringify(row.detalle, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
};

// ─── Componente principal ──────────────────────────────────────────────────────
const AuditoriaAdmin = () => {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filtros
  const [filtroAccion, setFiltroAccion] = useState('');
  const [filtroCorreo, setFiltroCorreo] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');

  const fetchData = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: pg, limit: PAGE_SIZE });
      if (filtroAccion) params.set('accion', filtroAccion);
      if (filtroCorreo) params.set('usuario_correo', filtroCorreo);
      if (filtroDesde)  params.set('desde', filtroDesde);
      if (filtroHasta)  params.set('hasta', filtroHasta);

      const res = await axios.get(`${API_URL}/audit?${params}`, { withCredentials: true });
      setRows(res.data.rows);
      setTotal(res.data.total);
      setPages(res.data.pages);
      setPage(pg);
    } catch (err) {
      setError(err.response?.data?.message || 'Error al cargar auditoría.');
    } finally {
      setLoading(false);
    }
  }, [filtroAccion, filtroCorreo, filtroDesde, filtroHasta]);

  useEffect(() => {
    fetchData(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBuscar = (e) => {
    e.preventDefault();
    fetchData(1);
  };

  const handleExportExcel = () => {
    if (!rows.length) return;
    const data = rows.map(r => ({
      Fecha: formatFecha(r.fecha),
      Usuario: r.usuario_correo || '',
      Acción: r.accion,
      Entidad: r.entidad || '',
      'Entidad ID': r.entidad_id ?? '',
      IP: r.ip || '',
      Detalle: r.detalle ? JSON.stringify(r.detalle) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');
    XLSX.writeFile(wb, `auditoria_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ─── Estilos ───────────────────────────────────────────────────────────────
  const container = {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '32px 24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const card = {
    maxWidth: 1100,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
    overflow: 'hidden',
  };

  const header = {
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    padding: '24px 28px',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  };

  const btnSecondary = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 8,
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
  };

  const inputStyle = {
    padding: '7px 11px', borderRadius: 8, border: '1px solid #e2e8f0',
    fontSize: '0.83rem', color: '#1e293b', outline: 'none', background: '#f8fafc',
  };

  const btnPrimary = {
    padding: '8px 18px', borderRadius: 8,
    background: '#6366f1', border: 'none', color: '#fff',
    cursor: 'pointer', fontWeight: 600, fontSize: '0.84rem',
  };

  const thStyle = {
    padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem',
    fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.05em', background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
  };

  return (
    <div style={container}>
      <div style={card}>
        {/* Header */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button style={btnSecondary} onClick={() => navigate('/admin')}>
              <ArrowLeft size={15} /> Volver
            </button>
            <ClipboardList size={34} style={{ color: '#fff', opacity: 0.9, flexShrink: 0 }} />
            <div>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Auditoría del Sistema</h1>
              <p style={{ margin: 0, fontSize: '0.82rem', opacity: 0.7, marginTop: 2 }}>
                Historial de acciones registradas — {total} evento{total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnSecondary} onClick={() => fetchData(page)} title="Actualizar">
              <RefreshCw size={14} />
            </button>
            <button style={btnSecondary} onClick={handleExportExcel} title="Exportar Excel">
              <Download size={14} /> Excel
            </button>
          </div>
        </div>

        {/* Filtros */}
        <form onSubmit={handleBuscar} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '16px 20px', borderBottom: '1px solid #f1f5f9', background: '#fafbfc', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600 }}>Tipo de acción</label>
            <select value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)} style={inputStyle}>
              <option value="">Todas</option>
              {ACCIONES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600 }}>Usuario</label>
            <input value={filtroCorreo} onChange={e => setFiltroCorreo(e.target.value)} placeholder="Buscar por correo" style={{ ...inputStyle, width: 190 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600 }}>Desde</label>
            <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 600 }}>Hasta</label>
            <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={inputStyle} />
          </div>
          <button type="submit" style={btnPrimary}>Buscar</button>
          <button type="button" style={{ ...btnPrimary, background: '#e2e8f0', color: '#475569' }}
            onClick={() => { setFiltroAccion(''); setFiltroCorreo(''); setFiltroDesde(''); setFiltroHasta(''); setTimeout(() => fetchData(1), 0); }}>
            Limpiar
          </button>
        </form>

        {/* Tabla */}
        <div style={{ overflowX: 'auto' }}>
          {error && (
            <div style={{ padding: '16px 20px', color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>
          )}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Cargando...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
              No hay eventos registrados para los filtros seleccionados.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Fecha / Hora</th>
                  <th style={thStyle}>Usuario</th>
                  <th style={thStyle}>Acción</th>
                  <th style={thStyle}>Entidad</th>
                  <th style={thStyle}>IP</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => <AuditRow key={row.id} row={row} />)}
              </tbody>
            </table>
          )}
        </div>

        {/* Paginación */}
        {pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 20px', borderTop: '1px solid #f1f5f9' }}>
            <button
              disabled={page <= 1}
              onClick={() => fetchData(page - 1)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: page <= 1 ? '#f8fafc' : '#fff', color: page <= 1 ? '#cbd5e1' : '#1e293b', cursor: page <= 1 ? 'default' : 'pointer', fontSize: '0.83rem', fontWeight: 500 }}
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span style={{ fontSize: '0.83rem', color: '#64748b' }}>Página {page} de {pages}</span>
            <button
              disabled={page >= pages}
              onClick={() => fetchData(page + 1)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: page >= pages ? '#f8fafc' : '#fff', color: page >= pages ? '#cbd5e1' : '#1e293b', cursor: page >= pages ? 'default' : 'pointer', fontSize: '0.83rem', fontWeight: 500 }}
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditoriaAdmin;
