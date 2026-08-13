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

const validatePunctualityControl = (input = {}, { requireId = false } = {}) => {
  const id = input.id === undefined || input.id === null
    ? null
    : asBoundedInteger(input.id, 1, 2147483647);
  const nombre = String(input.nombre || '').trim();
  const tipo = String(input.tipo || 'OTRO').trim().toUpperCase();
  const horaApertura = normalizeClockTime(input.hora_apertura);
  const horaReferencia = normalizeClockTime(input.hora_referencia);
  const horaInicioAtraso = normalizeClockTime(input.hora_inicio_atraso);
  const horaCierre = normalizeClockTime(input.hora_cierre);
  const minutosGrave = asBoundedInteger(input.minutos_atraso_grave, 1, 180);
  const tipos = ['INGRESO', 'REGRESO_RECREO', 'REGRESO_ALMUERZO', 'TALLER', 'OTRO'];
  const dias = [...new Set((Array.isArray(input.dias_semana) ? input.dias_semana : [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
  const cursos = [...new Set((Array.isArray(input.cursos_ids) ? input.cursos_ids : [])
    .map(Number)
    .filter((courseId) => Number.isInteger(courseId) && courseId > 0))];
  const turnoId = input.turno_id === undefined || input.turno_id === null || input.turno_id === ''
    ? null
    : asBoundedInteger(input.turno_id, 1, 2147483647);

  if (requireId && !id) return { error: 'El control horario no tiene un identificador válido.' };
  if (nombre.length < 3 || nombre.length > 100) return { error: 'Cada control debe tener un nombre de 3 a 100 caracteres.' };
  if (!tipos.includes(tipo)) return { error: 'El tipo de control horario no es válido.' };
  if (!horaApertura || !horaReferencia || !horaInicioAtraso || !horaCierre) {
    return { error: `Completa todas las horas del control "${nombre}".` };
  }
  const opening = clockToSeconds(horaApertura);
  const reference = clockToSeconds(horaReferencia);
  const threshold = clockToSeconds(horaInicioAtraso);
  const closing = clockToSeconds(horaCierre);
  if (!(opening <= reference && reference < threshold && threshold < closing)) {
    return { error: `En "${nombre}", las horas deben seguir el orden apertura, referencia, atraso y cierre.` };
  }
  if (minutosGrave === null || threshold + (minutosGrave * 60) >= closing) {
    return { error: `En "${nombre}", el atraso grave debe comenzar antes del cierre del control.` };
  }
  if (dias.length === 0) return { error: `Selecciona al menos un día para "${nombre}".` };

  return {
    value: {
      id,
      nombre,
      tipo,
      hora_apertura: horaApertura,
      hora_referencia: horaReferencia,
      hora_inicio_atraso: horaInicioAtraso,
      hora_cierre: horaCierre,
      minutos_atraso_grave: minutosGrave,
      dias_semana: dias,
      cursos_ids: cursos,
      turno_id: turnoId,
      cuenta_alertas: input.cuenta_alertas !== false,
      activo: input.activo !== false,
      orden: asBoundedInteger(input.orden, 0, 10000) ?? 0
    }
  };
};

const validatePunctualityControlSet = (controls = []) => {
  const activeControls = controls.filter((control) => control?.activo !== false);

  for (let leftIndex = 0; leftIndex < activeControls.length; leftIndex += 1) {
    const left = activeControls[leftIndex];
    const leftDays = new Set(left.dias_semana || []);
    const leftCourses = new Set(left.cursos_ids || []);
    const leftOpening = clockToSeconds(left.hora_apertura);
    const leftClosing = clockToSeconds(left.hora_cierre);

    for (let rightIndex = leftIndex + 1; rightIndex < activeControls.length; rightIndex += 1) {
      const right = activeControls[rightIndex];
      const sameDay = (right.dias_semana || []).some((day) => leftDays.has(day));
      if (!sameDay) continue;

      const rightCourses = right.cursos_ids || [];
      const sameStudents = leftCourses.size === 0
        || rightCourses.length === 0
        || rightCourses.some((courseId) => leftCourses.has(courseId));
      if (!sameStudents) continue;

      const rightOpening = clockToSeconds(right.hora_apertura);
      const rightClosing = clockToSeconds(right.hora_cierre);
      if (leftOpening < rightClosing && rightOpening < leftClosing) {
        return {
          error: `Los controles "${left.nombre}" y "${right.nombre}" se superponen para al menos un mismo día y curso.`
        };
      }
    }
  }

  return { value: controls };
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
  validatePunctualityControl,
  validatePunctualityControlSet,
  validateReason
};
