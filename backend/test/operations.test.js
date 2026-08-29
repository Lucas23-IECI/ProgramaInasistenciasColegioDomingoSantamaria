const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { readBackupStatus } = require('../routes/operations');
const {
  reconcileCoexistenceAlertState,
  runCoexistenceAlerts,
  runOperationalAlerts
} = require('../services/operationalAlertService');

test('interpreta el archivo real de estado del respaldo', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ldsm-backup-status-'));
  const statusPath = path.join(directory, 'last-success.env');
  const now = new Date().toISOString();
  await fs.writeFile(statusPath, [
    `timestamp=${now}`,
    'database=ldsm_db_prueba.dump',
    'documents=ldsm_documentos_prueba.tar.gz',
    'manifest=ldsm_prueba.sha256'
  ].join('\n'));
  const previous = process.env.BACKUP_STATUS_FILE;
  process.env.BACKUP_STATUS_FILE = statusPath;
  try {
    const status = await readBackupStatus();
    assert.equal(status.available, true);
    assert.equal(status.healthy, true);
    assert.equal(status.database_file, 'ldsm_db_prueba.dump');
    assert.equal(status.documents_file, 'ldsm_documentos_prueba.tar.gz');
  } finally {
    if (previous === undefined) delete process.env.BACKUP_STATUS_FILE;
    else process.env.BACKUP_STATUS_FILE = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('informa estado no saludable cuando el archivo no existe', async () => {
  const previous = process.env.BACKUP_STATUS_FILE;
  process.env.BACKUP_STATUS_FILE = path.join(os.tmpdir(), `ausente-${Date.now()}.env`);
  try {
    const status = await readBackupStatus();
    assert.equal(status.available, false);
    assert.equal(status.healthy, false);
  } finally {
    if (previous === undefined) delete process.env.BACKUP_STATUS_FILE;
    else process.env.BACKUP_STATUS_FILE = previous;
  }
});

test('un respaldo vencido genera un solo aviso urgente por destinatario y día', async () => {
  const realtime = [];
  const inserts = [];
  const pool = {
    query: async (sql, params = []) => {
      if (/SELECT id FROM usuarios/u.test(sql)) return { rows: [{ id: 2 }, { id: 4 }] };
      if (/SELECT c\.id_caso/u.test(sql)) return { rows: [] };
      if (/SELECT u\.id/u.test(sql) && /convivencia\.view/u.test(sql)) return { rows: [] };
      if (/UPDATE alertas_operacionales_estado/u.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO notificaciones_internas/u.test(sql)) {
        inserts.push(params);
        return { rowCount: 1, rows: [{ id_notificacion: 100 + inserts.length, creada_en: '2026-08-26T12:00:00Z' }] };
      }
      throw new Error('Consulta inesperada');
    }
  };
  const result = await runOperationalAlerts(pool, {
    readBackupStatus: async () => ({ healthy: false, completed_at: '2026-08-24T09:00:00Z', age_hours: 51 }),
    realtimeHub: { publishToUsers: (users, event, payload) => realtime.push({ users, event, payload }) }
  });
  assert.deepEqual(result, {
    backupHealthy: false,
    notified: 2,
    backupNotified: 2,
    coexistenceNotified: 0,
    coexistenceSignals: 0
  });
  assert.equal(inserts.length, 2);
  assert.equal(inserts.every((params) => /operacion:respaldo:2026-08-24:/u.test(params[6])), true);
  assert.equal(realtime.every((entry) => entry.event === 'institutional-notification' && entry.payload.priority === 'URGENTE'), true);
});

test('Convivencia avisa una vez por ciclo y vuelve a avisar solo después de resolver y reaparecer', async () => {
  let cases = [{
    id_caso: 9,
    codigo: 'CE-2026-000009',
    prioridad: 'ALTA',
    proxima_revision: '2026-08-20',
    responsable_usuario_id: 5,
    responsable_activo: true,
    responsable_eliminado_en: null
  }, {
    id_caso: 12,
    codigo: 'CE-2026-000012',
    prioridad: 'URGENTE',
    proxima_revision: null,
    responsable_usuario_id: null,
    responsable_activo: null,
    responsable_eliminado_en: null
  }];
  const cycles = new Map();
  const deliveredKeys = new Set();
  const delivered = [];
  const realtime = [];
  const pool = {
    query: async (sql, params = []) => {
      const query = String(sql);
      if (/SELECT c\.id_caso/u.test(query)) return { rows: cases };
      if (/SELECT u\.id/u.test(query) && /convivencia\.view/u.test(query)) return { rows: [{ id: 5 }, { id: 7 }] };
      if (/INSERT INTO alertas_operacionales_estado/u.test(query)) {
        const previous = cycles.get(params[0]);
        const next = previous?.active ? previous.cycle : (previous?.cycle || 0) + 1;
        cycles.set(params[0], { cycle: next, active: true });
        return { rowCount: 1, rows: [{ ciclo: next }] };
      }
      if (/INSERT INTO notificaciones_internas/u.test(query)) {
        const key = `${params[0]}:${params[6]}`;
        if (deliveredKeys.has(key)) return { rowCount: 0, rows: [] };
        deliveredKeys.add(key);
        delivered.push({ userId: params[0], type: params[2], key: params[6], detail: params[4] });
        return { rowCount: 1, rows: [{ id_notificacion: delivered.length, creada_en: '2026-08-27T12:00:00Z' }] };
      }
      if (/UPDATE alertas_operacionales_estado/u.test(query)) {
        const activeKeys = new Set(params[1]);
        for (const [key, value] of cycles.entries()) {
          if (!activeKeys.has(key)) cycles.set(key, { ...value, active: false });
        }
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Consulta inesperada: ${query.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  };
  const options = { realtimeHub: { publishToUsers: (users, event, payload) => realtime.push({ users, event, payload }) } };

  const first = await runCoexistenceAlerts(pool, options);
  const repeated = await runCoexistenceAlerts(pool, options);
  assert.deepEqual(first, { notified: 3, signals: 2 });
  assert.deepEqual(repeated, { notified: 0, signals: 2 });
  assert.deepEqual(delivered.filter((item) => item.type === 'CONVIVENCIA_REVISION_VENCIDA').map((item) => item.userId), [5]);
  assert.deepEqual(delivered.filter((item) => item.type === 'CONVIVENCIA_URGENTE_SIN_RESPONSABLE').map((item) => item.userId), [5, 7]);
  assert.equal(delivered.every((item) => !/relato|descripci[oó]n inicial/iu.test(item.detail)), true);
  assert.equal(realtime.length, 3);

  cases = [];
  await runCoexistenceAlerts(pool, options);
  cases = [{
    id_caso: 12,
    codigo: 'CE-2026-000012',
    prioridad: 'URGENTE',
    proxima_revision: null,
    responsable_usuario_id: null,
    responsable_activo: null,
    responsable_eliminado_en: null
  }];
  const recurrence = await runCoexistenceAlerts(pool, options);
  assert.deepEqual(recurrence, { notified: 2, signals: 1 });
  assert.equal(delivered.slice(-2).every((item) => item.key.endsWith(':ciclo:2')), true);
});

test('la migración de alertas cíclicas es aditiva y conserva el historial', async () => {
  const migration = await fs.readFile(path.join(__dirname, '..', 'migrations', '047_alertas_operacionales_ciclicas.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS alertas_operacionales_estado/u);
  assert.match(migration, /ciclo INT NOT NULL DEFAULT 1/u);
  assert.match(migration, /resuelta_en TIMESTAMPTZ/u);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM notificaciones_internas/iu);
});

test('las mutaciones de Convivencia cierran de inmediato señales que ya no aplican', async () => {
  let captured = null;
  await reconcileCoexistenceAlertState({
    query: async (sql, params) => {
      captured = { sql, params };
      return { rowCount: 2, rows: [] };
    }
  }, 42);

  assert.deepEqual(captured.params, [42]);
  assert.match(captured.sql, /CONVIVENCIA_REVISION_VENCIDA/);
  assert.match(captured.sql, /CONVIVENCIA_URGENTE_SIN_RESPONSABLE/);
  assert.match(captured.sql, /proxima_revision <= CURRENT_DATE/);
  assert.match(captured.sql, /responsable\.activo = false/);
  assert.equal((captured.sql.match(/c\.id_caso = \$1::int/gu) || []).length, 2);
  assert.match(captured.sql, /a\.entidad_id = \$1::text/u);
});
