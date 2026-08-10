const { buildInstitutionalAnalytics } = require('./institutionalAnalyticsService');

const iso = (date) => date.toISOString().slice(0, 10);
const previousPeriod = (frequency, now = new Date()) => {
  if (frequency === 'MENSUAL') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { from: iso(from), to: iso(to) };
  }
  const end = new Date(now); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
  return { from: iso(start), to: iso(end) };
};

const runDueInstitutionalReports = async (pool, now = new Date()) => {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('ldsm_reportes_institucionales')) AS adquirido");
    acquired = Boolean(lock.rows[0]?.adquirido);
    if (!acquired) return 0;

    const local = await client.query(`SELECT CURRENT_DATE AS fecha, LOCALTIME AS hora, EXTRACT(ISODOW FROM CURRENT_DATE)::int AS dia_semana, EXTRACT(DAY FROM CURRENT_DATE)::int AS dia_mes`);
    const clock = local.rows[0];
    const due = await client.query(`
      SELECT * FROM reportes_institucionales_programados
      WHERE activo = true AND hora <= $1::time
        AND ((frecuencia='SEMANAL' AND dia_semana=$2) OR (frecuencia='MENSUAL' AND dia_mes=$3))
        AND (ultima_ejecucion IS NULL OR ultima_ejecucion::date < $4::date)
    `, [clock.hora, clock.dia_semana, clock.dia_mes, clock.fecha]);
    for (const report of due.rows) {
      const period = previousPeriod(report.frecuencia, now);
      try {
        const analytics = await buildInstitutionalAnalytics(client, period);
        await client.query('BEGIN');
        await client.query(`
          INSERT INTO reportes_institucionales_ejecuciones
            (id_reporte,nombre_reporte,frecuencia,formato,periodo_desde,periodo_hasta,resumen,generado_por)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [report.id_reporte, report.nombre, report.frecuencia, report.formato, period.from, period.to, JSON.stringify(analytics), report.actualizado_por || report.creado_por]);
        await client.query('UPDATE reportes_institucionales_programados SET ultima_ejecucion=CURRENT_TIMESTAMP, actualizado_en=CURRENT_TIMESTAMP WHERE id_reporte=$1', [report.id_reporte]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        await client.query(`INSERT INTO reportes_institucionales_ejecuciones (id_reporte,nombre_reporte,frecuencia,formato,periodo_desde,periodo_hasta,estado,error) VALUES ($1,$2,$3,$4,$5,$6,'ERROR',$7)`, [report.id_reporte, report.nombre, report.frecuencia, report.formato, period.from, period.to, error.message]);
      }
    }
    return due.rowCount;
  } finally {
    if (acquired) await client.query("SELECT pg_advisory_unlock(hashtext('ldsm_reportes_institucionales'))").catch(() => {});
    client.release();
  }
};

const startInstitutionalReportScheduler = (pool, logger = console) => {
  const execute = () => runDueInstitutionalReports(pool).catch((error) => logger.error(`[REPORTES] Error ejecutando programaciones: ${error.message}`));
  execute();
  const timer = setInterval(execute, 15 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
};

module.exports = { previousPeriod, runDueInstitutionalReports, startInstitutionalReportScheduler };
