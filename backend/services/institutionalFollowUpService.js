const ACTIVE_CASE_STATES = ['ABIERTO', 'ASIGNADO', 'EN_CONTACTO', 'EN_SEGUIMIENTO', 'ESCALADO'];
const PRIORITY_RANK = { BAJA: 1, MEDIA: 2, ALTA: 3, URGENTE: 4 };

const originForSignal = (entityType, entityId, studentId = null) => {
  const value = encodeURIComponent(String(entityId));
  const studentValue = studentId ? encodeURIComponent(String(studentId)) : null;
  const origins = {
    ESTUDIANTE: { etiqueta: 'Ficha del estudiante', enlace: `/admin/estudiantes?estudiante_id=${value}` },
    FAMILIA: { etiqueta: 'Ficha familiar', enlace: `/admin/familias?estudiante_id=${studentValue || value}` },
    VISITA: { etiqueta: 'Registro de visita', enlace: `/admin/visitas?tab=historial&visita_id=${value}` },
    RETIRO: { etiqueta: 'Solicitud de retiro', enlace: `/admin/visitas?tab=retiros&retiro_id=${value}` },
    REGISTRO_PUNTUALIDAD: { etiqueta: 'Ingreso procesado', enlace: `/admin/atrasos?registro_id=${value}` },
    CONFLICTO_IDENTIDAD: { etiqueta: 'Conflicto de identidad', enlace: `/admin/gobierno-datos?conflicto_id=${value}` },
    POSIBLE_DUPLICADO: { etiqueta: 'Gobierno de datos', enlace: `/admin/gobierno-datos?estudiante_id=${studentValue || value}` },
    DOCUMENTO_ESTUDIANTE: { etiqueta: 'Documento del expediente', enlace: `/admin/documentos/ficha/${value}` },
    CONVIVENCIA: { etiqueta: 'Caso reservado de Convivencia', enlace: `/admin/convivencia/${value}`, permiso: 'convivencia.view' }
  };
  return origins[entityType] || { etiqueta: 'Registro de origen', enlace: studentValue ? `/admin/estudiantes?estudiante_id=${studentValue}` : null };
};

const signal = ({ rule, key, dedupeKey = null, entityType, entityId, studentId = null, relatedStudentIds = [], occurrences = 1, title, reason, data = {} }) => ({
  rule,
  key: String(key),
  dedupeKey,
  entityType,
  entityId: String(entityId),
  studentId,
  relatedStudentIds: [...new Set(relatedStudentIds.map(Number).filter(Number.isSafeInteger))],
  occurrences: Number(occurrences) || 1,
  title,
  reason,
  data: { ...data, origen: data.origen || originForSignal(entityType, entityId, studentId) }
});

