const normalizeClockTime = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
};

const clockToSeconds = (value) => {
  const normalized = normalizeClockTime(value);
  if (!normalized) return null;
  const [hours, minutes, seconds] = normalized.split(':').map(Number);
  return (hours * 3600) + (minutes * 60) + seconds;
};

const calculateDelayMinutes = (currentTime, thresholdTime) => {
  const currentSeconds = clockToSeconds(currentTime);
  const thresholdSeconds = clockToSeconds(thresholdTime);
  if (currentSeconds === null || thresholdSeconds === null) return null;
  return Math.max(0, Math.ceil((currentSeconds - thresholdSeconds) / 60));
};

const calculateStatusAndSeverity = (tipoRegistro, currentTime, config = {}) => {
  if (tipoRegistro !== 'Entrada') {
    return { status: 'Salida', severidad: 'Normal' };
  }

  const currentSeconds = clockToSeconds(currentTime);
  const thresholdSeconds = clockToSeconds(config.hora_limite_atraso || '08:15:00');
  if (currentSeconds === null || thresholdSeconds === null) {
    throw new Error('La hora institucional o el límite de atraso no son válidos.');
  }

  if (currentSeconds < thresholdSeconds) {
    return { status: 'Presente', severidad: 'Normal' };
  }

  const severeAfterMinutes = Number.isInteger(Number(config.minutos_atraso_grave))
    ? Number(config.minutos_atraso_grave)
    : 15;

  return {
    status: 'Atrasado',
    severidad: currentSeconds <= thresholdSeconds + (severeAfterMinutes * 60) ? 'Leve' : 'Grave'
  };
};

module.exports = {
  calculateDelayMinutes,
  calculateStatusAndSeverity,
  clockToSeconds,
  normalizeClockTime
};
