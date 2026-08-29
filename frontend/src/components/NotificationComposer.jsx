import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Search } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';
import { getApiErrorMessage } from '../utils/apiError';

const PRIORITIES = [
  { value: 'NORMAL', label: 'Normal', description: 'Información habitual.' },
  { value: 'IMPORTANTE', label: 'Importante', description: 'Requiere atención.' },
  { value: 'URGENTE', label: 'Urgente', description: 'Debe revisarse pronto.' }
];

const NotificationComposer = ({
  onClose,
  onSent,
  initialRecipients = [],
  initialTitle = '',
  initialDetail = '',
  initialPriority = 'NORMAL',
  initialLink = ''
}) => {
  const { notify } = useFeedback();
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => [...new Set(initialRecipients.map(Number).filter(Number.isSafeInteger))]);
  const [title, setTitle] = useState(initialTitle);
  const [detail, setDetail] = useState(initialDetail);
  const [priority, setPriority] = useState(initialPriority);
  const [link, setLink] = useState(initialLink);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    axios.get('/api/notificaciones/directorio')
      .then((response) => { if (active) setDirectory(response.data || []); })
      .catch((error) => {
        if (!active) return;
        const message = getApiErrorMessage(error, 'No fue posible cargar el directorio institucional.');
        setLoadError(message);
        notify(message, 'error');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notify, directoryAttempt]);

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return directory;
    return directory.filter((person) => (
      `${person.nombre} ${person.cargo} ${person.perfil_nombre || ''} ${person.correo}`
        .toLowerCase()
        .includes(normalized)
    ));
  }, [directory, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((person) => selectedSet.has(person.id));

  const togglePerson = (personId) => {
    setSelected((current) => current.includes(personId)
      ? current.filter((id) => id !== personId)
      : [...current, personId]);
  };

  const toggleFiltered = () => {
    const filteredIds = filtered.map((person) => person.id);
    setSelected((current) => allFilteredSelected
      ? current.filter((personId) => !filteredIds.includes(personId))
      : [...new Set([...current, ...filteredIds])]);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (selected.length === 0 || saving) return;
    setSaving(true);
    try {
      const response = await axios.post('/api/notificaciones/envios', {
        titulo: title,
        detalle: detail,
        prioridad: priority,
        destinatarios: selected,
        enlace: link || null
      });
      const count = response.data.destinatarios_total;
      notify(`Notificación enviada a ${count} ${count === 1 ? 'persona' : 'personas'}.`, 'success');
      onSent?.();
      onClose();
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible enviar la notificación.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notification-composer-backdrop" onMouseDown={onClose}>
      <form
        className="notification-composer"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-composer-title"
      >
        <header>
          <div>
            <span className="section-kicker">Comunicación institucional</span>
            <h2 id="notification-composer-title">Enviar una notificación</h2>
            <p>Aparecerá dentro de la aplicación de cada persona seleccionada.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="notification-composer__content">
          <section className="notification-composer__message">
            <label>
              Título
              <input
                required
                minLength={4}
                maxLength={180}
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ej. Reunión extraordinaria"
              />
            </label>
            <label>
              Mensaje
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={6}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Indica qué necesitan saber o hacer."
              />
              <small>{detail.length}/1000</small>
            </label>
            <fieldset>
              <legend>Prioridad</legend>
              <div className="notification-priorities">
                {PRIORITIES.map((item) => (
                  <label key={item.value} className={priority === item.value ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="priority"
                      value={item.value}
                      checked={priority === item.value}
                      onChange={() => setPriority(item.value)}
                    />
                    <span><strong>{item.label}</strong><small>{item.description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Abrir una sección al tocar el aviso (opcional)
              <select value={link} onChange={(event) => setLink(event.target.value)}>
                <option value="">Solo mostrar el aviso</option>
                {link && !['/admin', '/chat', '/admin/seguimiento'].includes(link) && <option value={link}>Abrir el registro relacionado</option>}
                <option value="/admin">Panel principal</option>
                <option value="/chat">Chat interno</option>
                <option value="/admin/seguimiento">Seguimiento institucional</option>
              </select>
            </label>
          </section>

          <section className="notification-composer__recipients">
            <div className="notification-composer__recipients-header">
              <div>
                <strong>Destinatarios</strong>
                <span>{selected.length} seleccionada{selected.length === 1 ? '' : 's'}</span>
              </div>
              <button type="button" onClick={toggleFiltered} disabled={filtered.length === 0}>
                {allFilteredSelected ? 'Quitar visibles' : 'Seleccionar visibles'}
              </button>
            </div>
            <label className="notification-directory-search">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, cargo o perfil" />
            </label>
            <div className="notification-directory">
              {loading ? <p>Cargando directorio…</p> : loadError ? (
                <div className="notification-directory__error" role="alert">
                  <p>{loadError}</p>
                  <button type="button" onClick={() => setDirectoryAttempt((current) => current + 1)}>Reintentar</button>
                </div>
              ) : filtered.length === 0 ? (
                <p>No hay personas que coincidan con la búsqueda.</p>
              ) : filtered.map((person) => (
                <label key={person.id}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(person.id)}
                    onChange={() => togglePerson(person.id)}
                  />
                  <span>
                    <strong>{person.nombre}</strong>
                    <small>{person.cargo}{person.perfil_nombre ? ` · ${person.perfil_nombre}` : ''}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <footer>
          <span>El envío quedará registrado en auditoría.</span>
          <button type="button" className="app-action app-action--secondary" onClick={onClose}>Cancelar</button>
          <button className="app-action app-action--primary" disabled={saving || selected.length === 0 || title.trim().length < 4 || detail.trim().length < 5}>
            {saving ? 'Enviando…' : 'Enviar notificación'}
          </button>
        </footer>
      </form>
    </div>
  );
};

export default NotificationComposer;
