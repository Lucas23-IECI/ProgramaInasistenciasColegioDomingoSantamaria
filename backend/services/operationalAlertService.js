const publishNotification = (realtimeHub, userId, notification, fallback = {}) => {
  if (!notification) return;
  realtimeHub?.publishToUsers([userId], 'institutional-notification', {
    notification_id: notification.id_notificacion,
    title: fallback.title,
    detail: fallback.detail,
    priority: fallback.priority,
    link: fallback.link,
    sender: 'Sistema institucional',
    created_at: notification.creada_en,
    notify: true
  });
};

const dateOnly = (value) => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value || '').slice(0, 10);

const insertAutomaticNotification = async (pool, realtimeHub, {
  userId, module, type, title, detail, link, dedupeKey, priority
}) => {
  const inserted = await pool.query(`
    INSERT INTO notificaciones_internas (
      usuario_id, modulo, tipo, titulo, detalle, enlace, clave_dedupe, prioridad
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (usuario_id, clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING
    RETURNING id_notificacion, creada_en
  `, [userId, module, type, title, detail, link, dedupeKey, priority]);
  if (!inserted.rowCount) return false;
  publishNotification(realtimeHub, userId, inserted.rows[0], { title, detail, priority, link });
  return true;
};

const runBackupAlerts = async (pool, { readBackupStatus, realtimeHub } = {}) => {
  if (typeof readBackupStatus !== 'function') throw new Error('No se configuró la lectura del estado de respaldos.');
  const backup = await readBackupStatus();
  if (backup.healthy) return { healthy: true, notified: 0 };
  const recipients = await pool.query(`
    SELECT id FROM usuarios
    WHERE rol IN ('admin', 'direccion') AND activo = true AND eliminado_en IS NULL
    ORDER BY id
  `);
  const day = new Date().toISOString().slice(0, 10);
  const backupReference = backup.completed_at ? String(backup.completed_at).slice(0, 10) : 'sin-respaldo';
  const detail = backup.completed_at
    ? `El último respaldo verificable tiene ${backup.age_hours ?? 'más de 25'} horas. Revisa el servidor y ejecuta el procedimiento de respaldo.`
    : 'No se encontró un respaldo verificable. Revisa el servidor y ejecuta el procedimiento de respaldo.';
  let notified = 0;
  for (const recipient of recipients.rows) {
    const created = await insertAutomaticNotification(pool, realtimeHub, {
      userId: recipient.id,
      module: 'OPERACION',
      type: 'RESPALDO_REQUIERE_REVISION',
      title: 'Respaldo institucional por revisar',
      detail,
      priority: 'URGENTE',
      link: '/admin/operacion',
      dedupeKey: `operacion:respaldo:${backupReference}:${day}`
    });
    if (created) notified += 1;
  }
  return { healthy: false, notified };
};

const activateAlertCycle = async (pool, signal) => {
  const result = await pool.query(`
    INSERT INTO alertas_operacionales_estado (
      clave_alerta, modulo, tipo, entidad_tipo, entidad_id, activa, ciclo, datos
    ) VALUES ($1, $2, $3, $4, $5, true, 1, $6::jsonb)
    ON CONFLICT (clave_alerta) DO UPDATE SET
      activa = true,
      ciclo = CASE
        WHEN alertas_operacionales_estado.activa THEN alertas_operacionales_estado.ciclo
        ELSE alertas_operacionales_estado.ciclo + 1
      END,
      detectada_en = CASE
        WHEN alertas_operacionales_estado.activa THEN alertas_operacionales_estado.detectada_en
        ELSE CURRENT_TIMESTAMP
      END,
      resuelta_en = NULL,
      actualizada_en = CURRENT_TIMESTAMP,
      datos = EXCLUDED.datos
    RETURNING ciclo
  `, [
    signal.key,
    signal.module || 'CONVIVENCIA',
    signal.type,
    signal.entityType || 'convivencia_caso',
    String(signal.entityId ?? signal.caseId),
    JSON.stringify(signal.data)
  ]);
  return Number(result.rows[0]?.ciclo || 1);
};

const closeResolvedCoexistenceAlerts = async (pool, activeKeys) => {
  await pool.query(`
    UPDATE alertas_operacionales_estado
    SET activa = false, resuelta_en = CURRENT_TIMESTAMP, actualizada_en = CURRENT_TIMESTAMP
    WHERE modulo = 'CONVIVENCIA' AND activa = true
      AND tipo = ANY($1::varchar[])
      AND NOT (clave_alerta = ANY($2::varchar[]))
  `, [
    ['CONVIVENCIA_REVISION_VENCIDA', 'CONVIVENCIA_URGENTE_SIN_RESPONSABLE'],
    activeKeys
  ]);
};

