const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  canSearchDomain,
  createGlobalSearchRouter,
  normalizeSearchQuery
} = require('../routes/globalSearch');

const startApp = async ({ permissions = [], query }) => {
  const app = express();
  const audits = [];
  app.use('/api/busqueda-global', createGlobalSearchRouter({
    pool: { query },
    insertarAudit: async (_pool, entry) => { audits.push(entry); },
    getClientIp: () => '127.0.0.1',
    verifyToken: (req, _res, next) => {
      req.user = { id: 7, correo: 'persona@colegio.local', permissions };
      next();
    }
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/busqueda-global`,
    audits,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test('normaliza la búsqueda y neutraliza comodines antes de consultar', () => {
  assert.equal(normalizeSearchQuery('  Ana%_\\  Pérez  '), 'Ana Pérez');
  assert.equal(normalizeSearchQuery('x'.repeat(100)).length, 80);
  assert.equal(canSearchDomain(['convivencia.view'], 'coexistence'), true);
  assert.equal(canSearchDomain(['students.view'], 'coexistence'), false);
});

test('una consulta corta no toca la base de datos', async (t) => {
  let calls = 0;
  const application = await startApp({
    permissions: ['students.view'],
    query: async () => { calls += 1; return { rows: [] }; }
  });
  t.after(application.close);

  const response = await fetch(`${application.url}?q=a`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { query: 'a', groups: [], total: 0 });
  assert.equal(calls, 0);
});

test('solo consulta dominios autorizados y no devuelve identificadores sensibles', async (t) => {
  const calls = [];
  const application = await startApp({
    permissions: ['students.view'],
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return {
        rows: [{
          id: 41,
          title: 'Estudiante de Prueba',
          subtitle: '7° Básico',
          rut: '10068324-4',
          documento_numero: 'reservado'
        }]
      };
    }
  });
  t.after(application.close);

  const response = await fetch(`${application.url}?q=10068324-4`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /global-search:students/u);
  assert.doesNotMatch(calls[0].sql, /global-search:coexistence/u);
  assert.deepEqual(calls[0].params, ['10068324-4', 6]);
  assert.equal(body.total, 1);
  assert.deepEqual(body.groups[0].items[0], {
    id: '41',
    type: 'student',
    title: 'Estudiante de Prueba',
    subtitle: '7° Básico',
    url: '/admin/estudiantes?estudiante_id=41'
  });
  assert.equal(JSON.stringify(body).includes('10068324-4'), true, 'la consulta normalizada se conserva en el campo query');
  assert.equal(JSON.stringify(body.groups).includes('10068324-4'), false, 'el resultado no expone el identificador');
  assert.equal(JSON.stringify(body.groups).includes('reservado'), false, 'campos adicionales de la base no se serializan');
});

test('la información reservada de convivencia solo se busca con su permiso explícito', async (t) => {
  const calls = [];
  const application = await startApp({
    permissions: ['convivencia.view'],
    query: async (sql) => {
      calls.push(String(sql));
      return {
        rows: [{ id: 9, title: 'Caso reservado', codigo: 'CONV-009', estado: 'EN_REVISION', prioridad: 'URGENTE' }]
      };
    }
  });
  t.after(application.close);

  const response = await fetch(`${application.url}?q=caso`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /global-search:coexistence/u);
  assert.equal(body.groups[0].items[0].url, '/admin/convivencia/9');
});

test('audita el alcance de la consulta sin conservar el término ni identificadores', async (t) => {
  const application = await startApp({
    permissions: ['students.view'],
    query: async () => ({ rows: [{ id: 41, title: 'Estudiante de Prueba', subtitle: '7° Básico' }] })
  });
  t.after(application.close);

  const privateQuery = '10068324-4';
  const response = await fetch(`${application.url}?q=${encodeURIComponent(privateQuery)}`);
  assert.equal(response.status, 200);
  assert.equal(application.audits.length, 1);
  assert.equal(application.audits[0].accion, 'CONSULTAR_BUSQUEDA_GLOBAL');
  assert.deepEqual(application.audits[0].detalle.dominios_consultados, ['students']);
  assert.equal(application.audits[0].detalle.cantidad_resultados, 1);
  assert.equal(JSON.stringify(application.audits[0]).includes(privateQuery), false);
});

test('rechaza cuentas sin dominios y traduce fallos internos sin filtrar detalles', async (t) => {
  const forbidden = await startApp({ permissions: [], query: async () => ({ rows: [] }) });
  t.after(forbidden.close);
  const forbiddenResponse = await fetch(`${forbidden.url}?q=algo`);
  assert.equal(forbiddenResponse.status, 403);

  const failing = await startApp({
    permissions: ['documents.view'],
    query: async () => { throw new Error('relation documentos_expediente does not exist'); }
  });
  t.after(failing.close);
  const failingResponse = await fetch(`${failing.url}?q=certificado`);
  const body = await failingResponse.json();
  assert.equal(failingResponse.status, 500);
  assert.equal(body.message, 'No fue posible completar la búsqueda institucional. Inténtalo nuevamente.');
  assert.equal(JSON.stringify(body).includes('relation'), false);
});
