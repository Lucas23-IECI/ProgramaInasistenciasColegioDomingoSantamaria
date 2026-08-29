import React, { useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router';
import {
  Briefcase,
  Check,
  CheckCircle2,
  ContactRound,
  ChevronRight,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Power,
  PowerOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  UsersRound,
  UserX,
  X,
} from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import { useFeedback } from './context/FeedbackContext';
import AppSelect from './components/AppSelect';
import StaffAvatar from './components/StaffAvatar';
import { PERMISSIONS, hasPermission } from './permissions';
import { getApiErrorMessage } from './utils/apiError';
import './styles/users-permissions.css';

const emptyUserForm = { nombre: '', cargo: '', correo: '', password: '', rol: '', permissions: [] };
const emptyProfileForm = { name: '', description: '', permissions: [] };

const INSTITUTIONAL_JOB_TITLES = [
  'Director/a',
  'Inspector/a General',
  'Inspector/a de piso',
  'Inspector/a de patio',
  'Portería',
  'Secretario/a',
  'Jefe/a de UTP',
  'Encargado/a de convivencia escolar',
  'Docente',
  'Asistente de la educación',
  'Administrador/a del sistema',
];

const normalizeSearch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const groupPermissions = (permissions) => permissions.reduce((groups, permission) => {
  if (!groups[permission.grupo]) groups[permission.grupo] = [];
  groups[permission.grupo].push(permission);
  return groups;
}, {});

const initials = (value) => String(value || 'Usuario')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0])
  .join('')
  .toUpperCase();

