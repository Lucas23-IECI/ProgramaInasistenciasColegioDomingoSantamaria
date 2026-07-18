import { Clock3 } from 'lucide-react';
import AppSelect from './AppSelect';

const twoDigits = (value) => String(value).padStart(2, '0');
const hourOptions = Array.from({ length: 24 }, (_, hour) => ({ value: twoDigits(hour), label: twoDigits(hour) }));
const minuteOptions = Array.from({ length: 60 }, (_, minute) => ({ value: twoDigits(minute), label: twoDigits(minute) }));

const TimeField = ({ value = '00:00', onChange, ariaLabel = 'Hora' }) => {
  const [hours = '00', minutes = '00'] = String(value || '00:00').split(':');
  const update = (part, nextValue) => {
    onChange(part === 'hours' ? `${nextValue}:${minutes}` : `${hours}:${nextValue}`);
  };

  return (
    <div className="time-field" role="group" aria-label={ariaLabel}>
      <Clock3 size={18} aria-hidden="true" />
      <AppSelect ariaLabel={`${ariaLabel}: horas`} className="time-field__select" value={hours} onChange={(next) => update('hours', next)} options={hourOptions} />
      <span aria-hidden="true">:</span>
      <AppSelect ariaLabel={`${ariaLabel}: minutos`} className="time-field__select" value={minutes} onChange={(next) => update('minutes', next)} options={minuteOptions} />
    </div>
  );
};

export default TimeField;
