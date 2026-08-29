const STATUS_MESSAGES = Object.freeze({
  400: 'La solicitud contiene datos incompletos o no válidos. Revisa la información e inténtalo nuevamente.',
  401: 'Tu sesión venció o ya no es válida. Inicia sesión nuevamente.',
  403: 'Tu cuenta no tiene permiso para realizar esta acción.',
  404: 'No se encontró la información solicitada. Puede haber cambiado o ya no estar disponible.',
  409: 'La acción entra en conflicto con el estado actual de la información. Actualiza la pantalla y vuelve a intentarlo.',
  410: 'Esta función ya no está disponible. Utiliza el módulo indicado por el sistema.',
  413: 'El archivo es demasiado grande para ser procesado.',
  422: 'La información no pudo procesarse. Revisa los datos ingresados.',
  423: 'La cuenta está bloqueada temporalmente. Espera unos minutos o contacta a un administrador.',
  429: 'Se realizaron demasiados intentos en poco tiempo. Espera un momento antes de volver a intentarlo.',
  502: 'El servicio no está respondiendo correctamente. Inténtalo nuevamente en unos minutos.',
  503: 'El servicio no está disponible temporalmente. Inténtalo nuevamente en unos minutos.',
  504: 'El servidor tardó demasiado en responder. Inténtalo nuevamente.'
});

const TECHNICAL_MESSAGE = /(?:<!doctype|<html|\b(?:typeerror|referenceerror|syntaxerror|sqlstate|econn\w+|enoent|eacces|eperm|err_[a-z_]+|node:internal|node_modules|stack trace|request failed with status code|network error|jsonwebtokenerror)\b|\b(?:relation|column|constraint)\s+["'\w.-]+\s+(?:does not exist|violates|failed)|\b(?:duplicate key value|invalid input syntax|violates foreign key|no such file or directory|permission denied)\b|(?:[a-z]:\\|\/(?:app|home|usr|var)\/)[^\s]+|\bat\s+[\w$.<>]+\s*\(|\b(?:select|insert|update|delete)\s+.+\bfrom\b|\b(?:postgres|sequelize|knex|prisma)\b)/i;

export const isSafeApiMessage = (value) => {
  if (typeof value !== 'string') return false;
  const message = value.trim();
  return message.length > 0
    && message.length <= 600
    && !/^[{[]/u.test(message)
    && !/^[A-Z][A-Z0-9_]+$/u.test(message)
    && !TECHNICAL_MESSAGE.test(message);
};

export const getSafeErrorMessage = (error, fallback = 'No fue posible completar la acción.') => (
  isSafeApiMessage(error?.message) ? error.message.trim() : fallback
);

export const getApiErrorMessage = (error, fallback = 'No fue posible completar la acción.') => {
  const serverMessage = error?.response?.data?.message;
  if (isSafeApiMessage(serverMessage)) return serverMessage.trim();

  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'La solicitud tardó demasiado. Revisa la conexión e inténtalo nuevamente.';
  }

  const requestFailed = error?.isAxiosError === true
    || Boolean(error?.request || error?.config)
    || ['ERR_NETWORK', 'ECONNREFUSED', 'ENOTFOUND'].includes(error?.code);
  if (!error?.response && requestFailed) {
    return 'No fue posible comunicarse con el servidor. Revisa la conexión de red e inténtalo nuevamente.';
  }
  if (!error?.response) return fallback;

  const status = Number(error.response.status);
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) {
    return `${fallback} El servidor tuvo un problema interno; inténtalo nuevamente y, si continúa, informa la acción que estabas realizando.`;
  }
  return fallback;
};