const collectSignals = async (queryable, rules) => {
  const latenessRules = [...rules.values()].filter((rule) => (
    rule.activa && rule.tipo_senal === 'ATRASOS' && Number(rule.ventana_dias) > 0
  ));
  const documentWindowDays = Math.max(1, Number(rules.get('DOCUMENTO_POR_VENCER')?.ventana_dias) || 30);
  const [
    manualStudents,
    withoutCourse,
    withoutGuardian,
    familyContactIncomplete,
    withdrawals,
    openVisits,
    openWithdrawals,
    pendingJustifications,
    identityConflicts,
    expiredDocuments,
    expiringDocuments,
    possibleDuplicates,
    criticalCoexistence
  ] = await Promise.all([
    queryable.query(`
      SELECT a.id_alumno, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM alumno a
      WHERE a.activo = true AND a.rol = 'Estudiante' AND a.origen_alta = 'MANUAL'
        AND a.erp_vinculado_en IS NULL AND a.fusionado_en_id IS NULL
    `),
    queryable.query(`
      SELECT a.id_alumno, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM alumno a
      LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
      WHERE a.activo = true AND a.rol = 'Estudiante' AND a.fusionado_en_id IS NULL
        AND m.id_matricula IS NULL
    `),
    queryable.query(`
      SELECT a.id_alumno, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM alumno a
      WHERE a.activo = true AND a.rol = 'Estudiante' AND a.fusionado_en_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM personas_autorizadas_retiro p
          WHERE p.id_alumno = a.id_alumno AND p.activo = true
            AND p.vigente_desde <= CURRENT_DATE
            AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= CURRENT_DATE)
        )
    `),
    queryable.query(`
      SELECT a.id_alumno, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM alumno a
      WHERE a.activo = true AND a.rol = 'Estudiante' AND a.fusionado_en_id IS NULL
        AND EXISTS (
          SELECT 1 FROM personas_autorizadas_retiro p
          WHERE p.id_alumno = a.id_alumno AND p.activo = true
            AND p.vigente_desde <= CURRENT_DATE
            AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= CURRENT_DATE)
        )
        AND NOT EXISTS (
          SELECT 1 FROM personas_autorizadas_retiro p
          JOIN visitantes v ON v.id = p.visitante_id
          WHERE p.id_alumno = a.id_alumno AND p.activo = true
            AND p.vigente_desde <= CURRENT_DATE
            AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= CURRENT_DATE)
            AND COALESCE(NULLIF(trim(v.telefono), ''), NULLIF(trim(v.telefono_emergencia), '')) IS NOT NULL
        )
    `),
    queryable.query(`
      SELECT r.id_alumno, COUNT(*)::int AS total,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM retiros_alumno r
      JOIN alumno a ON a.id_alumno = r.id_alumno
      WHERE r.estado = 'ENTREGADO' AND r.entregado_en >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        AND a.activo = true
      GROUP BY r.id_alumno, a.nombres, a.paterno, a.materno
      HAVING COUNT(*) >= 3
    `),
    queryable.query(`
      SELECT v.id, vi.nombre_completo, v.ingreso_en
      FROM visitas v JOIN visitantes vi ON vi.id = v.visitante_id
      WHERE v.estado = 'DENTRO' AND v.ingreso_en < CURRENT_TIMESTAMP - INTERVAL '12 hours'
    `),
    queryable.query(`
      SELECT r.id, r.id_alumno, r.estado, r.solicitado_en,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM retiros_alumno r JOIN alumno a ON a.id_alumno = r.id_alumno
      WHERE r.estado IN ('SOLICITADO', 'AUTORIZADO')
        AND r.solicitado_en < CURRENT_TIMESTAMP - INTERVAL '12 hours'
    `),
    queryable.query(`
      SELECT r.id_registro, r.id_alumno, r.fecha,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM attendance_registrations r JOIN alumno a ON a.id_alumno = r.id_alumno
      WHERE r.tipo_registro = 'Entrada' AND r.estado = 'Atrasado' AND r.anulado = false
        AND r.justificado = false AND r.fecha < CURRENT_DATE
        AND r.fecha >= CURRENT_DATE - INTERVAL '30 days'
    `),
    queryable.query(`
      SELECT c.id, c.id_alumno, c.mensaje, c.creado_en,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM importacion_estudiante_cambios c
      LEFT JOIN alumno a ON a.id_alumno = c.id_alumno
      WHERE c.accion = 'CONFLICTO'
        AND c.creado_en >= CURRENT_TIMESTAMP - INTERVAL '90 days'
    `),
    queryable.query(`
      SELECT d.id_documento_expediente, e.id_alumno, d.titulo, d.vence_en,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM documentos_expediente d
      JOIN expedientes_documentales e ON e.id_expediente = d.id_expediente
      JOIN alumno a ON a.id_alumno = e.id_alumno
      WHERE d.estado <> 'ARCHIVADO' AND d.vence_en < CURRENT_DATE
        AND a.activo = true AND a.fusionado_en_id IS NULL
    `),
    queryable.query(`
      SELECT d.id_documento_expediente, e.id_alumno, d.titulo, d.vence_en,
             (d.vence_en - CURRENT_DATE)::int AS dias_restantes,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM documentos_expediente d
      JOIN expedientes_documentales e ON e.id_expediente = d.id_expediente
      JOIN alumno a ON a.id_alumno = e.id_alumno
      WHERE d.estado <> 'ARCHIVADO' AND d.vence_en >= CURRENT_DATE
        AND d.vence_en <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
        AND a.activo = true AND a.fusionado_en_id IS NULL
    `, [documentWindowDays]),
    queryable.query(`
      SELECT lower(trim(concat_ws(' ', nombres, paterno, materno))) AS nombre_normalizado,
             fecha_nacimiento, array_agg(id_alumno ORDER BY id_alumno) AS estudiantes_ids,
             min(trim(concat_ws(' ', nombres, paterno, materno))) AS estudiante
      FROM alumno
      WHERE activo = true AND rol = 'Estudiante' AND fusionado_en_id IS NULL
        AND fecha_nacimiento IS NOT NULL
      GROUP BY lower(trim(concat_ws(' ', nombres, paterno, materno))), fecha_nacimiento
      HAVING COUNT(*) > 1
    `),
    queryable.query(`
      SELECT c.id_caso, c.codigo, c.prioridad, c.proxima_revision,
             min(p.estudiante_id) FILTER (WHERE p.tipo_persona = 'ESTUDIANTE' AND p.activo = true) AS id_alumno
      FROM convivencia_casos c
      LEFT JOIN convivencia_participantes p ON p.id_caso = c.id_caso
      WHERE c.estado NOT IN ('CERRADO', 'ANULADO') AND c.prioridad IN ('ALTA', 'URGENTE')
      GROUP BY c.id_caso
    `)
  ]);

  const results = [];
  const latenessCandidates = new Map();
  const latenessResults = await Promise.all(latenessRules.map(async (rule) => ({
    rule,
    rows: (await queryable.query(`
      SELECT r.id_alumno, COUNT(*)::int AS total,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM attendance_registrations r
      JOIN alumno a ON a.id_alumno = r.id_alumno
      WHERE r.tipo_registro = 'Entrada' AND r.estado = 'Atrasado' AND r.anulado = false
        AND r.fecha >= CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day')
        AND a.activo = true AND a.fusionado_en_id IS NULL
      GROUP BY r.id_alumno, a.nombres, a.paterno, a.materno
      HAVING COUNT(*) >= $2::int
    `, [Number(rule.ventana_dias), Number(rule.umbral)])).rows
  })));
  for (const { rule, rows } of latenessResults) {
    for (const row of rows) {
      const current = latenessCandidates.get(row.id_alumno);
      const currentRank = current ? PRIORITY_RANK[current.rule.prioridad] || 0 : -1;
      const candidateRank = PRIORITY_RANK[rule.prioridad] || 0;
      if (!current || candidateRank > currentRank || (candidateRank === currentRank && Number(rule.umbral) > Number(current.rule.umbral))) {
        latenessCandidates.set(row.id_alumno, { rule, row });
      }
    }
  }
  for (const { rule, row } of latenessCandidates.values()) {
    const critical = rule.codigo === 'ATRASOS_CRITICOS' || ['ALTA', 'URGENTE'].includes(rule.prioridad);
    results.push(signal({
      rule: rule.codigo,
      key: `estudiante:${row.id_alumno}`,
      dedupeKey: `ATRASOS:estudiante:${row.id_alumno}`,
      entityType: 'ESTUDIANTE', entityId: row.id_alumno, studentId: row.id_alumno,
      occurrences: row.total,
      title: critical ? `Seguimiento crítico de puntualidad · ${row.estudiante}` : `Seguimiento preventivo de puntualidad · ${row.estudiante}`,
      reason: `${row.total} atrasos registrados durante los últimos ${rule.ventana_dias} días.`,
      data: { atrasos: row.total, ventana_dias: Number(rule.ventana_dias), umbral: Number(rule.umbral) }
    }));
  }
  for (const row of manualStudents.rows) results.push(signal({
    rule: 'ALTA_MANUAL_SIN_ERP', key: `estudiante:${row.id_alumno}`, entityType: 'ESTUDIANTE', entityId: row.id_alumno,
    studentId: row.id_alumno, title: `Alta manual pendiente · ${row.estudiante}`,
    reason: 'La ficha fue creada manualmente y todavía no está vinculada con el ERP.'
  }));
  for (const row of withoutCourse.rows) results.push(signal({
    rule: 'ESTUDIANTE_SIN_CURSO', key: `estudiante:${row.id_alumno}`, entityType: 'ESTUDIANTE', entityId: row.id_alumno,
    studentId: row.id_alumno, title: `Estudiante sin curso vigente · ${row.estudiante}`,
    reason: 'La ficha está activa, pero no tiene matrícula vigente.'
  }));
  for (const row of withoutGuardian.rows) results.push(signal({
    rule: 'ESTUDIANTE_SIN_APODERADO', key: `estudiante:${row.id_alumno}`, entityType: 'ESTUDIANTE', entityId: row.id_alumno,
    studentId: row.id_alumno, title: `Ficha familiar incompleta · ${row.estudiante}`,
    reason: 'No existe una persona responsable o autorizada vigente asociada al estudiante.'
  }));
  for (const row of familyContactIncomplete.rows) results.push(signal({
    rule: 'CONTACTO_FAMILIAR_INCOMPLETO', key: `estudiante:${row.id_alumno}`, entityType: 'FAMILIA', entityId: row.id_alumno,
    studentId: row.id_alumno, title: `Contacto familiar incompleto · ${row.estudiante}`,
    reason: 'La ficha familiar tiene personas autorizadas vigentes, pero ninguna registra un teléfono de contacto.'
  }));
  for (const row of withdrawals.rows) results.push(signal({
    rule: 'RETIROS_REITERADOS', key: `estudiante:${row.id_alumno}`, entityType: 'ESTUDIANTE', entityId: row.id_alumno,
    studentId: row.id_alumno, occurrences: row.total, title: `Retiros anticipados reiterados · ${row.estudiante}`,
    reason: `${row.total} retiros entregados durante los últimos 30 días.`, data: { retiros_30_dias: row.total }
  }));
  for (const row of openVisits.rows) results.push(signal({
    rule: 'VISITA_SIN_CERRAR', key: `visita:${row.id}`, entityType: 'VISITA', entityId: row.id,
    title: `Visita sin cierre · ${row.nombre_completo}`, reason: 'La visita permanece dentro por más de 12 horas.',
    data: { ingreso_en: row.ingreso_en }
  }));
  for (const row of openWithdrawals.rows) results.push(signal({
    rule: 'RETIRO_SIN_CERRAR', key: `retiro:${row.id}`, entityType: 'RETIRO', entityId: row.id,
    studentId: row.id_alumno, title: `Retiro sin cierre · ${row.estudiante}`,
    reason: `El retiro permanece ${String(row.estado).toLowerCase()} por más de 12 horas.`, data: { estado: row.estado, solicitado_en: row.solicitado_en }
  }));
  for (const row of pendingJustifications.rows) results.push(signal({
    rule: 'JUSTIFICACION_PENDIENTE', key: `registro:${row.id_registro}`, entityType: 'REGISTRO_PUNTUALIDAD', entityId: row.id_registro,
    studentId: row.id_alumno, title: `Justificación pendiente · ${row.estudiante}`,
    reason: `El atraso del ${row.fecha.toISOString?.().slice(0, 10) || row.fecha} continúa sin justificación.`
  }));
  for (const row of identityConflicts.rows) results.push(signal({
    rule: 'CONFLICTO_IDENTIDAD', key: `importacion_cambio:${row.id}`, entityType: 'CONFLICTO_IDENTIDAD', entityId: row.id,
    studentId: row.id_alumno, title: `Conflicto de identidad${row.estudiante ? ` · ${row.estudiante}` : ''}`,
    reason: row.mensaje || 'Una importación detectó identificadores incompatibles y requiere revisión humana.'
  }));
  for (const row of expiredDocuments.rows) results.push(signal({
    rule: 'DOCUMENTO_VENCIDO', key: `documento:${row.id_documento_expediente}`, entityType: 'DOCUMENTO_ESTUDIANTE', entityId: row.id_documento_expediente,
    studentId: row.id_alumno, title: `Documento vencido · ${row.estudiante}`,
    reason: `“${row.titulo}” venció el ${row.vence_en.toISOString?.().slice(0, 10) || row.vence_en}.`,
    data: { documento_titulo: row.titulo, vence_en: row.vence_en }
  }));
  for (const row of expiringDocuments.rows) results.push(signal({
    rule: 'DOCUMENTO_POR_VENCER', key: `documento:${row.id_documento_expediente}`, entityType: 'DOCUMENTO_ESTUDIANTE', entityId: row.id_documento_expediente,
    studentId: row.id_alumno, title: `Documento próximo a vencer · ${row.estudiante}`,
    reason: `“${row.titulo}” vence en ${row.dias_restantes} ${Number(row.dias_restantes) === 1 ? 'día' : 'días'}.`,
    data: { documento_titulo: row.titulo, vence_en: row.vence_en, dias_restantes: Number(row.dias_restantes) }
  }));
  for (const row of possibleDuplicates.rows) {
    const studentIds = (row.estudiantes_ids || []).map(Number).filter(Number.isSafeInteger);
    if (studentIds.length < 2) continue;
    results.push(signal({
      rule: 'POSIBLE_DUPLICADO_ESTUDIANTE', key: `grupo:${studentIds.join('-')}`, entityType: 'POSIBLE_DUPLICADO', entityId: studentIds[0],
      studentId: studentIds[0], relatedStudentIds: studentIds, occurrences: studentIds.length,
      title: `Posible ficha duplicada · ${row.estudiante}`,
      reason: `${studentIds.length} fichas activas comparten nombre completo y fecha de nacimiento; requieren comparación humana antes de cualquier fusión.`,
      data: { estudiantes_ids: studentIds, fecha_nacimiento: row.fecha_nacimiento }
    }));
  }
  for (const row of criticalCoexistence.rows) results.push(signal({
    rule: 'CONVIVENCIA_CRITICA', key: `caso:${row.id_caso}`, entityType: 'CONVIVENCIA', entityId: row.id_caso,
    studentId: row.id_alumno, title: `Coordinación reservada requerida · ${row.codigo || `Caso ${row.id_caso}`}`,
    reason: `Convivencia Escolar mantiene una situación ${String(row.prioridad).toLowerCase()} activa que requiere coordinación institucional autorizada.`,
    data: { codigo: row.codigo, prioridad: row.prioridad, proxima_revision: row.proxima_revision }
  }));
  return results;
};

