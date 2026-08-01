const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const { isIsoDate } = require('../utils/validation');

const parsePositiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const readBackupStatus = async () => {
  try {
    const statusPath = process.env.BACKUP_STATUS_FILE || '/app/backups/last-success.env';
    const content = await fs.readFile(path.resolve(statusPath), 'utf8');
    const values = Object.fromEntries(content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
      }));
    const completedAt = values.timestamp || values.BACKUP_COMPLETED_AT || values.COMPLETED_AT || null;
    const ageHours = completedAt
      ? Math.max(0, (Date.now() - new Date(completedAt).getTime()) / 3600000)
      : null;
    return {
      available: true,
      healthy: ageHours !== null && ageHours <= 25,
      completed_at: completedAt,
      age_hours: ageHours === null ? null : Number(ageHours.toFixed(1)),
      database_file: values.database || values.DATABASE_FILE || values.DB_BACKUP || null,
      documents_file: values.documents || values.DOCUMENTS_FILE || values.UPLOADS_BACKUP || null,
      manifest_file: values.manifest || null
    };
  } catch {
    return {
      available: false,
      healthy: false,
      completed_at: null,
      age_hours: null,
      database_file: null,
      documents_file: null
    };
  }
};

const createOperationsRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}) => {
  const router = express.Router();
  router.use(verifyToken);

  const getPendingSnapshot = async (queryable = pool) => {
    const [
      visits,
      requestedWithdrawals,
      authorizedWithdrawals,
      unenrolled,
      events,
      justifications,
      lockedUsers,
      manualStudents
    ] = await Promise.all([
      queryable.query(`
        SELECT v.id, v.ingreso_en, vi.nombre_completo, vm.nombre AS motivo, vd.nombre AS destino
        FROM visitas v
        JOIN visitantes vi ON vi.id = v.visitante_id
        JOIN visita_motivos vm ON vm.codigo = v.motivo_codigo
        JOIN visita_destinos vd ON vd.codigo = v.destino_codigo
        WHERE v.estado = 'DENTRO'
        ORDER BY v.ingreso_en ASC
      `),
      queryable.query(`
        SELECT r.id, r.solicitado_en, a.id_alumno,
               CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante,
               c.nombre_curso
        FROM retiros_alumno r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual ma ON ma.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = ma.id_curso
        WHERE r.estado = 'SOLICITADO'
        ORDER BY r.solicitado_en ASC
      `),
      queryable.query(`
        SELECT r.id, r.solicitado_en, r.decidido_en, a.id_alumno,
               CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante,
               c.nombre_curso
        FROM retiros_alumno r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual ma ON ma.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = ma.id_curso
        WHERE r.estado = 'AUTORIZADO'
        ORDER BY COALESCE(r.decidido_en, r.solicitado_en) ASC
      `),
      queryable.query(`
        SELECT a.id_alumno, a.rut, a.dv,
               CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante
        FROM alumno a
        LEFT JOIN matricula_actual ma ON ma.id_alumno = a.id_alumno
        WHERE a.activo = true AND a.rol = 'Estudiante' AND ma.id_matricula IS NULL
        ORDER BY a.paterno, a.materno, a.nombres
      `),
      queryable.query(`
        SELECT e.id, e.tipo, e.entidad, e.entidad_id, e.detalle, e.ocurrido_en,
               u.nombre AS registrado_por_nombre
        FROM eventos_operacionales e
        LEFT JOIN usuarios u ON u.id = e.registrado_por
        WHERE e.estado = 'PENDIENTE'
        ORDER BY e.ocurrido_en ASC
      `),
      queryable.query(`
        SELECT r.id_registro, r.fecha, r.hora, r.id_alumno,
               CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante,
               r.curso_registro
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        WHERE r.estado = 'Atrasado'
          AND COALESCE(r.justificado, false) = false
          AND COALESCE(r.anulado, false) = false
          AND r.fecha >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY r.fecha ASC, r.hora ASC
      `),
      queryable.query(`
        SELECT id, nombre, correo, activo, intentos_fallidos, bloqueado_hasta
        FROM usuarios
        WHERE eliminado_en IS NULL
          AND (activo = false OR bloqueado_hasta > CURRENT_TIMESTAMP)
        ORDER BY COALESCE(bloqueado_hasta, CURRENT_TIMESTAMP) DESC
      `),
      queryable.query(`
        SELECT a.id_alumno, a.rut, a.dv,
               CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante,
               a.creado_manualmente_en,
               GREATEST(0, CURRENT_DATE - a.creado_manualmente_en::date)::int AS dias_pendiente,
               a.motivo_alta_manual,
               c.nombre_curso
        FROM alumno a
        LEFT JOIN matricula_actual ma ON ma.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = ma.id_curso
        WHERE a.origen_alta = 'MANUAL'
          AND a.erp_vinculado_en IS NULL
          AND a.fusionado_en_id IS NULL
        ORDER BY a.creado_manualmente_en ASC
      `)
    ]);

    return {
      visits: visits.rows,
      requested_withdrawals: requestedWithdrawals.rows,
      authorized_withdrawals: authorizedWithdrawals.rows,
      unenrolled_students: unenrolled.rows,
      operational_events: events.rows,
      pending_justifications: justifications.rows,
      blocked_users: lockedUsers.rows,
      manual_students_pending: manualStudents.rows
    };
  };

  router.get('/bandeja', verifyPermission('operations.view'), async (req, res) => {
    try {
      const [pending, backup, lastClose, databaseClock] = await Promise.all([
        getPendingSnapshot(),
        readBackupStatus(),
        pool.query(`
          SELECT c.fecha, c.resumen, c.cerrado_en, u.nombre AS cerrado_por_nombre
          FROM cierres_operacionales c
          LEFT JOIN usuarios u ON u.id = c.cerrado_por
          ORDER BY c.fecha DESC LIMIT 1
        `),
        pool.query(`SELECT CURRENT_DATE AS fecha, CURRENT_TIMESTAMP AS hora`)
      ]);
      const counts = Object.fromEntries(Object.entries(pending).map(([key, rows]) => [key, rows.length]));
      const blocking = counts.visits + counts.requested_withdrawals + counts.authorized_withdrawals;
      res.json({
        generated_at: databaseClock.rows[0].hora,
        institutional_date: databaseClock.rows[0].fecha,
        summary: {
          ...counts,
          blocking,
          total: Object.values(counts).reduce((sum, value) => sum + value, 0),
          backup_healthy: backup.healthy
        },
        tasks: pending,
        backup,
        last_close: lastClose.rows[0] || null
      });
    } catch (error) {
      console.error('[operaciones:bandeja]', error.message);
      res.status(500).json({ message: 'No fue posible cargar las tareas operativas.' });
    }
  });

  router.get('/cierres/:fecha', verifyPermission('operations.view'), async (req, res) => {
    if (!isIsoDate(req.params.fecha)) return res.status(400).json({ message: 'Fecha inválida.' });
    try {
      const result = await pool.query(`
        SELECT c.*, u.nombre AS cerrado_por_nombre, u.correo AS cerrado_por_correo
        FROM cierres_operacionales c
        LEFT JOIN usuarios u ON u.id = c.cerrado_por
        WHERE c.fecha = $1
      `, [req.params.fecha]);
      if (!result.rowCount) return res.status(404).json({ message: 'No existe cierre para esa fecha.' });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[operaciones:cierre:detalle]', error.message);
      res.status(500).json({ message: 'No fue posible consultar el cierre.' });
    }
  });

  router.post('/cierres', verifyPermission('operations.close'), async (req, res) => {
    const date = req.body?.fecha;
    const observations = String(req.body?.observaciones || '').trim().slice(0, 1000) || null;
    if (date && !isIsoDate(date)) return res.status(400).json({ message: 'Fecha inválida.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const institutionalDate = date || (await client.query('SELECT CURRENT_DATE AS fecha')).rows[0].fecha;
      const existing = await client.query('SELECT id FROM cierres_operacionales WHERE fecha = $1', [institutionalDate]);
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La jornada operacional ya fue cerrada.' });
      }

      const pending = await getPendingSnapshot(client);
      const blockers = {
        visitas_abiertas: pending.visits.length,
        retiros_solicitados: pending.requested_withdrawals.length,
        retiros_autorizados_sin_entrega: pending.authorized_withdrawals.length
      };
      if (Object.values(blockers).some((value) => value > 0)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'OPERATIONAL_CLOSE_BLOCKED',
          message: 'Debes resolver las visitas y retiros abiertos antes de cerrar.',
          blockers
        });
      }

      const summary = {
        fecha: institutionalDate,
        visitas_abiertas: 0,
        retiros_solicitados: 0,
        retiros_autorizados_sin_entrega: 0,
        estudiantes_sin_matricula: pending.unenrolled_students.length,
        eventos_pendientes: pending.operational_events.length,
        justificaciones_pendientes: pending.pending_justifications.length,
        usuarios_bloqueados: pending.blocked_users.length,
        altas_manuales_pendientes: pending.manual_students_pending.length
      };
      const result = await client.query(`
        INSERT INTO cierres_operacionales (fecha, resumen, observaciones, cerrado_por)
        VALUES ($1, $2::jsonb, $3, $4)
        RETURNING *
      `, [institutionalDate, JSON.stringify(summary), observations, req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CERRAR_JORNADA_OPERACIONAL',
        entidad: 'cierre_operacional',
        entidad_id: result.rows[0].id,
        detalle: summary,
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[operaciones:cierre]', error.message);
      res.status(500).json({ message: 'No fue posible cerrar la jornada operacional.' });
    } finally {
      client.release();
    }
  });

  router.patch('/eventos/:id/resolver', verifyPermission('operations.view'), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    const state = String(req.body?.estado || 'RESUELTO').toUpperCase();
    const reason = String(req.body?.motivo || '').trim().slice(0, 500);
    if (!id || !['RESUELTO', 'DESCARTADO'].includes(state) || reason.length < 5) {
      return res.status(400).json({ message: 'Indica una resolución válida y un motivo de al menos 5 caracteres.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        UPDATE eventos_operacionales
        SET estado = $1, resuelto_por = $2, resuelto_en = CURRENT_TIMESTAMP,
            motivo_resolucion = $3
        WHERE id = $4 AND estado = 'PENDIENTE'
        RETURNING *
      `, [state, req.user.id, reason, id]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El evento no existe o ya fue resuelto.' });
      }
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'RESOLVER_EVENTO_OPERACIONAL',
        entidad: 'evento_operacional',
        entidad_id: id,
        detalle: { estado: state, motivo: reason },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[operaciones:evento]', error.message);
      res.status(500).json({ message: 'No fue posible resolver el evento.' });
    } finally {
      client.release();
    }
  });

  router.get('/retencion', verifyPermission('settings.manage'), async (req, res) => {
    try {
      const policies = await pool.query(`
        SELECT p.*, u.nombre AS actualizado_por_nombre
        FROM politicas_retencion p
        LEFT JOIN usuarios u ON u.id = p.actualizado_por
        ORDER BY p.categoria
      `);
      const previews = await Promise.all(policies.rows.map(async (policy) => {
        if (!policy.dias_retencion) return { ...policy, candidatos: null };
        const interval = Number(policy.dias_retencion);
        const queries = {
          RUT_TELEFONOS: `SELECT count(*)::int AS total FROM visitantes WHERE actualizado_en < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')`,
          AUDITORIA: `SELECT count(*)::int AS total FROM audit_log WHERE fecha < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')`,
          DOCUMENTOS: `SELECT count(*)::int AS total FROM justification_documents WHERE fecha_creacion < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')`,
          VISITAS_RETIROS: `
            SELECT (
              (SELECT count(*) FROM visitas WHERE ingreso_en < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day'))
              + (SELECT count(*) FROM retiros_alumno WHERE solicitado_en < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day'))
            )::int AS total`
        };
        const count = await pool.query(queries[policy.categoria], [interval]);
        return { ...policy, candidatos: count.rows[0].total };
      }));
      res.json({
        execution_enabled: false,
        message: 'La política solo previsualiza. Ningún dato se elimina automáticamente.',
        policies: previews
      });
    } catch (error) {
      console.error('[operaciones:retencion]', error.message);
      res.status(500).json({ message: 'No fue posible consultar las políticas de retención.' });
    }
  });

  router.put('/retencion/:categoria', verifyPermission('settings.manage'), async (req, res) => {
    const category = String(req.params.categoria || '').toUpperCase();
    const days = req.body?.dias_retencion === null || req.body?.dias_retencion === ''
      ? null
      : Number(req.body?.dias_retencion);
    const foundation = String(req.body?.fundamento || '').trim().slice(0, 1000);
    const allowed = ['RUT_TELEFONOS', 'AUDITORIA', 'DOCUMENTOS', 'VISITAS_RETIROS'];
    if (!allowed.includes(category)
      || (days !== null && (!Number.isInteger(days) || days < 30 || days > 3650))
      || foundation.length < 10) {
      return res.status(400).json({ message: 'Revisa la categoría, el período y el fundamento institucional.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM politicas_retencion WHERE categoria = $1 FOR UPDATE', [category]);
      const result = await client.query(`
        UPDATE politicas_retencion
        SET dias_retencion = $1, modo = 'APROBADA_SIN_EJECUTAR', fundamento = $2,
            actualizado_por = $3, actualizado_en = CURRENT_TIMESTAMP
        WHERE categoria = $4
        RETURNING *
      `, [days, foundation, req.user.id, category]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'DEFINIR_POLITICA_RETENCION',
        entidad: 'politica_retencion',
        entidad_id: null,
        detalle: { categoria: category, antes: before.rows[0], despues: result.rows[0], ejecucion_automatica: false },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[operaciones:retencion:actualizar]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar la política.' });
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = { createOperationsRouter, readBackupStatus };
