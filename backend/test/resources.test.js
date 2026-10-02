const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const { createResourcesRouter, lockAvailableResource, isoDate, pageData } = require('../routes/resources');

const startApp = async ({ pool, permissions = ['resources.view', 'resources.request', 'resources.manage'], audits = [], realtime = [] }) => {
  const app = express();
  app.use(express.json());
  app.use('/api/recursos', createResourcesRouter({
    pool,
    verifyToken: (req, _res, next) => {
      req.user = { id: 7, correo: 'equipo@ldsm.local', nombre: 'Equipo', rol: 'personalizado', permissions };
      next();
    },
    verifyPermission: (permission) => (req, res, next) => req.user.permissions.includes(permission)
      ? next()
      : res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' }),
    insertarAudit: async (_queryable, entry) => audits.push(entry),
    getClientIp: () => '127.0.0.1',
    realtimeHub: { publishToUsers: (...args) => realtime.push(args) }
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/recursos`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test('la migración de recursos es aditiva, trazable y no amplía Portería', async () => {
  const migration = await fs.readFile(path.join(__dirname, '..', 'migrations', '052_recursos_internos.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS recursos_inventario/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS recursos_prestamos/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS recursos_solicitudes/u);
  assert.match(migration, /resources\.view/u);
  assert.match(migration, /resources\.request/u);
  assert.match(migration, /resources\.manage/u);
  assert.doesNotMatch(migration, /\('lector', 'resources\./u);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/u);
});

test('las fechas y la paginación rechazan entradas ambiguas', () => {
  assert.equal(isoDate('2026-09-15'), '2026-09-15');
  assert.equal(isoDate('2026-02-30'), null);
  assert.equal(isoDate('15-09-2026'), null);
  assert.deepEqual(pageData({ pagina: '2', limite: '500' }), { page: 2, limit: 20 });
  assert.deepEqual(pageData({ pagina: '2', limite: '80' }), { page: 2, limit: 80 });
});

test('los avisos deduplicados declaran el predicado del índice parcial de PostgreSQL', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'routes', 'resources.js'), 'utf8');
  assert.match(source, /ON CONFLICT \(usuario_id, clave_dedupe\) WHERE clave_dedupe IS NOT NULL DO NOTHING/u);
});

test('la disponibilidad se calcula bajo bloqueo y nunca permite stock negativo', async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(query);
      if (query.startsWith('SELECT * FROM recursos_inventario')) return { rowCount: 1, rows: [{ id_recurso: 3, estado: 'ACTIVO', stock_total: 2 }] };
      if (query.startsWith('SELECT COALESCE(SUM(cantidad)')) return { rowCount: 1, rows: [{ cantidad: 1 }] };
      throw new Error(`Consulta inesperada: ${query}`);
    }
  };
  await assert.rejects(() => lockAvailableResource(client, 3, 2), /Solo hay 1 unidad disponible/u);
  assert.match(queries[0], /FOR UPDATE/u);
});

test('una solicitud propia valida el recurso, audita y no crea un préstamo anticipado', async (t) => {
  const calls = [];
  const audits = [];
  const realtime = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT nombre, stock_total FROM recursos_inventario')) return { rowCount: 1, rows: [{ nombre: 'Proyector', stock_total: 4 }] };
      if (query.startsWith('INSERT INTO recursos_solicitudes')) return { rowCount: 1, rows: [{ id_solicitud: 17 }] };
      if (query.startsWith('SELECT u.id FROM usuarios')) return { rowCount: 1, rows: [{ id: 21 }] };
      if (query.startsWith('INSERT INTO notificaciones_internas')) return { rowCount: 1, rows: [{ id_notificacion: 31, usuario_id: 21, creada_en: '2026-08-30T12:00:00Z' }] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => calls.push({ query: 'RELEASE', params: [] })
  };
  const application = await startApp({ pool: { connect: async () => client }, permissions: ['resources.view', 'resources.request'], audits, realtime });
  t.after(application.close);
  const response = await fetch(`${application.baseUrl}/solicitudes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_recurso: 3, cantidad: 2, motivo: 'Actividad pedagógica del martes', necesita_en: '2026-09-15' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id_solicitud, 17);
  assert.equal(calls.some(({ query }) => query.includes('INSERT INTO recursos_prestamos')), false);
  assert.equal(calls.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(audits[0].accion, 'CREAR_SOLICITUD_RECURSO');
  assert.equal(realtime.length, 1);
  assert.equal(realtime[0][0][0], 21);
});

test('si la auditoría falla, una solicitud nueva se revierte y nunca queda huérfana', async (t) => {
  const statements = [];
  const client = {
    query: async (sql) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push(query);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT nombre, stock_total FROM recursos_inventario')) return { rowCount: 1, rows: [{ nombre: 'Proyector', stock_total: 2 }] };
      if (query.startsWith('INSERT INTO recursos_solicitudes')) return { rowCount: 1, rows: [{ id_solicitud: 18 }] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push('RELEASE')
  };
  const application = await startApp({
    pool: { connect: async () => client },
    permissions: ['resources.view', 'resources.request'],
    audits: { push: () => { throw new Error('auditoría no disponible'); } }
  });
  t.after(application.close);
  const response = await fetch(`${application.baseUrl}/solicitudes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_recurso: 3, cantidad: 1, motivo: 'Actividad interna del miércoles' })
  });
  assert.equal(response.status, 500);
  assert.equal(statements.includes('ROLLBACK'), true);
  assert.equal(statements.includes('COMMIT'), false);
});

test('entregar una solicitud bloquea stock y confirma préstamo, vínculo y auditoría en una transacción', async (t) => {
  const statements = [];
  const audits = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT * FROM recursos_solicitudes')) return { rowCount: 1, rows: [{ id_solicitud: 17, id_recurso: 3, solicitante_id: 12, cantidad: 1 }] };
      if (query.startsWith('SELECT * FROM recursos_inventario')) return { rowCount: 1, rows: [{ id_recurso: 3, nombre: 'Proyector', estado: 'ACTIVO', stock_total: 2 }] };
      if (query.startsWith('SELECT COALESCE(SUM(cantidad)')) return { rowCount: 1, rows: [{ cantidad: 1 }] };
      if (query.startsWith('INSERT INTO recursos_prestamos')) return { rowCount: 1, rows: [{ id_prestamo: 29 }] };
      if (query.startsWith('UPDATE recursos_solicitudes')) return { rowCount: 1, rows: [] };
      if (query.startsWith('INSERT INTO notificaciones_internas')) return { rowCount: 1, rows: [{ id_notificacion: 32, usuario_id: 12, creada_en: '2026-08-30T12:00:00Z' }] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push({ query: 'RELEASE', params: [] })
  };
  const application = await startApp({ pool: { connect: async () => client }, audits });
  t.after(application.close);
  const response = await fetch(`${application.baseUrl}/solicitudes/17/entregar`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({})
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id_prestamo, 29);
  assert.equal(statements.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(statements.some(({ query }) => query === 'ROLLBACK'), false);
  assert.equal(audits[0].accion, 'ENTREGAR_SOLICITUD_RECURSO');
});

test('un préstamo directo confirma auditoría y aviso solamente después de persistirlo', async (t) => {
  const statements = [];
  const audits = [];
  const realtime = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT * FROM recursos_inventario')) return { rowCount: 1, rows: [{ id_recurso: 3, nombre: 'Proyector', estado: 'ACTIVO', stock_total: 2 }] };
      if (query.startsWith('SELECT COALESCE(SUM(cantidad)')) return { rowCount: 1, rows: [{ cantidad: 0 }] };
      if (query.startsWith('SELECT id FROM usuarios')) return { rowCount: 1, rows: [{ id: 12 }] };
      if (query.startsWith('INSERT INTO recursos_prestamos')) return { rowCount: 1, rows: [{ id_prestamo: 33 }] };
      if (query.startsWith('INSERT INTO notificaciones_internas')) return { rowCount: 1, rows: [{ id_notificacion: 34, usuario_id: 12, creada_en: '2026-08-30T12:00:00Z' }] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push({ query: 'RELEASE', params: [] })
  };
  const application = await startApp({ pool: { connect: async () => client }, audits, realtime });
  t.after(application.close);
  const response = await fetch(`${application.baseUrl}/prestamos`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_recurso: 3, usuario_id: 12, cantidad: 1 })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id_prestamo, 33);
  assert.equal(statements.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(statements.some(({ query }) => query === 'ROLLBACK'), false);
  assert.equal(audits[0].accion, 'ENTREGAR_RECURSO_INTERNO');
  assert.equal(realtime.length, 1);
  assert.equal(realtime[0][0][0], 12);
});

test('una devolución libera stock y avisa a la persona dentro del mismo flujo auditado', async (t) => {
  const statements = [];
  const audits = [];
  const realtime = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('UPDATE recursos_prestamos')) return { rowCount: 1, rows: [{ id_recurso: 3, usuario_id: 12, cantidad: 1 }] };
      if (query.startsWith('INSERT INTO notificaciones_internas')) return { rowCount: 1, rows: [{ id_notificacion: 35, usuario_id: 12, creada_en: '2026-08-30T12:00:00Z' }] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push({ query: 'RELEASE', params: [] })
  };
  const application = await startApp({ pool: { connect: async () => client }, audits, realtime });
  t.after(application.close);
  const response = await fetch(`${application.baseUrl}/prestamos/33/devolver`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ condicion_devolucion: 'Sin daños visibles' })
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /stock volvió a estar disponible/u);
  assert.equal(statements.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(audits[0].accion, 'DEVOLVER_RECURSO_INTERNO');
  assert.equal(realtime.length, 1);
  assert.equal(realtime[0][0][0], 12);
});

test('aprobar una solicitud conserva la entrega pendiente y notifica a quien la pidió', async (t) => {
  const statements = [];
  const audits = [];
  const realtime = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('UPDATE recursos_solicitudes s SET')) return { rowCount: 1, rows: [{ solicitante_id: 12, id_recurso: 3, recurso_nombre: 'Proyector' }] };
      if (query.startsWith('INSERT INTO notificaciones_internas')) return { rowCount: 1, rows: [{ id_notificacion: 36, usuario_id: 12, creada_en: '2026-08-30T12:00:00Z' }] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push({ query: 'RELEASE', params: [] })
  };
  const application = await startApp({ pool: { connect: async () => client }, audits, realtime });
  t.after(application.close);
  const response = await fetch(`${application.baseUrl}/solicitudes/17/decision`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado: 'APROBADA', respuesta: 'Retirar en Secretaría' })
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /aún falta registrar su entrega/u);
  assert.equal(statements.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(audits[0].accion, 'APROBAR_SOLICITUD_RECURSO');
  assert.equal(realtime.length, 1);
  assert.equal(realtime[0][0][0], 12);
});

test('una cuenta sin administración no puede consultar personas ni registrar entregas', async (t) => {
  const application = await startApp({ pool: {}, permissions: ['resources.view', 'resources.request'] });
  t.after(application.close);
  assert.equal((await fetch(`${application.baseUrl}/personas`)).status, 403);
  assert.equal((await fetch(`${application.baseUrl}/prestamos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
});
