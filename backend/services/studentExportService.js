const writeExcelFile = require('write-excel-file/node');

const INSTITUTION_NAME = 'Liceo Domingo Santa María · Concepción';

const normalizeIdentifier = (value) => String(value || '').trim();

const maskIdentifier = (type, value) => {
  const raw = normalizeIdentifier(value);
  if (!raw) return 'Sin documento';
  return raw;
};

const identifierLabel = (type) => ({
  RUN_CHILE: 'RUN chileno',
  IPE_MINEDUC: 'IPE Mineduc',
  PASAPORTE: 'Pasaporte',
  DNI: 'DNI extranjero',
  CEDULA: 'Cédula extranjera',
  DOCUMENTO_EXTRANJERO: 'Documento extranjero',
  ID_ERP: 'Identificador ERP',
  CODIGO_INTERNO: 'Código interno',
  CODIGO_BARRAS: 'Código de barras'
}[type] || type || 'Sin identificador');

const getPrimaryIdentifier = (student) => {
  const identifiers = Array.isArray(student.identifiers) ? student.identifiers : [];
  return identifiers.find((identifier) => identifier.es_principal)
    || identifiers.find((identifier) => identifier.estado !== 'REVOCADO')
    || null;
};

const getQualityIssues = (student) => {
  const issues = [];
  const identifiers = Array.isArray(student.identifiers) ? student.identifiers : [];
  const primary = getPrimaryIdentifier(student);
  if (student.origen_alta === 'MANUAL' && !student.erp_vinculado_en) issues.push('Alta manual sin vincular al ERP');
  if (!student.curso) issues.push('Sin curso vigente');
  if (!student.tiene_apoderado) issues.push('Sin apoderado o persona autorizada');
  if (!student.telefono || String(student.telefono).replace(/\D/g, '').length < 9) issues.push('Teléfono incompleto');
  if (!identifiers.length) issues.push('Sin identificador registrado');
  if (identifiers.some((identifier) => identifier.estado === 'PENDIENTE')) issues.push('Identificador pendiente de revisión');
  if (identifiers.some((identifier) => (
    !identifier.validador_id
    || !identifier.validador_version
    || ['PENDIENTE', 'RECHAZADO'].includes(identifier.resultado_validacion)
  ))) issues.push('Documento pendiente de validación versionada');
  if (primary?.tipo === 'ID_ERP') issues.push('Identificado solamente por ERP');
  if (primary?.tipo === 'IPE_MINEDUC') issues.push('IPE pendiente de regularización');
  return issues;
};

const fetchStudentExportDataset = async (queryable) => {
  const result = await queryable.query(`
    SELECT a.id_alumno,
           CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
           a.telefono,
           a.origen_alta,
           a.erp_vinculado_en,
           a.activo,
           a.fecha_actualizacion,
           c.nombre_curso AS curso,
           CASE WHEN m.id_matricula IS NULL THEN 'SIN_MATRICULA'
                WHEN m.vigente_hasta IS NULL THEN 'VIGENTE'
                ELSE 'FINALIZADA' END AS estado_matricula,
           EXISTS (
             SELECT 1 FROM personas_autorizadas_retiro pa
             WHERE pa.id_alumno = a.id_alumno AND pa.activo = true
           ) AS tiene_apoderado,
           COALESCE(ids.identifiers, '[]'::jsonb) AS identifiers
    FROM alumno a
    LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
    LEFT JOIN curso c ON c.id_curso = m.id_curso
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ai.id_identificador,
          'tipo', ai.tipo,
          'valor_original', ai.valor_original,
          'pais_emisor', ai.pais_emisor,
          'fuente', ai.fuente,
          'estado', ai.estado,
          'es_principal', ai.es_principal,
          'nivel_validacion', ai.nivel_validacion,
          'validador_id', ai.validador_id,
          'validador_version', ai.validador_version,
          'resultado_validacion', ai.resultado_validacion,
          'validado_en', ai.validado_en,
          'vigente_desde', ai.vigente_desde,
          'creado_en', ai.creado_en,
          'actualizado_en', ai.actualizado_en
        ) ORDER BY ai.es_principal DESC, ai.actualizado_en DESC, ai.id_identificador
      ) AS identifiers
      FROM alumno_identificador ai
      WHERE ai.id_alumno = a.id_alumno AND ai.estado <> 'REVOCADO'
    ) ids ON true
    WHERE a.rol = 'Estudiante' AND a.fusionado_en_id IS NULL
    ORDER BY a.activo DESC, c.nombre_curso NULLS LAST, a.paterno, a.materno, a.nombres
  `);
  return result.rows;
};

