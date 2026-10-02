import { useEffect, useId, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Bell, BellOff, Camera, Clock3, LogOut, MessageCircle, Plus, Save, ShieldCheck, Trash2, Users, UserRound, X } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';
import { requestPwaNotifications } from '../pwa/registerServiceWorker';
import { PERMISSIONS, hasPermission } from '../permissions';
import { getApiErrorMessage } from '../utils/apiError';
import { useChatWorkspace } from '../context/ChatWorkspaceContext';
import '../styles/chat-group-settings.css';

const API = '/api/chat';
const MAX_PHOTO_SIZE = 4 * 1024 * 1024;
const ROLE_LABELS = { PROPIETARIO: 'Propietario', MODERADOR: 'Administrador', MIEMBRO: 'Integrante' };
const localDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localValue = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000));
  return localValue.toISOString().slice(0, 16);
};

const ChatSettingsPanel = ({ conversation, directory = [], user, onClose, onUpdated, onLeft }) => {
  const { notify, confirm } = useFeedback();
  const { isCurrentSession } = useChatWorkspace();
  const panelId = useId();
  const closeRef = useRef(null);
  const bodyRef = useRef(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const photoReaderRef = useRef(null);
  const [activeTab, setActiveTab] = useState('avisos');
  const [preferences, setPreferences] = useState({
    notificaciones: conversation.notificaciones || 'TODAS',
    horario_silencio_desde: conversation.horario_silencio_desde?.slice(0, 5) || '',
    horario_silencio_hasta: conversation.horario_silencio_hasta?.slice(0, 5) || '',
    silenciado_hasta: localDateTime(conversation.silenciado_hasta)
  });
  const [retention, setRetention] = useState(conversation.retencion_dias ?? '');
  const [group, setGroup] = useState({
    nombre: conversation.nombre || conversation.titulo || '',
    descripcion: conversation.descripcion || '',
    solo_administradores: Boolean(conversation.solo_administradores)
  });
  // undefined keeps the current photo; null explicitly removes it.
  const [photoData, setPhotoData] = useState(undefined);
  const [photoError, setPhotoError] = useState('');
  const [photoReading, setPhotoReading] = useState(false);
  const [brokenPhoto, setBrokenPhoto] = useState('');
  const [newMember, setNewMember] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const members = conversation.members || [];
  const memberIds = useMemo(() => new Set((conversation.members || []).map((member) => Number(member.usuario_id))), [conversation.members]);
  const candidates = directory.filter((person) => !memberIds.has(Number(person.id)));
  const isGroup = conversation.tipo !== 'DIRECTA';
  const managed = Boolean(conversation.codigo_institucional);
  const isOwner = !managed && conversation.miembro_rol === 'PROPIETARIO';
  const managesConversation = ['PROPIETARIO', 'MODERADOR'].includes(conversation.miembro_rol);
  const managesGroup = !managed && isGroup && managesConversation;
  const canConfigureRetention = !managed && managesConversation && hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE);
  const ownerCount = members.filter((member) => member.rol === 'PROPIETARIO').length;
  const isLastOwner = isOwner && ownerCount < 2;
  const endpoint = `${API}/conversaciones/${conversation.id_conversacion}`;
  const storedPhoto = conversation.foto_version ? `${endpoint}/foto?v=${encodeURIComponent(conversation.foto_version)}` : '';
  const photoUrl = photoData === undefined ? storedPhoto : photoData || '';
  const tabs = [{ id: 'avisos', label: 'Avisos' }, ...(isGroup ? [{ id: 'grupo', label: 'Grupo' }, { id: 'integrantes', label: 'Integrantes' }] : [])];
  const canContinue = () => mountedRef.current && isCurrentSession();

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    return () => {
      mountedRef.current = false;
      photoReaderRef.current?.abort();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const runAction = async (action, fallback) => {
    if (busyRef.current || photoReading || !canContinue()) return;
    busyRef.current = true;
    setSaving(true);
    setErrorMessage('');
    try { await action(); }
    catch (error) {
      if (canContinue()) setErrorMessage(getApiErrorMessage(error, fallback));
    } finally {
      busyRef.current = false;
      if (canContinue()) setSaving(false);
    }
  };

  const savePreferences = () => runAction(async () => {
    await axios.patch(`${endpoint}/preferencias`, {
      ...preferences,
      horario_silencio_desde: preferences.horario_silencio_desde || null,
      horario_silencio_hasta: preferences.horario_silencio_hasta || null,
      silenciado_hasta: preferences.silenciado_hasta ? new Date(preferences.silenciado_hasta).toISOString() : null
    });
    if (!canContinue()) return;
    if (canConfigureRetention) await axios.patch(`${endpoint}/configuracion`, {
      retencion_dias: retention === '' ? null : Number(retention)
    });
    if (!canContinue()) return;
    notify('Preferencias de conversación guardadas.', 'success');
    await onUpdated();
    if (canContinue()) onClose();
  }, 'No fue posible guardar las preferencias. Tus cambios siguen aquí para reintentar.');

  const requestAlerts = async () => {
    const result = await requestPwaNotifications();
    if (!canContinue()) return;
    if (result === 'granted') notify('Los avisos del navegador quedaron habilitados.', 'success');
    else if (result === 'denied') notify('El navegador bloqueó los avisos. Puedes habilitarlos desde los permisos del sitio.', 'error');
    else notify('Los avisos requieren HTTPS o localhost.', 'error');
  };

  const selectPhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !managesGroup || busyRef.current || !canContinue()) return;
    photoReaderRef.current?.abort();
    setPhotoError('');
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setPhotoReading(false);
      setPhotoError('Elige una foto JPG o PNG.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setPhotoReading(false);
      setPhotoError('La foto supera los 4 MB. Elige una imagen más pequeña.');
      return;
    }
    const reader = new FileReader();
    photoReaderRef.current = reader;
    setPhotoReading(true);
    reader.onload = () => {
      if (photoReaderRef.current !== reader || !canContinue()) return;
      setPhotoData(String(reader.result));
      setBrokenPhoto('');
      setPhotoReading(false);
    };
    reader.onerror = () => {
      if (photoReaderRef.current !== reader || !canContinue()) return;
      setPhotoReading(false);
      setPhotoError('No pudimos leer la foto. Vuelve a seleccionarla.');
    };
    reader.readAsDataURL(file);
  };

  const saveGroup = () => {
    if (!managesGroup) return;
    if (!group.nombre.trim()) { setErrorMessage('Escribe un nombre para el grupo.'); return; }
    if (photoError) return;
    return runAction(async () => {
      await axios.patch(`${endpoint}/grupo`, {
        nombre: group.nombre.trim(), descripcion: group.descripcion.trim(),
        solo_administradores: group.solo_administradores,
        ...(photoData !== undefined ? { foto_data: photoData } : {})
      });
      if (!canContinue()) return;
      await onUpdated();
      if (!canContinue()) return;
      setPhotoData(undefined);
      notify('Información del grupo actualizada.', 'success');
    }, 'No fue posible actualizar el grupo. Tus cambios siguen aquí para reintentar.');
  };

  const addMember = () => {
    if (!newMember || !managesGroup) return;
    return runAction(async () => {
      await axios.post(`${endpoint}/miembros`, { miembros: [Number(newMember)] });
      if (!canContinue()) return;
      setNewMember('');
      await onUpdated();
      if (canContinue()) notify('Persona incorporada a la conversación.', 'success');
    }, 'No fue posible incorporar a la persona.');
  };

  const mayRemove = (member) => managesGroup && Number(member.usuario_id) !== Number(user.id)
    && (isOwner || !['PROPIETARIO', 'MODERADOR'].includes(member.rol))
    && !(member.rol === 'PROPIETARIO' && ownerCount < 2);

  const removeMember = (member) => {
    if (!mayRemove(member)) return;
    return runAction(async () => {
      const accepted = await confirm({ title: 'Retirar de la conversación', message: `${member.nombre} dejará de acceder al grupo. El historial institucional se conserva.`, confirmLabel: 'Retirar', danger: true });
      if (!accepted || !canContinue()) return;
      await axios.delete(`${endpoint}/miembros/${member.usuario_id}`);
      if (!canContinue()) return;
      await onUpdated();
      if (canContinue()) notify('Persona retirada de la conversación.', 'success');
    }, 'No fue posible retirar a la persona.');
  };

  const changeRole = (member, role) => {
    if (!isGroup || !isOwner || role === member.rol || (member.rol === 'PROPIETARIO' && ownerCount < 2)) return;
    return runAction(async () => {
      const self = Number(member.usuario_id) === Number(user.id);
      const accepted = await confirm({
        title: 'Cambiar rol en el grupo',
        message: `${member.nombre} tendrá el rol de ${ROLE_LABELS[role].toLocaleLowerCase('es')}.${self && role !== 'PROPIETARIO' ? ' Dejarás de poder administrar los roles del grupo.' : ''}`,
        confirmLabel: 'Cambiar rol'
      });
      if (!accepted || !canContinue()) return;
      await axios.patch(`${endpoint}/miembros/${member.usuario_id}/rol`, { rol: role });
      if (!canContinue()) return;
      await onUpdated();
      if (canContinue()) notify('Rol del grupo actualizado.', 'success');
    }, 'No fue posible cambiar el rol.');
  };

  const leaveGroup = () => {
    if (!isGroup || managed || isLastOwner) return;
    return runAction(async () => {
      const accepted = await confirm({ title: 'Salir del grupo', message: 'Dejarás de acceder a esta conversación. Tus mensajes permanecerán en el historial institucional.', confirmLabel: 'Salir del grupo', danger: true });
      if (!accepted || !canContinue()) return;
      await axios.delete(`${endpoint}/miembros/${user.id}`);
      if (!canContinue()) return;
      notify('Has salido del grupo.', 'success');
      if (onLeft) await onLeft();
      else onClose();
    }, 'No fue posible salir del grupo.');
  };

  const selectTab = (id) => {
    setActiveTab(id);
    bodyRef.current?.scrollTo({ top: 0 });
  };
  const handleTabsKey = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next].id);
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  };

  return <aside className="chat-settings-panel chat-group-settings" aria-label="Preferencias de la conversación" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <header><div><span className="section-kicker">Conversación</span><h3>Preferencias y equipo</h3></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar preferencias"><X /></button></header>
    <div className="chat-group-settings__tabs" role="tablist" aria-label="Opciones de conversación" onKeyDown={handleTabsKey}>
      {tabs.map((tab) => <button key={tab.id} id={`${panelId}-${tab.id}`} role="tab" type="button" aria-selected={activeTab === tab.id} aria-controls={`${panelId}-content`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => selectTab(tab.id)}>{tab.label}</button>)}
    </div>
    <div ref={bodyRef} className="chat-group-settings__body" role="tabpanel" id={`${panelId}-content`} aria-labelledby={`${panelId}-${activeTab}`} tabIndex={0}>
      {managed && <p role="note">Canal institucional automático. Su nombre, integrantes, roles y retención se administran desde los equipos institucionales. Aquí puedes consultar el grupo y cambiar tus avisos personales.</p>}
      {errorMessage && <p className="chat-group-settings__error" role="alert">{errorMessage}</p>}
      {activeTab === 'avisos' && <>
        <section><h4><Bell size={17} /> Avisos para ti</h4><p>Estos ajustes solo cambian cómo recibes los avisos de esta conversación.</p><div className="chat-settings-panel__choices">
          {[["TODAS", Bell, 'Todos'], ['MENCIONES', MessageCircle, 'Menciones'], ['SILENCIADAS', BellOff, 'Silenciadas']].map(([value, Icon, label]) => <button type="button" key={value} aria-pressed={preferences.notificaciones === value} disabled={saving} className={preferences.notificaciones === value ? 'active' : ''} onClick={() => setPreferences({ ...preferences, notificaciones: value })}><Icon size={16} />{label}</button>)}
        </div><button type="button" className="chat-settings-panel__link" onClick={requestAlerts}>Habilitar avisos del navegador</button></section>
        <section><h4><Clock3 size={17} /> Horario de silencio</h4><div className="chat-settings-panel__time"><label>Desde<input type="time" disabled={saving} value={preferences.horario_silencio_desde} onChange={(event) => setPreferences({ ...preferences, horario_silencio_desde: event.target.value })} /></label><label>Hasta<input type="time" disabled={saving} value={preferences.horario_silencio_hasta} onChange={(event) => setPreferences({ ...preferences, horario_silencio_hasta: event.target.value })} /></label></div><label>Silenciar excepcionalmente hasta<input type="datetime-local" disabled={saving} value={preferences.silenciado_hasta} onChange={(event) => setPreferences({ ...preferences, silenciado_hasta: event.target.value })} /></label><p>Los mensajes urgentes omiten el horario programado, pero respetan “Silenciadas” y el silencio excepcional.</p></section>
        {canConfigureRetention && <section><h4><ShieldCheck size={17} /> Retención de esta conversación</h4><label>Días antes de retirar el contenido<input type="number" min="30" max="3650" disabled={saving} placeholder="Usar política general" value={retention} onChange={(event) => setRetention(event.target.value)} /></label><p>Vacío usa la política general. Los mensajes fijados pueden quedar protegidos según esa política.</p></section>}
      </>}
      {activeTab === 'grupo' && <>
        <section className="chat-group-settings__identity">
          <div className="chat-group-settings__photo">{photoUrl && photoUrl !== brokenPhoto ? <img src={photoUrl} alt="Foto del grupo" onError={() => setBrokenPhoto(photoUrl)} /> : <Users size={30} aria-hidden="true" />}</div>
          {managesGroup && <div className="chat-group-settings__photo-actions"><label className="chat-group-settings__photo-picker"><Camera size={16} /> Cambiar foto<input type="file" accept="image/jpeg,image/png" aria-label="Foto del grupo" disabled={saving || photoReading} onChange={selectPhoto} /></label>{photoUrl && <button type="button" onClick={() => { photoReaderRef.current?.abort(); setPhotoData(null); setPhotoReading(false); setPhotoError(''); }} disabled={saving || photoReading}>Quitar foto</button>}</div>}
          {managesGroup && <p>JPG o PNG, hasta 4 MB. Se aplica al guardar los cambios del grupo.</p>}
          {photoReading && <p role="status">Preparando foto…</p>}
          {photoError && <p className="chat-group-settings__error" role="alert">{photoError}</p>}
        </section>
        <section>{managesGroup ? <>
          <label>Nombre del grupo<input type="text" maxLength={180} disabled={saving} value={group.nombre} onChange={(event) => setGroup({ ...group, nombre: event.target.value })} /></label>
          <label><span id={`${panelId}-description-label`}>Descripción del grupo</span><textarea aria-labelledby={`${panelId}-description-label`} rows={3} maxLength={500} disabled={saving} value={group.descripcion} onChange={(event) => setGroup({ ...group, descripcion: event.target.value })} placeholder="Para qué usamos esta conversación" /></label>
          <label className="chat-group-settings__toggle"><input type="checkbox" aria-labelledby={`${panelId}-administrators-label`} aria-describedby={`${panelId}-administrators-help`} checked={group.solo_administradores} disabled={saving} onChange={(event) => setGroup({ ...group, solo_administradores: event.target.checked })} /><span><span id={`${panelId}-administrators-label`}>Solo administradores pueden enviar mensajes</span><small id={`${panelId}-administrators-help`}>Propietarios y administradores podrán escribir y adjuntar archivos. Los demás integrantes podrán leer.</small></span></label>
        </> : <><h4>{conversation.nombre || conversation.titulo}</h4><p>{conversation.descripcion || 'Sin descripción del grupo.'}</p><p>{conversation.solo_administradores ? 'Solo propietarios y administradores pueden enviar mensajes.' : 'Todos los integrantes pueden enviar mensajes.'}</p><p>Solo los propietarios y administradores pueden editar el grupo.</p></>}</section>
      </>}
      {activeTab === 'integrantes' && <section>
        <h4><UserRound size={17} /> {members.length} {members.length === 1 ? 'integrante' : 'integrantes'}</h4>
        <p>{isOwner ? 'Puedes asignar administradores o compartir la propiedad. El grupo siempre debe conservar al menos un propietario.' : managesGroup ? 'Puedes incorporar personas y retirar integrantes. Los propietarios administran los roles.' : 'Los propietarios y administradores coordinan este grupo.'}</p>
        <div className="chat-settings-panel__members">{members.map((member) => {
          const lastOwner = member.rol === 'PROPIETARIO' && ownerCount < 2;
          return <div key={member.usuario_id} className="chat-group-settings__member">
            <span className="chat-group-settings__member-name"><strong>{member.nombre}{Number(member.usuario_id) === Number(user.id) ? ' (tú)' : ''}</strong><small>{ROLE_LABELS[member.rol] || 'Integrante'}{member.cargo || member.perfil_nombre ? ` · ${member.cargo || member.perfil_nombre}` : ''}</small></span>
            {(isOwner || mayRemove(member)) && <div className="chat-group-settings__member-actions">{isOwner && <select aria-label={`Rol de ${member.nombre}`} value={member.rol || 'MIEMBRO'} disabled={saving || lastOwner} onChange={(event) => changeRole(member, event.target.value)}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}{mayRemove(member) && <button type="button" onClick={() => removeMember(member)} disabled={saving} aria-label={`Retirar a ${member.nombre}`}><Trash2 size={16} /></button>}</div>}
          </div>;
        })}</div>
        {managesGroup && candidates.length > 0 && <div className="chat-settings-panel__add"><label>Incorporar a una persona<select value={newMember} disabled={saving} onChange={(event) => setNewMember(event.target.value)}><option value="">Seleccionar persona</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.nombre}{person.cargo ? ` · ${person.cargo}` : ''}</option>)}</select></label><button type="button" onClick={addMember} disabled={!newMember || saving}><Plus size={16} /> Agregar</button></div>}
        {isLastOwner && <p>Para salir, primero asigna otro propietario desde el rol de un integrante.</p>}
      </section>}
    </div>
    <footer>
      {activeTab === 'integrantes' && !managed && <button type="button" className="chat-group-settings__leave" onClick={leaveGroup} disabled={saving || isLastOwner}><LogOut size={16} /> Salir del grupo</button>}
      <button type="button" className="app-action app-action--secondary" onClick={onClose}>{activeTab === 'avisos' || (activeTab === 'grupo' && managesGroup) ? 'Cancelar' : 'Cerrar'}</button>
      {activeTab === 'avisos' && <button type="button" className="app-action app-action--primary" onClick={savePreferences} disabled={saving || photoReading}><Save size={16} /> {saving ? 'Guardando…' : 'Guardar'}</button>}
      {activeTab === 'grupo' && managesGroup && <button type="button" className="app-action app-action--primary" onClick={saveGroup} disabled={saving || photoReading || Boolean(photoError)}><Save size={16} /> {saving ? 'Guardando…' : 'Guardar grupo'}</button>}
    </footer>
  </aside>;
};

export default ChatSettingsPanel;