const upsertSignalAndCase = async (client, item, rules, actorId = null) => {
  const rule = rules.get(item.rule);
  if (!rule || !rule.activa) return { ignored: true };
  const signalKey = item.dedupeKey || `${item.rule}:${item.key}`;
  const signalResult = await client.query(`
    INSERT INTO seguimiento_senales (
      regla_codigo, clave, entidad_tipo, entidad_id, id_alumno, activa,
      ocurrencias, detectada_ultima_en, resuelta_en, datos
    ) VALUES ($1, $2, $3, $4, $5, true, $6, CURRENT_TIMESTAMP, NULL, $7::jsonb)
    ON CONFLICT (regla_codigo, clave) DO UPDATE SET
      entidad_tipo = EXCLUDED.entidad_tipo,
      entidad_id = EXCLUDED.entidad_id,
      id_alumno = EXCLUDED.id_alumno,
      ciclo_deteccion = CASE
        WHEN seguimiento_senales.activa THEN seguimiento_senales.ciclo_deteccion
        ELSE seguimiento_senales.ciclo_deteccion + 1
      END,
      activa = true,
      ocurrencias = EXCLUDED.ocurrencias,
      detectada_primera_en = CASE
        WHEN seguimiento_senales.activa THEN seguimiento_senales.detectada_primera_en
        ELSE CURRENT_TIMESTAMP
      END,
      detectada_ultima_en = CURRENT_TIMESTAMP,
      resuelta_en = NULL,
      datos = EXCLUDED.datos
    RETURNING id_senal, id_caso, ciclo_deteccion
  `, [item.rule, item.key, item.entityType, item.entityId, item.studentId, item.occurrences, JSON.stringify(item.data)]);
  let caseId = signalResult.rows[0].id_caso;
  let created = false;
  if (caseId) {
    const linkedCase = await client.query('SELECT estado FROM seguimiento_casos WHERE id_caso = $1', [caseId]);
    if (!linkedCase.rowCount || ['CERRADO', 'ANULADO'].includes(linkedCase.rows[0].estado)) caseId = null;
    else if (linkedCase.rows[0].estado === 'RESUELTO') {
      await client.query(`
        UPDATE seguimiento_casos
        SET estado = 'ABIERTO', resultado_final = NULL,
            fecha_limite = CURRENT_DATE + ($2::int * INTERVAL '1 day'),
            actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $3, version = version + 1
        WHERE id_caso = $1
      `, [caseId, rule.plazo_dias, actorId]);
      await client.query(`
        INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
        VALUES ($1, 'REACTIVACION_AUTOMATICA', 'La condición volvió a estar activa', $2, $3::jsonb, $4)
      `, [caseId, item.reason, JSON.stringify({ regla: item.rule, ciclo: signalResult.rows[0].ciclo_deteccion }), actorId]);
    }
  }
  if (!caseId) {
    const createdCase = await client.query(`
      INSERT INTO seguimiento_casos (
        titulo, motivo_apertura, origen, regla_codigo, clave_dedupe, prioridad,
        estudiante_principal_id, fecha_limite, visita_id, retiro_id, creado_por, actualizado_por
      ) VALUES ($1, $2, 'AUTOMATICO', $3, $4, $5, $6,
        CURRENT_DATE + ($7::int * INTERVAL '1 day'), $8, $9, $10, $10)
      ON CONFLICT (clave_dedupe) WHERE clave_dedupe IS NOT NULL AND estado NOT IN ('CERRADO', 'ANULADO')
      DO UPDATE SET regla_codigo = EXCLUDED.regla_codigo,
        titulo = EXCLUDED.titulo,
        motivo_apertura = EXCLUDED.motivo_apertura,
        actualizado_en = CURRENT_TIMESTAMP,
        version = seguimiento_casos.version + 1
      RETURNING id_caso, (xmax = 0) AS creado
    `, [item.title, item.reason, item.rule, signalKey, rule.prioridad, item.studentId,
      rule.plazo_dias, item.entityType === 'VISITA' ? Number(item.entityId) : null,
      item.entityType === 'RETIRO' ? Number(item.entityId) : null, actorId]);
    caseId = createdCase.rows[0].id_caso;
    created = createdCase.rows[0].creado;
    await client.query('UPDATE seguimiento_senales SET id_caso = $1 WHERE id_senal = $2', [caseId, signalResult.rows[0].id_senal]);
    const linkedStudentIds = [...new Set([item.studentId, ...(item.relatedStudentIds || [])].map(Number).filter(Number.isSafeInteger))];
    for (const studentId of linkedStudentIds) {
      await client.query(`
        INSERT INTO seguimiento_caso_estudiantes (id_caso, id_alumno, relacion, agregado_por)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
      `, [caseId, studentId, studentId === item.studentId ? 'PRINCIPAL' : 'RELACIONADO', actorId]);
    }
    if (created) await client.query(`
      INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
      VALUES ($1, 'APERTURA_AUTOMATICA', 'Caso abierto por regla institucional', $2, $3::jsonb, $4)
    `, [caseId, item.reason, JSON.stringify({ regla: item.rule, ocurrencias: item.occurrences }), actorId]);
  }
  return { caseId, created, detectionCycle: signalResult.rows[0].ciclo_deteccion };
};

