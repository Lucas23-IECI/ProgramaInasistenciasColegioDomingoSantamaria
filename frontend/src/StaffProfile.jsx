import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  BriefcaseBusiness,
  Building2,
  Camera,
  Clock3,
  Crop,
  ImagePlus,
  Mail,
  MapPin,
  Phone,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { API_URL } from './config';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';
import ProfileImageEditor from './components/ProfileImageEditor';
import StaffAvatar from './components/StaffAvatar';
import { PERMISSIONS, hasPermission } from './permissions';
import { resolveApiAssetUrl } from './utils/apiAssetUrl';
import { blobAsDataUrl, validateProfileImageFile } from './utils/profileImageEditor';
import { getApiErrorMessage, getSafeErrorMessage } from './utils/apiError';

const STATUS_OPTIONS = [
  ['SIN_ESTADO', 'Sin estado'],
  ['DISPONIBLE', 'Disponible'],
  ['OCUPADO', 'Ocupado/a'],
  ['EN_REUNION', 'En reunión'],
  ['EN_TERRENO', 'En terreno'],
  ['FUERA', 'Fuera del establecimiento'],
  ['AUSENTE', 'Ausente'],
  ['NO_MOLESTAR', 'No molestar']
];

const EMPTY_FORM = {
  nombre_mostrado: '',
  biografia: '',
  ubicacion: '',
  anexo: '',
  telefono_interno: '',
  horario_trabajo: '',
  estado_disponibilidad: 'SIN_ESTADO',
  mensaje_estado: '',
  estado_hasta: '',
  mostrar_contacto: true
};

const EMPTY_MANAGED_FORM = { area: '', visible_directorio: true, cuenta_compartida: false };
const formSignature = (value) => JSON.stringify(value);

const toLocalDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const StaffProfile = ({ directoryMode = false }) => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useContext(AuthContext);
  const { notify, confirm } = useFeedback();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [savedFormSignature, setSavedFormSignature] = useState(formSignature(EMPTY_FORM));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [managedForm, setManagedForm] = useState(EMPTY_MANAGED_FORM);
  const [savedManagedSignature, setSavedManagedSignature] = useState(formSignature(EMPTY_MANAGED_FORM));
  const [imageEditor, setImageEditor] = useState(null);
  const [mediaLoading, setMediaLoading] = useState('');
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const ownProfile = !directoryMode;
  const canEdit = ownProfile && hasPermission(user, PERMISSIONS.PROFILES_OWN_EDIT);
  const canManage = directoryMode && hasPermission(user, PERMISSIONS.PROFILES_MANAGE);

  const endpoint = useMemo(() => directoryMode
    ? `${API_URL}/directory/staff/${userId}`
    : `${API_URL}/profile/me`, [directoryMode, userId]);

  const applyProfile = (nextProfile) => {
    setProfile(nextProfile);
    const nextManagedForm = {
      area: nextProfile?.area || '',
      visible_directorio: nextProfile?.visible_directorio !== false,
      cuenta_compartida: nextProfile?.cuenta_compartida === true
    };
    const nextForm = {
      nombre_mostrado: nextProfile?.nombre_mostrado || '',
      biografia: nextProfile?.biografia || '',
      ubicacion: nextProfile?.ubicacion || '',
      anexo: nextProfile?.anexo || '',
      telefono_interno: nextProfile?.telefono_interno || '',
      horario_trabajo: nextProfile?.horario_trabajo || '',
      estado_disponibilidad: nextProfile?.estado_disponibilidad || 'SIN_ESTADO',
      mensaje_estado: nextProfile?.mensaje_estado || '',
      estado_hasta: toLocalDateTime(nextProfile?.estado_hasta),
      mostrar_contacto: nextProfile?.mostrar_contacto !== false
    };
    setManagedForm(nextManagedForm);
    setSavedManagedSignature(formSignature(nextManagedForm));
    setForm(nextForm);
    setSavedFormSignature(formSignature(nextForm));
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    axios.get(endpoint)
      .then(({ data }) => { if (active) applyProfile(data.profile); })
      .catch((error) => { if (active) notify(getApiErrorMessage(error, 'No fue posible cargar el perfil.'), 'error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint, notify]);

  const profileDirty = formSignature(form) !== savedFormSignature;
  const managedDirty = formSignature(managedForm) !== savedManagedSignature;

  useEffect(() => {
    if (!profileDirty && !managedDirty) return undefined;
    const preventDataLoss = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventDataLoss);
    return () => window.removeEventListener('beforeunload', preventDataLoss);
  }, [managedDirty, profileDirty]);

  const updateField = (key, value) => setForm((current) => {
    if (key === 'estado_disponibilidad' && value === 'SIN_ESTADO') {
      return { ...current, estado_disponibilidad: value, estado_hasta: '', mensaje_estado: '' };
    }
    return { ...current, [key]: value };
  });

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await axios.patch(`${API_URL}/profile/me`, {
        ...form,
        estado_hasta: form.estado_hasta ? new Date(form.estado_hasta).toISOString() : null
      });
      applyProfile(data.profile);
      await refreshUser();
      notify('Perfil actualizado.', 'success');
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible actualizar el perfil.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (category, blob, sourceFile) => {
    setSaving(true);
    try {
      const [dataUrl, sourceDataUrl] = await Promise.all([
        blobAsDataUrl(blob),
        blobAsDataUrl(sourceFile || blob)
      ]);
      const endpointName = category === 'avatar' ? 'avatar' : 'cover';
      const { data } = await axios.post(`${API_URL}/profile/me/${endpointName}`, {
        data_url: dataUrl,
        source_data_url: sourceDataUrl
      });
      applyProfile(data.profile);
      await refreshUser();
      notify(data.message, 'success');
      setImageEditor(null);
    } catch (error) {
      const message = getApiErrorMessage(error, getSafeErrorMessage(error, 'No fue posible guardar la imagen.'));
      notify(message, 'error');
      throw new Error(message, { cause: error });
    } finally {
      setSaving(false);
    }
  };

  const selectImage = async (category, event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await validateProfileImageFile(file);
      setImageEditor({ category, file });
    } catch (error) {
      notify(getSafeErrorMessage(error, 'La imagen seleccionada no es válida.'), 'error');
    }
  };

  const editExistingImage = async (category) => {
    const sourcePath = category === 'avatar'
      ? (profile.avatar_source_url || profile.avatar_full_url)
      : (profile.portada_source_url || profile.portada_url);
    if (!sourcePath) return;
    setMediaLoading(category);
    try {
      const response = await axios.get(resolveApiAssetUrl(sourcePath), { responseType: 'blob' });
      const mimeType = response.data.type || 'image/webp';
      const file = new File([response.data], `${category}-actual.webp`, { type: mimeType });
      setImageEditor({ category, file, existing: true });
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible abrir la imagen para editarla.'), 'error');
    } finally {
      setMediaLoading('');
    }
  };

  const deleteImage = async (category) => {
    const accepted = await confirm({
      title: category === 'avatar' ? 'Quitar foto de perfil' : 'Quitar portada',
      message: 'La imagen se retirará del perfil. Podrás subir otra cuando quieras.',
      confirmLabel: 'Quitar imagen',
      danger: true
    });
    if (!accepted) return;
    setSaving(true);
    try {
      const endpointName = category === 'avatar' ? 'avatar' : 'cover';
      const { data } = await axios.delete(`${API_URL}/profile/me/${endpointName}`);
      applyProfile(data.profile);
      await refreshUser();
      notify('Imagen eliminada.', 'success');
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible quitar la imagen.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveManagedProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await axios.patch(`${API_URL}/profiles/${profile.usuario_id}`, managedForm);
      applyProfile(data.profile);
      notify(data.message, 'success');
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible actualizar la configuración institucional.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="route-loader" role="status">Cargando perfil...</div>;
  if (!profile) return null;

  const coverUrl = resolveApiAssetUrl(profile.portada_url);
  const statusLabel = STATUS_OPTIONS.find(([value]) => value === profile.estado_disponibilidad)?.[1] || 'Sin estado';

  return (
    <main className="staff-profile-page">
      <ModuleHeader
        icon={UserRound}
        title={ownProfile ? 'Mi perfil' : profile.nombre_mostrado}
        description={ownProfile ? 'Tu presentación dentro del equipo institucional.' : 'Ficha interna del personal autorizado.'}
        onBack={() => navigate(directoryMode ? '/directorio' : '/admin')}
        backLabel={directoryMode ? 'Directorio' : 'Panel principal'}
      />

      <section className="staff-profile-hero" aria-label="Presentación del perfil" data-tour="staff-profile-hero">
        <div
          className="staff-profile-cover"
          style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
        >
          {canEdit && (
            <div className="staff-profile-media-actions staff-profile-media-actions--cover">
              <button type="button" onClick={() => coverInputRef.current?.click()} disabled={saving}><ImagePlus size={17} /> Cambiar portada</button>
              {profile.portada_url && <button type="button" onClick={() => editExistingImage('cover')} disabled={saving || mediaLoading === 'cover'}><Crop size={17} /> {mediaLoading === 'cover' ? 'Abriendo…' : 'Reencuadrar'}</button>}
              {profile.portada_url && <button type="button" onClick={() => deleteImage('cover')} disabled={saving}><Trash2 size={17} /> Quitar</button>}
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Seleccionar imagen de portada" hidden onChange={(event) => selectImage('cover', event)} />
            </div>
          )}
        </div>
        <div className="staff-profile-identity">
          <div className="staff-profile-avatar-wrap">
            <StaffAvatar profile={profile} name={profile.nombre_mostrado} size="xl" />
            {canEdit && (
              <button type="button" className="staff-profile-avatar-edit" onClick={() => avatarInputRef.current?.click()} disabled={saving} aria-label="Cambiar foto de perfil">
                <Camera size={18} />
              </button>
            )}
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Seleccionar foto de perfil" hidden onChange={(event) => selectImage('avatar', event)} />
          </div>
          <div className="staff-profile-heading">
            <span className="staff-status" data-status={profile.estado_disponibilidad}>{statusLabel}</span>
            <h2>{profile.nombre_mostrado}</h2>
            <p>{profile.cargo || profile.perfil_acceso}{profile.area ? ` · ${profile.area}` : ''}</p>
            {profile.mensaje_estado && <blockquote>{profile.mensaje_estado}</blockquote>}
          </div>
          {canEdit && profile.avatar_url && (
            <div className="staff-profile-avatar-actions">
              <button type="button" className="staff-text-action" onClick={() => editExistingImage('avatar')} disabled={saving || mediaLoading === 'avatar'}><Crop size={16} /> {mediaLoading === 'avatar' ? 'Abriendo…' : 'Editar encuadre'}</button>
              <button type="button" className="staff-text-action" onClick={() => deleteImage('avatar')} disabled={saving}><Trash2 size={16} /> Quitar foto</button>
            </div>
          )}
        </div>
      </section>

      {imageEditor && (
        <ProfileImageEditor
          category={imageEditor.category}
          file={imageEditor.file}
          onCancel={() => { if (!saving) setImageEditor(null); }}
          onSave={(blob) => uploadImage(imageEditor.category, blob, imageEditor.file)}
        />
      )}

      {canEdit ? (
        <form className="staff-profile-editor" onSubmit={saveProfile} data-tour="staff-profile-editor">
          <section className="staff-profile-section">
            <div className="staff-profile-section__heading">
              <span>01</span><div><h2>Presentación</h2><p>Información breve para que el equipo pueda reconocerte y ubicarte.</p></div>
            </div>
            <div className="staff-form-grid">
              <label><span>Nombre mostrado</span><input value={form.nombre_mostrado} maxLength={120} onChange={(event) => updateField('nombre_mostrado', event.target.value)} placeholder={profile.nombre_oficial || 'Nombre y apellidos'} /></label>
              <label className="staff-field--wide"><span>Descripción</span><textarea value={form.biografia} maxLength={600} rows={4} onChange={(event) => updateField('biografia', event.target.value)} placeholder="Cuenta brevemente tu función dentro del establecimiento." /></label>
            </div>
          </section>

          <section className="staff-profile-section">
            <div className="staff-profile-section__heading">
              <span>02</span><div><h2>Disponibilidad</h2><p>Indica si pueden contactarte ahora y, si corresponde, hasta cuándo.</p></div>
            </div>
            <div className="staff-form-grid staff-form-grid--three">
              <label><span>Estado</span><select value={form.estado_disponibilidad} onChange={(event) => updateField('estado_disponibilidad', event.target.value)}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Vigente hasta</span><input type="datetime-local" value={form.estado_hasta} disabled={form.estado_disponibilidad === 'SIN_ESTADO'} onChange={(event) => updateField('estado_hasta', event.target.value)} /></label>
              <label className="staff-field--wide"><span>Mensaje breve</span><input value={form.mensaje_estado} maxLength={180} onChange={(event) => updateField('mensaje_estado', event.target.value)} placeholder="Ej: En reunión hasta las 12:30" /></label>
            </div>
          </section>

          <section className="staff-profile-section">
            <div className="staff-profile-section__heading">
              <span>03</span><div><h2>Contacto interno</h2><p>Datos laborales, no personales, para coordinación dentro del liceo.</p></div>
            </div>
            <div className="staff-form-grid staff-form-grid--three">
              <label><span>Ubicación u oficina</span><input value={form.ubicacion} maxLength={160} onChange={(event) => updateField('ubicacion', event.target.value)} placeholder="Ej: Inspectoría, primer piso" /></label>
              <label><span>Anexo</span><input value={form.anexo} maxLength={30} onChange={(event) => updateField('anexo', event.target.value)} placeholder="Ej: 204" /></label>
              <label><span>Teléfono institucional</span><input value={form.telefono_interno} maxLength={40} onChange={(event) => updateField('telefono_interno', event.target.value)} placeholder="Ej: +56 41 000 0000" /></label>
              <label className="staff-field--wide"><span>Horario de trabajo</span><input value={form.horario_trabajo} maxLength={180} onChange={(event) => updateField('horario_trabajo', event.target.value)} placeholder="Ej: Lunes a viernes, 08:00 a 17:00" /></label>
              <label className="staff-checkbox staff-field--wide"><input type="checkbox" checked={form.mostrar_contacto} onChange={(event) => updateField('mostrar_contacto', event.target.checked)} /><span>Mostrar estos datos a quienes pueden consultar el directorio interno.</span></label>
            </div>
          </section>

          <div className="staff-profile-savebar">
            <span data-dirty={profileDirty || undefined}><ShieldCheck size={17} /> {profileDirty ? 'Tienes cambios sin guardar.' : 'Todo está guardado y queda registrado en auditoría.'}</span>
            <button type="submit" disabled={saving || !profileDirty}><Save size={18} /> {saving ? 'Guardando...' : profileDirty ? 'Guardar perfil' : 'Perfil guardado'}</button>
          </div>
        </form>
      ) : (
        <><section className="staff-profile-readonly">
          {profile.biografia && <div className="staff-profile-about"><span className="section-kicker">Perfil institucional</span><p>{profile.biografia}</p></div>}
          <dl className="staff-profile-facts">
            <div><dt><BriefcaseBusiness size={18} /> Cargo</dt><dd>{profile.cargo || 'No informado'}</dd></div>
            <div><dt><Building2 size={18} /> Área</dt><dd>{profile.area || 'No informada'}</dd></div>
            {profile.ubicacion && <div><dt><MapPin size={18} /> Ubicación</dt><dd>{profile.ubicacion}</dd></div>}
            {profile.horario_trabajo && <div><dt><Clock3 size={18} /> Horario</dt><dd>{profile.horario_trabajo}</dd></div>}
            {profile.correo && <div><dt><Mail size={18} /> Correo</dt><dd>{profile.correo}</dd></div>}
            {(profile.telefono_interno || profile.anexo) && <div><dt><Phone size={18} /> Contacto</dt><dd>{profile.telefono_interno || `Anexo ${profile.anexo}`}</dd></div>}
          </dl>
        </section>
        {canManage && (
          <form className="staff-profile-admin" onSubmit={saveManagedProfile} data-tour="staff-profile-admin">
            <div className="staff-profile-section__heading"><span><Settings2 size={18} /></span><div><h2>Configuración institucional</h2><p>Estos datos los controla administración y no reemplazan el cargo ni los permisos de acceso.</p></div></div>
            <div className="staff-form-grid">
              <label><span>Área o unidad</span><input value={managedForm.area} maxLength={120} onChange={(event) => setManagedForm((current) => ({ ...current, area: event.target.value }))} placeholder="Ej: Inspectoría General" /></label>
              <label className="staff-checkbox"><input type="checkbox" checked={managedForm.visible_directorio} onChange={(event) => setManagedForm((current) => ({ ...current, visible_directorio: event.target.checked }))} /><span>Mostrar esta ficha en el directorio interno.</span></label>
              <label className="staff-checkbox"><input type="checkbox" checked={managedForm.cuenta_compartida} onChange={(event) => setManagedForm((current) => ({ ...current, cuenta_compartida: event.target.checked }))} /><span>Es una cuenta compartida o de puesto; sin foto usará el escudo institucional.</span></label>
              <button type="submit" className="staff-admin-save" disabled={saving || !managedDirty}><Save size={17} /> {managedDirty ? 'Guardar configuración' : 'Configuración guardada'}</button>
            </div>
          </form>
        )}</>
      )}
    </main>
  );
};

export default StaffProfile;
