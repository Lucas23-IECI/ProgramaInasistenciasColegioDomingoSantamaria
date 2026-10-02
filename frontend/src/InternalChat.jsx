import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './styles/internal-chat.css';
import axios from 'axios';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronLeft,
  CirclePlus,
  Hash,
  MessageCircle,
  MoreHorizontal,
  Minimize2,
  Paperclip,
  Palette,
  Pin,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  UsersRound,
  X
} from 'lucide-react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { PERMISSIONS, hasPermission } from './permissions';
import ChatSettingsPanel from './components/ChatSettingsPanel';
import ChatRetentionDialog from './components/ChatRetentionDialog';
import ChatAppearanceDialog from './components/ChatAppearanceDialog';
import { ChatAvatar, ChatAttachment } from './components/ChatMedia';
import { subscribeToChatRealtime } from './pwa/chatRealtime';
import { getApiErrorMessage } from './utils/apiError';
import { contextMeta, contextQueryFromConversation, safeInternalPath } from './utils/chatContext';
import { useChatWorkspace } from './context/ChatWorkspaceContext';

const API = '/api/chat';
const messageOf = getApiErrorMessage;
const contextFromParams = (params) => {
  if (!params.get('contexto_id')) return null;
  const type = params.get('contexto_tipo') || 'SEGUIMIENTO';
  return { type, id: params.get('contexto_id'), name: params.get('contexto_nombre') || 'Registro institucional',
    origin: safeInternalPath(params.get('origen')), originLabel: params.get('origen_etiqueta') || 'Volver al registro', meta: contextMeta(type) };
};

const isSameCalendarDay = (left, right) => left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

const messageTime = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '';

const conversationTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (isSameCalendarDay(date, today)) return messageTime(value);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return 'Ayer';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(date);
};

const dayLabel = (value) => {
  const date = new Date(value);
  const today = new Date();
  if (isSameCalendarDay(date, today)) return 'Hoy';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return 'Ayer';
  const formatted = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  }).format(date);
  return formatted.charAt(0).toLocaleUpperCase('es-CL') + formatted.slice(1);
};

const initialsFrom = (value) => String(value || 'Usuario')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

const ConversationIcon = ({ type }) => {
  if (type === 'DIRECTA') return <MessageCircle size={19} />;
  if (type === 'CANAL') return <Hash size={19} />;
  return <UsersRound size={19} />;
};

