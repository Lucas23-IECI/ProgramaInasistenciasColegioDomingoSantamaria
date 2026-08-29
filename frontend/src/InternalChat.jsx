import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './styles/internal-chat.css';
import axios from 'axios';
import {
  ArrowLeft,
  CheckCheck,
  ChevronLeft,
  CirclePlus,
  Download,
  Hash,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pin,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  UsersRound,
  X
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { PERMISSIONS, hasPermission } from './permissions';
import ChatSettingsPanel from './components/ChatSettingsPanel';
import ChatRetentionDialog from './components/ChatRetentionDialog';
import { subscribeToChatRealtime } from './pwa/chatRealtime';
import { getApiErrorMessage } from './utils/apiError';
import { contextMeta, safeInternalPath } from './utils/chatContext';

const API = '/api/chat';
const messageOf = getApiErrorMessage;

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

const CreateConversation = ({ directory, onClose, onCreated, canGroup, canChannel, context }) => {
  const { notify } = useFeedback();
  const [mode, setMode] = useState(context ? 'CONTEXTO' : 'DIRECTA');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState(context ? `${context.meta.prefix}: ${context.name}` : '');
  const [saving, setSaving] = useState(false);

  const filtered = directory.filter((person) => (
    `${person.nombre} ${person.correo} ${person.cargo}`.toLowerCase().includes(query.toLowerCase())
  ));

  const submit = async (event) => {
    event.preventDefault();
    if (selected.length === 0) return;
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
      notify('Conversación disponible.', 'success');
      onCreated(response.data.id_conversacion);
    } catch (error) {
      notify(messageOf(error, 'No fue posible crear la conversación.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chat-dialog-backdrop" onMouseDown={onClose}>
      <form className="chat-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="section-kicker">Comunicación interna</span>
            <h2>{context ? 'Coordinar este registro' : 'Nueva conversación'}</h2>
            {context && <p>La conversación quedará vinculada al {context.meta.label}: “{context.name}”.</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X /></button>
        </header>

        {!context && (
          <div className="chat-dialog__types" aria-label="Tipo de conversación">
            <button type="button" className={mode === 'DIRECTA' ? 'active' : ''} onClick={() => { setMode('DIRECTA'); setSelected([]); }}>Directa</button>
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
          <button type="button" className="app-action app-action--secondary" onClick={onClose}>Cancelar</button>
          <button className="app-action app-action--primary" disabled={saving || selected.length === 0}>{saving ? 'Creando…' : 'Continuar'}</button>
        </footer>
      </form>
    </div>
  );
};

const ChatThread = ({ conversationId, directory, onBack, context, onReturnToOrigin }) => {
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mentionMenu, setMentionMenu] = useState(false);
  const [mentions, setMentions] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const endRef = useRef(null);
  const messagesRef = useRef(null);
  const fileRef = useRef(null);

  const nearBottom = () => {
    const element = messagesRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  };

  const scrollToLatest = (behavior = 'smooth') => {
    endRef.current?.scrollIntoView({ behavior });
    setHasNewMessages(false);
  };

  const load = useCallback(async ({ quiet = false, scroll = false } = {}) => {
    let nextMessages;
    try {
      const [details, messageList] = await Promise.all([
        axios.get(`${API}/conversaciones/${conversationId}`),
        axios.get(`${API}/conversaciones/${conversationId}/mensajes`)
      ]);
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
      const message = messageOf(error, 'No fue posible cargar la conversación.');
      setLoadError(message);
      if (!quiet) notify(message, 'error');
      return;
    }

    try {
      const last = nextMessages.at(-1)?.id_mensaje || null;
      await axios.post(`${API}/conversaciones/${conversationId}/leer`, { ultimo_mensaje_id: last });
    } catch (error) {
      if (!quiet) {
        notify(messageOf(error, 'La conversación cargó, pero no fue posible actualizar su estado de lectura.'), 'error');
      }
    }
    if (scroll) setTimeout(() => scrollToLatest(scroll === true ? 'smooth' : scroll), 30);
  }, [conversationId, notify]);

  useEffect(() => {
    load({ scroll: 'auto' });
    const unsubscribe = subscribeToChatRealtime((event) => {
      if (String(event.conversation_id) !== String(conversationId)) return;
      const shouldScroll = nearBottom();
      load({ quiet: true, scroll: shouldScroll ? 'smooth' : false });
      if (!shouldScroll) setHasNewMessages(true);
    });
    const fallback = setInterval(() => load({ quiet: true }), 60_000);
    return () => { unsubscribe(); clearInterval(fallback); };
  }, [conversationId, load]);

  const send = async (event) => {
    event.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      await axios.post(`${API}/conversaciones/${conversationId}/mensajes`, {
        contenido: content.trim(),
        tipo: urgent ? 'URGENTE' : 'NORMAL',
        menciones: mentions
      });
      setContent('');
      setUrgent(false);
      setMentions([]);
      await load({ scroll: 'smooth' });
    } catch (error) {
      notify(messageOf(error, 'No fue posible enviar el mensaje.'), 'error');
    } finally {
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
    if (!file) return;
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
      await axios.post(`${API}/conversaciones/${conversationId}/adjuntos`, {
        file_name: file.name,
        file_data: data
      });
      notify('Archivo adjuntado.', 'success');
      await load({ scroll: 'smooth' });
    } catch (error) {
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
    return messages.map((message) => {
      const currentDay = new Date(message.enviado_en).toDateString();
      const showDay = currentDay !== previousDay;
      previousDay = currentDay;
      return { message, showDay };
    });
  }, [messages]);

  if (!conversation && !loadError) {
    return <section className="chat-thread chat-thread--loading" data-tour="chat-thread">Cargando conversación…</section>;
  }

  if (!conversation) {
    return (
      <section className="chat-thread chat-thread--error" data-tour="chat-thread">
        <MessageCircle />
        <h2>No pudimos abrir la conversación</h2>
        <p>{loadError}</p>
        <button type="button" className="app-action app-action--primary" onClick={() => load({ scroll: 'auto' })}>Reintentar</button>
      </section>
    );
  }

  const title = conversation.tipo === 'DIRECTA'
    ? conversation.members?.find((member) => Number(member.usuario_id) !== Number(user.id))?.nombre || 'Conversación directa'
    : conversation.nombre;

  return (
    <section className="chat-thread">
      <header>
        <button type="button" className="chat-mobile-back" onClick={onBack} aria-label="Volver a conversaciones"><ChevronLeft /></button>
        <span className="chat-thread__icon"><ConversationIcon type={conversation.tipo} /></span>
        <div>
          <h2>{title}</h2>
          <p>{conversation.members?.length || 0} integrantes · actualización en vivo</p>
        </div>
        <button type="button" onClick={() => setSettings(!settings)} aria-label="Preferencias" aria-expanded={settings}><MoreHorizontal /></button>
      </header>

      {context && (
        <aside className="chat-context-banner" aria-label="Registro vinculado a esta conversación">
          <span><strong>{context.meta.label}</strong><small>{context.name}</small></span>
          <button type="button" onClick={onReturnToOrigin}><ArrowLeft size={15} /> {context.originLabel}</button>
        </aside>
      )}

      {settings && (
        <ChatSettingsPanel
          conversation={conversation}
          directory={directory}
          user={user}
          onClose={() => setSettings(false)}
          onUpdated={() => load({ quiet: true })}
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
        {renderedMessages.map(({ message, showDay }) => {
          const own = Number(message.enviado_por) === Number(user.id);
          return (
            <div key={message.id_mensaje} className="chat-message-entry">
              {showDay && <div className="chat-day-separator"><span>{dayLabel(message.enviado_en)}</span></div>}
              <article className={`${own ? 'own' : ''}${message.tipo === 'URGENTE' ? ' urgent' : ''}`}>
                {!own && <span className="chat-message-avatar" aria-hidden="true">{initialsFrom(message.autor_nombre)}</span>}
                <div className="chat-bubble">
                  <header>
                    <strong>{own ? 'Tú' : message.autor_nombre}</strong>
                    {message.tipo === 'URGENTE' && <span><ShieldAlert size={13} /> Urgente</span>}
                  </header>
                  {message.eliminado_en
                    ? <em>Mensaje retirado</em>
                    : (!message.adjuntos?.length || !message.contenido.startsWith('Archivo adjunto:')) && <p>{message.contenido}</p>}
                  {!message.eliminado_en && message.adjuntos?.map((file) => (
                    <button type="button" className="chat-attachment" key={file.id_adjunto} onClick={() => downloadAttachment(file)}>
                      <span><Paperclip size={15} /></span>
                      <span><strong>{file.nombre}</strong><small>Descargar archivo</small></span>
                      <Download size={15} />
                    </button>
                  ))}
                  <footer>
                    {!message.eliminado_en && (
                      <button type="button" onClick={() => pin(message)} aria-label={message.fijado ? 'Quitar fijado' : 'Fijar mensaje'}>
                        <Pin size={13} fill={message.fijado ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <span>{messageTime(message.enviado_en)}</span>
                    {own && <span title={`${message.lecturas} lecturas`}><CheckCheck size={14} /></span>}
                  </footer>
                </div>
              </article>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {hasNewMessages && <button type="button" className="chat-new-messages" onClick={() => scrollToLatest()}>Hay mensajes nuevos</button>}

      {mentionMenu && (
        <div className="chat-mention-menu">
          <strong>Mencionar a</strong>
          {conversation.members?.filter((member) => Number(member.usuario_id) !== Number(user.id)).map((member) => (
            <button type="button" key={member.usuario_id} onClick={() => mention(member)}>@{member.nombre}</button>
          ))}
        </div>
      )}

      {urgent && <div className="chat-urgent-note"><ShieldAlert size={15} /> Este mensaje se destacará como urgente para el equipo.</div>}
      <form className="chat-composer" onSubmit={send}>
        <input ref={fileRef} type="file" hidden onChange={attach} />
        <button type="button" className="chat-attach" onClick={() => fileRef.current?.click()} disabled={!hasPermission(user, PERMISSIONS.CHAT_ATTACH) || sending} aria-label="Adjuntar archivo"><Paperclip /></button>
        <button type="button" className="chat-mention" onClick={() => setMentionMenu(!mentionMenu)} aria-label="Mencionar a una persona">@</button>
        <textarea
          value={content}
          maxLength={6000}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(event);
            }
          }}
          placeholder="Escribe un mensaje institucional"
          rows={1}
        />
        {hasPermission(user, PERMISSIONS.CHAT_URGENT) && (
          <button type="button" className={`chat-urgent${urgent ? ' is-urgent' : ''}`} onClick={() => setUrgent(!urgent)} aria-label={urgent ? 'Quitar urgencia' : 'Marcar como urgente'}><ShieldAlert /></button>
        )}
        <button className="chat-send" disabled={sending || !content.trim()} aria-label="Enviar"><Send /></button>
      </form>
    </section>
  );
};

const InternalChat = () => {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [conversations, setConversations] = useState([]);
  const [messageResults, setMessageResults] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(Boolean(searchParams.get('contexto_id') && !conversationId));
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadSequenceRef = useRef(0);

  const context = searchParams.get('contexto_id') ? (() => {
    const type = searchParams.get('contexto_tipo') || 'SEGUIMIENTO';
    return {
      type,
      id: searchParams.get('contexto_id'),
      name: searchParams.get('contexto_nombre') || 'Registro institucional',
      origin: safeInternalPath(searchParams.get('origen')),
      originLabel: searchParams.get('origen_etiqueta') || 'Volver al registro',
      meta: contextMeta(type)
    };
  })() : null;

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
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      const message = messageOf(error, 'No fue posible cargar el chat interno.');
      if (!quiet) {
        setLoadError(message);
        notify(message, 'error');
      }
    } finally {
      if (!quiet && sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [search, notify]);

  useEffect(() => {
    const delay = setTimeout(() => load(), search ? 250 : 0);
    const unsubscribe = subscribeToChatRealtime(() => load({ quiet: true }));
    const fallback = setInterval(() => load({ quiet: true }), 60_000);
    return () => { clearTimeout(delay); unsubscribe(); clearInterval(fallback); };
  }, [load, search]);

  const canCreate = hasPermission(user, PERMISSIONS.CHAT_DIRECT_CREATE)
    || hasPermission(user, PERMISSIONS.CHAT_GROUP_CREATE);

  return (
    <main className={`chat-page${conversationId ? ' has-thread' : ''}`}>
      <aside className="chat-sidebar" data-tour="chat-sidebar">
        <header data-tour="page-header">
          <button type="button" onClick={() => navigate('/admin')} aria-label="Volver al panel"><ArrowLeft /></button>
          <div><span className="section-kicker">Equipo institucional</span><h1>Chat interno</h1></div>
          {hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE) && <button type="button" onClick={() => setRetentionOpen(true)} aria-label="Política de retención"><Settings2 /></button>}
          {canCreate && <button type="button" onClick={() => setDialog(true)} aria-label="Nueva conversación"><CirclePlus /></button>}
        </header>

        <label className="chat-search">
          <Search />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversaciones o mensajes" />
        </label>

        {messageResults.length > 0 && (
          <section className="chat-message-results">
            <strong>Coincidencias en mensajes</strong>
            {messageResults.slice(0, 8).map((result) => (
              <button type="button" key={result.id_mensaje} onClick={() => navigate(`/chat/${result.id_conversacion}`)}>
                <span>{result.autor}</span><p>{result.contenido}</p>
              </button>
            ))}
          </section>
        )}

        <div className="chat-conversations">
          {loading && conversations.length === 0 ? <p className="chat-conversations__status">Cargando conversaciones…</p> : loadError ? (
            <div className="chat-empty"><MessageCircle /><strong>No pudimos cargar el chat</strong><span>{loadError}</span><button type="button" onClick={() => load()}>Reintentar</button></div>
          ) : conversations.length === 0 ? (
            <div className="chat-empty"><MessageCircle /><strong>No hay conversaciones</strong><span>{search ? 'No hay coincidencias para esta búsqueda.' : 'Inicia una comunicación con el equipo.'}</span></div>
          ) : conversations.map((conversation) => (
            <button
              key={conversation.id_conversacion}
              type="button"
              className={String(conversation.id_conversacion) === String(conversationId) ? 'active' : ''}
              onClick={() => navigate(`/chat/${conversation.id_conversacion}`)}
            >
              <span className="chat-conversation-icon"><ConversationIcon type={conversation.tipo} /></span>
              <span>
                <strong>{conversation.titulo || conversation.nombre || 'Conversación'}</strong>
                <small>{conversation.ultimo_emisor ? `${conversation.ultimo_emisor}: ` : ''}{conversation.ultimo_mensaje || 'Sin mensajes todavía'}</small>
              </span>
              <time>{conversationTime(conversation.ultimo_mensaje_en)}</time>
              {conversation.no_leidos > 0 && <b>{conversation.no_leidos}</b>}
            </button>
          ))}
        </div>
      </aside>

      <div data-tour="chat-thread" className="chat-thread-tour">
        {conversationId ? (
          <ChatThread
            key={conversationId}
            conversationId={conversationId}
            directory={directory}
            context={context}
            onBack={() => navigate(`/chat${contextualQuery}`)}
            onReturnToOrigin={() => navigate(context?.origin || '/admin')}
          />
        ) : (
          <section className="chat-welcome">
            <div>
              <MessageCircle />
              <h2>Comunicación vinculada al trabajo</h2>
              <p>Coordina casos, retiros y tareas sin mezclar la información institucional con mensajería personal.</p>
              <span>Selecciona una conversación para comenzar.</span>
            </div>
          </section>
        )}
      </div>

      {dialog && (
        <CreateConversation
          directory={directory}
          context={context}
          onClose={() => { setDialog(false); if (context) setSearchParams({}); }}
          onCreated={(newConversationId) => {
            setDialog(false);
            load();
            navigate(`/chat/${newConversationId}${contextualQuery}`);
          }}
          canGroup={hasPermission(user, PERMISSIONS.CHAT_GROUP_CREATE)}
          canChannel={hasPermission(user, PERMISSIONS.CHAT_CHANNELS_MANAGE)}
        />
      )}
      {retentionOpen && <ChatRetentionDialog onClose={() => setRetentionOpen(false)} />}
    </main>
  );
};

export default InternalChat;
