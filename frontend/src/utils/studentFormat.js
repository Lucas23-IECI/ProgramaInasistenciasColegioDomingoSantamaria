export const getStudentDisplayName = (student) => {
  if (!student) return 'Persona sin nombre';
  if (student.name && String(student.name).trim()) return String(student.name).trim();

  return [student.nombres, student.paterno, student.materno]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ') || 'Persona sin nombre';
};

export const getStudentRut = (student) => {
  if (!student?.rut) return 'RUT no informado';
  return `${student.rut}${student.dv ? `-${student.dv}` : ''}`;
};

export const getStudentMaskedRut = (student) => {
  const rut = String(student?.rut || '');
  if (!rut) return 'RUT no informado';
  if (rut.length <= 4) return `${rut.slice(0, 1)}***${student?.dv ? `-${student.dv}` : ''}`;
  return `${rut.slice(0, 2)}.${rut.slice(2, 5)}.***${student?.dv ? `-${student.dv}` : ''}`;
};

