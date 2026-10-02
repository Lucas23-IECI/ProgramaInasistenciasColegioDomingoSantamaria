const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');

const { createOperationsRouter } = require('../routes/operations');

const startApp = async ({ pool, insertarAudit = async () => {} }) => {
  const permissions = [];
  const app = express();
  app.use(express.json());
  app.use('/api/operaciones', createOperationsRouter({
    pool,
    verifyToken: (req, _res, next) => {
      req.user = { id: 7, correo: 'equipo@ldsm.local', permissions: ['operations.view', 'operations.tasks.manage'] };
      next();
    },
    verifyPermission: (permission) => {
      permissions.push(permission);
      return (_req, _res, next) => next();
    },
    insertarAudit,
    getClientIp: () => '127.0.0.1'
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/operaciones`,
    permissions,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test('la migración de tareas es aditiva y conserva los registros institucionales', async () => {
  const migration = await fs.readFile(path.join(__dirname, '..', 'migrations', '049_tareas_operacionales_internas.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tareas_operacionales_internas/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tarea_operacional_eventos/u);
  assert.match(migration, /operations\.tasks\.manage/u);
  assert.match(migration, /ON DELETE RESTRICT/u);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM (?:visitas|retiros_alumno|attendance_registrations|usuarios)/iu);
});

test('crear una tarea valida al responsable y registra evento, auditoría y transacción', async (t) => {
  const statements = [];
  const audits = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql);
      statements.push({ query, params });
      if (/^BEGIN$/u.test(query)) return {};
      if (/SELECT u\.id/u.test(query)) return { rowCount: 1, rows: [{ id: 12 }] };
      if (/INSERT INTO tareas_operacionales_internas/u.test(query)) {
        return { rowCount: 1, rows: [{ id_tarea: 81, titulo: params[0], prioridad: params[2], estado: 'PENDIENTE' }] };
      }
      if (/INSERT INTO tarea_operacional_eventos/u.test(query)) return { rowCount: 1, rows: [] };
      if (/^COMMIT$/u.test(query)) return {};
      if (/^ROLLBACK$/u.test(query)) return {};
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => { statements.push({ query: 'RELEASE', params: [] }); }
  };
  const app = await startApp({
    pool: { connect: async () => client, query: async () => ({ rows: [] }) },
    insertarAudit: async (_queryable, detail) => { audits.push(detail); }
  });
  t.after(app.close);

  const response = await fetch(`${app.baseUrl}/tareas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      titulo: '  Revisar   antecedente  ',
      detalle: 'Confirmar con el equipo.',
      prioridad: 'alta',
      responsable_usuario_id: 12,
      fecha_limite: '2026-09-03'
    })
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).titulo, 'Revisar antecedente');
  assert.equal(statements.some(({ query }) => /^COMMIT$/u.test(query)), true);
  assert.equal(statements.some(({ query }) => /INSERT INTO tarea_operacional_eventos/u.test(query)), true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].accion, 'CREAR_TAREA_OPERACIONAL');
  assert.equal(audits[0].entidad_id, 81);
  assert.equal(app.permissions.includes('operations.tasks.manage'), true);
});

test('la API rechaza asignar una tarea a una cuenta sin acceso a la bandeja', async (t) => {
  const statements = [];
  const client = {
    query: async (sql) => {
      const query = String(sql);
      statements.push(query);
      if (query === 'BEGIN' || query === 'ROLLBACK') return {};
      if (/SELECT u\.id/u.test(query)) return { rowCount: 0, rows: [] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => {}
  };
  const app = await startApp({ pool: { connect: async () => client, query: async () => ({ rows: [] }) } });
  t.after(app.close);

  const response = await fetch(`${app.baseUrl}/tareas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ titulo: 'Revisar antecedente', responsable_usuario_id: 44 })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /responsable ya no está disponible/u);
  assert.equal(statements.includes('ROLLBACK'), true);
});

test('completar una tarea exige motivo y conserva el cambio en el historial', async (t) => {
  const statements = [];
  const audits = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql);
      statements.push({ query, params });
      if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') return {};
      if (/SELECT \* FROM tareas_operacionales_internas/u.test(query)) {
        return { rowCount: 1, rows: [{ id_tarea: 91, estado: 'EN_PROGRESO' }] };
      }
      if (/UPDATE tareas_operacionales_internas/u.test(query)) {
        return { rowCount: 1, rows: [{ id_tarea: 91, estado: params[1], version: 2 }] };
      }
      if (/INSERT INTO tarea_operacional_eventos/u.test(query)) return { rowCount: 1, rows: [] };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => {}
  };
  const app = await startApp({
    pool: { connect: async () => client, query: async () => ({ rows: [] }) },
    insertarAudit: async (_queryable, detail) => { audits.push(detail); }
  });
  t.after(app.close);

  const invalid = await fetch(`${app.baseUrl}/tareas/91/estado`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado: 'COMPLETADA', motivo: 'no' })
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(`${app.baseUrl}/tareas/91/estado`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado: 'COMPLETADA', motivo: 'Antecedente confirmado.' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).estado, 'COMPLETADA');
  assert.equal(statements.some(({ query } = {}) => /FOR UPDATE/u.test(query || '')), true);
  assert.equal(statements.some(({ query } = {}) => /INSERT INTO tarea_operacional_eventos/u.test(query || '')), true);
  const updateStatement = statements.find(({ query } = {}) => /UPDATE tareas_operacionales_internas/u.test(query || ''))?.query || '';
  assert.match(updateStatement, /estado=\$2::varchar\(20\)/u);
  assert.equal((updateStatement.match(/\$2::varchar\(20\)/gu) || []).length, 3);
  assert.match(updateStatement, /THEN \$3::integer ELSE NULL/u);
  assert.equal(audits[0].accion, 'ACTUALIZAR_TAREA_OPERACIONAL');
});

test('el historial devuelve la tarea junto con todas sus acciones visibles', async (t) => {
  const pool = {
    connect: async () => { throw new Error('No se esperaba transacción'); },
    query: async (sql) => {
      const query = String(sql);
      if (/FROM tareas_operacionales_internas t/u.test(query)) {
        return { rowCount: 1, rows: [{ id_tarea: 19, titulo: 'Confirmar documento', estado: 'PENDIENTE' }] };
      }
      if (/FROM tarea_operacional_eventos e/u.test(query)) {
        return { rowCount: 2, rows: [{ id_evento: 1, tipo: 'CREADA' }, { id_evento: 2, tipo: 'ESTADO_CAMBIADO' }] };
      }
      throw new Error(`Consulta inesperada: ${query}`);
    }
  };
  const app = await startApp({ pool });
  t.after(app.close);

  const response = await fetch(`${app.baseUrl}/tareas/19`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tarea.id_tarea, 19);
  assert.deepEqual(body.eventos.map((event) => event.tipo), ['CREADA', 'ESTADO_CAMBIADO']);
  assert.equal(app.permissions.includes('operations.view'), true);
});
