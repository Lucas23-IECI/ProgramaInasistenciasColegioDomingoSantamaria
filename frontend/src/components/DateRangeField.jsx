import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

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
  if (!date) return 'Seleccionar';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date).replace(/\./g, '');
};

const monthLabel = (date) => new Intl.DateTimeFormat('es-CL', {
  month: 'long',
  year: 'numeric',
}).format(date);

const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const buildCalendarDays = (viewDate) => {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
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
  const days = useMemo(() => buildCalendarDays(viewDate), [viewDate]);

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

  const selectDate = (date) => {
    const selected = toIsoDate(date);
    if (selecting === 'start') {
      const nextTo = !to || selected > to ? selected : to;
      onChange({ from: selected, to: nextTo });
      setSelecting('end');
      return;
    }

    if (from && selected < from) {
      onChange({ from: selected, to: from });
    } else {
      onChange({ from: from || selected, to: selected });
    }
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

  const fromDate = toLocalDate(from);
  const toDate = toLocalDate(to);

  return (
    <div className="date-range-field" ref={rootRef}>
      <span className="field-label" id="report-period-label">{label}</span>
      <div className="date-range-control" aria-labelledby="report-period-label">
        <CalendarDays size={19} aria-hidden="true" />
        <button type="button" className="date-range-value" onClick={() => openFor('start')} aria-label={`Fecha inicial: ${formatDate(from)}`}>
          <small>Desde</small>
          <strong>{formatDate(from)}</strong>
        </button>
        <span className="date-range-separator" aria-hidden="true">a</span>
        <button type="button" className="date-range-value" onClick={() => openFor('end')} aria-label={`Fecha final: ${formatDate(to)}`}>
          <small>Hasta</small>
          <strong>{formatDate(to)}</strong>
        </button>
        <button type="button" className="date-range-trigger" onClick={() => openFor('start')} aria-label="Abrir calendario">
          <CalendarDays size={18} />
        </button>
      </div>

      {open && (
        <div className="date-range-popover" role="dialog" aria-modal="false" aria-label="Seleccionar rango de fechas">
          <div className="calendar-selection-hint">
            Seleccionando fecha {selecting === 'start' ? 'inicial' : 'final'}
          </div>
          <div className="calendar-heading">
            <button type="button" aria-label="Mes anterior" onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))}><ChevronLeft size={19} /></button>
            <h2>{monthLabel(viewDate)}</h2>
            <button type="button" aria-label="Mes siguiente" onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))}><ChevronRight size={19} /></button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid" role="grid">
            {days.map((date) => {
              const iso = toIsoDate(date);
              const outside = date.getMonth() !== viewDate.getMonth();
              const selected = iso === from || iso === to;
              const inRange = fromDate && toDate && date >= fromDate && date <= toDate;
              const disabled = date > maximumDate;
              return (
                <button
                  type="button"
                  key={iso}
                  role="gridcell"
                  className="calendar-day"
                  data-outside={outside || undefined}
                  data-selected={selected || undefined}
                  data-in-range={inRange || undefined}
                  disabled={disabled}
                  aria-label={new Intl.DateTimeFormat('es-CL', { dateStyle: 'full' }).format(date)}
                  onClick={() => selectDate(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
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

