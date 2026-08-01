import { formatChilePhoneInput, formatRutInput } from '../../utils/personFormat';

export const studentOriginMeta = (student) => {
  if (student?.origen_alta === 'MANUAL' && student?.erp_vinculado_en) {
    return {
      code: 'validated',
      label: 'Validado ERP',
      title: `Creado manualmente y vinculado al ERP el ${new Date(student.erp_vinculado_en).toLocaleString('es-CL')}`
    };
  }
  if (student?.origen_alta === 'MANUAL') {
    return {
      code: 'manual',
      label: 'Manual',
      title: 'Creado manualmente y todavía no vinculado con una ficha ERP'
    };
  }
  if (student?.origen_alta === 'ERP') {
    return {
      code: 'erp',
      label: 'ERP',
      title: 'Registro creado desde la planilla institucional ERP'
    };
  }
  return {
    code: 'legacy',
    label: 'Registro anterior',
    title: 'Registro creado antes de habilitar la trazabilidad de origen'
  };
};

export const normalizeHeaderKey = (value) => {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

export const getCell = (row, aliases) => {
  const aliasSet = new Set(aliases.map((alias) => normalizeHeaderKey(alias)));
  for (const [key, value] of Object.entries(row || {})) {
    if (!aliasSet.has(normalizeHeaderKey(key))) continue;
    const cleaned = String(value ?? '').trim();
    if (cleaned !== '') return cleaned;
  }
  return '';
};

export const relationshipCode = (value, fallback = 'APODERADO_SUPLENTE') => {
  const normalized = normalizeHeaderKey(value);
  if (!normalized) return fallback;
  if (normalized.includes('madre') || normalized === 'mama') return 'MADRE';
  if (normalized.includes('padre') || normalized === 'papa') return 'PADRE';
  if (normalized.includes('principal')) return 'APODERADO_PRINCIPAL';
  if (normalized.includes('suplente')) return 'APODERADO_SUPLENTE';
  if (normalized.includes('herman')) return 'HERMANO';
  if (normalized.includes('abuel')) return 'ABUELO';
  if (normalized.includes('tio') || normalized.includes('tia')) return 'TIO';
  if (normalized.includes('transporte')) return 'TRANSPORTE_ESCOLAR';
  if (normalized.includes('familiar')) return 'FAMILIAR_AUTORIZADO';
  return 'OTRO';
};

export const mapGuardianRecord = (row, index, suffix = '') => {
  const suffixLabel = suffix ? ` ${suffix}` : '';
  const studentRut = getCell(row, [
    'RUT Estudiante', 'RUT Alumno', 'RUN Estudiante', 'RUN Alumno',
    'RUT del estudiante', 'RUT'
  ]);
  const guardianRut = getCell(row, [
    `RUT Apoderado${suffixLabel}`,
    `RUN Apoderado${suffixLabel}`,
    `RUT Apoderado ${suffix}`,
    suffix === '2' ? 'RUT Apoderado Suplente' : 'RUT Apoderados',
    suffix === '2' ? 'RUT Suplente' : 'RUT del apoderado'
  ]);
  const name = getCell(row, [
    `Nombre Apoderado${suffixLabel}`,
    `Nombre Completo Apoderado${suffixLabel}`,
    suffix === '2' ? 'Nombre Apoderado Suplente' : 'Apoderado',
    suffix === '2' ? 'Nombre Suplente' : 'Nombre del apoderado'
  ]);
  const relationRaw = getCell(row, [
    `Parentesco${suffixLabel}`,
    `Relación${suffixLabel}`,
    suffix === '2' ? 'Parentesco Suplente' : 'Vínculo'
  ]);
  const relation = relationshipCode(relationRaw, suffix === '2' ? 'APODERADO_SUPLENTE' : 'APODERADO_PRINCIPAL');
  return {
    fila: index + 2,
    alumno_rut: formatRutInput(studentRut),
    tipo_documento: 'RUT',
    documento: formatRutInput(guardianRut),
    nombre_completo: name,
    telefono: formatChilePhoneInput(getCell(row, [
      `Teléfono Apoderado${suffixLabel}`, `Telefono Apoderado${suffixLabel}`,
      suffix === '2' ? 'Teléfono Suplente' : 'Celular Apoderado'
    ])),
    email: getCell(row, [
      `Email Apoderado${suffixLabel}`, `Correo Apoderado${suffixLabel}`,
      suffix === '2' ? 'Email Suplente' : 'Correo del apoderado'
    ]),
    parentesco_codigo: relation,
    parentesco_detalle: relation === 'OTRO' ? relationRaw : '',
    es_principal: suffix !== '2' && !normalizeHeaderKey(relationRaw).includes('suplente'),
    vigente_desde: getCell(row, ['Vigente Desde', 'Fecha Inicio', 'Inicio Vigencia']),
    vigente_hasta: getCell(row, ['Vigente Hasta', 'Fecha Término', 'Fin Vigencia'])
  };
};