const insertNotification = async (client, {
  userId, type, title, detail, link, dedupeKey, priority = 'IMPORTANTE'
}) => {
  if (!userId) return false;
  const result = await client.query(`
    INSERT INTO notificaciones_internas (
      usuario_id, modulo, tipo, titulo, detalle, enlace, clave_dedupe, prioridad
    ) VALUES ($1, 'SEGUIMIENTO', $2, $3, $4, $5, $6, $7)
    ON CONFLICT (usuario_id, clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING
    RETURNING id_notificacion
  `, [userId, type, title, detail, link, dedupeKey, priority]);
  return result.rowCount > 0;
};

const selectResponsible = async (client, profileCode) => {
  if (!profileCode) return null;
  const result = await client.query(`
    SELECT u.id
    FROM usuarios u
    WHERE u.rol = $1 AND u.activo = true AND u.eliminado_en IS NULL
    ORDER BY (
      SELECT COUNT(*) FROM seguimiento_casos c
      WHERE c.responsable_usuario_id = u.id
        AND c.estado = ANY($2::varchar[])
    ), u.id
    LIMIT 1
  `, [profileCode, ACTIVE_CASE_STATES]);
  return result.rows[0]?.id || null;
};

const selectEscalationRecipients = async (client, ruleCode) => {
  const result = await client.query(`
    SELECT DISTINCT u.id AS usuario_id, g.codigo AS grupo_codigo, g.nombre AS grupo_nombre
    FROM seguimiento_regla_escalamiento_grupos rg
    JOIN seguimiento_grupos_notificacion g
      ON g.codigo = rg.grupo_codigo AND g.activo = true
    JOIN seguimiento_grupo_perfiles gp ON gp.grupo_codigo = g.codigo
    JOIN usuarios u ON u.rol = gp.perfil_codigo
    WHERE rg.regla_codigo = $1
      AND u.activo = true AND u.eliminado_en IS NULL
    ORDER BY u.id, g.codigo
  `, [ruleCode]);
  const recipients = new Map();
  for (const row of result.rows) {
    const current = recipients.get(row.usuario_id) || { userId: row.usuario_id, groups: [] };
    current.groups.push({ code: row.grupo_codigo, name: row.grupo_nombre });
    recipients.set(row.usuario_id, current);
  }
  return [...recipients.values()];
};

