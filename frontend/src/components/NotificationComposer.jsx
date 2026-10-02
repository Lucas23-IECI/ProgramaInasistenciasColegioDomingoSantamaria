import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Search, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';
import { getApiErrorMessage } from '../utils/apiError';

const PRIORITIES = [
  { value: 'NORMAL', label: 'Normal', description: 'Información habitual.' },
  { value: 'IMPORTANTE', label: 'Importante', description: 'Requiere atención.' },
  { value: 'URGENTE', label: 'Urgente', description: 'Debe revisarse pronto.' }
];

const AUDIENCE_VIEWS = [
  { value: 'personas', label: 'Personas', icon: UserRound },
  { value: 'perfiles', label: 'Perfiles', icon: ShieldCheck },
  { value: 'grupos', label: 'Equipos', icon: UsersRound }
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
  const [audiences, setAudiences] = useState({ personas: [], perfiles: [], grupos: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [audienceView, setAudienceView] = useState('personas');
  const [selectedPeople, setSelectedPeople] = useState(() => [...new Set(initialRecipients.map(Number).filter(Number.isSafeInteger))]);
  const [selectedProfiles, setSelectedProfiles] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [title, setTitle] = useState(initialTitle);
  const [detail, setDetail] = useState(initialDetail);
  const [priority, setPriority] = useState(initialPriority);
  const [link, setLink] = useState(initialLink);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    axios.get('/api/notificaciones/audiencias')
      .then((response) => {
        if (!active) return;
        setAudiences({
          personas: response.data?.personas || [],
          perfiles: response.data?.perfiles || [],
          grupos: response.data?.grupos || []
        });
      })
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
    const options = audiences[audienceView] || [];
    if (!normalized) return options;
    return options.filter((item) => (
      `${item.nombre} ${item.cargo || ''} ${item.perfil_nombre || ''} ${item.correo || ''} ${item.descripcion || ''}`
        .toLowerCase()
        .includes(normalized)
    ));
  }, [audiences, audienceView, query]);

  const activeSelection = audienceView === 'personas'
    ? selectedPeople
    : audienceView === 'perfiles' ? selectedProfiles : selectedGroups;
  const setActiveSelection = audienceView === 'personas'
    ? setSelectedPeople
    : audienceView === 'perfiles' ? setSelectedProfiles : setSelectedGroups;
  const optionId = (item) => audienceView === 'personas' ? Number(item.id) : item.codigo;
  const selectedSet = useMemo(() => new Set(activeSelection), [activeSelection]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedSet.has(optionId(item)));
  const selectionCount = selectedPeople.length + selectedProfiles.length + selectedGroups.length;

  const toggleAudience = (itemId) => {
    setActiveSelection((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId]);
  };

  const toggleFiltered = () => {
    const filteredIds = filtered.map(optionId);
    setActiveSelection((current) => allFilteredSelected
      ? current.filter((itemId) => !filteredIds.includes(itemId))
      : [...new Set([...current, ...filteredIds])]);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (selectionCount === 0 || saving) return;
    setSaving(true);
    try {
      const response = await axios.post('/api/notificaciones/envios', {
        titulo: title,
        detalle: detail,
        prioridad: priority,
        destinatarios: selectedPeople,
        perfiles: selectedProfiles,
        grupos: selectedGroups,
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
                <span>{selectionCount} {selectionCount === 1 ? 'selección' : 'selecciones'}</span>
              </div>
              <button type="button" onClick={toggleFiltered} disabled={filtered.length === 0}>
                {allFilteredSelected ? 'Quitar visibles' : 'Seleccionar visibles'}
              </button>
            </div>
            <div className="notification-audience-tabs" role="tablist" aria-label="Tipo de destinatario">
              {AUDIENCE_VIEWS.map((view) => {
                const Icon = view.icon;
                const count = view.value === 'personas' ? selectedPeople.length : view.value === 'perfiles' ? selectedProfiles.length : selectedGroups.length;
                return <button key={view.value} type="button" role="tab" aria-selected={audienceView === view.value} className={audienceView === view.value ? 'is-active' : ''} onClick={() => { setAudienceView(view.value); setQuery(''); }}><Icon size={15} /> {view.label}{count > 0 ? ` · ${count}` : ''}</button>;
              })}
            </div>
            <label className="notification-directory-search">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={audienceView === 'personas' ? 'Buscar por nombre, cargo o perfil' : audienceView === 'perfiles' ? 'Buscar perfil de acceso' : 'Buscar equipo institucional'} />
            </label>
            <div className="notification-directory">
              {loading ? <p>Cargando directorio…</p> : loadError ? (
                <div className="notification-directory__error" role="alert">
                  <p>{loadError}</p>
                  <button type="button" onClick={() => setDirectoryAttempt((current) => current + 1)}>Reintentar</button>
                </div>
              ) : filtered.length === 0 ? (
                <p>No hay {audienceView} que coincidan con la búsqueda.</p>
              ) : filtered.map((item) => {
                const itemId = optionId(item);
                const detailText = audienceView === 'personas'
                  ? `${item.cargo}${item.perfil_nombre ? ` · ${item.perfil_nombre}` : ''}`
                  : `${item.cuentas_activas} ${Number(item.cuentas_activas) === 1 ? 'cuenta activa' : 'cuentas activas'}${item.descripcion ? ` · ${item.descripcion}` : ''}`;
                return <label key={`${audienceView}-${itemId}`}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(itemId)}
                    onChange={() => toggleAudience(itemId)}
                  />
                  <span>
                    <strong>{item.nombre}</strong>
                    <small>{detailText}</small>
                  </span>
                </label>;
              })}
            </div>
            <small className="notification-audience-note">Las personas repetidas entre perfiles y equipos reciben un solo aviso. El total exacto se confirma antes de entregar.</small>
          </section>
        </div>

        <footer>
          <span>El envío quedará registrado en auditoría.</span>
          <button type="button" className="app-action app-action--secondary" onClick={onClose}>Cancelar</button>
          <button className="app-action app-action--primary" disabled={saving || selectionCount === 0 || title.trim().length < 4 || detail.trim().length < 5}>
            {saving ? 'Enviando…' : 'Enviar notificación'}
          </button>
        </footer>
      </form>
    </div>
  );
};

export default NotificationComposer;