const buildQualityRows = (students) => students.flatMap((student) => (
  getQualityIssues(student).map((issue) => ({
    id_alumno: student.id_alumno,
    nombre: student.nombre,
    curso: student.curso || 'Sin curso',
    estado_matricula: student.estado_matricula,
    incidencia: issue,
    origen: student.origen_alta || 'Sin origen',
    actualizado_en: student.fecha_actualizacion
  }))
));

const excelHeaderCell = (value) => ({
  value,
  fontWeight: 'bold',
  textColor: '#ffffff',
  backgroundColor: '#17698f',
  borderColor: '#17698f',
  borderStyle: 'thin',
  alignVertical: 'center',
  height: 28,
  wrap: true
});

const excelDataCell = (value, rowIndex, options = {}) => ({
  value: value ?? '',
  backgroundColor: rowIndex % 2 === 0 ? '#f3f6f7' : '#ffffff',
  textColor: options.warning ? '#9a5d00' : options.emphasis ? '#15384c' : '#405662',
  fontWeight: options.emphasis || options.warning ? 'bold' : undefined,
  borderColor: '#d4dee3',
  bottomBorderStyle: 'thin',
  alignVertical: 'center',
  height: 25,
  wrap: true
});

const buildSheet = (headers, rows, widths, mapRow) => ({
  data: [
    headers.map(excelHeaderCell),
    ...rows.map((row, rowIndex) => mapRow(row).map((value, columnIndex) => (
      excelDataCell(value, rowIndex, { emphasis: columnIndex === 0 })
    )))
  ],
  columns: widths.map((width) => ({ width })),
  stickyRowsCount: 1,
  showGridLines: false,
  orientation: 'landscape',
  zoomScale: 0.85
});

const buildSummarySheet = (scope, students, qualityRows) => {
  const active = students.filter((student) => student.activo).length;
  const pendingStudents = new Set(qualityRows.map((row) => row.id_alumno)).size;
  const title = (value, size) => ({
    value,
    columnSpan: 4,
    fontWeight: 'bold',
    fontSize: size,
    textColor: '#15384c',
    height: size >= 18 ? 31 : 23
  });
  return {
    data: [
      [title(INSTITUTION_NAME, 11), null, null, null],
      [title(`Exportación ${scope}`, 18), null, null, null],
      [{ value: `Generada: ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date())}`, columnSpan: 4, textColor: '#5c6e79', height: 24 }, null, null, null],
      [null, null, null, null],
      [excelHeaderCell('Métrica'), excelHeaderCell('Resultado'), excelHeaderCell('Privacidad'), excelHeaderCell('Uso previsto')],
      [excelDataCell('Estudiantes incluidos', 0, { emphasis: true }), excelDataCell(students.length, 0), excelDataCell(scope === 'de calidad' ? 'Sin identificadores' : 'Identificadores completos', 0), excelDataCell('Gestión institucional interna', 0)],
      [excelDataCell('Matrícula activa', 1, { emphasis: true }), excelDataCell(active, 1), excelDataCell('No reenviar sin autorización', 1), excelDataCell('Revisión y conciliación', 1)],
      [excelDataCell('Estudiantes con incidencias', 2, { emphasis: true }), excelDataCell(pendingStudents, 2, { warning: pendingStudents > 0 }), excelDataCell('Acceso registrado', 2), excelDataCell('Seguimiento de calidad', 2)]
    ],
    sheet: 'Resumen',
    columns: [{ width: 28 }, { width: 18 }, { width: 34 }, { width: 34 }],
    showGridLines: false,
    zoomScale: 1.05
  };
};

