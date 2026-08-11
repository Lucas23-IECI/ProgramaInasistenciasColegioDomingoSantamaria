import { useMemo, useState } from 'react';
import axios from 'axios';
import { Bell, BellOff, Clock3, MessageCircle, Plus, Save, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';
import { requestPwaNotifications } from '../pwa/registerServiceWorker';
import { PERMISSIONS, hasPermission } from '../permissions';

const API = '/api/chat';
const messageOf = (error, fallback) => error.response?.data?.message || fallback;
const localDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localValue = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000));
  return localValue.toISOString().slice(0, 16);
};

const ChatSettingsPanel = ({ conversation, directory, user, onClose, onUpdated }) => {
  const { notify, confirm } = useFeedback();
  const [preferences, setPreferences] = useState({
    notificaciones: conversation.notificaciones || 'TODAS',
    horario_silencio_desde: conversation.horario_silencio_desde?.slice(0, 5) || '',
    horario_silencio_hasta: conversation.horario_silencio_hasta?.slice(0, 5) || '',
    silenciado_hasta: localDateTime(conversation.silenciado_hasta)
  });
  const [retention, setRetention] = useState(conversation.retencion_dias ?? '');
  const [newMember, setNewMember] = useState('');
  const [saving, setSaving] = useState(false);
  const memberIds = useMemo(() => new Set((conversation.members || []).map((member) => Number(member.usuario_id))), [conversation.members]);
  const candidates = directory.filter((person) => !memberIds.has(Number(person.id)));
  const managesConversation = ['PROPIETARIO', 'MODERADOR'].includes(conversation.miembro_rol);
  const canConfigureRetention = managesConversation && hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE);

  const savePreferences = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/conversaciones/${conversation.id_conversacion}/preferencias`, {
        ...preferences,
        horario_silencio_desde: preferences.horario_silencio_desde || null,
        horario_silencio_hasta: preferences.horario_silencio_hasta || null,
        silenciado_hasta: preferences.silenciado_hasta ? new Date(preferences.silenciado_hasta).toISOString() : null
      });
      if (canConfigureRetention) await axios.patch(`${API}/conversaciones/${conversation.id_conversacion}/configuracion`, {
        retencion_dias: retention === '' ? null : Number(retention)
      });
      notify('Preferencias de conversación guardadas.', 'success');
      await onUpdated();
      onClose();
    } catch (error) { notify(messageOf(error, 'No fue posible guardar las preferencias.'), 'error'); }
    finally { setSaving(false); }
  };

  const requestAlerts = async () => {
    const result = await requestPwaNotifications();
    if (result === 'granted') notify('Los avisos del navegador quedaron habilitados.', 'success');
    else if (result === 'denied') notify('El navegador bloqueó los avisos. Puedes habilitarlos desde los permisos del sitio.', 'error');
    else notify('Los avisos requieren HTTPS o localhost.', 'error');
  };

  const addMember = async () => {
    if (!newMember) return;
    setSaving(true);
    try {
      await axios.post(`${API}/conversaciones/${conversation.id_conversacion}/miembros`, { miembros: [Number(newMember)] });
      setNewMember(''); notify('Persona incorporada a la conversación.', 'success'); await onUpdated();
    } catch (error) { notify(messageOf(error, 'No fue posible incorporar a la persona.'), 'error'); }
    finally { setSaving(false); }
  };

  const removeMember = async (member) => {
    if (!await confirm({ title: 'Retirar de la conversación', message: `${member.nombre} dejará de ver nuevos mensajes, pero el historial institucional se conserva.`, confirmLabel: 'Retirar' })) return;
    try {
      await axios.delete(`${API}/conversaciones/${conversation.id_conversacion}/miembros/${member.usuario_id}`);
      notify('Persona retirada de la conversación.', 'success'); await onUpdated();
    } catch (error) { notify(messageOf(error, 'No fue posible retirar a la persona.'), 'error'); }
  };

  return <aside className="chat-settings-panel" aria-label="Preferencias de la conversación">
    <header><div><span className="section-kicker">Conversación</span><h3>Preferencias y equipo</h3></div><button type="button" onClick={onClose} aria-label="Cerrar preferencias"><X /></button></header>
    <section><h4><Bell size={17} /> Avisos</h4><div className="chat-settings-panel__choices">
      {[["TODAS", Bell, 'Todos'], ['MENCIONES', MessageCircle, 'Menciones'], ['SILENCIADAS', BellOff, 'Silenciadas']].map(([value, Icon, label]) => <button type="button" key={value} className={preferences.notificaciones === value ? 'active' : ''} onClick={() => setPreferences({ ...preferences, notificaciones: value })}><Icon size={16} />{label}</button>)}
    </div><button type="button" className="chat-settings-panel__link" onClick={requestAlerts}>Habilitar avisos del navegador</button></section>
    <section><h4><Clock3 size={17} /> Horario de silencio</h4><div className="chat-settings-panel__time"><label>Desde<input type="time" value={preferences.horario_silencio_desde} onChange={(event) => setPreferences({ ...preferences, horario_silencio_desde: event.target.value })} /></label><label>Hasta<input type="time" value={preferences.horario_silencio_hasta} onChange={(event) => setPreferences({ ...preferences, horario_silencio_hasta: event.target.value })} /></label></div><label>Silenciar excepcionalmente hasta<input type="datetime-local" value={preferences.silenciado_hasta} onChange={(event) => setPreferences({ ...preferences, silenciado_hasta: event.target.value })} /></label><p>Los mensajes urgentes omiten el horario programado, pero respetan “Silenciadas” y el silencio excepcional.</p></section>
    {canConfigureRetention && <section><h4><ShieldCheck size={17} /> Retención de esta conversación</h4><label>Días antes de retirar el contenido<input type="number" min="30" max="3650" placeholder="Usar política general" value={retention} onChange={(event) => setRetention(event.target.value)} /></label><p>Vacío usa la política general. Los mensajes fijados pueden quedar protegidos según esa política.</p></section>}
    {managesConversation && conversation.tipo !== 'DIRECTA' && <section><h4><UserRound size={17} /> Integrantes</h4><div className="chat-settings-panel__members">{conversation.members.map((member) => <div key={member.usuario_id}><span><strong>{member.nombre}</strong><small>{member.rol} · {member.cargo || member.perfil_nombre}</small></span>{Number(member.usuario_id) !== Number(user.id) && <button type="button" onClick={() => removeMember(member)} aria-label={`Retirar a ${member.nombre}`}><Trash2 size={15} /></button>}</div>)}</div>{candidates.length > 0 && <div className="chat-settings-panel__add"><select value={newMember} onChange={(event) => setNewMember(event.target.value)}><option value="">Seleccionar persona</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.nombre} · {person.cargo}</option>)}</select><button type="button" onClick={addMember} disabled={!newMember || saving}><Plus size={16} /> Agregar</button></div>}</section>}
    <footer><button type="button" className="app-action app-action--secondary" onClick={onClose}>Cancelar</button><button type="button" className="app-action app-action--primary" onClick={savePreferences} disabled={saving}><Save size={16} /> {saving ? 'Guardando…' : 'Guardar'}</button></footer>
  </aside>;
};

export default ChatSettingsPanel;