const reconcileCoexistenceAlertState = async (queryable, caseId) => {
  await queryable.query(`
    UPDATE alertas_operacionales_estado a
    SET activa = false, resuelta_en = CURRENT_TIMESTAMP, actualizada_en = CURRENT_TIMESTAMP
    WHERE a.modulo = 'CONVIVENCIA'
      AND a.entidad_tipo = 'convivencia_caso'
      AND a.entidad_id = $1::text
      AND a.activa = true
      AND (
        (
          a.tipo = 'CONVIVENCIA_REVISION_VENCIDA'
          AND NOT EXISTS (
            SELECT 1
            FROM convivencia_casos c
            WHERE c.id_caso = $1::int
              AND c.estado NOT IN ('CERRADO', 'ANULADO')
              AND c.proxima_revision IS NOT NULL
              AND c.proxima_revision <= CURRENT_DATE
          )
        )
        OR (
          a.tipo = 'CONVIVENCIA_URGENTE_SIN_RESPONSABLE'
          AND NOT EXISTS (
            SELECT 1
            FROM convivencia_casos c
            LEFT JOIN usuarios responsable ON responsable.id = c.responsable_usuario_id
            WHERE c.id_caso = $1::int
              AND c.estado NOT IN ('CERRADO', 'ANULADO')
              AND c.prioridad = 'URGENTE'
              AND (
                c.responsable_usuario_id IS NULL
                OR responsable.id IS NULL
                OR responsable.activo = false
                OR responsable.eliminado_en IS NOT NULL
              )
          )
        )
      )
  `, [caseId]);
};

const runCoexistenceAlerts = async (pool, { realtimeHub } = {}) => {
  const [cases, authorized] = await Promise.all([
    pool.query(`
      SELECT c.id_caso, c.codigo, c.prioridad, c.proxima_revision,
             (c.proxima_revision IS NOT NULL AND c.proxima_revision <= CURRENT_DATE) AS revision_vencida,
             c.responsable_usuario_id,
             responsable.activo AS responsable_activo,
             responsable.eliminado_en AS responsable_eliminado_en
      FROM convivencia_casos c
      LEFT JOIN usuarios responsable ON responsable.id = c.responsable_usuario_id
      WHERE c.estado NOT IN ('CERRADO', 'ANULADO')
        AND (
          (c.proxima_revision IS NOT NULL AND c.proxima_revision <= CURRENT_DATE)
          OR (
            c.prioridad = 'URGENTE'
            AND (c.responsable_usuario_id IS NULL OR responsable.activo IS DISTINCT FROM true OR responsable.eliminado_en IS NOT NULL)
          )
        )
      ORDER BY c.id_caso
    `),
    pool.query(`
      SELECT u.id
      FROM usuarios u
      WHERE u.activo = true AND u.eliminado_en IS NULL
        AND COALESCE(
          (SELECT pu.concedido FROM permisos_usuario pu
            WHERE pu.usuario_id = u.id AND pu.permiso_codigo = 'convivencia.view'),
          EXISTS (SELECT 1 FROM permisos_rol pr
            WHERE pr.rol = u.rol AND pr.permiso_codigo = 'convivencia.view')
        )
      ORDER BY u.id
    `)
  ]);

  const authorizedIds = authorized.rows.map((row) => Number(row.id));
  const authorizedSet = new Set(authorizedIds);
  const signals = [];
  for (const item of cases.rows) {
    const caseId = Number(item.id_caso);
    const code = item.codigo || `Caso ${caseId}`;
    if (item.revision_vencida === true) {
      const dueDate = dateOnly(item.proxima_revision);
      const responsibleId = Number(item.responsable_usuario_id);
      signals.push({
        key: `convivencia:revision:${caseId}:${dueDate}`,
        type: 'CONVIVENCIA_REVISION_VENCIDA',
        caseId,
        recipients: authorizedSet.has(responsibleId) ? [responsibleId] : authorizedIds,
        title: 'Revisión de Convivencia pendiente',
        detail: `El caso reservado ${code} tiene una revisión pendiente desde el ${dueDate}. Abre la ficha para registrar la actuación o definir una nueva fecha.`,
        link: `/admin/convivencia/${caseId}`,
        priority: item.prioridad === 'URGENTE' ? 'URGENTE' : 'IMPORTANTE',
        data: { codigo: code, proxima_revision: dueDate, prioridad: item.prioridad }
      });
    }
    const withoutResponsible = item.prioridad === 'URGENTE'
      && (!item.responsable_usuario_id || item.responsable_activo !== true || item.responsable_eliminado_en);
    if (withoutResponsible) {
      signals.push({
        key: `convivencia:urgente-sin-responsable:${caseId}`,
        type: 'CONVIVENCIA_URGENTE_SIN_RESPONSABLE',
        caseId,
        recipients: authorizedIds,
        title: 'Caso urgente de Convivencia sin responsable',
        detail: `El caso reservado ${code} necesita una persona responsable activa. Abre la ficha y asigna el seguimiento.`,
        link: `/admin/convivencia/${caseId}`,
        priority: 'URGENTE',
        data: { codigo: code, prioridad: item.prioridad }
      });
    }
  }

  let notified = 0;
  const activeKeys = [];
  for (const signal of signals) {
    activeKeys.push(signal.key);
    const cycle = await activateAlertCycle(pool, signal);
    for (const userId of signal.recipients) {
      const created = await insertAutomaticNotification(pool, realtimeHub, {
        userId,
        module: 'CONVIVENCIA',
        type: signal.type,
        title: signal.title,
        detail: signal.detail,
        link: signal.link,
        priority: signal.priority,
        dedupeKey: `${signal.key}:ciclo:${cycle}`
      });
      if (created) notified += 1;
    }
  }
  await closeResolvedCoexistenceAlerts(pool, activeKeys);
  return { notified, signals: signals.length };
};

