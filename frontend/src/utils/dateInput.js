const pad = (value) => String(value).padStart(2, '0');

export const localDateInputValue = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const localDateTimeInputValue = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${localDateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
