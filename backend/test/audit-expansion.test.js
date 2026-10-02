const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  AUDIT_CATEGORIES,
  auditCategorySql,
  buildAuditSummary,
  registerAuditRoutes
} = require('../routes/audit');

const startApp = async () => {
  const calls = [];
  const audits = [];
  const pool = {
    query: async (sql, params = []) => {
      const source = String(sql);
      calls.push({ sql: source, params });
      if (source.includes('SELECT COUNT(*) FROM audit_log')) return { rows: [{ count: '1' }] };
      if (source.includes('COUNT(*) FILTER')) return { rows: [{ acceso: 2, consulta: 3, cambio: 4, descarga: 5 }] };
      if (source.includes('SELECT DISTINCT accion')) return { rows: [{ accion: 'CONSULTAR_AUDITORIA' }, { accion: 'DESCARGAR_AUDITORIA' }] };
      if (source.includes('SELECT DISTINCT entidad')) return { rows: [{ entidad: 'audit_log' }, { entidad: 'documento_expediente' }] };
      if (source.includes('FROM audit_log a') && source.includes('LEFT JOIN usuarios')) return {
        rows: [{
          id: 15,
          usuario_id: 7,
          usuario_correo: 'persona@colegio.local',
          usuario_nombre: 'Persona de Prueba',
          accion: 'DOCUMENTO_ESTUDIANTE_DESCARGADO',
          categoria: 'DESCARGA',
          entidad: 'documento_expediente',
          entidad_id: 9,
          detalle: { version_id: 22 },
          ip: '127.0.0.1',
          fecha: '2026-08-30T12:00:00.000Z'
        }]
      };
      throw new Error(`Consulta inesperada: ${source.slice(0, 80)}`);
    }
  };

  const app = express();
  registerAuditRoutes({
    app,
    pool,
    verifyToken: (req, _res, next) => {
      req.user = { id: 7, correo: 'persona@colegio.local' };
      next();
    },
    verifyPermission: () => (_req, _res, next) => next(),
    isIsoDate: (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value),
    validateDateRange: () => ({}),
    insertarAudit: async (_queryable, entry) => { audits.push(entry); },
    getClientIp: () => '127.0.0.1'
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/audit`,
    calls,
    audits,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test('clasifica accesos, consultas, cambios y descargas con una regla común', () => {
  assert.deepEqual(AUDIT_CATEGORIES, ['ACCESO', 'CONSULTA', 'CAMBIO', 'DESCARGA']);
  assert.match(auditCategorySql('registro'), /registro\.accion/u);
  assert.match(auditCategorySql(), /DESCARG|EXPORTAR/u);
  assert.deepEqual(buildAuditSummary({ acceso: '2', consulta: 3, cambio: null, descarga: 5 }), {
    acceso: 2, consulta: 3, cambio: 0, descarga: 5
  });
});

test('entrega catálogos reales, resumen y categoría sin filtrar datos de la búsqueda al evento', async (t) => {
  const application = await startApp();
  t.after(application.close);
  const privateEmail = 'cuenta-filtrada@colegio.local';
  const response = await fetch(`${application.url}?categoria=DESCARGA&entidad=documento_expediente&usuario_correo=${encodeURIComponent(privateEmail)}&desde=2026-08-01&hasta=2026-08-30`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rows[0].categoria, 'DESCARGA');
  assert.deepEqual(body.summary, { acceso: 2, consulta: 3, cambio: 4, descarga: 5 });
  assert.deepEqual(body.catalogs.categories, AUDIT_CATEGORIES);
  assert.deepEqual(body.catalogs.entities, ['audit_log', 'documento_expediente']);
  assert.equal(application.audits[0].accion, 'CONSULTAR_AUDITORIA');
  assert.equal(application.audits[0].detalle.filtros.usuario, true);
  assert.equal(JSON.stringify(application.audits[0]).includes(privateEmail), false);
  assert.ok(application.calls.some((call) => call.sql.includes("= $1") && call.params.includes('DESCARGA')));
});

test('rechaza categorías desconocidas y distingue una exportación', async (t) => {
  const application = await startApp();
  t.after(application.close);
  const invalid = await fetch(`${application.url}?categoria=CODIGO_INTERNO`);
  assert.equal(invalid.status, 400);

  const exported = await fetch(`${application.url}?exportar=1`);
  assert.equal(exported.status, 200);
  assert.equal(application.audits.at(-1).accion, 'DESCARGAR_AUDITORIA');
});