const operateCases = async (client, rules, configuration, actorId = null) => {
  const result = { assigned: 0, escalated: 0, taskReminders: 0, notified: 0 };
  if (configuration.asignacion_automatica) {
    const unassigned = await client.query(`
      SELECT c.id_caso, c.titulo, c.regla_codigo, r.responsable_perfil_codigo,
             r.notificar_responsable
      FROM seguimiento_casos c
      JOIN seguimiento_reglas r ON r.codigo = c.regla_codigo
      WHERE c.origen = 'AUTOMATICO' AND c.responsable_usuario_id IS NULL
        AND c.estado = ANY($1::varchar[]) AND r.responsable_perfil_codigo IS NOT NULL
      ORDER BY c.fecha_limite NULLS LAST, c.creado_en, c.id_caso
      FOR UPDATE OF c
    `, [ACTIVE_CASE_STATES]);
    for (const item of unassigned.rows) {
      const userId = await selectResponsible(client, item.responsable_perfil_codigo);
      if (!userId) continue;
      await client.query(`
        UPDATE seguimiento_casos
        SET responsable_usuario_id = $2, estado = CASE WHEN estado = 'ABIERTO' THEN 'ASIGNADO' ELSE estado END,
            asignado_automaticamente = true, actualizado_en = CURRENT_TIMESTAMP,
            actualizado_por = $3, version = version + 1
        WHERE id_caso = $1
      `, [item.id_caso, userId, actorId]);
      await client.query(`
        INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
        VALUES ($1, 'ASIGNACION_AUTOMATICA', 'Responsable asignado automáticamente',
          'La asignación se realizó según el perfil definido en la regla institucional.',
          $2::jsonb, $3)
      `, [item.id_caso, JSON.stringify({ perfil: item.responsable_perfil_codigo, responsable_usuario_id: userId }), actorId]);
      result.assigned += 1;
      if (configuration.notificaciones_activas && item.notificar_responsable) {
        const inserted = await insertNotification(client, {
          userId,
          type: 'CASO_ASIGNADO',
          title: 'Nuevo seguimiento asignado',
          detail: item.titulo,
          link: `/admin/seguimiento/${item.id_caso}`,
          dedupeKey: `seguimiento:${item.id_caso}:asignacion:${userId}`,
          priority: 'IMPORTANTE'
        });
        if (inserted) result.notified += 1;
      }
    }
  }

  if (configuration.escalamiento_automatico) {
    const overdue = await client.query(`
      SELECT c.id_caso, c.titulo, c.prioridad, c.responsable_usuario_id,
             r.codigo AS regla_codigo,
             c.fecha_limite, r.escalamiento_dias, r.notificar_responsable
      FROM seguimiento_casos c
      JOIN seguimiento_reglas r ON r.codigo = c.regla_codigo
      WHERE c.estado = ANY($1::varchar[]) AND c.fecha_limite IS NOT NULL
        AND r.escalamiento_dias IS NOT NULL AND c.escalado_automatico_en IS NULL
        AND c.fecha_limite + r.escalamiento_dias <= CURRENT_DATE
      ORDER BY c.fecha_limite, c.id_caso
      FOR UPDATE OF c
    `, [ACTIVE_CASE_STATES]);
    for (const item of overdue.rows) {
      const nextPriority = Object.entries(PRIORITY_RANK)
        .find(([, rank]) => rank === Math.min(4, (PRIORITY_RANK[item.prioridad] || 1) + 1))?.[0] || 'URGENTE';
      const escalationRecipients = await selectEscalationRecipients(client, item.regla_codigo);
      const escalationGroups = [...new Set(escalationRecipients.flatMap((recipient) => (
        recipient.groups.map((group) => group.name)
      )))];
      await client.query(`
        UPDATE seguimiento_casos
        SET estado = 'ESCALADO', prioridad = $2, escalado_automatico_en = CURRENT_TIMESTAMP,
            actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $3, version = version + 1
        WHERE id_caso = $1
      `, [item.id_caso, nextPriority, actorId]);
      await client.query(`
        INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
        VALUES ($1, 'ESCALAMIENTO_AUTOMATICO', 'Plazo institucional excedido',
          'El caso fue escalado al alcanzar el plazo institucional sin una resolución registrada.',
          $2::jsonb, $3)
      `, [item.id_caso, JSON.stringify({
        fecha_limite: item.fecha_limite,
        margen_adicional_dias: item.escalamiento_dias,
        prioridad_anterior: item.prioridad,
        prioridad_nueva: nextPriority,
        grupos_notificados: escalationGroups
      }), actorId]);
      result.escalated += 1;
      if (configuration.notificaciones_activas && item.notificar_responsable) {
        const recipients = [...escalationRecipients];
        if (recipients.length === 0 && item.responsable_usuario_id) {
          recipients.push({ userId: item.responsable_usuario_id, groups: [] });
        }
        for (const recipient of recipients) {
          const groupNames = recipient.groups.map((group) => group.name).join(' y ');
          const inserted = await insertNotification(client, {
            userId: recipient.userId,
            type: 'CASO_ESCALADO',
            title: 'Seguimiento fuera de plazo',
            detail: groupNames ? `${item.titulo} · Aviso para ${groupNames}` : item.titulo,
            link: `/admin/seguimiento/${item.id_caso}`,
            dedupeKey: `seguimiento:${item.id_caso}:escalamiento:${recipient.userId}`,
            priority: 'URGENTE'
          });
          if (inserted) result.notified += 1;
        }
      }
    }
  }
  if (configuration.notificaciones_activas) {
    const overdueTasks = await client.query(`
      SELECT t.id_tarea, t.titulo, t.prioridad, t.fecha_limite,
             c.id_caso, c.titulo AS caso_titulo,
             COALESCE(t.responsable_usuario_id, c.responsable_usuario_id) AS destinatario_id
      FROM seguimiento_tareas t
      JOIN seguimiento_casos c ON c.id_caso = t.id_caso
      WHERE t.estado IN ('PENDIENTE', 'EN_PROGRESO') AND t.fecha_limite < CURRENT_DATE
        AND c.estado = ANY($1::varchar[])
        AND COALESCE(t.responsable_usuario_id, c.responsable_usuario_id) IS NOT NULL
      ORDER BY t.fecha_limite, t.id_tarea
    `, [ACTIVE_CASE_STATES]);
    for (const task of overdueTasks.rows) {
      const inserted = await insertNotification(client, {
        userId: task.destinatario_id,
        type: 'TAREA_VENCIDA',
        title: 'Tarea de seguimiento fuera de plazo',
        detail: `${task.titulo} · ${task.caso_titulo}`,
        link: `/admin/seguimiento/${task.id_caso}`,
        dedupeKey: `seguimiento:tarea:${task.id_tarea}:vencida:${String(task.fecha_limite).slice(0, 10)}`,
        priority: ['ALTA', 'URGENTE'].includes(task.prioridad) ? 'URGENTE' : 'IMPORTANTE'
      });
      if (inserted) {
        result.taskReminders += 1;
        result.notified += 1;
      }
    }
  }
  return result;
};

