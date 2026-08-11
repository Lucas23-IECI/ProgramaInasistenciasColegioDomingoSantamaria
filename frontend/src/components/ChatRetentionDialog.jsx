import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Archive, Play, Save, ShieldCheck, X } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';

const API = '/api/chat';
const messageOf = (error, fallback) => error.response?.data?.message || fallback;

const ChatRetentionDialog = ({ onClose }) => {
  const { notify, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await axios.get(`${API}/configuracion`)).data);
    } catch (error) {
      notify(messageOf(error, 'No fue posible cargar la política de retención.'), 'error');
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const configuration = await axios.patch(`${API}/configuracion`, data.configuration);
      setData({ ...data, configuration: configuration.data });
      notify('Política de retención guardada.', 'success');
    } catch (error) {
      notify(messageOf(error, 'No fue posible guardar la política.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const apply = async () => {
    if (!data.configuration.retencion_activa) {
      return notify('Activa la retención y guarda la política antes de ejecutarla.', 'error');
    }
    const accepted = await confirm({
      title: 'Aplicar retención del chat',
      message: `Se retirará el contenido de ${data.preview?.mensajes || 0} mensajes vencidos. La acción quedará auditada y no puede deshacerse.`,
      confirmLabel: 'Aplicar política',
    });
    if (!accepted) return undefined;

    setSaving(true);
    try {
      const result = await axios.post(`${API}/configuracion/retencion/ejecutar`);
      notify(`Retención aplicada a ${result.data.mensajes || 0} mensajes.`, 'success');
      await load();
    } catch (error) {
      notify(messageOf(error, 'No fue posible aplicar la retención.'), 'error');
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <div className="chat-dialog-backdrop" onMouseDown={() => !saving && onClose()}>
      <section
        className="chat-dialog chat-retention"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-retention-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="section-kicker">Gobierno de comunicaciones</span>
            <h2 id="chat-retention-title">Retención del chat institucional</h2>
            <p>La eliminación automática permanece desactivada hasta que exista una política institucional aprobada.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X /></button>
        </header>

        {!data ? <div className="chat-retention__loading">Cargando política…</div> : (
          <>
            <div className="chat-retention__warning">
              <ShieldCheck />
              <p><strong>Control reversible antes de aplicar</strong> Guardar solo configura la política. “Aplicar ahora” requiere una confirmación independiente.</p>
            </div>
            <label className="chat-retention__toggle">
              <input
                type="checkbox"
                checked={data.configuration.retencion_activa}
                onChange={(event) => setData({ ...data, configuration: { ...data.configuration, retencion_activa: event.target.checked } })}
              />
              <span><strong>Retención automática activa</strong><small>El servicio revisará diariamente el contenido vencido.</small></span>
            </label>
            <div className="chat-retention__fields">
              <label>
                Retención general (días)
                <input
                  type="number"
                  min="30"
                  max="3650"
                  value={data.configuration.retencion_predeterminada_dias}
                  onChange={(event) => setData({ ...data, configuration: { ...data.configuration, retencion_predeterminada_dias: event.target.value } })}
                />
              </label>
              <label className="chat-retention__check">
                <input
                  type="checkbox"
                  checked={data.configuration.preservar_fijados}
                  onChange={(event) => setData({ ...data, configuration: { ...data.configuration, preservar_fijados: event.target.checked } })}
                />
                Conservar mensajes fijados
              </label>
            </div>
            <div className="chat-retention__preview">
              <Archive />
              <span><strong>{data.preview?.mensajes || 0}</strong> mensajes vencidos</span>
              <span><strong>{data.preview?.archivos || 0}</strong> adjuntos vinculados</span>
            </div>
          </>
        )}

        <footer>
          <button type="button" className="app-action app-action--secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="app-action app-action--secondary" onClick={apply} disabled={!data || saving}><Play size={16} /> Aplicar ahora</button>
          <button type="button" className="app-action app-action--primary" onClick={save} disabled={!data || saving}><Save size={16} /> Guardar política</button>
        </footer>
      </section>
    </div>
  );
};

export default ChatRetentionDialog;