const PermissionGrid = ({ permissions, selected, recommended, onToggle, disabled = false }) => {
  const grouped = groupPermissions(permissions);
  return (
    <div className="permission-groups">
      {Object.entries(grouped).map(([group, items]) => (
        <fieldset key={group} className="permission-group">
          <legend>{group}</legend>
          <div className="permission-group__items">
            {items.map((permission) => {
              const active = selected.includes(permission.codigo);
              const suggested = recommended.includes(permission.codigo);
              return (
                <label key={permission.codigo} className="permission-option" data-active={active || undefined} data-disabled={disabled || undefined}>
                  <input type="checkbox" checked={active} onChange={() => onToggle(permission.codigo)} disabled={disabled} />
                  <span className="permission-option__check">{active && <Check size={15} />}</span>
                  <span className="permission-option__copy">
                    <strong>{permission.etiqueta}{suggested && <em>Del perfil</em>}</strong>
                    <small>{permission.descripcion}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
};

const ModalShell = ({ title, saving, onClose, children }) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, saving]);

  return (
    <div className="access-modal-backdrop" onMouseDown={() => !saving && onClose()}>
      <div className="access-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

const UserEditor = ({ form, setForm, catalog, mode, saving, error, onSave, onClose, lockedProfile }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [customCargo, setCustomCargo] = useState(Boolean(form.cargo && !INSTITUTIONAL_JOB_TITLES.includes(form.cargo)));
  const profiles = catalog.templates || [];
  const profile = profiles.find((item) => item.value === form.rol);
  const recommended = profile?.recommended_permissions || [];
  const fixedReaderProfile = form.rol === 'lector';
  const customChanges = (catalog.permissions || []).filter((permission) => (
    form.permissions.includes(permission.codigo) !== recommended.includes(permission.codigo)
  )).length;

  const selectProfile = (code) => {
    const next = profiles.find((item) => item.value === code);
    setForm((current) => ({ ...current, rol: code, permissions: [...(next?.recommended_permissions || [])] }));
  };
  const togglePermission = (code) => setForm((current) => ({
    ...current,
    permissions: current.permissions.includes(code)
      ? current.permissions.filter((permission) => permission !== code)
      : [...current.permissions, code],
  }));

  return (
    <section className="permission-editor" aria-label={mode === 'create' ? 'Crear cuenta del personal' : 'Editar cuenta del personal'}>
      <div className="permission-editor__heading">
        <div>
          <span className="section-kicker">{mode === 'create' ? 'Nueva cuenta personal' : 'Cuenta del personal'}</span>
          <h2>{mode === 'create' ? 'Crear acceso para una persona' : 'Editar persona y permisos'}</h2>
          <p>Esta cuenta pertenece al personal que inicia sesión. No crea ni modifica alumnos, cursos o matrículas.</p>
        </div>
        <button type="button" className="permission-editor__close" onClick={onClose} aria-label="Cerrar formulario"><X size={20} /></button>
      </div>

      <div className="permission-editor__identity">
        <label><span>Nombre de la persona</span><input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} placeholder="Ej: María González" /></label>
        <label>
          <span>Cargo institucional</span>
          <AppSelect
            ariaLabel="Cargo institucional"
            value={customCargo ? '__OTRO__' : form.cargo}
            onChange={(value) => {
              if (value === '__OTRO__') {
                setCustomCargo(true);
                setForm((current) => ({ ...current, cargo: '' }));
              } else {
                setCustomCargo(false);
                setForm((current) => ({ ...current, cargo: value }));
              }
            }}
            options={[
              { value: '', label: 'Seleccionar cargo' },
              ...INSTITUTIONAL_JOB_TITLES.map((title) => ({ value: title, label: title })),
              { value: '__OTRO__', label: 'Otro cargo institucional' }
            ]}
          />
          {customCargo && (
            <input
              value={form.cargo}
              onChange={(event) => setForm((current) => ({ ...current, cargo: event.target.value }))}
              placeholder="Escribe el cargo"
              autoFocus
            />
          )}
        </label>
        <label><span>Correo de ingreso</span><input type="email" value={form.correo} onChange={(event) => setForm((current) => ({ ...current, correo: event.target.value }))} placeholder="maria@ldsm.local" /></label>
        <label>
          <span>Contraseña {mode === 'edit' && <small>vacía para conservarla</small>}</span>
          <div className="permission-password">
            <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder={mode === 'create' ? 'Mínimo 12 caracteres' : 'Sin cambios'} autoComplete="new-password" />
            <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
        </label>
      </div>

      <div className="permission-template">
        <div className="permission-template__copy"><span className="field-label">Perfil de usuario</span><p>{profile?.description || 'Elige el tipo de usuario que tendrá esta cuenta.'}</p></div>
        {lockedProfile
          ? <div className="permission-template__locked"><ShieldCheck size={18} /><span><strong>{lockedProfile.label}</strong><small>Perfil seleccionado</small></span></div>
          : <AppSelect ariaLabel="Perfil de usuario" value={form.rol} onChange={selectProfile} options={profiles.filter((item) => item.activo).map((item) => ({ value: item.value, label: item.label }))} />}
        <div className="permission-template__status" data-custom={!fixedReaderProfile && customChanges > 0 || undefined}><ShieldCheck size={18} /><span><strong>{form.permissions.length} funciones habilitadas</strong><small>{fixedReaderProfile ? 'Perfil operativo fijo de Portería' : customChanges ? `${customChanges} ajustes personales` : 'Usa la recomendación del perfil'}</small></span></div>
        {!fixedReaderProfile && <button type="button" className="permission-reset" onClick={() => setForm((current) => ({ ...current, permissions: [...recommended] }))} disabled={!customChanges}><RotateCcw size={16} /> Usar recomendación</button>}
      </div>

      {fixedReaderProfile && (
        <div className="permission-fixed-note">
          <ShieldCheck size={20} />
          <div><strong>Acceso fijo de Portería</strong><span>Esta cuenta siempre tendrá únicamente Registro de estudiantes y Control de visitas y retiros.</span></div>
        </div>
      )}
      <PermissionGrid permissions={catalog.permissions || []} selected={form.permissions} recommended={recommended} onToggle={togglePermission} disabled={fixedReaderProfile} />
      {error && <div className="permission-editor__error" role="alert">{error}</div>}
      <div className="permission-editor__footer">
        <span><ShieldCheck size={17} /> Los ajustes personales solo afectan a esta cuenta.</span>
        <div><button type="button" className="secondary-action" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="primary-action" onClick={onSave} disabled={saving}><Check size={17} /> {saving ? 'Guardando…' : 'Guardar cuenta'}</button></div>
      </div>
    </section>
  );
};

const ProfileEditor = ({ form, setForm, catalog, mode, saving, error, onSave, onClose, protectedProfile = false }) => {
  const baseProfile = mode === 'create'
    ? (catalog.templates || []).find((profile) => JSON.stringify([...(profile.recommended_permissions || [])].sort()) === JSON.stringify([...form.permissions].sort()))?.value || ''
    : '';
  const togglePermission = (code) => setForm((current) => ({
    ...current,
    permissions: current.permissions.includes(code)
      ? current.permissions.filter((permission) => permission !== code)
      : [...current.permissions, code],
  }));
  return (
    <section className="permission-editor profile-editor" aria-label={mode === 'create' ? 'Crear perfil de usuario' : 'Editar perfil de usuario'}>
      <div className="permission-editor__heading">
        <div><span className="section-kicker">Tipo reutilizable de usuario</span><h2>{mode === 'create' ? 'Crear perfil de usuario' : 'Editar perfil y recomendación'}</h2><p>El perfil agrupa cuentas y define sus funciones iniciales. Cada persona podrá conservar ajustes propios.</p></div>
        <button type="button" className="permission-editor__close" onClick={onClose} aria-label="Cerrar formulario"><X size={20} /></button>
      </div>
      <div className="profile-editor__identity">
        <label><span className="field-label">Nombre del perfil</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej: Inspector General" /></label>
        <label><span className="field-label">Descripción</span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Qué responsabilidad representa este perfil" /></label>
        {mode === 'create' && <label><span className="field-label">Partir desde</span><AppSelect ariaLabel="Copiar permisos de un perfil" value={baseProfile} onChange={(code) => { const source = (catalog.templates || []).find((profile) => profile.value === code); setForm((current) => ({ ...current, permissions: [...(source?.recommended_permissions || [])] })); }} options={[{ value: '', label: 'Sin permisos iniciales' }, ...(catalog.templates || []).filter((profile) => profile.activo).map((profile) => ({ value: profile.value, label: profile.label }))]} /></label>}
      </div>
      <div className="profile-editor__summary"><UsersRound size={18} /><div><strong>{form.permissions.length} funciones recomendadas</strong><span>{protectedProfile ? 'Las funciones del perfil Administrador están protegidas. Solo puedes actualizar su nombre y descripción.' : 'Se marcarán automáticamente al crear una cuenta con este perfil; luego pueden ajustarse individualmente.'}</span></div></div>
      <PermissionGrid permissions={catalog.permissions || []} selected={form.permissions} recommended={form.permissions} onToggle={togglePermission} disabled={protectedProfile} />
      {error && <div className="permission-editor__error" role="alert">{error}</div>}
      <div className="permission-editor__footer"><span><ShieldCheck size={17} /> Los cambios del perfil se aplican a las cuentas que heredan su recomendación.</span><div><button type="button" className="secondary-action" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="primary-action" onClick={onSave} disabled={saving}><Check size={17} /> {saving ? 'Guardando…' : 'Guardar perfil'}</button></div></div>
    </section>
  );
};

const DeleteAccountDialog = ({ account, reason, setReason, saving, error, onDelete, onClose }) => (
  <section className="permission-editor delete-account-dialog" aria-label="Eliminar cuenta del personal">
    <div className="permission-editor__heading">
      <div><span className="section-kicker">Retiro de acceso</span><h2>Eliminar cuenta del sistema</h2><p>La persona perderá el acceso inmediatamente. Sus registros y su historial de auditoría se conservarán.</p></div>
      <button type="button" className="permission-editor__close" onClick={onClose} aria-label="Cerrar confirmación"><X size={20} /></button>
    </div>
    <div className="delete-account-dialog__body">
      <div className="delete-account-dialog__person"><span className="user-account__avatar">{initials(account.nombre || account.correo)}</span><div><strong>{account.nombre || account.correo}</strong><span>{account.correo}</span><small>{account.cargo || account.profile_name || account.rol}</small></div></div>
      <div className="delete-account-dialog__notice"><ShieldCheck size={19} /><p><strong>El historial no se borra.</strong> La cuenta desaparecerá de los perfiles, no podrá volver a iniciar sesión y la eliminación quedará registrada.</p></div>
      <label><span className="field-label">Motivo de eliminación</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej: La persona dejó de prestar funciones en el establecimiento" rows={4} /></label>
    </div>
    {error && <div className="permission-editor__error" role="alert">{error}</div>}
    <div className="permission-editor__footer"><span><History size={17} /> La actividad histórica seguirá disponible en Auditoría.</span><div><button type="button" className="secondary-action" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="danger-action" onClick={onDelete} disabled={saving || reason.trim().length < 8}><Trash2 size={17} /> {saving ? 'Eliminando…' : 'Eliminar cuenta'}</button></div></div>
  </section>
);

const ProfileActionDialog = ({ profile, action, confirmation, setConfirmation, saving, error, onConfirm, onClose }) => {
  const deleting = action === 'delete';
  const deactivating = action === 'deactivate';
  const associated = profile.account_count || 0;
  const blocked = deleting && associated > 0;
  const title = deleting ? `Eliminar ${profile.label}` : deactivating ? `Desactivar ${profile.label}` : `Reactivar ${profile.label}`;
  return (
    <section className="permission-editor profile-action-dialog" aria-label={title}>
      <div className="permission-editor__heading">
        <div><span className="section-kicker">Administración del perfil</span><h2>{title}</h2><p>{deleting ? 'Esta acción elimina el perfil reutilizable, pero conserva toda la auditoría histórica.' : deactivating ? 'Las cuentas vinculadas seguirán existiendo y podrán iniciar sesión; el perfil no se podrá asignar a cuentas nuevas.' : 'El perfil volverá a estar disponible para crear y reasignar cuentas.'}</p></div>
        <button type="button" className="permission-editor__close" onClick={onClose} aria-label="Cerrar confirmación"><X size={20} /></button>
      </div>
      <div className="profile-action-dialog__body">
        <div className="profile-action-dialog__profile"><ShieldCheck size={22} /><div><strong>{profile.label}</strong><span>{associated} cuenta{associated !== 1 ? 's' : ''} asociada{associated !== 1 ? 's' : ''} · {profile.recommended_permissions?.length || 0} funciones</span></div></div>
        {blocked && <div className="profile-action-dialog__blocked" role="alert"><strong>No se puede eliminar este perfil.</strong><span>Reasigna sus {associated} cuenta{associated !== 1 ? 's' : ''} a otro perfil antes de eliminarlo. Ninguna cuenta se borrará automáticamente.</span></div>}
        {deleting && !blocked && <label><span className="field-label">Escribe {profile.label} para confirmar</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>}
      </div>
      {error && <div className="permission-editor__error" role="alert">{error}</div>}
      <div className="permission-editor__footer"><span><History size={17} /> Las cuentas y eventos históricos no se eliminan.</span><div><button type="button" className="secondary-action" onClick={onClose} disabled={saving}>{blocked ? 'Entendido' : 'Cancelar'}</button>{!blocked && <button type="button" className={deleting || deactivating ? 'danger-action' : 'primary-action'} onClick={onConfirm} disabled={saving || (deleting && confirmation.trim() !== profile.label)}>{deleting ? <Trash2 size={17} /> : deactivating ? <PowerOff size={17} /> : <Power size={17} />}{saving ? 'Procesando…' : deleting ? 'Eliminar perfil' : deactivating ? 'Desactivar perfil' : 'Reactivar perfil'}</button>}</div></div>
    </section>
  );
};

const UsuariosAdmin = () => {
  const { user, logout, refreshUser } = useContext(AuthContext);
  const { notify } = useFeedback();
  const navigate = useNavigate();
  const { profileCode } = useParams();
  const [usuarios, setUsuarios] = useState([]);
  const [catalog, setCatalog] = useState({ permissions: [], templates: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [deleteReason, setDeleteReason] = useState('');
  const [profileConfirmation, setProfileConfirmation] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersResponse, catalogResponse] = await Promise.all([
        axios.get(`${API_URL}/users`),
        axios.get(`${API_URL}/permissions/catalog`),
      ]);
      setUsuarios(usersResponse.data);
      setCatalog(catalogResponse.data);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible cargar la administración de usuarios.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  const profileFor = (code) => catalog.templates.find((profile) => profile.value === code);
  const activeProfile = profileCode ? profileFor(profileCode) : null;
  const canViewAudit = hasPermission(user, PERMISSIONS.AUDIT_VIEW);

  const openCreateUser = () => {
    if (!activeProfile) return;
    setUserForm({ ...emptyUserForm, rol: activeProfile.value, permissions: [...(activeProfile.recommended_permissions || [])] });
    setFormError('');
    setEditor({ type: 'user', mode: 'create' });
  };
  const openEditUser = (account) => {
    setUserForm({ nombre: account.nombre || '', cargo: account.cargo || '', correo: account.correo, password: '', rol: account.rol, permissions: [...(account.permissions || [])] });
    setFormError('');
    setEditor({ type: 'user', mode: 'edit', id: account.id });
  };
  const openCreateProfile = () => {
    const inspector = profileFor('inspector');
    setProfileForm({ ...emptyProfileForm, permissions: [...(inspector?.recommended_permissions || [])] });
    setFormError('');
    setEditor({ type: 'profile', mode: 'create' });
  };
  const openEditProfile = (profile) => {
    setProfileForm({ name: profile.label, description: profile.description || '', permissions: [...(profile.recommended_permissions || [])] });
    setFormError('');
    setEditor({ type: 'profile', mode: 'edit', code: profile.value });
  };
  const openDeleteUser = (account) => {
    setDeleteReason('');
    setFormError('');
    setEditor({ type: 'delete', account });
  };
  const openProfileAction = (action, profile) => {
    setProfileConfirmation('');
    setFormError('');
    setEditor({ type: 'profile-action', action, profile });
  };
  const closeEditor = () => { setEditor(null); setFormError(''); };

  const validatePassword = (password) => password.length >= 12 && /[a-záéíóúñ]/.test(password) && /[A-ZÁÉÍÓÚÑ]/.test(password) && /\d/.test(password);
  const saveUser = async () => {
    setFormError('');
    if (userForm.nombre.trim().length < 2) return setFormError('Escribe el nombre de la persona.');
    if (userForm.cargo.trim().length < 2) return setFormError('Escribe el cargo institucional de la persona.');
    if (!userForm.correo.trim()) return setFormError('El correo de ingreso es obligatorio.');
    if (!userForm.rol) return setFormError('Selecciona un perfil de usuario.');
    if (editor.mode === 'create' && !userForm.password) return setFormError('La contraseña temporal es obligatoria.');
    if (userForm.password && !validatePassword(userForm.password)) return setFormError('La contraseña debe tener 12 caracteres, mayúscula, minúscula y número.');
    setSaving(true);
    try {
      const payload = { ...userForm };
      if (!payload.password) delete payload.password;
      if (editor.mode === 'create') await axios.post(`${API_URL}/users`, payload);
      else await axios.put(`${API_URL}/users/${editor.id}`, payload);
      if (editor.mode === 'edit' && editor.id === user?.id) await refreshUser();
      notify(editor.mode === 'create' ? 'Cuenta personal creada con clave temporal.' : 'Cuenta y permisos actualizados.', 'success');
      closeEditor();
      await loadData();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, 'No fue posible guardar la cuenta.'));
    } finally { setSaving(false); }
  };

  const saveProfile = async () => {
    setFormError('');
    if (profileForm.name.trim().length < 2) return setFormError('El perfil necesita un nombre de al menos 2 caracteres.');
    setSaving(true);
    try {
      if (editor.mode === 'create') await axios.post(`${API_URL}/access-profiles`, profileForm);
      else await axios.put(`${API_URL}/access-profiles/${editor.code}`, profileForm);
      notify(editor.mode === 'create' ? 'Perfil de usuario creado.' : 'Perfil y recomendación actualizados.', 'success');
      closeEditor();
      await loadData();
      await refreshUser();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, 'No fue posible guardar el perfil.'));
    } finally { setSaving(false); }
  };

  const changeStatus = async (id, active) => {
    try {
      await axios.patch(`${API_URL}/users/${id}/status`, { activo: active });
      setConfirmStatus(null);
      notify(active ? 'Cuenta activada.' : 'Cuenta desactivada.', 'success');
      await loadData();
    } catch (requestError) { notify(getApiErrorMessage(requestError, 'No fue posible cambiar el estado.'), 'error'); }
  };

  const deleteUser = async () => {
    setFormError('');
    if (deleteReason.trim().length < 8) return setFormError('Escribe un motivo de al menos 8 caracteres.');
    setSaving(true);
    try {
      await axios.delete(`${API_URL}/users/${editor.account.id}`, { data: { motivo: deleteReason.trim() } });
      notify('Cuenta eliminada. Su historial permanece disponible en auditoría.', 'success');
      closeEditor();
      await loadData();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, 'No fue posible eliminar la cuenta.'));
    } finally { setSaving(false); }
  };

  const changeProfileStatus = async () => {
    const profile = editor?.profile;
    if (!profile) return;
    const active = editor.action === 'reactivate';
    setSaving(true);
    setFormError('');
    try {
      await axios.patch(`${API_URL}/access-profiles/${encodeURIComponent(profile.value)}/status`, { activo: active });
      notify(active ? 'Perfil reactivado y disponible para nuevas cuentas.' : 'Perfil desactivado. Sus cuentas se conservaron.', 'success');
      closeEditor();
      await loadData();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, 'No fue posible cambiar el estado del perfil.'));
    } finally { setSaving(false); }
  };

  const deleteProfile = async () => {
    const profile = editor?.profile;
    if (!profile) return;
    setSaving(true);
    setFormError('');
    try {
      await axios.delete(`${API_URL}/access-profiles/${encodeURIComponent(profile.value)}`);
      notify('Perfil eliminado. Su actividad histórica permanece en auditoría.', 'success');
      closeEditor();
      navigate('/admin/usuarios');
      await loadData();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, 'No fue posible eliminar el perfil.'));
    } finally { setSaving(false); }
  };

  const openAccountAudit = (account) => {
    if (!canViewAudit) return;
    const params = new URLSearchParams({ cuenta_id: String(account.id), perfil: account.rol });
    navigate(`/admin/auditoria?${params.toString()}`);
  };
  const openProfileAudit = (profile) => {
    if (!canViewAudit) return;
    navigate(`/admin/auditoria?perfil_codigo=${encodeURIComponent(profile.value)}`);
  };

  const permissionName = (code) => catalog.permissions.find((permission) => permission.codigo === code)?.etiqueta || code;
  const filteredProfiles = useMemo(() => {
    const query = normalizeSearch(profileSearch);
    return (catalog.templates || []).filter((profile) => {
      const members = usuarios.filter((account) => account.rol === profile.value);
      return !query || normalizeSearch([profile.label, profile.description, ...members.flatMap((member) => [member.nombre, member.correo, member.cargo])].join(' ')).includes(query);
    });
  }, [catalog.templates, usuarios, profileSearch]);
  const filteredUsers = useMemo(() => {
    if (!profileCode) return [];
    const query = normalizeSearch(searchTerm);
    return usuarios.filter((account) => {
      const searchable = normalizeSearch([account.nombre, account.correo, account.cargo].join(' '));
      return account.rol === profileCode
        && (!query || searchable.includes(query))
        && (!statusFilter || (statusFilter === 'active' ? account.activo : !account.activo));
    });
  }, [usuarios, searchTerm, statusFilter, profileCode]);

  const editorTitle = editor?.type === 'delete'
    ? 'Eliminar cuenta del personal'
    : editor?.type === 'profile-action'
    ? 'Administrar perfil de usuario'
    : editor?.type === 'profile'
    ? (editor.mode === 'create' ? 'Crear perfil de usuario' : 'Editar perfil de usuario')
    : (editor?.mode === 'create' ? 'Crear cuenta del personal' : 'Editar cuenta del personal');
  const modal = editor && (
    <ModalShell title={editorTitle} saving={saving} onClose={closeEditor}>
      {editor.type === 'delete'
        ? <DeleteAccountDialog account={editor.account} reason={deleteReason} setReason={setDeleteReason} saving={saving} error={formError} onDelete={deleteUser} onClose={closeEditor} />
        : editor.type === 'profile-action'
        ? <ProfileActionDialog profile={editor.profile} action={editor.action} confirmation={profileConfirmation} setConfirmation={setProfileConfirmation} saving={saving} error={formError} onConfirm={editor.action === 'delete' ? deleteProfile : changeProfileStatus} onClose={closeEditor} />
        : editor.type === 'user'
        ? <UserEditor form={userForm} setForm={setUserForm} catalog={catalog} mode={editor.mode} saving={saving} error={formError} onSave={saveUser} onClose={closeEditor} lockedProfile={activeProfile} />
        : <ProfileEditor form={profileForm} setForm={setProfileForm} catalog={catalog} mode={editor.mode} saving={saving} error={formError} onSave={saveProfile} onClose={closeEditor} protectedProfile={editor.code === 'admin'} />}
    </ModalShell>
  );

  const accountList = (
    <div className="user-account-list">
      <div className="user-account-list__head" aria-hidden="true"><span>Persona y cuenta</span><span>Cargo</span><span>Perfil</span><span>Funciones</span><span>Estado</span><span>Acciones</span></div>
      {filteredUsers.map((account) => {
        const isCurrent = account.id === user?.id;
        const asking = confirmStatus === account.id;
        return (
          <article key={account.id} className="user-account" data-inactive={!account.activo || undefined}>
            {canViewAudit
              ? <button type="button" className="user-account__identity user-account__identity--link" onClick={() => openAccountAudit(account)} title="Ver actividad de esta cuenta"><StaffAvatar profile={account.personal_profile} name={account.nombre || account.correo} size="md" /><span><strong>{account.personal_profile?.nombre_mostrado || account.nombre || account.correo}{isCurrent && <em>Tu cuenta</em>}</strong><span>{account.correo}</span><small>Ver actividad</small></span></button>
              : <div className="user-account__identity"><StaffAvatar profile={account.personal_profile} name={account.nombre || account.correo} size="md" /><div><strong>{account.personal_profile?.nombre_mostrado || account.nombre || account.correo}{isCurrent && <em>Tu cuenta</em>}</strong><span>{account.correo}</span></div></div>}
            <div className="user-account__job"><Briefcase size={16} /><div><span>Cargo</span><strong>{account.cargo || 'Sin cargo informado'}</strong></div></div>
            <div className="user-account__profile"><span>Perfil</span><strong>{account.profile_name || account.rol}</strong><small>{account.permissions?.length || 0} funciones</small></div>
            <div className="user-account__permissions">{(account.permissions || []).slice(0, 3).map((permission) => <span key={permission}><CheckCircle2 size={13} /> {permissionName(permission)}</span>)}{(account.permissions?.length || 0) > 3 && <span>+{account.permissions.length - 3} funciones</span>}{!account.permissions?.length && <span>Sin funciones</span>}</div>
            <div className="user-account__status"><span data-active={account.activo || undefined}><i /> {account.activo ? 'Activa' : 'Inactiva'}</span>{account.debe_cambiar_password && <small><KeyRound size={13} /> Clave temporal</small>}</div>
            <div className="user-account__actions"><button type="button" className="account-profile" onClick={() => navigate(`/directorio/${account.id}`)}><ContactRound size={16} /> Perfil</button>{canViewAudit && <button type="button" className="account-audit" data-tour="account-history" onClick={() => openAccountAudit(account)}><History size={16} /> Actividad</button>}<button type="button" className="account-edit" onClick={() => openEditUser(account)}><Pencil size={16} /> Editar</button>{!isCurrent && (asking ? <div className="account-confirm"><span>{account.activo ? '¿Desactivar?' : '¿Activar?'}</span><button type="button" onClick={() => changeStatus(account.id, !account.activo)}>Sí</button><button type="button" onClick={() => setConfirmStatus(null)}>No</button></div> : <><button type="button" className="account-status" data-active={!account.activo || undefined} onClick={() => setConfirmStatus(account.id)}>{account.activo ? <UserX size={16} /> : <UserCheck size={16} />}{account.activo ? 'Desactivar' : 'Activar'}</button><button type="button" className="account-delete" onClick={() => openDeleteUser(account)}><Trash2 size={16} /> Eliminar</button></>)}</div>
          </article>
        );
      })}
      {!filteredUsers.length && <div className="users-state users-state--empty"><Search size={24} /><strong>No hay cuentas con estos filtros</strong><span>Crea la primera cuenta de este perfil o prueba otra búsqueda.</span></div>}
    </div>
  );

  if (profileCode && loading) {
    return (
      <div className="app-container users-page"><div className="users-surface">
        <ModuleHeader icon={UserCog} title="Cargando perfil…" description="Preparando las cuentas y funciones de este perfil." onBack={() => navigate('/admin/usuarios')} backLabel="Todos los perfiles" onLogout={async () => { await logout(); navigate('/login'); }} />
        <div className="users-state">Cargando perfil y cuentas…</div>
      </div></div>
    );
  }

  if (profileCode && !activeProfile) {
    return (
      <div className="app-container users-page"><div className="users-surface">
        <ModuleHeader icon={UserCog} title="Perfil no encontrado" description="El perfil solicitado no existe o ya no está disponible." onBack={() => navigate('/admin/usuarios')} backLabel="Todos los perfiles" onLogout={async () => { await logout(); navigate('/login'); }} />
        <div className="users-state users-state--error"><strong>No encontramos este perfil.</strong><br /><button type="button" className="secondary-action" onClick={() => navigate('/admin/usuarios')}>Volver a perfiles</button></div>
      </div></div>
    );
  }

  return (
    <div className="app-container users-page">
      <div className="users-surface">
        <ModuleHeader
          icon={UserCog}
          title={activeProfile ? activeProfile.label : 'Usuarios y permisos'}
          description={activeProfile ? 'Cuentas personales y funciones asociadas a este perfil de usuario.' : 'Perfiles reutilizables del equipo institucional.'}
          onBack={() => navigate(activeProfile ? '/admin/usuarios' : '/admin')}
          backLabel={activeProfile ? 'Todos los perfiles' : 'Panel principal'}
          onLogout={async () => { await logout(); navigate('/login'); }}
        />

        {!activeProfile ? (
          <section className="access-profiles-section" data-tour="profiles-catalog">
            <div className="users-directory__heading">
              <div><span className="section-kicker">Tipos de usuario</span><h2>Perfiles de usuario</h2><p>Elige un perfil para ver sus cuentas, permisos y opciones de administración.</p></div>
              <button type="button" className="primary-action" onClick={openCreateProfile}><Plus size={18} /> Crear perfil</button>
            </div>
            <label className="profiles-search"><Search size={18} /><input type="search" value={profileSearch} onChange={(event) => setProfileSearch(event.target.value)} placeholder="Buscar perfil o persona asignada" /></label>
            {loading && <div className="users-state">Cargando perfiles…</div>}
            {!loading && error && <div className="users-state users-state--error">{error}</div>}
            {!loading && !error && <div className="access-profile-grid" data-tour="profiles-grid">
              {filteredProfiles.map((profile) => {
                const members = usuarios.filter((account) => account.rol === profile.value && account.activo);
                return (
                  <button type="button" className="access-profile-card" key={profile.value} data-inactive={!profile.activo || undefined} onClick={() => navigate(`/admin/usuarios/${encodeURIComponent(profile.value)}`)}>
                    <span className="access-profile-card__top"><span className="access-profile-card__icon"><ShieldCheck size={20} /></span><span><strong>{profile.label}</strong><small>{profile.sistema ? 'Perfil institucional' : 'Perfil creado por el establecimiento'}</small></span><span className="access-profile-card__arrow"><ChevronRight size={20} /></span></span>
                    <span className="access-profile-card__state" data-active={profile.activo || undefined}><i /> {profile.activo ? 'Activo' : 'Desactivado'}</span>
                    <span className="access-profile-card__description">{profile.description || 'Sin descripción institucional.'}</span>
                    <span className="access-profile-card__permissions"><strong>{profile.recommended_permissions?.length || 0}</strong><span>funciones recomendadas</span></span>
                    <span className="access-profile-card__members">
                      <span><UsersRound size={15} /> {profile.active_account_count ?? members.length} {(profile.active_account_count ?? members.length) === 1 ? 'cuenta activa' : 'cuentas activas'}</span>
                      <span>{members.slice(0, 3).map((member) => <span className="profile-member" key={member.id} title={`${member.nombre || member.correo}${member.cargo ? ` · ${member.cargo}` : ''}`}>{initials(member.nombre || member.correo)}</span>)}{members.length > 3 && <span className="profile-member profile-member--more">+{members.length - 3}</span>}</span>
                    </span>
                    <span className="profile-view-accounts">Abrir perfil <ChevronRight size={16} /></span>
                  </button>
                );
              })}
              {!filteredProfiles.length && <div className="users-state users-state--empty"><Search size={24} /><strong>No encontramos perfiles</strong><span>Prueba con otro nombre o crea uno nuevo.</span></div>}
            </div>}
          </section>
        ) : (
          <>
            <section className="profile-detail" data-tour="profile-summary">
              <div className="profile-detail__hero">
                <div className="profile-detail__identity"><span className="access-profile-card__icon"><ShieldCheck size={24} /></span><div><span className="section-kicker">Perfil de usuario</span><div className="profile-detail__title"><h2>{activeProfile.label}</h2><span className="profile-state-badge" data-active={activeProfile.activo || undefined}><i /> {activeProfile.activo ? 'Activo' : 'Desactivado'}</span></div><p>{activeProfile.description || 'Sin descripción institucional.'}</p></div></div>
                <div className="profile-detail__actions" data-tour="profile-actions">
                  <button type="button" className="secondary-action" onClick={() => openEditProfile(activeProfile)}><Pencil size={17} /> Editar perfil</button>
                  {canViewAudit && <button type="button" className="secondary-action" onClick={() => openProfileAudit(activeProfile)}><History size={17} /> Actividad</button>}
                  {activeProfile.value !== 'admin' && (activeProfile.activo
                    ? <button type="button" className="danger-action" onClick={() => openProfileAction('deactivate', activeProfile)}><PowerOff size={17} /> Desactivar</button>
                    : <button type="button" className="secondary-action" onClick={() => openProfileAction('reactivate', activeProfile)}><Power size={17} /> Reactivar</button>)}
                  {activeProfile.value !== 'admin' && <button type="button" className="danger-action" onClick={() => openProfileAction('delete', activeProfile)}><Trash2 size={17} /> Eliminar</button>}
                  <button type="button" className="primary-action" onClick={openCreateUser} disabled={!activeProfile.activo} title={!activeProfile.activo ? 'Reactiva este perfil para crear cuentas nuevas.' : undefined}><Plus size={18} /> Crear cuenta</button>
                </div>
              </div>
              <div className="profile-detail__summary">
                <div><strong>{activeProfile.active_account_count ?? usuarios.filter((account) => account.rol === activeProfile.value && account.activo).length}</strong><span>Cuentas activas</span></div>
                <div><strong>{activeProfile.account_count ?? usuarios.filter((account) => account.rol === activeProfile.value).length}</strong><span>Cuentas asociadas</span></div>
                <div><strong>{activeProfile.recommended_permissions?.length || 0}</strong><span>Funciones recomendadas</span></div>
                <div className="profile-detail__permission-preview">{(activeProfile.recommended_permissions || []).slice(0, 5).map((permission) => <span key={permission}><CheckCircle2 size={13} /> {permissionName(permission)}</span>)}{(activeProfile.recommended_permissions?.length || 0) > 5 && <span>+{activeProfile.recommended_permissions.length - 5} más</span>}</div>
              </div>
            </section>

            <section className="users-directory users-directory--profile" data-tour="profile-accounts">
              <div className="users-directory__heading"><div><span className="section-kicker">Personas con este perfil</span><h2>Cuentas de {activeProfile.label}</h2><p>Las modificaciones personales de permisos se conservan separadas de la recomendación general.</p></div></div>
              <div className="users-directory__toolbar users-directory__toolbar--profile" aria-label="Buscar y filtrar cuentas">
                <label className="users-search"><span className="field-label">Buscar persona o cuenta</span><div><Search size={18} /><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Nombre, correo o cargo" /></div></label>
                <label className="users-filter"><span className="field-label">Estado</span><AppSelect ariaLabel="Filtrar por estado" value={statusFilter} onChange={setStatusFilter} options={[{ value: '', label: 'Todas las cuentas' }, { value: 'active', label: 'Activas' }, { value: 'inactive', label: 'Inactivas' }]} /></label>
                <div className="users-result-count" aria-live="polite"><strong>{filteredUsers.length}</strong><span>{filteredUsers.length === 1 ? 'cuenta visible' : 'cuentas visibles'}</span></div>
              </div>
              {!loading && error && <div className="users-state users-state--error">{error}</div>}
              {!loading && !error && accountList}
            </section>
          </>
        )}
        {modal}
      </div>
    </div>
  );
};

export default UsuariosAdmin;
