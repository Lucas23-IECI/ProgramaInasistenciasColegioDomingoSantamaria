const express = require('express');

const { calculateDelayMinutes, calculateStatusAndSeverity, normalizeClockTime } = require('../utils/punctuality');
const { asBoundedInteger, isIsoDate, validateDateRange, validatePunctualityConfig, validateReason } = require('../utils/validation');

const ACTIVE_ENTRY_FILTER = "r.tipo_registro = 'Entrada' AND r.anulado = false AND r.estado IN ('Presente', 'Atrasado')";

const registrationSnapshot = (row) => ({
  id_registro: row.id_registro,
  id_alumno: row.id_alumno,
  fecha: row.fecha,
  hora: row.hora,
  estado: row.estado,
  severidad: row.severidad,
  justificado: Boolean(row.justificado),
  comentario_justificacion: row.comentario_justificacion || null,
  anulado: Boolean(row.anulado),
  version: row.version
});

const getConfig = async (queryable, { forUpdate = false } = {}) => {
  const result = await queryable.query(`
    SELECT id, nombre_jornada, hora_entrada, hora_limite_atraso, minutos_atraso_grave,
           umbral_alerta, umbral_critico, actualizado_por, actualizado_en
    FROM configuracion_asistencia
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE' : ''}
  `);
  return result.rows[0] || null;
};

const getInstitutionalNow = async (queryable) => {
  const result = await queryable.query(`
    SELECT CURRENT_DATE::text AS fecha, TO_CHAR(LOCALTIME, 'HH24:MI:SS') AS hora
  `);
  return result.rows[0];
};

const parseRegistrationId = (value) => asBoundedInteger(value, 1, 2147483647);