const closeResolvedOperationAlerts = async (pool, activeKeys) => {
  await pool.query(`
    UPDATE alertas_operacionales_estado
    SET activa = false, resuelta_en = CURRENT_TIMESTAMP, actualizada_en = CURRENT_TIMESTAMP
    WHERE modulo = 'OPERACION' AND activa = true
      AND tipo = ANY($1::varchar[])
      AND NOT (clave_alerta = ANY($2::varchar[]))
  `, [[
    'RETIRO_PENDIENTE',
    'VISITA_PERMANENCIA_EXCESIVA',
    'CONFLICTO_IMPORTACION',
    'ESTUDIANTE_MANUAL_SIN_ERP'
  ], activeKeys]);
};

const runPendingOperationAlerts = async (pool, { realtimeHub } = {}) => {
  const [authorized, withdrawals, visits, importConflicts, manualStudents] = await Promise.all([
    pool.query(`
      SELECT u.id
      FROM usuarios u
      WHERE u.activo = true AND u.eliminado_en IS NULL
        AND COALESCE(
          (SELECT pu.concedido FROM permisos_usuario pu
            WHERE pu.usuario_id = u.id AND pu.permiso_codigo = 'operations.view'),
          EXISTS (SELECT 1 FROM permisos_rol pr
            WHERE pr.rol = u.rol AND pr.permiso_codigo = 'operations.view')
        )
      ORDER BY u.id
    `),
    pool.query(`
      SELECT r.id, r.estado, r.solicitado_en, r.decidido_en
      FROM retiros_alumno r
      WHERE r.estado IN ('SOLICITADO', 'AUTORIZADO')
        AND COALESCE(r.decidido_en, r.solicitado_en) <= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
      ORDER BY COALESCE(r.decidido_en, r.solicitado_en), r.id
    `),
    pool.query(`
      SELECT v.id, v.ingreso_en, cfg.max_horas_visita
      FROM visitas v
      CROSS JOIN LATERAL (
        SELECT max_horas_visita FROM configuracion_visitas ORDER BY id LIMIT 1
      ) cfg
      WHERE v.estado = 'DENTRO'
        AND v.ingreso_en <= CURRENT_TIMESTAMP - (cfg.max_horas_visita * INTERVAL '1 hour')
      ORDER BY v.ingreso_en, v.id
    `),
    pool.query(`
      SELECT e.id, e.ocurrido_en, e.detalle
      FROM eventos_operacionales e
      WHERE e.estado = 'PENDIENTE' AND e.tipo = 'IMPORTACION_RECHAZADA'
      ORDER BY e.ocurrido_en, e.id
    `),
    pool.query(`
      SELECT a.id_alumno, a.creado_manualmente_en
      FROM alumno a
      WHERE a.origen_alta = 'MANUAL'
        AND a.erp_vinculado_en IS NULL
        AND a.fusionado_en_id IS NULL
        AND a.creado_manualmente_en <= CURRENT_TIMESTAMP - INTERVAL '1 day'
      ORDER BY a.creado_manualmente_en, a.id_alumno
    `)
  ]);

  const recipients = authorized.rows.map((row) => Number(row.id));
  const signals = [
    ...withdrawals.rows.map((item) => ({
      key: `operacion:retiro:${item.id}`,
      module: 'OPERACION',
      type: 'RETIRO_PENDIENTE',
      entityType: 'retiro',
      entityId: item.id,
      title: 'Retiro pendiente de completar',
      detail: item.estado === 'AUTORIZADO'
        ? `El retiro #${item.id} está autorizado y todavía no registra la entrega del estudiante.`
        : `El retiro #${item.id} espera una decisión desde hace más de 15 minutos.`,
      link: `/admin/visitas?tab=retiros&retiro_id=${item.id}`,
      priority: item.estado === 'AUTORIZADO' ? 'URGENTE' : 'IMPORTANTE',
      data: { estado: item.estado, solicitado_en: item.solicitado_en, decidido_en: item.decidido_en }
    })),
    ...visits.rows.map((item) => ({
      key: `operacion:visita-permanencia:${item.id}`,
      module: 'OPERACION',
      type: 'VISITA_PERMANENCIA_EXCESIVA',
      entityType: 'visita',
      entityId: item.id,
      title: 'Permanencia de visita por revisar',
      detail: `La visita #${item.id} supera el máximo configurado de ${item.max_horas_visita} horas sin registrar salida.`,
      link: `/admin/visitas?tab=historial&visita_id=${item.id}`,
      priority: 'URGENTE',
      data: { ingreso_en: item.ingreso_en, max_horas_visita: item.max_horas_visita }
    })),
    ...importConflicts.rows.map((item) => ({
      key: `operacion:conflicto-importacion:${item.id}`,
      module: 'OPERACION',
      type: 'CONFLICTO_IMPORTACION',
      entityType: 'evento_operacional',
      entityId: item.id,
      title: 'Importación pendiente de resolución',
      detail: `El conflicto de importación #${item.id} continúa pendiente. Revisa la bandeja antes de volver a sincronizar.`,
      link: '/admin/operacion',
      priority: 'IMPORTANTE',
      data: { ocurrido_en: item.ocurrido_en, resumen: item.detalle || {} }
    })),
    ...manualStudents.rows.map((item) => ({
      key: `operacion:estudiante-manual-sin-erp:${item.id_alumno}`,
      module: 'OPERACION',
      type: 'ESTUDIANTE_MANUAL_SIN_ERP',
      entityType: 'estudiante',
      entityId: item.id_alumno,
      title: 'Alta manual todavía sin vínculo ERP',
      detail: `La ficha estudiantil #${item.id_alumno} lleva más de un día sin vincularse con el padrón ERP.`,
      link: `/admin/estudiantes?estudiante_id=${item.id_alumno}`,
      priority: 'IMPORTANTE',
      data: { creado_manualmente_en: item.creado_manualmente_en }
    }))
  ];

  let notified = 0;
  const activeKeys = [];
  for (const signal of signals) {
    activeKeys.push(signal.key);
    const cycle = await activateAlertCycle(pool, signal);
    for (const userId of recipients) {
      const created = await insertAutomaticNotification(pool, realtimeHub, {
        userId,
        module: signal.module,
        type: signal.type,
        title: signal.title,
        detail: signal.detail,
        link: signal.link,
        priority: signal.priority,
        dedupeKey: `${signal.key}:ciclo:${cycle}`
      });
      if (created) notified += 1;
    }
  }
  await closeResolvedOperationAlerts(pool, activeKeys);
  return { notified, signals: signals.length };
};

