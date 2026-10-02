const normalizeStudentSearchText = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');

export const matchesStudentSearch = (student, search) => {
  const normalizedSearch = normalizeStudentSearchText(search);
  if (!normalizedSearch) return true;

  const searchableText = normalizeStudentSearchText([
    student?.nombres,
    student?.paterno,
    student?.materno,
    student?.rut,
    student?.documento_mostrado,
    student?.documento_erp,
    student?.uuid_erp,
    student?.codigo_barra,
    student?.nombre_usuario
  ].filter(Boolean).join(' '));

  if (searchableText.includes(normalizedSearch)) return true;

  const tokens = normalizedSearch.split(' ').filter(Boolean);
  if (tokens.every((token) => searchableText.includes(token))) return true;

  const compactSearch = normalizedSearch.replace(/[^a-z0-9]/g, '');
  const compactText = searchableText.replace(/[^a-z0-9]/g, '');
  return Boolean(compactSearch) && compactText.includes(compactSearch);
};
