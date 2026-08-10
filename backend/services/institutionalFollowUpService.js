const ACTIVE_CASE_STATES = ['ABIERTO', 'ASIGNADO', 'EN_CONTACTO', 'EN_SEGUIMIENTO', 'ESCALADO', 'RESUELTO'];

const signal = ({ rule, key, entityType, entityId, studentId = null, occurrences = 1, title, reason, data = {} }) => ({
  rule,
  key: String(key),
  entityType,
  entityId: String(entityId),
  studentId,
  occurrences: Number(occurrences) || 1,
  title,
  reason,
  data
});

const collectSignals = async (queryable) => {
  const [
    lateCounts,
    manualStudents,
    withoutCourse,
    withoutGuardian,
    withdrawals,
    openVisits,
    openWithdrawals,
    pendingJustifications,
    identityConflicts
  ] = await Promise.all([
    queryable.query(`
      SELECT r.id_alumno, COUNT(*)::int AS total,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante
      FROM attendance_registrations r
      JOIN alumno a ON a.id_alumno = r.id_alumno
      WHERE r.tipo_registro = 'Entrada' AND r.estado = 'Atrasado' AND r.anulado = false
        AND r.fecha >= CURRENT_DATE - INTERVAL '29 days'
        AND a.activo = true AND a.fusionado_en_id IS NULL
      GROUP BY r.id_alumno, a.nombres, a.paterno, a.materno
      HAVING COUNT(*) >= 3
    `),
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
    `)
  ]);

  const results = [];
  for (const row of lateCounts.rows) {
    const critical = row.total >= 5;
    results.push(signal({
      rule: critical ? 'ATRASOS_CRITICOS' : 'ATRASOS_PREVENTIVOS',
      key: `estudiante:${row.id_alumno}`,
      entityType: 'ESTUDIANTE', entityId: row.id_alumno, studentId: row.id_alumno,
      occurrences: row.total,
      title: critical ? `Seguimiento crítico de puntualidad · ${row.estudiante}` : `Seguimiento preventivo de puntualidad · ${row.estudiante}`,
      reason: `${row.total} atrasos registrados durante los últimos 30 días.`,
      data: { atrasos_30_dias: row.total }
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
  return results;
};

const upsertSignalAndCase = async (client, item, rules, actorId = null) => {
  const rule = rules.get(item.rule);
  if (!rule || !rule.activa) return { ignored: true };
  const signalKey = `${item.rule}:${item.key}`;
  const signalResult = await client.query(`
    INSERT INTO seguimiento_senales (
      regla_codigo, clave, entidad_tipo, entidad_id, id_alumno, activa,
      ocurrencias, detectada_ultima_en, resuelta_en, datos
    ) VALUES ($1, $2, $3, $4, $5, true, $6, CURRENT_TIMESTAMP, NULL, $7::jsonb)
    ON CONFLICT (regla_codigo, clave) DO UPDATE SET
      entidad_tipo = EXCLUDED.entidad_tipo,
      entidad_id = EXCLUDED.entidad_id,
      id_alumno = EXCLUDED.id_alumno,
      activa = true,
      ocurrencias = EXCLUDED.ocurrencias,
      detectada_ultima_en = CURRENT_TIMESTAMP,
      resuelta_en = NULL,
      datos = EXCLUDED.datos
    RETURNING id_senal, id_caso
  `, [item.rule, item.key, item.entityType, item.entityId, item.studentId, item.occurrences, JSON.stringify(item.data)]);
  let caseId = signalResult.rows[0].id_caso;
  let created = false;
  if (!caseId) {
    const createdCase = await client.query(`
      INSERT INTO seguimiento_casos (
        titulo, motivo_apertura, origen, regla_codigo, clave_dedupe, prioridad,
        estudiante_principal_id, fecha_limite, visita_id, retiro_id, creado_por, actualizado_por
      ) VALUES ($1, $2, 'AUTOMATICO', $3, $4, $5, $6,
        CURRENT_DATE + ($7::int * INTERVAL '1 day'), $8, $9, $10, $10)
      ON CONFLICT (clave_dedupe) WHERE clave_dedupe IS NOT NULL AND estado NOT IN ('CERRADO', 'ANULADO')
      DO UPDATE SET actualizado_en = CURRENT_TIMESTAMP, version = seguimiento_casos.version + 1
      RETURNING id_caso, (xmax = 0) AS creado
    `, [item.title, item.reason, item.rule, signalKey, rule.prioridad, item.studentId,
      rule.plazo_dias, item.entityType === 'VISITA' ? Number(item.entityId) : null,
      item.entityType === 'RETIRO' ? Number(item.entityId) : null, actorId]);
    caseId = createdCase.rows[0].id_caso;
    created = createdCase.rows[0].creado;
    await client.query('UPDATE seguimiento_senales SET id_caso = $1 WHERE id_senal = $2', [caseId, signalResult.rows[0].id_senal]);
    if (item.studentId) {
      await client.query(`
        INSERT INTO seguimiento_caso_estudiantes (id_caso, id_alumno, relacion, agregado_por)
        VALUES ($1, $2, 'PRINCIPAL', $3) ON CONFLICT DO NOTHING
      `, [caseId, item.studentId, actorId]);
    }
    if (created) await client.query(`
      INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
      VALUES ($1, 'APERTURA_AUTOMATICA', 'Caso abierto por regla institucional', $2, $3::jsonb, $4)
    `, [caseId, item.reason, JSON.stringify({ regla: item.rule, ocurrencias: item.occurrences }), actorId]);
  }
  return { caseId, created };
};

const runInstitutionalFollowUp = async (pool, { actorId = null } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('seguimiento-institucional'))");
    const rulesResult = await client.query('SELECT * FROM seguimiento_reglas WHERE activa = true');
    const rules = new Map(rulesResult.rows.map((row) => [row.codigo, row]));
    const detected = await collectSignals(client);
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
      if (row.id_caso) await client.query(`
        INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
        VALUES ($1, 'SENAL_RESUELTA', 'La señal automática dejó de estar activa', $2, $3::jsonb, $4)
      `, [row.id_caso, `La condición ${row.regla_codigo} ya no fue detectada.`, JSON.stringify({ regla: row.regla_codigo }), actorId]);
      resolved += 1;
    }
    await client.query('COMMIT');
    return { detected: detected.length, created, resolved, evaluated_at: new Date().toISOString() };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const startInstitutionalFollowUpScheduler = (pool) => {
  if (String(process.env.FOLLOW_UP_AUTOMATION_ENABLED || 'false').toLowerCase() !== 'true') return () => {};
  const intervalMs = Math.max(60_000, Number(process.env.FOLLOW_UP_AUTOMATION_INTERVAL_MS) || 15 * 60_000);
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runInstitutionalFollowUp(pool);
      console.log(JSON.stringify({ event: 'seguimiento_automatico', ...result }));
    } catch (error) {
      console.error('[seguimiento automático]', error.message);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(execute, 30_000);
  const timer = setInterval(execute, intervalMs);
  return () => { clearTimeout(initial); clearInterval(timer); };
};

module.exports = { ACTIVE_CASE_STATES, collectSignals, runInstitutionalFollowUp, startInstitutionalFollowUpScheduler };
