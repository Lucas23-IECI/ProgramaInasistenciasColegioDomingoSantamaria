import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ImageOff, Paperclip, X, ZoomIn, ZoomOut } from 'lucide-react';
import '../styles/chat-media.css';

const validId = (value) => /^[1-9]\d*$/.test(String(value ?? ''));
const imageTypes = new Set(['image/jpeg', 'image/png']);

function AvatarImage({ source, fallback }) {
  const [failed, setFailed] = useState(false);
  return failed ? fallback : <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function ChatAvatar({ conversation, fallback, className = '' }) {
  const source = validId(conversation?.id_conversacion) && conversation?.foto_version
    ? `/api/chat/conversaciones/${conversation.id_conversacion}/foto?v=${encodeURIComponent(conversation.foto_version)}`
    : null;
  return <span className={`${className} chat-media-avatar`} aria-hidden="true">
    {source ? <AvatarImage key={source} source={source} fallback={fallback} /> : fallback}
  </span>;
}

function ImageViewer({ source, file, onClose, onDownload }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const background = [...document.body.children]
      .filter((element) => !element.contains(dialogRef.current))
      .map((element) => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), [tabindex="0"]') || [])]
          .filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) return;
        if (!dialogRef.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  return createPortal(
    <div className="chat-media-viewer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="chat-media-viewer">
        <header>
          <h2 id={titleId}>{file.nombre}</h2>
          <div className="chat-media-viewer__actions">
            <button type="button" disabled={status !== 'loaded'} aria-label={zoomed ? 'Ajustar imagen a la pantalla' : 'Ampliar imagen'} aria-pressed={zoomed} onClick={() => setZoomed((value) => !value)}>
              {zoomed ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
            </button>
            <button type="button" aria-label="Descargar imagen" onClick={() => onDownload(file)}><Download size={20} /></button>
            <button ref={closeRef} type="button" aria-label="Cerrar imagen" onClick={onClose}><X size={22} /></button>
          </div>
        </header>
        <div className={`chat-media-viewer__stage${zoomed ? ' is-zoomed' : ''}`} tabIndex={status === 'loaded' ? 0 : undefined} aria-label="Imagen compartida">
          {status === 'loading' && <p role="status" className="chat-media-viewer__status">Cargando imagen…</p>}
          {status === 'error'
            ? <div role="alert" className="chat-media-viewer__error"><ImageOff size={32} /><p>No se pudo mostrar la imagen.</p><span>Puedes intentar descargar el archivo desde el botón de arriba.</span></div>
            : <img src={source} alt={file.nombre} decoding="async" onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} />}
        </div>
      </section>
    </div>, document.body,
  );
}

function ImageAttachment({ source, file, onDownload }) {
  const [status, setStatus] = useState('loading');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <div className="chat-photo-attachment">
    {status === 'error'
      ? <p className="chat-photo-attachment__error"><ImageOff size={18} /> Vista previa no disponible.</p>
      : <button type="button" className="chat-photo-attachment__preview" aria-label={`Ver imagen ${file.nombre}`} onClick={() => setOpen(true)}>
        <img src={source} alt="" loading="lazy" decoding="async" onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} />
        {status === 'loading' && <span className="chat-photo-attachment__loading" role="status">Cargando imagen…</span>}
      </button>}
    <button type="button" className="chat-attachment chat-photo-attachment__download" onClick={() => onDownload(file)}>
      <span><Paperclip size={15} /></span>
      <span><strong>{file.nombre}</strong><small>Descargar imagen</small></span>
      <Download size={15} />
    </button>
    {open && <ImageViewer source={source} file={file} onClose={close} onDownload={onDownload} />}
  </div>;
}

export function ChatAttachment({ conversationId, file, onDownload }) {
  // MIME is supplied by the server after inspecting the uploaded bytes. The
  // filename alone must never opt untrusted SVG/HTML files into image preview.
  const source = validId(conversationId) && validId(file.id_adjunto) && imageTypes.has(file.mime_type)
    ? `/api/chat/conversaciones/${conversationId}/adjuntos/${file.id_adjunto}/vista`
    : null;
  if (source) return <ImageAttachment key={source} source={source} file={file} onDownload={onDownload} />;
  return <button type="button" className="chat-attachment" onClick={() => onDownload(file)}>
    <span><Paperclip size={15} /></span>
    <span><strong>{file.nombre}</strong><small>Descargar archivo</small></span>
    <Download size={15} />
  </button>;
}
