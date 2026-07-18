import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import 'react-day-picker/style.css';

const toLocalDate = (value) => {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIsoDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const formatDate = (value) => {
  const date = toLocalDate(value);
  if (!date) return 'Seleccionar fecha';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date).replace(/\./g, '');
};

const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const DateRangeField = ({
  label = 'Período',
  from,
  to,
  onChange,
  maxValue,
  presets = true,
}) => {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState('start');
  const [viewDate, setViewDate] = useState(() => toLocalDate(to || from) || new Date());
  const rootRef = useRef(null);
  const maximumDate = toLocalDate(maxValue) || new Date();
  maximumDate.setHours(23, 59, 59, 999);
  const fromDate = toLocalDate(from);
  const toDate = toLocalDate(to);
  const currentLabel = selecting === 'start' ? 'Fecha inicial' : 'Fecha final';

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openFor = (part) => {
    setSelecting(part);
    setViewDate(toLocalDate(part === 'start' ? from : to) || new Date());
    setOpen(true);
  };

  const applySelectedDate = (value) => {
    if (selecting === 'start') {
      if (to && value > to) return;
      onChange({ from: value, to });
    } else {
      if (from && value < from) return;
      onChange({ from, to: value });
    }
  };

  const selectDate = (date) => {
    applySelectedDate(toIsoDate(date));
    setOpen(false);
  };

  const applyPreset = (kind) => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    if (kind === 'today') {
      onChange({ from: toIsoDate(today), to: toIsoDate(today) });
    } else if (kind === 'week') {
      const mondayOffset = today.getDay() === 0 ? 6 : today.getDay() - 1;
      onChange({ from: toIsoDate(addDays(today, -mondayOffset)), to: toIsoDate(today) });
    } else if (kind === 'month') {
      onChange({ from: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1, 12)), to: toIsoDate(today) });
    } else {
      onChange({ from: toIsoDate(addDays(today, -29)), to: toIsoDate(today) });
    }
    setOpen(false);
  };

  const disabledDates = [{ after: maximumDate }];
  if (selecting === 'start' && toDate) disabledDates.push({ after: toDate });
  if (selecting === 'end' && fromDate) disabledDates.push({ before: fromDate });

  return (
    <div className="date-range-field" ref={rootRef}>
      <span className="field-label">{label}</span>
      <div className="date-range-pair" aria-label={label}>
        <button
          type="button"
          className="date-range-segment"
          data-active={open && selecting === 'start' || undefined}
          aria-expanded={open && selecting === 'start'}
          onClick={() => openFor('start')}
        >
          <CalendarDays size={18} aria-hidden="true" />
          <span><small>Desde</small><strong>{formatDate(from)}</strong></span>
        </button>
        <span className="date-range-connector" aria-hidden="true">a</span>
        <button
          type="button"
          className="date-range-segment"
          data-active={open && selecting === 'end' || undefined}
          aria-expanded={open && selecting === 'end'}
          onClick={() => openFor('end')}
        >
          <CalendarDays size={18} aria-hidden="true" />
          <span><small>Hasta</small><strong>{formatDate(to)}</strong></span>
        </button>
      </div>

      {open && (
        <div className="date-range-popover" data-side={selecting} role="dialog" aria-label={`Editar ${currentLabel.toLowerCase()}`}>
          <div className="calendar-selection-hint"><strong>{currentLabel}</strong><span>Edita solo este límite del período.</span></div>
          <DayPicker
            animate
            captionLayout="dropdown"
            disabled={disabledDates}
            endMonth={new Date(maximumDate.getFullYear(), maximumDate.getMonth())}
            fixedWeeks
            locale={es}
            mode="range"
            month={viewDate}
            onDayClick={selectDate}
            onMonthChange={setViewDate}
            selected={{ from: fromDate || undefined, to: toDate || undefined }}
            showOutsideDays
            startMonth={new Date(2000, 0)}
            weekStartsOn={1}
          />
        </div>
      )}

      {presets && (
        <div className="date-range-presets" aria-label="Períodos rápidos">
          <button type="button" onClick={() => applyPreset('today')}>Hoy</button>
          <button type="button" onClick={() => applyPreset('week')}>Esta semana</button>
          <button type="button" onClick={() => applyPreset('month')}>Este mes</button>
          <button type="button" onClick={() => applyPreset('30days')}>Últimos 30 días</button>
        </div>
      )}
    </div>
  );
};

export default DateRangeField;
