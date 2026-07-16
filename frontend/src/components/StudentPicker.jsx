import { useId, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { getStudentDisplayName, getStudentMaskedRut } from '../utils/studentFormat';

const StudentPicker = ({
  label,
  placeholder = 'Buscar por nombre, apellido o RUT…',
  query,
  onQueryChange,
  results = [],
  loading = false,
  selected = [],
  multiple = false,
  onSelect,
  onRemove,
  onClear,
}) => {
  const generatedId = useId();
  const inputId = `student-picker-${generatedId}`;
  const listId = `${inputId}-results`;
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map((student) => String(student.id_alumno))), [selected]);
  const availableResults = useMemo(
    () => results.filter((student) => !selectedIds.has(String(student.id_alumno))),
    [results, selectedIds],
  );

  const resolvedActiveIndex = availableResults.length
    ? Math.min(Math.max(activeIndex, 0), availableResults.length - 1)
    : -1;

  const choose = (student) => {
    if (!student) return;
    onSelect(student);
    onQueryChange('');
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(availableResults.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && open && resolvedActiveIndex >= 0) {
      event.preventDefault();
      choose(availableResults[resolvedActiveIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="student-picker">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      <div className="student-picker-combobox">
        <div className="student-picker-control">
          <Search size={18} aria-hidden="true" />
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open}
            aria-activedescendant={resolvedActiveIndex >= 0 ? `${listId}-${resolvedActiveIndex}` : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              const nextValue = event.target.value;
              onQueryChange(nextValue);
              setActiveIndex(0);
              setOpen(nextValue.trim().length >= 2);
            }}
            onFocus={() => query.trim().length >= 2 && setOpen(true)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          {query && (
            <button type="button" onClick={() => onQueryChange('')} aria-label="Limpiar búsqueda"><X size={17} /></button>
          )}
        </div>

        {open && (
          <div className="student-picker-popover" id={listId} role="listbox" aria-label="Resultados de personas">
            <div className="student-picker-results">
              {loading && <div className="student-picker-empty">Buscando personas…</div>}
              {!loading && availableResults.length === 0 && (
                <div className="student-picker-empty">No se encontraron coincidencias.</div>
              )}
              {!loading && availableResults.map((student, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === resolvedActiveIndex}
                  id={`${listId}-${index}`}
                  key={student.id_alumno}
                  className="student-picker-option"
                  data-focused={index === resolvedActiveIndex || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(student)}
                >
                  <span className="student-picker-avatar" aria-hidden="true">
                    {getStudentDisplayName(student).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                  </span>
                  <span className="student-picker-option__copy">
                    <strong>{getStudentDisplayName(student)}</strong>
                    <small>{student.nombre_curso || 'Sin curso'} · {getStudentMaskedRut(student)}</small>
                  </span>
                  {index === resolvedActiveIndex && <Check size={17} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="student-picker-selection">
          <div className="student-picker-selection__header">
            <span>{multiple ? `${selected.length} personas seleccionadas` : 'Persona seleccionada'}</span>
            {multiple && onClear && <button type="button" onClick={onClear}>Quitar todas</button>}
          </div>
          <div className="student-picker-chips">
            {selected.map((student) => (
              <span className="student-picker-chip" key={student.id_alumno}>
                <span>
                  <strong>{getStudentDisplayName(student)}</strong>
                  <small>{student.nombre_curso || 'Sin curso'}</small>
                </span>
                <button type="button" onClick={() => onRemove(student)} aria-label={`Quitar a ${getStudentDisplayName(student)}`}>
                  <X size={15} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentPicker;
