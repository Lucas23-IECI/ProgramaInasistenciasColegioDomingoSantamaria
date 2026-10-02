import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, WifiOff } from 'lucide-react';
import { API_URL } from '../config';
import '../styles/offline-sync.css';
import {
  flushOfflineRegistrations,
  getOfflineQueueSnapshot,
  retryOfflineRegistration,
  subscribeOfflineQueue
} from '../pwa/offlineStore';

const PAGE_SIZE = 5;
const EMPTY = { pending: [], failed: [], synced: [] };
const STORAGE_ERROR = 'No fue posible abrir la bandeja guardada en este dispositivo. No registres ingresos sin conexión hasta recargar la aplicación y confirmar que la bandeja vuelve a estar disponible.';
const tabs = [
  ['pending', 'Pendientes'],
  ['failed', 'Con error'],
  ['synced', 'Sincronizados']
];

const dateTime = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha disponible';
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
};

const sender = (payload) => axios.post(`${API_URL}/puntualidad/registros`, payload);

const OfflineSyncPanel = () => {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [active, setActive] = useState('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [feedback, setFeedback] = useState('');
  const [storageError, setStorageError] = useState('');

  const load = useCallback(async () => {
    try {
      setSnapshot(await getOfflineQueueSnapshot());
      setStorageError('');
    } catch {
      setSnapshot(EMPTY);
      setStorageError(STORAGE_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = subscribeOfflineQueue(load);
    const updateConnectivity = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    return () => {
      unsubscribe();
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
    };
  }, [load]);

  useEffect(() => { setPage(1); }, [active]);

  const visible = snapshot[active] || [];
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const synchronize = async () => {
    setBusy('all');
    setFeedback('');
    try {
      const result = await flushOfflineRegistrations(sender);
      if (result.synced) setFeedback(`${result.synced} ${result.synced === 1 ? 'ingreso fue confirmado' : 'ingresos fueron confirmados'} por el servidor.`);
      else if (result.networkUnavailable) setFeedback('El servidor todavía no responde. Los ingresos siguen protegidos en este dispositivo.');
      else setFeedback('No hay ingresos pendientes que puedan sincronizarse ahora.');
      await load();
    } catch {
      setStorageError(STORAGE_ERROR);
      setFeedback('La sincronización no comenzó porque la bandeja local no está disponible. No se confirmó ningún ingreso con el servidor.');
    } finally {
      setBusy('');
    }
  };

  const retry = async (item) => {
    setBusy(item.offline_operation_id);
    setFeedback('');
    try {
      const result = await retryOfflineRegistration(item.offline_operation_id, sender);
      if (result.synced) {
        setFeedback('El ingreso fue confirmado por el servidor sin crear duplicados.');
        setActive('synced');
      } else if (result.networkUnavailable) {
        setFeedback('El servidor todavía no responde. El ingreso permanece pendiente.');
        setActive('pending');
      } else {
        setFeedback('El servidor volvió a rechazar el ingreso. Revisa la causa indicada antes de otro intento.');
      }
      await load();
    } catch {
      setStorageError(STORAGE_ERROR);
      setFeedback('El reintento no comenzó porque la bandeja local no está disponible. El servidor no confirmó este ingreso.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="offline-sync-panel" aria-labelledby="offline-sync-title" data-tour="pwa-sync-panel">
      <header>
        <div><span>Continuidad de Porteria</span><h3 id="offline-sync-title">Bandeja de sincronización</h3><p>Solo conserva ingresos capturados sin conexión en este dispositivo.</p></div>
        <button type="button" onClick={synchronize} disabled={!online || Boolean(storageError) || busy === 'all' || !snapshot.pending.length}>
          {online ? <RefreshCw size={17} className={busy === 'all' ? 'is-spinning' : ''} /> : <WifiOff size={17} />}
          {online ? busy === 'all' ? 'Sincronizando…' : 'Sincronizar ahora' : 'Sin conexión'}
        </button>
      </header>

      {!online && <div className="offline-sync-panel__network" role="status"><WifiOff size={18} /><span>Sin conexión de red. No se perdió ningún ingreso: los pendientes se mantienen en este equipo.</span></div>}
      {storageError && <div className="offline-sync-panel__network offline-sync-panel__storage-error" role="alert"><AlertTriangle size={19} /><div><strong>Bandeja local no disponible</strong><span>{storageError}</span></div><button type="button" onClick={load} disabled={loading}>{loading ? 'Revisando…' : 'Reintentar apertura'}</button></div>}
      {feedback && <div className="offline-sync-panel__feedback" role="status">{feedback}</div>}

      <div className="offline-sync-panel__tabs" role="tablist" aria-label="Estado de sincronización">
        {tabs.map(([key, label]) => <button type="button" role="tab" aria-selected={active === key} key={key} onClick={() => setActive(key)}><span>{label}</span><strong>{snapshot[key].length}</strong></button>)}
      </div>

      <div className="offline-sync-panel__list" role="tabpanel">
        {loading ? <div className="offline-sync-panel__empty">Revisando este dispositivo…</div> : storageError ? <div className="offline-sync-panel__empty">La lista no se muestra porque su contenido no pudo verificarse.</div> : pageItems.length ? pageItems.map((item) => <article key={item.offline_operation_id} data-status={item.sync_status}>
          <span className="offline-sync-panel__status" aria-hidden="true">{item.sync_status === 'SINCRONIZADO' ? <CheckCircle2 size={19} /> : item.sync_status === 'FALLIDO' ? <AlertTriangle size={19} /> : <Clock3 size={19} />}</span>
          <div><strong>{item.persona}</strong><span>{item.curso} · capturado {dateTime(item.capturado_en)}</span><small>{item.sync_status === 'SINCRONIZADO' ? item.resultado : item.sync_status === 'FALLIDO' ? item.ultimo_error_publico : item.sync_status === 'SINCRONIZANDO' ? 'Confirmando con el servidor…' : item.ultimo_error_publico || 'En espera de conexión con el servidor.'}</small></div>
          {item.sync_status === 'FALLIDO' && <button type="button" onClick={() => retry(item)} disabled={!online || Boolean(busy)}><RefreshCw size={15} className={busy === item.offline_operation_id ? 'is-spinning' : ''} /> {busy === item.offline_operation_id ? 'Reintentando…' : 'Reintentar'}</button>}
        </article>) : <div className="offline-sync-panel__empty">{active === 'pending' ? 'No hay ingresos pendientes.' : active === 'failed' ? 'No hay ingresos que requieran intervención.' : 'Todavía no hay sincronizaciones recientes en este dispositivo.'}</div>}
      </div>

      {pages > 1 && <footer><button type="button" onClick={() => setPage((current) => current - 1)} disabled={page === 1}>Anterior</button><span>Página {page} de {pages}</span><button type="button" onClick={() => setPage((current) => current + 1)} disabled={page === pages}>Siguiente</button></footer>}
    </section>
  );
};

export default OfflineSyncPanel;
