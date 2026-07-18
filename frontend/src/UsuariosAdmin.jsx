import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { UserCog, Plus, UserX, UserCheck, Pencil, X, Check, KeyRound } from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import { useFeedback } from './context/FeedbackContext';
import AppSelect from './components/AppSelect';

const ROLES = [
  { value: 'admin', label: 'Administrador' },
  { value: 'secretaria', label: 'Secretaría / Inspectoría' },
  { value: 'lector', label: 'Lector (Kiosco)' },
];

const ROL_BADGE = {
  admin: { label: 'Admin', color: '#1C4D73', bg: 'rgba(40,97,140,0.12)' },
  secretaria: { label: 'Secretaría', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  lector: { label: 'Lector', color: '#B45309', bg: 'rgba(180,83,9,0.1)' },
};

const emptyForm = { nombre: '', correo: '', password: '', rol: 'lector' };

const labelStyle = { fontSize: '0.9rem', color: '#4B5563', fontWeight: 700, display: 'block', marginBottom: '7px' };
const inputStyle = { width: '100%', minHeight: '46px', padding: '10px 13px', borderRadius: '7px', border: '1.5px solid rgba(0,0,0,0.18)', fontSize: '1rem', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s' };

const UserFormPanel = ({ form, setForm, formMode, saving, handleSave, closeForm, formError }) => (
  <div className="user-form-panel">
    <div className="user-form-grid">
      <div>
        <label style={labelStyle}>Nombre <span style={{ fontWeight: 400, opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span></label>
        <input type="text" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: María González" style={inputStyle}
          onFocus={e => e.target.style.borderColor = '#28618C'} onBlur={e => e.target.style.borderColor = 'rgba(0,0,0,0.12)'} />
      </div>
      <div style={{ gridColumn: '2 / -1' }}>
        <label style={labelStyle}>Correo electrónico</label>
        <input type="email" value={form.correo} onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} placeholder="usuario@ldsm.local" style={inputStyle}
          onFocus={e => e.target.style.borderColor = '#28618C'} onBlur={e => e.target.style.borderColor = 'rgba(0,0,0,0.12)'} />
      </div>
      <div>
        <label style={labelStyle}>Contraseña {formMode !== 'crear' && <span style={{ fontWeight: 400, opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>(vacío = no cambia)</span>}</label>
        <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={formMode === 'crear' ? 'Mínimo 12 caracteres' : 'Dejar vacío para conservar'} style={inputStyle}
          autoComplete="new-password"
          onFocus={e => e.target.style.borderColor = '#28618C'} onBlur={e => e.target.style.borderColor = 'rgba(0,0,0,0.12)'} />
      </div>
      <div>
        <label style={labelStyle}>Rol</label>
        <AppSelect ariaLabel="Rol del usuario" value={form.rol} onChange={(rol) => setForm((current) => ({ ...current, rol }))} options={ROLES} />
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'flex-end', paddingBottom: '1px' }}>
        <button onClick={closeForm} disabled={saving} style={{ background: 'rgba(0,0,0,0.07)', color: '#374151', border: 'none', borderRadius: '8px', padding: '9px 14px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <X size={13} /> Cancelar
        </button>
        <button onClick={handleSave} disabled={saving} style={{ background: '#14283B', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 16px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', opacity: saving ? 0.7 : 1 }}>
          <Check size={13} /> {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
    {formError && <p style={{ color: '#DC2626', fontSize: '0.8rem', margin: '10px 0 0', background: 'rgba(220,38,38,0.07)', padding: '6px 12px', borderRadius: '6px', borderLeft: '3px solid #DC2626' }}>{formError}</p>}
  </div>
);

const UsuariosAdmin = () => {
  const { user, logout, refreshUser } = useContext(AuthContext);
  const { notify } = useFeedback();
  const navigate = useNavigate();

  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usuPage, setUsuPage] = useState(1);
  const USU_PAGE_SIZE = 10;

  // Formulario: null = cerrado, 'crear' | id = modo
  const [formMode, setFormMode] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Confirmación de borrado
  const [confirmDelete, setConfirmDelete] = useState(null); // id a borrar

  const fetchUsuarios = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/users`, { withCredentials: true });
      setUsuarios(res.data);
    } catch {
      setError('No se pudo cargar la lista de usuarios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsuarios(); }, []);

  const openCrear = () => {
    setForm(emptyForm);
    setFormError('');
    setFormMode('crear');
  };

  const openEditar = (u) => {
    setForm({ nombre: u.nombre || '', correo: u.correo, password: '', rol: u.rol });
    setFormError('');
    setFormMode(u.id);
  };

  const closeForm = () => { setFormMode(null); setFormError(''); };

  const handleSave = async () => {
    setFormError('');
    if (!form.correo.trim()) return setFormError('El correo es obligatorio.');
    if (formMode === 'crear' && !form.password) return setFormError('La contraseña es obligatoria al crear.');
    if (form.password && form.password.length < 12) return setFormError('La contraseña debe tener al menos 12 caracteres.');
    if (form.password && (!/[a-záéíóúñ]/.test(form.password) || !/[A-ZÁÉÍÓÚÑ]/.test(form.password) || !/\d/.test(form.password))) {
      return setFormError('Incluya mayúsculas, minúsculas y al menos un número.');
    }

    setSaving(true);
    try {
      if (formMode === 'crear') {
        await axios.post(`${API_URL}/users`, form, { withCredentials: true });
        notify('Cuenta creada. La contraseña deberá cambiarse en el primer ingreso.', 'success');
      } else {
        const payload = { correo: form.correo, rol: form.rol, nombre: form.nombre };
        if (form.password) payload.password = form.password;
        await axios.put(`${API_URL}/users/${formMode}`, payload, { withCredentials: true });
        if (formMode === user?.id) await refreshUser();
        notify(form.password ? 'Cuenta actualizada con una nueva contraseña temporal.' : 'Cuenta actualizada.', 'success');
      }
      closeForm();
      setUsuPage(1);
      fetchUsuarios();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id, activo) => {
    try {
      await axios.patch(`${API_URL}/users/${id}/status`, { activo }, { withCredentials: true });
      setConfirmDelete(null);
      setUsuPage(1);
      fetchUsuarios();
      notify(activo ? 'Cuenta activada.' : 'Cuenta desactivada.', 'success');
    } catch (err) {
      notify(err.response?.data?.message || 'No fue posible cambiar el estado de la cuenta.', 'error');
    }
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const getInitials = (u) => {
    if (u.nombre && u.nombre.trim()) {
      const parts = u.nombre.trim().split(' ');
      return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
    }
    return u.correo.slice(0, 2).toUpperCase();
  };

  const COL = 'minmax(240px, 1fr) 130px 120px 110px 210px';

  return (
    <div className="app-container">
      <div className="glass-panel">

        <ModuleHeader
          icon={UserCog}
          title="Usuarios y permisos"
          description="Administración de cuentas, perfiles y accesos al sistema."
          onBack={() => navigate('/admin')}
          onLogout={handleLogout}
        />

        {/* Panel crear nuevo (sólo cuando formMode === 'crear') */}
        {formMode === 'crear' && (
          <UserFormPanel
            form={form}
            setForm={setForm}
            formMode={formMode}
            saving={saving}
            handleSave={handleSave}
            closeForm={closeForm}
            formError={formError}
          />
        )}

        {/* Barra */}
        <div className="users-toolbar" style={{ marginTop: formMode === 'crear' ? '1rem' : 0 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', fontWeight: 500 }}>
            {!loading && !error && `${usuarios.length} usuario${usuarios.length !== 1 ? 's' : ''}`}
          </span>
          <button className="users-primary-action" onClick={openCrear}>
            <Plus size={15} /> Nuevo Usuario
          </button>
        </div>

        {/* Tabla */}
        {loading ? (
          <div className="loader">Cargando...</div>
        ) : error ? (
          <p style={{ color: '#DC2626', textAlign: 'center', padding: '2rem' }}>{error}</p>
        ) : (
          <div className="users-table-shell" data-tour="users-list" style={{ overflow: 'auto' }}>
            {/* Cabecera */}
            <div className="users-table-grid users-table-grid--head" style={{ display: 'grid', gridTemplateColumns: COL, padding: '12px 16px', borderBottom: '1.5px solid rgba(0,0,0,0.07)' }}>
              {[['Usuario', 'left'], ['Rol', 'left'], ['Estado', 'left'], ['Creado', 'left'], ['Acciones', 'right']].map(([h, align]) => (
                <span key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: align }}>{h}</span>
              ))}
            </div>

            {/* Filas */}
            {usuarios.slice((usuPage - 1) * USU_PAGE_SIZE, usuPage * USU_PAGE_SIZE).map((u, idx) => {
              const badge = ROL_BADGE[u.rol] || { label: u.rol, color: '#666', bg: '#eee' };
              const esMiUsuario = u.id === user?.id;
              const confirmando = confirmDelete === u.id;
              const editando = formMode === u.id;
              const pagedList = usuarios.slice((usuPage - 1) * USU_PAGE_SIZE, usuPage * USU_PAGE_SIZE);
              const isLast = idx === pagedList.length - 1;

              return (
                <React.Fragment key={u.id}>
                  <div className="users-table-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: COL,
                    alignItems: 'center',
                    padding: '11px 16px',
                    background: editando ? 'rgba(40,97,140,0.05)' : !u.activo ? '#f5f6f7' : idx % 2 === 0 ? '#fff' : '#FAFAFA',
                    opacity: u.activo ? 1 : 0.78,
                    borderBottom: (!isLast || editando) ? '1px solid rgba(0,0,0,0.05)' : 'none',
                    transition: 'background 0.12s',
                  }}>
                    {/* Usuario */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '9px', flexShrink: 0, background: badge.bg, color: badge.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                        {getInitials(u)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.87rem', display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.nombre || u.correo}
                          {esMiUsuario && <span style={{ fontSize: '0.72rem', background: 'rgba(40,97,140,0.12)', color: '#1C4D73', borderRadius: '20px', padding: '2px 8px', fontWeight: 700, flexShrink: 0 }}>tú</span>}
                          {u.debe_cambiar_password && <span title="Debe cambiar su contraseña" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', background: '#fff3d6', color: '#8a5b00', borderRadius: '20px', padding: '2px 7px', fontWeight: 750, flexShrink: 0 }}><KeyRound size={11} /> temporal</span>}
                        </span>
                        {u.nombre && <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{u.correo}</span>}
                      </div>
                    </div>

                    {/* Rol */}
                    <div>
                      <span style={{ fontSize: '0.76rem', fontWeight: 700, padding: '3px 11px', borderRadius: '20px', color: badge.color, background: badge.bg, whiteSpace: 'nowrap' }}>
                        {badge.label}
                      </span>
                    </div>

                    <div>
                      <span className={`users-status-badge ${u.activo ? 'is-active' : 'is-inactive'}`}>
                        <i /> {u.activo ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>

                    {/* Creado */}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                      {u.fecha_creacion ? new Date(u.fecha_creacion).toLocaleDateString('es-CL') : '—'}
                    </div>

                    {/* Acciones */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                      {confirmando ? (
                        <>
                          <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>{u.activo ? '¿Desactivar?' : '¿Activar?'}</span>
                          <button onClick={() => handleStatus(u.id, !u.activo)} style={{ background: u.activo ? '#B23A42' : '#157154', color: '#fff', border: 'none', borderRadius: '7px', padding: '5px 11px', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>Sí</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ background: 'rgba(0,0,0,0.07)', color: '#374151', border: 'none', borderRadius: '7px', padding: '5px 11px', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>No</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => editando ? closeForm() : openEditar(u)} style={{ background: editando ? 'rgba(40,97,140,0.18)' : 'rgba(40,97,140,0.1)', color: '#1C4D73', border: 'none', borderRadius: '7px', padding: '8px 12px', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Pencil size={12} /> {editando ? 'Cerrar' : 'Editar'}
                          </button>
                          {!esMiUsuario && (
                            <button onClick={() => setConfirmDelete(u.id)} style={{ background: u.activo ? 'rgba(178,58,66,0.08)' : 'rgba(21,113,84,0.09)', color: u.activo ? '#A4343C' : '#116548', border: 'none', borderRadius: '7px', padding: '8px 11px', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {u.activo ? <UserX size={13} /> : <UserCheck size={13} />} {u.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Formulario edición inline debajo de la fila */}
                  {editando && (
                    <div style={{ borderBottom: isLast ? 'none' : '1px solid rgba(0,0,0,0.05)', padding: '0 12px 12px', background: 'rgba(40,97,140,0.03)' }}>
                      <UserFormPanel
                        form={form}
                        setForm={setForm}
                        formMode={formMode}
                        saving={saving}
                        handleSave={handleSave}
                        closeForm={closeForm}
                        formError={formError}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Paginación */}
        {!loading && !error && usuarios.length > USU_PAGE_SIZE && (() => {
          const totalPages = Math.ceil(usuarios.length / USU_PAGE_SIZE);
          return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '14px' }}>
              <button
                onClick={() => setUsuPage(p => p - 1)} disabled={usuPage === 1}
                style={{ background: usuPage === 1 ? 'rgba(0,0,0,0.04)' : 'rgba(79,70,229,0.1)', color: usuPage === 1 ? '#9CA3AF' : '#4F46E5', border: 'none', borderRadius: '8px', padding: '7px 14px', fontWeight: 600, fontSize: '0.82rem', cursor: usuPage === 1 ? 'not-allowed' : 'pointer' }}>
                ← Anterior
              </button>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-light)', fontWeight: 500 }}>Página {usuPage} de {totalPages}</span>
              <button
                onClick={() => setUsuPage(p => p + 1)} disabled={usuPage === totalPages}
                style={{ background: usuPage === totalPages ? 'rgba(0,0,0,0.04)' : 'rgba(79,70,229,0.1)', color: usuPage === totalPages ? '#9CA3AF' : '#4F46E5', border: 'none', borderRadius: '8px', padding: '7px 14px', fontWeight: 600, fontSize: '0.82rem', cursor: usuPage === totalPages ? 'not-allowed' : 'pointer' }}>
                Siguiente →
              </button>
            </div>
          );
        })()}

      </div>
    </div>
  );
};

export default UsuariosAdmin;
