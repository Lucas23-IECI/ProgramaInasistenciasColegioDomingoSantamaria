const { validateIdentityDocument } = require('../utils/identityValidatorRegistry');

const IDENTIFIER_TYPES = Object.freeze({
  RUN_CHILE: 'RUN_CHILE',
  IPE_MINEDUC: 'IPE_MINEDUC',
  PASAPORTE: 'PASAPORTE',
  DNI: 'DNI',
  CEDULA: 'CEDULA',
  DOCUMENTO_EXTRANJERO: 'DOCUMENTO_EXTRANJERO',
  ID_ERP: 'ID_ERP',
  CODIGO_INTERNO: 'CODIGO_INTERNO',
  CODIGO_BARRAS: 'CODIGO_BARRAS'
});

const normalizeIdentifierValue = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^0-9A-Z]/g, '');

const foreignTypeToIdentifierType = (value) => {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'PASAPORTE') return IDENTIFIER_TYPES.PASAPORTE;
  if (normalized === 'DNI') return IDENTIFIER_TYPES.DNI;
  if (normalized === 'CEDULA') return IDENTIFIER_TYPES.CEDULA;
  return IDENTIFIER_TYPES.DOCUMENTO_EXTRANJERO;
};

const shouldPreserveRegularizedRun = (currentPrimaryType, incomingIdentityType) => (
  currentPrimaryType === IDENTIFIER_TYPES.RUN_CHILE
  && incomingIdentityType !== IDENTIFIER_TYPES.RUN_CHILE
);

const resolveValidationEvidence = ({ identity = {}, type, value, countryCode = null }) => {
  if (identity.validationEvidence?.validatorId) return identity.validationEvidence;
  return validateIdentityDocument({
    identityType: type,
    countryCode,
    documentOriginal: value,
    rut: identity.rut,
    dv: identity.dv
  });
};

const withValidationEvidence = (candidate, identity = {}) => {
  const validation = resolveValidationEvidence({
    identity,
    type: candidate.type,
    value: candidate.originalValue,
    countryCode: candidate.countryCode
  });
  return {
    ...candidate,
    validatorId: validation.validatorId,
    validatorVersion: validation.validatorVersion,
    validationResult: validation.result
  };
};

