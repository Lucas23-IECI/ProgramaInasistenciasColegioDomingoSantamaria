import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, X } from 'lucide-react';
import { useChatWorkspace } from '../context/ChatWorkspaceContext';
import { getApiErrorMessage } from '../utils/apiError';
import { DEFAULT_CHAT_APPEARANCE } from '../context/useChatAppearance';
import '../styles/chat-appearance.css';

export default function ChatAppearanceDialog({ onClose }) {
  const { appearance, appearanceLoaded, appearanceError, reloadAppearance, saveAppearance, isCurrentSession } = useChatWorkspace();
  const [draft, setDraft] = useState(appearance);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef(null);
  const active = useRef(false);
  const busy = useRef(false);
  const upload = useRef(0);
  const initialized = useRef(false);
  useEffect(() => { if (appearanceLoaded && !initialized.current) { initialized.current = true; setDraft(appearance); } }, [appearanceLoaded, appearance]);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    active.current = true;
    const uploadGeneration = upload;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    const background = [...document.body.children].filter((element) => !element.contains(panel.current))
      .map((element) => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keys = (event) => {
      if (event.key === 'Escape' && !busy.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((el) => el.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    const node = panel.current;
    node.addEventListener('keydown', keys);
    return () => { active.current = false; ++uploadGeneration.current; node.removeEventListener('keydown', keys); background.forEach(({ element, inert }) => { element.inert = inert; }); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  const choose = (value) => { ++upload.current; setReading(false); setDraft((old) => ({ ...old, fondo: value, fondo_data: null })); setError(''); };
  const readImage = (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError('Elige una imagen JPG o PNG de hasta 4 MB.'); return; }
    const version = ++upload.current;
    const reader = new FileReader(); setReading(true); setError('');
    reader.onload = () => { if (active.current && version === upload.current && isCurrentSession()) { setDraft((old) => ({ ...old, fondo: 'personalizado', fondo_data: reader.result })); setReading(false); } };
    reader.onerror = () => { if (active.current && version === upload.current && isCurrentSession()) { setError('No pudimos leer esta imagen. Prueba con otra.'); setReading(false); } };
    reader.readAsDataURL(file);
  };
  const save = async (event) => {
    event.preventDefault(); if (busy.current || reading) return;
    busy.current = true; setSaving(true); setError('');
    try { if (await saveAppearance(draft) && active.current) onClose(); }
    catch (failure) { if (active.current && isCurrentSession()) setError(getApiErrorMessage(failure, 'No pudimos guardar tu apariencia. Los cambios aún no se aplicaron.')); }
    finally { busy.current = false; if (active.current) setSaving(false); }
  };
  return createPortal(<div className="chat-appearance-backdrop"><section className="chat-appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-appearance-title" ref={panel} tabIndex={-1}><form onSubmit={save}>
    <header><div><h2 id="chat-appearance-title">Apariencia del chat</h2><p>Solo cambia cómo lo ves tú, en tus dispositivos.</p></div><button type="button" disabled={saving} onClick={onClose} aria-label="Cerrar apariencia"><X /></button></header>
    {!appearanceLoaded ? <section><p role="alert">{appearanceError || 'Cargando tu apariencia…'}</p>{appearanceError && <button type="button" onClick={reloadAppearance}>Reintentar</button>}</section> : <>
      <fieldset disabled={saving}><legend>Fondo de las conversaciones</legend><div className="chat-background-options">{[['institucional', 'Institucional'], ['salvia', 'Salvia'], ['arena', 'Arena'], ['azul', 'Azul']].map(([value, label]) => <button type="button" key={value} data-background={value} aria-pressed={draft.fondo === value} onClick={() => choose(value)}>{label}</button>)}</div>
      <label className="chat-background-upload"><ImagePlus size={18} /> Usar una imagen propia<input type="file" accept="image/jpeg,image/png" onChange={readImage} disabled={saving} /></label><small>JPG o PNG, hasta 4 MB. La imagen se guarda con tu cuenta; no se comparte como fondo del grupo.</small>
      <div className="chat-background-preview" data-background={draft.fondo} style={draft.fondo === 'personalizado' && draft.fondo_data ? { backgroundImage: `url("${draft.fondo_data}")` } : undefined}><span>Así se verá tu conversación</span></div>
      <label>Tamaño de los mensajes<select value={draft.tamano_texto} onChange={(event) => setDraft({ ...draft, tamano_texto: event.target.value })}><option value="normal">Normal</option><option value="grande">Grande</option></select></label>
      <button type="button" className="chat-appearance-reset" onClick={() => { ++upload.current; setReading(false); setDraft(DEFAULT_CHAT_APPEARANCE); }}>Restablecer apariencia</button></fieldset>
      {error && <p role="alert" className="chat-appearance-error">{error}</p>}
      <footer><button type="button" className="app-action app-action--secondary" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="app-action app-action--primary" disabled={saving || reading}>{saving ? 'Guardando…' : reading ? 'Leyendo imagen…' : 'Guardar apariencia'}</button></footer>
    </>}
  </form></section></div>, document.body);
}
