export const EMPTY_SELECT_VALUE = '__ldsm_empty__';

// Radix reserves '' for the placeholder. Only use our sentinel when the
// caller actually supplies an empty option (e.g. "Todos los cursos").
export const toSelectValue = (value, options = []) => {
  if (value === '' || value == null) {
    return options.some((option) => option.value === '') ? EMPTY_SELECT_VALUE : '';
  }
  return String(value);
};

export const fromSelectValue = (value) => value === EMPTY_SELECT_VALUE ? '' : value;
