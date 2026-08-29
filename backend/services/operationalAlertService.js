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
  `, [signal.key, 'CONVIVENCIA', signal.type, 'convivencia_caso', String(signal.caseId), JSON.stringify(signal.data)]);
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
    if (item.proxima_revision) {
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

const runOperationalAlerts = async (pool, { readBackupStatus, realtimeHub } = {}) => {
  const backup = await runBackupAlerts(pool, { readBackupStatus, realtimeHub });
  const coexistence = await runCoexistenceAlerts(pool, { realtimeHub });
  return {
    backupHealthy: backup.healthy,
    notified: backup.notified + coexistence.notified,
    backupNotified: backup.notified,
    coexistenceNotified: coexistence.notified,
    coexistenceSignals: coexistence.signals
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
  runBackupAlerts,
  runCoexistenceAlerts,
  runOperationalAlerts,
  startOperationalAlertScheduler
};
