import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  UserRoundPlus,
  UsersRound,
  X
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import { getApiErrorMessage } from './utils/apiError';
import { hasPermission, PERMISSIONS } from './permissions';
import './styles/agenda.css';

const API = '/api/agenda';
const dateKey = (value) => {
  const date = new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
const mondayOf = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
};
const addDays = (value, days) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};
const toInputDateTime = (value) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const nextRoundedHour = () => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
};
const emptyForm = () => {
  const start = nextRoundedHour();
  return {
    titulo: '', detalle: '', tipo: 'REUNION', inicio: toInputDateTime(start),
    fin: toInputDateTime(addDays(new Date(start.getTime() + 60 * 60_000), 0)),
    ubicacion: '', todo_el_dia: false, recordatorio_minutos: 30, participantes_ids: []
  };
};
const dayLabel = (date) => new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
const timeLabel = (value) => new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const longDate = (value) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
const typeLabel = (type) => ({ REUNION: 'Reunión', REVISION: 'Revisión', RECORDATORIO: 'Recordatorio', OTRO: 'Otro' }[type] || type);

const AgendaInternal = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useContext(AuthContext);
  const { notify, confirm } = useFeedback();
  const canCreate = hasPermission(user, PERMISSIONS.AGENDA_CREATE);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [people, setPeople] = useState([]);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const newEventButtonRef = useRef(null);
  const dialogRef = useRef(null);

  const updateFormField = (field) => (event) => {
    const value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const requestedEventId = useMemo(() => {
    const value = Number(searchParams.get('evento'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(API, {
        params: { desde: weekStart.toISOString(), hasta: weekEnd.toISOString() },
        withCredentials: true
      });
      const nextEvents = response.data?.events || [];
      setEvents(nextEvents);
      if (requestedEventId) {
        const requested = nextEvents.find((item) => Number(item.id_evento) === requestedEventId);
        if (requested) {
          setSelected(requested);
        } else {
          const detailResponse = await axios.get(`${API}/${requestedEventId}`, { withCredentials: true });
          const requestedDetail = detailResponse.data?.event;
          if (requestedDetail) {
            setSelected(requestedDetail);
            const requestedWeek = mondayOf(new Date(requestedDetail.inicio));
            if (dateKey(requestedWeek) !== dateKey(weekStart)) setWeekStart(requestedWeek);
          }
        }
      } else {
        setSelected((current) => current
          ? nextEvents.find((item) => Number(item.id_evento) === Number(current.id_evento)) || null
          : null);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible cargar tu agenda.'));
    } finally {
      setLoading(false);
    }
  }, [requestedEventId, weekEnd, weekStart]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!dialogOpen || !canCreate) return undefined;
    let cancelled = false;
    setPeopleLoading(true);
    setPeopleError('');
    const timeout = window.setTimeout(async () => {
      try {
        const response = await axios.get(`${API}/directorio`, { params: { q: peopleQuery }, withCredentials: true });
        if (!cancelled) setPeople(response.data?.people || []);
      } catch (requestError) {
        if (!cancelled) {
          setPeople([]);
          setPeopleError(getApiErrorMessage(requestError, 'No fue posible cargar el directorio interno.'));
        }
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [canCreate, dialogOpen, peopleQuery, directoryRetry]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const previousFocus = document.activeElement;
    const fallbackFocus = newEventButtonRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
    window.requestAnimationFrame(() => dialogRef.current?.querySelector(focusableSelector)?.focus());
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDialogOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll(focusableSelector) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      else fallbackFocus?.focus();
    };
  }, [dialogOpen]);

  const selectEvent = (event) => {
    setSelected(event);
    setCancelReason('');
    setSearchParams({ evento: String(event.id_evento) });
  };
  const closeDetail = () => {
    setSelected(null);
    setSearchParams({});
  };
  const togglePerson = (personId) => setForm((current) => ({
    ...current,
    participantes_ids: current.participantes_ids.includes(personId)
      ? current.participantes_ids.filter((id) => id !== personId)
      : [...current.participantes_ids, personId]
  }));

  const createEvent = async (event) => {
    event.preventDefault();
    const start = new Date(form.inicio);
    const end = new Date(form.fin);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      notify('El término debe ser posterior al inicio del evento.', 'error');
      return;
    }
    setSaving(true);
    try {
      const response = await axios.post(API, {
        ...form,
        inicio: start.toISOString(),
        fin: end.toISOString(),
        recordatorio_minutos: Number(form.recordatorio_minutos)
      }, { withCredentials: true });
      setDialogOpen(false);
      setForm(emptyForm());
      setPeopleQuery('');
      notify(response.data.message, 'success');
      setWeekStart(mondayOf(start));
      setSearchParams({ evento: String(response.data.id_evento) });
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, 'No fue posible guardar el evento.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const answerInvitation = async (respuesta) => {
    try {
      const response = await axios.patch(`${API}/${selected.id_evento}/respuesta`, { respuesta }, { withCredentials: true });
      notify(response.data.message, 'success');
      await load();
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, 'No fue posible guardar tu respuesta.'), 'error');
    }
  };

  const cancelEvent = async () => {
    if (cancelReason.trim().length < 5) return;
    const accepted = await confirm({
      title: 'Cancelar evento',
      message: 'El evento permanecerá en el historial y dejarán de enviarse sus recordatorios.',
      confirmLabel: 'Cancelar evento',
      danger: true
    });
    if (!accepted) return;
    try {
      const response = await axios.patch(`${API}/${selected.id_evento}/cancelar`, { motivo: cancelReason }, { withCredentials: true });
      notify(response.data.message, 'success');
      await load();
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, 'No fue posible cancelar el evento.'), 'error');
    }
  };

  const today = dateKey(new Date());
  const upcoming = events.filter((item) => item.estado === 'PROGRAMADO' && new Date(item.fin) >= new Date()).length;
  const pending = events.filter((item) => item.mi_rol === 'PARTICIPANTE' && item.mi_respuesta === 'PENDIENTE' && item.estado === 'PROGRAMADO').length;

  return (
    <main className="agenda-page">
      <header className="agenda-header" data-tour="page-header">
        <div className="agenda-header__identity">
          <span className="agenda-header__icon"><CalendarDays size={25} /></span>
          <div><span className="section-kicker">Coordinación privada</span><h1>Agenda interna</h1><p>Reuniones, revisiones y recordatorios visibles solo para quienes participan.</p></div>
        </div>
        <div className="agenda-header__actions">
          <button type="button" className="app-action app-action--secondary" onClick={() => navigate('/admin')}><ArrowLeft size={17} /> Panel principal</button>
          <button type="button" className="app-action app-action--secondary" onClick={load} disabled={loading}><RefreshCw size={17} /> Actualizar</button>
          {canCreate && <button ref={newEventButtonRef} type="button" className="app-action app-action--primary" onClick={() => setDialogOpen(true)}><Plus size={17} /> Nuevo evento</button>}
        </div>
      </header>

      <div className="agenda-content">
        <section className="agenda-pulse" aria-label="Resumen de agenda">
          <article><CalendarDays /><span>Esta semana<strong>{events.length}</strong><small>eventos visibles para ti</small></span></article>
          <article><Clock3 /><span>Por venir<strong>{upcoming}</strong><small>eventos programados</small></span></article>
          <article data-attention={pending > 0 || undefined}><BellRing /><span>Por responder<strong>{pending}</strong><small>invitaciones pendientes</small></span></article>
        </section>

        <section className="agenda-toolbar" data-tour="agenda-period">
          <div><span>Semana visible</span><strong>{dayLabel(weekStart)} — {dayLabel(addDays(weekStart, 6))}</strong></div>
          <div>
            <button type="button" aria-label="Semana anterior" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft /></button>
            <button type="button" onClick={() => setWeekStart(mondayOf(new Date()))}>Esta semana</button>
            <button type="button" aria-label="Semana siguiente" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight /></button>
          </div>
        </section>

        {error ? (
          <section className="agenda-state agenda-state--error" role="alert"><AlertTriangle /><div><h2>No pudimos cargar la agenda</h2><p>{error}</p></div><button type="button" onClick={load}>Reintentar</button></section>
        ) : loading ? (
          <section className="agenda-state" role="status"><RefreshCw className="spin" /><p>Cargando tu semana…</p></section>
        ) : (
          <section className="agenda-workspace" data-detail-open={selected ? true : undefined}>
            <div className="agenda-week" data-tour="agenda-grid">
              {days.map((day) => {
                const key = dateKey(day);
                const dayEvents = events.filter((item) => dateKey(item.inicio) === key);
                return <article className="agenda-day" data-today={key === today || undefined} key={key}>
                  <header><span>{new Intl.DateTimeFormat('es-CL', { weekday: 'long' }).format(day)}</span><strong>{day.getDate()}</strong></header>
                  <div>{dayEvents.length ? dayEvents.map((item) => (
                    <button type="button" className={`agenda-event agenda-event--${item.tipo.toLowerCase()}`} data-cancelled={item.estado === 'CANCELADO' || undefined} key={item.id_evento} onClick={() => selectEvent(item)}>
                      <span>{item.todo_el_dia ? 'Todo el día' : timeLabel(item.inicio)}</span>
                      <strong>{item.titulo}</strong>
                      <small>{item.ubicacion || typeLabel(item.tipo)}</small>
                      {item.mi_respuesta === 'PENDIENTE' && <em>Por responder</em>}
                    </button>
                  )) : <p>Sin eventos</p>}</div>
                </article>;
              })}
            </div>

            {selected && <aside className="agenda-detail" data-tour="agenda-detail">
              <button type="button" className="agenda-detail__close" onClick={closeDetail} aria-label="Cerrar detalle"><X /></button>
              <span className="agenda-detail__type">{typeLabel(selected.tipo)}</span>
              <h2>{selected.titulo}</h2>
              <p>{selected.detalle || 'Sin descripción adicional.'}</p>
              <dl>
                <div><dt><Clock3 /> Inicio</dt><dd>{longDate(selected.inicio)}</dd></div>
                <div><dt><Clock3 /> Término</dt><dd>{longDate(selected.fin)}</dd></div>
                {selected.ubicacion && <div><dt><MapPin /> Lugar</dt><dd>{selected.ubicacion}</dd></div>}
                <div><dt><BellRing /> Aviso</dt><dd>{selected.mi_recordatorio_minutos === 0 ? 'Al comenzar' : `${selected.mi_recordatorio_minutos} minutos antes`}</dd></div>
              </dl>
              <section><h3><UsersRound /> Participantes</h3>{selected.participantes.map((person) => <div className="agenda-person" key={person.id}><span><strong>{person.nombre}</strong><small>{person.cargo}</small></span><em>{person.rol === 'ORGANIZADOR' ? 'Organiza' : person.respuesta.toLowerCase()}</em></div>)}</section>
              {selected.estado === 'CANCELADO' && <div className="agenda-cancelled"><strong>Evento cancelado</strong><span>{selected.motivo_cancelacion}</span></div>}
              {selected.estado === 'PROGRAMADO' && selected.mi_rol === 'PARTICIPANTE' && selected.mi_respuesta === 'PENDIENTE' && <div className="agenda-response"><button type="button" onClick={() => answerInvitation('ACEPTADA')}><Check /> Aceptar</button><button type="button" onClick={() => answerInvitation('RECHAZADA')}><X /> Rechazar</button></div>}
              {selected.estado === 'PROGRAMADO' && Number(selected.creado_por) === Number(user.id) && <div className="agenda-cancel"><label><span>Motivo para cancelar</span><textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={500} /></label><button type="button" disabled={cancelReason.trim().length < 5} onClick={cancelEvent}>Cancelar evento</button></div>}
            </aside>}
          </section>
        )}
      </div>

      {dialogOpen && <div className="agenda-dialog-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}>
        <form ref={dialogRef} className="agenda-dialog" role="dialog" aria-modal="true" aria-labelledby="agenda-new-title" onSubmit={createEvent} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="section-kicker">Nueva coordinación</span><h2 id="agenda-new-title">Crear evento</h2></div><button type="button" onClick={() => setDialogOpen(false)} aria-label="Cerrar"><X /></button></header>
          <div className="agenda-form-grid">
            <label className="agenda-span-2"><span>Título</span><input value={form.titulo} maxLength={180} required onChange={updateFormField('titulo')} /></label>
            <label><span>Tipo</span><select value={form.tipo} onChange={updateFormField('tipo')}><option value="REUNION">Reunión</option><option value="REVISION">Revisión</option><option value="RECORDATORIO">Recordatorio</option><option value="OTRO">Otro</option></select></label>
            <label><span>Lugar</span><input value={form.ubicacion} maxLength={180} onChange={updateFormField('ubicacion')} placeholder="Opcional" /></label>
            <label><span>Inicio</span><input type="datetime-local" value={form.inicio} required onChange={updateFormField('inicio')} /></label>
            <label><span>Término</span><input type="datetime-local" value={form.fin} required onChange={updateFormField('fin')} /></label>
            <label><span>Recordar</span><select value={form.recordatorio_minutos} onChange={updateFormField('recordatorio_minutos')}><option value="0">Al comenzar</option><option value="10">10 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 día antes</option></select></label>
            <label className="agenda-check"><input type="checkbox" checked={form.todo_el_dia} onChange={updateFormField('todo_el_dia')} /><span>Mostrar como evento de todo el día</span></label>
            <label className="agenda-span-2"><span>Descripción</span><textarea value={form.detalle} maxLength={1500} onChange={updateFormField('detalle')} /></label>
          </div>
          <section className="agenda-invite"><header><div><UserRoundPlus /><span><strong>Invitar compañeros</strong><small>Sin invitados, el evento será solo personal.</small></span></div><input value={peopleQuery} onChange={(event) => setPeopleQuery(event.target.value)} placeholder="Buscar por nombre o cargo" aria-label="Buscar compañeros" /></header><div>{peopleLoading ? <p role="status">Cargando directorio…</p> : peopleError ? <div className="agenda-invite__error" role="alert"><span>{peopleError}</span><button type="button" onClick={() => setDirectoryRetry((value) => value + 1)}>Reintentar</button></div> : people.length ? people.map((person) => <label key={person.id}><input type="checkbox" checked={form.participantes_ids.includes(person.id)} onChange={() => togglePerson(person.id)} /><span><strong>{person.nombre}</strong><small>{person.cargo}</small></span></label>) : <p>No hay personas para mostrar.</p>}</div></section>
          <footer><button type="button" className="app-action app-action--secondary" onClick={() => setDialogOpen(false)}>Volver</button><button type="submit" className="app-action app-action--primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar evento'}</button></footer>
        </form>
      </div>}
    </main>
  );
};

export default AgendaInternal;
