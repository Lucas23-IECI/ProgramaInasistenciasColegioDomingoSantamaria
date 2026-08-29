const express = require('express');
const { buildInstitutionalAnalytics } = require('../services/institutionalAnalyticsService');
const { buildInstitutionalWorkbook, streamInstitutionalPdf } = require('../services/institutionalReportService');
const { buildReportArtifact, publicReportError } = require('../services/institutionalReportExecutionService');
const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);

const createAnalyticsRouter = ({ pool, verifyToken, verifyPermission, insertarAudit, getClientIp }) => {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/institucional', verifyPermission('analytics.institutional.view'), async (req, res) => {
    try {
      res.json(await buildInstitutionalAnalytics(pool, {
        from: req.query.desde,
        to: req.query.hasta,
        courseId: req.query.id_curso,
        justified: req.query.justificado,
        severity: req.query.severidad
      }));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible calcular la analítica institucional.' });
    }
  });

  router.get('/institucional/exportar', verifyPermission('analytics.institutional.export'), async (req, res) => {
    try {
      const analytics = await buildInstitutionalAnalytics(pool, {
        from: req.query.desde,
        to: req.query.hasta,
        courseId: req.query.id_curso,
        justified: req.query.justificado,
        severity: req.query.severidad
      });
      const format = String(req.query.formato || 'pdf').toLowerCase();
      await insertarAudit(pool, {
        usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'EXPORTAR_ANALITICA_INSTITUCIONAL',
        entidad: 'analitica_institucional', detalle: { periodo: analytics.periodo, filtros: analytics.filtros, formato: format }, ip: getClientIp(req)
      });
      if (format === 'xlsx') {
        const buffer = await buildInstitutionalWorkbook(analytics);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="analitica-institucional-${analytics.periodo.from}-${analytics.periodo.to}.xlsx"`);
        return res.send(buffer);
      }
      return await streamInstitutionalPdf(res, analytics);
    } catch (error) {
      if (!res.headersSent) res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible exportar el reporte.' });
    }
  });

  router.get('/programaciones', verifyPermission('analytics.schedules.manage'), async (_req, res) => {
    const result = await pool.query('SELECT * FROM reportes_institucionales_programados ORDER BY activo DESC, nombre');
    res.json(result.rows);
  });

  router.post('/programaciones', verifyPermission('analytics.schedules.manage'), async (req, res) => {
    const frequency = String(req.body?.frecuencia || '').toUpperCase();
    const format = String(req.body?.formato || 'PDF').toUpperCase();
    const name = String(req.body?.nombre || '').trim().slice(0, 120);
    if (!name || !['SEMANAL', 'MENSUAL'].includes(frequency) || !['PDF', 'XLSX'].includes(format)) {
      return res.status(400).json({ message: 'Completa una programación semanal o mensual válida.' });
    }
    const dayWeek = frequency === 'SEMANAL' ? Math.min(7, Math.max(1, Number(req.body?.dia_semana) || 1)) : null;
    const dayMonth = frequency === 'MENSUAL' ? Math.min(28, Math.max(1, Number(req.body?.dia_mes) || 1)) : null;
    const result = await pool.query(`
      INSERT INTO reportes_institucionales_programados
        (nombre, frecuencia, formato, dia_semana, dia_mes, hora, creado_por, actualizado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *
    `, [name, frequency, format, dayWeek, dayMonth, req.body?.hora || '07:00', req.user.id]);
    await insertarAudit(pool, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'CREAR_PROGRAMACION_ANALITICA', entidad: 'reporte_programado', entidad_id: result.rows[0].id_reporte, detalle: result.rows[0], ip: getClientIp(req) });
    res.status(201).json(result.rows[0]);
  });

  router.patch('/programaciones/:id/estado', verifyPermission('analytics.schedules.manage'), async (req, res) => {
    const result = await pool.query(`UPDATE reportes_institucionales_programados SET activo=$2, actualizado_por=$3, actualizado_en=CURRENT_TIMESTAMP WHERE id_reporte=$1 RETURNING *`, [req.params.id, Boolean(req.body?.activo), req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Programación no encontrada.' });
    await insertarAudit(pool, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: result.rows[0].activo ? 'REACTIVAR_PROGRAMACION_ANALITICA' : 'DESACTIVAR_PROGRAMACION_ANALITICA', entidad: 'reporte_programado', entidad_id: result.rows[0].id_reporte, ip: getClientIp(req) });
    res.json(result.rows[0]);
  });

  router.get('/programaciones/ejecuciones', verifyPermission('analytics.schedules.manage'), async (req, res) => {
    const page = Math.max(1, Math.min(100000, Number(req.query.pagina) || 1));
    const limit = Math.max(5, Math.min(50, Number(req.query.limite) || 10));
    const reportId = req.query.id_reporte ? Number(req.query.id_reporte) : null;
    if (reportId !== null && (!Number.isInteger(reportId) || reportId <= 0)) return res.status(400).json({ message: 'La programación seleccionada no es válida.' });
    try {
      const params = [reportId, limit, (page - 1) * limit];
      const result = await pool.query(`
        SELECT e.id_ejecucion, e.id_reporte, e.nombre_reporte, e.frecuencia, e.formato,
               e.periodo_desde::text, e.periodo_hasta::text, e.estado, e.error_publico,
               e.archivo_nombre, octet_length(e.archivo_bytes)::int AS archivo_bytes,
               e.reintento_de, e.generado_en,
               COUNT(*) OVER()::int AS total
        FROM reportes_institucionales_ejecuciones e
        WHERE ($1::int IS NULL OR e.id_reporte = $1)
        ORDER BY e.generado_en DESC, e.id_ejecucion DESC
        LIMIT $2 OFFSET $3
      `, params);
      const total = result.rows[0]?.total || 0;
      res.json({
        items: result.rows.map(({ total: _total, ...item }) => item),
        pagina: page,
        limite: limit,
        total,
        paginas: Math.max(1, Math.ceil(total / limit))
      });
    } catch (error) {
      console.error('[analitica:historial-reportes]', error.message);
      res.status(500).json({ message: 'No fue posible cargar el historial de reportes.' });
    }
  });

  router.get('/programaciones/ejecuciones/:id/descargar', verifyPermission('analytics.schedules.manage'), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT archivo_nombre, archivo_mime, archivo_bytes
        FROM reportes_institucionales_ejecuciones
        WHERE id_ejecucion = $1 AND estado = 'GENERADO'
      `, [req.params.id]);
      const execution = result.rows[0];
      if (!execution?.archivo_bytes) return res.status(404).json({ message: 'El archivo de esta ejecución no está disponible.' });
      res.setHeader('Content-Type', execution.archivo_mime || 'application/octet-stream');
      res.setHeader('Content-Length', String(execution.archivo_bytes.length));
      res.setHeader('Content-Disposition', `attachment; filename="${execution.archivo_nombre || 'reporte-institucional'}"`);
      res.end(execution.archivo_bytes);
    } catch (error) {
      console.error('[analitica:descargar-ejecucion]', error.message);
      if (!res.headersSent) res.status(500).json({ message: 'No fue posible descargar el archivo del reporte.' });
    }
  });

  router.post('/programaciones/ejecuciones/:id/reintentar', verifyPermission('analytics.schedules.manage'), async (req, res) => {
    const client = await pool.connect();
    let source = null;
    try {
      const sourceResult = await client.query(`
        SELECT * FROM reportes_institucionales_ejecuciones
        WHERE id_ejecucion = $1 AND estado = 'ERROR'
      `, [req.params.id]);
      source = sourceResult.rows[0];
      if (!source) return res.status(404).json({ message: 'La ejecución fallida ya no está disponible para reintento.' });
      const analytics = await buildInstitutionalAnalytics(client, { from: dateOnly(source.periodo_desde), to: dateOnly(source.periodo_hasta) });
      const artifact = await buildReportArtifact(analytics, source.formato, source.nombre_reporte);
      await client.query('BEGIN');
      const created = await client.query(`
        INSERT INTO reportes_institucionales_ejecuciones
          (id_reporte,nombre_reporte,frecuencia,formato,periodo_desde,periodo_hasta,resumen,generado_por,
           archivo_nombre,archivo_mime,archivo_bytes,reintento_de)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id_ejecucion, estado, archivo_nombre, generado_en
      `, [source.id_reporte, source.nombre_reporte, source.frecuencia, source.formato,
        source.periodo_desde, source.periodo_hasta, JSON.stringify(analytics), req.user.id,
        artifact.fileName, artifact.mime, artifact.buffer, source.id_ejecucion]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'REINTENTAR_REPORTE_INSTITUCIONAL', entidad: 'reporte_ejecucion', entidad_id: created.rows[0].id_ejecucion, detalle: { reintento_de: source.id_ejecucion }, ip: getClientIp(req) });
      await client.query('COMMIT');
      res.status(201).json(created.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[analitica:reintentar-ejecucion]', error.message);
      if (source) {
        await client.query(`
          INSERT INTO reportes_institucionales_ejecuciones
            (id_reporte,nombre_reporte,frecuencia,formato,periodo_desde,periodo_hasta,estado,error_publico,generado_por,reintento_de)
          VALUES ($1,$2,$3,$4,$5,$6,'ERROR',$7,$8,$9)
        `, [source.id_reporte, source.nombre_reporte, source.frecuencia, source.formato,
          source.periodo_desde, source.periodo_hasta, publicReportError(error), req.user.id, source.id_ejecucion]).catch(() => {});
      }
      res.status(error.status || 500).json({ message: error.status ? error.message : publicReportError(error) });
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = { createAnalyticsRouter };
