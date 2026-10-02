const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const { createAgendaRouter, dateWindow } = require('../routes/agenda');
const { runAgendaReminders } = require('../services/agendaReminderService');

const startAgendaApp = async ({ pool, audits = [], realtime = [] }) => {
  const app = express();
  app.use(express.json());
  app.use('/api/agenda', createAgendaRouter({
    pool,
    verifyToken: (req, _res, next) => {
      req.user = { id: 7, correo: 'equipo@ldsm.local', nombre: 'Equipo' };
      next();
    },
    verifyPermission: () => (_req, _res, next) => next(),
    insertarAudit: async (_queryable, entry) => audits.push(entry),
    getClientIp: () => '127.0.0.1',
    realtimeHub: { publishToUsers: (...args) => realtime.push(args) }
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/agenda`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test('la migración de agenda es privada, aditiva y no amplía el perfil fijo de Portería', async () => {
  const migration = await fs.readFile(path.join(__dirname, '..', 'migrations', '051_agenda_interna.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agenda_eventos/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agenda_evento_participantes/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agenda_recordatorios/u);
  assert.match(migration, /agenda\.view/u);
  assert.match(migration, /agenda\.create/u);
  assert.doesNotMatch(migration, /\('lector', 'agenda\./u);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/u);
});

test('el período admite fechas válidas y bloquea consultas mayores a 93 días', () => {
  assert.equal(dateWindow({ desde: '2026-08-01T00:00:00Z', hasta: '2026-08-08T00:00:00Z' }).from.getUTCDate(), 1);
  assert.equal(dateWindow({ desde: '2026-08-08', hasta: '2026-08-01' }), null);
  assert.equal(dateWindow({ desde: '2026-01-01', hasta: '2026-08-01' }), null);
  assert.equal(dateWindow({ desde: 'no-fecha', hasta: '2026-08-01' }), null);
});

test('la lista consulta únicamente eventos donde la cuenta participa', async (t) => {
  const calls = [];
  const app = await startAgendaApp({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return { rowCount: 1, rows: [{ id_evento: 91, titulo: 'Revisión semanal', participantes: [] }] };
      }
    }
  });
  t.after(app.close);
  const invalid = await fetch(`${app.baseUrl}?desde=2026-01-01&hasta=2026-08-01`);
  assert.equal(invalid.status, 400);
  const response = await fetch(`${app.baseUrl}?desde=2026-08-01T00:00:00Z&hasta=2026-08-08T00:00:00Z`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).events[0].id_evento, 91);
  assert.match(calls[0].sql, /participante\.usuario_id = \$1/u);
  assert.deepEqual(calls[0].params.map((value) => value instanceof Date ? value.toISOString() : value), [
    7, '2026-08-01T00:00:00.000Z', '2026-08-08T00:00:00.000Z'
  ]);
});

test('crear un evento valida invitados y confirma transacción, auditoría y aviso privado', async (t) => {
  const statements = [];
  const audits = [];
  const realtime = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT id FROM usuarios')) return { rows: [{ id: 12 }], rowCount: 1 };
      if (query.startsWith('INSERT INTO agenda_eventos')) return { rows: [{ id_evento: 51 }], rowCount: 1 };
      if (query.startsWith('INSERT INTO agenda_evento_participantes')) return { rows: [], rowCount: 2 };
      if (query.startsWith('INSERT INTO agenda_recordatorios')) return { rows: [], rowCount: 2 };
      if (query.startsWith('INSERT INTO notificaciones_internas')) {
        return { rows: [{ id_notificacion: 71, usuario_id: 12, creada_en: '2026-08-30T12:00:00Z' }], rowCount: 1 };
      }
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => { statements.push({ query: 'RELEASE', params: [] }); }
  };
  const app = await startAgendaApp({ pool: { connect: async () => client }, audits, realtime });
  t.after(app.close);
  const response = await fetch(app.baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      titulo: 'Revisión de coordinación', tipo: 'REVISION',
      inicio: '2026-09-01T13:00:00Z', fin: '2026-09-01T14:00:00Z',
      participantes_ids: [12, 12], recordatorio_minutos: 30
    })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id_evento, 51);
  assert.equal(statements.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(statements.some(({ query }) => query === 'ROLLBACK'), false);
  assert.equal(audits[0].accion, 'CREAR_EVENTO_AGENDA');
  assert.equal(audits[0].detalle.invitados, 1);
  assert.equal(realtime.length, 1);
  assert.deepEqual(realtime[0][0], [12]);
  assert.match(realtime[0][2].link, /evento=51/u);
});

test('rechazar una invitación cancela su recordatorio y conserva la respuesta en auditoría', async (t) => {
  const statements = [];
  const audits = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('UPDATE agenda_evento_participantes')) return { rows: [{ id_evento: 51 }], rowCount: 1 };
      if (query.startsWith('UPDATE agenda_recordatorios')) return { rows: [], rowCount: 1 };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => {}
  };
  const app = await startAgendaApp({ pool: { connect: async () => client }, audits });
  t.after(app.close);
  const response = await fetch(`${app.baseUrl}/51/respuesta`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ respuesta: 'RECHAZADA' })
  });
  assert.equal(response.status, 200);
  assert.equal(statements.some(({ query }) => query.includes("estado = 'CANCELADO'")), true);
  assert.equal(statements.some(({ query }) => query === 'COMMIT'), true);
  assert.equal(audits[0].detalle.respuesta, 'RECHAZADA');
});

test('los recordatorios se envían una sola vez y se publican después del commit', async () => {
  const order = [];
  const client = {
    query: async (sql) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      order.push(query);
      if (query.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ adquirido: true }], rowCount: 1 };
      if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (query.startsWith('UPDATE agenda_recordatorios r')) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT r.id_recordatorio')) return {
        rows: [{ id_recordatorio: 3, usuario_id: 12, id_evento: 51, minutos_antes: 30, titulo: 'Revisión semanal', inicio: '2026-09-01T13:00:00Z' }],
        rowCount: 1
      };
      if (query.startsWith('INSERT INTO notificaciones_internas')) {
        return { rows: [{ id_notificacion: 82, creada_en: '2026-09-01T12:30:00Z' }], rowCount: 1 };
      }
      if (query.startsWith('UPDATE agenda_recordatorios SET')) return { rows: [], rowCount: 1 };
      if (query.startsWith('SELECT pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => order.push('RELEASE')
  };
  const published = [];
  const result = await runAgendaReminders({ connect: async () => client }, {
    realtimeHub: { publishToUsers: (...args) => { order.push('PUBLISH'); published.push(args); } }
  });
  assert.deepEqual(result, { sent: 1, expired: 0 });
  assert.equal(order.indexOf('PUBLISH') > order.indexOf('COMMIT'), true);
  assert.equal(published.length, 1);
  assert.match(published[0][2].link, /evento=51/u);
  assert.equal(order.some((query) => query.includes('ON CONFLICT (usuario_id, clave_dedupe)')), true);
});

test('la API de agenda rechaza cada límite inválido antes de abrir una transacción', async (t) => {
  const application = await startAgendaApp({
    pool: {
      connect: async () => { throw new Error('No debe abrir una transacción para datos inválidos'); },
      query: async () => { throw new Error('No debe consultar para datos inválidos'); },
    },
  });
  t.after(application.close);

  const post = (body) => fetch(application.baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const valid = {
    titulo: 'Reunión válida', tipo: 'REUNION',
    inicio: '2026-09-01T13:00:00Z', fin: '2026-09-01T14:00:00Z',
    recordatorio_minutos: 30,
  };

  assert.equal((await post({ ...valid, titulo: 'x' })).status, 400);
  assert.equal((await post({ ...valid, tipo: 'INVENTADO' })).status, 400);
  assert.equal((await post({ ...valid, inicio: 'sin-fecha' })).status, 400);
  assert.equal((await post({ ...valid, fin: '2026-09-12T14:00:00Z' })).status, 400);
  assert.equal((await post({ ...valid, participantes_ids: Array.from({ length: 51 }, (_, index) => index + 20) })).status, 400);
  assert.equal((await post({ ...valid, recordatorio_minutos: 15 })).status, 400);

  const invalidResponse = await fetch(`${application.baseUrl}/0/respuesta`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ respuesta: 'ACEPTADA' }),
  });
  assert.equal(invalidResponse.status, 400);
  const invalidCancellation = await fetch(`${application.baseUrl}/3/cancelar`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: 'no' }),
  });
  assert.equal(invalidCancellation.status, 400);
  assert.equal((await fetch(`${application.baseUrl}/invalido`)).status, 400);
});

test('un evento personal no inventa invitados ni notificaciones', async (t) => {
  const statements = [];
  const audits = [];
  const client = {
    query: async (sql, params = []) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ query, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('INSERT INTO agenda_eventos')) return { rows: [{ id_evento: 77 }], rowCount: 1 };
      if (query.startsWith('INSERT INTO agenda_evento_participantes')) return { rows: [], rowCount: 1 };
      if (query.startsWith('INSERT INTO agenda_recordatorios')) return { rows: [], rowCount: 1 };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push({ query: 'RELEASE', params: [] }),
  };
  const application = await startAgendaApp({ pool: { connect: async () => client }, audits });
  t.after(application.close);

  const response = await fetch(application.baseUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      titulo: 'Recordatorio personal', inicio: '2026-09-01T13:00:00Z',
      fin: '2026-09-01T13:30:00Z', participantes_ids: [7, 7], todo_el_dia: true,
    }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id_evento, 77);
  assert.equal(statements.some(({ query }) => query.startsWith('SELECT id FROM usuarios')), false);
  assert.equal(statements.some(({ query }) => query.startsWith('INSERT INTO notificaciones_internas')), false);
  assert.equal(audits[0].detalle.invitados, 0);
  assert.equal(audits[0].detalle.todo_el_dia, true);
});

test('una cuenta retirada produce un conflicto claro y revierte la creación', async (t) => {
  const statements = [];
  const client = {
    query: async (sql) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      statements.push(query);
      if (['BEGIN', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('SELECT id FROM usuarios')) return { rows: [], rowCount: 0 };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => statements.push('RELEASE'),
  };
  const application = await startAgendaApp({ pool: { connect: async () => client } });
  t.after(application.close);

  const response = await fetch(application.baseUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      titulo: 'Revisión conjunta', inicio: '2026-09-01T13:00:00Z',
      fin: '2026-09-01T14:00:00Z', participantes_ids: [12],
    }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /ya no tiene una cuenta activa/u);
  assert.equal(statements.includes('ROLLBACK'), true);
  assert.equal(statements.includes('COMMIT'), false);
});

test('aceptar, cancelar y abrir eventos cubre estados vigentes y ya resueltos', async (t) => {
  const audits = [];
  let responseAvailable = true;
  let cancellationAvailable = true;
  const client = {
    query: async (sql) => {
      const query = String(sql).replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith('UPDATE agenda_evento_participantes')) {
        return responseAvailable ? { rows: [{ id_evento: 51 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (query.startsWith('UPDATE agenda_eventos')) {
        return cancellationAvailable ? { rows: [{ titulo: 'Revisión' }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (query.startsWith('UPDATE agenda_recordatorios')) return { rows: [], rowCount: 1 };
      throw new Error(`Consulta inesperada: ${query}`);
    },
    release: () => {},
  };
  let detailMode = 'found';
  const pool = {
    connect: async () => client,
    query: async () => {
      if (detailMode === 'error') throw new Error('base no disponible');
      return detailMode === 'found'
        ? { rows: [{ id_evento: 51, titulo: 'Revisión' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    },
  };
  const application = await startAgendaApp({ pool, audits });
  t.after(application.close);

  const accepted = await fetch(`${application.baseUrl}/51/respuesta`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ respuesta: 'ACEPTADA' }),
  });
  assert.equal(accepted.status, 200);
  assert.match((await accepted.json()).message, /Confirmaste/u);

  responseAvailable = false;
  const staleResponse = await fetch(`${application.baseUrl}/51/respuesta`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ respuesta: 'RECHAZADA' }),
  });
  assert.equal(staleResponse.status, 404);

  const cancelled = await fetch(`${application.baseUrl}/51/cancelar`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: 'Cambio de planificación' }),
  });
  assert.equal(cancelled.status, 200);
  cancellationAvailable = false;
  const staleCancellation = await fetch(`${application.baseUrl}/51/cancelar`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: 'Segundo intento inválido' }),
  });
  assert.equal(staleCancellation.status, 404);

  assert.equal((await fetch(`${application.baseUrl}/51`)).status, 200);
  detailMode = 'missing';
  assert.equal((await fetch(`${application.baseUrl}/51`)).status, 404);
  detailMode = 'error';
  const failedDetail = await fetch(`${application.baseUrl}/51`);
  assert.equal(failedDetail.status, 500);
  assert.deepEqual(await failedDetail.json(), { message: 'No fue posible abrir el evento.' });
  assert.equal(audits.some((entry) => entry.accion === 'CANCELAR_EVENTO_AGENDA'), true);
});
