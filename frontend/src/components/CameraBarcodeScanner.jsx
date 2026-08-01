import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CameraOff, Keyboard, LoaderCircle, ScanLine } from 'lucide-react';

import {
  CAMERA_FORMATS,
  createDuplicateReadGuard,
  getCameraAvailability,
  getCameraErrorMessage,
  normalizeScannedValue,
} from '../utils/cameraScanner';

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

const stopStream = (stream) => {
  stream?.getTracks?.().forEach((track) => track.stop());
};

const CameraBarcodeScanner = ({ active, disabled, onDetected, onManualFallback }) => {
  const videoRef = useRef(null);
  const cleanupRef = useRef(() => {});
  const onDetectedRef = useRef(onDetected);
  const duplicateGuardRef = useRef(createDuplicateReadGuard());
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [engine, setEngine] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    cleanupRef.current();
    cleanupRef.current = () => {};
    duplicateGuardRef.current.reset();

    if (!active || disabled) {
      setStatus('idle');
      setMessage('');
      setEngine('');
      return undefined;
    }

    const availability = getCameraAvailability({
      secureContext: window.isSecureContext,
      mediaDevices: navigator.mediaDevices,
    });
    if (!availability.available) {
      setStatus('error');
      setMessage(availability.message);
      return undefined;
    }

    let cancelled = false;
    let stream = null;
    let controls = null;
    let scanTimer = null;
    let detecting = false;

    const emit = (rawValue) => {
      const value = normalizeScannedValue(rawValue);
      if (!duplicateGuardRef.current.accept(value)) return;
      setStatus('detected');
      setMessage('Código reconocido. Procesando el ingreso…');
      onDetectedRef.current?.(value);
      window.setTimeout(() => {
        if (!cancelled) {
          setStatus('scanning');
          setMessage('Apunta al código de barras del carnet.');
        }
      }, 2200);
    };

    const startNativeDetector = async () => {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = CAMERA_FORMATS.filter((format) => supported.includes(format));
      if (!formats.length) return false;

      stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (cancelled) {
        stopStream(stream);
        return true;
      }

      const video = videoRef.current;
      if (!video) throw new Error('VIDEO_ELEMENT_UNAVAILABLE');
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats });

      const detectFrame = async () => {
        if (cancelled) return;
        if (!detecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          detecting = true;
          try {
            const results = await detector.detect(video);
            if (results[0]?.rawValue) emit(results[0].rawValue);
          } catch {
            // Un fotograma ilegible es normal; el siguiente intento continúa.
          } finally {
            detecting = false;
          }
        }
        scanTimer = window.setTimeout(detectFrame, 150);
      };

      setEngine('native');
      detectFrame();
      return true;
    };

    const startZxingDetector = async () => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const video = videoRef.current;
      if (!video) throw new Error('VIDEO_ELEMENT_UNAVAILABLE');
      controls = await reader.decodeFromConstraints(CAMERA_CONSTRAINTS, video, (result) => {
        if (result) emit(result.getText());
      });
      setEngine('zxing');
    };

    const start = async () => {
      setStatus('starting');
      setMessage('Solicitando acceso a la cámara trasera…');
      try {
        const nativeStarted = typeof window.BarcodeDetector === 'function'
          ? await startNativeDetector()
          : false;
        if (!nativeStarted) await startZxingDetector();
        if (!cancelled) {
          setStatus('scanning');
          setMessage('Apunta al código de barras del carnet.');
        }
      } catch (error) {
        stopStream(stream);
        controls?.stop?.();
        if (!cancelled) {
          setStatus('error');
          setMessage(getCameraErrorMessage(error));
        }
      }
    };

    cleanupRef.current = () => {
      cancelled = true;
      window.clearTimeout(scanTimer);
      controls?.stop?.();
      stopStream(stream);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
    };

    start();
    return () => cleanupRef.current();
  }, [active, disabled, retryKey]);

  if (!active) return null;

  const isError = status === 'error';
  return (
    <section className="camera-scanner" aria-label="Escáner mediante cámara" data-status={status}>
      <div className="camera-scanner__viewport">
        <video ref={videoRef} muted playsInline aria-label="Vista previa de la cámara" />
        <div className="camera-scanner__shade" aria-hidden="true" />
        <div className="camera-scanner__target" aria-hidden="true"><ScanLine size={34} /></div>
        {status === 'starting' && <div className="camera-scanner__loading"><LoaderCircle size={30} /> Iniciando cámara…</div>}
        {isError && <div className="camera-scanner__unavailable"><CameraOff size={38} /><strong>Cámara no disponible</strong></div>}
      </div>
      <div className="camera-scanner__status" role="status" aria-live="polite">
        {isError ? <AlertTriangle size={19} /> : <Camera size={19} />}
        <div><strong>{isError ? 'No se pudo usar la cámara' : status === 'detected' ? 'Lectura recibida' : 'Escáner móvil activo'}</strong><span>{message}</span></div>
        {engine && <small>{engine === 'native' ? 'Motor del navegador' : 'Compatibilidad ZXing'}</small>}
      </div>
      <p className="camera-scanner__privacy">La imagen se procesa en el dispositivo y no se guarda ni se envía como fotografía.</p>
      {isError && (
        <div className="camera-scanner__actions">
          <button type="button" className="secondary-action" onClick={() => setRetryKey((value) => value + 1)}><Camera size={17} /> Reintentar cámara</button>
          <button type="button" className="primary-action" onClick={onManualFallback}><Keyboard size={17} /> Usar búsqueda manual</button>
        </div>
      )}
    </section>
  );
};

export default CameraBarcodeScanner;
