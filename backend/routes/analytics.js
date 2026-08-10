const express = require('express');
const { buildInstitutionalAnalytics } = require('../services/institutionalAnalyticsService');
const { buildInstitutionalWorkbook, streamInstitutionalPdf } = require('../services/institutionalReportService');

const createAnalyticsRouter = ({ pool, verifyToken, verifyPermission, insertarAudit, getClientIp }) => {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/institucional', verifyPermission('analytics.institutional.view'), async (req, res) => {
    try {
      res.json(await buildInstitutionalAnalytics(pool, { from: req.query.desde, to: req.query.hasta }));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible calcular la analítica institucional.' });
    }
  });

  router.get('/institucional/exportar', verifyPermission('analytics.institutional.export'), async (req, res) => {
    try {
      const analytics = await buildInstitutionalAnalytics(pool, { from: req.query.desde, to: req.query.hasta });
      const format = String(req.query.formato || 'pdf').toLowerCase();
      await insertarAudit(pool, {
        usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'EXPORTAR_ANALITICA_INSTITUCIONAL',
        entidad: 'analitica_institucional', detalle: { periodo: analytics.periodo, formato: format }, ip: getClientIp(req)
      });
      if (format === 'xlsx') {
        const buffer = await buildInstitutionalWorkbook(analytics);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="analitica-institucional-${analytics.periodo.from}-${analytics.periodo.to}.xlsx"`);
        return res.send(buffer);
      }
      return streamInstitutionalPdf(res, analytics);
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

  return router;
};

module.exports = { createAnalyticsRouter };