const runOperationalAlerts = async (pool, { readBackupStatus, realtimeHub } = {}) => {
  const backup = await runBackupAlerts(pool, { readBackupStatus, realtimeHub });
  const coexistence = await runCoexistenceAlerts(pool, { realtimeHub });
  const operation = await runPendingOperationAlerts(pool, { realtimeHub });
  return {
    backupHealthy: backup.healthy,
    notified: backup.notified + coexistence.notified + operation.notified,
    backupNotified: backup.notified,
    coexistenceNotified: coexistence.notified,
    coexistenceSignals: coexistence.signals,
    operationNotified: operation.notified,
    operationSignals: operation.signals
  };
};

const startOperationalAlertScheduler = (pool, options = {}) => {
  if (String(process.env.OPERATIONAL_ALERTS_ENABLED || 'true').toLowerCase() === 'false') return () => {};
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runOperationalAlerts(pool, options);
      if (result.notified > 0) console.log(JSON.stringify({ event: 'alertas_operacionales', ...result }));
    } catch (error) {
      console.error('[alertas operacionales]', error.message);
    } finally { running = false; }
  };
  const initial = setTimeout(execute, 60_000);
  const timer = setInterval(execute, 15 * 60_000);
  initial.unref?.(); timer.unref?.();
  return () => { clearTimeout(initial); clearInterval(timer); };
};

module.exports = {
  activateAlertCycle,
  closeResolvedCoexistenceAlerts,
  reconcileCoexistenceAlertState,
  closeResolvedOperationAlerts,
  runBackupAlerts,
  runCoexistenceAlerts,
  runPendingOperationAlerts,
  runOperationalAlerts,
  startOperationalAlertScheduler
};
