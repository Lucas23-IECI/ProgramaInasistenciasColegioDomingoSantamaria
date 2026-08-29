const express = require('express');
const { protectStudentRecord } = require('../utils/studentPrivacy');

const parsePositiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const clean = (value, max = 500) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);

const createFamiliesRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}) => {
  const router = express.Router();
  router.use(verifyToken, verifyPermission('family.manage'));

  router.get('/', async (req, res) => {
    const search = clean(req.query.q, 120);
    try {
      const result = await pool.query(`
        SELECT v.id, v.tipo_documento, v.documento_numero, v.nombre_completo,
               v.telefono, v.email, v.telefono_emergencia, v.restricciones,
               COUNT(pa.id)::int AS estudiantes_vinculados,
               COUNT(pa.id) FILTER (
                 WHERE pa.activo = true
                   AND pa.vigente_desde <= CURRENT_DATE
                   AND (pa.vigente_hasta IS NULL OR pa.vigente_hasta >= CURRENT_DATE)
               )::int AS vinculos_vigentes
        FROM visitantes v
        JOIN personas_autorizadas_retiro pa ON pa.visitante_id = v.id
        WHERE ($1 = '' OR v.nombre_completo ILIKE '%' || $1 || '%'
          OR v.documento_numero ILIKE '%' || regexp_replace($1, '[^0-9Kk]', '', 'g') || '%')
        GROUP BY v.id
        ORDER BY v.nombre_completo
        LIMIT 100
      `, [search]);
      res.json(result.rows);
    } catch (error) {
      console.error('[familias:listado]', error.message);
      res.status(500).json({ message: 'No fue posible consultar las fichas familiares.' });
    }
  });

  router.get('/:visitorId', async (req, res) => {
    const visitorId = parsePositiveId(req.params.visitorId);
    if (!visitorId) return res.status(400).json({ message: 'La ficha familiar seleccionada no es válida. Vuelve al listado y ábrela nuevamente.' });
    try {
      const [visitor, links] = await Promise.all([
        pool.query(`
          SELECT id, tipo_documento, documento_numero, nombre_completo, telefono, email,
                 telefono_emergencia, restricciones, observaciones_familiares, activo,
                 creado_en, actualizado_en
          FROM visitantes WHERE id = $1
        `, [visitorId]),
        pool.query(`
          SELECT pa.id, pa.id_alumno, pa.parentesco_codigo, tp.nombre AS parentesco_nombre,
                 pa.parentesco_detalle, pa.tipo_responsabilidad, pa.es_principal,
                 pa.origen_autorizacion, pa.vigente_desde, pa.vigente_hasta, pa.activo,
                 pa.telefono_emergencia, pa.restricciones, pa.observaciones,
                 CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante,
                 a.rut, a.dv, a.documento_erp, a.uuid_erp, c.nombre_curso,
                 COALESCE((
                   SELECT json_agg(json_build_object(
                     'accion', e.accion, 'antes', e.antes, 'despues', e.despues,
                     'motivo', e.motivo, 'realizado_en', e.realizado_en,
                     'realizado_por', u.nombre
                   ) ORDER BY e.realizado_en DESC)
                   FROM autorizacion_retiro_eventos e
                   LEFT JOIN usuarios u ON u.id = e.realizado_por
                   WHERE e.autorizacion_id = pa.id
                 ), '[]'::json) AS historial
          FROM personas_autorizadas_retiro pa
          JOIN alumno a ON a.id_alumno = pa.id_alumno
          LEFT JOIN matricula_actual ma ON ma.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = ma.id_curso
          LEFT JOIN tipos_parentesco tp ON tp.codigo = pa.parentesco_codigo
          WHERE pa.visitante_id = $1
          ORDER BY pa.activo DESC, pa.es_principal DESC, a.paterno, a.nombres
        `, [visitorId])
      ]);
      if (!visitor.rowCount) return res.status(404).json({ message: 'La ficha no existe.' });
      res.json({
        person: visitor.rows[0],
        students: links.rows.map((student) => protectStudentRecord(student))
      });
    } catch (error) {
      console.error('[familias:detalle]', error.message);
      res.status(500).json({ message: 'No fue posible cargar la ficha familiar.' });
    }
  });

  router.put('/:visitorId', async (req, res) => {
    const visitorId = parsePositiveId(req.params.visitorId);
    if (!visitorId || clean(req.body?.nombre_completo, 160).length < 3) {
      return res.status(400).json({ message: 'Indica una persona válida.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM visitantes WHERE id = $1 FOR UPDATE', [visitorId]);
      if (!before.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La ficha no existe.' });
      }
      const result = await client.query(`
        UPDATE visitantes
        SET nombre_completo = $1, telefono = $2, email = $3, telefono_emergencia = $4,
            restricciones = $5, observaciones_familiares = $6,
            actualizado_por = $7, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING *
      `, [
        clean(req.body.nombre_completo, 160),
        clean(req.body.telefono, 40) || null,
        clean(req.body.email, 160).toLowerCase() || null,
        clean(req.body.telefono_emergencia, 40) || null,
        clean(req.body.restricciones, 1000) || null,
        clean(req.body.observaciones_familiares, 1000) || null,
        req.user.id,
        visitorId
      ]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ACTUALIZAR_FICHA_FAMILIAR',
        entidad: 'visitante',
        entidad_id: visitorId,
        detalle: { antes: before.rows[0], despues: result.rows[0] },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[familias:actualizar]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar la ficha.' });
    } finally {
      client.release();
    }
  });

  router.patch('/vinculos/:linkId', async (req, res) => {
    const linkId = parsePositiveId(req.params.linkId);
    const reason = clean(req.body?.motivo_cambio, 500);
    if (!linkId || reason.length < 5) {
      return res.status(400).json({ message: 'Indica el motivo del cambio (mínimo 5 caracteres).' });
    }
    const responsibility = clean(req.body?.tipo_responsabilidad, 30).toUpperCase();
    if (!['PRINCIPAL', 'SUPLENTE', 'AUTORIZADO'].includes(responsibility)) {
      return res.status(400).json({ message: 'Selecciona una responsabilidad válida: principal, suplente o persona autorizada.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM personas_autorizadas_retiro WHERE id = $1 FOR UPDATE', [linkId]);
      if (!before.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El vínculo no existe.' });
      }
      const active = req.body.activo !== false;
      const result = await client.query(`
        UPDATE personas_autorizadas_retiro
        SET parentesco_codigo = $1, parentesco_detalle = $2, tipo_responsabilidad = $3,
            es_principal = $4, vigente_desde = $5, vigente_hasta = $6, activo = $7,
            telefono_emergencia = $8, restricciones = $9, observaciones = $10,
            actualizado_por = $11, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $12
        RETURNING *
      `, [
        clean(req.body.parentesco_codigo, 40).toUpperCase(),
        clean(req.body.parentesco_detalle, 120) || null,
        responsibility,
        responsibility === 'PRINCIPAL',
        req.body.vigente_desde || before.rows[0].vigente_desde,
        req.body.vigente_hasta || null,
        active,
        clean(req.body.telefono_emergencia, 40) || null,
        clean(req.body.restricciones, 1000) || null,
        clean(req.body.observaciones, 1000) || null,
        req.user.id,
        linkId
      ]);
      const action = active
        ? (before.rows[0].activo ? 'ACTUALIZAR' : 'REACTIVAR')
        : 'DESACTIVAR';
      await client.query(`
        INSERT INTO autorizacion_retiro_eventos (
          autorizacion_id, accion, antes, despues, motivo, realizado_por
        ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
      `, [linkId, action, JSON.stringify(before.rows[0]), JSON.stringify(result.rows[0]), reason, req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: `${action}_VINCULO_FAMILIAR`,
        entidad: 'persona_autorizada_retiro',
        entidad_id: linkId,
        detalle: { motivo: reason },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[familias:vinculo]', error.message);
      res.status(error.code === '23503' ? 400 : 500).json({
        message: error.code === '23503' ? 'El parentesco seleccionado no existe.' : 'No fue posible actualizar el vínculo.'
      });
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = { createFamiliesRouter };
