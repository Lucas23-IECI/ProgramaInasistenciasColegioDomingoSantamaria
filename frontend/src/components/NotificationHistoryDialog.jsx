import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Users } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';
import { getApiErrorMessage } from '../utils/apiError';

const dateTime = (value) => value ? new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'short', timeStyle: 'short'
}).format(new Date(value)) : 'Sin fecha';

const statusLabel = (value) => ({ PENDIENTE: 'Procesando', ENVIADO: 'Enviado', FALLIDO: 'Fallido' }[value] || value);

const NotificationHistoryDialog = ({ onClose }) => {
  const { notify } = useFeedback();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async (targetPage = 1) => {
    setLoading(true); setLoadError('');
    try {
      const response = await axios.get('/api/notificaciones/enviadas', { params: { pagina: targetPage, limite: 20 } });
      setItems(response.data.items || []);
      setPage(Number(response.data.pagination?.page) || targetPage);
      setPages(Number(response.data.pagination?.pages) || 1);
    } catch (error) {
      const message = getApiErrorMessage(error, 'No fue posible cargar el historial de envíos.');
      setLoadError(message); notify(message, 'error');
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const openDetail = async (shipment) => {
    setDetailLoading(true);
    try {
      const response = await axios.get(`/api/notificaciones/enviadas/${shipment.id_envio}`);
      setSelected(response.data);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible cargar el detalle del envío.'), 'error');
    } finally { setDetailLoading(false); }
  };

  const retry = async () => {
    if (!selected || retrying) return;
    setRetrying(true);
    try {
      const response = await axios.post(`/api/notificaciones/envios/${selected.id_envio}/reintentar`);
      notify(`Reintento entregado a ${response.data.destinatarios_total} ${response.data.destinatarios_total === 1 ? 'persona' : 'personas'}.`, 'success');
      setSelected(null); await load(page);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible reintentar el envío.'), 'error');
      await load(page);
    } finally { setRetrying(false); }
  };

  return <div className="notification-composer-backdrop" onMouseDown={onClose}>
    <section className="notification-history" role="dialog" aria-modal="true" aria-labelledby="notification-history-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="section-kicker">Trazabilidad</span><h2 id="notification-history-title">Historial de notificaciones</h2><p>Confirma entrega y lectura por destinatario. Los intentos fallidos pueden reintentarse sin duplicar uno exitoso.</p></div><button type="button" onClick={onClose} aria-label="Cerrar">×</button></header>
      <div className="notification-history__body">
        <div className="notification-history__list">
          {loading ? <div className="notification-history__state">Cargando historial…</div> : loadError ? <div className="notification-history__state" role="alert"><AlertTriangle /><strong>No pudimos cargar el historial</strong><span>{loadError}</span><button type="button" onClick={() => load(page)}>Reintentar</button></div> : items.length === 0 ? <div className="notification-history__state"><Users /><strong>Aún no hay envíos</strong><span>Los avisos enviados desde Dirección aparecerán aquí.</span></div> : items.map((item) => <button type="button" key={item.id_envio} className={selected?.id_envio === item.id_envio ? 'is-selected' : ''} onClick={() => openDetail(item)} disabled={detailLoading}><div><span className={`notification-history__status status-${String(item.estado).toLowerCase()}`}>{statusLabel(item.estado)}</span><time>{dateTime(item.creado_en)}</time></div><strong>{item.titulo}</strong><p>{item.detalle}</p><footer><span><Users size={14} /> {item.entregadas}/{item.destinatarios_total} entregadas</span><span>{item.leidas} leídas</span></footer></button>)}
        </div>
        <aside className="notification-history__detail">
          {detailLoading ? <div className="notification-history__state">Cargando detalle…</div> : !selected ? <div className="notification-history__state"><strong>Selecciona un envío</strong><span>Verás el estado exacto de cada destinatario.</span></div> : <><div className="notification-history__detail-heading"><div><span className={`notification-history__status status-${String(selected.estado).toLowerCase()}`}>{statusLabel(selected.estado)}</span><h3>{selected.titulo}</h3><p>{selected.detalle}</p></div>{selected.estado === 'FALLIDO' && <button type="button" onClick={retry} disabled={retrying}>{retrying ? 'Reintentando…' : 'Reintentar envío'}</button>}</div>{selected.error_publico && <div className="notification-history__failure" role="alert"><AlertTriangle size={18} /><span>{selected.error_publico}</span></div>}<div className="notification-history__recipients">{selected.recipients.length === 0 ? <p>No se alcanzó a entregar el aviso a ningún destinatario.</p> : selected.recipients.map((recipient) => <article key={recipient.id_notificacion}><span className={recipient.estado === 'LEIDA' ? 'is-read' : ''} aria-hidden="true">{recipient.estado === 'LEIDA' ? '✓' : '•'}</span><div><strong>{recipient.destinatario_nombre}</strong><small>{recipient.destinatario_cargo}</small></div><time>{recipient.estado === 'LEIDA' ? `Leída ${dateTime(recipient.leida_en)}` : `Entregada ${dateTime(recipient.entregada_en)}`}</time></article>)}</div></>}
        </aside>
      </div>
      <footer><button type="button" onClick={() => load(Math.max(1, page - 1))} disabled={page <= 1}>Anterior</button><span>Página {page} de {pages}</span><button type="button" onClick={() => load(Math.min(pages, page + 1))} disabled={page >= pages}>Siguiente</button></footer>
    </section>
  </div>;
};

export default NotificationHistoryDialog;
