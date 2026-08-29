const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createNotificationsRouter, reconcileStaleShipments } = require('../routes/notifications');

test('el historial enviado incluye un resumen agregado para Dirección', () => {
  const source = createNotificationsRouter.toString();
  assert.match(source, /AS destinatarios/u);
  assert.match(source, /AS entregadas/u);
  assert.match(source, /AS leidas/u);
  assert.match(source, /summary: summary\.rows\[0\]/u);
});

test('los envíos interrumpidos dejan de aparecer eternamente como procesando', async () => {
  const calls = [];
  await reconcileStaleShipments({
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    }
  }, 41);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [41]);
  assert.match(calls[0].sql, /estado = 'FALLIDO'/u);
  assert.match(calls[0].sql, /INTERVAL '5 minutes'/u);
  assert.match(calls[0].sql, /Puedes reintentarlo de forma segura/u);
});

const startTestServer = async ({ connectError = null } = {}) => {
  const queries = [];
  const auditEntries = [];
  const realtimeEvents = [];
  const shipmentParams = [];
  let released = false;

  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/u.test(normalized)) return { rows: [], rowCount: 0 };
      if (normalized.startsWith('SELECT id FROM usuarios')) {
        return { rows: params[0].map((id) => ({ id })), rowCount: params[0].length };
      }
      if (normalized.startsWith('INSERT INTO notificaciones_envios')) {
        shipmentParams.push(params);
        return { rows: [{ id_envio: 91, creado_en: '2026-08-23T12:00:00.000Z' }], rowCount: 1 };
      }
      if (normalized.startsWith('INSERT INTO notificaciones_internas')) {
        return {
          rows: params[0].map((userId, index) => ({
            id_notificacion: 200 + index,
            usuario_id: userId,
            creada_en: '2026-08-23T12:00:00.000Z'
          })),
          rowCount: params[0].length
        };
      }
      if (normalized.startsWith('SELECT e.id_envio')) return { rows: [], rowCount: 0 };
      if (normalized.startsWith('SELECT COUNT(*)::int AS total FROM notificaciones_envios')) {
        return { rows: [{ total: 0 }], rowCount: 1 };
      }
      if (normalized.startsWith('WITH envios AS')) {
        return {
          rows: [{ total: 0, enviados: 0, fallidos: 0, destinatarios: 0, entregadas: 0, leidas: 0 }],
          rowCount: 1
        };
      }
      if (normalized.startsWith('UPDATE notificaciones_envios')) return { rows: [], rowCount: 1 };
      throw new Error(`Consulta inesperada en la prueba: ${normalized.slice(0, 80)}`);
    },
    release() { released = true; }
  };

  const pool = {
    query: (...args) => client.query(...args),
    async connect() {
      if (connectError) throw connectError;
      return client;
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/notificaciones', createNotificationsRouter({
    pool,
    verifyToken: (req, res, next) => {
      req.user = {
        id: 1,
        correo: 'direccion@ldsm.local',
        nombre: 'Dirección',
        permissions: ['notifications.send']
      };
      next();
    },
    verifyPermission: () => (req, res, next) => next(),
    insertarAudit: async (queryable, entry) => auditEntries.push(entry),
    getClientIp: () => '127.0.0.1',
    realtimeHub: {
      publishToUsers: (users, event, payload) => realtimeEvents.push({ users, event, payload })
    }
  }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    queries,
    auditEntries,
    realtimeEvents,
    shipmentParams,
    wasReleased: () => released,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
};

test('el historial enviado responde con su resumen aun cuando todavía está vacío', async (t) => {
  const fixture = await startTestServer();
  t.after(fixture.close);

  const response = await fetch(`${fixture.url}/api/notificaciones/enviadas?pagina=1&limite=5`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.summary, {
    total: 0,
    enviados: 0,
    fallidos: 0,
    destinatarios: 0,
    entregadas: 0,
    leidas: 0
  });
});

test('el envío dirigido confirma destinatarios, auditoría, commit y eventos en tiempo real', async (t) => {
  const fixture = await startTestServer();
  t.after(fixture.close);

  const response = await fetch(`${fixture.url}/api/notificaciones/envios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo: 'Reunión institucional',
      detalle: 'Revisar la coordinación de la jornada.',
      prioridad: 'URGENTE',
      destinatarios: [5, 7, 7],
      enlace: '/chat?origen=aviso'
    })
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    id_envio: 91,
    estado: 'ENVIADO',
    destinatarios_total: 2,
    creada_en: '2026-08-23T12:00:00.000Z'
  });
  assert.equal(fixture.queries.includes('COMMIT'), true);
  assert.equal(fixture.queries.includes('ROLLBACK'), false);
  assert.equal(fixture.wasReleased(), true);
  assert.equal(fixture.shipmentParams[0][4], '/chat?origen=aviso');
  assert.equal(fixture.auditEntries.length, 1);
  assert.equal(fixture.auditEntries[0].accion, 'ENVIAR_NOTIFICACION_INSTITUCIONAL');
  assert.equal(fixture.realtimeEvents.length, 2);
  assert.equal(fixture.realtimeEvents.every((entry) => entry.event === 'institutional-notification'), true);
});

test('un fallo interno no publica detalles técnicos de conexión', async (t) => {
  const originalError = console.error;
  console.error = () => {};
  const fixture = await startTestServer({ connectError: new Error('password authentication failed for private_role') });
  t.after(async () => {
    console.error = originalError;
    await fixture.close();
  });

  const response = await fetch(`${fixture.url}/api/notificaciones/envios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo: 'Aviso de prueba',
      detalle: 'Contenido seguro para la prueba.',
      destinatarios: [5]
    })
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    message: 'No fue posible entregar la notificación. Puedes revisar el intento y reintentarlo desde el historial.',
    envio_id: 91
  });
  assert.doesNotMatch(JSON.stringify(body), /password|private_role/iu);
});