const previewInstitutionalFollowUp = async (pool) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rulesResult = await client.query('SELECT * FROM seguimiento_reglas WHERE activa = true');
    const rules = new Map(rulesResult.rows.map((row) => [row.codigo, row]));
    const detected = await collectSignals(client, rules);
    const grouped = new Map();
    for (const item of detected) {
      const rule = rules.get(item.rule);
      const current = grouped.get(item.rule) || {
        codigo: item.rule,
        nombre: rule?.nombre || item.rule,
        prioridad: rule?.prioridad || null,
        total: 0
      };
      current.total += 1;
      grouped.set(item.rule, current);
    }
    await client.query('COMMIT');
    return {
      detected: detected.length,
      affected_students: new Set(detected.map((item) => item.studentId).filter(Boolean)).size,
      by_rule: [...grouped.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es')),
      evaluated_at: new Date().toISOString()
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const runInstitutionalFollowUp = async (pool, { actorId = null } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('seguimiento-institucional'))");
    const [rulesResult, configResult] = await Promise.all([
      client.query('SELECT * FROM seguimiento_reglas WHERE activa = true'),
      client.query('SELECT * FROM seguimiento_configuracion WHERE id_configuracion = 1 FOR UPDATE')
    ]);
    const rules = new Map(rulesResult.rows.map((row) => [row.codigo, row]));
    const configuration = configResult.rows[0] || {
      asignacion_automatica: false,
      escalamiento_automatico: false,
      notificaciones_activas: false
    };
    const detected = await collectSignals(client, rules);
    const currentKeys = new Set(detected.map((item) => `${item.rule}:${item.key}`));
    let created = 0;
    for (const item of detected) {
      const result = await upsertSignalAndCase(client, item, rules, actorId);
      if (result.created) created += 1;
    }
    const activeSignals = await client.query('SELECT id_senal, regla_codigo, clave, id_caso FROM seguimiento_senales WHERE activa = true');
    let resolved = 0;
    for (const row of activeSignals.rows) {
      if (currentKeys.has(`${row.regla_codigo}:${row.clave}`)) continue;
      await client.query('UPDATE seguimiento_senales SET activa = false, resuelta_en = CURRENT_TIMESTAMP WHERE id_senal = $1', [row.id_senal]);
      const replacementSignal = row.id_caso ? await client.query(`
        SELECT 1 FROM seguimiento_senales
        WHERE id_caso = $1 AND activa = true AND id_senal <> $2
        LIMIT 1
      `, [row.id_caso, row.id_senal]) : { rowCount: 0 };
      if (row.id_caso && !replacementSignal.rowCount) await client.query(`
        INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
        VALUES ($1, 'SENAL_RESUELTA', 'La señal automática dejó de estar activa', $2, $3::jsonb, $4)
      `, [row.id_caso, `La condición ${row.regla_codigo} ya no fue detectada.`, JSON.stringify({ regla: row.regla_codigo }), actorId]);
      resolved += 1;
    }
    const operations = await operateCases(client, rules, configuration, actorId);
    const summary = { detected: detected.length, created, resolved, ...operations, evaluated_at: new Date().toISOString() };
    await client.query(`
      UPDATE seguimiento_configuracion
      SET ultima_ejecucion_en = CURRENT_TIMESTAMP, ultima_ejecucion_resultado = $1::jsonb
      WHERE id_configuracion = 1
    `, [JSON.stringify(summary)]);
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const startInstitutionalFollowUpScheduler = (pool) => {
  if (String(process.env.FOLLOW_UP_AUTOMATION_ENABLED || 'true').toLowerCase() === 'false') return () => {};
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const config = await pool.query(`
        SELECT automatizacion_activa, intervalo_minutos, ultima_ejecucion_en,
               ultima_ejecucion_en IS NULL OR ultima_ejecucion_en <=
                 CURRENT_TIMESTAMP - (intervalo_minutos * INTERVAL '1 minute') AS corresponde
        FROM seguimiento_configuracion WHERE id_configuracion = 1
      `);
      if (!config.rows[0]?.automatizacion_activa || !config.rows[0]?.corresponde) return;
      const result = await runInstitutionalFollowUp(pool);
      console.log(JSON.stringify({ event: 'seguimiento_automatico', ...result }));
    } catch (error) {
      console.error('[seguimiento automático]', error.message);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(execute, 30_000);
  const timer = setInterval(execute, 60_000);
  initial.unref?.();
  timer.unref?.();
  return () => { clearTimeout(initial); clearInterval(timer); };
};

module.exports = {
  ACTIVE_CASE_STATES,
  collectSignals,
  operateCases,
  previewInstitutionalFollowUp,
  runInstitutionalFollowUp,
  startInstitutionalFollowUpScheduler
};
