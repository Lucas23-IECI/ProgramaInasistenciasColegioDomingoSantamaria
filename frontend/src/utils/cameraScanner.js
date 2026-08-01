export const REGISTRATION_METHODS = Object.freeze({
  BARCODE: 'barcode',
  CAMERA: 'camera',
  MANUAL: 'manual',
});

export const CAMERA_FORMATS = Object.freeze([
  'code_128',
  'code_39',
  'codabar',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
  'qr_code',
]);

export const normalizeScannedValue = (value) => String(value || '')
  .replace(/[\r\n\t]/g, '')
  .trim();

export const createDuplicateReadGuard = ({ windowMs = 3500, now = () => Date.now() } = {}) => {
  let lastValue = '';
  let lastAcceptedAt = 0;

  return {
    accept(value) {
      const normalized = normalizeScannedValue(value);
      if (!normalized) return false;
      const currentTime = now();
      if (normalized === lastValue && currentTime - lastAcceptedAt < windowMs) return false;
      lastValue = normalized;
      lastAcceptedAt = currentTime;
      return true;
    },
    reset() {
      lastValue = '';
      lastAcceptedAt = 0;
    },
  };
};

export const getCameraAvailability = ({ secureContext, mediaDevices } = {}) => {
  if (!secureContext) {
    return {
      available: false,
      code: 'INSECURE_CONTEXT',
      message: 'La cámara requiere una conexión HTTPS confiable en este dispositivo.',
    };
  }
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return {
      available: false,
      code: 'CAMERA_UNAVAILABLE',
      message: 'Este navegador no ofrece acceso compatible a la cámara.',
    };
  }
  return { available: true, code: 'AVAILABLE', message: '' };
};

export const getCameraErrorMessage = (error) => {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'El permiso de cámara fue rechazado. Puedes habilitarlo en el navegador o usar la búsqueda manual.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No se encontró una cámara disponible en este dispositivo.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'La cámara está siendo utilizada por otra aplicación o no pudo iniciarse.';
  }
  if (name === 'OverconstrainedError') {
    return 'La cámara no admite la configuración solicitada. Intenta nuevamente.';
  }
  return 'No fue posible iniciar la cámara. Puedes continuar con la búsqueda manual.';
};

export const vibrateForRegistration = (type, navigatorObject = globalThis.navigator) => {
  if (!navigatorObject || typeof navigatorObject.vibrate !== 'function') return false;
  const pattern = type === 'success' ? [80, 45, 80] : type === 'warning' ? [140] : [180, 80, 180];
  return navigatorObject.vibrate(pattern);
};