const createPunctualityRouter = ({ pool, verifyToken, verifyRole, insertarAudit, getClientIp }) => {
  const router = express.Router();

  router.use(verifyToken);

  router.get('/config', async (req, res) => {
    try {
      const config = await getConfig(pool);
      if (!config) return res.status(503).json({ message: 'La jornada institucional no está configurada.' });
      res.json(config);
    } catch (error) {
      console.error('[puntualidad/config]', error.message);
      res.status(500).json({ message: 'No fue posible obtener la configuración de puntualidad.' });
    }
  });

  router.put('/config', verifyRole(['admin']), async (req, res) => {
    const validation = validatePunctualityConfig(req.body);
    if (validation.error) return res.status(400).json({ message: validation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await getConfig(client, { forUpdate: true });
      if (!before) {
        await client.query('ROLLBACK');
        return res.status(503).json({ message: 'La jornada institucional no está inicializada.' });
      }

      const value = validation.value;
      const updated = await client.query(`
        UPDATE configuracion_asistencia
        SET nombre_jornada = $1,
            hora_entrada = $2,
            hora_limite_atraso = $3,
            minutos_atraso_grave = $4,
            umbral_alerta = $5,
            umbral_critico = $6,
            actualizado_por = $7,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING id, nombre_jornada, hora_entrada, hora_limite_atraso, minutos_atraso_grave,
                  umbral_alerta, umbral_critico, actualizado_por, actualizado_en
      `, [
        value.nombre_jornada,
        value.hora_entrada,
        value.hora_limite_atraso,
        value.minutos_atraso_grave,
        value.umbral_alerta,
        value.umbral_critico,
        req.user.id,
        before.id
      ]);

      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ACTUALIZAR_CONFIG_PUNTUALIDAD',
        entidad: 'configuracion_puntualidad',
        entidad_id: before.id,
        detalle: { antes: before, despues: updated.rows[0] },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Configuración actualizada.', config: updated.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/config:update]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar la configuración.' });
    } finally {
      client.release();
    }
  });

  router.post('/registros', async (req, res) => {
    const studentId = asBoundedInteger(req.body?.id_alumno, 1, 2147483647);
    if (!studentId) return res.status(400).json({ message: 'El identificador del alumno no es válido.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const studentResult = await client.query(
        `SELECT id_alumno, nombres, paterno, materno, activo
         FROM alumno WHERE id_alumno = $1 FOR SHARE`,
        [studentId]
      );
      if (studentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Alumno no encontrado.' });
      }
      if (!studentResult.rows[0].activo) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'El alumno se encuentra inactivo.' });
      }

      const config = await getConfig(client);
      const now = await getInstitutionalNow(client);
      const { status, severidad } = calculateStatusAndSeverity('Entrada', now.hora, config || {});
      const origen = req.user.rol === 'lector' ? 'lector' : 'manual';

      const inserted = await client.query(`
        INSERT INTO attendance_registrations
          (id_alumno, fecha, hora, estado, tipo_registro, severidad, origen, registrado_por, creado_en)
        VALUES ($1, $2, $3, $4, 'Entrada', $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (id_alumno, fecha, tipo_registro) WHERE anulado = false DO NOTHING
        RETURNING *
      `, [studentId, now.fecha, now.hora, status, severidad, origen, req.user.id]);

      if (inserted.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'El ingreso de esta persona ya fue registrado hoy.' });
      }

      const registration = inserted.rows[0];
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REGISTRAR_INGRESO',
        entidad: 'registro_puntualidad',
        entidad_id: registration.id_registro,
        detalle: {
          id_alumno: studentId,
          fecha: now.fecha,
          hora: now.hora,
          estado: status,
          severidad,
          origen
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      res.status(201).json({
        ...registration,
        minutos_atraso: calculateDelayMinutes(now.hora, config?.hora_limite_atraso || '08:15:00')
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:create]', error.message);
      if (error.code === '23505') return res.status(409).json({ message: 'El ingreso de esta persona ya fue registrado hoy.' });
      res.status(500).json({ message: 'No fue posible registrar el ingreso.' });
    } finally {
      client.release();
    }
  });

  router.get('/hoy', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT r.id_registro, r.fecha, r.hora, r.estado, r.severidad, r.justificado,
               r.comentario_justificacion, r.origen, r.registrado_por, r.creado_en,
               r.version, r.corregido_en, r.motivo_correccion,
               a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
               c.id_curso, c.nombre_curso AS curso,
               u.nombre AS registrado_por_nombre
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = m.id_curso
        LEFT JOIN usuarios u ON u.id = r.registrado_por
        WHERE r.fecha = CURRENT_DATE AND ${ACTIVE_ENTRY_FILTER}
        ORDER BY r.hora DESC, r.id_registro DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('[puntualidad/hoy]', error.message);
      res.status(500).json({ message: 'No fue posible obtener los ingresos del día.' });
    }
  });

  router.get('/resumen-hoy', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS ingresos_registrados,
          COUNT(*) FILTER (WHERE r.estado = 'Presente')::int AS a_tiempo,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Leve')::int AS atrasos_leves,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS atrasos_graves,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.justificado = true)::int AS justificados,
          (SELECT COUNT(*)::int FROM alumno WHERE activo = true AND rol = 'Estudiante') AS matricula_activa
        FROM attendance_registrations r
        WHERE r.fecha = CURRENT_DATE AND ${ACTIVE_ENTRY_FILTER}
      `);
      const summary = result.rows[0];
      const registered = summary.ingresos_registrados || 0;
      const onTime = summary.a_tiempo || 0;
      res.json({
        ...summary,
        puntualidad_registrada: registered > 0 ? Number(((onTime / registered) * 100).toFixed(1)) : null
      });
    } catch (error) {
      console.error('[puntualidad/resumen-hoy]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el resumen del día.' });
    }
  });

  router.patch('/registros/:id/corregir', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.motivo);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(`
        SELECT * FROM attendance_registrations
        WHERE id_registro = $1 AND anulado = false
        FOR UPDATE
      `, [registrationId]);
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Registro activo no encontrado.' });
      }
      const target = targetResult.rows[0];
      if (target.tipo_registro !== 'Entrada' || !['Presente', 'Atrasado'].includes(target.estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Este registro no pertenece al control de puntualidad.' });
      }

      const correctedDate = req.body?.fecha || String(target.fecha).slice(0, 10);
      const correctedTime = normalizeClockTime(req.body?.hora || target.hora);
      if (!isIsoDate(correctedDate) || !correctedTime) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La fecha o la hora corregida no es válida.' });
      }

      const config = await getConfig(client);
      const classification = calculateStatusAndSeverity('Entrada', correctedTime, config || {});
      const before = registrationSnapshot(target);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET fecha = $1,
            hora = $2,
            estado = $3,
            severidad = $4,
            corregido_por = $5,
            corregido_en = CURRENT_TIMESTAMP,
            motivo_correccion = $6,
            version = version + 1
        WHERE id_registro = $7
        RETURNING *
      `, [
        correctedDate,
        correctedTime,
        classification.status,
        classification.severidad,
        req.user.id,
        reasonValidation.value,
        registrationId
      ]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'CORREGIR', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CORREGIR_REGISTRO_PUNTUALIDAD',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: { motivo: reasonValidation.value, antes: before, despues: after },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Registro corregido con trazabilidad.', registro: updatedResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:corregir]', error.message);
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe un ingreso activo para esa persona y fecha.' });
      res.status(500).json({ message: 'No fue posible corregir el registro.' });
    } finally {
      client.release();
    }
  });

  router.patch('/registros/:id/anular', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.motivo);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(
        'SELECT * FROM attendance_registrations WHERE id_registro = $1 AND anulado = false FOR UPDATE',
        [registrationId]
      );
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Registro activo no encontrado.' });
      }
      const target = targetResult.rows[0];
      if (target.tipo_registro !== 'Entrada' || !['Presente', 'Atrasado'].includes(target.estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Este registro no pertenece al control de puntualidad.' });
      }

      const before = registrationSnapshot(target);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET anulado = true,
            anulado_por = $1,
            anulado_en = CURRENT_TIMESTAMP,
            motivo_anulacion = $2,
            version = version + 1
        WHERE id_registro = $3
        RETURNING *
      `, [req.user.id, reasonValidation.value, registrationId]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'ANULAR', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ANULAR_REGISTRO_PUNTUALIDAD',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: { motivo: reasonValidation.value, antes: before, despues: after },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Registro anulado sin eliminar su historial.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:anular]', error.message);
      res.status(500).json({ message: 'No fue posible anular el registro.' });
    } finally {
      client.release();
    }
  });

  router.post('/registros/:id/justificar', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.comentario, { min: 5, max: 500 });
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(
        "SELECT * FROM attendance_registrations WHERE id_registro = $1 AND anulado = false AND estado = 'Atrasado' FOR UPDATE",
        [registrationId]
      );
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Atraso activo no encontrado.' });
      }

      const before = registrationSnapshot(targetResult.rows[0]);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET justificado = true,
            tipo_justificacion = 'apoderado',
            comentario_justificacion = $1,
            regularizado_por = $2,
            regularizado_en = CURRENT_TIMESTAMP,
            version = version + 1
        WHERE id_registro = $3
        RETURNING *
      `, [reasonValidation.value, req.user.id, registrationId]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'JUSTIFICAR', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'JUSTIFICAR_ATRASO',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: { comentario: reasonValidation.value, antes: before, despues: after },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Justificación de apoderado registrada.', registro: updatedResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:justificar]', error.message);
      res.status(500).json({ message: 'No fue posible justificar el atraso.' });
    } finally {
      client.release();
    }
  });

  router.patch('/registros/:id/revocar-justificacion', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.motivo);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(
        "SELECT * FROM attendance_registrations WHERE id_registro = $1 AND anulado = false AND estado = 'Atrasado' AND justificado = true FOR UPDATE",
        [registrationId]
      );
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Justificación activa no encontrada.' });
      }

      const before = registrationSnapshot(targetResult.rows[0]);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET justificado = false,
            tipo_justificacion = NULL,
            comentario_justificacion = NULL,
            regularizado_por = NULL,
            regularizado_en = NULL,
            version = version + 1
        WHERE id_registro = $1
        RETURNING *
      `, [registrationId]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'REVOCAR_JUSTIFICACION', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REVOCAR_JUSTIFICACION_ATRASO',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: { motivo: reasonValidation.value, antes: before, despues: after },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Justificación revocada con trazabilidad.', registro: updatedResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:revocar]', error.message);
      res.status(500).json({ message: 'No fue posible revocar la justificación.' });
    } finally {
      client.release();
    }
  });

  router.get('/registros/:id/historial', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    try {
      const result = await pool.query(`
        SELECT c.id, c.accion, c.motivo, c.antes, c.despues, c.realizado_en,
               c.realizado_por, u.nombre AS realizado_por_nombre, u.correo AS realizado_por_correo
        FROM puntualidad_correcciones c
        LEFT JOIN usuarios u ON u.id = c.realizado_por
        WHERE c.id_registro = $1
        ORDER BY c.realizado_en DESC, c.id DESC
      `, [registrationId]);
      res.json(result.rows);
    } catch (error) {
      console.error('[puntualidad/registros:historial]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el historial del registro.' });
    }
  });

  router.get('/analitica', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const { desde, hasta, id_curso: courseIdRaw, justificado, severidad } = req.query;
    const range = validateDateRange(desde, hasta);
    if (range.error) return res.status(400).json({ message: range.error });

    const params = [desde, hasta];
    const conditions = [`r.fecha BETWEEN $1 AND $2`, ACTIVE_ENTRY_FILTER];
    let index = 3;
    if (courseIdRaw) {
      const courseId = asBoundedInteger(courseIdRaw, 1, 2147483647);
      if (!courseId) return res.status(400).json({ message: 'El curso seleccionado no es válido.' });
      conditions.push(`m.id_curso = $${index++}`);
      params.push(courseId);
    }
    if (justificado !== undefined && justificado !== '') {
      if (!['true', 'false'].includes(String(justificado))) return res.status(400).json({ message: 'El filtro de justificación no es válido.' });
      conditions.push(`r.estado = 'Atrasado' AND r.justificado = $${index++}`);
      params.push(String(justificado) === 'true');
    }
    if (severidad) {
      if (!['Leve', 'Grave'].includes(severidad)) return res.status(400).json({ message: 'La severidad no es válida.' });
      conditions.push(`r.estado = 'Atrasado' AND r.severidad = $${index++}`);
      params.push(severidad);
    }
    const where = conditions.join(' AND ');

    try {
      const [metrics, daily, courses, slots, recurrent] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS ingresos,
            COUNT(*) FILTER (WHERE r.estado = 'Presente')::int AS a_tiempo,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Leve')::int AS leves,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.justificado = true)::int AS justificados,
            ROUND(AVG(
              CASE WHEN r.estado = 'Atrasado'
                THEN GREATEST(0, EXTRACT(EPOCH FROM (r.hora - cfg.hora_limite_atraso)) / 60)
              END
            )::numeric, 1) AS promedio_minutos_atraso
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
          CROSS JOIN LATERAL (SELECT hora_limite_atraso FROM configuracion_asistencia LIMIT 1) cfg
          WHERE ${where}
        `, params),
        pool.query(`
          SELECT r.fecha::text AS fecha,
                 COUNT(*)::int AS ingresos,
                 COUNT(*) FILTER (WHERE r.estado = 'Presente')::int AS a_tiempo,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
          WHERE ${where}
          GROUP BY r.fecha
          ORDER BY r.fecha
        `, params),
        pool.query(`
          SELECT COALESCE(c.nombre_curso, 'Sin curso') AS curso,
                 COUNT(*)::int AS ingresos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = m.id_curso
          WHERE ${where}
          GROUP BY c.nombre_curso
          ORDER BY atrasos DESC, ingresos DESC, curso
        `, params),
        pool.query(`
          SELECT CASE
                   WHEN delay_minutes <= 5 THEN '1 a 5 min'
                   WHEN delay_minutes <= 10 THEN '6 a 10 min'
                   WHEN delay_minutes <= 15 THEN '11 a 15 min'
                   WHEN delay_minutes <= 30 THEN '16 a 30 min'
                   ELSE 'Más de 30 min'
                 END AS tramo,
                 COUNT(*)::int AS atrasos
          FROM (
            SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (r.hora - cfg.hora_limite_atraso)) / 60)) AS delay_minutes
            FROM attendance_registrations r
            JOIN alumno a ON a.id_alumno = r.id_alumno
            LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
            CROSS JOIN LATERAL (SELECT hora_limite_atraso FROM configuracion_asistencia LIMIT 1) cfg
            WHERE ${where} AND r.estado = 'Atrasado'
          ) delays
          GROUP BY tramo
          ORDER BY MIN(delay_minutes)
        `, params),
        pool.query(`
          SELECT a.id_alumno, a.nombres, a.paterno, a.materno,
                 COALESCE(c.nombre_curso, 'Sin curso') AS curso,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = m.id_curso
          WHERE ${where}
          GROUP BY a.id_alumno, a.nombres, a.paterno, a.materno, c.nombre_curso
          HAVING COUNT(*) FILTER (WHERE r.estado = 'Atrasado') > 0
          ORDER BY atrasos DESC, graves DESC, a.paterno
          LIMIT 10
        `, params)
      ]);

      const summary = metrics.rows[0];
      const total = summary.ingresos || 0;
      const onTime = summary.a_tiempo || 0;
      res.json({
        resumen: {
          ...summary,
          puntualidad_registrada: total > 0 ? Number(((onTime / total) * 100).toFixed(1)) : null
        },
        por_dia: daily.rows.map((row) => ({
          ...row,
          puntualidad: row.ingresos > 0 ? Number(((row.a_tiempo / row.ingresos) * 100).toFixed(1)) : null
        })),
        por_curso: courses.rows.map((row) => ({
          ...row,
          tasa_atraso: row.ingresos > 0 ? Number(((row.atrasos / row.ingresos) * 100).toFixed(1)) : null
        })),
        por_tramo: slots.rows,
        recurrentes: recurrent.rows,
        periodo: range
      });
    } catch (error) {
      console.error('[puntualidad/analitica]', error.message);
      res.status(500).json({ message: 'No fue posible calcular la analítica de puntualidad.' });
    }
  });

  router.get('/reporte', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const { desde, hasta, curso_id: courseIdRaw, alumno_id: studentIdRaw, alumnos_ids: studentIdsRaw } = req.query;
    const range = validateDateRange(desde, hasta);
    if (range.error) return res.status(400).json({ message: range.error });

    const params = [desde, hasta];
    const conditions = [
      'r.fecha BETWEEN $1 AND $2',
      "r.tipo_registro = 'Entrada'",
      "r.estado = 'Atrasado'",
      'r.anulado = false'
    ];
    let index = 3;

    if (courseIdRaw) {
      const courseId = asBoundedInteger(courseIdRaw, 1, 2147483647);
      if (!courseId) return res.status(400).json({ message: 'El curso seleccionado no es válido.' });
      conditions.push(`m.id_curso = $${index++}`);
      params.push(courseId);
    }
    if (studentIdRaw) {
      const studentId = asBoundedInteger(studentIdRaw, 1, 2147483647);
      if (!studentId) return res.status(400).json({ message: 'El alumno seleccionado no es válido.' });
      conditions.push(`a.id_alumno = $${index++}`);
      params.push(studentId);
    }
    if (studentIdsRaw) {
      const ids = [...new Set(String(studentIdsRaw).split(',').map((value) => asBoundedInteger(value.trim(), 1, 2147483647)).filter(Boolean))];
      if (ids.length === 0 || ids.length > 200) return res.status(400).json({ message: 'La selección personalizada debe contener entre 1 y 200 alumnos.' });
      conditions.push(`a.id_alumno = ANY($${index++}::int[])`);
      params.push(ids);
    }

    try {
      const result = await pool.query(`
        SELECT r.id_registro, r.fecha::text AS fecha, TO_CHAR(r.hora, 'HH24:MI:SS') AS hora,
               r.severidad, r.justificado, r.comentario_justificacion, r.origen,
               a.id_alumno, a.rut, a.dv, a.nombres, a.paterno, a.materno,
               COALESCE(c.nombre_curso, 'Sin curso') AS curso,
               GREATEST(1, CEIL(EXTRACT(EPOCH FROM (r.hora - cfg.hora_limite_atraso)) / 60))::int AS minutos_atraso
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = m.id_curso
        CROSS JOIN LATERAL (SELECT hora_limite_atraso FROM configuracion_asistencia LIMIT 1) cfg
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.fecha, r.hora, c.nombre_curso, a.paterno, a.nombres
      `, params);
      res.json({ periodo: range, total: result.rows.length, registros: result.rows });
    } catch (error) {
      console.error('[puntualidad/reporte]', error.message);
      res.status(500).json({ message: 'No fue posible generar los datos del reporte.' });
    }
  });

  router.get('/alertas', verifyRole(['admin', 'secretaria']), async (req, res) => {
    const days = asBoundedInteger(req.query?.dias || 30, 7, 180);
    if (!days) return res.status(400).json({ message: 'El período de alertas debe estar entre 7 y 180 días.' });

    try {
      const result = await pool.query(`
        WITH cfg AS (
          SELECT umbral_alerta, umbral_critico FROM configuracion_asistencia LIMIT 1
        ), recent AS (
          SELECT r.id_alumno, r.fecha, r.estado, r.severidad
          FROM attendance_registrations r
          WHERE r.fecha >= CURRENT_DATE - ($1::int - 1)
            AND ${ACTIVE_ENTRY_FILTER}
        ), aggregates AS (
          SELECT a.id_alumno, a.nombres, a.paterno, a.materno,
                 COALESCE(c.nombre_curso, 'Sin curso') AS curso,
                 COUNT(*) FILTER (WHERE recent.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE recent.estado = 'Atrasado' AND recent.severidad = 'Grave')::int AS graves,
                 COUNT(*) FILTER (
                   WHERE recent.estado = 'Atrasado'
                     AND recent.fecha > COALESCE((
                       SELECT MAX(r2.fecha) FROM recent r2
                       WHERE r2.id_alumno = a.id_alumno AND r2.estado = 'Presente'
                     ), DATE '1900-01-01')
                 )::int AS racha_atrasos,
                 MAX(recent.fecha) FILTER (WHERE recent.estado = 'Atrasado')::text AS ultimo_atraso
          FROM alumno a
          JOIN recent ON recent.id_alumno = a.id_alumno
          LEFT JOIN matricula m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = m.id_curso
          WHERE a.activo = true
          GROUP BY a.id_alumno, a.nombres, a.paterno, a.materno, c.nombre_curso
        )
        SELECT aggregates.*,
               CASE
                 WHEN atrasos >= cfg.umbral_critico OR graves >= 3 THEN 'critica'
                 WHEN atrasos >= cfg.umbral_alerta OR racha_atrasos >= cfg.umbral_alerta THEN 'preventiva'
                 ELSE 'observacion'
               END AS nivel
        FROM aggregates
        CROSS JOIN cfg
        WHERE atrasos >= cfg.umbral_alerta OR graves >= 2 OR racha_atrasos >= cfg.umbral_alerta
        ORDER BY
          CASE WHEN atrasos >= cfg.umbral_critico OR graves >= 3 THEN 0 ELSE 1 END,
          atrasos DESC, graves DESC, paterno
      `, [days]);
      res.json({ dias: days, total: result.rows.length, alertas: result.rows });
    } catch (error) {
      console.error('[puntualidad/alertas]', error.message);
      res.status(500).json({ message: 'No fue posible calcular las alertas de atrasos.' });
    }
  });

  return router;
};

module.exports = { createPunctualityRouter, registrationSnapshot };
