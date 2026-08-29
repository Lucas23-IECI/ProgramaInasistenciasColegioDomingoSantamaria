import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import {
  Check,
  Image as ImageIcon,
  LoaderCircle,
  RotateCcw,
  RotateCw,
  Scan,
  Undo2,
  X,
  ZoomIn
} from 'lucide-react';
import { createCroppedImageBlob, PROFILE_IMAGE_OUTPUTS } from '../utils/profileImageEditor';
import { getSafeErrorMessage } from '../utils/apiError';

const EDITOR_COPY = Object.freeze({
  avatar: {
    eyebrow: 'Foto de perfil',
    title: 'Ajusta tu foto',
    description: 'Mueve y amplía la imagen hasta que el rostro o elemento principal quede dentro del círculo.',
    preview: 'Vista final del avatar'
  },
  cover: {
    eyebrow: 'Imagen de portada',
    title: 'Ajusta tu portada',
    description: 'Reposiciona la fotografía para elegir exactamente la franja que verá el equipo.',
    preview: 'Vista final de la portada'
  }
});

const normalizeRotation = (value) => ((value % 360) + 360) % 360;

const ProfileImageEditor = ({ category, file, onCancel, onSave }) => {
  const copy = EDITOR_COPY[category] || EDITOR_COPY.avatar;
  const output = PROFILE_IMAGE_OUTPUTS[category] || PROFILE_IMAGE_OUTPUTS.avatar;
  const closeButtonRef = useRef(null);
  const [imageSrc, setImageSrc] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixelCrop, setPixelCrop] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const cropClasses = useMemo(() => ({
    containerClassName: `profile-image-editor__cropper${dragging ? ' is-dragging' : ''}`,
    mediaClassName: 'profile-image-editor__media',
    cropAreaClassName: 'profile-image-editor__crop-area'
  }), [dragging]);

  useEffect(() => {
    const source = URL.createObjectURL(file);
    setImageSrc(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (!imageSrc || !pixelCrop) return undefined;
    let active = true;
    let generatedUrl = '';
    setPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const previewScale = category === 'avatar' ? 280 : 660;
        const blob = await createCroppedImageBlob({
          imageSrc,
          pixelCrop,
          rotation,
          outputWidth: category === 'avatar' ? previewScale : previewScale,
          outputHeight: category === 'avatar' ? previewScale : Math.round(previewScale / output.aspect),
          quality: 0.86
        });
        if (!active) return;
        generatedUrl = URL.createObjectURL(blob);
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return generatedUrl;
        });
      } catch {
        if (active) setPreviewUrl('');
      } finally {
        if (active) setPreviewLoading(false);
      }
    }, 140);

    return () => {
      active = false;
      window.clearTimeout(timer);
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [category, imageSrc, output.aspect, pixelCrop, rotation]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const reset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setError('');
  };

  const rotate = (step) => {
    setRotation((current) => normalizeRotation(current + step));
    setError('');
  };

  const handleCropComplete = useCallback((_, croppedAreaPixels) => {
    setPixelCrop(croppedAreaPixels);
  }, []);

  const save = async () => {
    if (!imageSrc || !pixelCrop || pending) return;
    setPending(true);
    setError('');
    try {
      const blob = await createCroppedImageBlob({
        imageSrc,
        pixelCrop,
        rotation,
        outputWidth: output.width,
        outputHeight: output.height,
        quality: 0.92
      });
      await onSave(blob, { crop, zoom, rotation, pixelCrop });
    } catch (saveError) {
      setError(getSafeErrorMessage(saveError, 'No fue posible guardar la imagen. Tus ajustes se conservaron.'));
    } finally {
      setPending(false);
    }
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
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

  return createPortal(
    <div className="profile-image-editor-backdrop" role="presentation" onMouseDown={() => { if (!pending) onCancel(); }}>
      <section
        className="profile-image-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-image-editor-title"
        aria-describedby="profile-image-editor-description"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="profile-image-editor__header">
          <div className="profile-image-editor__heading">
            <span><ImageIcon size={15} /> {copy.eyebrow}</span>
            <h2 id="profile-image-editor-title">{copy.title}</h2>
            <p id="profile-image-editor-description">{copy.description}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="profile-image-editor__close" onClick={onCancel} disabled={pending} aria-label="Cerrar editor de imagen">
            <X size={21} />
          </button>
        </header>

        <div className="profile-image-editor__workspace">
          <div className="profile-image-editor__main">
            <div className="profile-image-editor__stage" data-category={category} role="group" aria-label="Área interactiva de recorte">
              {imageSrc && (
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  aspect={output.aspect}
                  cropShape={category === 'avatar' ? 'round' : 'rect'}
                  showGrid={category === 'cover'}
                  objectFit="cover"
                  minZoom={1}
                  maxZoom={3}
                  zoomWithScroll
                  zoomSpeed={0.8}
                  roundCropAreaPixels
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={handleCropComplete}
                  onInteractionStart={() => setDragging(true)}
                  onInteractionEnd={() => setDragging(false)}
                  classes={cropClasses}
                  mediaProps={{ alt: '' }}
                />
              )}
              <div className="profile-image-editor__gesture-hint" aria-hidden="true"><Scan size={16} /> Arrastra para reposicionar</div>
            </div>

            <div className="profile-image-editor__controls" aria-label="Ajustes de imagen">
              <label className="profile-image-editor__zoom">
                <span><ZoomIn size={17} /> Zoom <strong>{Math.round(zoom * 100)}%</strong></span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(event) => { setZoom(Number(event.target.value)); setError(''); }}
                  aria-label="Nivel de zoom"
                />
              </label>
              <div className="profile-image-editor__control-buttons">
                <button type="button" onClick={() => rotate(-90)} disabled={pending} aria-label="Girar 90 grados a la izquierda"><RotateCcw size={18} /><span>Girar izquierda</span></button>
                <button type="button" onClick={() => rotate(90)} disabled={pending} aria-label="Girar 90 grados a la derecha"><RotateCw size={18} /><span>Girar derecha</span></button>
                <button type="button" onClick={reset} disabled={pending} aria-label="Restablecer ajustes"><Undo2 size={18} /><span>Restablecer</span></button>
              </div>
            </div>
          </div>

          <aside className="profile-image-editor__preview" aria-live="polite">
            <span className="section-kicker">Previsualización</span>
            <h3>{copy.preview}</h3>
            <div className="profile-image-editor__preview-frame" data-category={category}>
              {previewLoading && <span className="profile-image-editor__preview-loading"><LoaderCircle size={21} className="spin" /> Actualizando</span>}
              {previewUrl && <img src={previewUrl} alt={category === 'avatar' ? 'Previsualización circular de la foto' : 'Previsualización de la portada'} />}
            </div>
            <p>{category === 'avatar' ? 'El círculo coincide con el avatar que aparecerá en el sistema.' : 'La franja coincide con la proporción final almacenada para la portada.'}</p>
            <dl>
              <div><dt>Salida</dt><dd>{output.width} × {output.height} px</dd></div>
              <div><dt>Rotación</dt><dd>{rotation}°</dd></div>
            </dl>
          </aside>
        </div>

        {error && <div className="profile-image-editor__error" role="alert">{error}</div>}

        <footer className="profile-image-editor__footer">
          <p><Check size={16} /> No se guardará nada hasta que confirmes los cambios.</p>
          <div>
            <button type="button" className="profile-image-editor__cancel" onClick={onCancel} disabled={pending}>Cancelar</button>
            <button type="button" className="profile-image-editor__save" onClick={save} disabled={pending || !pixelCrop}>
              {pending ? <><LoaderCircle size={18} className="spin" /> Guardando...</> : <>Guardar cambios</>}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
};

export default ProfileImageEditor;
