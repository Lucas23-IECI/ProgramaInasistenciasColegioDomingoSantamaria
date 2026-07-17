const { clockToSeconds, normalizeClockTime } = require('./punctuality');

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isIsoDate = (value) => {
  if (!ISO_DATE_PATTERN.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const validateDateRange = (from, to, { maxDays = 366 } = {}) => {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return { error: 'Las fechas deben usar el formato AAAA-MM-DD.' };
  }
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start > end) return { error: 'La fecha inicial no puede ser posterior a la fecha final.' };
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days > maxDays) return { error: `El período no puede superar ${maxDays} días.` };
  return { from, to, days };
};

const asBoundedInteger = (value, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

const validatePunctualityConfig = (input = {}) => {
  const nombreJornada = String(input.nombre_jornada || '').trim();
  const horaEntrada = normalizeClockTime(input.hora_entrada);
  const horaLimite = normalizeClockTime(input.hora_limite_atraso);
  const minutosGrave = asBoundedInteger(input.minutos_atraso_grave, 1, 180);
  const umbralAlerta = asBoundedInteger(input.umbral_alerta, 1, 50);
  const umbralCritico = asBoundedInteger(input.umbral_critico, 2, 100);

  if (nombreJornada.length < 3 || nombreJornada.length > 80) {
    return { error: 'El nombre de la jornada debe tener entre 3 y 80 caracteres.' };
  }
  if (!horaEntrada || !horaLimite) return { error: 'Las horas de entrada y límite no son válidas.' };
  if (clockToSeconds(horaEntrada) >= clockToSeconds(horaLimite)) {
    return { error: 'La hora límite debe ser posterior a la hora de entrada.' };
  }
  if (minutosGrave === null) return { error: 'El umbral de atraso grave debe estar entre 1 y 180 minutos.' };
  if (umbralAlerta === null || umbralCritico === null || umbralCritico <= umbralAlerta) {
    return { error: 'El umbral crítico debe ser mayor que el preventivo.' };
  }

  return {
    value: {
      nombre_jornada: nombreJornada,
      hora_entrada: horaEntrada,
      hora_limite_atraso: horaLimite,
      minutos_atraso_grave: minutosGrave,
      umbral_alerta: umbralAlerta,
      umbral_critico: umbralCritico
    }
  };
};

const validateReason = (value, { min = 10, max = 500 } = {}) => {
  const reason = String(value || '').trim();
  if (reason.length < min || reason.length > max) {
    return { error: `El motivo debe tener entre ${min} y ${max} caracteres.` };
  }
  return { value: reason };
};

module.exports = {
  asBoundedInteger,
  isIsoDate,
  validateDateRange,
  validatePunctualityConfig,
  validateReason
};