const CreateConversation = ({ directory, onClose, onCreated, canDirect, canGroup, canChannel, context }) => {
  const { notify } = useFeedback();
  const workspace = useChatWorkspace();
  const [mode, setMode] = useState(context ? 'CONTEXTO' : canDirect ? 'DIRECTA' : canGroup ? 'GRUPO' : 'CANAL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState(context ? `${context.meta.prefix}: ${context.name}` : '');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef(null);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('input:not([type="radio"]):not([type="checkbox"])')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!savingRef.current) closeRef.current();
      } else if (event.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])].filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) return;
        if (!dialogRef.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const filtered = directory.filter((person) => (
    `${person.nombre} ${person.correo} ${person.cargo}`.toLowerCase().includes(query.toLowerCase())
  ));

  const submit = async (event) => {
    event.preventDefault();
    if (selected.length === 0 || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = mode === 'DIRECTA'
        ? await axios.post(`${API}/conversaciones/directa`, { usuario_id: selected[0] })
        : await axios.post(`${API}/conversaciones`, {
          tipo: mode,
          nombre: name,
          miembros: selected,
          contexto_tipo: context?.type || null,
          contexto_id: context?.id || null
        });
      if (!workspace.isCurrentSession()) return;
      notify('Conversación disponible.', 'success');
      onCreated(response.data.id_conversacion);
    } catch (error) {
      if (!workspace.isCurrentSession()) return;
      notify(messageOf(error, 'No fue posible crear la conversación.'), 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="chat-dialog-backdrop" onMouseDown={() => !savingRef.current && onClose()}>
      <form
        ref={dialogRef}
        className="chat-dialog"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-create-title"
      >
        <header>
          <div>
            <span className="section-kicker">Comunicación interna</span>
            <h2 id="chat-create-title">{context ? 'Coordinar este registro' : 'Nueva conversación'}</h2>
            {context && <p>La conversación quedará vinculada al {context.meta.label}: “{context.name}”.</p>}
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar"><X /></button>
        </header>

        {!context && (
          <div className="chat-dialog__types" aria-label="Tipo de conversación">
            {canDirect && <button type="button" className={mode === 'DIRECTA' ? 'active' : ''} onClick={() => { setMode('DIRECTA'); setSelected([]); }}>Directa</button>}
            {canGroup && <button type="button" className={mode === 'GRUPO' ? 'active' : ''} onClick={() => setMode('GRUPO')}>Grupo</button>}
            {canChannel && <button type="button" className={mode === 'CANAL' ? 'active' : ''} onClick={() => setMode('CANAL')}>Canal</button>}
          </div>
        )}

        {mode !== 'DIRECTA' && (
          <label>
            Nombre
            <input required minLength={3} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Inspectoría" />
          </label>
        )}
        <label>
          Buscar personas
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o cargo" />
        </label>
        <div className="chat-directory">
          {filtered.length === 0 ? <p>No hay personas que coincidan con la búsqueda.</p> : filtered.map((person) => {
            const checked = selected.includes(person.id);
            return (
              <label key={person.id}>
                <input
                  type={mode === 'DIRECTA' ? 'radio' : 'checkbox'}
                  checked={checked}
                  onChange={() => setSelected(mode === 'DIRECTA'
                    ? [person.id]
                    : checked ? selected.filter((personId) => personId !== person.id) : [...selected, person.id])}
                />
                <span><strong>{person.nombre}</strong><small>{person.cargo} · {person.correo}</small></span>
              </label>
            );
          })}
        </div>
        <footer>
          <span>{selected.length} seleccionada{selected.length === 1 ? '' : 's'}</span>
          <button type="button" className="app-action app-action--secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="app-action app-action--primary" disabled={saving || selected.length === 0}>{saving ? 'Creando…' : 'Continuar'}</button>
        </footer>
      </form>
    </div>
  );
};

const ChatThread = ({ conversationId, directory, onBack, context, onReturnToOrigin }) => {
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const workspace = useChatWorkspace();
  const { content, urgent, mentions } = workspace.getDraft(conversationId);
  const sending = Boolean(workspace.busy[conversationId]);
  const setContent = (value) => workspace.updateDraft(conversationId, (draft) => ({ content: typeof value === 'function' ? value(draft.content) : value }));
  const setUrgent = (value) => workspace.updateDraft(conversationId, { urgent: value });
  const setMentions = (value) => workspace.updateDraft(conversationId, (draft) => ({ mentions: typeof value === 'function' ? value(draft.mentions) : value }));
  const setSending = (value) => workspace.setBusy(conversationId, value);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [settings, setSettings] = useState(false);
  const [mentionMenu, setMentionMenu] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesRef = useRef(null);
  const fileRef = useRef(null);
  const composerRef = useRef(null);
  const restoreComposerFocus = useRef(false);
  const loadSequenceRef = useRef(0);
  const activeRef = useRef(false);
  const clearDraft = workspace.clearDraft;
  const hasConversation = Boolean(conversation);
  const canWrite = !conversation?.solo_administradores || ['PROPIETARIO', 'MODERADOR'].includes(conversation.miembro_rol);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    let width = element.clientWidth;
    let height = element.clientHeight;
    let atLatest = element.scrollHeight - element.scrollTop - height < 24;
    const composer = element.parentElement.querySelector('.chat-composer');
    const onScroll = () => {
      // A resize may emit scroll before ResizeObserver. Keep the pre-resize
      // reading position instead of mistaking that event for user scrolling.
      if (width === element.clientWidth && height === element.clientHeight) {
        atLatest = element.scrollHeight - element.scrollTop - height < 24;
      }
    };
    const observer = new ResizeObserver(() => {
      if (atLatest) element.scrollTop = element.scrollHeight;
      width = element.clientWidth;
      height = element.clientHeight;
      if (composer) {
        const offset = composer.getBoundingClientRect().height + parseFloat(getComputedStyle(composer).marginBottom);
        element.parentElement.style.setProperty('--chat-composer-offset', `${Math.ceil(offset)}px`);
      }
    });
    observer.observe(element);
    if (composer) observer.observe(composer);
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', onScroll); };
  }, [hasConversation]);

  useEffect(() => {
    if (!sending && restoreComposerFocus.current) {
      restoreComposerFocus.current = false;
      composerRef.current?.focus({ preventScroll: true });
    }
  }, [sending]);

  useEffect(() => {
    const editor = composerRef.current;
    if (!editor) return;
    const resize = () => {
      const style = getComputedStyle(editor);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      editor.style.overflowY = 'hidden';
      editor.style.height = 'auto';
      const height = Math.ceil(editor.scrollHeight + borders);
      editor.style.height = `${Math.min(144, height)}px`;
      editor.style.overflowY = height > 144 ? 'auto' : 'hidden';
    };
    let width = editor.getBoundingClientRect().width;
    resize();
    const observer = new ResizeObserver(() => {
      const nextWidth = editor.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; resize(); }
    });
    observer.observe(editor);
    return () => observer.disconnect();
  }, [content, conversation]);

  const nearBottom = () => {
    const element = messagesRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  };

  const scrollToLatest = (behavior = 'smooth') => {
    const element = messagesRef.current;
    element?.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior });
    setHasNewMessages(false);
  };

  const load = useCallback(async ({ quiet = false, scroll = false } = {}) => {
    if (!activeRef.current || document.visibilityState === 'hidden') return;
    const sequence = ++loadSequenceRef.current;
    let nextMessages;
    try {
      const [details, messageList] = await Promise.all([
        axios.get(`${API}/conversaciones/${conversationId}`),
        axios.get(`${API}/conversaciones/${conversationId}/mensajes`)
      ]);
      if (sequence !== loadSequenceRef.current) return;
      nextMessages = messageList.data || [];
      setConversation(details.data);
      setMessages((current) => {
        if (current.length <= nextMessages.length || nextMessages.length === 0) return nextMessages;
        const firstNextId = Number(nextMessages[0].id_mensaje);
        const older = current.filter((message) => Number(message.id_mensaje) < firstNextId);
        return [...older, ...nextMessages];
      });
      if (!quiet) setHasOlderMessages(nextMessages.length >= 50);
      setLoadError('');
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      const message = messageOf(error, 'No fue posible cargar la conversación.');
      if ([401, 403, 404].includes(error.response?.status)) {
        setConversation(null);
        setMessages([]);
        clearDraft(conversationId);
      }
      setLoadError(message);
      if (!quiet) notify(message, 'error');
      return;
    }

    if (!activeRef.current || document.visibilityState === 'hidden') return;
    try {
      const last = nextMessages.at(-1)?.id_mensaje || null;
      if (last && (scroll || nearBottom())) {
        await axios.post(`${API}/conversaciones/${conversationId}/leer`, { ultimo_mensaje_id: last });
        if (activeRef.current) window.dispatchEvent(new Event('ldsm:chat-read'));
      }
    } catch (error) {
      if (!quiet) {
        notify(messageOf(error, 'La conversación cargó, pero no fue posible actualizar su estado de lectura.'), 'error');
      }
    }
    if (scroll && sequence === loadSequenceRef.current) setTimeout(() => scrollToLatest(scroll === true ? 'smooth' : scroll), 30);
  }, [conversationId, notify, clearDraft]);

  useEffect(() => {
    activeRef.current = true;
    const sequenceRef = loadSequenceRef;
    load({ scroll: 'auto' });
    const onVisible = () => { if (document.visibilityState === 'visible') load({ quiet: true }); };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = subscribeToChatRealtime((event) => {
      if (String(event.conversation_id) !== String(conversationId)) return;
      const shouldScroll = nearBottom();
      load({ quiet: true, scroll: shouldScroll ? 'smooth' : false });
      if (!shouldScroll) setHasNewMessages(true);
    });
    const fallback = setInterval(() => load({ quiet: true }), 60_000);
    return () => { activeRef.current = false; ++sequenceRef.current; unsubscribe(); clearInterval(fallback); document.removeEventListener('visibilitychange', onVisible); };
  }, [conversationId, load]);

  const send = async (event) => {
    event.preventDefault();
    if (!content.trim() || sending || !canWrite) return;
    setSending(true);
    try {
      await axios.post(`${API}/conversaciones/${conversationId}/mensajes`, {
        contenido: content.trim(),
        tipo: urgent ? 'URGENTE' : 'NORMAL',
        menciones: mentions
      });
      if (!workspace.isCurrentSession()) return;
      workspace.clearDraft(conversationId);
      window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: conversationId } }));
      await load({ scroll: 'smooth' });
    } catch (error) {
      if (!workspace.isCurrentSession()) return;
      notify(messageOf(error, 'No fue posible enviar el mensaje.'), 'error');
    } finally {
      restoreComposerFocus.current = workspace.isCurrentSession() && activeRef.current;
      setSending(false);
    }
  };

  const loadOlderMessages = async () => {
    const firstMessageId = messages[0]?.id_mensaje;
    if (!firstMessageId || loadingOlder) return;
    const element = messagesRef.current;
    const previousHeight = element?.scrollHeight || 0;
    const previousTop = element?.scrollTop || 0;
    setLoadingOlder(true);
    try {
      const response = await axios.get(`${API}/conversaciones/${conversationId}/mensajes`, {
        params: { antes_de: firstMessageId, limite: 50 }
      });
      const older = response.data || [];
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => Number(message.id_mensaje)));
        return [...older.filter((message) => !currentIds.has(Number(message.id_mensaje))), ...current];
      });
      setHasOlderMessages(older.length >= 50);
      requestAnimationFrame(() => {
        if (element) element.scrollTop = previousTop + element.scrollHeight - previousHeight;
      });
    } catch (error) {
      notify(messageOf(error, 'No fue posible cargar los mensajes anteriores.'), 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const mention = (member) => {
    setContent((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${member.nombre} `);
    setMentions((current) => current.includes(member.usuario_id) ? current : [...current, member.usuario_id]);
    setMentionMenu(false);
  };

  const attach = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || sending || !canWrite) return;
    if (file.size > 8 * 1024 * 1024) {
      notify('El archivo supera el máximo permitido de 8 MB.', 'error');
      return;
    }
    setSending(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (!workspace.isCurrentSession()) return;
      await axios.post(`${API}/conversaciones/${conversationId}/adjuntos`, {
        file_name: file.name,
        file_data: data
      });
      if (!workspace.isCurrentSession()) return;
      notify('Archivo adjuntado.', 'success');
      window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: conversationId } }));
      await load({ scroll: 'smooth' });
    } catch (error) {
      if (!workspace.isCurrentSession()) return;
      notify(messageOf(error, 'No fue posible adjuntar el archivo.'), 'error');
    } finally {
      setSending(false);
    }
  };

  const downloadAttachment = async (file) => {
    try {
      const response = await fetch(`${API}/conversaciones/${conversationId}/adjuntos/${file.id_adjunto}`, {
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) {
        let payload = null;
        try { payload = await response.json(); } catch { /* respuesta sin JSON */ }
        const error = new Error('Download failed');
        error.response = { status: response.status, data: payload };
        error.request = true;
        throw error;
      }
      const blob = await response.blob();
      if (!workspace.isCurrentSession()) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.nombre || 'archivo';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      notify(messageOf(error, 'No fue posible descargar el archivo. Comprueba que siga disponible e inténtalo nuevamente.'), 'error');
    }
  };

  const pin = async (message) => {
    try {
      await axios[message.fijado ? 'delete' : 'post'](`${API}/conversaciones/${conversationId}/mensajes/${message.id_mensaje}/fijar`);
      await load({ quiet: true });
    } catch (error) {
      notify(messageOf(error, 'No fue posible actualizar el mensaje fijado.'), 'error');
    }
  };

  const renderedMessages = useMemo(() => {
    let previousDay = '';
    let previousMessage;
    return messages.map((message) => {
      const currentDay = new Date(message.enviado_en).toDateString();
      const showDay = currentDay !== previousDay;
      const grouped = !showDay && previousMessage
        && Number(previousMessage.enviado_por) === Number(message.enviado_por)
        && new Date(message.enviado_en) - new Date(previousMessage.enviado_en) < 5 * 60_000
        && previousMessage.tipo === message.tipo && !previousMessage.eliminado_en && !message.eliminado_en;
      previousDay = currentDay;
      previousMessage = message;
      return { message, showDay, grouped };
    });
  }, [messages]);

  if (!conversation && !loadError) {
    return <section className="chat-thread chat-thread--loading" data-tour="chat-thread"><p role="status">Cargando conversación…</p><button type="button" className="app-action app-action--secondary" onClick={onBack}>Volver a conversaciones</button></section>;
  }

  if (!conversation) {
    return (
      <section className="chat-thread chat-thread--error" data-tour="chat-thread">
        <MessageCircle />
        <h2>No pudimos abrir la conversación</h2>
        <p>{loadError}</p>
        <button type="button" className="app-action app-action--primary" onClick={() => load({ scroll: 'auto' })}>Reintentar</button>
        <button type="button" className="app-action app-action--secondary" onClick={onBack}>Volver a conversaciones</button>
      </section>
    );
  }

  const title = conversation.tipo === 'DIRECTA'
    ? conversation.members?.find((member) => Number(member.usuario_id) !== Number(user.id))?.nombre || 'Conversación directa'
    : conversation.nombre || conversation.titulo || 'Conversación';
  const canPin = ['PROPIETARIO', 'MODERADOR'].includes(conversation.miembro_rol);
  const linkedContext = context || contextFromParams(new URLSearchParams(contextQueryFromConversation(conversation)));

  return (
    <section className="chat-thread">
      <header>
        <button type="button" className="chat-mobile-back" onClick={onBack} aria-label="Volver a conversaciones"><ChevronLeft /></button>
        <ChatAvatar conversation={conversation} className="chat-thread__icon" fallback={conversation.tipo === 'DIRECTA' ? initialsFrom(title) : <ConversationIcon type={conversation.tipo} />} />
        <div>
          <h2>{title}</h2>
          <p>{conversation.tipo === 'DIRECTA' ? 'Conversación directa' : `${conversation.members?.length || 0} integrantes`} · Interno del colegio</p>
        </div>
        <button type="button" onClick={() => setSettings(!settings)} aria-label="Preferencias" aria-expanded={settings}><MoreHorizontal /></button>
      </header>

      {loadError && <div className="chat-refresh-error" role="alert"><div><strong>No se pudo actualizar la conversación.</strong><span>{loadError}</span><p>Los mensajes visibles pueden estar desactualizados.</p></div><button type="button" onClick={() => load({ quiet: true })}>Reintentar</button></div>}

      {linkedContext && (
        <aside className="chat-context-banner" aria-label="Registro vinculado a esta conversación">
          <span><strong>{linkedContext.meta.label}</strong><small>{linkedContext.name}</small></span>
          <button type="button" onClick={() => onReturnToOrigin(linkedContext.origin)}><ArrowLeft size={15} /> {linkedContext.originLabel}</button>
        </aside>
      )}

      {settings && (
        <ChatSettingsPanel
          conversation={conversation}
          directory={directory}
          user={user}
          onClose={() => setSettings(false)}
          onUpdated={() => { window.dispatchEvent(new Event('ldsm:chat-read')); return load({ quiet: true }); }}
          onLeft={() => { workspace.clearDraft(conversationId); window.dispatchEvent(new Event('ldsm:chat-read')); onBack(); }}
        />
      )}

      {conversation.pinned?.length > 0 && (
        <div className="chat-pinned"><Pin size={15} /><strong>Fijado:</strong><span>{conversation.pinned[0].contenido}</span></div>
      )}

      <div className="chat-messages" ref={messagesRef}>
        {hasOlderMessages && (
          <button type="button" className="chat-load-older" onClick={loadOlderMessages} disabled={loadingOlder}>
            {loadingOlder ? 'Cargando mensajes…' : 'Cargar mensajes anteriores'}
          </button>
        )}
        {messages.length === 0 && (
          <div className="chat-thread__empty">
            <MessageCircle />
            <strong>Aún no hay mensajes</strong>
            <span>Escribe el primer mensaje de esta conversación institucional.</span>
          </div>
        )}
        {renderedMessages.map(({ message, showDay, grouped }) => {
          const own = Number(message.enviado_por) === Number(user.id);
          const showAuthor = !own && !grouped && conversation.tipo !== 'DIRECTA';
          return (
            <div key={message.id_mensaje} className="chat-message-entry">
              {showDay && <div className="chat-day-separator"><span>{dayLabel(message.enviado_en)}</span></div>}
              <article aria-label={`Mensaje de ${own ? 'ti' : message.autor_nombre}`} className={`${own ? 'own' : ''}${message.tipo === 'URGENTE' ? ' urgent' : ''}${grouped ? ' grouped' : ''}`}>
                {!own && conversation.tipo !== 'DIRECTA' && <span className={`chat-message-avatar${grouped ? ' chat-message-avatar--spacer' : ''}`} aria-hidden="true">{initialsFrom(message.autor_nombre)}</span>}
                <div className="chat-bubble">
                  {(showAuthor || message.tipo === 'URGENTE') && <header>
                    {showAuthor && <strong>{message.autor_nombre}</strong>}
                    {message.tipo === 'URGENTE' && <span><ShieldAlert size={13} /> Urgente</span>}
                  </header>}
                  {message.eliminado_en
                    ? <em>Mensaje retirado</em>
                    : (!message.adjuntos?.length || !message.contenido.startsWith('Archivo adjunto:')) && <p>{message.contenido}</p>}
                  {!message.eliminado_en && message.adjuntos?.map((file) => (
                    <ChatAttachment key={file.id_adjunto} conversationId={conversationId} file={file} onDownload={downloadAttachment} />
                  ))}
                  <footer>
                    {canPin && !message.eliminado_en && (
                      <button type="button" onClick={() => pin(message)} aria-label={message.fijado ? 'Quitar fijado' : 'Fijar mensaje'}>
                        <Pin size={13} fill={message.fijado ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <time dateTime={message.enviado_en}>{messageTime(message.enviado_en)}</time>
                    {own && <span role="img" title={Number(message.lecturas_otros) > 0 ? `Leído por ${message.lecturas_otros}` : 'Enviado, sin lecturas confirmadas'} aria-label={Number(message.lecturas_otros) > 0 ? `Leído por ${message.lecturas_otros}` : 'Enviado, sin lecturas confirmadas'}>{Number(message.lecturas_otros) > 0 ? <CheckCheck size={14} /> : <Check size={14} />}</span>}
                  </footer>
                </div>
              </article>
            </div>
          );
        })}
      </div>

      {hasNewMessages && <button type="button" className="chat-new-messages" onClick={() => { scrollToLatest(); load({ quiet: true, scroll: 'smooth' }); }}>Hay mensajes nuevos</button>}

      {mentionMenu && (
        <div className="chat-mention-menu">
          <strong>Mencionar a</strong>
          {conversation.members?.filter((member) => Number(member.usuario_id) !== Number(user.id)).map((member) => (
            <button type="button" disabled={sending} key={member.usuario_id} onClick={() => mention(member)}>@{member.nombre}</button>
          ))}
        </div>
      )}

      {!canWrite && <div className="chat-urgent-note" role="status">Solo los administradores pueden enviar mensajes en este grupo. Puedes seguir leyendo y descargar los archivos.</div>}
      {urgent && canWrite && <div className="chat-urgent-note"><ShieldAlert size={15} /> Este mensaje se destacará como urgente para el equipo.</div>}
      <form className="chat-composer" onSubmit={send}>
        <input ref={fileRef} type="file" hidden onChange={attach} />
        <button type="button" className="chat-attach" onClick={() => fileRef.current?.click()} disabled={!canWrite || !hasPermission(user, PERMISSIONS.CHAT_ATTACH) || sending} aria-label="Adjuntar archivo"><Paperclip /></button>
        <button type="button" className="chat-mention" disabled={sending || !canWrite} onClick={() => setMentionMenu(!mentionMenu)} aria-label="Mencionar a una persona" aria-expanded={mentionMenu}>@</button>
        <textarea
          ref={composerRef}
          aria-label="Mensaje"
          disabled={sending || !canWrite}
          value={content}
          maxLength={6000}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(event);
            }
          }}
          placeholder="Escribe un mensaje…"
          rows={1}
        />
        {hasPermission(user, PERMISSIONS.CHAT_URGENT) && (
          <button type="button" className={`chat-urgent${urgent ? ' is-urgent' : ''}`} disabled={sending || !canWrite} aria-pressed={urgent} onClick={() => setUrgent(!urgent)} aria-label={urgent ? 'Quitar urgencia' : 'Marcar como urgente'}><ShieldAlert /></button>
        )}
        <span className="chat-composer-hint" aria-hidden="true">Enter para enviar · Mayús + Enter para otra línea</span>
        <button className="chat-send" disabled={sending || !canWrite || !content.trim()} aria-label="Enviar"><Send /></button>
      </form>
    </section>
  );
};

const InternalChatView = ({ embedded = false, embeddedPath = '/chat', onNavigate }) => {
  const { conversationId: routeConversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useChatWorkspace();
  const [routeSearchParams, setRouteSearchParams] = useSearchParams();
  const embeddedUrl = new URL(embeddedPath, 'http://chat.local');
  const conversationId = embedded ? embeddedUrl.pathname.match(/^\/chat\/(\d+)$/)?.[1] : routeConversationId;
  const searchParams = embedded ? embeddedUrl.searchParams : routeSearchParams;
  const goChat = embedded ? onNavigate : navigate;
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [conversations, setConversations] = useState([]);
  const [messageResults, setMessageResults] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(Boolean(searchParams.get('contexto_id') && !conversationId));
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadSequenceRef = useRef(0);
  const clearAllDrafts = workspace.clearAllDrafts;

  const context = contextFromParams(searchParams);

  const contextualQuery = context ? `?${searchParams.toString()}` : '';

  const load = useCallback(async ({ quiet = false } = {}) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    if (!quiet) setLoading(true);
    try {
      const requests = [
        axios.get(`${API}/conversaciones`, { params: { q: search } }),
        axios.get(`${API}/directorio`)
      ];
      if (search.trim().length >= 2) requests.push(axios.get(`${API}/buscar`, { params: { q: search } }));
      const [list, people, matches] = await Promise.all(requests);
      if (sequence !== loadSequenceRef.current) return;
      setConversations(list.data || []);
      setDirectory(people.data || []);
      setMessageResults(matches?.data || []);
      setLoadError('');
      setAccessDenied(false);
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      const message = messageOf(error, 'No fue posible cargar el chat interno.');
      if ([401, 403, 404].includes(error.response?.status)) {
        setAccessDenied(true);
        clearAllDrafts();
        setConversations([]);
        setMessageResults([]);
        setDirectory([]);
        setDialog(false);
        setRetentionOpen(false);
        setAppearanceOpen(false);
      }
      setLoadError(message);
      if (!quiet) {
        notify(message, 'error');
      }
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [search, notify, clearAllDrafts]);

  useEffect(() => {
    const sequenceRef = loadSequenceRef;
    const delay = setTimeout(() => load(), search ? 250 : 0);
    const onRead = () => load({ quiet: true });
    window.addEventListener('ldsm:chat-read', onRead);
    const unsubscribe = subscribeToChatRealtime(() => load({ quiet: true }));
    const fallback = setInterval(() => load({ quiet: true }), 60_000);
    return () => { ++sequenceRef.current; clearTimeout(delay); unsubscribe(); clearInterval(fallback); window.removeEventListener('ldsm:chat-read', onRead); };
  }, [load, search]);

  const canCreate = hasPermission(user, PERMISSIONS.CHAT_DIRECT_CREATE)
    || hasPermission(user, PERMISSIONS.CHAT_GROUP_CREATE)
    || hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE);

  const chat = (
    <div className={`chat-page${embedded ? ' chat-page--embedded' : ''}${conversationId ? ' has-thread' : ''}`} data-background={workspace.appearance.fondo} data-text-size={workspace.appearance.tamano_texto} style={workspace.appearance.fondo === 'personalizado' && workspace.appearance.fondo_data ? { '--chat-background-image': `url("${workspace.appearance.fondo_data}")` } : undefined}>
      <aside className="chat-sidebar" data-tour="chat-sidebar">
        <header>
          <div><h2>Conversaciones</h2></div>
          <button type="button" onClick={() => setAppearanceOpen(true)} aria-label="Apariencia del chat"><Palette /></button>
          {hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE) && <button type="button" onClick={() => setRetentionOpen(true)} aria-label="Política de retención"><Settings2 /></button>}
          {canCreate && <button type="button" onClick={() => setDialog(true)} aria-label="Nueva conversación"><CirclePlus /></button>}
        </header>

        <label className="chat-search">
          <Search />
          <input aria-label="Buscar conversaciones o mensajes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en el chat" />
        </label>

        {messageResults.length > 0 && (
          <section className="chat-message-results">
            <strong>Coincidencias en mensajes</strong>
            {messageResults.slice(0, 8).map((result) => (
              <button type="button" key={result.id_mensaje} onClick={() => goChat(`/chat/${result.id_conversacion}${contextQueryFromConversation(result)}`)}>
                <span>{result.autor}</span><p>{result.contenido}</p>
              </button>
            ))}
          </section>
        )}

        <div className="chat-conversations">
          {loadError && conversations.length > 0 && <div className="chat-refresh-error" role="alert"><div><strong>No se pudo actualizar la lista.</strong><span>{loadError}</span></div><button type="button" onClick={() => load()}>Reintentar</button></div>}
          {loading && conversations.length === 0 ? <p className="chat-conversations__status">Cargando conversaciones…</p> : loadError && conversations.length === 0 ? (
            <div className="chat-empty"><MessageCircle /><strong>No pudimos cargar el chat</strong><span>{loadError}</span><button type="button" onClick={() => load()}>Reintentar</button></div>
          ) : conversations.length === 0 ? (
            <div className="chat-empty"><MessageCircle /><strong>No hay conversaciones</strong><span>{search ? 'No hay coincidencias para esta búsqueda.' : 'Inicia una comunicación con el equipo.'}</span></div>
          ) : conversations.map((conversation) => (
            <button
              key={conversation.id_conversacion}
              type="button"
              aria-current={String(conversation.id_conversacion) === String(conversationId) ? 'page' : undefined}
              className={String(conversation.id_conversacion) === String(conversationId) ? 'active' : ''}
              onClick={() => goChat(`/chat/${conversation.id_conversacion}${contextQueryFromConversation(conversation)}`)}
            >
              <ChatAvatar conversation={conversation} className="chat-conversation-icon" fallback={conversation.tipo === 'DIRECTA' ? initialsFrom(conversation.titulo || conversation.nombre) : <ConversationIcon type={conversation.tipo} />} />
              <span className="chat-conversation-copy">
                <span className="chat-conversation-heading">
                  <strong title={conversation.titulo || conversation.nombre || 'Conversación'}>{conversation.titulo || conversation.nombre || 'Conversación'}</strong>
                  <time>{conversationTime(conversation.ultimo_mensaje_en)}</time>
                </span>
                <span className="chat-conversation-preview">
                  <small>
                    {conversation.ultimo_emisor && conversation.tipo !== 'DIRECTA' && <span className="chat-preview-author" title={conversation.ultimo_emisor}>{conversation.ultimo_emisor}: </span>}
                    <span className="chat-preview-text">{conversation.ultimo_mensaje || 'Sin mensajes todavía'}</span>
                  </small>
                  {conversation.no_leidos > 0 && <b>{conversation.no_leidos}</b>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div data-tour="chat-thread" className="chat-thread-tour">
        {accessDenied ? (
          <section className="chat-thread chat-thread--error"><h2>No pudimos abrir la conversación</h2><p>{loadError}</p><button type="button" className="app-action app-action--primary" onClick={() => load()}>Reintentar</button><button type="button" className="app-action app-action--secondary" onClick={() => goChat('/chat')}>Volver a conversaciones</button></section>
        ) : conversationId ? (
          <ChatThread
            key={conversationId}
            conversationId={conversationId}
            directory={directory}
            context={context}
            onBack={() => goChat(`/chat${contextualQuery}`)}
            onReturnToOrigin={(origin) => navigate(origin || context?.origin || '/admin')}
          />
        ) : (
          <section className="chat-welcome">
            <div>
              <MessageCircle />
              <h2>Tu equipo, a un mensaje</h2>
              <p>Elige una conversación o inicia una nueva.</p>
              {canCreate && <button type="button" className="app-action app-action--primary" onClick={() => setDialog(true)}><CirclePlus size={18} /> Escribir al equipo</button>}
              <span>También puedes conversar en la ventana flotante mientras trabajas.</span>
            </div>
          </section>
        )}
      </div>

      {dialog && createPortal((
        <CreateConversation
          directory={directory}
          context={context}
          onClose={() => { setDialog(false); if (context) { if (embedded) goChat('/chat'); else setRouteSearchParams({}); } }}
          onCreated={(newConversationId) => {
            setDialog(false);
            load();
            goChat(`/chat/${newConversationId}${contextualQuery}`);
          }}
          canGroup={hasPermission(user, PERMISSIONS.CHAT_GROUP_CREATE)}
          canDirect={hasPermission(user, PERMISSIONS.CHAT_DIRECT_CREATE)}
          canChannel={hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE)}
        />
      ), document.body)}
      {retentionOpen && createPortal(<ChatRetentionDialog onClose={() => setRetentionOpen(false)} />, document.body)}
      {appearanceOpen && <ChatAppearanceDialog onClose={() => setAppearanceOpen(false)} />}
    </div>
  );
  if (embedded) return chat;
  return <main className="chat-workspace">
    <header className="chat-workspace-header" data-tour="page-header">
      <button type="button" className="chat-panel-link" onClick={() => navigate('/admin')}><ArrowLeft size={18} /> Panel principal</button>
      <div className="chat-workspace-heading"><span className="section-kicker">Comunicación del equipo</span><h1>Chat interno</h1></div>
      <button type="button" className="chat-window-action" onClick={() => {
        workspace.setDockPath(`${location.pathname}${location.search}`);
        workspace.setDockOpen(true);
        navigate(workspace.returnPath);
      }}><Minimize2 size={18} /> Usar chat flotante</button>
    </header>
    {chat}
  </main>;
};

export default function InternalChat(props) {
  const { user } = useContext(AuthContext);
  // Another account may sign in from a different tab without a route change.
  // Remount private lists, dialogs and image drafts, not only the composer.
  return <InternalChatView key={user?.id || 'signed-out'} {...props} />;
}