const buildStudentIdentifierCandidates = ({
  identity = {},
  barcode = null,
  source = 'LEGACY'
} = {}) => {
  const candidates = [];
  const sourceNormalized = ['ERP', 'MANUAL', 'MINEDUC', 'REGULARIZACION', 'LEGACY', 'SISTEMA']
    .includes(String(source || '').toUpperCase())
    ? String(source).toUpperCase()
    : 'LEGACY';

  if (identity.identityType === IDENTIFIER_TYPES.RUN_CHILE && identity.rut && identity.dv) {
    candidates.push(withValidationEvidence({
      type: IDENTIFIER_TYPES.RUN_CHILE,
      originalValue: `${identity.rut}-${identity.dv}`,
      normalizedValue: normalizeIdentifierValue(`${identity.rut}${identity.dv}`),
      countryCode: 'CHL',
      source: sourceNormalized,
      validationLevel: identity.validationLevel || 'DV_VERIFICADO',
      principal: true
    }, identity));
  } else if (identity.identityType === IDENTIFIER_TYPES.IPE_MINEDUC && identity.documentoErp) {
    candidates.push(withValidationEvidence({
      type: IDENTIFIER_TYPES.IPE_MINEDUC,
      originalValue: identity.documentoErp,
      normalizedValue: normalizeIdentifierValue(identity.documentoErp),
      countryCode: 'CHL',
      source: sourceNormalized,
      validationLevel: identity.validationLevel || 'FUENTE_MINEDUC_ERP',
      principal: true
    }, identity));
  } else if (
    identity.identityType === IDENTIFIER_TYPES.DOCUMENTO_EXTRANJERO
    && identity.documentoErp
  ) {
    candidates.push(withValidationEvidence({
      type: foreignTypeToIdentifierType(identity.foreignDocumentType),
      originalValue: identity.documentoErp,
      normalizedValue: normalizeIdentifierValue(identity.documentoErp),
      countryCode: identity.countryCode || null,
      source: sourceNormalized,
      validationLevel: identity.validationLevel || 'FORMATO_Y_ORIGEN_ERP',
      principal: true
    }, identity));
  } else if (
    identity.identityType === IDENTIFIER_TYPES.CODIGO_INTERNO
    && identity.internalCode
  ) {
    candidates.push(withValidationEvidence({
      type: IDENTIFIER_TYPES.CODIGO_INTERNO,
      originalValue: identity.internalCode,
      normalizedValue: normalizeIdentifierValue(identity.internalCode),
      countryCode: null,
      source: sourceNormalized,
      validationLevel: identity.validationLevel || 'SIN_DOCUMENTO_CIVIL',
      principal: true
    }, identity));
  }

  if (identity.uuidErp) {
    candidates.push(withValidationEvidence({
      type: IDENTIFIER_TYPES.ID_ERP,
      originalValue: identity.uuidErp,
      normalizedValue: normalizeIdentifierValue(identity.uuidErp),
      countryCode: null,
      source: 'ERP',
      validationLevel: 'ID_ERP',
      principal: candidates.length === 0
    }, {}));
  }

  if (barcode) {
    candidates.push(withValidationEvidence({
      type: IDENTIFIER_TYPES.CODIGO_BARRAS,
      originalValue: barcode,
      normalizedValue: normalizeIdentifierValue(barcode),
      countryCode: null,
      source: 'SISTEMA',
      validationLevel: 'CODIGO_OPERATIVO',
      principal: false
    }, {}));
  }

  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate.normalizedValue) continue;
    const key = `${candidate.type}:${candidate.normalizedValue}:${candidate.countryCode || ''}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
};

const syncStudentIdentifiers = async (client, {
  studentId,
  identity,
  barcode = null,
  source = 'LEGACY',
  userId = null
}) => {
  const candidates = buildStudentIdentifierCandidates({ identity, barcode, source });
  const currentPrimary = await client.query(
    `SELECT id_identificador
     FROM alumno_identificador
     WHERE id_alumno = $1
       AND es_principal = true
       AND estado <> 'REVOCADO'
     LIMIT 1
     FOR UPDATE`,
    [studentId]
  );
  let hasPrimary = currentPrimary.rows.length > 0;

  for (const candidate of candidates) {
    const existing = await client.query(
      `SELECT id_identificador, id_alumno, es_principal
       FROM alumno_identificador
       WHERE tipo = $1
         AND valor_normalizado = $2
         AND COALESCE(pais_emisor, '') = COALESCE($3, '')
         AND estado <> 'REVOCADO'
       LIMIT 1
       FOR UPDATE`,
      [candidate.type, candidate.normalizedValue, candidate.countryCode]
    );

    if (existing.rows.length && Number(existing.rows[0].id_alumno) !== Number(studentId)) {
      const error = new Error('El identificador ya pertenece a otra ficha institucional.');
      error.code = 'IDENTIFIER_COLLISION';
      error.identifierType = candidate.type;
      throw error;
    }

    const shouldBePrincipal = candidate.principal && !hasPrimary;
    const state = shouldBePrincipal ? 'PRINCIPAL' : 'VIGENTE';

    if (existing.rows.length) {
      await client.query(
        `UPDATE alumno_identificador
         SET valor_original = $1,
             fuente = $2,
             nivel_validacion = COALESCE($3, nivel_validacion),
             validador_id = COALESCE($4, validador_id),
             validador_version = COALESCE($5, validador_version),
             resultado_validacion = COALESCE($6, resultado_validacion),
             validado_en = CASE WHEN $4 IS NULL THEN validado_en ELSE CURRENT_TIMESTAMP END,
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id_identificador = $7`,
        [
          candidate.originalValue,
          candidate.source,
          candidate.validationLevel,
          candidate.validatorId,
          candidate.validatorVersion,
          candidate.validationResult,
          existing.rows[0].id_identificador
        ]
      );
      if (existing.rows[0].es_principal) hasPrimary = true;
      continue;
    }

    await client.query(
      `INSERT INTO alumno_identificador (
         id_alumno, tipo, valor_original, valor_normalizado, pais_emisor,
         fuente, estado, es_principal, nivel_validacion, creado_por,
         validador_id, validador_version, resultado_validacion, validado_en
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 CASE WHEN $11::varchar IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`,
      [
        studentId,
        candidate.type,
        candidate.originalValue,
        candidate.normalizedValue,
        candidate.countryCode,
        candidate.source,
        state,
        shouldBePrincipal,
        candidate.validationLevel,
        userId,
        candidate.validatorId,
        candidate.validatorVersion,
        candidate.validationResult
      ]
    );
    if (shouldBePrincipal) hasPrimary = true;
  }

  return candidates.length;
};

const getStudentIdentifiers = async (queryable, studentId) => {
  const result = await queryable.query(
    `SELECT id_identificador, tipo, valor_original, valor_normalizado,
            pais_emisor, fuente, estado, es_principal, nivel_validacion,
            validador_id, validador_version, resultado_validacion, validado_en,
            vigente_desde, vigente_hasta, creado_en, actualizado_en
     FROM alumno_identificador
     WHERE id_alumno = $1
       AND estado <> 'REVOCADO'
     ORDER BY es_principal DESC, creado_en ASC, id_identificador ASC`,
    [studentId]
  );
  return result.rows;
};

const regularizeIpeToRun = async (client, {
  studentId,
  rut,
  dv,
  reason,
  supportType,
  supportDetail = null,
  documentId,
  userId
}) => {
  const studentResult = await client.query(
    `SELECT id_alumno, rut, dv, tipo_identificador, documento_erp, activo
     FROM alumno
     WHERE id_alumno = $1
       AND fusionado_en_id IS NULL
     FOR UPDATE`,
    [studentId]
  );
  if (studentResult.rows.length === 0) {
    const error = new Error('La ficha estudiantil no existe.');
    error.code = 'STUDENT_NOT_FOUND';
    throw error;
  }

  const primaryResult = await client.query(
    `SELECT id_identificador, tipo, valor_original, valor_normalizado
     FROM alumno_identificador
     WHERE id_alumno = $1
       AND es_principal = true
       AND estado <> 'REVOCADO'
     LIMIT 1
     FOR UPDATE`,
    [studentId]
  );
  const previousIdentifier = primaryResult.rows[0];
  if (!previousIdentifier || previousIdentifier.tipo !== IDENTIFIER_TYPES.IPE_MINEDUC) {
    const error = new Error('La ficha no tiene un IPE vigente como identificador principal.');
    error.code = 'IPE_NOT_PRIMARY';
    throw error;
  }

  const normalizedRun = normalizeIdentifierValue(`${rut}${dv}`);
  const runValidation = validateIdentityDocument({
    identityType: IDENTIFIER_TYPES.RUN_CHILE,
    countryCode: 'CHL',
    documentOriginal: `${rut}-${dv}`,
    rut,
    dv
  });
  const collision = await client.query(
    `SELECT ai.id_alumno
     FROM alumno_identificador ai
     WHERE ai.tipo = 'RUN_CHILE'
       AND ai.valor_normalizado = $1
       AND ai.estado <> 'REVOCADO'
     LIMIT 1
     FOR UPDATE`,
    [normalizedRun]
  );
  if (collision.rows.length > 0 && Number(collision.rows[0].id_alumno) !== Number(studentId)) {
    const error = new Error('El RUN ya pertenece a otra ficha institucional.');
    error.code = 'RUN_COLLISION';
    throw error;
  }

  const legacyCollision = await client.query(
    `SELECT id_alumno
     FROM alumno
     WHERE rut = $1
       AND id_alumno <> $2
       AND fusionado_en_id IS NULL
     LIMIT 1
     FOR UPDATE`,
    [rut, studentId]
  );
  if (legacyCollision.rows.length > 0) {
    const error = new Error('El RUN ya se encuentra asociado a otra ficha.');
    error.code = 'RUN_COLLISION';
    throw error;
  }

  await client.query(
    `UPDATE alumno_identificador
     SET estado = 'ANTERIOR',
         es_principal = false,
         vigente_hasta = CURRENT_DATE,
         actualizado_en = CURRENT_TIMESTAMP,
         metadatos = metadatos || $2::jsonb
     WHERE id_identificador = $1`,
    [
      previousIdentifier.id_identificador,
      JSON.stringify({
        regularizado_a_run: true,
        motivo: reason
      })
    ]
  );

  const newIdentifierResult = await client.query(
    `INSERT INTO alumno_identificador (
       id_alumno, tipo, valor_original, valor_normalizado, pais_emisor,
       fuente, estado, es_principal, nivel_validacion, creado_por,
       respaldo_documento_id, metadatos, validador_id, validador_version,
       resultado_validacion, validado_en
     ) VALUES (
       $1, 'RUN_CHILE', $2, $3, 'CHL',
       'REGULARIZACION', 'PRINCIPAL', true, 'DV_VERIFICADO', $4,
       $5, $6::jsonb, $7, $8, $9, CURRENT_TIMESTAMP
     )
     RETURNING id_identificador, tipo, valor_original, valor_normalizado,
               estado, es_principal, vigente_desde`,
    [
      studentId,
      `${rut}-${dv}`,
      normalizedRun,
      userId,
      documentId,
      JSON.stringify({
        identificador_anterior_id: previousIdentifier.id_identificador,
        tipo_respaldo: supportType
      }),
      runValidation.validatorId,
      runValidation.validatorVersion,
      runValidation.result
    ]
  );
  const newIdentifier = newIdentifierResult.rows[0];

  await client.query(
    `UPDATE alumno
     SET rut = $1,
         dv = $2,
         tipo_identificador = 'RUN_CHILE',
         tipo_documento_extranjero = NULL,
         pais_emisor_documento = NULL,
         fecha_actualizacion = CURRENT_TIMESTAMP
     WHERE id_alumno = $3`,
    [rut, dv, studentId]
  );

  const regularizationResult = await client.query(
    `INSERT INTO regularizaciones_identidad_estudiante (
       id_alumno, identificador_anterior_id, identificador_nuevo_id,
       motivo, tipo_respaldo, detalle_respaldo, documento_id, realizado_por
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id_regularizacion, realizado_en`,
    [
      studentId,
      previousIdentifier.id_identificador,
      newIdentifier.id_identificador,
      reason,
      supportType,
      supportDetail,
      documentId,
      userId
    ]
  );

  return {
    student: studentResult.rows[0],
    previousIdentifier,
    newIdentifier,
    regularization: regularizationResult.rows[0]
  };
};

module.exports = {
  IDENTIFIER_TYPES,
  buildStudentIdentifierCandidates,
  foreignTypeToIdentifierType,
  getStudentIdentifiers,
  normalizeIdentifierValue,
  regularizeIpeToRun,
  shouldPreserveRegularizedRun,
  syncStudentIdentifiers
};