const buildStudentWorkbook = async ({ scope, students }) => {
  const qualityRows = buildQualityRows(students);
  const qualitySheet = {
    ...buildSheet(
      ['Estudiante', 'Curso', 'Incidencia', 'Estado de matrícula', 'Origen', 'Última actualización'],
      qualityRows,
      [34, 20, 42, 22, 18, 22],
      (row) => [row.nombre, row.curso, row.incidencia, row.estado_matricula, row.origen, row.actualizado_en ? new Date(row.actualizado_en) : '']
    ),
    sheet: 'Calidad del padrón'
  };

  if (scope === 'quality') {
    return writeExcelFile([
      buildSummarySheet('de calidad', students, qualityRows),
      qualitySheet
    ], { fontFamily: 'Arial', fontSize: 10 }).toBuffer();
  }

  const operationalRows = students.map((student) => {
    const primary = getPrimaryIdentifier(student);
    const issues = getQualityIssues(student);
    return {
      nombre: student.nombre,
      curso: student.curso || 'Sin curso',
      tipo: identifierLabel(primary?.tipo),
      documento: maskIdentifier(primary?.tipo, primary?.valor_original),
      origen: student.origen_alta || 'Sin origen',
      estado_matricula: student.estado_matricula,
      estado_validacion: issues.length ? 'Requiere revisión' : 'Sin incidencias detectadas',
      alertas: issues.join(' · '),
      actualizado_en: student.fecha_actualizacion
    };
  });
  const operationalSheet = {
    ...buildSheet(
      ['Estudiante', 'Curso', 'Tipo de documento', 'Documento', 'Origen', 'Matrícula', 'Estado de validación', 'Alertas de calidad', 'Última actualización'],
      operationalRows,
      [34, 20, 22, 22, 16, 18, 27, 48, 22],
      (row) => [row.nombre, row.curso, row.tipo, row.documento, row.origen, row.estado_matricula, row.estado_validacion, row.alertas, row.actualizado_en ? new Date(row.actualizado_en) : '']
    ),
    sheet: 'Padrón operativo'
  };

  if (scope === 'operational') {
    return writeExcelFile([
      buildSummarySheet('operativa', students, qualityRows),
      operationalSheet,
      qualitySheet
    ], { fontFamily: 'Arial', fontSize: 10 }).toBuffer();
  }

  const administrativeRows = students.map((student) => {
    const primary = getPrimaryIdentifier(student);
    const issues = getQualityIssues(student);
    return {
      id: student.id_alumno,
      nombre: student.nombre,
      curso: student.curso || 'Sin curso',
      tipo: identifierLabel(primary?.tipo),
      documento: primary?.valor_original || 'Sin documento',
      pais: primary?.pais_emisor || '',
      fuente: primary?.fuente || '',
      origen: student.origen_alta || 'Sin origen',
      estado_matricula: student.estado_matricula,
      estado_validacion: issues.length ? 'Requiere revisión' : 'Sin incidencias detectadas',
      actualizado_en: student.fecha_actualizacion
    };
  });
  const identifierRows = students.flatMap((student) => (
    (student.identifiers || []).map((identifier) => ({ student, identifier }))
  ));
  return writeExcelFile([
    buildSummarySheet('administrativa', students, qualityRows),
    {
      ...buildSheet(
        ['ID interno', 'Estudiante', 'Curso', 'Identificador principal', 'Documento completo', 'País', 'Fuente', 'Origen de ficha', 'Matrícula', 'Validación', 'Última actualización'],
        administrativeRows,
        [14, 34, 20, 23, 24, 12, 18, 18, 18, 28, 22],
        (row) => [row.id, row.nombre, row.curso, row.tipo, row.documento, row.pais, row.fuente, row.origen, row.estado_matricula, row.estado_validacion, row.actualizado_en ? new Date(row.actualizado_en) : '']
      ),
      sheet: 'Padrón administrativo'
    },
    {
      ...buildSheet(
        ['ID interno', 'Estudiante', 'Tipo', 'Valor completo', 'País', 'Estado', 'Principal', 'Fuente', 'Nivel de validación', 'Validador', 'Versión', 'Resultado', 'Validado en', 'Vigente desde', 'Actualizado'],
        identifierRows,
        [14, 34, 24, 26, 12, 16, 12, 18, 25, 31, 13, 18, 22, 18, 22],
        ({ student, identifier }) => [student.id_alumno, student.nombre, identifierLabel(identifier.tipo), identifier.valor_original, identifier.pais_emisor || '', identifier.estado, identifier.es_principal ? 'Sí' : 'No', identifier.fuente, identifier.nivel_validacion || '', identifier.validador_id || '', identifier.validador_version || '', identifier.resultado_validacion || '', identifier.validado_en ? new Date(identifier.validado_en) : '', identifier.vigente_desde || '', identifier.actualizado_en ? new Date(identifier.actualizado_en) : '']
      ),
      sheet: 'Identificadores'
    },
    qualitySheet
  ], { fontFamily: 'Arial', fontSize: 10 }).toBuffer();
};

module.exports = {
  buildQualityRows,
  buildStudentWorkbook,
  fetchStudentExportDataset,
  getPrimaryIdentifier,
  getQualityIssues,
  identifierLabel,
  maskIdentifier
};
