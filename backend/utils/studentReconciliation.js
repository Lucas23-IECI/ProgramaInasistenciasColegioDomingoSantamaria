const normalizeIdentityToken = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const firstIdentityToken = (value) => normalizeIdentityToken(value).split(' ').filter(Boolean)[0] || '';

const evaluateStudentReconciliation = (imported, existing) => {
  if (!existing) {
    return {
      code: 'NUEVO_ERP',
      label: 'Nuevo desde ERP',
      blocking: false,
      differences: []
    };
  }

  const importedFirstName = firstIdentityToken(imported.nombres);
  const importedFirstSurname = firstIdentityToken(imported.apellidos);
  const currentFirstName = firstIdentityToken(existing.nombres);
  const currentFirstSurname = firstIdentityToken(existing.paterno);
  const differences = [];

  if (importedFirstName && currentFirstName && importedFirstName !== currentFirstName) {
    differences.push('primer nombre');
  }
  if (importedFirstSurname && currentFirstSurname && importedFirstSurname !== currentFirstSurname) {
    differences.push('apellido paterno');
  }

  if (differences.length === 2) {
    return {
      code: 'CONFLICTO_IDENTIDAD',
      label: 'Conflicto de identidad',
      blocking: true,
      differences
    };
  }

  if (existing.origen_alta === 'MANUAL' && !existing.erp_vinculado_en) {
    return {
      code: 'VINCULAR_MANUAL',
      label: 'Vincular ingreso manual',
      blocking: false,
      differences
    };
  }

  if (existing.origen_alta === 'MANUAL') {
    return {
      code: 'ACTUALIZAR_VINCULADO',
      label: 'Actualizar validado por ERP',
      blocking: false,
      differences
    };
  }

  if (existing.origen_alta === 'LEGACY') {
    return {
      code: 'VINCULAR_LEGACY',
      label: 'Vincular registro anterior',
      blocking: false,
      differences
    };
  }

  return {
    code: 'ACTUALIZAR_ERP',
    label: 'Actualizar registro ERP',
    blocking: false,
    differences
  };
};

module.exports = {
  evaluateStudentReconciliation,
  firstIdentityToken,
  normalizeIdentityToken
};
